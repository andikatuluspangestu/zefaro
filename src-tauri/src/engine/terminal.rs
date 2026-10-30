//! Terminals inside Zefaro: a shell (PowerShell, Command Prompt, Git Bash) on a
//! Windows pseudo console (ConPTY), with Zefaro's PHP, Composer, Node.js and
//! database clients first on PATH.
//!
//! A terminal lives here, not in the page that shows it. The shell keeps
//! running when you switch pages or close the window to the tray, and the last
//! [`SCROLLBACK`] bytes of output are replayed when a page attaches again. Its
//! processes run in a Job Object, so closing the terminal or quitting Zefaro
//! ends everything started in it (`npm run dev` included).

use crate::engine::supervisor::job::Job;
use crate::engine::{apps, laravel, node, paths, php, process};
use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::collections::BTreeMap;
use std::ffi::OsString;
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

/// Output kept for replaying when a page attaches again.
pub const SCROLLBACK: usize = 1024 * 1024;
const MAX_TERMINALS: usize = 16;

/// A shell Zefaro can open.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Shell {
    /// "pwsh", "powershell", "cmd" or "bash".
    pub id: String,
    pub name: String,
    #[serde(skip)]
    pub exe: PathBuf,
    #[serde(skip)]
    pub args: Vec<String>,
}

fn shell(id: &str, name: &str, exe: PathBuf, args: &[&str]) -> Shell {
    Shell { id: id.into(), name: name.into(), exe, args: args.iter().map(|a| (*a).to_owned()).collect() }
}

/// The shells on this computer, the default first: PowerShell 7 when it is
/// installed, then Windows PowerShell, Command Prompt and Git Bash.
pub fn shells() -> Vec<Shell> {
    let system = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
    let found = apps::detect();
    let exe_of = |id: &str| found.iter().find(|a| a.id == id).map(|a| a.exe.clone());
    // RemoteSigned for this process only: Windows PowerShell's default policy
    // would refuse every script, including the ones npm installs.
    let ps_args = ["-NoLogo", "-ExecutionPolicy", "RemoteSigned"];
    let mut out = Vec::new();
    if let Some(exe) = exe_of("pwsh") {
        out.push(shell("pwsh", "PowerShell 7", exe, &ps_args));
    }
    let powershell = system.join(r"System32\WindowsPowerShell\v1.0\powershell.exe");
    if powershell.is_file() {
        out.push(shell("powershell", "Windows PowerShell", powershell, &ps_args));
    }
    let cmd = std::env::var_os("ComSpec").map(PathBuf::from).unwrap_or_else(|| system.join(r"System32\cmd.exe"));
    out.push(shell("cmd", "Command Prompt", cmd, &[]));
    // git-bash.exe opens its own window; bin\bash.exe runs in ours.
    if let Some(bash) = exe_of("gitbash").and_then(|g| g.parent().map(|d| d.join(r"bin\bash.exe"))).filter(|b| b.is_file()) {
        out.push(shell("bash", "Git Bash", bash, &["--login", "-i"]));
    }
    out
}

/// PATH for a terminal: the PHP line first (the site's, or the active one),
/// then Zefaro's bin folder (composer, laravel, node, npm, mysql, psql, …) and
/// Node.js, then the user's own PATH.
pub fn search_path(php_line: Option<&str>) -> OsString {
    if let Some(line) = php_line.filter(|l| php::is_installed(l)) {
        return laravel::tool_path(line);
    }
    let mut dirs = vec![paths::bin_dir()];
    let cfg = crate::config::load();
    if node::is_installed(&cfg.node_default) {
        dirs.push(node::dir(&cfg.node_default));
    }
    if let Some(existing) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&existing));
    }
    std::env::join_paths(dirs).unwrap_or_default()
}

/// The environment a shell starts with: this process's, without the coding
/// agent markers and with Zefaro's PATH, sorted by name as Windows expects.
pub fn environment(
    base: impl IntoIterator<Item = (OsString, OsString)>,
    path: OsString,
    shell_id: &str,
) -> Vec<(OsString, OsString)> {
    let upper = |k: &OsString| k.to_string_lossy().to_ascii_uppercase();
    let mut vars: BTreeMap<String, (OsString, OsString)> = base
        .into_iter()
        .filter(|(k, _)| {
            let key = upper(k);
            key != "PATH" && !process::AGENT_VARS.iter().any(|a| a.eq_ignore_ascii_case(&key))
        })
        .map(|(k, v)| (upper(&k), (k, v)))
        .collect();
    let mut set = |k: &str, v: OsString| {
        vars.insert(k.to_ascii_uppercase(), (k.into(), v));
    };
    set("Path", path);
    set("COMPOSER_HOME", paths::composer_home().into_os_string());
    set("COLORTERM", "truecolor".into());
    if shell_id == "bash" {
        // A login shell would otherwise start in the home folder.
        set("CHERE_INVOKING", "1".into());
    }
    vars.into_values().collect()
}

/// `"exe" arg arg`, as CreateProcess takes it.
pub fn command_line(exe: &Path, args: &[String]) -> String {
    let mut line = format!("\"{}\"", exe.display());
    for a in args {
        line.push(' ');
        line.push_str(a);
    }
    line
}

/// Keep the last `cap` bytes (with some slack, so trimming isn't done on
/// every chunk), starting at a line so a replay doesn't begin inside an escape
/// sequence or a UTF-8 character.
pub fn keep_tail(buf: &mut Vec<u8>, chunk: &[u8], cap: usize) {
    buf.extend_from_slice(chunk);
    if buf.len() > cap + cap / 4 {
        let cut = buf.len() - cap;
        let start = memchr::memchr(b'\n', &buf[cut..]).map(|i| cut + i + 1).unwrap_or(cut);
        buf.drain(..start);
    }
}

/// What the Terminal page shows about one terminal.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TerminalInfo {
    pub id: u32,
    pub title: String,
    pub shell: String,
    pub shell_name: String,
    pub cwd: String,
    pub site: Option<String>,
    pub php: Option<String>,
    /// Set once the shell has ended.
    pub exit_code: Option<u32>,
    pub started_ms: u64,
}

/// Where and how to open a terminal; resolved by the command layer.
pub struct OpenRequest {
    pub shell: Shell,
    pub cwd: PathBuf,
    pub site: Option<String>,
    pub php: Option<String>,
    pub cols: u16,
    pub rows: u16,
}

/// Receives output; returns false when nobody listens any more.
pub type Sink = Box<dyn Fn(&[u8]) -> bool + Send>;
/// Told when a terminal's shell has ended and all its output was read.
pub type ExitFn = Arc<dyn Fn(u32, Option<u32>) + Send + Sync>;

struct Output {
    buffer: Vec<u8>,
    sink: Option<Sink>,
}

pub struct Terminal {
    info: Mutex<TerminalInfo>,
    input: Mutex<File>,
    pty: sys::Pty,
    job: Job,
    output: Mutex<Output>,
}

impl Terminal {
    pub fn info(&self) -> TerminalInfo {
        self.info.lock().unwrap().clone()
    }

    pub fn write(&self, data: &[u8]) -> AppResult<()> {
        if self.info.lock().unwrap().exit_code.is_some() {
            return Ok(());
        }
        let mut input = self.input.lock().unwrap();
        input.write_all(data)?;
        input.flush()?;
        Ok(())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> AppResult<()> {
        self.pty.resize(cols.clamp(2, 1000), rows.clamp(1, 500))
    }

    /// Send what was kept, then everything new, to `sink`.
    pub fn attach(&self, sink: Sink) {
        let mut out = self.output.lock().unwrap();
        if out.buffer.is_empty() || sink(&out.buffer) {
            out.sink = Some(sink);
        }
    }

    pub fn detach(&self) {
        self.output.lock().unwrap().sink = None;
    }

    /// End the shell and everything it started.
    pub fn kill(&self) {
        self.job.terminate();
    }

    fn deliver(&self, chunk: &[u8]) {
        let mut out = self.output.lock().unwrap();
        keep_tail(&mut out.buffer, chunk, SCROLLBACK);
        if out.sink.as_ref().is_some_and(|s| !s(chunk)) {
            out.sink = None;
        }
    }
}

/// Every open terminal, by id.
#[derive(Default)]
pub struct Terminals {
    next: AtomicU32,
    open: Mutex<BTreeMap<u32, Arc<Terminal>>>,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

impl Terminals {
    /// Start a shell. `on_exit` is called once it has ended and its last
    /// output was delivered.
    pub fn open(&self, req: OpenRequest, on_exit: ExitFn) -> AppResult<TerminalInfo> {
        if self.open.lock().unwrap().len() >= MAX_TERMINALS {
            return Err(AppError::msg(crate::tr!(
                format!("Zefaro keeps at most {MAX_TERMINALS} terminals open. Close one first."),
                format!("Zefaro membuka paling banyak {MAX_TERMINALS} terminal. Tutup salah satunya dulu.")
            )));
        }
        if !req.cwd.is_dir() {
            let cwd = req.cwd.display();
            return Err(AppError::msg(crate::tr!(
                format!("The folder {cwd} doesn't exist."),
                format!("Folder {cwd} tidak ada.")
            )));
        }
        let env = environment(std::env::vars_os(), search_path(req.php.as_deref()), &req.shell.id);
        let job = Job::new()?;
        let spawned = sys::spawn(&command_line(&req.shell.exe, &req.shell.args), &req.cwd, &env, req.cols, req.rows, &job)?;
        let id = self.next.fetch_add(1, Ordering::Relaxed) + 1;
        let folder = req.cwd.file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_else(|| req.cwd.display().to_string());
        let terminal = Arc::new(Terminal {
            info: Mutex::new(TerminalInfo {
                id,
                title: req.site.clone().unwrap_or(folder),
                shell: req.shell.id.clone(),
                shell_name: req.shell.name.clone(),
                cwd: req.cwd.display().to_string(),
                site: req.site,
                php: req.php,
                exit_code: None,
                started_ms: now_ms(),
            }),
            input: Mutex::new(spawned.input),
            pty: spawned.pty,
            job,
            output: Mutex::new(Output { buffer: Vec::new(), sink: None }),
        });

        let reader = {
            let terminal = terminal.clone();
            let mut output = spawned.output;
            std::thread::spawn(move || {
                let mut buf = vec![0u8; 64 * 1024];
                // A closed pseudo console ends the pipe: read returns 0 or an error.
                while let Ok(n @ 1..) = output.read(&mut buf) {
                    terminal.deliver(&buf[..n]);
                }
            })
        };
        {
            let terminal = terminal.clone();
            let process = spawned.process;
            std::thread::spawn(move || {
                let code = sys::wait(&process);
                // Closing the pseudo console flushes its last output into the
                // pipe; the reader drains it, then sees the end.
                terminal.pty.close();
                let _ = reader.join();
                terminal.info.lock().unwrap().exit_code = Some(code.unwrap_or(1));
                on_exit(id, code);
            });
        }
        let info = terminal.info();
        self.open.lock().unwrap().insert(id, terminal);
        Ok(info)
    }

    pub fn get(&self, id: u32) -> AppResult<Arc<Terminal>> {
        self.open.lock().unwrap().get(&id).cloned().ok_or_else(|| {
            AppError::msg(crate::tr!("That terminal is no longer open.", "Terminal itu sudah tidak terbuka."))
        })
    }

    pub fn list(&self) -> Vec<TerminalInfo> {
        self.open.lock().unwrap().values().map(|t| t.info()).collect()
    }

    /// End a terminal's shell (if it still runs) and forget it.
    pub fn close(&self, id: u32) {
        if let Some(t) = self.open.lock().unwrap().remove(&id) {
            t.detach();
            t.kill();
        }
    }

    pub fn close_all(&self) {
        let all: Vec<Arc<Terminal>> = std::mem::take(&mut *self.open.lock().unwrap()).into_values().collect();
        for t in all {
            t.detach();
            t.kill();
        }
    }
}

#[cfg(windows)]
mod sys {
    //! ConPTY through kernel32. The three pseudo console functions are looked
    //! up at run time: they exist from Windows 10 1809 on, and a missing
    //! import would keep Zefaro from starting at all on anything older.

    use crate::engine::supervisor::job::Job;
    use crate::error::{AppError, AppResult};
    use std::ffi::{c_void, OsStr, OsString};
    use std::fs::File;
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use std::path::Path;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::OnceLock;
    use windows_sys::Win32::Foundation::{HANDLE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};
    use windows_sys::Win32::System::Pipes::CreatePipe;
    use windows_sys::Win32::System::Threading::{
        CreateProcessW, DeleteProcThreadAttributeList, GetExitCodeProcess, InitializeProcThreadAttributeList,
        ResumeThread, TerminateProcess, UpdateProcThreadAttribute, WaitForSingleObject, CREATE_SUSPENDED,
        CREATE_UNICODE_ENVIRONMENT, EXTENDED_STARTUPINFO_PRESENT, INFINITE, PROCESS_INFORMATION,
        PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE, STARTF_USESTDHANDLES, STARTUPINFOEXW,
    };

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct Coord {
        x: i16,
        y: i16,
    }

    type CreateFn = unsafe extern "system" fn(Coord, HANDLE, HANDLE, u32, *mut isize) -> i32;
    type ResizeFn = unsafe extern "system" fn(isize, Coord) -> i32;
    type CloseFn = unsafe extern "system" fn(isize);

    struct Api {
        create: CreateFn,
        resize: ResizeFn,
        close: CloseFn,
    }

    fn wide(s: &OsStr) -> Vec<u16> {
        s.encode_wide().chain(std::iter::once(0)).collect()
    }

    fn api() -> AppResult<&'static Api> {
        static API: OnceLock<Option<Api>> = OnceLock::new();
        API.get_or_init(|| {
            let kernel32 = wide(OsStr::new("kernel32.dll"));
            // SAFETY: kernel32 is loaded in every process; the names are
            // NUL-terminated, and each pointer is cast to its documented signature.
            unsafe {
                let module = GetModuleHandleW(kernel32.as_ptr());
                if module.is_null() {
                    return None;
                }
                let create = GetProcAddress(module, c"CreatePseudoConsole".as_ptr().cast())?;
                let resize = GetProcAddress(module, c"ResizePseudoConsole".as_ptr().cast())?;
                let close = GetProcAddress(module, c"ClosePseudoConsole".as_ptr().cast())?;
                Some(Api {
                    create: std::mem::transmute::<unsafe extern "system" fn() -> isize, CreateFn>(create),
                    resize: std::mem::transmute::<unsafe extern "system" fn() -> isize, ResizeFn>(resize),
                    close: std::mem::transmute::<unsafe extern "system" fn() -> isize, CloseFn>(close),
                })
            }
        })
        .as_ref()
        .ok_or_else(|| {
            AppError::msg(crate::tr!(
                "The Terminal needs Windows 10 version 1809 or later.",
                "Terminal memerlukan Windows 10 versi 1809 atau yang lebih baru."
            ))
        })
    }

    fn os_error(what: &str) -> AppError {
        let e = std::io::Error::last_os_error();
        AppError::msg(crate::tr!(format!("{what} failed: {e}"), format!("{what} gagal: {e}")))
    }

    /// A pseudo console; closed once, by [`close`](Pty::close) or on drop.
    pub struct Pty {
        handle: isize,
        closed: AtomicBool,
    }

    impl Pty {
        pub fn resize(&self, cols: u16, rows: u16) -> AppResult<()> {
            if self.closed.load(Ordering::Acquire) {
                return Ok(());
            }
            let size = Coord { x: cols as i16, y: rows as i16 };
            // SAFETY: the handle stays valid until close, checked above.
            let hr = unsafe { (api()?.resize)(self.handle, size) };
            if hr < 0 {
                return Err(AppError::msg(format!("ResizePseudoConsole: 0x{hr:08x}")));
            }
            Ok(())
        }

        /// Blocks until the console host has written its last output, so the
        /// output pipe must still be read while this runs.
        pub fn close(&self) {
            if !self.closed.swap(true, Ordering::AcqRel) {
                if let Ok(api) = api() {
                    // SAFETY: closed exactly once, guarded by `closed`.
                    unsafe { (api.close)(self.handle) };
                }
            }
        }
    }

    impl Drop for Pty {
        fn drop(&mut self) {
            self.close();
        }
    }

    pub struct Spawned {
        pub pty: Pty,
        pub input: File,
        pub output: File,
        pub process: OwnedHandle,
    }

    fn pipe() -> AppResult<(OwnedHandle, OwnedHandle)> {
        let (mut read, mut write): (HANDLE, HANDLE) = (std::ptr::null_mut(), std::ptr::null_mut());
        // SAFETY: both out-pointers are valid; the handles are owned right away.
        if unsafe { CreatePipe(&mut read, &mut write, std::ptr::null(), 0) } == 0 {
            return Err(os_error("CreatePipe"));
        }
        // SAFETY: CreatePipe returned two new handles that nothing else owns.
        Ok(unsafe { (OwnedHandle::from_raw_handle(read), OwnedHandle::from_raw_handle(write)) })
    }

    /// `K=V\0K=V\0\0` in UTF-16.
    fn env_block(env: &[(OsString, OsString)]) -> Vec<u16> {
        let mut block = Vec::new();
        for (k, v) in env {
            block.extend(k.encode_wide());
            block.push(b'=' as u16);
            block.extend(v.encode_wide());
            block.push(0);
        }
        block.push(0);
        block
    }

    pub fn spawn(
        command_line: &str,
        cwd: &Path,
        env: &[(OsString, OsString)],
        cols: u16,
        rows: u16,
        job: &Job,
    ) -> AppResult<Spawned> {
        let api = api()?;
        let (in_read, in_write) = pipe()?;
        let (out_read, out_write) = pipe()?;
        let mut handle: isize = 0;
        let size = Coord { x: cols.clamp(2, 1000) as i16, y: rows.clamp(1, 500) as i16 };
        // SAFETY: the pipe handles are valid; the console duplicates them.
        let hr = unsafe { (api.create)(size, in_read.as_raw_handle(), out_write.as_raw_handle(), 0, &mut handle) };
        if hr < 0 {
            return Err(AppError::msg(format!("CreatePseudoConsole: 0x{hr:08x}")));
        }
        let pty = Pty { handle, closed: AtomicBool::new(false) };
        // The console host holds its own copies; ours would keep the pipes open
        // after it ends, and the reader would never see the end.
        drop(in_read);
        drop(out_write);
        let output = File::from(out_read);
        let input = File::from(in_write);

        let mut size = 0usize;
        // SAFETY: a null list asks for the required size only.
        unsafe { InitializeProcThreadAttributeList(std::ptr::null_mut(), 1, 0, &mut size) };
        let mut list = vec![0usize; size.div_ceil(std::mem::size_of::<usize>())];
        let list_ptr = list.as_mut_ptr().cast::<c_void>();
        // SAFETY: `list` is at least `size` bytes, aligned for the list.
        if unsafe { InitializeProcThreadAttributeList(list_ptr, 1, 0, &mut size) } == 0 {
            return Err(os_error("InitializeProcThreadAttributeList"));
        }
        // SAFETY: the pseudo console attribute takes the HPCON value itself.
        let ok = unsafe {
            UpdateProcThreadAttribute(
                list_ptr,
                0,
                PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE as usize,
                handle as *const c_void,
                std::mem::size_of::<isize>(),
                std::ptr::null_mut(),
                std::ptr::null(),
            )
        };
        if ok == 0 {
            let e = os_error("UpdateProcThreadAttribute");
            // SAFETY: initialised above.
            unsafe { DeleteProcThreadAttributeList(list_ptr) };
            return Err(e);
        }

        // SAFETY: STARTUPINFOEXW is plain data; zeroed is its empty value.
        let mut si: STARTUPINFOEXW = unsafe { std::mem::zeroed() };
        si.StartupInfo.cb = std::mem::size_of::<STARTUPINFOEXW>() as u32;
        // Invalid standard handles make the shell use the pseudo console.
        // Otherwise it can take this process's console or redirected handles
        // (`tauri dev`, tests) and its output never reaches the terminal.
        si.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
        si.StartupInfo.hStdInput = INVALID_HANDLE_VALUE;
        si.StartupInfo.hStdOutput = INVALID_HANDLE_VALUE;
        si.StartupInfo.hStdError = INVALID_HANDLE_VALUE;
        si.lpAttributeList = list_ptr;
        // SAFETY: as above.
        let mut pi: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };
        let mut line: Vec<u16> = OsStr::new(command_line).encode_wide().chain(std::iter::once(0)).collect();
        let dir = wide(cwd.as_os_str());
        let block = env_block(env);
        // SAFETY: every buffer is NUL-terminated and outlives the call; the
        // command line is writable as CreateProcessW requires.
        let ok = unsafe {
            CreateProcessW(
                std::ptr::null(),
                line.as_mut_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                0,
                EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT | CREATE_SUSPENDED,
                block.as_ptr().cast(),
                dir.as_ptr(),
                &si.StartupInfo,
                &mut pi,
            )
        };
        let spawn_error = (ok == 0).then(|| os_error("CreateProcess"));
        // SAFETY: initialised above and no longer needed once the process exists.
        unsafe { DeleteProcThreadAttributeList(list_ptr) };
        if let Some(e) = spawn_error {
            // Drop the pipe ends first: the console host then ends at once.
            drop(output);
            drop(input);
            return Err(e);
        }
        // SAFETY: CreateProcessW returned these handles to us.
        let process = unsafe { OwnedHandle::from_raw_handle(pi.hProcess) };
        let thread = unsafe { OwnedHandle::from_raw_handle(pi.hThread) };
        // Into the job before it runs, so nothing it starts can escape it.
        if let Err(e) = job.assign_handle(process.as_raw_handle()) {
            // SAFETY: the process handle is valid.
            unsafe { TerminateProcess(process.as_raw_handle(), 1) };
            return Err(e);
        }
        // SAFETY: the thread handle is valid.
        unsafe { ResumeThread(thread.as_raw_handle()) };
        drop(thread);
        Ok(Spawned { pty, input, output, process })
    }

    /// Block until the process ends; its exit code.
    pub fn wait(process: &OwnedHandle) -> Option<u32> {
        let mut code = 0u32;
        // SAFETY: the handle is valid for both calls.
        unsafe {
            WaitForSingleObject(process.as_raw_handle(), INFINITE);
            (GetExitCodeProcess(process.as_raw_handle(), &mut code) != 0).then_some(code)
        }
    }
}

#[cfg(not(windows))]
mod sys {
    use crate::engine::supervisor::job::Job;
    use crate::error::{AppError, AppResult};
    use std::ffi::OsString;
    use std::fs::File;
    use std::path::Path;

    pub struct Pty;
    impl Pty {
        pub fn resize(&self, _cols: u16, _rows: u16) -> AppResult<()> {
            Ok(())
        }
        pub fn close(&self) {}
    }
    pub struct Spawned {
        pub pty: Pty,
        pub input: File,
        pub output: File,
        pub process: (),
    }
    pub fn spawn(_: &str, _: &Path, _: &[(OsString, OsString)], _: u16, _: u16, _: &Job) -> AppResult<Spawned> {
        Err(AppError::msg("The Terminal needs Windows."))
    }
    pub fn wait(_: &()) -> Option<u32> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_the_tail_from_a_line_start() {
        let mut buf = Vec::new();
        keep_tail(&mut buf, b"aaaa\nbbbb\n", 8);
        assert_eq!(buf, b"aaaa\nbbbb\n", "within the slack, nothing is trimmed");
        keep_tail(&mut buf, b"cccc\ndd", 8);
        assert_eq!(buf, b"cccc\ndd", "trimmed to the first line inside the last 8 bytes");
    }

    #[test]
    fn environment_replaces_path_and_drops_agent_markers() {
        let base = [("Path", r"C:\Windows"), ("CLAUDECODE", "1"), ("term_program", "vscode"), ("USERPROFILE", r"C:\Users\dev")]
            .map(|(k, v)| (OsString::from(k), OsString::from(v)));
        let env = environment(base, OsString::from(r"C:\zefaro\bin;C:\Windows"), "bash");
        let get = |k: &str| env.iter().find(|(n, _)| n.eq_ignore_ascii_case(k)).map(|(_, v)| v.to_string_lossy().into_owned());
        assert_eq!(get("PATH").as_deref(), Some(r"C:\zefaro\bin;C:\Windows"));
        assert_eq!(env.iter().filter(|(n, _)| n.eq_ignore_ascii_case("PATH")).count(), 1);
        assert_eq!(get("CLAUDECODE"), None);
        assert_eq!(get("TERM_PROGRAM"), None);
        assert_eq!(get("COLORTERM").as_deref(), Some("truecolor"));
        assert_eq!(get("CHERE_INVOKING").as_deref(), Some("1"));
        assert!(get("COMPOSER_HOME").is_some_and(|h| h.ends_with("composer")));
        let names: Vec<String> = env.iter().map(|(k, _)| k.to_string_lossy().to_ascii_uppercase()).collect();
        assert!(names.windows(2).all(|w| w[0] <= w[1]), "sorted: {names:?}");
    }

    #[test]
    fn command_line_quotes_the_program() {
        let line = command_line(Path::new(r"C:\Program Files\PowerShell\7\pwsh.exe"), &["-NoLogo".into()]);
        assert_eq!(line, r#""C:\Program Files\PowerShell\7\pwsh.exe" -NoLogo"#);
    }

    #[test]
    fn command_prompt_is_always_offered() {
        let list = shells();
        assert!(list.iter().any(|s| s.id == "cmd" && s.exe.to_string_lossy().to_ascii_lowercase().ends_with("cmd.exe")));
    }

    fn ping_count() -> usize {
        let out = process::command("tasklist").args(["/FI", "IMAGENAME eq PING.EXE", "/NH"]).output().unwrap();
        String::from_utf8_lossy(&out.stdout).lines().filter(|l| l.to_ascii_lowercase().starts_with("ping.exe")).count()
    }

    fn wait_until(what: &str, mut ok: impl FnMut() -> bool) {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
        while !ok() {
            assert!(std::time::Instant::now() < deadline, "timed out waiting for {what}");
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    }

    /// Command Prompt on a real pseudo console: output arrives with Zefaro's
    /// environment, a late page gets the replay, resize works, `exit 3`
    /// reports 3, and closing a terminal ends what runs in it.
    #[test]
    #[ignore = "starts Command Prompt on a pseudo console; run with --ignored"]
    fn live_command_prompt_on_a_pseudo_console() {
        let terminals = Terminals::default();
        let exits: Arc<Mutex<Vec<(u32, Option<u32>)>>> = Arc::default();
        let on_exit: ExitFn = {
            let exits = exits.clone();
            Arc::new(move |id, code| exits.lock().unwrap().push((id, code)))
        };
        let cmd = shells().into_iter().find(|s| s.id == "cmd").unwrap();
        let open = |terminals: &Terminals| {
            terminals
                .open(
                    OpenRequest { shell: cmd.clone(), cwd: std::env::temp_dir(), site: None, php: None, cols: 100, rows: 30 },
                    on_exit.clone(),
                )
                .unwrap()
        };

        let first = open(&terminals);
        let t = terminals.get(first.id).unwrap();
        t.write(b"echo zefaro-%COLORTERM%\r\n").unwrap();
        let seen = || String::from_utf8_lossy(&t.output.lock().unwrap().buffer).into_owned();
        wait_until("the echo", || seen().contains("zefaro-truecolor"));

        // A page that attaches late gets everything so far.
        let got: Arc<Mutex<Vec<u8>>> = Arc::default();
        {
            let got = got.clone();
            t.attach(Box::new(move |b| {
                got.lock().unwrap().extend_from_slice(b);
                true
            }));
        }
        assert!(String::from_utf8_lossy(&got.lock().unwrap()).contains("zefaro-truecolor"));
        t.resize(120, 40).unwrap();

        // Something long-running in the terminal ends with it.
        let pings = ping_count();
        t.write(b"ping -n 120 127.0.0.1 > nul\r\n").unwrap();
        wait_until("ping to start", || ping_count() > pings);
        terminals.close(first.id);
        wait_until("ping to end", || ping_count() <= pings);
        wait_until("the first exit", || exits.lock().unwrap().iter().any(|(id, _)| *id == first.id));
        assert!(terminals.get(first.id).is_err());

        let second = open(&terminals);
        terminals.get(second.id).unwrap().write(b"exit 3\r\n").unwrap();
        wait_until("exit 3", || exits.lock().unwrap().contains(&(second.id, Some(3))));
        assert_eq!(terminals.get(second.id).unwrap().info().exit_code, Some(3));
        terminals.close_all();
        assert!(terminals.list().is_empty());
    }

    /// Every shell found on this computer runs a command, and with a PHP line
    /// installed by Zefaro, `php` in the terminal is that line.
    #[test]
    #[ignore = "starts every shell on this computer on a pseudo console; run with --ignored"]
    fn live_every_shell_and_zefaros_php() {
        let terminals = Terminals::default();
        let on_exit: ExitFn = Arc::new(|_, _| {});
        let php_line = php::installed().into_keys().next();
        for shell in shells() {
            let id = shell.id.clone();
            let info = terminals
                .open(
                    OpenRequest { shell, cwd: std::env::temp_dir(), site: None, php: php_line.clone(), cols: 120, rows: 30 },
                    on_exit.clone(),
                )
                .unwrap();
            let t = terminals.get(info.id).unwrap();
            let seen = || String::from_utf8_lossy(&t.output.lock().unwrap().buffer).into_owned();
            t.write(b"echo zefaro-$((6*7))-ok\r").unwrap();
            // PowerShell and cmd print the text as it is; bash works out 6*7.
            wait_until(&format!("{id} to echo"), || {
                let out = seen();
                out.contains("zefaro-42-ok") || out.matches("zefaro-$((6*7))-ok").count() >= 2
            });
            if let Some(line) = &php_line {
                t.write(b"php -r \"echo 'php-' . PHP_MAJOR_VERSION . '.' . PHP_MINOR_VERSION;\"\r").unwrap();
                wait_until(&format!("PHP {line} in {id}"), || seen().contains(&format!("php-{line}")));
            }
            terminals.close(info.id);
        }
    }
}
