// Build the Windows installer with build-machine paths stripped from zefaro.exe.
//
// Rust embeds source paths in the binary (for panic messages), and paths under
// CARGO_HOME contain the builder's Windows user name. Remapping them keeps
// whoever built a release out of it. (Cargo's `trim-paths` would do this, but
// it isn't stable yet.)

import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(import.meta.url), "..", "..");
const cargoHome = process.env.CARGO_HOME ?? join(homedir(), ".cargo");

const remaps = [
  `--remap-path-prefix=${cargoHome}=cargo`,
  `--remap-path-prefix=${root}=zefaro`,
];
// Cargo's encoded form, separated by 0x1F, keeps paths with spaces intact.
const SEP = String.fromCharCode(0x1f);
const existing = process.env.CARGO_ENCODED_RUSTFLAGS?.split(SEP) ?? [];
const encoded = [...existing, ...remaps].filter(Boolean).join(SEP);

const result = spawnSync("npx", ["tauri", "build", ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit",
  shell: true,
  env: { ...process.env, CARGO_ENCODED_RUSTFLAGS: encoded },
});
process.exit(result.status ?? 1);
