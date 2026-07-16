# Pre-0.1.1 Baseline Report

## Git Commit Info

- **Baseline Commit SHA:** `93a7cca5070572a5af9edb3d2d25ca6bd2e4d5b3`
- **Reference Submodules Status:** Verified initialized and populated.
  - `ref/saba`
  - `ref/babylon-mmd`
  - `ref/blender_mmd_tools`

## Fixture Verification

- **ZIP Archive:** `ref/test.zip` exists (~10.6 MB).
- **Target Model:** `【琳妮特】.pmx` (parsed as `Linette`) is present in the ZIP archive.

## Initial Test Suite Status

- **pnpm test (Vitest):**
  - `packages/protocol/tests/protocol.test.ts` (1 test passed)
- **cargo test:**
  - 4 tests passed (`test_math`, `test_parse_truncated_data`, `test_parse_malformed_signature`, `test_parse_lynette`)

## Initial Safari Selenium Test Results

- **Status:** Passed.
- **Console Logs:**
  - `[WebMMD] Lit UI Application Initialized.`
  - `[WebGPU] Supported Features / Limits...`
  - `[App Shell] PMX successfully parsed! Loading into GPU...`
  - `[Viewer] Resolving textures...`
  - `[Renderer] Loading model with 27474 vertices, 98463 indices.`
- **Generated Screenshots:**
  - `test-results/safari-1-initial-load.png`
  - `test-results/safari-2-selector-overlay.png`
  - `test-results/safari-3-model-rendered.png`

## Initial Licensing Declarations Audit

- **SPDX Headers:** Almost all active source files in JS/TS, Rust, WGSL, Python/shell configurations declare:
  `// SPDX-License-Identifier: GPL-3.0-or-later` or `# SPDX-License-Identifier: GPL-3.0-or-later`.
- **Root LICENSE:** GNU AFFERO GENERAL PUBLIC LICENSE Version 3.
- **Crate Cargo.toml files:** Specify `license = "GPL-3.0-or-later"`.
