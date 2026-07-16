// SPDX-License-Identifier: AGPL-3.0-or-later

import { WebGpuRenderer, ModelData, ModelRenderRange } from "@webmmd/webgpu";
import { OrbitCamera } from "./camera.js";
import type { WasmModelMetadata } from "@webmmd/protocol";

export class WebMmdViewer {
  private canvas: HTMLCanvasElement;
  private renderer: WebGpuRenderer;
  private camera: OrbitCamera;

  private isRunning = false;
  private isDirty = true;
  private frameRequested = false;
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
        let width = Math.floor(
          entry.contentRect.width * window.devicePixelRatio,
        );
        let height = Math.floor(
          entry.contentRect.height * window.devicePixelRatio,
        );

        const maxDimension = 2048;
        if (width > maxDimension || height > maxDimension) {
          const aspect = width / height;
          if (width > height) {
            width = maxDimension;
            height = Math.round(maxDimension / aspect);
          } else {
            height = maxDimension;
            width = Math.round(maxDimension * aspect);
          }
        }

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
    _additionalUvs: ArrayBuffer,
  ) {
    this.activeMetadata = metadata;
    this.morphWeights.clear();
    this.camera.frameModel(metadata.bounds);

    if (metadata.additionalUvCount > 0) {
      metadata.diagnostics.push({
        severity: "warning",
        code: "ADDITIONAL_UV_CHANNELS",
        section: "Model",
        message: `Model contains ${metadata.additionalUvCount} additional UV channel(s).`,
      });
    }

    // 1. Resolve and decode textures from VFS
    console.log("[Viewer] Resolving textures...");
    const bitmaps = await this.resolveTextures(metadata.textures);

    // 2. Prepare material ranges for renderer
    let offset = 0;
    const ranges: ModelRenderRange[] = metadata.materials.map((m, matIdx) => {
      const firstIndex = offset;
      const indexCount = m.surfaceCount;
      offset += indexCount;

      return {
        materialIndex: matIdx,
        firstIndex,
        indexCount,
        doubleSided: true,
        castOutline: true,
        textureIndex: matIdx < metadata.materials.length ? matIdx : -1,
        sphereTextureIndex: -1,
        toonTextureIndex: -1,
        transparent: false,
        toonMode: 0,
      };
    });

    // Assert material buffer size layout
    const expectedMaterialSize = metadata.materials.length * 112;
    if (materials.byteLength !== expectedMaterialSize) {
      throw new Error(
        `Material buffer byteLength mismatch. Expected ${expectedMaterialSize} bytes (112 bytes per material), got ${materials.byteLength} bytes.`,
      );
    }

    const floatView = new Float32Array(materials);
    const intView = new Int32Array(materials);
    const uintView = new Uint32Array(materials);
    const STRIDE = 28; // 28 * 4 = 112 bytes

    for (let i = 0; i < ranges.length; i++) {
      const range = ranges[i]!;
      const offset = i * STRIDE;

      const baseIdx = intView[offset + 20] ?? -1;
      const sphereIdx = intView[offset + 21] ?? -1;
      const toonIdx = intView[offset + 22] ?? -1;
      const flags = uintView[offset + 24] ?? 0;
      const diffuseAlpha = floatView[offset + 3] ?? 1.0;
      const toonMode = uintView[offset + 26] ?? 0;

      const texturePath = baseIdx >= 0 ? metadata.textures[baseIdx] : undefined;
      const hasTextureAlpha = texturePath
        ? texturePath.toLowerCase().endsWith(".png") ||
          texturePath.toLowerCase().endsWith(".tga")
        : false;

      range.textureIndex = baseIdx;
      range.sphereTextureIndex = sphereIdx;
      range.toonTextureIndex = toonIdx;
      range.doubleSided = (flags & 0x01) !== 0;
      range.castOutline = (flags & 0x10) !== 0;
      range.transparent = diffuseAlpha < 0.99 || hasTextureAlpha;
      range.toonMode = toonMode;
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
    this.requestFrame();
  }

  private requestFrame() {
    if (!this.isRunning || this.frameRequested) return;
    this.frameRequested = true;

    const renderCallback = () => {
      this.frameRequested = false;
      if (this.isDirty && this.canvas.width > 0 && this.canvas.height > 0) {
        this.isDirty = false;
        this.renderFrame();
      }
    };

    if ((window as any).__webmmdTest) {
      this.animationFrameId = setTimeout(renderCallback, 16) as any;
    } else {
      this.animationFrameId = requestAnimationFrame(renderCallback);
    }
  }

  private startLoop() {
    this.isRunning = true;
    this.markDirty();
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
      channel: number;
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
          channel: 0,
        });
      }

      const uvMeta = this.activeMetadata.uvMorphMeta.find(
        (m) => m.morphIndex === idx,
      );
      if (uvMeta) {
        const morphMeta = this.activeMetadata.morphs[idx];
        const channel =
          morphMeta && morphMeta.morphType >= 3 && morphMeta.morphType <= 7
            ? morphMeta.morphType - 3
            : 0;

        activeComputeMorphs.push({
          type: "uv",
          start: uvMeta.offsetStart,
          count: uvMeta.offsetCount,
          weight,
          channel,
        });
      }
    }

    // 3. Dispatch skinning & morph compute shader
    this.renderer.computeDeform(activeComputeMorphs);

    // 4. Render main pass
    this.renderer.draw();

    if ((window as any).__webmmdTest) {
      (window as any).__webmmdTest.frameRenderedCount++;
    }
  }

  public dispose() {
    this.isRunning = false;
    if (this.animationFrameId !== null) {
      if ((window as any).__webmmdTest) {
        clearTimeout(this.animationFrameId as any);
      } else {
        cancelAnimationFrame(this.animationFrameId);
      }
    }
    this.resizeObserver?.disconnect();
    this.renderer.dispose();
  }
}
