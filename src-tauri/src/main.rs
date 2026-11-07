// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `zefaro --dns [port] [tld]` is Zefaro's DNS service, started by Zefaro itself
    // under its supervisor — no window, just the server loop.
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("--dns") {
        std::process::exit(zefaro_lib::run_dns(&args[1..]));
    }
    // `zefaro --restricted <program> <args>` starts PostgreSQL without
    // administrator rights when Zefaro itself runs as administrator.
    let raw: Vec<std::ffi::OsString> = std::env::args_os().skip(1).collect();
    if raw.first().is_some_and(|a| a == "--restricted") {
        std::process::exit(zefaro_lib::run_restricted(&raw[1..]));
    }
    zefaro_lib::run()
}
