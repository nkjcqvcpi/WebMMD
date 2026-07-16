// SPDX-License-Identifier: AGPL-3.0-or-later
import { execSync } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");

function runCommand(cmd, cwd = projectRoot) {
  console.log(`Running: ${cmd} in ${cwd}`);
  try {
    execSync(cmd, { cwd, stdio: "inherit" });
  } catch (error) {
    console.error(`Command failed: ${cmd}`);
    process.exit(1);
  }
}

// 1. Locate wasm-pack
const homeDir = process.env.HOME || process.env.USERPROFILE;
const cargoWasmPack = join(homeDir, ".cargo", "bin", "wasm-pack");
let wasmPackCmd = "wasm-pack";

if (existsSync(cargoWasmPack)) {
  wasmPackCmd = cargoWasmPack;
}

// 2. Build webmmd-wasm for the browser (web target)
// We will output the wasm bundle to apps/web/src/wasm
const outDir = join(projectRoot, "apps", "web", "src", "wasm");
if (!existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true });
}

console.log("Building webmmd-wasm for web target...");
runCommand(
  `${wasmPackCmd} build crates/webmmd-wasm --target web --out-dir ${outDir}`,
);

console.log("WASM built successfully!");
