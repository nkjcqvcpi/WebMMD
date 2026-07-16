// SPDX-License-Identifier: AGPL-3.0-or-later

import { WebGpuRenderer, ModelData, ModelRenderRange } from "@webmmd/webgpu";
import { OrbitCamera } from "./camera.js";
import type { WasmModelMetadata } from "@webmmd/protocol";
import { resolveRelativePath } from "./path.js";

export interface IWasmModelRuntime {
  evaluate(): void;
  get_skin_matrices_view(): Float32Array;
  get_material_states_view(): Float32Array;
  get_morph_weights_view(): Float32Array;
  set_morph_weight(index: number, weight: number): void;
  set_bone_pose(
    index: number,
    tx: number,
    ty: number,
    tz: number,
    qx: number,
    qy: number,
    qz: number,
    qw: number,
  ): void;
  reset_pose(): void;
  free(): void;
}

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
  private morphWeights: Map<number, number> = new Map(); // morphIndex -> weight (0..1)
  private modelRuntime: IWasmModelRuntime | null = null;

  // Recovery raw buffers
  private activeVertices: ArrayBuffer | null = null;
  private activeIndices: ArrayBuffer | null = null;
  private activeMaterials: ArrayBuffer | null = null;
  private activeVertexMorphOffsets: ArrayBuffer | null = null;
  private activeUvMorphOffsets: ArrayBuffer | null = null;
  private activeAdditionalUvs: ArrayBuffer | null = null;

  private isRecovering = false;
  private userDeviceLostCallback?: (reason: string) => void;

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
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
  }

  public async initialize(
    onDeviceLost?: (reason: string) => void,
  ): Promise<void> {
    this.userDeviceLostCallback = onDeviceLost;
    await this.renderer.initialize((reason) => this.handleDeviceLost(reason));
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
    this.textureCache.clear();
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
    runtime: IWasmModelRuntime,
  ) {
    if (this.modelRuntime) {
      this.modelRuntime.free();
    }
    this.modelRuntime = runtime;
    this.activeMetadata = metadata;
    this.activeVertices = vertices;
    this.activeIndices = indices;
    this.activeMaterials = materials;
    this.activeVertexMorphOffsets = vertexMorphOffsets;
    this.activeUvMorphOffsets = uvMorphOffsets;
    this.activeAdditionalUvs = _additionalUvs;
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

    // 2. Prepare material ranges & modelData using helper
    const modelData = this.buildModelData(
      metadata,
      vertices,
      indices,
      materials,
      vertexMorphOffsets,
      uvMorphOffsets,
      bitmaps,
    );

    await this.renderer.setModel(modelData);

    // Initial evaluation
    this.modelRuntime.evaluate();
    const skinMatrices = this.modelRuntime.get_skin_matrices_view();
    this.renderer.updateBones(skinMatrices);

    this.markDirty();
  }

  private buildModelData(
    metadata: WasmModelMetadata,
    vertices: ArrayBuffer,
    indices: ArrayBuffer,
    materials: ArrayBuffer,
    vertexMorphOffsets: ArrayBuffer,
    uvMorphOffsets: ArrayBuffer,
    bitmaps: (ImageBitmap | null)[],
  ): ModelData {
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

    return {
      vertices,
      indices,
      materials,
      vertexMorphOffsets,
      uvMorphOffsets,
      vertexCount: vertices.byteLength / 144, // 144 bytes per vertex
      indexCount: indices.byteLength / 4,
      ranges,
      textureBitmaps: bitmaps,
      vertexMorphMeta: metadata.vertexMorphMeta,
      uvMorphMeta: metadata.uvMorphMeta,
      numMorphs: metadata.morphs.length,
    };
  }

  private activePmxPath = "";
  private textureCache = new Map<string, ImageBitmap>();

  public setActivePmxPath(path: string) {
    this.activePmxPath = path.replace(/\\/g, "/").toLowerCase();
  }

  private async resolveTextures(
    texturePaths: string[],
  ): Promise<(ImageBitmap | null)[]> {
    const bitmaps: (ImageBitmap | null)[] = [];

    for (const rawPath of texturePaths) {
      // Get strict resolved path relative to the active PMX file directory
      const resolvedPath = this.activePmxPath
        ? resolveRelativePath(this.activePmxPath, rawPath)
        : rawPath.replace(/\\/g, "/").toLowerCase();

      // Check cache first
      if (this.textureCache.has(resolvedPath)) {
        bitmaps.push(this.textureCache.get(resolvedPath)!);
        continue;
      }

      const file = this.lookupVfs(resolvedPath);
      if (file) {
        try {
          // createImageBitmap is supported in all modern browsers (including Safari 26)
          const bitmap = await createImageBitmap(file);
          this.textureCache.set(resolvedPath, bitmap);
          bitmaps.push(bitmap);
        } catch (err) {
          console.error(
            `[Viewer] Failed to decode texture: ${resolvedPath} (raw: ${rawPath})`,
            err,
          );
          bitmaps.push(null);
        }
      } else {
        console.warn(
          `[Viewer] Texture file not found in VFS: ${resolvedPath} (raw: ${rawPath})`,
        );
        bitmaps.push(null);
      }
    }

    return bitmaps;
  }

  private lookupVfs(resolvedPath: string): File | undefined {
    // 1. Direct path lookup
    let file = this.vfs.get(resolvedPath);
    if (file) return file;

    // 2. Basename matching (case-insensitive fallback)
    const basename = resolvedPath.substring(resolvedPath.lastIndexOf("/") + 1);
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
    if (this.modelRuntime) {
      this.modelRuntime.set_morph_weight(index, weight);
    }
    this.markDirty();
  }

  public setBonePose(
    index: number,
    tx: number,
    ty: number,
    tz: number,
    qx: number,
    qy: number,
    qz: number,
    qw: number,
  ) {
    if (this.modelRuntime) {
      this.modelRuntime.set_bone_pose(index, tx, ty, tz, qx, qy, qz, qw);
      this.markDirty();
    }
  }

  public resetPose() {
    this.morphWeights.clear();
    if (this.modelRuntime) {
      this.modelRuntime.reset_pose();
      this.modelRuntime.evaluate();
      const skinMatrices = this.modelRuntime.get_skin_matrices_view();
      this.renderer.updateBones(skinMatrices);
    }
    this.camera.reset();
    this.markDirty();
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

    // 1. Evaluate skeletal and morph runtime
    if (this.modelRuntime) {
      this.modelRuntime.evaluate();

      const skinMatrices = this.modelRuntime.get_skin_matrices_view();
      this.renderer.updateBones(skinMatrices);

      const materialStates = this.modelRuntime.get_material_states_view();
      this.renderer.updateMaterials(materialStates);

      const morphWeights = this.modelRuntime.get_morph_weights_view();
      this.renderer.computeDeform(morphWeights);
    }

    // 2. Render main pass
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
    document.removeEventListener(
      "visibilitychange",
      this.handleVisibilityChange,
    );
    if (this.modelRuntime) {
      this.modelRuntime.free();
      this.modelRuntime = null;
    }
    this.renderer.dispose();
    this.textureCache.clear();
  }

  public async readPixel(
    x: number,
    y: number,
  ): Promise<[number, number, number, number]> {
    this.markDirty();
    return this.renderer.readPixel(x, y);
  }

  private handleVisibilityChange = () => {
    if ((window as any).__webmmdTest) {
      // Avoid suspending frame rendering in Selenium tests when the tab is unfocused/hidden.
      return;
    }
    if (document.visibilityState === "hidden") {
      console.log("[Viewer] Visibility hidden. Suspending frame loop...");
      this.isRunning = false;
      if (this.animationFrameId !== null) {
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
      }
      this.frameRequested = false;
    } else if (document.visibilityState === "visible") {
      console.log("[Viewer] Visibility visible. Resuming frame loop...");
      this.isRunning = true;
      this.markDirty();
    }
  };

  private async handleDeviceLost(reason: string) {
    if (this.isRecovering) return;
    this.isRecovering = true;
    console.warn(
      `[Viewer] WebGPU Device Lost: ${reason}. Attempting transparent recovery...`,
    );

    let recovered = false;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        console.log(`[Viewer] Device recovery attempt ${attempt}/5...`);
        await this.renderer.initialize((r) => this.handleDeviceLost(r));

        if (
          this.activeMetadata &&
          this.activeVertices &&
          this.activeIndices &&
          this.activeMaterials &&
          this.activeVertexMorphOffsets &&
          this.activeUvMorphOffsets &&
          this.activeAdditionalUvs &&
          this.modelRuntime
        ) {
          this.textureCache.clear();
          const bitmaps = await this.resolveTextures(
            this.activeMetadata.textures,
          );

          const modelData = this.buildModelData(
            this.activeMetadata,
            this.activeVertices,
            this.activeIndices,
            this.activeMaterials,
            this.activeVertexMorphOffsets,
            this.activeUvMorphOffsets,
            bitmaps,
          );

          await this.renderer.setModel(modelData);

          this.markDirty();
        }

        console.log("[Viewer] WebGPU Device recovery succeeded!");
        recovered = true;
        break;
      } catch (err: any) {
        console.error(`[Viewer] Recovery attempt ${attempt} failed:`, err);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    this.isRecovering = false;

    if (!recovered) {
      console.error("[Viewer] WebGPU Device recovery failed after 5 attempts.");
      if (this.userDeviceLostCallback) {
        this.userDeviceLostCallback(
          "WebGPU Device recovery failed after multiple attempts.",
        );
      }
    }
  }

  public getRuntime(): IWasmModelRuntime | null {
    return this.modelRuntime;
  }

  public getMetadata(): WasmModelMetadata | null {
    return this.activeMetadata;
  }

  public getCamera(): OrbitCamera {
    return this.camera;
  }
}
