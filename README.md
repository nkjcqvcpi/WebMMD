# WebMMD

WebMMD is a high-performance, local-only PMX MikuMikuDance model viewer targeting **Safari 26** and **WebGPU**.

## Features

- **Modern Rendering:** Powered entirely by WebGPU with high-performance compute shaders for deformation.
- **Orbit Viewport Navigation:** Premium 3D-editor-oriented orbit, pan, and zoom camera controls.
- **Skeletal & Morph Deformation Runtime:** Complete MMD-compatible skeletal transformations and PMX bone transform propagation.
- **High Performance:** Compute-based skinning (including SDEF and QDEF dual-quaternion skinning) runs entirely on the GPU.
- **Local-Only & Private:** Zip extraction, parsing, and rendering are fully client-side. No files are uploaded to any server.
- **Static Hosting Friendly:** Builds to standard static HTML, CSS, JavaScript, and WebAssembly assets.

## System Requirements

- **Browser:** Apple Safari 26 or newer (requires WebGPU support).
- **Automation:** Safari Remote Automation enabled for integration tests.
- **Build Requirements:**
  - Node.js >= 22.0.0
  - Rust/Cargo
  - `wasm-pack`

## Technical Architecture

WebMMD is structured as a pnpm monorepo containing:

- `/apps/web`: Lit-based frontend viewer application.
- `/packages/viewer`: Viewer orchestrator and camera controls.
- `/packages/webgpu`: WebGPU renderer and compute shaders.
- `/packages/protocol`: Shared protocol declarations between WASM/Rust and TypeScript.
- `/crates/webmmd-core`: Core PMX file parser, SDEF/QDEF math, validation, and skeletal runtime.
- `/crates/webmmd-wasm`: Rust to WebAssembly bindings.

## Build Instructions

First, ensure that `wasm-pack` is installed:

```bash
cargo install wasm-pack
```

Then install dependencies and build the static assets:

```bash
pnpm install --frozen-lockfile
pnpm build
```

## Running Locally

To start the local Vite development server:

```bash
pnpm dev
```

## Testing and Verification

Run the format checks, linter, unit tests, and coverage collection:

```bash
pnpm verify
```

To run the Safari Selenium integration test:

```bash
pnpm test:safari
```

## License

WebMMD is licensed under the **GNU Affero General Public License version 3 or later** (`AGPL-3.0-or-later`). See the `LICENSE` file for details.

### Corresponding Source and Build Revision

As WebMMD is licensed under the AGPL-3.0-or-later, users accessing the application over the network have a right to obtain the corresponding source code.

- The application UI displays the current build commit SHA and version in the top-left status bar or About dialog.
- The corresponding source code can be cloned or downloaded from the official repository.
