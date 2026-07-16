# Changelog

All notable changes to this project will be documented in this file.

## [0.1.2] - 2026-07-16

### Added

- Fully functional MMD skeletal transform propagation and deformation evaluation stages implemented in Rust.
- Deterministic deformation evaluation order with dependencies sorted by transform layer and parent-child propagation.
- Recursive Group and Flip Morph expansion resolving complex morph dependencies in the Rust runtime.
- Append and Grant Transform support (inheriting translation and rotation from source bones).
- CCD IK Solver with loop count limits, angle boundaries, and protection against divide-by-zero or NaN values.
- Real Dual-Quaternion Skinning (QDEF) compute shader implementation on GPU.
- Correct SDEF skinning rotation center logic matching Saba reference implementation.
- Race-free per-vertex morph accumulation in a single unified compute shader pass.
- Dynamic MMD Inspector UI panel displaying real-time effective/direct weights, IK states, transform details, and diagnostics.
- Debug display overlays for skeleton lines, IK targets, IK links, and bounding boxes.

## [0.1.1] - 2026-07-16

### Added

- Multi-morph dynamic offset uniform buffer parameter management on GPU, allowing multiple simultaneous morphs to resolve correctly.
- Support for procedurally generated standard MMD shared toon ramps (toon01 to toon10) alongside custom VFS textures.
- Render pipeline selection logic per render range based on material transparency and double-sided flags.
- Base-pose AABB, bounding sphere, center, height, recommended camera target, and clipping planes calculation during model packing.
- Pointer Events based Orbit Camera controls supporting rotation, panning, and touch pinch-to-zoom without pointer lock.
- License modal on first launch showing project license (NOTICE.md) and third-party notices (THIRD_PARTY_NOTICES.md) and blocking UI interaction until accepted.
- Exposed dynamic test readiness and load indicators `window.__webmmdTest` for Selenium framework verification.
- Exposed additional UV channel counts in model diagnostics and preserved additional UV channels in packed binary outputs.
