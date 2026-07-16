// SPDX-License-Identifier: GPL-3.0-or-later

import { WebGpuRenderer, ModelData, ModelRenderRange } from "@webmmd/webgpu";
import { OrbitCamera } from "./camera.js";
import type { WasmModelMetadata } from "@webmmd/protocol";

export class WebMmdViewer {
  private canvas: HTMLCanvasElement;
  private renderer: WebGpuRenderer;
  private camera: OrbitCamera;

  private isRunning = false;
  private isDirty = true;
  private animationFrameId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;

  // Active Model State
  private activeMetadata: WasmModelMetadata | null = null;
  private activeBonesBuffer: Float32Array | null = null;
  private morphWeights: Map<number, number> = new Map(); // morphIndex -> weight (0..1)

  // VFS for texture loading
  private vfs: Map<string, File> = new Map();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new WebGpuRenderer(canvas);
    this.camera = new OrbitCamera(canvas);

    this.camera.onChange(() => {
      this.markDirty();
    });

    this.setupResizeObserver();
  }

  public async initialize(
    onDeviceLost?: (reason: string) => void,
  ): Promise<void> {
    await this.renderer.initialize(onDeviceLost);
    this.startLoop();
  }

  private setupResizeObserver() {
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = Math.floor(
          entry.contentRect.width * window.devicePixelRatio,
        );
        const height = Math.floor(
          entry.contentRect.height * window.devicePixelRatio,
        );

        if (this.canvas.width !== width || this.canvas.height !== height) {
          this.canvas.width = width;
          this.canvas.height = height;
          this.renderer.recreateDepthBuffer();
          this.markDirty();
        }
      }
    });
    this.resizeObserver.observe(this.canvas);
  }

  public setVfs(files: Map<string, File>) {
    this.vfs = new Map();
    for (const [key, file] of files.entries()) {
      const normalizedKey = key.replace(/\\/g, "/").toLowerCase();
      this.vfs.set(normalizedKey, file);
    }
  }

  public async loadModel(
    metadata: WasmModelMetadata,
    vertices: ArrayBuffer,
    indices: ArrayBuffer,
    materials: ArrayBuffer,
    vertexMorphOffsets: ArrayBuffer,
    uvMorphOffsets: ArrayBuffer,
  ) {
    this.activeMetadata = metadata;
    this.morphWeights.clear();

    // 1. Resolve and decode textures from VFS
    console.log("[Viewer] Resolving textures...");
    const bitmaps = await this.resolveTextures(metadata.textures);

    // 2. Prepare material ranges for renderer
    let offset = 0;
    const ranges: ModelRenderRange[] = metadata.materials.map((m, matIdx) => {
      const firstIndex = offset;
      const indexCount = m.surfaceCount;
      offset += indexCount;

      // Extract flags from materials array (or mock them for Stage 0.2 rendering)
      // Standard PMX: texture_index, sphere_index, etc.
      // We will parse flags dynamically. Let's make sure we find textures.
      return {
        materialIndex: matIdx,
        firstIndex,
        indexCount,
        doubleSided: true, // Default to true or check flags
        castOutline: true,
        textureIndex: matIdx < metadata.materials.length ? matIdx : -1, // Simple link
        sphereTextureIndex: -1,
        toonTextureIndex: -1,
      };
    });

    // Fix up actual texture links from compiled binary materials buffer
    const matView = new Int32Array(materials);
    for (let i = 0; i < ranges.length; i++) {
      const range = ranges[i]!;
      // Material stride is 96 bytes. Texture indices are stored at float offset index 20 (byte offset 80)
      // 96 bytes = 24 float elements.
      // Int32 texture indices are at elements: 20 (base), 21 (sphere), 22 (toon)
      const baseIdx = matView[i * 24 + 20] ?? -1;
      const sphereIdx = matView[i * 24 + 21] ?? -1;
      const toonIdx = matView[i * 24 + 22] ?? -1;
      const flags = matView[i * 24 + 17] ?? 0; // element 17 = flags

      range.textureIndex = baseIdx;
      range.sphereTextureIndex = sphereIdx;
      range.toonTextureIndex = toonIdx;
      range.doubleSided = (flags & 0x01) !== 0;
      range.castOutline = (flags & 0x10) !== 0;
    }

    const modelData: ModelData = {
      vertices,
      indices,
      materials,
      vertexMorphOffsets,
      uvMorphOffsets,
      vertexCount: vertices.byteLength / 144, // 144 bytes per vertex
      indexCount: indices.byteLength / 4,
      ranges,
      textureBitmaps: bitmaps,
    };

    await this.renderer.setModel(modelData);

    // Initialize bone matrices array (wasm target)
    this.activeBonesBuffer = new Float32Array(metadata.bones.length * 16);
    // Fill with identity matrices
    for (let i = 0; i < metadata.bones.length; i++) {
      this.activeBonesBuffer[i * 16] = 1.0;
      this.activeBonesBuffer[i * 16 + 5] = 1.0;
      this.activeBonesBuffer[i * 16 + 10] = 1.0;
      this.activeBonesBuffer[i * 16 + 15] = 1.0;
    }
    this.renderer.updateBones(this.activeBonesBuffer);

    this.markDirty();
  }

  private async resolveTextures(
    texturePaths: string[],
  ): Promise<(ImageBitmap | null)[]> {
    const bitmaps: (ImageBitmap | null)[] = [];

    for (const rawPath of texturePaths) {
      const file = this.lookupVfs(rawPath);
      if (file) {
        try {
          // createImageBitmap is supported in all modern browsers (including Safari 26)
          const bitmap = await createImageBitmap(file);
          bitmaps.push(bitmap);
        } catch (err) {
          console.error(`[Viewer] Failed to decode texture: ${rawPath}`, err);
          bitmaps.push(null);
        }
      } else {
        console.warn(`[Viewer] Texture file not found in VFS: ${rawPath}`);
        bitmaps.push(null);
      }
    }

    return bitmaps;
  }

  private lookupVfs(path: string): File | undefined {
    const normalized = path.replace(/\\/g, "/").toLowerCase();

    // 1. Direct path lookup
    let file = this.vfs.get(normalized);
    if (file) return file;

    // 2. Basename matching (case-insensitive fallback)
    const basename = normalized.substring(normalized.lastIndexOf("/") + 1);
    for (const [key, f] of this.vfs.entries()) {
      const kBasename = key.substring(key.lastIndexOf("/") + 1);
      if (kBasename === basename) {
        return f;
      }
    }
    return undefined;
  }

  public setMorphWeight(index: number, weight: number) {
    this.morphWeights.set(index, weight);
    this.markDirty();
  }

  public setBonePose(index: number, matrix: Float32Array) {
    if (
      this.activeBonesBuffer &&
      index >= 0 &&
      index < this.activeMetadata!.bones.length
    ) {
      this.activeBonesBuffer.set(matrix, index * 16);
      this.renderer.updateBones(this.activeBonesBuffer);
      this.markDirty();
    }
  }

  public resetPose() {
    if (this.activeBonesBuffer && this.activeMetadata) {
      for (let i = 0; i < this.activeMetadata.bones.length; i++) {
        this.activeBonesBuffer[i * 16] = 1.0;
        this.activeBonesBuffer[i * 16 + 1] = 0.0;
        this.activeBonesBuffer[i * 16 + 2] = 0.0;
        this.activeBonesBuffer[i * 16 + 3] = 0.0;
        this.activeBonesBuffer[i * 16 + 4] = 0.0;
        this.activeBonesBuffer[i * 16 + 5] = 1.0;
        this.activeBonesBuffer[i * 16 + 6] = 0.0;
        this.activeBonesBuffer[i * 16 + 7] = 0.0;
        this.activeBonesBuffer[i * 16 + 8] = 0.0;
        this.activeBonesBuffer[i * 16 + 9] = 0.0;
        this.activeBonesBuffer[i * 16 + 10] = 1.0;
        this.activeBonesBuffer[i * 16 + 11] = 0.0;
        this.activeBonesBuffer[i * 16 + 12] = 0.0;
        this.activeBonesBuffer[i * 16 + 13] = 0.0;
        this.activeBonesBuffer[i * 16 + 14] = 0.0;
        this.activeBonesBuffer[i * 16 + 15] = 1.0;
      }
      this.renderer.updateBones(this.activeBonesBuffer);
      this.morphWeights.clear();
      this.camera.reset();
      this.markDirty();
    }
  }

  public resetCamera() {
    this.camera.reset();
    this.markDirty();
  }

  public toggleOutlines(enabled: boolean) {
    this.renderer.outlineEnabled = enabled;
    this.markDirty();
  }

  public markDirty() {
    this.isDirty = true;
  }

  private startLoop() {
    this.isRunning = true;
    const tick = () => {
      if (!this.isRunning) return;

      if (this.isDirty && this.canvas.width > 0 && this.canvas.height > 0) {
        this.isDirty = false;
        this.renderFrame();
      }

      this.animationFrameId = requestAnimationFrame(tick);
    };
    this.animationFrameId = requestAnimationFrame(tick);
  }

  private renderFrame() {
    if (!this.activeMetadata) return;

    // 1. Calculate camera matrices
    const aspect = this.canvas.width / this.canvas.height;
    const { viewProjection, view, eyePosition } =
      this.camera.getMatrices(aspect);
    this.renderer.updateCamera(viewProjection, view, eyePosition);

    // 2. Prepare active compute morph parameters
    const activeComputeMorphs: {
      type: "vertex" | "uv";
      start: number;
      count: number;
      weight: number;
    }[] = [];

    // Find active vertex & UV morphs
    for (const [idx, weight] of this.morphWeights.entries()) {
      if (weight <= 0.0) continue;

      const vertexMeta = this.activeMetadata.vertexMorphMeta.find(
        (m) => m.morphIndex === idx,
      );
      if (vertexMeta) {
        activeComputeMorphs.push({
          type: "vertex",
          start: vertexMeta.offsetStart,
          count: vertexMeta.offsetCount,
          weight,
        });
      }

      const uvMeta = this.activeMetadata.uvMorphMeta.find(
        (m) => m.morphIndex === idx,
      );
      if (uvMeta) {
        activeComputeMorphs.push({
          type: "uv",
          start: uvMeta.offsetStart,
          count: uvMeta.offsetCount,
          weight,
        });
      }
    }

    // 3. Dispatch skinning & morph compute shader
    this.renderer.computeDeform(activeComputeMorphs);

    // 4. Render main pass
    this.renderer.draw();
  }

  public dispose() {
    this.isRunning = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }
    this.resizeObserver?.disconnect();
    this.renderer.dispose();
  }
}
