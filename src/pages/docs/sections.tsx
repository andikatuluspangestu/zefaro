// The documentation's content. Keep it in step with what the app actually
// does: versions, paths, ports and limits here mirror the Rust engine.
// The Indonesian version is in sections.id.tsx; change both together.

import type { ReactNode } from "react";
import type { PageId } from "@/App";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { C, CodeBlock, H3, List, Note, P, Rows, Steps } from "./blocks";

export type DocSection = {
  id: string;
  title: string;
  icon: string;
  /** Heading in the table of contents this section sits under. */
  group: string;
  /** One line under the section title. */
  summary: string;
  body: (go: (page: PageId) => void) => ReactNode;
};

/** Button that opens another page of the app. */
export const GoTo = ({ page, label, go }: { page: PageId; label: string; go: (p: PageId) => void }) => (
  <Button size="xs" variant="outline" className="ml-2 align-middle" onClick={() => go(page)}>
    {label}
    <Icon name="arrow-right" className="w-3" />
  </Button>
);

export const LARAVEL_ENV = `DB_CONNECTION=mariadb
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=my_app
DB_USERNAME=root
DB_PASSWORD=

REDIS_HOST=127.0.0.1
REDIS_PASSWORD=null
REDIS_PORT=6379`;

/** Questions and answers. Answers stay in the page while closed so the documentation search can find them. */
export function FaqList({ items }: { items: [string, ReactNode][] }) {
  return (
    <Accordion type="single" collapsible className="rounded-lg border px-4">
      {items.map(([q, a], i) => (
        <AccordionItem key={i} value={`q${i}`} className="[&>[data-slot=accordion-content][data-state=closed]]:hidden">
          <AccordionTrigger>{q}</AccordionTrigger>
          <AccordionContent forceMount className="leading-relaxed text-foreground/85">
            {a}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

const FAQ: [string, ReactNode][] = [
  [
    "Is Zefaro really free?",
    <>Yes, every feature: several PHP versions side by side, HTTPS, MariaDB, PostgreSQL, Redis, phpMyAdmin,
    Mailpit, Node.js, a log viewer and local DNS. There is no paid tier.</>,
  ],
  [
    "Does Zefaro include AI or cloud features?",
    <>No, by design. Zefaro is a local development environment and nothing more.</>,
  ],
  [
    "Does Zefaro send any data anywhere?",
    <>Zefaro has no accounts and sends no analytics. It goes online only to check for new versions
    and to download the software listed on the About page, from each project's official source.</>,
  ],
  [
    "Will Zefaro interfere with PHP or Composer I already have?",
    <>No. Everything lives in <C>%USERPROFILE%\.config\zefaro</C>, and Composer uses Zefaro's own
    <C>COMPOSER_HOME</C>. The only shared setting is your PATH, and Zefaro changes it only when you
    click <em>Add to PATH</em>. After that, Zefaro's folder comes first, so <C>php</C> runs Zefaro's
    active PHP.</>,
  ],
  [
    "Why does phpMyAdmin need PHP 8.3 or older?",
    <>phpMyAdmin 5.2.3 officially supports PHP 7.2 to 8.3. Zefaro runs it on the newest installed
    version in that range, so you can still use PHP 8.4 or 8.5 for your own sites.</>,
  ],
  [
    "Why does the DNS setup ask for administrator rights?",
    <>Sending <C>.test</C> lookups to Zefaro is a Windows system setting. You approve it once;
    after that, Zefaro's DNS server runs as a normal program.</>,
  ],
  [
    "Is trusting Zefaro's certificate a security risk?",
    <>The risk is small. Zefaro's certificate authority can only sign for <C>.test</C> names, and
    browsers enforce that, so nobody can use it to impersonate a real website. Its key is
    encrypted for your Windows account, and you can remove it in Settings, under HTTPS.</>,
  ],
  [
    "Where are my databases stored?",
    <>In <C>%USERPROFILE%\.config\zefaro\data\mariadb</C>. To keep a copy, stop MariaDB and back
    up that folder, or export each database from the Databases page.</>,
  ],
  [
    "Can other computers on my network open my sites?",
    <>No. nginx, PHP, MariaDB, PostgreSQL, Redis, Mailpit and the DNS server all listen on{" "}
    <C>127.0.0.1</C> only.</>,
  ],
];

export const SECTIONS: DocSection[] = [
  {
    id: "getting-started",
    title: "Getting started",
    icon: "rocket",
    group: "Start here",
    summary: "From a fresh install to a site running at name.test.",
    body: (go) => (
      <>
        <P>
          Zefaro serves PHP projects from folders on your computer at addresses such as{" "}
          <C>http://my-app.test</C>. Five steps take you from a fresh install to a running site.
        </P>
        <Steps
          items={[
            <>
              <strong>Install PHP.</strong> On the Services page, click <em>Install PHP</em>, pick
              a version and click <em>Install</em>. The first version you install becomes the
              active one.
              <GoTo page="services" label="Open Services" go={go} />
            </>,
            <>
              <strong>Start the core services</strong> with <em>Start all</em>: nginx (the web
              server), PHP and DNS. Zefaro downloads nginx the first time (about 3 MB).
            </>,
            <>
              <strong>Set up DNS once.</strong> Click <em>Start</em> on the DNS card. The first
              time, Zefaro opens the DNS settings instead: click <em>Set up rule</em> and approve
              the Windows prompt. From then on, every <C>*.test</C> name points to Zefaro.
            </>,
            <>
              <strong>Link a project folder</strong> on the Sites page.
              <GoTo page="sites" label="Open Sites" go={go} />
            </>,
            <>
              <strong>Open the site</strong> at <C>http://&lt;folder-name&gt;.test</C>.
            </>,
          ]}
        />
        <P>
          The Home page keeps count. While your first site isn't running yet, it lists these
          steps and ticks the ones that are done. Afterwards it shows what is running, your
          sites, and anything that needs attention, such as a service that failed to start.
          <GoTo page="home" label="Open Home" go={go} />
        </P>
        <H3>Light and dark</H3>
        <P>
          Zefaro follows the Windows theme by default and switches when Windows does. To pick
          one yourself, open <em>Settings</em>, then <em>Appearance</em>, and choose light or
          dark.
        </P>
        <H3>Requirements</H3>
        <List
          items={[
            "Windows 10 or 11, 64-bit.",
            "Microsoft Edge WebView2 Runtime (included with Windows 11 and Microsoft Edge).",
            <>
              Microsoft Visual C++ Redistributable (x64), which PHP needs. If it's missing, Zefaro
              tells you after installing PHP and links to the download.
            </>,
            "An internet connection while Zefaro downloads software. Everything runs offline afterwards.",
          ]}
        />
      </>
    ),
  },
  {
    id: "install",
    title: "Install and uninstall",
    icon: "download",
    group: "Start here",
    summary: "What the installer and uninstaller change on Windows.",
    body: () => (
      <>
        <H3>Installing</H3>
        <P>
          Run <C>Zefaro_&lt;version&gt;_x64-setup.exe</C>. Zefaro installs for your Windows account
          only, so it needs no administrator rights. The installer puts it in{" "}
          <C>%LOCALAPPDATA%\Zefaro</C> and adds a Start menu shortcut, plus a desktop shortcut if
          you leave that box ticked on the last page. If the Microsoft Edge WebView2 Runtime is
          missing, the installer downloads it.
        </P>
        <Note title="Windows protected your PC" warn>
          The installer isn't code-signed yet, so SmartScreen may warn about an unrecognised app.
          Click <em>More info</em>, then <em>Run anyway</em>.
        </Note>
        <H3>Updating</H3>
        <P>
          Run the newer installer over the old one. Your sites, settings, databases, PATH entry
          and DNS rule stay as they are.
        </P>
        <H3>Uninstalling</H3>
        <P>
          Open <em>Settings, Apps, Installed apps</em> in Windows, find Zefaro and choose{" "}
          <em>Uninstall</em>. Besides the app itself, the uninstaller removes what Zefaro added to
          Windows:
        </P>
        <List
          items={[
            <>Zefaro's <C>bin</C> folder from your PATH.</>,
            <>
              The DNS rule for <C>.test</C>. Windows asks for administrator rights; if you decline,
              the rule stays and you can remove it later.
            </>,
            <>Zefaro's HTTPS certificate authority, if you trusted it. Windows asks you to confirm.</>,
          ]}
        />
        <P>
          The uninstaller keeps your sites, settings and databases in{" "}
          <C>%USERPROFILE%\.config\zefaro</C>, so a reinstall picks up where you left off. Delete
          that folder to remove everything, including your databases. The uninstaller's{" "}
          <em>Delete the application data</em> box only clears the app window's own browser
          data.
        </P>
      </>
    ),
  },
  {
    id: "sites",
    title: "Sites",
    icon: "globe",
    group: "Sites and runtimes",
    summary: "Linked folders, their addresses and HTTPS.",
    body: (go) => (
      <>
        <P>
          A site is a folder Zefaro serves at <C>&lt;name&gt;.test</C>. Click <em>Link folder</em>{" "}
          and choose your project. Zefaro recognises what the folder holds (Laravel, Symfony,
          WordPress, Drupal, Craft, Magento and others) and shows its icon next to the name. When
          a project's <C>APP_URL</C> still points at <C>localhost</C> or an old <C>.test</C>{" "}
          address, linking it or turning HTTPS on or off updates it; a real domain is left alone.
          <GoTo page="sites" label="Open Sites" go={go} />
        </P>
        <Rows
          rows={[
            [
              "Name",
              <>
                The folder name in lowercase, with anything other than letters and digits turned
                into hyphens: <C>My App_v2</C> becomes <C>my-app-v2.test</C>. Subdomains such as{" "}
                <C>api.my-app.test</C> reach the same site.
              </>,
            ],
            [
              "Document root",
              <>
                The folder's <C>public</C> subfolder if it has one (Laravel, Symfony and most
                frameworks), otherwise the folder itself.
              </>,
            ],
            [
              "Routing",
              <>
                Requests for files that don't exist go to <C>index.php</C>, so framework routes and
                pretty URLs work.
              </>,
            ],
            [
              "PHP version",
              <>
                The version that was active when you linked the site. If it's no longer installed,
                the site uses the active version.
              </>,
            ],
            ["Unlink", "Zefaro stops serving the site. Your files are never touched."],
          ]}
        />
        <H3>New site</H3>
        <P>
          <em>New site</em> makes a Laravel app with the Laravel installer and serves it right
          away. Choose a name (lowercase letters, digits and hyphens; it becomes the folder and{" "}
          <C>&lt;name&gt;.test</C>), the folder to make it in, and the PHP version.
        </P>
        <Rows
          rows={[
            [
              "Starter kit",
              <>
                Plain Laravel, or the official React, Vue, Livewire and Svelte kits, with or without
                login pages and teams. <em>Community</em> takes any kit's Composer package.
              </>,
            ],
            [
              "Database",
              <>
                SQLite (a file in the project) or Zefaro's MariaDB, where Zefaro creates a database
                named after the site (<C>my-app</C> becomes <C>my_app</C>) and migrates it.
              </>,
            ],
            [
              "Options",
              <>
                Pest or PHPUnit, building the front end with Zefaro's Node.js, a Git repository,
                HTTPS, and sending mail to Mailpit.
              </>,
            ],
          ]}
        />
        <P>
          Zefaro then links the folder with the chosen PHP version and sets <C>APP_URL</C>, and the
          mail and database values in <C>.env</C>. The installer needs Composer and the Laravel
          installer; the wizard offers to install both. Laravel Boost, which sets up AI coding
          tools, is never installed.
        </P>
        <H3>HTTPS</H3>
        <P>
          Click <em>Secure</em> on a site to serve it at <C>https://&lt;name&gt;.test</C>. Zefaro
          signs a certificate for the site and its subdomains, and plain <C>http://</C> then
          redirects to HTTPS. Click <em>Secured</em> to turn it off again.
        </P>
        <P>
          The certificates come from Zefaro's own certificate authority (CA), which Zefaro creates the
          first time you secure a site. Browsers accept them once you trust that CA, which you do
          once:
        </P>
        <Steps
          items={[
            <>
              Click <em>Trust certificate…</em> on the Sites page or in Settings, under HTTPS.
            </>,
            <>
              Windows shows a security warning about installing a certificate. Check that it
              names <em>Zefaro Local CA (.test)</em> and that its thumbprint matches the one in
              Settings, then choose <em>Yes</em>.
            </>,
            <>Restart your browser if it was open.</>,
          ]}
        />
        <Note title="Why the CA is safe to trust">
          Zefaro's CA can only sign for <C>.test</C> names. Browsers reject anything it signs for a
          real website or an IP address, even if someone stole its key. The key is encrypted for
          your Windows account and never leaves this computer. Windows trusts the CA for your
          account only, and you can remove it at any time in Settings. Uninstalling Zefaro removes
          it too.
        </Note>
        <List
          items={[
            <>
              <strong>Firefox</strong> uses the certificates Windows trusts by default. If it
              still warns, set <C>security.enterprise_roots.enabled</C> to <C>true</C> in{" "}
              <C>about:config</C>.
            </>,
            <>
              <strong>curl</strong> built into Windows needs <C>--ssl-no-revoke</C> for{" "}
              <C>.test</C> sites, because a local CA publishes no revocation list.
            </>,
            <>
              <strong>PHP calling another secured site</strong> (with Guzzle or Laravel's HTTP
              client, for example) works: the certificate list Zefaro gives PHP includes Zefaro's CA.
              It's the list Mozilla publishes, which Zefaro downloads again every 30 days; the PHP
              page shows when, and can update it now.
            </>,
          ]}
        />
      </>
    ),
  },
  {
    id: "site-tools",
    title: "Site tools",
    icon: "screwdriver-wrench",
    group: "Sites and runtimes",
    summary: "Look inside a Laravel app: data, config, Tinker, Artisan and workers.",
    body: (go) => (
      <>
        <P>
          Click a site's name on the Sites page, or the wrench next to it, to open its page. Under
          its name, <em>Open in</em> lists the editors, terminals and database tools Zefaro found on
          this computer (VS Code, PhpStorm, Cursor, Zed, Sublime Text, Windows Terminal, Git
          Bash, HeidiSQL, phpMyAdmin and others) and opens the site's folder or database in them.
          Terminals start in the site's folder with its PHP version first on the path. The
          tools need a Laravel project (a folder with an <C>artisan</C> file) whose dependencies
          are installed. If <C>vendor</C> is missing, the page offers to run{" "}
          <C>composer install</C>. Everything runs with the site's PHP version, or the active one
          if the site's isn't installed.
          <GoTo page="sites" label="Open Sites" go={go} />
        </P>
        <Rows
          rows={[
            [
              "Overview",
              <>
                Laravel and PHP versions, environment, the drivers in use and the app's state. It
                warns about common problems and fixes each with a button: a missing app key, an
                unreachable database (with a button to start MariaDB), pending migrations, mail
                that doesn't reach Mailpit, a missing storage link, debug mode in production, a
                cached config, and a queue with no worker.
              </>,
            ],
            [
              "Data",
              <>
                Tables of the app's database. Browse, search, sort and filter them. The tab is
                read-only until you turn on <em>Allow changes</em>, which lets you double-click a
                cell to edit it and delete rows. Zefaro warns when the app runs in production or
                its database isn't on this computer. Columns the model hides, and anything named
                like a password or token, show as dots until you click the eye. <em>Same in code</em>{" "}
                copies the query on screen as Eloquent code, and <em>Open in Tinker</em> puts it
                in Tinker.
              </>,
            ],
            [
              "Configuration",
              <>
                The <C>.env</C> file as an editor, the values the app sees after merging its
                config files (click one to copy its <C>config()</C> call), and every route.
                Saving a value writes <C>.env</C>, ends the Tinker session so the next run reads
                it, and clears a cached config.
              </>,
            ],
            [
              "Logs",
              <>
                The app's own logs in <C>storage/logs</C>, newest first. Filter by level, search,
                open an entry to see its context and stack trace, follow new entries as they're
                written, or clear the file.
              </>,
            ],
            [
              "Tinker",
              <>
                Write PHP and press <em>Ctrl+Enter</em>. The last expression is shown as a tree
                you can expand: models, collections, dates and plain arrays. The session stays
                alive between runs, so variables you set are still there until you press{" "}
                <em>Reset session</em>. Each run also shows what it printed, <C>dump()</C> output,
                errors with file and line, the SQL queries it ran with their timing, and memory
                use. The up arrow brings back earlier code.
              </>,
            ],
            [
              "Artisan",
              <>
                Every command the app has, grouped by name. Zefaro builds a form from the
                command's arguments and options, shows the exact command it will run, and streams
                the output. Commands that delete data (<C>migrate:fresh</C>,{" "}
                <C>migrate:reset</C>, <C>db:wipe</C> and similar) and <C>key:generate</C> ask first,
                and in production so does every <C>migrate</C> and <C>db</C> command.
              </>,
            ],
            [
              "Workers",
              <>
                Commands Zefaro keeps running for the site and restarts if they crash: a queue
                worker, the scheduler, Vite, Reverb or Horizon, or any command you write. Each can
                start when Zefaro starts. Their output goes to the Logs page, under Workers.
              </>,
            ],
          ]}
        />
        <H3>Good to know</H3>
        <List
          items={[
            <>
              <strong>Undo database changes after each run</strong> in Tinker wraps the run in a
              transaction and rolls it back, so you can try writes safely. It can't undo schema
              changes in MariaDB, which commits them as it goes.
            </>,
            <>
              <strong>exit() and dd()</strong> end the PHP process. Zefaro says so and starts a new
              session on the next run, so earlier variables are gone. Code that runs longer than
              ten minutes is stopped.
            </>,
            <>
              <strong>Artisan runs without prompts</strong> (<C>--no-interaction</C>), so a
              command that asks questions uses its defaults. Commands that never end, such as{" "}
              <C>serve</C> and <C>queue:work</C>, are left out of the list: use Workers for them.
            </>,
            <>
              <strong>A worker starting with <C>php</C></strong> uses the site's PHP. Anything
              else, such as <C>npm run dev</C>, runs in a Windows command prompt in the site's
              folder, with Zefaro's Node.js first on the path.
            </>,
          ]}
        />
        <Note title="These tools run the app's code">
          Tinker, Artisan and workers run PHP from the project with your Windows account's
          permissions, like running the commands in a terminal yourself. Open them only for
          projects you trust.
        </Note>
      </>
    ),
  },
  {
    id: "php",
    title: "PHP",
    icon: "php",
    group: "Sites and runtimes",
    summary: "Versions, per-version settings, Composer and the command line.",
    body: () => (
      <>
        <P>
          PHP lives on the Services page. The gear on any PHP card, or <em>Install PHP</em> while
          none is installed, opens the <strong>PHP versions</strong> list.
        </P>
        <H3>Versions</H3>
        <P>
          Zefaro installs the official Windows builds of PHP 7.4 to 8.5 from{" "}
          <C>downloads.php.net</C> and checks every download against its published SHA-256.
          Install as many versions as you like. <em>Activate</em> picks the version the command
          line and new sites use. <em>Update to x.y.z</em> appears when a newer patch release is
          out.
        </P>
        <H3>Settings</H3>
        <P>
          Each version has its own settings page: click the gear in its <em>Options</em> column.
          When you save, Zefaro rewrites that version's <C>php.ini</C> and restarts its PHP process,
          so the change applies at once. Other versions keep their own limits. The page also shows
          the version's <C>php.ini</C> and opens its folder.
        </P>
        <Rows
          rows={[
            ["Max file upload size", <>1 to 4096 MB. Zefaro sets <C>post_max_size</C> to match (never below 8 MB).</>],
            ["Memory limit", <>16 to 16384 MB, or <C>-1</C> for no limit.</>],
            ["Max input vars", "100 to 1,000,000 form fields and query parameters per request."],
          ]}
        />
        <H3>Your own php.ini changes</H3>
        <P>
          Each version's settings live in{" "}
          <C>%USERPROFILE%\.config\zefaro\bin\php\&lt;version&gt;\php.ini</C>. Zefaro only rewrites
          the part below the line <C>; ---- Managed by Zefaro …</C>, so anything you edit above it
          survives updates.
        </P>
        <H3>Extensions</H3>
        <P>
          A version's settings page lists every extension its build ships, each with a switch.
          These are on by default: bz2, curl, exif, fileinfo, gd, gettext, intl, mbstring,
          mysqli, openssl, pdo_mysql, pdo_pgsql, pdo_sqlite, pgsql, sodium, sqlite3, xsl, zip
          and OPcache. Turn others on as your project needs them, then click{" "}
          <em>Save changes</em>: Zefaro writes them to that version's <C>php.ini</C> and restarts
          its PHP.
        </P>
        <List
          items={[
            <>
              After saving, Zefaro runs PHP to check each extension loads. One that can't shows the
              reason, often a DLL from another product that isn't installed (Oracle Instant
              Client for <C>oci8</C>, for example).
            </>,
            <>
              An extension your own lines above the marker load stays as you set it; change it in{" "}
              <C>php.ini</C>.
            </>,
            <>
              To add an extension the build doesn't ship (such as Xdebug), put its DLL in the
              version's <C>ext</C> folder. It then appears in the list.
            </>,
          ]}
        />
        <H3>Base port</H3>
        <P>
          Every installed version runs its own FastCGI listener on <em>base port + version</em>.
          With the default base of 9000, PHP 8.3 uses 9083 and PHP 8.5 uses 9085. The base port
          appears on every version's settings page, but all versions share it. Change it only if
          those ports clash with another program (allowed range 1024 to 65000).
        </P>
        <H3>Composer and the Laravel installer</H3>
        <P>
          Install both from the PHP versions list. They run with the active PHP version and keep
          their files in Zefaro's own Composer folder, separate from any Composer you already have.
          The Laravel installer needs PHP 8.2 or newer.
        </P>
        <H3>php, composer and laravel in a terminal</H3>
        <P>
          Click <em>Add to PATH</em> on the <em>Command line (PATH)</em> card in the PHP versions
          list, then open a new terminal:
        </P>
        <CodeBlock label="Terminal" code={"php -v\ncomposer --version\nlaravel new my-app"} />
      </>
    ),
  },
  {
    id: "node",
    title: "Node.js",
    icon: "node-js",
    group: "Sites and runtimes",
    summary: "Install Node.js versions and pick the active one.",
    body: () => (
      <>
        <P>
          Node.js has a card under <em>Services, Core</em>. It isn't a background service, so
          there is nothing to start. <em>Manage versions</em> (or the gear) opens the{" "}
          <strong>Node.js versions</strong> list.
        </P>
        <List
          items={[
            <>
              Zefaro offers the <strong>Current</strong> line and every <strong>LTS</strong> line
              that still gets updates, as official Windows builds from <C>nodejs.org</C>. Zefaro
              checks each download against the SHA-256 that nodejs.org publishes.
            </>,
            <>
              Install as many as you like. <em>Activate</em> picks the version that <C>node</C>,{" "}
              <C>npm</C>, <C>npx</C> and <C>corepack</C> run, and the first one you install
              becomes active. <em>Update</em> appears when a line has a newer release.
            </>,
            <>
              The bin icon uninstalls a version. Packages you installed with{" "}
              <C>npm install -g</C> live in <C>%APPDATA%\npm</C> and stay.
            </>,
          ]}
        />
        <P>
          After <em>Add to PATH</em> (the same folder as PHP's commands), use them in a terminal:
        </P>
        <CodeBlock label="Terminal" code={"node -v\nnpm install\nnpm run dev"} />
      </>
    ),
  },
  {
    id: "services",
    title: "Services",
    icon: "server",
    group: "Services",
    summary: "The background programs Zefaro runs, and nginx's settings.",
    body: (go) => (
      <>
        <P>
          Zefaro runs these programs in the background. All of them listen on 127.0.0.1 only.
          <GoTo page="services" label="Open Services" go={go} />
        </P>
        <Rows
          rows={[
            ["nginx  ·  port 80", "The web server in front of every site."],
            ["PHP x.y  ·  9000 + version", "One FastCGI listener per installed PHP version."],
            ["DNS  ·  port 53 (UDP)", <>Answers <C>*.test</C> lookups with this computer.</>],
            ["MariaDB  ·  port 3306", "MySQL-compatible database server."],
            ["Redis  ·  port 6379", "Cache, queues and sessions."],
            ["phpMyAdmin", <>Database GUI at <C>http://phpmyadmin.test</C>.</>],
            ["Mailpit  ·  1025 and 8025", "Catches outgoing mail (SMTP on 1025, web UI on 8025)."],
          ]}
        />
        <H3>Status</H3>
        <Rows
          rows={[
            ["Running", "The service answers on its port."],
            ["Starting", "The process is up but not answering yet."],
            ["Error", <>The service failed and the card shows why. Click <em>Try again</em>.</>],
            ["Stopped", "The service isn't running."],
          ]}
        />
        <P>
          If a service crashes, Zefaro restarts it. After three crashes within a minute, Zefaro leaves
          it stopped and shows the error.
        </P>
        <H3>Closing the window</H3>
        <P>
          The close button hides Zefaro in the system tray, and your services keep running. Click
          Zefaro's tray icon to open it again. To stop everything, right-click the icon and choose{" "}
          <em>Quit Zefaro and stop services</em>: Zefaro stops every service in order, the web server
          first and databases last. The first time you close the window, Zefaro asks which you
          prefer; change it later in Settings, under <em>Closing the window</em>.
        </P>
        <P>
          Only one Zefaro runs at a time. Opening it again from the Start menu shows the window
          that's already running.
        </P>
        <H3>nginx settings</H3>
        <P>
          The gear on the nginx card opens its settings. When you save, Zefaro checks the new
          configuration with nginx first and discards anything that fails. A running nginx
          reloads, or restarts if a port changed.
        </P>
        <List
          items={[
            <>
              <strong>HTTP and HTTPS ports</strong> (80 and 443). Each field shows whether the port
              is free or which program holds it. With other ports, sites open at addresses such as{" "}
              <C>http://name.test:8080</C> and <C>https://name.test:8443</C>.
            </>,
            <>
              <strong>PHP timeout</strong> (300 s). Raise it while you step through code with
              Xdebug.
            </>,
            <>
              <strong>Max request size</strong> (no limit by default; PHP's upload limit still
              applies).
            </>,
            <>
              <strong>Workers</strong>, <strong>keep-alive</strong>, <strong>gzip</strong>,{" "}
              <strong>HTTP/2</strong>, the <strong>access log</strong> and the{" "}
              <strong>error log level</strong>.
            </>,
            <>
              <strong>Extra directives</strong> for nginx's <C>http {"{ }"}</C> block, and a
              read-only view of the generated <C>nginx.conf</C>.
            </>,
          ]}
        />
        <P>
          In a terminal, <C>nginx -t</C> checks Zefaro's generated configuration, <C>nginx -T</C>{" "}
          prints it, <C>nginx -v</C> shows the version and <C>nginx -s reload</C> reloads it. You
          start and stop nginx on the Services page, so a second copy can't take its ports.
        </P>
        <P>When a service misbehaves, its log usually says why. Open the Logs page to read it.</P>
      </>
    ),
  },
  {
    id: "dns",
    title: "DNS (.test)",
    icon: "shield-halved",
    group: "Services",
    summary: "How .test names reach Zefaro, and what to check when they don't.",
    body: () => (
      <>
        <P>
          Zefaro runs a small DNS server that answers every name ending in <C>.test</C> with{" "}
          <C>127.0.0.1</C>. A Windows rule sends only <C>.test</C> lookups to it, so every other
          website resolves as before. New sites and subdomains work straight away, with no hosts
          file to edit.
        </P>
        <Steps
          items={[
            <>
              On the Services page, click <em>Start</em> on the <strong>DNS</strong> card. Until
              Windows sends <C>.test</C> lookups to Zefaro, this opens the DNS settings.
            </>,
            <>Click <em>Set up rule</em> and approve the Windows prompt.</>,
            <>Zefaro starts DNS and tells you when Windows resolves <C>.test</C> names through it.</>,
          ]}
        />
        <P>
          <em>Remove rule</em> in the DNS settings deletes the Windows rule again. Windows asks for
          administrator rights for that too.
        </P>
        <H3>DNS settings</H3>
        <P>The gear on the DNS card opens its settings:</P>
        <Rows
          rows={[
            ["Status", <>The DNS server and the Windows rule, with <em>Set up</em> and <em>Remove rule</em>.</>],
            ["Resolution test", "Looks up a name through Zefaro's server and through Windows, and says which part isn't working."],
            ["Flush cache", "Empties the Windows DNS cache. No administrator rights needed."],
            [
              "Local domain",
              <>
                <C>.test</C> (default) or <C>.internal</C>. Both are reserved, so neither hides a
                real website. Switching renames every site (for example to{" "}
                <C>my-app.internal</C>), moves the Windows rule (one admin prompt) and gives
                secured sites certificates from a new authority, which you trust again.
              </>,
            ],
          ]}
        />
        <Note title="If .test names don't open" warn>
          A VPN can take over DNS, and a browser's own secure DNS with a custom provider bypasses
          Windows. Disconnect the VPN or set the browser's secure DNS to use your current
          provider, then try again.
        </Note>
        <CodeBlock label="PowerShell: check resolution" code={"Resolve-DnsName my-app.test"} />
      </>
    ),
  },
  {
    id: "databases",
    title: "Databases",
    icon: "database",
    group: "Services",
    summary: "MariaDB, PostgreSQL, Redis, phpMyAdmin, and export and import of large dumps.",
    body: () => (
      <>
        <H3>MariaDB</H3>
        <P>
          MariaDB 11.8 LTS listens on <C>127.0.0.1:3306</C> with user <C>root</C> and no
          password, which is what a new Laravel app expects. The first start downloads it (93 MB)
          and creates the data folder. Zefaro shuts it down cleanly when you stop it or quit Zefaro.
        </P>
        <H3>PostgreSQL</H3>
        <P>
          PostgreSQL 18 listens on <C>127.0.0.1:5432</C> with user <C>root</C> and no password,
          the login a Laravel <C>.env</C> starts with. Set <C>DB_CONNECTION=pgsql</C> and{" "}
          <C>DB_PORT=5432</C>. The first start downloads it (328 MB, of which Zefaro keeps the server
          and its tools, without pgAdmin) and creates the data folder, in UTF-8 with the C locale.
          Zefaro stops it with a fast shutdown, so the next start needs no recovery. In a terminal,{" "}
          <C>psql</C>, <C>pg_dump</C>, <C>pg_restore</C>, <C>createdb</C> and <C>dropdb</C> connect to
          it without options. The <strong>New site</strong> wizard can create an app on it, and the
          site page's Data tab and Tinker work with it as with MariaDB.
        </P>
        <H3>Redis</H3>
        <P>
          Redis 8 listens on <C>127.0.0.1:6379</C> without a password and saves its data to disk,
          so the data survives restarts.
        </P>
        <H3>phpMyAdmin</H3>
        <P>
          Open <C>http://phpmyadmin.test</C>. phpMyAdmin signs you in as root. Starting
          phpMyAdmin also starts MariaDB, PHP and nginx; stopping it only takes the phpMyAdmin
          site offline.
        </P>
        <H3>Export and import of any size</H3>
        <P>
          The gear on the MariaDB card opens the <strong>Databases</strong> page. It lists every
          database with its size, with <em>New database</em>, <em>Export</em>, <em>Import dump…</em>{" "}
          and <em>Drop</em>. Zefaro streams data between MariaDB and the file, so dumps of 5 GB or
          more work without running out of memory. Uploading them to phpMyAdmin doesn't.
        </P>
        <List
          items={[
            <>
              <strong>Export</strong> writes <C>.sql.gz</C> (recommended, usually much smaller) or
              plain <C>.sql</C>, including views, routines, triggers and events. Zefaro reads a
              consistent snapshot, so your app can keep using the database while it runs.
            </>,
            <>
              <strong>Import</strong> takes <C>.sql</C> or gzipped dumps from Zefaro,
              mariadb-dump, mysqldump or phpMyAdmin. It loads them into a new database, or
              replaces an existing one after Zefaro asks you. Zefaro skips foreign-key and unique
              checks while loading, which makes big imports much faster.
            </>,
            <>
              <strong>Dumps of several databases</strong> (made with{" "}
              <C>mysqldump --all-databases</C> or <C>--databases</C>, as Laragon's backups are)
              hold one section per database. Zefaro reads the file first and lists them; you pick
              one, and only that section loads, into the database you named. Zefaro never imports
              MariaDB's own system databases such as <C>mysql</C>.
            </>,
            <>
              Zefaro never runs a dump's <C>CREATE DATABASE</C>, <C>USE</C> or{" "}
              <C>SET GLOBAL</C> lines, so an import can't write outside the database you chose or
              change server-wide settings.
            </>,
            <>
              Dumps from MySQL 8 import as they are: Zefaro's MariaDB 11.8 knows MySQL 8's
              collations, such as <C>utf8mb4_0900_ai_ci</C>.
            </>,
            <>
              A progress bar shows size, speed and time left. You can leave the page and come
              back, or click <em>Cancel</em>; a cancelled export leaves no half-written file. If
              MariaDB rejects a statement, Zefaro shows MariaDB's own message with the line number.
            </>,
            <>
              The time depends mostly on your disk: an SSD imports several times faster than a
              hard drive. A database usually takes more disk space than its dump because of its
              indexes.
            </>,
          ]}
        />
        <Note title="Tuned for big dumps">
          Zefaro's MariaDB accepts packets up to 1 GB (large rows and long INSERTs) and flushes its
          log to disk about once a second instead of at every commit. Imports run much faster as
          a result. A power cut could lose the last second of writes: fine for local development,
          not a setting for a production server.
        </Note>
        <H3>From a terminal</H3>
        <P>
          With Zefaro's folder on PATH (<em>Add to PATH</em>), the MariaDB tools <C>mariadb</C>,{" "}
          <C>mysql</C>, <C>mariadb-dump</C>, <C>mysqldump</C> and <C>mariadb-admin</C> connect to
          Zefaro's MariaDB as root by default, and <C>redis-cli</C> connects to Zefaro's Redis.
          Options you add yourself (such as <C>-u</C> or <C>-h</C>) take precedence.
        </P>
        <CodeBlock
          label="Terminal"
          code={"mariadb -e \"CREATE DATABASE my_app\"\nmariadb-dump my_app > my_app.sql\nredis-cli ping"}
        />
        <H3>Laravel .env</H3>
        <CodeBlock label=".env" code={LARAVEL_ENV} />
        <P>
          On Laravel 10 or older, use <C>DB_CONNECTION=mysql</C>.
        </P>
        <Note title="Local development only">
          A root account without a password is fine here because MariaDB only accepts connections
          from this computer. Never copy this setup to a server.
        </Note>
      </>
    ),
  },
  {
    id: "mail",
    title: "Mail",
    icon: "envelope",
    group: "Services",
    summary: "Catch outgoing email with Mailpit and read it in Zefaro.",
    body: (go) => (
      <>
        <P>
          Zefaro runs <strong>Mailpit</strong>, a mail catcher. Every email your apps send lands on
          Zefaro's Mail page instead of a real inbox, so password resets, invoices and newsletters
          never reach real people while you develop.
          <GoTo page="mail" label="Open Mail" go={go} />
        </P>
        <Steps
          items={[
            <>
              Start <strong>Mailpit</strong> on the Services page, or click{" "}
              <em>Install and start Mailpit</em> on the Mail page. Zefaro downloads Mailpit the
              first time (about 11 MB).
            </>,
            <>
              Point your app at SMTP host <C>127.0.0.1</C>, port <C>1025</C>. Mailpit accepts any
              username and password, without encryption.
            </>,
            <>Send an email. It shows up on the Mail page within a few seconds.</>,
          ]}
        />
        <CodeBlock
          label="Laravel .env"
          code={"MAIL_MAILER=smtp\nMAIL_HOST=127.0.0.1\nMAIL_PORT=1025\nMAIL_USERNAME=null\nMAIL_PASSWORD=null\nMAIL_ENCRYPTION=null"}
        />
        <P>
          PHP's own <C>mail()</C> works without any setup: Zefaro points <C>SMTP</C> and{" "}
          <C>smtp_port</C> in every version's <C>php.ini</C> at Mailpit.
        </P>
        <H3>The Mail page</H3>
        <List
          items={[
            <>
              The inbox sits on the left (unread messages in bold) and the selected message on the
              right. New mail appears without a refresh, and the sidebar shows the unread count.
            </>,
            <>
              Search with Mailpit's syntax, for example <C>from:shop</C>, <C>subject:"order"</C>,{" "}
              <C>is:unread</C> or <C>has:attachment</C>.
            </>,
            <>
              Tabs show the HTML, plain text, headers and full source. The HTML preview runs no
              scripts. Zefaro lists the email's links above it and opens them in your browser, which
              helps with password-reset and verification links. Attachments open or save with one
              click.
            </>,
            <>
              <em>Mark as unread</em>, <em>Delete message</em>, <em>Mark all read</em> and{" "}
              <em>Delete all</em> manage the inbox. <em>Open Mailpit</em> shows Mailpit's own
              interface (also at <C>http://mailpit.test</C>), with HTML compatibility, link and
              spam checks.
            </>,
          ]}
        />
        <H3>Settings</H3>
        <P>
          The gear on the Mailpit card, or on the Mail page, sets the SMTP port (1025), the web UI
          port (8025), how many messages to keep (1,000) and an optional maximum age. Mailpit
          stores mail in <C>%USERPROFILE%\.config\zefaro\data\mailpit</C>, so it survives restarts.
          Both ports listen on <C>127.0.0.1</C> only, and Mailpit never delivers mail anywhere.
        </P>
      </>
    ),
  },
  {
    id: "logs",
    title: "Logs",
    icon: "file-lines",
    group: "Reference",
    summary: "Read, filter and search each service's log.",
    body: (go) => (
      <>
        <P>
          The Logs page shows what each service writes, read straight from its log file in{" "}
          <C>%USERPROFILE%\.config\zefaro\logs</C>.
          <GoTo page="logs" label="Open Logs" go={go} />
        </P>
        <Rows
          rows={[
            ["Web server errors", <>nginx errors, plus PHP errors and warnings from your sites (<C>nginx-error.log</C>).</>],
            ["Requests", <>Every request with its method, path, status, site, size and time (<C>nginx-access.log</C>).</>],
            ["PHP <version>", <>What php-cgi itself prints, such as startup problems (<C>php-&lt;version&gt;.log</C>).</>],
            ["MariaDB, PostgreSQL, Redis", <>The database servers (<C>mariadb.log</C>, <C>postgresql.log</C>, <C>redis.log</C>).</>],
            ["DNS, nginx output", <>Zefaro's <C>.test</C> name server and nginx's console (<C>dns.log</C>, <C>nginx-stdout.log</C>).</>],
          ]}
        />
        <List
          items={[
            <>
              <strong>Live</strong> follows the file as it grows and keeps the newest line in
              view. Scroll up to read, then click <em>Scroll to newest</em> to come back.{" "}
              <em>Paused</em> stops the updates.
            </>,
            <>
              Filter by <em>Warnings</em> or <em>Errors</em>, or search. Click a line to see it
              exactly as the service wrote it, and copy it.
            </>,
            <>
              The page shows the last 1,000 lines. <em>Open logs folder</em> shows every file in
              File Explorer. The bin icon empties the selected log, and the service keeps writing
              to it.
            </>,
          ]}
        />
      </>
    ),
  },
  {
    id: "files",
    title: "Files and folders",
    icon: "folder-tree",
    group: "Reference",
    summary: "Where Zefaro keeps programs, settings and data.",
    body: () => (
      <>
        <P>
          Everything Zefaro installs or creates lives under <C>%USERPROFILE%\.config\zefaro</C>:
        </P>
        <Rows
          rows={[
            ["config.json", <>Your sites and settings. If another program has it open, Zefaro saves once it's closed. A file that isn't valid JSON is kept as <C>config.broken-*.json</C> before Zefaro starts over with defaults.</>],
            ["ca-bundle.pem", "The certificates PHP trusts for HTTPS: Mozilla's list plus Zefaro's CA."],
            ["bin\\", <>Command shims such as <C>php.bat</C>, <C>composer.bat</C> and <C>laravel.bat</C>. <em>Add to PATH</em> adds this folder.</>],
            ["bin\\php\\<version>\\", "One folder per PHP version, with its php.ini."],
            ["bin\\nginx, mariadb, redis", "The downloaded programs."],
            ["nginx\\", "Generated web server configuration: nginx.conf and one file per site."],
            ["data\\mariadb\\", "Your databases."],
            ["data\\mailpit\\", "Mail that Mailpit caught."],
            ["redis\\", "Redis configuration and its saved data."],
            ["apps\\phpmyadmin\\", "phpMyAdmin."],
            ["composer\\", "Zefaro's Composer home, with global packages such as the Laravel installer."],
            ["certs\\", "Zefaro's certificate authority (its key encrypted for your Windows account) and one certificate per secured site."],
            ["runtime\\", "Zefaro's PHP helper for the site tools."],
            ["logs\\", "Service logs, shown on the Logs page."],
            ["downloads\\", "Temporary downloads, which Zefaro removes after installing."],
          ]}
        />
      </>
    ),
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    icon: "triangle-exclamation",
    group: "Reference",
    summary: "Common errors and how to fix them.",
    body: () => (
      <>
        <H3>Port 80 is held by Windows (PID 4)</H3>
        <P>
          IIS or another Windows web service is using port 80. Stop the{" "}
          <em>World Wide Web Publishing Service</em> in <C>services.msc</C>, or run the command
          below in an administrator terminal, then start nginx again.
        </P>
        <CodeBlock label="Administrator terminal" code={"net stop w3svc"} />
        <H3>Port … is already in use by …</H3>
        <P>
          Another program holds the port, often Apache (<C>httpd</C>), XAMPP, Laragon, Skype or a
          second database server. The message names it: stop it and click <em>Try again</em>. You can
          also move Zefaro instead. For nginx, open its settings with the gear and pick a free port
          such as 8080; for PHP, change the base port.
        </P>
        <H3>nginx won't start because port 443 is in use</H3>
        <P>
          Secured sites need port 443 as well as 80. Another local web server (XAMPP,
          Laragon, IIS) or a program such as Skype or VMware may hold it. Quit that program
          and click <em>Try again</em>, or set another HTTPS port (such as 8443) in nginx's settings.
        </P>
        <H3>The browser says the connection isn't private</H3>
        <P>
          Trust Zefaro's certificate authority (<em>Trust certificate…</em> in Settings, under
          HTTPS), then restart the browser. If it still warns, check that the address is the{" "}
          <C>.test</C> name shown on the Sites page.
        </P>
        <H3>PHP installs but won't start</H3>
        <P>
          Install the Microsoft Visual C++ Redistributable (x64) from{" "}
          <C>aka.ms/vs/17/release/vc_redist.x64.exe</C>.
        </P>
        <H3>The site shows 502 Bad Gateway</H3>
        <P>
          The site's PHP version isn't running. Start it on the Services page, or click{" "}
          <em>Start all</em>.
        </P>
        <H3>The site shows Zefaro's default page</H3>
        <P>
          nginx doesn't know that name. Compare the spelling with the Sites page: names are
          lowercase with hyphens.
        </P>
        <H3>Starting over</H3>
        <Steps
          items={[
            <>
              Uninstall Zefaro. The uninstaller also removes its PATH entry, the DNS rule and the
              trusted certificate. To do this without uninstalling, stop all services, click{" "}
              <em>Remove rule</em> in the DNS settings, click <em>Remove trust…</em> in Settings, and
              remove <C>…\.config\zefaro\bin</C> in <em>Edit environment variables for your
              account</em>.
            </>,
            <>
              Delete <C>%USERPROFILE%\.config\zefaro</C>. <strong>This deletes your databases
              too.</strong>
            </>,
          ]}
        />
      </>
    ),
  },
  {
    id: "faq",
    title: "FAQ",
    icon: "circle-question",
    group: "Reference",
    summary: "Short answers to common questions.",
    body: () => (
      <FaqList items={FAQ} />
    ),
  },
];
