//! Running a program without administrator rights while Zefaro itself runs as
//! administrator. PostgreSQL refuses to start with them ("Execution of
//! PostgreSQL by a user with administrative permissions is not permitted"), so
//! when Zefaro is elevated its service goes through
//! `zefaro.exe --restricted <program> <args…>`. That starts the program with
//! Zefaro's own token minus the Administrators and Power Users groups (as
//! `pg_ctl` does), hands it the log the supervisor gave the helper, and waits
//! for it. The program stays in the helper's Job Object, so stopping the
//! service or Zefaro exiting still ends it.

use crate::engine::supervisor::Spec;
use std::ffi::{OsStr, OsString};
use std::os::windows::ffi::OsStrExt;
use std::os::windows::io::AsRawHandle;

pub const ARG: &str = "--restricted";

/// Zefaro runs as administrator (an elevated token).
pub fn elevated() -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
    unsafe {
        let mut token: HANDLE = std::ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return false;
        }
        let mut e = TOKEN_ELEVATION { TokenIsElevated: 0 };
        let mut len = 0u32;
        let ok = GetTokenInformation(token, TokenElevation, (&mut e as *mut TOKEN_ELEVATION).cast(), size_of::<TOKEN_ELEVATION>() as u32, &mut len);
        CloseHandle(token);
        ok != 0 && e.TokenIsElevated != 0
    }
}

/// `spec`, run through the helper when Zefaro is elevated; as it is otherwise.
pub fn wrap(spec: Spec) -> Spec {
    if !elevated() {
        return spec;
    }
    let Ok(exe) = std::env::current_exe() else { return spec };
    let mut args: Vec<OsString> = vec![ARG.into(), spec.program.clone().into_os_string()];
    args.extend(spec.args.iter().cloned());
    Spec { program: exe, args, ..spec }
}

/// One argument for a Windows command line, quoted the way programs built with
/// the Microsoft C runtime (PostgreSQL among them) read it back.
fn quote(arg: &OsStr, out: &mut Vec<u16>) {
    let wide: Vec<u16> = arg.encode_wide().collect();
    let plain = !wide.is_empty() && !wide.iter().any(|&c| c == b' ' as u16 || c == b'\t' as u16 || c == b'"' as u16);
    if plain {
        out.extend_from_slice(&wide);
        return;
    }
    out.push(b'"' as u16);
    let mut backslashes = 0usize;
    for &c in &wide {
        if c == b'\\' as u16 {
            backslashes += 1;
            continue;
        }
        if c == b'"' as u16 {
            // Backslashes before a quote are doubled, and the quote escaped.
            out.extend(std::iter::repeat_n(b'\\' as u16, backslashes * 2 + 1));
        } else {
            out.extend(std::iter::repeat_n(b'\\' as u16, backslashes));
        }
        backslashes = 0;
        out.push(c);
    }
    // Backslashes before the closing quote are doubled too.
    out.extend(std::iter::repeat_n(b'\\' as u16, backslashes * 2));
    out.push(b'"' as u16);
}

pub fn command_line(program: &OsStr, args: &[OsString]) -> Vec<u16> {
    let mut line = Vec::new();
    quote(program, &mut line);
    for a in args {
        line.push(b' ' as u16);
        quote(a, &mut line);
    }
    line.push(0);
    line
}

/// Start `program` with the restricted token and wait for it; returns its exit
/// code, or 1 (after saying why on stderr) when it couldn't start.
pub fn run(program: &OsStr, args: &[OsString]) -> i32 {
    match spawn_and_wait(program, args) {
        Ok(code) => code as i32,
        Err(e) => {
            eprintln!("Zefaro couldn't start {} without administrator rights: {e}", program.to_string_lossy());
            1
        }
    }
}

fn spawn_and_wait(program: &OsStr, args: &[OsString]) -> std::io::Result<u32> {
    use windows_sys::Win32::Foundation::{CloseHandle, SetHandleInformation, HANDLE, HANDLE_FLAG_INHERIT};
    use windows_sys::Win32::Security::{
        AllocateAndInitializeSid, CreateRestrictedToken, FreeSid, SID_AND_ATTRIBUTES, SID_IDENTIFIER_AUTHORITY, TOKEN_ADJUST_DEFAULT,
        TOKEN_ASSIGN_PRIMARY, TOKEN_DUPLICATE, TOKEN_QUERY,
    };
    use windows_sys::Win32::System::Threading::{
        CreateProcessAsUserW, GetCurrentProcess, GetExitCodeProcess, OpenProcessToken, WaitForSingleObject, CREATE_NO_WINDOW, INFINITE,
        PROCESS_INFORMATION, STARTF_USESTDHANDLES, STARTUPINFOW,
    };
    const NT_AUTHORITY: SID_IDENTIFIER_AUTHORITY = SID_IDENTIFIER_AUTHORITY { Value: [0, 0, 0, 0, 0, 5] };
    const BUILTIN_DOMAIN_RID: u32 = 32;
    const ALIAS_RID_ADMINS: u32 = 544;
    const ALIAS_RID_POWER_USERS: u32 = 547;
    let fail = || std::io::Error::last_os_error();

    unsafe {
        let mut token: HANDLE = std::ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_DUPLICATE | TOKEN_ASSIGN_PRIMARY | TOKEN_QUERY | TOKEN_ADJUST_DEFAULT, &mut token) == 0 {
            return Err(fail());
        }
        let mut sids = [std::ptr::null_mut(); 2];
        for (sid, rid) in sids.iter_mut().zip([ALIAS_RID_ADMINS, ALIAS_RID_POWER_USERS]) {
            if AllocateAndInitializeSid(&NT_AUTHORITY, 2, BUILTIN_DOMAIN_RID, rid, 0, 0, 0, 0, 0, 0, sid) == 0 {
                let e = fail();
                CloseHandle(token);
                return Err(e);
            }
        }
        // The two groups become deny-only: the program can't use them to get
        // in anywhere, and PostgreSQL's administrator check passes.
        let disable = [SID_AND_ATTRIBUTES { Sid: sids[0], Attributes: 0 }, SID_AND_ATTRIBUTES { Sid: sids[1], Attributes: 0 }];
        let mut restricted: HANDLE = std::ptr::null_mut();
        let made = CreateRestrictedToken(
            token,
            0,
            disable.len() as u32,
            disable.as_ptr(),
            0,
            std::ptr::null(),
            0,
            std::ptr::null(),
            &mut restricted,
        );
        let made_err = fail();
        for sid in sids {
            FreeSid(sid);
        }
        CloseHandle(token);
        if made == 0 {
            return Err(made_err);
        }

        // The program writes where the helper does (the service's log).
        let handles = [
            std::io::stdin().as_raw_handle() as HANDLE,
            std::io::stdout().as_raw_handle() as HANDLE,
            std::io::stderr().as_raw_handle() as HANDLE,
        ];
        for h in handles {
            if !h.is_null() {
                SetHandleInformation(h, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);
            }
        }
        let mut si: STARTUPINFOW = std::mem::zeroed();
        si.cb = size_of::<STARTUPINFOW>() as u32;
        si.dwFlags = STARTF_USESTDHANDLES;
        si.hStdInput = handles[0];
        si.hStdOutput = handles[1];
        si.hStdError = handles[2];
        let mut pi: PROCESS_INFORMATION = std::mem::zeroed();
        let mut line = command_line(program, args);
        let started = CreateProcessAsUserW(
            restricted,
            std::ptr::null(),
            line.as_mut_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            1,
            CREATE_NO_WINDOW,
            std::ptr::null(),
            std::ptr::null(),
            &si,
            &mut pi,
        );
        let start_err = fail();
        CloseHandle(restricted);
        if started == 0 {
            return Err(start_err);
        }
        CloseHandle(pi.hThread);
        WaitForSingleObject(pi.hProcess, INFINITE);
        let mut code = 1u32;
        GetExitCodeProcess(pi.hProcess, &mut code);
        CloseHandle(pi.hProcess);
        Ok(code)
    }
}

/// `zefaro.exe --restricted <program> <args…>`; returns the exit code.
pub fn cli(args: &[OsString]) -> i32 {
    match args.split_first() {
        Some((program, rest)) => run(program, rest),
        None => {
            eprintln!("usage: zefaro --restricted <program> [args…]");
            2
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(args: &[&str]) -> String {
        let args: Vec<OsString> = args.iter().map(OsString::from).collect();
        let mut l = command_line(OsStr::new(r"C:\Program Files\pg\postgres.exe"), &args);
        l.pop();
        String::from_utf16(&l).unwrap()
    }

    #[test]
    fn arguments_survive_the_command_line() {
        assert_eq!(
            line(&["-D", r"C:\Users\A B\data", "-c", "listen_addresses=127.0.0.1", ""]),
            r#""C:\Program Files\pg\postgres.exe" -D "C:\Users\A B\data" -c listen_addresses=127.0.0.1 """#
        );
        assert_eq!(line(&[r#"say "hi""#]), r#""C:\Program Files\pg\postgres.exe" "say \"hi\"""#);
        assert_eq!(line(&[r"C:\dir with space\"]), r#""C:\Program Files\pg\postgres.exe" "C:\dir with space\\""#);
    }

    /// The helper's own path, through `cmd`: the program runs, writes to the
    /// helper's output, and its exit code comes back. `whoami /groups` shows
    /// Administrators as "deny only" (as it already is without elevation).
    #[test]
    fn a_program_runs_with_the_groups_turned_off() {
        let out = std::env::temp_dir().join(format!("zefaro-restricted-{}.txt", std::process::id()));
        let cmd = format!("whoami /groups > \"{}\" & exit 7", out.display());
        let code = run(OsStr::new(r"C:\Windows\System32\cmd.exe"), &["/d".into(), "/c".into(), cmd.into()]);
        assert_eq!(code, 7);
        let groups = std::fs::read(&out).map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default();
        let _ = std::fs::remove_file(&out);
        if let Some(admins) = groups.lines().find(|l| l.contains("S-1-5-32-544")) {
            assert!(admins.to_ascii_lowercase().contains("deny only"), "{admins}");
        }
    }

    /// PostgreSQL (from its zip, kept in `ZEFARO_PG_ZIP_DIR`) in a temp folder,
    /// run through the helper: it answers queries, logs to the helper's
    /// output, and a fast stop ends it with exit code 0.
    #[test]
    #[ignore = "installs PostgreSQL into a temp folder (run with --ignored)"]
    fn live_postgresql_runs_through_the_helper() {
        use crate::engine::dbio::{Client, Engine};
        use crate::engine::postgres;
        let tmp = std::env::temp_dir().join(format!("zefaro-restricted-pg-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let scratch = std::env::var_os("ZEFARO_PG_ZIP_DIR").map(std::path::PathBuf::from).unwrap_or_else(|| tmp.join("dl"));
        let l = postgres::Layout { base: tmp.join("pg"), data: tmp.join("data"), log: tmp.join("pg.log"), port: 55463 };
        postgres::prepare(&l, &scratch, true).unwrap();
        let spec = postgres::spec(&l);
        let (program, args) = (spec.program.clone().into_os_string(), spec.args.clone());
        let server = std::thread::spawn(move || run(&program, &args));
        let c = Client { engine: Engine::PostgreSql, bin: l.base.join("bin"), port: 55463 };
        crate::engine::dbio::wait_ready(&c, std::time::Duration::from_secs(30)).expect("PostgreSQL answers through the helper");
        assert_eq!(c.query("SELECT 40 + 2").unwrap().trim(), "42");
        let (stop, stop_args) = spec.stop.clone().unwrap();
        crate::engine::process::run(crate::engine::process::command(stop).args(stop_args)).expect("pg_ctl stop");
        assert_eq!(server.join().unwrap(), 0, "the helper hands back PostgreSQL's exit code");
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
