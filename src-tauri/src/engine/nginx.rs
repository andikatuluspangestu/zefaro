//! nginx: the web server in front of every site. Serves `<name>.<tld>` from
//! the site's folder (its `public/` if present) and hands `.php` requests to
//! the php-cgi listener of the site's PHP version.
//!
//! The official Windows build comes from nginx.org. Its SHA-256 is pinned
//! below; the hash was taken after checking the release's PGP signature, so
//! the app verifies downloads without bundling a PGP implementation.

use crate::config::{ZefaroConfig, NginxConfig};
use crate::engine::archive::{self, Archive};
use crate::engine::supervisor::{Probe, Spec, Supervisor};
use crate::engine::{certs, mailpit, paths, php, phpmyadmin, process};
use crate::error::{AppError, AppResult};
use std::fs;
use std::path::{Path, PathBuf};

pub const VERSION: &str = "1.30.6";
/// nginx-1.30.6.zip; SHA-256 pinned after verifying its PGP signature from
/// Sergey Kandaurov (nginx release key D678 6CE3 03D9 A902 2998 DC6C C846 4D54 9AF7 5C0A).
const ARCHIVE: Archive = Archive {
    name: "nginx 1.30.6",
    url: "https://nginx.org/download/nginx-1.30.6.zip",
    sha256: "c6ee35edb0a861063323f709192ae50d1eefaf2ea7d00678bd2b22d8542dc61e",
    inner: "nginx-1.30.6",
};

pub const SERVICE_ID: &str = "nginx";

/// Where nginx's files live. Production uses [`Layout::standard`]; tests use
/// temporary folders and another port.
#[derive(Clone, Debug)]
pub struct Layout {
    /// Binary distribution (nginx.exe, conf/mime.types, conf/fastcgi_params).
    pub nginx: PathBuf,
    /// nginx's `-p` prefix; holds the logs/ and temp/ folders nginx expects.
    pub runtime: PathBuf,
    pub conf: PathBuf,
    pub sites: PathBuf,
    pub default_root: PathBuf,
    pub logs: PathBuf,
    pub port: u16,
    /// Port for sites with HTTPS turned on.
    pub https_port: u16,
    /// Zefaro's CA and the site certificates.
    pub certs: certs::Layout,
    /// The user's nginx settings (timeouts, gzip, extra directives, …).
    pub opts: NginxConfig,
    /// phpMyAdmin's folder, served at phpmyadmin.<tld> when enabled.
    pub phpmyadmin: PathBuf,
    /// Mailpit's UI port, proxied at mailpit.<tld> once Mailpit is installed.
    pub mailpit_port: Option<u16>,
    /// Where sites send dump() output (VAR_DUMPER_FORMAT), when the Dumps
    /// page has catching on.
    pub dump_server: Option<String>,
}

impl Layout {
    /// The real layout, with ports and options from the user's settings.
    pub fn standard(cfg: &ZefaroConfig) -> Self {
        let mut l = Self::under(paths::nginx_dir(), paths::nginx_runtime(), paths::logs_dir(), cfg.nginx.http_port);
        l.https_port = cfg.nginx.https_port;
        l.certs = certs::Layout::standard();
        l.opts = cfg.nginx.clone();
        let mp = mailpit::Layout::standard(&cfg.mailpit);
        l.mailpit_port = mailpit::installed(&mp).then_some(cfg.mailpit.ui_port);
        l.dump_server = cfg.dumps.then(crate::engine::dumps::format);
        l
    }

    pub fn under(nginx: PathBuf, runtime: PathBuf, logs: PathBuf, port: u16) -> Self {
        Self {
            conf: runtime.join("nginx.conf"),
            sites: runtime.join("sites"),
            default_root: runtime.join("default"),
            certs: certs::Layout::at(runtime.join("certs")),
            nginx,
            runtime,
            logs,
            port,
            https_port: port + 1,
            opts: NginxConfig::default(),
            phpmyadmin: phpmyadmin::dir(),
            mailpit_port: None,
            dump_server: None,
        }
    }

    pub(crate) fn exe(&self) -> PathBuf {
        self.nginx.join("nginx.exe")
    }

    /// `-p <prefix>/ -c <conf>`, shared by run, test, reload and quit.
    pub(crate) fn base_args(&self) -> Vec<std::ffi::OsString> {
        vec![
            "-p".into(),
            format!("{}/", fwd(&self.runtime)).into(),
            "-c".into(),
            fwd(&self.conf).into(),
        ]
    }
}

pub fn installed() -> bool {
    paths::nginx_dir().join("nginx.exe").is_file()
}

/// Install on first use. Serialized: phpMyAdmin's start also starts nginx.
pub fn install() -> AppResult<()> {
    let dest = paths::nginx_dir();
    archive::exclusive(&dest, || {
        if installed() {
            Ok(())
        } else {
            install_to(&dest, &paths::downloads_dir())
        }
    })
}

/// Download, verify and unpack nginx into `dest`, using `scratch` for the zip.
pub fn install_to(dest: &Path, scratch: &Path) -> AppResult<()> {
    ARCHIVE.install(dest, scratch, false)
}

/// nginx config paths: long form, with forward slashes (which nginx on Windows
/// accepts and which need no escaping).
fn fwd(p: &Path) -> String {
    long_path(p).display().to_string().replace('\\', "/")
}

/// nginx for Windows refuses 8.3 short names such as `USERNA~1` (a guard
/// against location-rule bypasses) and reports them as "file not found".
/// Expand a path to its long form: canonicalize the nearest existing ancestor
/// and re-append the rest, dropping the `\\?\` prefix canonicalize adds.
fn long_path(p: &Path) -> PathBuf {
    let mut existing = p;
    let mut rest = Vec::new();
    while !existing.exists() {
        match (existing.parent(), existing.file_name()) {
            (Some(parent), Some(name)) => {
                rest.push(name.to_owned());
                existing = parent;
            }
            _ => return p.to_path_buf(),
        }
    }
    let Ok(canonical) = fs::canonicalize(existing) else {
        return p.to_path_buf();
    };
    let text = canonical.display().to_string();
    let mut out = match text.strip_prefix(r"\\?\") {
        // Only plain drive paths; leave \\?\UNC\… alone.
        Some(drive) if drive.as_bytes().get(1) == Some(&b':') => PathBuf::from(drive),
        _ => canonical,
    };
    out.extend(rest.iter().rev());
    out
}

/// Serve a project's `public/` folder when it has one (Laravel and most
/// frameworks), otherwise the project folder itself.
/// The PHP line a site is served by: its own, or the default when its own
/// isn't installed.
fn site_php<'a>(cfg: &'a ZefaroConfig, own: &'a str, installed: impl Fn(&str) -> bool) -> &'a str {
    if installed(own) { own } else { &cfg.default_php }
}

/// The installed PHP lines the linked sites are served by, once each. Their
/// php-cgi has to run alongside nginx or those sites answer 502.
pub fn site_php_lines(cfg: &ZefaroConfig) -> Vec<String> {
    php_lines_for(cfg, php::is_installed)
}

fn php_lines_for(cfg: &ZefaroConfig, installed: impl Fn(&str) -> bool) -> Vec<String> {
    let mut lines: Vec<String> = cfg
        .sites
        .iter()
        // A proxied site is served by its own dev server, not PHP.
        .filter(|s| s.proxy.is_none())
        .map(|s| site_php(cfg, &s.php_version, &installed).to_owned())
        .filter(|l| installed(l))
        .collect();
    lines.sort();
    lines.dedup();
    lines
}

pub fn site_root(path: &Path) -> PathBuf {
    let public = path.join("public");
    if public.is_dir() { public } else { path.to_path_buf() }
}

pub fn render_main(l: &Layout) -> String {
    let o = &l.opts;
    let workers = if o.worker_processes == 0 { "auto".to_owned() } else { o.worker_processes.to_string() };
    let access_log = if o.access_log { format!(r#""{}/nginx-access.log" zefaro"#, fwd(&l.logs)) } else { "off".into() };
    let gzip = if o.gzip {
        "gzip on;\n    gzip_types text/css application/javascript application/json image/svg+xml text/plain text/xml;"
    } else {
        "gzip off;"
    };
    let body_limit = if o.client_max_body_mb == 0 { "0".to_owned() } else { format!("{}m", o.client_max_body_mb) };
    let extra = o.extra_http.trim();
    let extra = if extra.is_empty() {
        String::new()
    } else {
        let indented: Vec<String> = extra.lines().map(|line| format!("    {line}")).collect();
        format!("\n    # Extra directives from Zefaro's nginx settings.\n{}\n", indented.join("\n"))
    };
    format!(
        r#"# Generated by Zefaro — regenerated on every change, do not edit.
worker_processes {workers};
error_log "{logs}/nginx-error.log" {error_level};
pid "{runtime}/nginx.pid";

events {{
    worker_connections {connections};
}}

http {{
    include "{nginx}/conf/mime.types";
    default_type application/octet-stream;
    # nginx's "combined" format plus the site's host and the response time,
    # so the Logs page can show which site a request was for.
    log_format zefaro '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" "$http_user_agent" '
                    '"$host" $request_time';
    access_log {access_log};
    sendfile off;
    keepalive_timeout {keepalive};
    server_names_hash_bucket_size 128;
    # 0 = no limit here; uploads are then limited per PHP version in php.ini.
    client_max_body_size {body_limit};
    {gzip}
{extra}
    server {{
        listen 127.0.0.1:{port} default_server;
        server_name _;
        root "{default_root}";
        index index.html;
        location = /favicon.ico {{ access_log off; log_not_found off; }}
    }}

    include "{sites}/*.conf";
}}
"#,
        logs = fwd(&l.logs),
        error_level = o.error_log_level,
        connections = o.worker_connections,
        keepalive = o.keepalive_timeout,
        runtime = fwd(&l.runtime),
        nginx = fwd(&l.nginx),
        port = l.port,
        default_root = fwd(&l.default_root),
        sites = fwd(&l.sites),
    )
}

/// One site's server block(s). With `tls`, HTTP only redirects to HTTPS.
pub fn render_site(
    name: &str,
    tld: &str,
    root: &Path,
    php_port: u16,
    tls: Option<&certs::SiteFiles>,
    l: &Layout,
) -> String {
    wrap_site(name, tld, &render_site_body(root, php_port, l), tls, l)
}

/// A site that forwards to a dev server on `port` (Vite, Next.js), WebSocket
/// included so hot reload works. With `tls`, HTTP only redirects to HTTPS.
pub fn render_proxied_site(name: &str, tld: &str, port: u16, tls: Option<&certs::SiteFiles>, l: &Layout) -> String {
    wrap_site(name, tld, &render_proxy_body(port), tls, l)
}

/// The server block(s) around a site's body: plain HTTP, or HTTP redirecting
/// to HTTPS plus the HTTPS server.
fn wrap_site(name: &str, tld: &str, body: &str, tls: Option<&certs::SiteFiles>, l: &Layout) -> String {
    let names = format!("{name}.{tld} www.{name}.{tld} *.{name}.{tld}");
    match tls {
        None => format!(
            r#"# Site "{name}" — generated by Zefaro.
server {{
    listen 127.0.0.1:{port};
    server_name {names};
{body}}}
"#,
            port = l.port,
        ),
        Some(files) => format!(
            r#"# Site "{name}" (HTTPS) — generated by Zefaro.
server {{
    listen 127.0.0.1:{port};
    server_name {names};
    return 301 https://$host{https_suffix}$request_uri;
}}

server {{
    listen 127.0.0.1:{https_port} ssl;
    http2 {http2};
    server_name {names};
    ssl_certificate "{cert}";
    ssl_certificate_key "{key}";
    ssl_protocols TLSv1.2 TLSv1.3;
{body}}}
"#,
            port = l.port,
            https_port = l.https_port,
            https_suffix = if l.https_port == 443 { String::new() } else { format!(":{}", l.https_port) },
            http2 = if l.opts.http2 { "on" } else { "off" },
            cert = fwd(&files.cert),
            key = fwd(&files.key),
        ),
    }
}

/// A name that forwards to a local web app (Mailpit's UI), including the
/// WebSocket Mailpit uses to show new mail as it arrives.
pub fn render_proxy_site(name: &str, tld: &str, port: u16, l: &Layout) -> String {
    format!(
        r#"# "{name}" — generated by Zefaro: forwards to 127.0.0.1:{port}.
server {{
    listen 127.0.0.1:{listen};
    server_name {name}.{tld};
    client_max_body_size 0;

    location / {{
        proxy_pass http://127.0.0.1:{port};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 1h;
        proxy_buffering off;
    }}
}}
"#,
        listen = l.port,
    )
}

/// A proxied site's body. Dev servers such as Vite answer only to `localhost`,
/// so that's the Host they get; the address the browser used travels in
/// X-Forwarded-Host.
fn render_proxy_body(port: u16) -> String {
    format!(
        r#"    client_max_body_size 0;

    location / {{
        proxy_pass http://127.0.0.1:{port};
        proxy_http_version 1.1;
        proxy_set_header Host localhost:{port};
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 1h;
        proxy_buffering off;
    }}
"#
    )
}

/// What a site's server block serves: files from `root`, PHP via php-cgi.
fn render_site_body(root: &Path, php_port: u16, l: &Layout) -> String {
    format!(
        r#"    root "{root}";
    index index.php index.html index.htm;
    charset utf-8;

    location / {{
        try_files $uri $uri/ /index.php?$query_string;
    }}

    location = /favicon.ico {{ access_log off; log_not_found off; }}
    location = /robots.txt  {{ access_log off; log_not_found off; }}

    location ~ \.php$ {{
        fastcgi_split_path_info ^(.+\.php)(/.+)$;
        fastcgi_pass 127.0.0.1:{php_port};
        fastcgi_index index.php;
        include "{nginx}/conf/fastcgi_params";
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
        fastcgi_param PATH_INFO $fastcgi_path_info;
        fastcgi_read_timeout {read_timeout};{dumps}
    }}

    location ~ /\.(?!well-known).* {{
        deny all;
    }}
"#,
        root = fwd(root),
        nginx = fwd(&l.nginx),
        read_timeout = l.opts.fastcgi_read_timeout,
        dumps = l
            .dump_server
            .as_ref()
            .map(|d| format!("\n        fastcgi_param VAR_DUMPER_FORMAT {d};"))
            .unwrap_or_default(),
    )
}

/// The page nginx shows for addresses that aren't a linked site (and localhost).
const DEFAULT_PAGE: &str = include_str!("default-page.html");

/// Write nginx.conf and one config per site. Each site is routed to the
/// php-cgi port of its PHP version, or of the active version when its own
/// isn't installed.
pub fn write_config(cfg: &ZefaroConfig, l: &Layout) -> AppResult<()> {
    for dir in [l.runtime.join("logs"), l.runtime.join("temp"), l.sites.clone(), l.default_root.clone(), l.logs.clone()] {
        fs::create_dir_all(dir)?;
    }
    fs::write(l.default_root.join("index.html"), DEFAULT_PAGE)?;
    fs::write(&l.conf, render_main(l))?;

    // Rewrite the site configs from scratch so unlinked sites disappear.
    for entry in fs::read_dir(&l.sites)?.flatten() {
        if entry.path().extension().is_some_and(|e| e == "conf") {
            fs::remove_file(entry.path())?;
        }
    }
    for site in &cfg.sites {
        let host = format!("{}.{}", site.name, cfg.tld);
        let tls = if site.secured { Some(certs::ensure_site(&l.certs, &cfg.tld, &host)?) } else { None };
        let conf = match site.proxy {
            Some(port) => render_proxied_site(&site.name, &cfg.tld, port, tls.as_ref(), l),
            None => {
                let version = site_php(cfg, &site.php_version, php::is_installed);
                let port = php::port_for(cfg.php.base_port, version);
                render_site(&site.name, &cfg.tld, &site_root(Path::new(&site.path)), port, tls.as_ref(), l)
            }
        };
        fs::write(l.sites.join(format!("{}.conf", site.name)), conf)?;
    }

    // Mailpit's UI, once installed — unless a linked site already uses its name.
    if let Some(port) = l.mailpit_port.filter(|_| !cfg.sites.iter().any(|s| s.name == mailpit::HOST)) {
        let conf = render_proxy_site(mailpit::HOST, &cfg.tld, port, l);
        fs::write(l.sites.join(format!("{}.conf", mailpit::HOST)), conf)?;
    }

    // phpMyAdmin, on the newest PHP line it supports — unless a linked site
    // already uses its name.
    let name_taken = cfg.sites.iter().any(|s| s.name == phpmyadmin::HOST);
    if cfg.phpmyadmin && !name_taken && phpmyadmin::installed_at(&l.phpmyadmin) {
        let lines: Vec<String> = php::installed().into_keys().collect();
        if let Some(line) = phpmyadmin::pick_php(&lines) {
            let port = php::port_for(cfg.php.base_port, &line);
            let conf = render_site(phpmyadmin::HOST, &cfg.tld, &l.phpmyadmin, port, None, l);
            fs::write(l.sites.join(format!("{}.conf", phpmyadmin::HOST)), conf)?;
        }
    }
    Ok(())
}

pub fn spec(l: &Layout) -> Spec {
    let mut quit = l.base_args();
    quit.extend(["-s".into(), "quit".into()]);
    Spec {
        id: SERVICE_ID.into(),
        program: l.exe(),
        args: l.base_args(),
        cwd: l.nginx.clone(),
        env: Vec::new(),
        // nginx writes its own error/access logs; this catches anything it
        // prints before it has read its config.
        log: l.logs.join("nginx-stdout.log"),
        port: l.port,
        probe: Probe::Tcp,
        stop: Some((l.exe(), quit)),
    }
}

/// `nginx -t`: validate the generated config before starting or reloading.
pub fn test_config(l: &Layout) -> AppResult<()> {
    let mut args = l.base_args();
    args.push("-t".into());
    process::run(process::command(l.exe()).args(args).current_dir(&l.nginx))
        .map(|_| ())
        .map_err(|e| {
            AppError::msg(crate::tr!(
                format!("nginx rejected the configuration: {e}"),
                format!("nginx menolak konfigurasinya: {e}")
            ))
        })
}

pub fn reload(l: &Layout) -> AppResult<()> {
    let mut args = l.base_args();
    args.extend(["-s".into(), "reload".into()]);
    process::run(process::command(l.exe()).args(args).current_dir(&l.nginx)).map(|_| ())
}

/// Regenerate config after sites or PHP change, and reload nginx if running.
pub fn sync(cfg: &ZefaroConfig, sup: &Supervisor) -> AppResult<()> {
    let l = Layout::standard(cfg);
    write_config(cfg, &l)?;
    if sup.is_running(SERVICE_ID) {
        test_config(&l)?;
        reload(&l)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Site;
    use std::io::{Read, Write};

    fn layout(root: &Path, port: u16) -> Layout {
        Layout::under(root.join("bin-nginx"), root.join("nginx"), root.join("logs"), port)
    }

    #[test]
    fn main_config_listens_on_loopback_and_includes_sites() {
        let l = layout(Path::new(r"C:\Users\me\.config\zefaro"), 80);
        let conf = render_main(&l);
        assert!(conf.contains("listen 127.0.0.1:80 default_server;"));
        assert!(conf.contains(r#"include "C:/Users/me/.config/zefaro/nginx/sites/*.conf";"#));
        assert!(conf.contains(r#"include "C:/Users/me/.config/zefaro/bin-nginx/conf/mime.types";"#));
        assert!(conf.contains("client_max_body_size 0;"));
        assert!(!conf.contains('\\'), "Windows backslashes must be converted");
    }

    #[test]
    fn site_php_lines_follow_each_site_once() {
        let site = |name: &str, php: &str| Site {
            name: name.into(),
            path: format!(r"C:\Projects\{name}"),
            url: format!("http://{name}.test"),
            secured: false,
            php_version: php.into(),
            kind: "linked".into(),
            framework: None,
            proxy: None,
        };
        let mut cfg = ZefaroConfig::default();
        cfg.default_php = "8.3".into();
        cfg.sites = vec![site("a", "8.4"), site("b", "8.4"), site("c", "7.4"), site("d", "8.5")];
        // 7.4 isn't installed, so site c is served by the default, 8.3.
        let installed = |l: &str| ["8.3", "8.4", "8.5"].contains(&l);
        assert_eq!(php_lines_for(&cfg, installed), ["8.3", "8.4", "8.5"]);
        // A missing default adds nothing.
        let only_84 = |l: &str| l == "8.4";
        assert_eq!(php_lines_for(&cfg, only_84), ["8.4"]);
        cfg.sites.clear();
        assert!(php_lines_for(&cfg, installed).is_empty());
    }

    #[test]
    fn dump_catching_adds_var_dumper_format() {
        let mut l = layout(Path::new(r"C:\zefaro"), 80);
        let root = Path::new(r"C:\Projects\blog\public");
        assert!(!render_site("blog", "test", root, 9085, None, &l).contains("VAR_DUMPER_FORMAT"));
        l.dump_server = Some("tcp://127.0.0.1:9912".into());
        assert!(render_site("blog", "test", root, 9085, None, &l).contains("fastcgi_param VAR_DUMPER_FORMAT tcp://127.0.0.1:9912;"));
    }

    #[test]
    fn proxied_site_forwards_to_its_dev_server() {
        let l = layout(Path::new(r"C:\zefaro"), 80);
        let conf = render_proxied_site("ui", "test", 5173, None, &l);
        assert!(conf.contains("server_name ui.test www.ui.test *.ui.test;"));
        assert!(conf.contains("proxy_pass http://127.0.0.1:5173;"));
        assert!(conf.contains("proxy_set_header Host localhost:5173;"), "Vite only answers to localhost");
        assert!(conf.contains("proxy_set_header Upgrade $http_upgrade;"), "hot reload's WebSocket");
        assert!(!conf.contains("fastcgi_pass"));
    }

    #[test]
    fn site_config_routes_php_to_its_versions_port() {
        let l = layout(Path::new(r"C:\zefaro"), 80);
        let conf = render_site("blog", "test", Path::new(r"C:\Projects\blog\public"), 9085, None, &l);
        assert!(conf.contains("server_name blog.test www.blog.test *.blog.test;"));
        assert!(conf.contains(r#"root "C:/Projects/blog/public";"#));
        assert!(conf.contains("fastcgi_pass 127.0.0.1:9085;"));
        assert!(conf.contains("try_files $uri $uri/ /index.php?$query_string;"));
    }

    #[test]
    fn long_path_expands_short_names_and_keeps_missing_tail() {
        let tmp = std::env::temp_dir();
        let expanded = long_path(&tmp.join("not-created-yet").join("nginx.conf"));
        let text = expanded.display().to_string();
        assert!(!text.contains('~'), "short 8.3 name survived: {text}");
        assert!(!text.starts_with(r"\\?\"), "{text}");
        assert!(text.ends_with(r"not-created-yet\nginx.conf"), "{text}");
    }

    #[test]
    fn serves_public_folder_when_present() {
        let dir = std::env::temp_dir().join(format!("zefaro-root-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        assert_eq!(site_root(&dir), dir);
        fs::create_dir_all(dir.join("public")).unwrap();
        assert_eq!(site_root(&dir), dir.join("public"));
        let _ = fs::remove_dir_all(dir);
    }

    fn http_get(port: u16, host: &str) -> String {
        let mut s = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(s, "GET / HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n").unwrap();
        let mut body = String::new();
        s.read_to_string(&mut body).unwrap();
        body
    }

    #[test]
    fn mailpit_is_proxied_with_websockets() {
        let l = layout(Path::new(r"C:\zefaro"), 80);
        let conf = render_proxy_site("mailpit", "test", 8025, &l);
        assert!(conf.contains("server_name mailpit.test;"));
        assert!(conf.contains("proxy_pass http://127.0.0.1:8025;"));
        assert!(conf.contains("proxy_set_header Upgrade $http_upgrade;"));
        assert!(conf.contains("listen 127.0.0.1:80;"));
    }

    #[test]
    fn main_config_follows_settings() {
        let mut l = layout(Path::new(r"C:\zefaro"), 8080);
        l.opts = NginxConfig {
            worker_processes: 0,
            gzip: true,
            access_log: false,
            client_max_body_mb: 64,
            error_log_level: "info".into(),
            extra_http: "proxy_buffer_size 16k;\nlarge_client_header_buffers 4 32k;".into(),
            ..NginxConfig::default()
        };
        let conf = render_main(&l);
        assert!(conf.contains("worker_processes auto;"));
        assert!(conf.contains("listen 127.0.0.1:8080 default_server;"));
        assert!(conf.contains("gzip on;"));
        assert!(conf.contains("access_log off;"));
        assert!(conf.contains("client_max_body_size 64m;"));
        assert!(conf.contains(r#"nginx-error.log" info;"#));
        assert!(conf.contains("    proxy_buffer_size 16k;\n    large_client_header_buffers 4 32k;"));
    }

    #[test]
    fn tls_redirect_keeps_a_custom_https_port() {
        let mut l = layout(Path::new(r"C:\zefaro"), 8080);
        l.https_port = 8443;
        l.opts.http2 = false;
        let files = certs::SiteFiles { cert: r"C:\c.crt".into(), key: r"C:\c.key".into() };
        let conf = render_site("blog", "test", Path::new(r"C:\b"), 9083, Some(&files), &l);
        assert!(conf.contains("return 301 https://$host:8443$request_uri;"));
        assert!(conf.contains("listen 127.0.0.1:8443 ssl;"));
        assert!(conf.contains("http2 off;"));
    }

    #[test]
    fn secured_site_redirects_http_and_serves_tls() {
        let mut l = layout(Path::new(r"C:\zefaro"), 80);
        l.https_port = 443;
        let files = certs::SiteFiles { cert: r"C:\zefaro\certs\blog.test.crt".into(), key: r"C:\zefaro\certs\blog.test.key".into() };
        let conf = render_site("blog", "test", Path::new(r"C:\Projects\blog"), 9085, Some(&files), &l);
        assert!(conf.contains("return 301 https://$host$request_uri;"));
        assert!(conf.contains("listen 127.0.0.1:443 ssl;"));
        assert!(conf.contains(r#"ssl_certificate "C:/zefaro/certs/blog.test.crt";"#));
        assert_eq!(conf.matches("fastcgi_pass 127.0.0.1:9085;").count(), 1, "PHP only on the HTTPS server");
    }

    /// The nginx Zefaro installed proxying mailpit.test to a real Mailpit (pinned
    /// download, cached) on spare ports: the UI page and the WebSocket upgrade.
    #[test]
    #[ignore = "needs nginx installed by Zefaro; downloads Mailpit once (run with --ignored)"]
    fn live_nginx_proxies_mailpit() {
        use crate::config::MailpitConfig;
        assert!(installed(), "install nginx in Zefaro first");
        let cache = std::env::temp_dir().join("zefaro-test-cache");
        let tmp = std::env::temp_dir().join(format!("zefaro-mailproxy-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let mp = mailpit::Layout {
            base: tmp.join("mailpit"),
            data: tmp.join("mailpit-data"),
            log: tmp.join("mailpit.log"),
            opts: MailpitConfig { smtp_port: 11027, ui_port: 18027, ..MailpitConfig::default() },
        };
        mailpit::prepare(&mp, &cache, true).expect("install Mailpit");
        let sup = Supervisor::default();
        sup.start(mailpit::spec(&mp)).expect("start Mailpit");

        let mut l = layout(&tmp, 8196);
        l.nginx = paths::nginx_dir();
        l.mailpit_port = Some(18027);
        let mut cfg = ZefaroConfig::default();
        cfg.sites.clear();
        write_config(&cfg, &l).unwrap();
        test_config(&l).expect("nginx -t");
        sup.start(spec(&l)).expect("start nginx");

        let page = http_get(8196, "mailpit.test");
        assert!(page.starts_with("HTTP/1.1 200"), "{page}");
        assert!(page.contains("Mailpit"), "Mailpit's UI is served");

        // Mailpit pushes new mail over a WebSocket; nginx must pass the upgrade.
        let mut s = std::net::TcpStream::connect(("127.0.0.1", 8196)).unwrap();
        write!(
            s,
            "GET /api/events HTTP/1.1\r\nHost: mailpit.test\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\
             Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n"
        )
        .unwrap();
        let mut buf = [0u8; 256];
        let n = s.read(&mut buf).unwrap();
        let head = String::from_utf8_lossy(&buf[..n]);
        assert!(head.starts_with("HTTP/1.1 101"), "WebSocket upgrade: {head}");

        sup.stop(SERVICE_ID).unwrap();
        sup.stop(mailpit::SERVICE_ID).unwrap();
        let _ = fs::remove_dir_all(&tmp);
    }

    /// The nginx Zefaro installed, on spare ports, serving a secured static
    /// site: HTTP redirects, HTTPS presents a certificate that chains to Zefaro's
    /// CA. Uses curl with --cacert, so nothing is added to any trust store.
    #[test]
    #[ignore = "needs nginx installed by Zefaro and curl on PATH (run with --ignored)"]
    fn live_nginx_serves_https() {
        assert!(installed(), "install nginx in Zefaro first");
        let tmp = std::env::temp_dir().join(format!("zefaro-tls-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(tmp.join("site")).unwrap();
        fs::write(tmp.join("site/index.html"), "hello over tls").unwrap();
        let mut l = layout(&tmp, 8197);
        l.nginx = paths::nginx_dir();

        let mut cfg = ZefaroConfig::default();
        cfg.sites = vec![Site {
            name: "secure-demo".into(),
            path: tmp.join("site").display().to_string(),
            url: "https://secure-demo.test".into(),
            secured: true,
            php_version: "8.3".into(),
            kind: "linked".into(),
            framework: None,
            proxy: None,
        }];
        write_config(&cfg, &l).unwrap();
        test_config(&l).expect("nginx -t");
        let sup = Supervisor::default();
        sup.start(spec(&l)).expect("start nginx");

        let redirect = http_get(8197, "secure-demo.test");
        assert!(redirect.starts_with("HTTP/1.1 301"), "{redirect}");
        // HTTPS isn't on 443 here, so the redirect carries the port.
        assert!(redirect.contains("Location: https://secure-demo.test:8198/"), "{redirect}");

        let ca = l.certs.ca_cert();
        let out = std::process::Command::new("curl")
            // Windows' curl (Schannel) wants a revocation answer local CAs
            // never publish; browsers don't.
            .args(["-sS", "--ssl-no-revoke", "--cacert"])
            .arg(&ca)
            .args(["--resolve", "www.secure-demo.test:8198:127.0.0.1", "https://www.secure-demo.test:8198/"])
            .output()
            .expect("run curl");
        let body = String::from_utf8_lossy(&out.stdout);
        assert_eq!(body, "hello over tls", "curl: {}", String::from_utf8_lossy(&out.stderr));

        sup.stop(SERVICE_ID).unwrap();
        let _ = fs::remove_dir_all(&tmp);
    }

    /// Full stack on spare ports: download + verify nginx into a temp folder,
    /// run the installed PHP 8.3's php-cgi and nginx under the supervisor,
    /// serve a site's index.php, survive a php-cgi crash, then stop cleanly.
    #[test]
    #[ignore = "network + needs PHP 8.3 installed by Zefaro (run with --ignored)"]
    fn live_nginx_serves_php_and_supervisor_restarts_crashes() {
        assert!(php::is_installed("8.3"), "install PHP 8.3 in Zefaro first");
        let tmp = std::env::temp_dir().join(format!("zefaro-live-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(tmp.join("site/public")).unwrap();
        fs::write(tmp.join("site/public/index.php"), "<?php echo 'php=' . PHP_VERSION;").unwrap();

        let l = layout(&tmp, 8099);
        install_to(&l.nginx, &tmp).expect("install nginx");

        let mut cfg = ZefaroConfig::default();
        cfg.default_php = "8.3".into();
        cfg.php.base_port = 9599 - 83; // PHP 8.3 → 9599
        cfg.sites = vec![Site {
            name: "demo".into(),
            path: tmp.join("site").display().to_string(),
            url: "http://demo.test".into(),
            secured: false,
            php_version: "8.3".into(),
            kind: "linked".into(),
            framework: None,
            proxy: None,
        }];
        write_config(&cfg, &l).unwrap();
        test_config(&l).expect("nginx -t");

        let sup = Supervisor::default();
        let mut cgi = php::cgi_spec("8.3", 9599);
        cgi.log = tmp.join("php-8.3.log");
        let php_pid = sup.start(cgi.clone()).expect("start php-cgi");
        sup.start(spec(&l)).expect("start nginx");

        let page = http_get(8099, "demo.test");
        assert!(page.contains("php=8.3."), "{page}");
        assert!(http_get(8099, "unknown.test").contains("Zefaro is running"));

        // Kill php-cgi behind the supervisor's back; tick() must bring it back.
        process::command("taskkill").args(["/F", "/PID", &php_pid.to_string()]).output().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(500));
        sup.tick();
        std::thread::sleep(std::time::Duration::from_millis(800));
        let status = sup.status(&cgi.id);
        assert_eq!(status.health, crate::engine::supervisor::Health::Running, "{status:?}");
        assert_ne!(status.pid, Some(php_pid));
        assert!(http_get(8099, "demo.test").contains("php=8.3."));

        sup.stop(SERVICE_ID).unwrap();
        sup.stop(&cgi.id).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(300));
        assert!(!crate::engine::supervisor::port_open(8099), "nginx (incl. workers) stopped");
        assert!(!crate::engine::supervisor::port_open(9599), "php-cgi stopped");
        let _ = fs::remove_dir_all(&tmp);
    }
}
