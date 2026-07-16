// SPDX-License-Identifier: AGPL-3.0-or-later

import { createBuffer, createBufferWithData } from "../resources/buffer.js";
import {
  createFallbackTexture,
  createFallbackSampler,
  createTextureFromImage,
  createSharedToonTexture,
} from "../resources/texture.js";
import { createRenderPipelines, RenderPipelines } from "../pipelines/render.js";
import {
  createComputePipelines,
  ComputePipelines,
} from "../pipelines/compute.js";
import { initWebGpu, WebGpuContext } from "../capabilities/device.js";

export interface ModelRenderRange {
  materialIndex: number;
  firstIndex: number;
  indexCount: number;
  doubleSided: boolean;
  castOutline: boolean;
  textureIndex: number;
  sphereTextureIndex: number;
  toonTextureIndex: number;
  transparent: boolean;
  renderClass: "opaque" | "cutout" | "blend";
  toonMode: number;
}

export interface PackedMorphMeta {
  morphIndex: number;
  nameLocal: string;
  nameUniversal: string;
  offsetStart: number;
  offsetCount: number;
}

export interface ModelData {
  vertices: ArrayBuffer;
  indices: ArrayBuffer;
  materials: ArrayBuffer;
  vertexMorphOffsets: ArrayBuffer;
  uvMorphOffsets: ArrayBuffer;
  vertexCount: number;
  indexCount: number;
  ranges: ModelRenderRange[];
  textureBitmaps: (ImageBitmap | null)[];
  vertexMorphMeta: PackedMorphMeta[];
  uvMorphMeta: PackedMorphMeta[];
  numMorphs: number;
}

export class WebGpuRenderer {
  private canvas: HTMLCanvasElement;
  private context: WebGpuContext | null = null;

  // Pipelines
  private renderPipelines: RenderPipelines | null = null;
  private computePipelines: ComputePipelines | null = null;

  // Global Resources
  private defaultTexture: GPUTexture | null = null;
  private defaultSampler: GPUSampler | null = null;
  private baseSampler: GPUSampler | null = null;
  private sphereSampler: GPUSampler | null = null;
  private toonSampler: GPUSampler | null = null;

  // Active Model Buffers
  private verticesInputBuffer: GPUBuffer | null = null;
  private renderVertexBuffer: GPUBuffer | null = null;
  private indexBuffer: GPUBuffer | null = null;
  private staticMaterialsBuffer: GPUBuffer | null = null;
  private dynamicMaterialsBuffer: GPUBuffer | null = null;
  private boneMatricesBuffer: GPUBuffer | null = null;
  private vertexMorphAdjacencyBuffer: GPUBuffer | null = null;
  private vertexMorphContributionsBuffer: GPUBuffer | null = null;
  private uvMorphAdjacencyBuffer: GPUBuffer | null = null;
  private uvMorphContributionsBuffer: GPUBuffer | null = null;
  private cameraUniformBuffer: GPUBuffer | null = null;
  private activeMorphWeightsBuffer: GPUBuffer | null = null;
  private skinningParamsBuffer: GPUBuffer | null = null;

  // Active Model Textures
  private textures: GPUTexture[] = [];
  private samplers: GPUSampler[] = [];
  private sharedToons: GPUTexture[] = [];

  // Bind Groups
  private cameraBindGroup: GPUBindGroup | null = null;
  private computeBindGroup: GPUBindGroup | null = null;
  private materialBindGroups: GPUBindGroup[] = [];

  // Rendering Settings
  private modelData: ModelData | null = null;
  private depthTexture: GPUTexture | null = null;

  // Pixel readback helper
  private readBuffer: GPUBuffer | null = null;
  private pendingPixelQuery: {
    x: number;
    y: number;
    resolve: (pixel: [number, number, number, number]) => void;
  } | null = null;

  public outlineEnabled = true;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  async initialize(onDeviceLost?: (reason: string) => void): Promise<void> {
    this.context = await initWebGpu(this.canvas, onDeviceLost);
    const { device, format } = this.context;

    this.readBuffer = device.createBuffer({
      size: 256,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    this.renderPipelines = createRenderPipelines(device, format);
    this.computePipelines = createComputePipelines(device);

    this.defaultTexture = createFallbackTexture(device);
    this.defaultSampler = createFallbackSampler(device);

    this.baseSampler = device.createSampler({
      label: "Base Texture Sampler",
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "repeat",
      addressModeV: "repeat",
    });

    this.sphereSampler = device.createSampler({
      label: "Sphere Texture Sampler",
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });

    this.toonSampler = device.createSampler({
      label: "Toon Texture Sampler",
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });

    this.cameraUniformBuffer = createBuffer(
      device,
      "Camera Uniform Buffer",
      144, // mat4x4(64) + mat4x4(64) + vec3(12) + pad(4) = 144
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    );

    this.cameraBindGroup = device.createBindGroup({
      label: "Camera Bind Group",
      layout: this.renderPipelines.cameraBindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: { buffer: this.cameraUniformBuffer },
        },
      ],
    });

    this.recreateDepthBuffer();

    this.sharedToons = [];
    for (let i = 0; i < 10; i++) {
      this.sharedToons.push(createSharedToonTexture(device, i));
    }
  }

  recreateDepthBuffer() {
    if (!this.context) return;
    const { device } = this.context;

    if (this.canvas.width === 0 || this.canvas.height === 0) {
      return;
    }

    if (this.depthTexture) {
      this.depthTexture.destroy();
    }

    this.depthTexture = device.createTexture({
      label: "Depth Buffer",
      size: [this.canvas.width, this.canvas.height, 1],
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  async setModel(model: ModelData) {
    if (!this.context || !this.renderPipelines || !this.computePipelines)
      return;
    const { device } = this.context;

    this.disposeModel();
    this.modelData = model;

    console.log(
      `[Renderer] Loading model with ${model.vertexCount} vertices, ${model.indexCount} indices.`,
    );

    // 1. Upload static geometry
    this.verticesInputBuffer = createBufferWithData(
      device,
      "Geometry Input Buffer",
      model.vertices,
      GPUBufferUsage.STORAGE,
    );

    this.indexBuffer = createBufferWithData(
      device,
      "Index Buffer",
      model.indices,
      GPUBufferUsage.INDEX,
    );

    const staticView = new Int32Array(model.materials);
    for (let i = 0; i < model.ranges.length; i++) {
      const range = model.ranges[i]!;
      const classIdx = ["opaque", "cutout", "blend"].indexOf(range.renderClass);
      staticView[i * 8 + 3] = classIdx >= 0 ? classIdx : 0;
    }

    this.staticMaterialsBuffer = createBufferWithData(
      device,
      "Static Materials Buffer",
      model.materials,
      GPUBufferUsage.STORAGE,
    );

    this.dynamicMaterialsBuffer = createBuffer(
      device,
      "Dynamic Materials Buffer",
      model.ranges.length * 128, // 128 bytes (32 floats) per material
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );

    this.renderVertexBuffer = createBuffer(
      device,
      "Render Vertex Buffer",
      model.vertexCount * 36, // Struct RenderVertex: pos(12) + normal_x/y/z(12) + u/v(8) + edge_scale(4) = 36
      GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE,
    );

    // Maximum bone matrices (default to 1024 to support large models)
    this.boneMatricesBuffer = createBuffer(
      device,
      "Bone Matrices Buffer",
      1024 * 64, // 1024 * mat4x4
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );
    // Initialize bone matrices to identity
    const identityMatrices = new Float32Array(1024 * 16);
    for (let i = 0; i < 1024; i++) {
      identityMatrices[i * 16] = 1.0;
      identityMatrices[i * 16 + 5] = 1.0;
      identityMatrices[i * 16 + 10] = 1.0;
      identityMatrices[i * 16 + 15] = 1.0;
    }
    device.queue.writeBuffer(this.boneMatricesBuffer, 0, identityMatrices);

    this.skinningParamsBuffer = createBuffer(
      device,
      "Skinning Params Buffer",
      16, // count(4) + pad(12)
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    );
    // Write skinning parameters
    const skinParams = new Uint32Array([model.vertexCount, 0, 0, 0]);
    device.queue.writeBuffer(this.skinningParamsBuffer, 0, skinParams);

    // Build vertex morph adjacency and contributions
    const contributionsByVertex: {
      morphIndex: number;
      x: number;
      y: number;
      z: number;
    }[][] = Array.from({ length: model.vertexCount }, () => []);
    const vOffsetUint = new Uint32Array(model.vertexMorphOffsets);
    const vOffsetFloat = new Float32Array(model.vertexMorphOffsets);
    const stride = 8; // 32 bytes / 4

    for (const m of model.vertexMorphMeta) {
      const morphIdx = m.morphIndex;
      const start = m.offsetStart;
      const count = m.offsetCount;
      for (let i = 0; i < count; i++) {
        const idx = (start + i) * stride;
        const vIdx = vOffsetUint[idx];
        if (vIdx !== undefined && vIdx < model.vertexCount) {
          const x = vOffsetFloat[idx + 4] ?? 0;
          const y = vOffsetFloat[idx + 5] ?? 0;
          const z = vOffsetFloat[idx + 6] ?? 0;
          contributionsByVertex[vIdx]!.push({ morphIndex: morphIdx, x, y, z });
        }
      }
    }

    const vertexAdjacencyData = new Uint32Array(model.vertexCount * 2);
    const vertexContributionsList: {
      morphIndex: number;
      x: number;
      y: number;
      z: number;
    }[] = [];

    for (let vIdx = 0; vIdx < model.vertexCount; vIdx++) {
      const list = contributionsByVertex[vIdx]!;
      const start = vertexContributionsList.length;
      const count = list.length;
      vertexAdjacencyData[vIdx * 2] = start;
      vertexAdjacencyData[vIdx * 2 + 1] = count;
      for (const item of list) {
        vertexContributionsList.push(item);
      }
    }

    // VertexMorphContribution layout: morph_index (4 bytes), offset_x (4 bytes), offset_y (4 bytes), offset_z (4 bytes) = 16 bytes
    const vertexContributionsData = new Float32Array(
      Math.max(1, vertexContributionsList.length) * 4,
    );
    for (let i = 0; i < vertexContributionsList.length; i++) {
      const item = vertexContributionsList[i]!;
      vertexContributionsData[i * 4] = item.morphIndex;
      vertexContributionsData[i * 4 + 1] = item.x;
      vertexContributionsData[i * 4 + 2] = item.y;
      vertexContributionsData[i * 4 + 3] = item.z;
    }

    // Build UV morph adjacency and contributions
    const uvContributionsByVertex: {
      morphIndex: number;
      u: number;
      v: number;
    }[][] = Array.from({ length: model.vertexCount }, () => []);
    const uvOffsetUint = new Uint32Array(model.uvMorphOffsets);
    const uvOffsetFloat = new Float32Array(model.uvMorphOffsets);

    for (const m of model.uvMorphMeta) {
      const morphIdx = m.morphIndex;
      const start = m.offsetStart;
      const count = m.offsetCount;
      for (let i = 0; i < count; i++) {
        const idx = (start + i) * stride;
        const vIdx = uvOffsetUint[idx];
        if (vIdx !== undefined && vIdx < model.vertexCount) {
          const u = uvOffsetFloat[idx + 4] ?? 0;
          const v = uvOffsetFloat[idx + 5] ?? 0;
          uvContributionsByVertex[vIdx]!.push({ morphIndex: morphIdx, u, v });
        }
      }
    }

    const uvAdjacencyData = new Uint32Array(model.vertexCount * 2);
    const uvContributionsList: { morphIndex: number; u: number; v: number }[] =
      [];

    for (let vIdx = 0; vIdx < model.vertexCount; vIdx++) {
      const list = uvContributionsByVertex[vIdx]!;
      const start = uvContributionsList.length;
      const count = list.length;
      uvAdjacencyData[vIdx * 2] = start;
      uvAdjacencyData[vIdx * 2 + 1] = count;
      for (const item of list) {
        uvContributionsList.push(item);
      }
    }

    // UvMorphContribution layout: morph_index (4 bytes), offset_u (4 bytes), offset_v (4 bytes), padding (4 bytes) = 16 bytes
    const uvContributionsData = new Float32Array(
      Math.max(1, uvContributionsList.length) * 4,
    );
    for (let i = 0; i < uvContributionsList.length; i++) {
      const item = uvContributionsList[i]!;
      uvContributionsData[i * 4] = item.morphIndex;
      uvContributionsData[i * 4 + 1] = item.u;
      uvContributionsData[i * 4 + 2] = item.v;
      uvContributionsData[i * 4 + 3] = 0.0; // padding
    }

    // Allocate GPU buffers
    this.vertexMorphAdjacencyBuffer = createBufferWithData(
      device,
      "Vertex Morph Adjacency Buffer",
      vertexAdjacencyData.buffer,
      GPUBufferUsage.STORAGE,
    );

    this.vertexMorphContributionsBuffer = createBufferWithData(
      device,
      "Vertex Morph Contributions Buffer",
      vertexContributionsData.buffer,
      GPUBufferUsage.STORAGE,
    );

    this.uvMorphAdjacencyBuffer = createBufferWithData(
      device,
      "UV Morph Adjacency Buffer",
      uvAdjacencyData.buffer,
      GPUBufferUsage.STORAGE,
    );

    this.uvMorphContributionsBuffer = createBufferWithData(
      device,
      "UV Morph Contributions Buffer",
      uvContributionsData.buffer,
      GPUBufferUsage.STORAGE,
    );

    this.activeMorphWeightsBuffer = createBuffer(
      device,
      "Active Morph Weights Buffer",
      Math.max(1, model.numMorphs) * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );

    // 3. Load textures
    this.textures = [];
    this.samplers = [];
    for (let i = 0; i < model.textureBitmaps.length; i++) {
      const bitmap = model.textureBitmaps[i];
      if (bitmap) {
        try {
          const tex = await createTextureFromImage(
            device,
            bitmap,
            `Texture_${i}`,
          );
          this.textures.push(tex);
        } catch (err) {
          console.error(`[Renderer] Failed to load texture bitmap ${i}:`, err);
          this.textures.push(this.defaultTexture!);
        }
      } else {
        this.textures.push(this.defaultTexture!);
      }
      this.samplers.push(this.defaultSampler!);
    }

    // 4. Create compute bind group
    this.computeBindGroup = device.createBindGroup({
      label: "Deform Compute Bind Group",
      layout: this.computePipelines.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.verticesInputBuffer } },
        { binding: 1, resource: { buffer: this.renderVertexBuffer } },
        { binding: 2, resource: { buffer: this.boneMatricesBuffer } },
        { binding: 3, resource: { buffer: this.vertexMorphAdjacencyBuffer } },
        {
          binding: 4,
          resource: { buffer: this.vertexMorphContributionsBuffer },
        },
        { binding: 5, resource: { buffer: this.uvMorphAdjacencyBuffer } },
        { binding: 6, resource: { buffer: this.uvMorphContributionsBuffer } },
        { binding: 7, resource: { buffer: this.activeMorphWeightsBuffer } },
        { binding: 8, resource: { buffer: this.skinningParamsBuffer } },
      ],
    });

    // 5. Create material render bind groups (one per range/material)
    this.materialBindGroups = [];
    for (let i = 0; i < model.ranges.length; i++) {
      const range = model.ranges[i]!;
      const baseTex = this.getTexture(range.textureIndex);
      const sphereTex = this.getTexture(range.sphereTextureIndex);
      const toonTex =
        range.toonMode === 1
          ? (this.sharedToons[range.toonTextureIndex] ?? this.defaultTexture!)
          : this.getTexture(range.toonTextureIndex);

      const bindGroup = device.createBindGroup({
        label: `Material_${range.materialIndex}_BindGroup`,
        layout: this.renderPipelines.materialBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.staticMaterialsBuffer! } },
          { binding: 1, resource: baseTex.createView() },
          { binding: 2, resource: this.baseSampler! },
          { binding: 3, resource: sphereTex.createView() },
          { binding: 4, resource: this.sphereSampler! },
          { binding: 5, resource: toonTex.createView() },
          { binding: 6, resource: this.toonSampler! },
          { binding: 7, resource: { buffer: this.dynamicMaterialsBuffer! } },
        ],
      });
      this.materialBindGroups.push(bindGroup);
    }
  }

  private getTexture(idx: number): GPUTexture {
    if (idx >= 0 && idx < this.textures.length) {
      return this.textures[idx]!;
    }
    return this.defaultTexture!;
  }

  updateCamera(
    viewProj: Float32Array,
    view: Float32Array,
    eyePos: Float32Array,
  ) {
    if (!this.context || !this.cameraUniformBuffer) return;
    const { device } = this.context;

    device.queue.writeBuffer(this.cameraUniformBuffer, 0, viewProj as any);
    device.queue.writeBuffer(this.cameraUniformBuffer, 64, view as any);
    device.queue.writeBuffer(this.cameraUniformBuffer, 128, eyePos as any);
  }

  updateBones(matrices: Float32Array) {
    if (!this.context || !this.boneMatricesBuffer) return;
    const { device } = this.context;
    const copy = new Float32Array(matrices);
    device.queue.writeBuffer(this.boneMatricesBuffer, 0, copy);
  }

  updateMaterials(materials: Float32Array) {
    if (!this.context || !this.dynamicMaterialsBuffer) return;
    const { device } = this.context;
    const copy = new Float32Array(materials);
    device.queue.writeBuffer(this.dynamicMaterialsBuffer, 0, copy);
  }

  computeDeform(weights: Float32Array) {
    if (
      !this.context ||
      !this.computePipelines ||
      !this.computeBindGroup ||
      !this.modelData
    )
      return;
    const { device } = this.context;

    const copy = new Float32Array(weights);
    device.queue.writeBuffer(this.activeMorphWeightsBuffer!, 0, copy);

    const commandEncoder = device.createCommandEncoder({
      label: "Compute Deform Encoder",
    });
    const computePass = commandEncoder.beginComputePass({
      label: "Deform Compute Pass",
    });

    computePass.setPipeline(this.computePipelines.deform);
    computePass.setBindGroup(0, this.computeBindGroup);
    const workgroupCount = Math.ceil(this.modelData.vertexCount / 64);
    computePass.dispatchWorkgroups(workgroupCount);

    computePass.end();
    device.queue.submit([commandEncoder.finish()]);
  }

  draw() {
    if (
      !this.context ||
      !this.renderPipelines ||
      !this.modelData ||
      !this.indexBuffer ||
      !this.renderVertexBuffer ||
      !this.depthTexture
    )
      return;
    const { device } = this.context;

    const context = this.canvas.getContext("webgpu") as GPUCanvasContext;
    const currentTexture = context.getCurrentTexture();

    const commandEncoder = device.createCommandEncoder({
      label: "Render Frame Encoder",
    });
    const renderPass = commandEncoder.beginRenderPass({
      label: "Main Render Pass",
      colorAttachments: [
        {
          view: currentTexture.createView(),
          clearValue: { r: 0.05, g: 0.05, b: 0.08, a: 1.0 }, // sleek dark blue-gray background
          loadOp: "clear",
          storeOp: "store",
        },
      ],
      depthStencilAttachment: {
        view: this.depthTexture!.createView(),
        depthClearValue: 1.0,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });

    renderPass.setVertexBuffer(0, this.renderVertexBuffer);
    renderPass.setIndexBuffer(this.indexBuffer, "uint32");
    renderPass.setBindGroup(0, this.cameraBindGroup);

    // 1. Draw inverted hull outline mesh (if enabled)
    if (this.outlineEnabled) {
      renderPass.setPipeline(this.renderPipelines.outline);
      for (let i = 0; i < this.modelData.ranges.length; i++) {
        const range = this.modelData.ranges[i]!;
        if (!range.castOutline) continue;

        const bindGroup = this.materialBindGroups[i]!;
        renderPass.setBindGroup(1, bindGroup);
        renderPass.drawIndexed(
          range.indexCount,
          1,
          range.firstIndex,
          0,
          range.materialIndex,
        );
      }
    }

    // 2. Draw Opaque & Cutout materials
    for (let i = 0; i < this.modelData.ranges.length; i++) {
      const range = this.modelData.ranges[i]!;
      if (range.renderClass === "blend") continue;

      const bindGroup = this.materialBindGroups[i]!;
      const pipeline = range.doubleSided
        ? this.renderPipelines.opaqueNoCull
        : this.renderPipelines.opaqueCull;

      renderPass.setPipeline(pipeline);
      renderPass.setBindGroup(1, bindGroup);
      renderPass.drawIndexed(
        range.indexCount,
        1,
        range.firstIndex,
        0,
        range.materialIndex,
      );
    }

    // 3. Draw Blended materials
    for (let i = 0; i < this.modelData.ranges.length; i++) {
      const range = this.modelData.ranges[i]!;
      if (range.renderClass !== "blend") continue;

      const bindGroup = this.materialBindGroups[i]!;

      if (range.doubleSided) {
        // Draw back faces first (using front-cull)
        renderPass.setPipeline(this.renderPipelines.transparentCullFront);
        renderPass.setBindGroup(1, bindGroup);
        renderPass.drawIndexed(
          range.indexCount,
          1,
          range.firstIndex,
          0,
          range.materialIndex,
        );

        // Draw front faces second (using back-cull)
        renderPass.setPipeline(this.renderPipelines.transparentCullBack);
        renderPass.setBindGroup(1, bindGroup);
        renderPass.drawIndexed(
          range.indexCount,
          1,
          range.firstIndex,
          0,
          range.materialIndex,
        );
      } else {
        // Draw front faces only (using back-cull)
        renderPass.setPipeline(this.renderPipelines.transparentCullBack);
        renderPass.setBindGroup(1, bindGroup);
        renderPass.drawIndexed(
          range.indexCount,
          1,
          range.firstIndex,
          0,
          range.materialIndex,
        );
      }
    }

    renderPass.end();

    if (this.pendingPixelQuery && this.readBuffer) {
      const { x, y } = this.pendingPixelQuery;
      const tx = Math.max(0, Math.min(currentTexture.width - 1, Math.floor(x)));
      const ty = Math.max(
        0,
        Math.min(currentTexture.height - 1, Math.floor(y)),
      );
      commandEncoder.copyTextureToBuffer(
        { texture: currentTexture, origin: { x: tx, y: ty, z: 0 } },
        { buffer: this.readBuffer, bytesPerRow: 256 },
        { width: 1, height: 1 },
      );
    }

    device.queue.submit([commandEncoder.finish()]);

    if (this.pendingPixelQuery && this.readBuffer) {
      const query = this.pendingPixelQuery;
      this.pendingPixelQuery = null;
      const readBuf = this.readBuffer;
      const qx = query.x;
      const qy = query.y;
      readBuf
        .mapAsync(GPUMapMode.READ)
        .then(() => {
          const array = new Uint8Array(readBuf.getMappedRange());
          const pixel = [array[0]!, array[1]!, array[2]!, array[3]!] as [
            number,
            number,
            number,
            number,
          ];
          console.log(
            `[WebGPU] readPixel probed at (${qx}, ${qy}) -> [${pixel.join(", ")}]`,
          );
          readBuf.unmap();
          query.resolve(pixel);
        })
        .catch((err) => {
          console.error("Failed to map readBuffer:", err);
          query.resolve([0, 0, 0, 0]);
        });
    }
  }

  disposeModel() {
    this.verticesInputBuffer?.destroy();
    this.renderVertexBuffer?.destroy();
    this.indexBuffer?.destroy();
    this.staticMaterialsBuffer?.destroy();
    this.dynamicMaterialsBuffer?.destroy();
    this.boneMatricesBuffer?.destroy();
    this.vertexMorphAdjacencyBuffer?.destroy();
    this.vertexMorphContributionsBuffer?.destroy();
    this.uvMorphAdjacencyBuffer?.destroy();
    this.uvMorphContributionsBuffer?.destroy();
    this.activeMorphWeightsBuffer?.destroy();
    this.skinningParamsBuffer?.destroy();

    for (const tex of this.textures) {
      if (tex !== this.defaultTexture) {
        tex.destroy();
      }
    }
    this.textures = [];
    this.samplers = [];
    this.materialBindGroups = [];

    if (this.modelData) {
      for (const bitmap of this.modelData.textureBitmaps) {
        if (bitmap) {
          bitmap.close();
        }
      }
    }
    this.modelData = null;
  }

  dispose() {
    this.disposeModel();
    this.defaultTexture?.destroy();
    this.cameraUniformBuffer?.destroy();
    this.depthTexture?.destroy();
    this.readBuffer?.destroy();
    this.readBuffer = null;
    for (const tex of this.sharedToons) {
      tex.destroy();
    }
    this.sharedToons = [];
    this.context = null;
  }

  async readPixel(
    x: number,
    y: number,
  ): Promise<[number, number, number, number]> {
    return new Promise((resolve) => {
      this.pendingPixelQuery = { x, y, resolve };
    });
  }
}
