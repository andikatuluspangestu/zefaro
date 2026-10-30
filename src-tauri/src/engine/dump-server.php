<?php
// Zefaro's dump receiver. Sites run with VAR_DUMPER_FORMAT=tcp://127.0.0.1:<port>,
// so Symfony's VarDumper (dump() and dd() in Laravel and Symfony apps) sends each
// dump here instead of printing it into the page. Each one becomes a JSON line in
// the file Zefaro's Dumps page reads.
//
//   php dump-server.php <port> <file>
//
// A dump arrives as one line: base64(serialize([Data $data, array $context])).
// Zefaro has no Symfony classes, so unserialize() leaves the objects incomplete;
// their properties are still readable, and that's all a tree needs.

const ZEFARO_MAX_FILE = 4194304;
const ZEFARO_MAX_ITEMS = 100;
const ZEFARO_MAX_DEPTH = 8;
const ZEFARO_MAX_STRING = 1000;

// Symfony\Component\VarDumper\Cloner\Stub
const ZEFARO_TYPE_REF = 1;
const ZEFARO_TYPE_STRING = 2;
const ZEFARO_TYPE_ARRAY = 3;
const ZEFARO_TYPE_OBJECT = 4;
const ZEFARO_TYPE_RESOURCE = 5;
const ZEFARO_STRING_BINARY = 1;

ini_set('display_errors', 'stderr');
error_reporting(E_ALL & ~E_DEPRECATED);

/** An incomplete object's properties by plain name (private/protected prefixes removed). */
function zefaro_props($object): array
{
    $out = [];
    foreach ((array) $object as $key => $value) {
        $key = (string) $key;
        if ($key === '__PHP_Incomplete_Class_Name') {
            continue;
        }
        $nul = strrpos($key, "\0");
        $out[$nul === false ? $key : substr($key, $nul + 1)] = $value;
    }
    return $out;
}

function zefaro_class($object): string
{
    $array = (array) $object;
    return (string) ($array['__PHP_Incomplete_Class_Name'] ?? get_class($object));
}

/** A property or array key as the tree shows it. */
function zefaro_key($key): string
{
    $key = (string) $key;
    if ($key !== '' && $key[0] === "\0") {
        // "\0*\0name" protected, "\0Class\0name" private, "\0~\0name" virtual, "\0+\0name" dynamic.
        $nul = strrpos($key, "\0");
        return substr($key, $nul + 1);
    }
    return $key;
}

function zefaro_leaf($value): array
{
    if ($value === null) {
        return ['t' => 'null'];
    }
    if (is_bool($value)) {
        return ['t' => 'bool', 'v' => $value];
    }
    if (is_int($value)) {
        return ['t' => 'int', 'v' => $value];
    }
    if (is_float($value)) {
        return ['t' => 'float', 'v' => is_finite($value) ? $value : (string) $value];
    }
    $value = (string) $value;
    return ['t' => 'string', 'v' => mb_substr($value, 0, ZEFARO_MAX_STRING), 'n' => mb_strlen($value)];
}

/** Data's compact form of an array: [cut?, class => position]. */
function zefaro_array_stub(array $item): array
{
    $class = 0;
    $position = 0;
    foreach ($item as $class => $position) {
    }
    return ['type' => ZEFARO_TYPE_ARRAY, 'class' => $class, 'position' => $position, 'cut' => $item[0] ?? 0];
}

/** One cloned value as a DumpNode (the same shape the Tinker tab shows). */
function zefaro_node($item, array $table, int $depth): array
{
    if (is_array($item)) {
        $stub = $item ? zefaro_array_stub($item) : ['type' => ZEFARO_TYPE_ARRAY, 'class' => 0, 'position' => 0, 'cut' => 0];
    } elseif (is_object($item)) {
        $stub = zefaro_props($item);
        $stub['__class'] = zefaro_class($item);
    } else {
        return zefaro_leaf($item);
    }
    if (($stub['type'] ?? null) === ZEFARO_TYPE_REF) {
        return zefaro_node($stub['value'] ?? null, $table, $depth);
    }
    switch ($stub['type'] ?? null) {
        case ZEFARO_TYPE_STRING:
            $value = (string) ($stub['value'] ?? '');
            $cut = (int) ($stub['cut'] ?? 0);
            if (($stub['class'] ?? null) === ZEFARO_STRING_BINARY) {
                return ['t' => 'binary', 'n' => strlen($value) + $cut];
            }
            return ['t' => 'string', 'v' => mb_substr($value, 0, ZEFARO_MAX_STRING), 'n' => mb_strlen($value) + $cut];
        case ZEFARO_TYPE_RESOURCE:
            return ['t' => 'resource', 'c' => (string) ($stub['class'] ?? 'resource')];
        case ZEFARO_TYPE_ARRAY:
        case ZEFARO_TYPE_OBJECT:
            $children = $table[(int) ($stub['position'] ?? 0)] ?? [];
            if (!$stub['position']) {
                $children = [];
            }
            $cut = max(0, (int) ($stub['cut'] ?? 0));
            $node = $stub['type'] === ZEFARO_TYPE_ARRAY
                ? ['t' => 'array', 'n' => count($children) + $cut]
                : ['t' => 'object', 'c' => (string) ($stub['class'] ?? 'object'), 'n' => count($children) + $cut];
            if ($depth >= ZEFARO_MAX_DEPTH) {
                $node['more'] = count($children) + $cut;
                return $node;
            }
            $node['k'] = [];
            $shown = 0;
            foreach ($children as $key => $child) {
                if ($shown++ >= ZEFARO_MAX_ITEMS) {
                    break;
                }
                $node['k'][] = ['key' => zefaro_key($key), 'value' => zefaro_node($child, $table, $depth + 1)];
            }
            $hidden = count($children) - count($node['k']) + $cut;
            if ($hidden > 0) {
                $node['more'] = $hidden;
            }
            return $node;
        default:
            // Scalars kept in a stub (constants, enums, long numbers).
            $value = $stub['value'] ?? null;
            return is_object($value) || is_array($value) ? zefaro_node($value, $table, $depth) : zefaro_leaf($value);
    }
}

function zefaro_record(string $line, string $file): void
{
    $raw = base64_decode(trim($line), true);
    if ($raw === false) {
        return;
    }
    $payload = @unserialize($raw, ['allowed_classes' => false]);
    if (!is_array($payload) || count($payload) < 2 || !is_object($payload[0])) {
        return;
    }
    [$data, $context] = $payload;
    $props = zefaro_props($data);
    $table = $props['data'] ?? [];
    $root = $table[(int) ($props['position'] ?? 0)][$props['key'] ?? 0] ?? null;
    $source = is_array($context['source'] ?? null) ? $context['source'] : [];
    // From a web request: its address, which names the site it came from.
    $request = is_array($context['request'] ?? null) ? $context['request'] : [];
    static $seq = 0;
    $entry = [
        'id' => sprintf('%.6f-%d', microtime(true), ++$seq),
        'time' => (float) ($context['timestamp'] ?? microtime(true)),
        'file' => $source['file'] ?? null,
        'line' => isset($source['line']) ? (int) $source['line'] : null,
        'name' => $source['name'] ?? null,
        'command' => $context['cli']['command_line'] ?? null,
        'uri' => is_string($request['uri'] ?? null) ? $request['uri'] : null,
        'method' => is_string($request['method'] ?? null) ? $request['method'] : null,
        'node' => zefaro_node($root, $table, 0),
    ];
    if (is_file($file) && filesize($file) > ZEFARO_MAX_FILE) {
        @rename($file, $file . '.old');
    }
    $json = json_encode($entry, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PARTIAL_OUTPUT_ON_ERROR);
    file_put_contents($file, $json . "\n", FILE_APPEND | LOCK_EX);
}

$port = (int) ($argv[1] ?? 9912);
$file = $argv[2] ?? 'dumps.jsonl';
$server = @stream_socket_server("tcp://127.0.0.1:$port", $errno, $error);
if (!$server) {
    fwrite(STDERR, "Can't listen on 127.0.0.1:$port: $error\n");
    exit(1);
}
fwrite(STDERR, "Listening on 127.0.0.1:$port\n");
$clients = [];
$buffers = [];
while (true) {
    $read = array_values($clients);
    $read[] = $server;
    $write = $except = null;
    if (@stream_select($read, $write, $except, null) === false) {
        continue;
    }
    foreach ($read as $socket) {
        if ($socket === $server) {
            $client = @stream_socket_accept($server, 0);
            if ($client) {
                stream_set_blocking($client, false);
                $clients[(int) $client] = $client;
                $buffers[(int) $client] = '';
            }
            continue;
        }
        $id = (int) $socket;
        $chunk = @fread($socket, 65536);
        if ($chunk === false || $chunk === '') {
            if (feof($socket)) {
                fclose($socket);
                unset($clients[$id], $buffers[$id]);
            }
            continue;
        }
        $buffers[$id] .= $chunk;
        while (($nl = strpos($buffers[$id], "\n")) !== false) {
            $line = substr($buffers[$id], 0, $nl);
            $buffers[$id] = substr($buffers[$id], $nl + 1);
            zefaro_record($line, $file);
        }
    }
}
