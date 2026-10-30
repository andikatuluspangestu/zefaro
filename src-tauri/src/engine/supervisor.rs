//! Runs and watches Zefaro's background services (php-cgi, nginx, …).
//!
//! Each process is spawned with its output appended to a log file and placed
//! in its own Windows Job Object that kills everything inside when closed. So
//! stopping a service takes its child processes with it (nginx's workers), and
//! if Zefaro exits or crashes, Windows cleans up every service — nothing is left
//! holding a port. Health is "the port accepts connections"; a monitor thread
//! calls [`Supervisor::tick`] to restart services that crash.

use crate::engine::locks::KeyedLocks;
use crate::engine::process;
use crate::error::{AppError, AppResult};
use std::collections::HashMap;
use std::ffi::OsString;
use std::fs::{self, OpenOptions};
use std::io::{Read, Seek, SeekFrom};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, ExitStatus, Stdio};
use std::sync::Mutex;
use std::thread::sleep;
use std::time::{Duration, Instant};

/// How long `start` waits for a new process to accept connections.
const START_TIMEOUT: Duration = Duration::from_secs(8);
/// A service that crashes this many times within the window stays stopped.
const MAX_RESTARTS: usize = 3;
const RESTART_WINDOW: Duration = Duration::from_secs(60);

/// Everything needed to (re)start one service process.
#[derive(Clone, Debug)]
pub struct Spec {
    pub id: String,
    pub program: PathBuf,
    pub args: Vec<OsString>,
    pub cwd: PathBuf,
    pub env: Vec<(String, String)>,
    /// stdout and stderr are appended here.
    pub log: PathBuf,
    /// The port the process listens on once it's healthy.
    pub port: u16,
    /// How to tell it's healthy on that port.
    pub probe: Probe,
    /// Graceful shutdown command (e.g. `nginx -s quit`), tried before the job
    /// is killed.
    pub stop: Option<(PathBuf, Vec<OsString>)>,
}

/// Health check for a service's port.
#[derive(Clone, Debug, PartialEq)]
pub enum Probe {
    /// Accepts TCP connections (nginx, php-cgi).
    Tcp,
    /// Answers a DNS query for a name under this TLD over UDP.
    Dns { tld: String },
    /// No port: healthy while the process runs (queue workers, schedulers).
    Alive,
}

fn healthy(spec: &Spec) -> bool {
    match &spec.probe {
        Probe::Tcp => port_open(spec.port),
        Probe::Dns { tld } => crate::engine::dns::probe(spec.port, tld),
        Probe::Alive => true,
    }
}

/// Is the port already taken by something else?
fn port_taken(spec: &Spec) -> bool {
    match spec.probe {
        Probe::Tcp => port_open(spec.port),
        Probe::Dns { .. } => {
            std::net::UdpSocket::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, spec.port))).is_err()
        }
        Probe::Alive => false,
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum Health {
    Stopped,
    /// Process is up but not accepting connections yet (or about to restart).
    Starting,
    Running,
    /// Last run failed; the message says why.
    Failed(String),
}

#[derive(Clone, Debug)]
pub struct ProcStatus {
    pub health: Health,
    pub pid: Option<u32>,
}

struct Proc {
    spec: Spec,
    child: Child,
    job: job::Job,
    /// Recent automatic restarts, for the crash-loop limit.
    restarts: Vec<Instant>,
}

#[derive(Default)]
pub struct Supervisor {
    procs: Mutex<HashMap<String, Proc>>,
    /// Why a service last failed, until it is started or stopped again.
    failures: Mutex<HashMap<String, String>>,
    /// One start/stop at a time per service. Without it, two concurrent starts
    /// both launch a process, and replacing the first in `procs` drops its Job
    /// Object — killing a server that was running fine.
    gates: KeyedLocks,
}

impl Supervisor {
    /// Start a service and wait until it accepts connections. Returns its PID.
    /// Starting an already running (or concurrently starting) service is a no-op.
    pub fn start(&self, spec: Spec) -> AppResult<u32> {
        let gate = self.gates.get(&spec.id);
        let _held = gate.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(pid) = self.procs.lock().unwrap().get(&spec.id).map(|p| p.child.id()) {
            return Ok(pid);
        }
        if port_taken(&spec) {
            return Err(AppError::msg(port_conflict(spec.port, spec.probe != Probe::Tcp)));
        }
        let check = spec.clone();
        let id = spec.id.clone();
        let proc = launch(spec, Vec::new())?;
        let pid = proc.child.id();
        self.failures.lock().unwrap().remove(&id);
        self.procs.lock().unwrap().insert(id.clone(), proc);

        // A process without a port counts as started once it has stayed up
        // for a few seconds (long enough for a cold Laravel boot), so a worker
        // that fails at once reports why.
        if check.probe == Probe::Alive {
            let settle = Instant::now() + Duration::from_secs(3);
            while Instant::now() < settle {
                if let Some(reason) = self.reap_if_exited(&id) {
                    return Err(AppError::msg(reason));
                }
                sleep(Duration::from_millis(150));
            }
            return Ok(pid);
        }
        let deadline = Instant::now() + START_TIMEOUT;
        while Instant::now() < deadline {
            if healthy(&check) {
                return Ok(pid);
            }
            if let Some(reason) = self.reap_if_exited(&id) {
                return Err(AppError::msg(reason));
            }
            sleep(Duration::from_millis(150));
        }
        // Still coming up; status() reports "starting" until the port opens.
        Ok(pid)
    }

    /// Remember why a service couldn't be started, so its card shows it: a start
    /// that fails before anything runs (a port in use) leaves no other trace.
    pub fn record_failure(&self, id: &str, reason: String) {
        if !self.procs.lock().unwrap().contains_key(id) {
            self.failures.lock().unwrap().insert(id.to_owned(), reason);
        }
    }

    /// Stop a service: graceful command first (if any), then kill its job.
    pub fn stop(&self, id: &str) -> AppResult<()> {
        let gate = self.gates.get(id);
        let _held = gate.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        self.failures.lock().unwrap().remove(id);
        let Some(mut proc) = self.procs.lock().unwrap().remove(id) else {
            return Ok(());
        };
        if let Some((program, args)) = &proc.spec.stop {
            let _ = process::command(program)
                .args(args)
                .current_dir(&proc.spec.cwd)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
            // MariaDB can take several seconds to flush InnoDB; the wait ends
            // as soon as the process exits, so quick services stop quickly.
            let deadline = Instant::now() + Duration::from_secs(15);
            while Instant::now() < deadline && matches!(proc.child.try_wait(), Ok(None)) {
                sleep(Duration::from_millis(100));
            }
        }
        proc.job.terminate();
        let _ = proc.child.kill();
        let _ = proc.child.wait();
        Ok(())
    }

    /// Stop (if running) and start with a possibly changed spec — e.g. a new
    /// port or an updated php.ini.
    pub fn restart(&self, spec: Spec) -> AppResult<u32> {
        self.stop(&spec.id)?;
        self.start(spec)
    }

    /// Stop every service through its graceful stop command, in `rank` order
    /// (lowest first). Called when Zefaro exits, so databases flush cleanly
    /// instead of being killed with the Job Object.
    pub fn stop_all(&self, rank: impl Fn(&str) -> u8) {
        for id in ordered(self.running_ids(), rank) {
            let _ = self.stop(&id);
        }
    }

    pub fn is_running(&self, id: &str) -> bool {
        self.procs.lock().unwrap().contains_key(id)
    }

    /// IDs of every service currently supervised.
    pub fn running_ids(&self) -> Vec<String> {
        self.procs.lock().unwrap().keys().cloned().collect()
    }

    pub fn status(&self, id: &str) -> ProcStatus {
        // Copy out what's needed and probe without holding the lock: a DNS
        // probe waits on a UDP round trip.
        let live = self.procs.lock().unwrap().get_mut(id).map(|p| {
            let exited = matches!(p.child.try_wait(), Ok(Some(_)));
            (p.child.id(), p.spec.clone(), exited)
        });
        match live {
            // Exited but not yet handled by tick(): it is about to restart.
            Some((pid, _, true)) => ProcStatus { health: Health::Starting, pid: Some(pid) },
            Some((pid, spec, false)) => ProcStatus {
                health: if healthy(&spec) { Health::Running } else { Health::Starting },
                pid: Some(pid),
            },
            None => ProcStatus {
                health: match self.failures.lock().unwrap().get(id) {
                    Some(reason) => Health::Failed(reason.clone()),
                    None => Health::Stopped,
                },
                pid: None,
            },
        }
    }

    /// Restart services whose process died, unless they're crash-looping.
    /// Called periodically by the monitor thread.
    pub fn tick(&self) {
        let crashed: Vec<(Proc, ExitStatus)> = {
            let mut procs = self.procs.lock().unwrap();
            let dead: Vec<(String, ExitStatus)> = procs
                .iter_mut()
                .filter_map(|(id, p)| p.child.try_wait().ok().flatten().map(|s| (id.clone(), s)))
                .collect();
            dead.into_iter()
                .filter_map(|(id, status)| procs.remove(&id).map(|p| (p, status)))
                .collect()
        };
        for (proc, status) in crashed {
            let id = proc.spec.id.clone();
            let reason = exit_reason(&proc.spec, status);
            let mut restarts = proc.restarts;
            restarts.retain(|t| t.elapsed() < RESTART_WINDOW);
            if restarts.len() >= MAX_RESTARTS {
                self.failures.lock().unwrap().insert(
                    id,
                    crate::tr!(
                        format!("Stopped after crashing {MAX_RESTARTS} times in a minute. {reason}"),
                        format!("Dihentikan setelah crash {MAX_RESTARTS} kali dalam satu menit. {reason}")
                    ),
                );
                continue;
            }
            restarts.push(Instant::now());
            match launch(proc.spec, restarts) {
                Ok(p) => {
                    self.procs.lock().unwrap().insert(id, p);
                }
                Err(e) => {
                    self.failures.lock().unwrap().insert(id, e.to_string());
                }
            }
        }
    }

    /// If the service's process has exited, drop it and record why.
    fn reap_if_exited(&self, id: &str) -> Option<String> {
        let mut procs = self.procs.lock().unwrap();
        let status = procs.get_mut(id)?.child.try_wait().ok().flatten()?;
        let proc = procs.remove(id)?;
        let reason = exit_reason(&proc.spec, status);
        self.failures.lock().unwrap().insert(id.to_owned(), reason.clone());
        Some(reason)
    }
}

/// Service IDs sorted by `rank`, ties by name for a stable order.
fn ordered(mut ids: Vec<String>, rank: impl Fn(&str) -> u8) -> Vec<String> {
    ids.sort_by(|a, b| rank(a).cmp(&rank(b)).then_with(|| a.cmp(b)));
    ids
}

fn launch(spec: Spec, restarts: Vec<Instant>) -> AppResult<Proc> {
    if let Some(dir) = spec.log.parent() {
        fs::create_dir_all(dir)?;
    }
    let log = OpenOptions::new().create(true).append(true).open(&spec.log)?;
    let mut child = process::command(&spec.program)
        .args(&spec.args)
        .current_dir(&spec.cwd)
        .envs(spec.env.iter().map(|(k, v)| (k, v)))
        .stdin(Stdio::null())
        .stdout(Stdio::from(log.try_clone()?))
        .stderr(Stdio::from(log))
        .spawn()
        .map_err(|e| {
            let program = spec.program.display();
            AppError::msg(crate::tr!(
                format!("Could not start {program}: {e}"),
                format!("Tidak dapat memulai {program}: {e}")
            ))
        })?;
    let job = match job::Job::new().and_then(|job| job.assign(&child).map(|_| job)) {
        Ok(job) => job,
        Err(e) => {
            let _ = child.kill();
            return Err(e);
        }
    };
    Ok(Proc { spec, child, job, restarts })
}

fn exit_reason(spec: &Spec, status: ExitStatus) -> String {
    let name = spec.program.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let tail = log_tail(&spec.log, 6);
    if tail.is_empty() {
        crate::tr!(format!("{name} exited ({status})."), format!("{name} keluar ({status})."))
    } else {
        crate::tr!(format!("{name} exited ({status}): {tail}"), format!("{name} keluar ({status}): {tail}"))
    }
}

/// Last `lines` non-empty lines of a log file, reading at most its last 8 KB.
pub fn log_tail(path: &Path, lines: usize) -> String {
    let Ok(mut file) = fs::File::open(path) else {
        return String::new();
    };
    let len = file.metadata().map(|m| m.len()).unwrap_or(0);
    let _ = file.seek(SeekFrom::Start(len.saturating_sub(8 * 1024)));
    let mut buf = Vec::new();
    let _ = file.read_to_end(&mut buf);
    let text = String::from_utf8_lossy(&buf);
    let all: Vec<&str> = text.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    all[all.len().saturating_sub(lines)..].join(" · ")
}

/// Does something accept TCP connections on 127.0.0.1:`port`? Connecting also
/// catches listeners bound to 0.0.0.0, which a bind test on Windows can miss.
pub fn port_open(port: u16) -> bool {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok()
}

/// Which process holds `port` (TCP listener, or UDP socket when `udp`), as
/// (pid, name). Uses the NetTCPIP cmdlets because netstat's output is localized.
pub fn port_owner(port: u16, udp: bool) -> Option<(u32, String)> {
    let lookup = if udp {
        format!("Get-NetUDPEndpoint -LocalPort {port}")
    } else {
        format!("Get-NetTCPConnection -LocalPort {port} -State Listen")
    };
    let script = format!(
        "$c = {lookup} -ErrorAction SilentlyContinue | Select-Object -First 1;\
         if ($c) {{ $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue; '{{0}}|{{1}}' -f $c.OwningProcess, $p.ProcessName }}"
    );
    let out = process::powershell(&script).ok()?;
    let (pid, name) = out.trim().split_once('|')?;
    Some((pid.parse().ok()?, name.to_owned()))
}

pub fn port_conflict(port: u16, udp: bool) -> String {
    match port_owner(port, udp) {
        // PID 4 is the kernel: HTTP.sys, i.e. IIS or another Windows web service.
        Some((4, _)) => crate::tr!(
            format!(
                "Port {port} is held by Windows (PID 4), usually for IIS or another HTTP.sys service. \
                 Stop the World Wide Web Publishing Service and try again."
            ),
            format!(
                "Port {port} dipakai oleh Windows (PID 4), biasanya untuk IIS atau layanan HTTP.sys lain. \
                 Hentikan World Wide Web Publishing Service, lalu coba lagi."
            )
        ),
        Some((pid, name)) => crate::tr!(
            format!("Port {port} is already in use by {name} (PID {pid}). Stop it and try again."),
            format!("Port {port} sudah dipakai oleh {name} (PID {pid}). Hentikan program itu, lalu coba lagi.")
        ),
        None => crate::tr!(
            format!("Port {port} is already in use by another program."),
            format!("Port {port} sudah dipakai oleh program lain.")
        ),
    }
}

#[cfg(windows)]
pub(crate) mod job {
    use crate::error::{AppError, AppResult};
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    /// A Job Object that kills every process in it when closed.
    pub struct Job(HANDLE);

    // The handle is only passed to thread-safe kernel calls.
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}

    fn os_error(what: &str) -> AppError {
        let e = std::io::Error::last_os_error();
        AppError::msg(crate::tr!(format!("{what} failed: {e}"), format!("{what} gagal: {e}")))
    }

    impl Job {
        pub fn new() -> AppResult<Self> {
            // SAFETY: null security attributes and name are allowed; the handle
            // is owned by `Job` and closed in Drop.
            let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
            if handle.is_null() {
                return Err(os_error("CreateJobObject"));
            }
            let job = Job(handle);
            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            // SAFETY: `info` is a valid JOBOBJECT_EXTENDED_LIMIT_INFORMATION and
            // the length passed is its size.
            let ok = unsafe {
                SetInformationJobObject(
                    job.0,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const core::ffi::c_void,
                    std::mem::size_of_val(&info) as u32,
                )
            };
            if ok == 0 {
                return Err(os_error("SetInformationJobObject"));
            }
            Ok(job)
        }

        pub fn assign(&self, child: &Child) -> AppResult<()> {
            self.assign_handle(child.as_raw_handle() as HANDLE)
        }

        /// Like [`assign`](Self::assign), for a process started without
        /// `std::process` (a terminal's shell). `process` must be a valid
        /// process handle.
        pub fn assign_handle(&self, process: HANDLE) -> AppResult<()> {
            // SAFETY: both handles are valid for the duration of the call.
            let ok = unsafe { AssignProcessToJobObject(self.0, process) };
            if ok == 0 {
                return Err(os_error("AssignProcessToJobObject"));
            }
            Ok(())
        }

        /// Kill every process in the job now.
        pub fn terminate(&self) {
            // SAFETY: the handle is valid until Drop.
            unsafe { TerminateJobObject(self.0, 1) };
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            // SAFETY: we own the handle; closing it kills any remaining processes.
            unsafe { CloseHandle(self.0) };
        }
    }
}

#[cfg(not(windows))]
pub(crate) mod job {
    use crate::error::AppResult;
    use std::process::Child;

    pub struct Job;

    impl Job {
        pub fn new() -> AppResult<Self> {
            Ok(Job)
        }
        pub fn assign(&self, _child: &Child) -> AppResult<()> {
            Ok(())
        }
        pub fn terminate(&self) {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn closed_port_is_not_open() {
        // Bind then drop to get a port that is very likely free right now.
        let port = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap().local_addr().unwrap().port();
        assert!(!port_open(port));
        let listener = std::net::TcpListener::bind(("127.0.0.1", port)).unwrap();
        assert!(port_open(port));
        drop(listener);
    }

    /// Three threads start the same service at once (like clicking MariaDB and
    /// phpMyAdmin together): exactly one process, and it stays up.
    #[test]
    #[ignore = "needs PHP 8.3 installed by Zefaro (run with --ignored)"]
    fn live_concurrent_starts_launch_one_process() {
        use crate::engine::php;
        use std::sync::Arc;
        assert!(php::is_installed("8.3"), "install PHP 8.3 in Zefaro first");
        let sup = Arc::new(Supervisor::default());
        let mut spec = php::cgi_spec("8.3", 9596);
        spec.log = std::env::temp_dir().join(format!("zefaro-concurrent-{}.log", std::process::id()));
        let workers: Vec<_> = (0..3)
            .map(|_| {
                let (sup, spec) = (sup.clone(), spec.clone());
                std::thread::spawn(move || sup.start(spec))
            })
            .collect();
        let pids: Vec<u32> = workers.into_iter().map(|w| w.join().unwrap().expect("start")).collect();
        assert!(pids.windows(2).all(|w| w[0] == w[1]), "several processes launched: {pids:?}");
        assert_eq!(sup.status(&spec.id).health, Health::Running, "the first process must survive");
        sup.stop(&spec.id).unwrap();
        assert!(!port_open(9596));
        let _ = fs::remove_file(&spec.log);
    }

    #[test]
    fn shutdown_order_follows_rank() {
        let ids = ["mariadb", "php-8.3", "nginx", "redis", "dns"].map(String::from).to_vec();
        let rank = |id: &str| match id {
            "nginx" => 0,
            "mariadb" | "redis" => 2,
            _ => 1,
        };
        assert_eq!(ordered(ids, rank), ["nginx", "dns", "php-8.3", "mariadb", "redis"]);
    }

    #[test]
    fn log_tail_keeps_last_non_empty_lines() {
        let path = std::env::temp_dir().join(format!("zefaro-tail-{}.log", std::process::id()));
        fs::write(&path, "one\n\ntwo\nthree\n\n").unwrap();
        assert_eq!(log_tail(&path, 2), "two · three");
        assert_eq!(log_tail(&path.with_extension("missing"), 2), "");
        let _ = fs::remove_file(path);
    }
}
