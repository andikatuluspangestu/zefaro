//! Spawning helper processes (php.exe, Composer, PowerShell) without console
//! windows flashing up behind the GUI.

use crate::error::{AppError, AppResult};
use std::ffi::OsStr;
use std::process::{Command, Output};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Variables laravel/agent-detector reads to decide it runs under a coding
/// agent. Zefaro may be started from such a terminal; programs it runs for
/// the user (the Laravel installer, the Terminal page's shells) leave them out.
pub const AGENT_VARS: &[&str] = &[
    "AI_AGENT", "CURSOR_AGENT", "GROK_PLUGIN_ROOT", "GROK_PLUGIN_DATA", "QWEN_CODE", "GEMINI_CLI",
    "CODEX_SANDBOX", "CODEX_CI", "CODEX_THREAD_ID", "CODEX_SANDBOX_NETWORK_DISABLED", "AUGMENT_AGENT",
    "OPENCODE_CLIENT", "OPENCODE", "AMP_CURRENT_THREAD_ID", "CLAUDECODE", "CLAUDE_CODE", "REPL_ID",
    "COPILOT_MODEL", "COPILOT_ALLOW_ALL", "COPILOT_GITHUB_TOKEN", "COPILOT_CLI", "ANTIGRAVITY_AGENT",
    "ANTIGRAVITY_CLI_ALIAS", "PI_CODING_AGENT", "MATTERHORN_SESSION_ID", "JUNIE_DATA", "JUNIE_SHIM_PATH",
    "KIRO_AGENT_PATH", "KIMI_PLUGIN_ROOT", "CLINE_ACTIVE", "GOOSE_TERMINAL", "OPENCLAW_SHELL", "ZCODE_ENV",
    "CRUSH", "WINDSURF_CASCADE_TERMINAL", "TERM_PROGRAM",
];

pub fn command(program: impl AsRef<OsStr>) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

/// Run to completion; stdout on success, the tail of the output on failure.
pub fn run(cmd: &mut Command) -> AppResult<String> {
    let out = cmd.output()?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        Err(AppError::msg(tail(&out)))
    }
}

/// Run a PowerShell script (no profile, non-interactive) and return its stdout.
pub fn powershell(script: &str) -> AppResult<String> {
    run(command("powershell").args([
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script,
    ]))
}

/// Last few non-empty lines of stderr (or stdout when stderr is empty) — enough
/// to explain a failure in a toast without dumping a whole Composer log.
pub fn tail(out: &Output) -> String {
    let mut text = String::from_utf8_lossy(&out.stderr).into_owned();
    if text.trim().is_empty() {
        text = String::from_utf8_lossy(&out.stdout).into_owned();
    }
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    lines[lines.len().saturating_sub(12)..].join("\n")
}
