# Changelog

All notable changes to this project will be documented in this file.

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
