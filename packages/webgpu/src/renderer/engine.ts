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
  toonMode: number;
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

  // Active Model Buffers
  private verticesInputBuffer: GPUBuffer | null = null;
  private morphedVertexBuffer: GPUBuffer | null = null;
  private renderVertexBuffer: GPUBuffer | null = null;
  private indexBuffer: GPUBuffer | null = null;
  private materialsBuffer: GPUBuffer | null = null;
  private boneMatricesBuffer: GPUBuffer | null = null;
  private vertexMorphOffsetsBuffer: GPUBuffer | null = null;
  private uvMorphOffsetsBuffer: GPUBuffer | null = null;
  private cameraUniformBuffer: GPUBuffer | null = null;
  private morphParamsBuffer: GPUBuffer | null = null;
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

  public outlineEnabled = true;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  async initialize(onDeviceLost?: (reason: string) => void): Promise<void> {
    this.context = await initWebGpu(this.canvas, onDeviceLost);
    const { device, format } = this.context;

    this.renderPipelines = createRenderPipelines(device, format);
    this.computePipelines = createComputePipelines(device);

    this.defaultTexture = createFallbackTexture(device);
    this.defaultSampler = createFallbackSampler(device);

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

    this.materialsBuffer = createBufferWithData(
      device,
      "Materials Buffer",
      model.materials,
      GPUBufferUsage.STORAGE,
    );

    this.vertexMorphOffsetsBuffer = createBufferWithData(
      device,
      "Vertex Morph Offsets Buffer",
      model.vertexMorphOffsets,
      GPUBufferUsage.STORAGE,
    );

    this.uvMorphOffsetsBuffer = createBufferWithData(
      device,
      "UV Morph Offsets Buffer",
      model.uvMorphOffsets,
      GPUBufferUsage.STORAGE,
    );

    // 2. Allocate runtime buffers
    this.morphedVertexBuffer = createBuffer(
      device,
      "Morphed Vertex Buffer",
      model.vertexCount * 32, // Struct MorphedVertex: pos(12) + norm(12) + uv(8) = 32
      GPUBufferUsage.STORAGE,
    );

    this.renderVertexBuffer = createBuffer(
      device,
      "Render Vertex Buffer",
      model.vertexCount * 32, // Struct RenderVertex: pos(12) + norm(12) + uv(8) = 32
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

    const alignment = device.limits.minUniformBufferOffsetAlignment;
    this.morphParamsBuffer = createBuffer(
      device,
      "Morph Params Buffer",
      128 * alignment, // support up to 128 active morphs
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    );

    this.skinningParamsBuffer = createBuffer(
      device,
      "Skinning Params Buffer",
      16, // count(4) + pad(12)
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    );
    // Write skinning parameters
    const skinParams = new Uint32Array([model.vertexCount, 0, 0, 0]);
    device.queue.writeBuffer(this.skinningParamsBuffer, 0, skinParams);

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
        { binding: 1, resource: { buffer: this.morphedVertexBuffer } },
        { binding: 2, resource: { buffer: this.renderVertexBuffer } },
        { binding: 3, resource: { buffer: this.boneMatricesBuffer } },
        { binding: 4, resource: { buffer: this.vertexMorphOffsetsBuffer } },
        { binding: 5, resource: { buffer: this.uvMorphOffsetsBuffer } },
        {
          binding: 6,
          resource: { buffer: this.morphParamsBuffer, offset: 0, size: 16 },
        },
        { binding: 7, resource: { buffer: this.skinningParamsBuffer } },
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
          { binding: 0, resource: { buffer: this.materialsBuffer } },
          { binding: 1, resource: baseTex.createView() },
          { binding: 2, resource: this.defaultSampler! },
          { binding: 3, resource: sphereTex.createView() },
          { binding: 4, resource: this.defaultSampler! },
          { binding: 5, resource: toonTex.createView() },
          { binding: 6, resource: this.defaultSampler! },
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
    device.queue.writeBuffer(this.boneMatricesBuffer, 0, matrices as any);
  }

  computeDeform(
    activeMorphs: {
      type: "vertex" | "uv";
      start: number;
      count: number;
      weight: number;
      channel: number;
    }[],
  ) {
    if (
      !this.context ||
      !this.computePipelines ||
      !this.computeBindGroup ||
      !this.modelData
    )
      return;
    const { device } = this.context;

    const commandEncoder = device.createCommandEncoder({
      label: "Compute Deform Encoder",
    });
    const computePass = commandEncoder.beginComputePass({
      label: "Deform Compute Pass",
    });

    // 1. Reset positions (with default dynamic offset of 0)
    computePass.setPipeline(this.computePipelines.reset);
    computePass.setBindGroup(0, this.computeBindGroup, [0]);
    const workgroupCount = Math.ceil(this.modelData.vertexCount / 64);
    computePass.dispatchWorkgroups(workgroupCount);

    // 2. Accumulate active morphs using dynamic uniform offsets
    const alignment = device.limits.minUniformBufferOffsetAlignment;
    const validMorphs = activeMorphs.filter(
      (m) => m.weight > 0.0 && m.count > 0,
    );

    if (validMorphs.length > 0) {
      const totalSize = validMorphs.length * alignment;
      const bufferData = new ArrayBuffer(totalSize);
      const f32View = new Float32Array(bufferData);
      const u32View = new Uint32Array(bufferData);

      for (let i = 0; i < validMorphs.length; i++) {
        const morph = validMorphs[i]!;
        const elementOffset = i * (alignment / 4);
        f32View[elementOffset + 0] = morph.weight;
        u32View[elementOffset + 1] = morph.start;
        u32View[elementOffset + 2] = morph.count;
        u32View[elementOffset + 3] = morph.channel;
      }

      device.queue.writeBuffer(this.morphParamsBuffer!, 0, bufferData);

      for (let i = 0; i < validMorphs.length; i++) {
        const morph = validMorphs[i]!;
        const dynamicOffset = i * alignment;

        computePass.setBindGroup(0, this.computeBindGroup, [dynamicOffset]);

        if (morph.type === "vertex") {
          computePass.setPipeline(this.computePipelines.vertexMorph);
        } else {
          computePass.setPipeline(this.computePipelines.uvMorph);
        }
        const morphWorkgroups = Math.ceil(morph.count / 64);
        computePass.dispatchWorkgroups(morphWorkgroups);
      }
    }

    // 3. Run skinning (with default dynamic offset of 0)
    computePass.setPipeline(this.computePipelines.skin);
    computePass.setBindGroup(0, this.computeBindGroup, [0]);
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

    // 1. Draw solid geometry
    for (let i = 0; i < this.modelData.ranges.length; i++) {
      const range = this.modelData.ranges[i]!;
      const bindGroup = this.materialBindGroups[i]!;

      let pipeline = this.renderPipelines.opaqueCull;
      if (range.transparent) {
        pipeline = range.doubleSided
          ? this.renderPipelines.transparentNoCull
          : this.renderPipelines.transparentCull;
      } else {
        pipeline = range.doubleSided
          ? this.renderPipelines.opaqueNoCull
          : this.renderPipelines.opaqueCull;
      }

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

    // 2. Draw inverted hull outline mesh (if enabled)
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

    renderPass.end();
    device.queue.submit([commandEncoder.finish()]);
  }

  disposeModel() {
    this.verticesInputBuffer?.destroy();
    this.morphedVertexBuffer?.destroy();
    this.renderVertexBuffer?.destroy();
    this.indexBuffer?.destroy();
    this.materialsBuffer?.destroy();
    this.boneMatricesBuffer?.destroy();
    this.vertexMorphOffsetsBuffer?.destroy();
    this.uvMorphOffsetsBuffer?.destroy();
    this.morphParamsBuffer?.destroy();
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
    for (const tex of this.sharedToons) {
      tex.destroy();
    }
    this.sharedToons = [];
    this.context = null;
  }
}
