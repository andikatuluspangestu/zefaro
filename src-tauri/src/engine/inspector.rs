//! Watching the requests that reach a shared site: while a site is shared,
//! cloudflared talks to this small proxy instead of nginx, and the proxy hands
//! each request on to the site's nginx listener, keeping a copy (method, path,
//! headers, body up to 1 MB, status, time) for the Requests panel. A webhook
//! that arrived can be sent again with one click.
//!
//! One request per connection: the proxy asks nginx to close after answering,
//! so it never has to frame a response itself. WebSocket upgrades (a Vite dev
//! server's hot reload) are passed through both ways as they are.

use serde::Serialize;
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// Bodies kept for the panel; the request itself always goes through whole.
const KEEP_BODY: usize = 1024 * 1024;
const KEEP_REQUESTS: usize = 200;
const MAX_HEAD: usize = 64 * 1024;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Recorded {
    pub id: u64,
    pub at_ms: u64,
    pub method: String,
    /// Path and query, as sent.
    pub path: String,
    pub headers: Vec<(String, String)>,
    /// The body as text when it's UTF-8; otherwise empty and `binary` set.
    pub body: String,
    pub binary: bool,
    /// The body's full size (it may be longer than what's kept).
    pub body_bytes: u64,
    pub truncated: bool,
    /// None while waiting for the answer, or when the site didn't answer.
    pub status: Option<u16>,
    pub duration_ms: Option<u64>,
    pub websocket: bool,
    /// Sent again from the panel.
    pub replay: bool,
}

#[derive(Default)]
struct Log {
    items: Mutex<VecDeque<Recorded>>,
    next: AtomicU64,
    /// Raw bodies of the kept requests, for replay.
    raw: Mutex<std::collections::HashMap<u64, Vec<u8>>>,
    /// Authorization values, for replay; never sent to the panel.
    auth: Mutex<std::collections::HashMap<u64, String>>,
}

impl Log {
    fn push(&self, mut r: Recorded, raw: Vec<u8>) -> u64 {
        let id = self.next.fetch_add(1, Ordering::Relaxed) + 1;
        r.id = id;
        let mut items = self.items.lock().unwrap();
        items.push_back(r);
        let mut bodies = self.raw.lock().unwrap();
        bodies.insert(id, raw);
        while items.len() > KEEP_REQUESTS {
            if let Some(old) = items.pop_front() {
                bodies.remove(&old.id);
                self.auth.lock().unwrap().remove(&old.id);
            }
        }
        id
    }

    fn finish(&self, id: u64, status: Option<u16>, started: Instant) {
        if let Some(r) = self.items.lock().unwrap().iter_mut().find(|r| r.id == id) {
            r.status = status;
            r.duration_ms = Some(started.elapsed().as_millis() as u64);
        }
    }
}

/// A running proxy. Dropping it stops it.
pub struct Inspector {
    pub port: u16,
    stop: Arc<AtomicBool>,
    log: Arc<Log>,
}

impl Drop for Inspector {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        // Wake the accept loop.
        let _ = TcpStream::connect_timeout(&([127, 0, 0, 1], self.port).into(), Duration::from_millis(200));
    }
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

impl Inspector {
    /// Listen on a spare loopback port and pass requests on to `upstream`.
    pub fn start(upstream: u16) -> std::io::Result<Self> {
        let listener = TcpListener::bind("127.0.0.1:0")?;
        let port = listener.local_addr()?.port();
        let stop = Arc::new(AtomicBool::new(false));
        let log = Arc::new(Log::default());
        {
            let (stop, log) = (stop.clone(), log.clone());
            std::thread::spawn(move || {
                for conn in listener.incoming() {
                    if stop.load(Ordering::Relaxed) {
                        break;
                    }
                    let Ok(client) = conn else { continue };
                    let log = log.clone();
                    std::thread::spawn(move || {
                        let _ = serve(client, upstream, &log, false);
                    });
                }
            });
        }
        Ok(Self { port, stop, log })
    }

    /// The requests so far, newest first, without their bodies.
    pub fn list(&self) -> Vec<Recorded> {
        self.log
            .items
            .lock()
            .unwrap()
            .iter()
            .rev()
            .map(|r| Recorded { body: String::new(), headers: Vec::new(), ..r.clone() })
            .collect()
    }

    pub fn get(&self, id: u64) -> Option<Recorded> {
        self.log.items.lock().unwrap().iter().find(|r| r.id == id).cloned()
    }

    pub fn clear(&self) {
        self.log.items.lock().unwrap().clear();
        self.log.raw.lock().unwrap().clear();
        self.log.auth.lock().unwrap().clear();
    }

    /// Send a recorded request again, through the proxy so it's recorded too.
    /// Returns the new request's id once the site has answered.
    pub fn replay(&self, id: u64) -> std::io::Result<u64> {
        let r = self.get(id).ok_or_else(|| std::io::Error::other("gone"))?;
        if r.truncated || r.websocket {
            return Err(std::io::Error::other("not replayable"));
        }
        let body = self.log.raw.lock().unwrap().get(&id).cloned().unwrap_or_default();
        let mut head = format!("{} {} HTTP/1.1\r\n", r.method, r.path);
        for (k, v) in &r.headers {
            let lower = k.to_ascii_lowercase();
            if matches!(lower.as_str(), "content-length" | "transfer-encoding" | "connection" | "authorization") {
                continue;
            }
            head.push_str(&format!("{k}: {v}\r\n"));
        }
        // The password a protected share asks for isn't kept; nginx gets the
        // request from loopback through the proxy, which adds it back below.
        if let Some(auth) = self.log.auth.lock().unwrap().get(&id).cloned() {
            head.push_str(&format!("Authorization: {auth}\r\n"));
        }
        head.push_str(&format!("Content-Length: {}\r\nConnection: close\r\nX-Zefaro-Replay: 1\r\n\r\n", body.len()));
        let mut s = TcpStream::connect(("127.0.0.1", self.port))?;
        s.set_read_timeout(Some(Duration::from_secs(120)))?;
        s.write_all(head.as_bytes())?;
        s.write_all(&body)?;
        let mut sink = Vec::new();
        let _ = s.read_to_end(&mut sink);
        let newest = self.log.items.lock().unwrap().iter().rev().find(|x| x.replay).map(|x| x.id);
        newest.ok_or_else(|| std::io::Error::other("not recorded"))
    }
}

struct Head {
    method: String,
    path: String,
    version: String,
    headers: Vec<(String, String)>,
}

impl Head {
    fn get(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }
}

fn read_head(r: &mut impl BufRead) -> std::io::Result<Option<Head>> {
    let mut first = String::new();
    if r.read_line(&mut first)? == 0 {
        return Ok(None);
    }
    let mut parts = first.trim_end().splitn(3, ' ');
    let (method, path, version) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""), parts.next().unwrap_or("HTTP/1.1"));
    let mut headers = Vec::new();
    let mut total = first.len();
    loop {
        let mut line = String::new();
        let n = r.read_line(&mut line)?;
        total += n;
        if n == 0 || total > MAX_HEAD {
            return Err(std::io::Error::other("bad request head"));
        }
        let line = line.trim_end_matches(['\r', '\n']);
        if line.is_empty() {
            break;
        }
        if let Some((k, v)) = line.split_once(':') {
            headers.push((k.trim().to_owned(), v.trim().to_owned()));
        }
    }
    Ok(Some(Head { method: method.to_owned(), path: path.to_owned(), version: version.to_owned(), headers }))
}

/// A chunked body, decoded.
fn read_chunked(r: &mut impl BufRead) -> std::io::Result<Vec<u8>> {
    let mut out = Vec::new();
    loop {
        let mut size = String::new();
        r.read_line(&mut size)?;
        let n = usize::from_str_radix(size.trim().split(';').next().unwrap_or("0"), 16).map_err(std::io::Error::other)?;
        if n == 0 {
            // Trailers, up to the empty line.
            loop {
                let mut line = String::new();
                if r.read_line(&mut line)? == 0 || line.trim().is_empty() {
                    break;
                }
            }
            return Ok(out);
        }
        let start = out.len();
        out.resize(start + n, 0);
        r.read_exact(&mut out[start..])?;
        let mut crlf = [0u8; 2];
        r.read_exact(&mut crlf)?;
    }
}

fn serve(client: TcpStream, upstream: u16, log: &Log, _replay: bool) -> std::io::Result<()> {
    client.set_read_timeout(Some(Duration::from_secs(300)))?;
    let mut reader = BufReader::new(client.try_clone()?);
    let Some(head) = read_head(&mut reader)? else { return Ok(()) };
    let websocket = head.get("upgrade").is_some_and(|u| u.eq_ignore_ascii_case("websocket"));
    let body = if websocket {
        Vec::new()
    } else if head.get("transfer-encoding").is_some_and(|t| t.to_ascii_lowercase().contains("chunked")) {
        read_chunked(&mut reader)?
    } else {
        let n: usize = head.get("content-length").and_then(|v| v.parse().ok()).unwrap_or(0);
        let mut b = vec![0u8; n];
        reader.read_exact(&mut b)?;
        b
    };

    let replay = head.get("x-zefaro-replay").is_some();
    let kept = &body[..body.len().min(KEEP_BODY)];
    let (text, binary) = match std::str::from_utf8(kept) {
        Ok(s) => (s.to_owned(), false),
        Err(_) => (String::new(), !kept.is_empty()),
    };
    let shown: Vec<(String, String)> = head
        .headers
        .iter()
        .filter(|(k, _)| !k.eq_ignore_ascii_case("x-zefaro-replay"))
        .map(|(k, v)| if k.eq_ignore_ascii_case("authorization") { (k.clone(), mask(v)) } else { (k.clone(), v.clone()) })
        .collect();
    let started = Instant::now();
    let id = log.push(
        Recorded {
            id: 0,
            at_ms: now_ms(),
            method: head.method.clone(),
            path: head.path.clone(),
            headers: shown,
            body: text,
            binary,
            body_bytes: body.len() as u64,
            truncated: body.len() > KEEP_BODY,
            status: None,
            duration_ms: None,
            websocket,
            replay,
        },
        if body.len() > KEEP_BODY { Vec::new() } else { body.clone() },
    );
    if let Some(auth) = head.get("authorization") {
        log.auth.lock().unwrap().insert(id, auth.to_owned());
    }

    let mut up = match TcpStream::connect(("127.0.0.1", upstream)) {
        Ok(s) => s,
        Err(e) => {
            log.finish(id, None, started);
            let mut c = client;
            let _ = c.write_all(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            return Err(e);
        }
    };
    up.set_read_timeout(Some(Duration::from_secs(300)))?;
    let mut out = format!("{} {} {}\r\n", head.method, head.path, head.version);
    for (k, v) in &head.headers {
        let lower = k.to_ascii_lowercase();
        let hop = matches!(lower.as_str(), "transfer-encoding" | "content-length" | "keep-alive" | "x-zefaro-replay")
            || (lower == "connection" && !websocket);
        if !hop {
            out.push_str(&format!("{k}: {v}\r\n"));
        }
    }
    if websocket {
        out.push_str("\r\n");
    } else {
        out.push_str(&format!("Content-Length: {}\r\nConnection: close\r\n\r\n", body.len()));
    }
    up.write_all(out.as_bytes())?;
    up.write_all(&body)?;

    // The status line, then everything else as it comes.
    let mut up_reader = BufReader::new(up.try_clone()?);
    let mut status_line = String::new();
    up_reader.read_line(&mut status_line)?;
    let status = status_line.split_whitespace().nth(1).and_then(|s| s.parse().ok());
    log.finish(id, status, started);
    let mut c = client;
    c.write_all(status_line.as_bytes())?;
    if websocket && status == Some(101) {
        // Both ways until either side closes.
        let (mut c2, mut up2) = (c.try_clone()?, up.try_clone()?);
        let pending: Vec<u8> = reader.buffer().to_vec();
        let back = std::thread::spawn(move || {
            let _ = std::io::copy(&mut up_reader, &mut c2);
            let _ = c2.shutdown(Shutdown::Write);
        });
        up2.write_all(&pending)?;
        let mut rest = reader.into_inner();
        let _ = std::io::copy(&mut rest, &mut up2);
        let _ = up2.shutdown(Shutdown::Write);
        let _ = back.join();
        return Ok(());
    }
    std::io::copy(&mut up_reader, &mut c)?;
    let _ = c.shutdown(Shutdown::Write);
    Ok(())
}

fn mask(v: &str) -> String {
    match v.split_once(' ') {
        Some((scheme, _)) => format!("{scheme} ••••"),
        None => "••••".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A one-request upstream that answers with what it got.
    fn echo_server() -> (u16, std::thread::JoinHandle<()>) {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let h = std::thread::spawn(move || {
            for conn in l.incoming().take(3) {
                let mut s = conn.unwrap();
                let mut r = BufReader::new(s.try_clone().unwrap());
                let head = read_head(&mut r).unwrap().unwrap();
                let n: usize = head.get("content-length").and_then(|v| v.parse().ok()).unwrap_or(0);
                let mut body = vec![0u8; n];
                r.read_exact(&mut body).unwrap();
                let reply = format!("{} {} close={} body={}", head.method, head.path, head.get("connection").unwrap_or(""), String::from_utf8_lossy(&body));
                let status = if head.path.starts_with("/missing") { "404 Not Found" } else { "200 OK" };
                write!(s, "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{reply}", reply.len()).unwrap();
            }
        });
        (port, h)
    }

    fn send(port: u16, raw: &str) -> String {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.write_all(raw.as_bytes()).unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).unwrap();
        out
    }

    #[test]
    fn records_requests_and_passes_them_on() {
        let (upstream, server) = echo_server();
        let insp = Inspector::start(upstream).unwrap();
        let json = r#"{"event":"payment.paid","id":42}"#;
        let reply = send(
            insp.port,
            &format!("POST /webhooks/pay?x=1 HTTP/1.1\r\nHost: calm.trycloudflare.com\r\nContent-Type: application/json\r\nAuthorization: Basic emVmYXJvOnB3\r\nContent-Length: {}\r\n\r\n{json}", json.len()),
        );
        assert!(reply.starts_with("HTTP/1.1 200 OK"), "{reply}");
        assert!(reply.ends_with(&format!("POST /webhooks/pay?x=1 close=close body={json}")), "{reply}");
        // A chunked body arrives whole, with a length.
        let reply = send(insp.port, "PUT /missing HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n");
        assert!(reply.starts_with("HTTP/1.1 404") && reply.ends_with("body=hello world"), "{reply}");

        let list = insp.list();
        assert_eq!(list.len(), 2);
        assert_eq!((list[0].method.as_str(), list[0].status), ("PUT", Some(404)), "newest first");
        let first = insp.get(list[1].id).unwrap();
        assert_eq!((first.path.as_str(), first.status, first.body.as_str()), ("/webhooks/pay?x=1", Some(200), json));
        let auth = first.headers.iter().find(|(k, _)| k == "Authorization").unwrap();
        assert_eq!(auth.1, "Basic ••••", "the share password isn't shown");

        // Sent again: same request, recorded as a replay.
        let again = insp.replay(first.id).unwrap();
        let r = insp.get(again).unwrap();
        assert!(r.replay && r.status == Some(200) && r.body == json, "{r:?}");
        server.join().unwrap();
    }
}
