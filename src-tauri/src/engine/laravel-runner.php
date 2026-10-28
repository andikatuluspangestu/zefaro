<?php
// Zefaro's helper for looking inside a Laravel app. Zefaro runs it with the site's
// PHP and the site's folder as the working directory:
//
//   php laravel-runner.php query    one request on stdin, one answer, exit
//   php laravel-runner.php serve    Tinker session: one request per line
//
// Answers are JSON lines that start with ZEFARO_MARK, so anything the app itself
// prints (echo, dump, deprecation notices) can't be mistaken for one.

const ZEFARO_MARK = "\x1eZEFARO:";
const ZEFARO_MAX_STRING = 2000;
const ZEFARO_MAX_ITEMS = 50;
const ZEFARO_MAX_DEPTH = 4;

ini_set('display_errors', 'stderr');
ini_set('html_errors', '0');
error_reporting(E_ALL & ~E_DEPRECATED & ~E_USER_DEPRECATED);

function zefaro_send(array $message): void
{
    $json = json_encode(
        $message,
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PARTIAL_OUTPUT_ON_ERROR
    );
    fwrite(STDOUT, ZEFARO_MARK . $json . "\n");
    fflush(STDOUT);
}

function zefaro_error(Throwable $e): array
{
    $trace = [];
    foreach ($e->getTrace() as $frame) {
        $file = $frame['file'] ?? '';
        if ($file === '' || $file === __FILE__ || strpos($file, DIRECTORY_SEPARATOR . 'vendor' . DIRECTORY_SEPARATOR) !== false) {
            continue;
        }
        // Code typed into the session has no file of its own.
        $trace[] = ['file' => strpos($file, "eval()'d code") !== false ? '' : zefaro_relative($file), 'line' => $frame['line'] ?? 0];
        if (count($trace) >= 8) {
            break;
        }
    }
    return [
        'class' => get_class($e),
        'message' => $e->getMessage(),
        'file' => zefaro_relative($e->getFile()),
        'line' => $e->getLine(),
        'trace' => $trace,
    ];
}

function zefaro_relative(string $file): string
{
    $root = rtrim(getcwd(), '\\/') . DIRECTORY_SEPARATOR;
    return strncmp($file, $root, strlen($root)) === 0 ? substr($file, strlen($root)) : $file;
}

function zefaro_boot()
{
    $root = getcwd();
    if (!is_file($root . '/vendor/autoload.php')) {
        throw new RuntimeException('vendor/autoload.php is missing. Run composer install in this folder first.');
    }
    require $root . '/vendor/autoload.php';
    $app = require $root . '/bootstrap/app.php';
    $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
    return $app;
}

// ---------------------------------------------------------------- one-shot --

function zefaro_overview($app): array
{
    $config = $app['config'];
    $connection = $config->get('database.default');
    $db = $config->get("database.connections.$connection", []);
    $mailer = $config->get('mail.default') ?: $config->get('mail.driver');
    $mail = $config->get("mail.mailers.$mailer", []);

    $database = ['connected' => false, 'error' => null];
    try {
        Illuminate\Support\Facades\DB::connection()->getPdo();
        $database['connected'] = true;
    } catch (Throwable $e) {
        $database['error'] = $e->getMessage();
    }

    $pending = null;
    if ($database['connected']) {
        try {
            $migrator = $app['migrator'];
            $paths = array_merge($migrator->paths(), [$app->databasePath('migrations')]);
            $files = $migrator->getMigrationFiles($paths);
            $ran = $migrator->repositoryExists() ? $migrator->getRepository()->getRan() : [];
            $pending = array_values(array_diff(array_keys($files), $ran));
        } catch (Throwable $e) {
            $pending = null;
        }
    }

    $storageLink = public_path('storage');
    return [
        'laravel' => $app->version(),
        'php' => PHP_VERSION,
        'name' => $config->get('app.name'),
        'environment' => $app->environment(),
        'debug' => (bool) $config->get('app.debug'),
        'url' => $config->get('app.url'),
        'timezone' => $config->get('app.timezone'),
        'locale' => $config->get('app.locale'),
        'keySet' => (string) $config->get('app.key') !== '',
        'maintenance' => $app->isDownForMaintenance(),
        'configCached' => $app->configurationIsCached(),
        'routesCached' => $app->routesAreCached(),
        'eventsCached' => method_exists($app, 'eventsAreCached') ? $app->eventsAreCached() : false,
        'storageLinked' => file_exists($storageLink) || is_link($storageLink),
        'drivers' => [
            'database' => $connection,
            'databaseDriver' => $db['driver'] ?? null,
            'databaseName' => $db['database'] ?? null,
            'databaseHost' => $db['host'] ?? null,
            'databasePort' => isset($db['port']) ? (string) $db['port'] : null,
            'cache' => $config->get('cache.default'),
            'session' => $config->get('session.driver'),
            'queue' => $config->get('queue.default'),
            'mail' => $mailer,
            'mailHost' => $mail['host'] ?? null,
            'mailPort' => isset($mail['port']) ? (string) $mail['port'] : null,
            'filesystem' => $config->get('filesystems.default'),
            'broadcast' => $config->get('broadcasting.default'),
            'log' => $config->get('logging.default'),
        ],
        'database' => $database,
        'pendingMigrations' => $pending,
        'packages' => [
            'horizon' => class_exists('Laravel\\Horizon\\Horizon'),
            'reverb' => class_exists('Laravel\\Reverb\\ReverbServiceProvider'),
            'octane' => class_exists('Laravel\\Octane\\Octane'),
            'pulse' => class_exists('Laravel\\Pulse\\Pulse'),
            'telescope' => class_exists('Laravel\\Telescope\\Telescope'),
        ],
    ];
}

/** Model classes under app/ (app/Models first), keyed by table name. */
function zefaro_models($app): array
{
    $models = [];
    $base = $app->path();
    $namespace = method_exists($app, 'getNamespace') ? $app->getNamespace() : 'App\\';
    $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($base, FilesystemIterator::SKIP_DOTS));
    foreach ($files as $file) {
        if ($file->getExtension() !== 'php') {
            continue;
        }
        $relative = substr($file->getPathname(), strlen($base) + 1, -4);
        $class = $namespace . str_replace(['/', '\\'], '\\', $relative);
        $source = @file_get_contents($file->getPathname(), false, null, 0, 8192);
        if ($source === false || !preg_match('/\bclass\s+\w+/', $source)) {
            continue;
        }
        try {
            if (!class_exists($class)) {
                continue;
            }
            $reflection = new ReflectionClass($class);
            if ($reflection->isAbstract() || !$reflection->isSubclassOf(Illuminate\Database\Eloquent\Model::class)) {
                continue;
            }
            $model = new $class();
            $models[$model->getTable()] = [
                'class' => $class,
                'hidden' => $model->getHidden(),
            ];
        } catch (Throwable $e) {
            continue;
        }
    }
    return $models;
}

function zefaro_tables($app): array
{
    $schema = Illuminate\Support\Facades\Schema::connection(null);
    $connection = Illuminate\Support\Facades\DB::connection();
    $driver = $connection->getDriverName();
    $tables = [];
    if (method_exists($schema, 'getTables')) {
        foreach ($schema->getTables() as $table) {
            $tables[] = ['name' => $table['name'], 'size' => $table['size'] ?? null];
        }
    } elseif ($driver === 'sqlite') {
        foreach ($connection->select("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name") as $row) {
            $tables[] = ['name' => $row->name, 'size' => null];
        }
    } elseif ($driver === 'pgsql') {
        foreach ($connection->select('select table_name as name from information_schema.tables where table_schema = current_schema() order by table_name') as $row) {
            $tables[] = ['name' => $row->name, 'size' => null];
        }
    } else {
        foreach ($connection->select('select table_name as name, data_length + index_length as size from information_schema.tables where table_schema = database() order by table_name') as $row) {
            $tables[] = ['name' => $row->name, 'size' => $row->size === null ? null : (int) $row->size];
        }
    }
    $models = zefaro_models($app);
    foreach ($tables as &$table) {
        $table['model'] = $models[$table['name']]['class'] ?? null;
    }
    return ['driver' => $driver, 'tables' => $tables];
}

function zefaro_columns(string $table): array
{
    $schema = Illuminate\Support\Facades\Schema::connection(null);
    $columns = [];
    if (method_exists($schema, 'getColumns')) {
        foreach ($schema->getColumns($table) as $column) {
            $columns[] = [
                'name' => $column['name'],
                'type' => $column['type_name'] ?? $column['type'] ?? null,
                'nullable' => (bool) ($column['nullable'] ?? true),
            ];
        }
    } else {
        foreach ($schema->getColumnListing($table) as $name) {
            $columns[] = ['name' => $name, 'type' => null, 'nullable' => true];
        }
    }
    $primary = [];
    if (method_exists($schema, 'getIndexes')) {
        foreach ($schema->getIndexes($table) as $index) {
            if (!empty($index['primary'])) {
                $primary = $index['columns'];
            }
        }
    } elseif (in_array('id', array_column($columns, 'name'), true)) {
        $primary = ['id'];
    }
    return [$columns, $primary];
}

function zefaro_is_text_type(?string $type): bool
{
    if ($type === null) {
        return true;
    }
    return (bool) preg_match('/char|text|string|json|enum|uuid/i', $type);
}

function zefaro_cell($value)
{
    if (is_string($value)) {
        if (!mb_check_encoding($value, 'UTF-8')) {
            return ['binary' => strlen($value)];
        }
        if (mb_strlen($value) > 500) {
            return ['text' => mb_substr($value, 0, 500), 'length' => mb_strlen($value)];
        }
    }
    return $value;
}

function zefaro_rows($app, array $request): array
{
    $table = (string) ($request['table'] ?? '');
    [$columns, $primary] = zefaro_columns($table);
    if (!$columns) {
        throw new InvalidArgumentException("Table $table doesn't exist.");
    }
    $names = array_column($columns, 'name');
    $query = Illuminate\Support\Facades\DB::table($table);

    $search = trim((string) ($request['search'] ?? ''));
    if ($search !== '') {
        $query->where(function ($where) use ($columns, $search) {
            foreach ($columns as $column) {
                if (zefaro_is_text_type($column['type'])) {
                    $where->orWhere($column['name'], 'like', '%' . $search . '%');
                }
            }
            if (ctype_digit($search)) {
                foreach ($columns as $column) {
                    if (!zefaro_is_text_type($column['type'])) {
                        $where->orWhere($column['name'], '=', $search);
                    }
                }
            }
        });
    }

    $operators = ['=', '!=', '<', '<=', '>', '>=', 'like', 'not like'];
    foreach ($request['filters'] ?? [] as $filter) {
        $column = $filter['column'] ?? '';
        if (!in_array($column, $names, true)) {
            continue;
        }
        $op = $filter['op'] ?? '=';
        if ($op === 'null') {
            $query->whereNull($column);
        } elseif ($op === 'not null') {
            $query->whereNotNull($column);
        } elseif (in_array($op, $operators, true)) {
            $value = (string) ($filter['value'] ?? '');
            $query->where($column, $op, str_contains($op, 'like') && strpbrk($value, '%_') === false ? "%$value%" : $value);
        }
    }

    $total = (clone $query)->count();
    $sort = $request['sort'] ?? null;
    if (in_array($sort, $names, true)) {
        $query->orderBy($sort, ($request['direction'] ?? 'asc') === 'desc' ? 'desc' : 'asc');
    } elseif ($primary) {
        $query->orderBy($primary[0]);
    }
    $perPage = max(1, min(200, (int) ($request['perPage'] ?? 50)));
    $page = max(1, (int) ($request['page'] ?? 1));
    $rows = [];
    foreach ($query->forPage($page, $perPage)->get() as $row) {
        $cells = [];
        foreach ($names as $name) {
            $cells[] = zefaro_cell($row->$name ?? null);
        }
        $rows[] = $cells;
    }

    $models = zefaro_models($app);
    return [
        'table' => $table,
        'columns' => $columns,
        'primaryKey' => $primary,
        'hidden' => $models[$table]['hidden'] ?? [],
        'model' => $models[$table]['class'] ?? null,
        'rows' => $rows,
        'total' => $total,
        'page' => $page,
        'perPage' => $perPage,
    ];
}

function zefaro_row_query(array $request)
{
    $table = (string) ($request['table'] ?? '');
    [, $primary] = zefaro_columns($table);
    $key = $request['key'] ?? [];
    if (!$primary || array_diff($primary, array_keys($key))) {
        throw new InvalidArgumentException("Rows of $table can only be changed through a primary key.");
    }
    $query = Illuminate\Support\Facades\DB::table($table);
    foreach ($primary as $column) {
        $query->where($column, $key[$column]);
    }
    return $query;
}

function zefaro_update_cell(array $request): array
{
    $affected = zefaro_row_query($request)->limit(1)->update([(string) $request['column'] => $request['value'] ?? null]);
    return ['affected' => $affected];
}

function zefaro_delete_row(array $request): array
{
    $affected = zefaro_row_query($request)->limit(1)->delete();
    return ['affected' => $affected];
}

function zefaro_flatten($value, string $prefix, array &$out): void
{
    if (is_array($value) && $value !== [] && count($out) < 5000) {
        foreach ($value as $key => $item) {
            zefaro_flatten($item, $prefix === '' ? (string) $key : "$prefix.$key", $out);
        }
        return;
    }
    if (is_object($value)) {
        $value = $value instanceof Closure ? 'Closure' : get_class($value);
        $out[] = ['key' => $prefix, 'value' => $value, 'type' => 'object'];
        return;
    }
    $out[] = ['key' => $prefix, 'value' => $value, 'type' => is_array($value) ? 'array' : gettype($value)];
}

function zefaro_config($app): array
{
    $out = [];
    zefaro_flatten($app['config']->all(), '', $out);
    return ['cached' => $app->configurationIsCached(), 'items' => $out];
}

function zefaro_routes($app): array
{
    $routes = [];
    foreach ($app['router']->getRoutes()->getRoutes() as $route) {
        $middleware = [];
        foreach ($route->gatherMiddleware() as $item) {
            $middleware[] = is_string($item) ? $item : (is_object($item) ? get_class($item) : gettype($item));
        }
        $routes[] = [
            'methods' => array_values(array_diff($route->methods(), ['HEAD'])),
            'uri' => $route->uri(),
            'name' => $route->getName(),
            'action' => $route->getActionName(),
            'middleware' => $middleware,
            'domain' => $route->getDomain(),
        ];
    }
    return ['cached' => $app->routesAreCached(), 'routes' => $routes];
}

function zefaro_query(array $request): array
{
    $app = zefaro_boot();
    switch ($request['op'] ?? '') {
        case 'overview':
            return zefaro_overview($app);
        case 'tables':
            return zefaro_tables($app);
        case 'rows':
            return zefaro_rows($app, $request);
        case 'updateCell':
            return zefaro_update_cell($request);
        case 'deleteRow':
            return zefaro_delete_row($request);
        case 'config':
            return zefaro_config($app);
        case 'routes':
            return zefaro_routes($app);
    }
    throw new InvalidArgumentException('Unknown request.');
}

// ------------------------------------------------------------------ Tinker --

/** A value as a tree the interface can draw: t = type, v = value, k = children. */
function zefaro_describe($value, int $depth = 0, array $path = []): array
{
    if ($value === null) {
        return ['t' => 'null'];
    }
    if (is_bool($value)) {
        return ['t' => 'bool', 'v' => $value];
    }
    if (is_int($value) || is_float($value)) {
        return ['t' => is_int($value) ? 'int' : 'float', 'v' => is_finite((float) $value) ? $value : (string) $value];
    }
    if (is_string($value)) {
        if (!mb_check_encoding($value, 'UTF-8')) {
            return ['t' => 'binary', 'n' => strlen($value)];
        }
        $length = mb_strlen($value);
        $node = ['t' => 'string', 'v' => $length > ZEFARO_MAX_STRING ? mb_substr($value, 0, ZEFARO_MAX_STRING) : $value, 'n' => $length];
        return $node;
    }
    if (is_resource($value)) {
        return ['t' => 'resource', 'v' => get_resource_type($value)];
    }
    if (is_array($value)) {
        return zefaro_children(['t' => 'array', 'n' => count($value)], $value, $depth, $path);
    }
    if (!is_object($value)) {
        return ['t' => gettype($value)];
    }

    $class = get_class($value);
    $id = spl_object_id($value);
    if (in_array($id, $path, true)) {
        return ['t' => 'object', 'c' => $class, 'v' => 'recursion'];
    }
    $path[] = $id;

    if ($value instanceof Closure) {
        return ['t' => 'closure', 'c' => 'Closure'];
    }
    if ($value instanceof UnitEnum) {
        return ['t' => 'enum', 'c' => $class, 'v' => $value->name . ($value instanceof BackedEnum ? ' = ' . $value->value : '')];
    }
    if ($value instanceof DateTimeInterface) {
        return ['t' => 'date', 'c' => $class, 'v' => $value->format('Y-m-d H:i:s.u P')];
    }
    if ($value instanceof Illuminate\Database\Eloquent\Model) {
        $node = ['t' => 'model', 'c' => $class, 'v' => $value->exists ? (string) json_encode($value->getKey()) : 'new'];
        $children = $value->getAttributes();
        foreach ($value->getRelations() as $name => $relation) {
            $children['@' . $name] = $relation;
        }
        return zefaro_children($node, $children, $depth, $path);
    }
    if ($value instanceof Illuminate\Contracts\Pagination\Paginator) {
        $items = $value->items();
        $node = ['t' => 'collection', 'c' => $class, 'n' => count($items)];
        if ($value instanceof Illuminate\Contracts\Pagination\LengthAwarePaginator) {
            $node['v'] = 'page ' . $value->currentPage() . ' of ' . $value->lastPage() . ', ' . $value->total() . ' total';
        }
        return zefaro_children($node, $items, $depth, $path);
    }
    if ($value instanceof Illuminate\Support\Enumerable) {
        return zefaro_children(['t' => 'collection', 'c' => $class, 'n' => $value->count()], $value->all(), $depth, $path);
    }
    if ($value instanceof Illuminate\Database\Query\Builder || $value instanceof Illuminate\Database\Eloquent\Builder) {
        return ['t' => 'object', 'c' => $class, 'v' => $value->toSql()];
    }

    $properties = [];
    foreach ((array) $value as $key => $item) {
        $key = (string) $key;
        if ($key !== '' && $key[0] === "\0") {
            $parts = explode("\0", $key);
            $key = ($parts[1] === '*' ? '#' : '-') . end($parts);
        }
        $properties[$key] = $item;
    }
    $node = ['t' => 'object', 'c' => $class, 'n' => count($properties)];
    if ($value instanceof Stringable || method_exists($value, '__toString')) {
        try {
            $node['v'] = mb_substr((string) $value, 0, 200);
        } catch (Throwable $e) {
        }
    }
    return zefaro_children($node, $properties, $depth, $path);
}

function zefaro_children(array $node, array $items, int $depth, array $path): array
{
    if ($items === []) {
        $node['k'] = [];
        return $node;
    }
    if ($depth >= ZEFARO_MAX_DEPTH) {
        $node['more'] = count($items);
        return $node;
    }
    $children = [];
    foreach ($items as $key => $item) {
        if (count($children) >= ZEFARO_MAX_ITEMS) {
            break;
        }
        $children[] = ['key' => (string) $key, 'value' => zefaro_describe($item, $depth + 1, $path)];
    }
    $node['k'] = $children;
    if (count($items) > count($children)) {
        $node['more'] = count($items) - count($children);
    }
    return $node;
}

/**
 * Split code at its last top-level statement and, when that statement is an
 * expression, return it so the session can show its value like Tinker does.
 */
function zefaro_prepare(string $code): string
{
    $code = trim($code);
    if (strncmp($code, '<?php', 5) === 0) {
        $code = trim(substr($code, 5));
    }
    $tokens = token_get_all("<?php\n" . $code);
    array_shift($tokens);
    $depth = 0;
    $boundary = 0; // token index where the last statement starts
    $count = count($tokens);
    $last = $count - 1; // last token that isn't whitespace or a comment
    while ($last >= 0 && is_array($tokens[$last]) && in_array($tokens[$last][0], [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT], true)) {
        $last--;
    }
    for ($i = 0; $i < $count; $i++) {
        $token = $tokens[$i];
        $text = is_array($token) ? $token[1] : $token;
        if ($text === '(' || $text === '[' || $text === '{' || (is_array($token) && in_array($token[0], [T_CURLY_OPEN, T_DOLLAR_OPEN_CURLY_BRACES], true))) {
            $depth++;
        } elseif ($text === ')' || $text === ']' || $text === '}') {
            $depth--;
            if ($depth === 0 && $text === '}') {
                $next = $i + 1;
                while ($next < $count && is_array($tokens[$next]) && in_array($tokens[$next][0], [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT], true)) {
                    $next++;
                }
                // `}` ends a block statement when a new statement follows it;
                // not before `;`, `->`, `(` or `else`, and not at the very end,
                // where the block itself is the last statement.
                $after = $next < $count ? (is_array($tokens[$next]) ? $tokens[$next][1] : $tokens[$next]) : '';
                if (preg_match('/^[\$A-Za-z_]/', $after) && !preg_match('/^(else|elseif|catch|finally|while)$/i', $after)) {
                    $boundary = $i + 1;
                }
            }
        } elseif ($text === ';' && $depth === 0 && $i < $last) {
            $boundary = $i + 1;
        }
    }

    $head = '';
    for ($i = 0; $i < $boundary; $i++) {
        $head .= is_array($tokens[$i]) ? $tokens[$i][1] : $tokens[$i];
    }
    $tail = '';
    for ($i = $boundary; $i < $count; $i++) {
        $token = $tokens[$i];
        if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
            $tail .= ' ';
            continue;
        }
        $tail .= is_array($token) ? $token[1] : $token;
    }
    $tail = rtrim(trim($tail), ';');
    $tail = trim($tail);
    if ($tail === '') {
        return $head;
    }
    $statement = '/^(echo|print\s|return|if|for|foreach|while|do|switch|function\s+\w|class|interface|trait|enum\s+\w|abstract|final|namespace|use|try|throw|global|static\s+\$|unset|declare|goto|const|readonly|break|continue)\b/i';
    if (preg_match($statement, $tail)) {
        return $head . $tail . ';';
    }
    return $head . "return (\n" . $tail . "\n);";
}

function zefaro_serve(): void
{
    try {
        $app = zefaro_boot();
    } catch (Throwable $e) {
        zefaro_send(['ready' => false, 'error' => zefaro_error($e)]);
        return;
    }

    $GLOBALS['zefaro_state'] = ['current' => null, 'queries' => [], 'dumps' => []];
    if (class_exists(Symfony\Component\VarDumper\VarDumper::class)) {
        Symfony\Component\VarDumper\VarDumper::setHandler(function ($value) {
            $GLOBALS['zefaro_state']['dumps'][] = zefaro_describe($value);
        });
    }
    try {
        Illuminate\Support\Facades\DB::listen(function ($query) {
            if (count($GLOBALS['zefaro_state']['queries']) >= 200) {
                return;
            }
            $bindings = [];
            foreach ($query->bindings as $binding) {
                $bindings[] = $binding instanceof DateTimeInterface ? $binding->format('Y-m-d H:i:s') : (is_scalar($binding) || $binding === null ? $binding : gettype($binding));
            }
            $GLOBALS['zefaro_state']['queries'][] = [
                'sql' => $query->sql,
                'bindings' => $bindings,
                'time' => $query->time,
                'connection' => $query->connectionName,
            ];
        });
    } catch (Throwable $e) {
    }

    // exit(), dd() and fatal errors end the process: answer the request that
    // was running so the interface can say what happened.
    register_shutdown_function(function () {
        $state = $GLOBALS['zefaro_state'];
        if ($state['current'] === null) {
            return;
        }
        $output = '';
        while (ob_get_level() > 0) {
            $output = ob_get_clean() . $output;
        }
        $fatal = error_get_last();
        $isFatal = $fatal && in_array($fatal['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true);
        zefaro_send([
            'id' => $state['current'],
            'ok' => false,
            'ended' => true,
            'error' => $isFatal ? ['class' => 'Fatal error', 'message' => $fatal['message'], 'file' => zefaro_relative($fatal['file']), 'line' => $fatal['line'], 'trace' => []] : null,
            'output' => $output,
            'dumps' => $state['dumps'],
            'queries' => $state['queries'],
        ]);
    });

    zefaro_send(['ready' => true, 'laravel' => $app->version(), 'php' => PHP_VERSION]);

    $zefaro_vars = [];
    while (($line = fgets(STDIN)) !== false) {
        $request = json_decode($line, true);
        if (!is_array($request)) {
            continue;
        }
        $id = $request['id'] ?? 0;
        $GLOBALS['zefaro_state']['current'] = $id;
        $GLOBALS['zefaro_state']['queries'] = [];
        $GLOBALS['zefaro_state']['dumps'] = [];
        $rollback = !empty($request['rollback']);
        if (function_exists('memory_reset_peak_usage')) {
            memory_reset_peak_usage();
        }
        $started = hrtime(true);
        $result = null;
        $error = null;
        $connection = null;
        ob_start();
        try {
            $code = zefaro_prepare((string) ($request['code'] ?? ''));
            if ($rollback) {
                $connection = Illuminate\Support\Facades\DB::connection();
                $connection->beginTransaction();
            }
            $result = zefaro_describe(zefaro_run($code, $zefaro_vars));
        } catch (Throwable $e) {
            $error = zefaro_error($e);
            if ($error['file'] === '' || strpos($error['file'], "eval()'d code") !== false) {
                $error['file'] = '';
            }
        } finally {
            if ($connection !== null) {
                try {
                    while ($connection->transactionLevel() > 0) {
                        $connection->rollBack();
                    }
                } catch (Throwable $e) {
                }
            }
        }
        $output = ob_get_clean();
        $GLOBALS['zefaro_state']['current'] = null;
        $vars = [];
        foreach ($zefaro_vars as $name => $value) {
            $vars[] = ['name' => $name, 'type' => is_object($value) ? get_class($value) : gettype($value)];
        }
        zefaro_send([
            'id' => $id,
            'ok' => $error === null,
            'result' => $result,
            'error' => $error,
            'output' => $output,
            'dumps' => $GLOBALS['zefaro_state']['dumps'],
            'queries' => $GLOBALS['zefaro_state']['queries'],
            'timeMs' => round((hrtime(true) - $started) / 1e6, 2),
            'memory' => memory_get_peak_usage(true),
            'rolledBack' => $rollback,
            'vars' => $vars,
        ]);
    }
}

/** Run code with the session's variables in scope and keep what it defines. */
function zefaro_run(string $zefaro_code, array &$zefaro_vars)
{
    extract($zefaro_vars, EXTR_SKIP);
    try {
        return eval($zefaro_code);
    } finally {
        $zefaro_defined = get_defined_vars();
        unset($zefaro_defined['zefaro_code'], $zefaro_defined['zefaro_vars']);
        $zefaro_vars = $zefaro_defined;
    }
}

// --------------------------------------------------------------------- main --

$mode = $argv[1] ?? '';
if ($mode === 'serve') {
    zefaro_serve();
} elseif ($mode === 'query') {
    try {
        $request = json_decode(stream_get_contents(STDIN), true) ?: [];
        zefaro_send(['ok' => true, 'data' => zefaro_query($request)]);
    } catch (Throwable $e) {
        zefaro_send(['ok' => false, 'error' => zefaro_error($e)]);
    }
} else {
    fwrite(STDERR, "usage: php laravel-runner.php query|serve\n");
    exit(2);
}
