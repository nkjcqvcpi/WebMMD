// SPDX-License-Identifier: AGPL-3.0-or-later

import shaderCode from "../shaders/main.wgsl?raw";

export interface RenderPipelines {
  opaqueCull: GPURenderPipeline;
  opaqueNoCull: GPURenderPipeline;
  transparentCullBack: GPURenderPipeline;
  transparentCullFront: GPURenderPipeline;
  outline: GPURenderPipeline;
  cameraBindGroupLayout: GPUBindGroupLayout;
  materialBindGroupLayout: GPUBindGroupLayout;
}

export function createRenderPipelines(
  device: GPUDevice,
  canvasFormat: GPUTextureFormat,
): RenderPipelines {
  const shaderModule = device.createShaderModule({
    label: "Main Render Shaders",
    code: shaderCode,
  });

  // Bind Group Layout 0: Camera Uniforms
  const cameraBindGroupLayout = device.createBindGroupLayout({
    label: "Camera Bind Group Layout",
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
    ],
  });

  // Bind Group Layout 1: Material Storage + Textures
  const materialBindGroupLayout = device.createBindGroupLayout({
    label: "Material Bind Group Layout",
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        texture: {},
      },
      {
        binding: 2,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: {},
      },
      {
        binding: 3,
        visibility: GPUShaderStage.FRAGMENT,
        texture: {},
      },
      {
        binding: 4,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: {},
      },
      {
        binding: 5,
        visibility: GPUShaderStage.FRAGMENT,
        texture: {},
      },
      {
        binding: 6,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: {},
      },
      {
        binding: 7,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: "read-only-storage" },
      },
    ],
  });

  const pipelineLayout = device.createPipelineLayout({
    label: "Main Render Pipeline Layout",
    bindGroupLayouts: [cameraBindGroupLayout, materialBindGroupLayout],
  });

  // Vertex buffer layout for the skinned output vertices (positions, normals, uvs, edgeScale)
  const vertexBufferLayout: GPUVertexBufferLayout = {
    arrayStride: 36, // pos(12) + normal(12) + uv(8) + edge_scale(4) = 36 bytes
    attributes: [
      {
        shaderLocation: 0, // position
        offset: 0,
        format: "float32x3",
      },
      {
        shaderLocation: 1, // normal
        offset: 12,
        format: "float32x3",
      },
      {
        shaderLocation: 2, // uv
        offset: 24,
        format: "float32x2",
      },
      {
        shaderLocation: 3, // edge_scale
        offset: 32,
        format: "float32",
      },
    ],
  };

  // Helper function to create main render pipelines with varied primitive and fragment targets
  const createPipeline = (
    label: string,
    cullMode: GPUCullMode,
    isTransparent: boolean,
  ): GPURenderPipeline => {
    return device.createRenderPipeline({
      label,
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: "vs_main",
        buffers: [vertexBufferLayout],
      },
      fragment: {
        module: shaderModule,
        entryPoint: "fs_main",
        targets: [
          {
            format: canvasFormat,
            blend: isTransparent
              ? {
                  color: {
                    srcFactor: "src-alpha",
                    dstFactor: "one-minus-src-alpha",
                    operation: "add",
                  },
                  alpha: {
                    srcFactor: "one",
                    dstFactor: "one-minus-src-alpha",
                    operation: "add",
                  },
                }
              : undefined,
          },
        ],
      },
      primitive: {
        topology: "triangle-list",
        frontFace: "cw",
        cullMode,
      },
      depthStencil: {
        format: "depth24plus",
        depthWriteEnabled: !isTransparent,
        depthCompare: "less-equal",
      },
    });
  };

  const opaqueCull = createPipeline(
    "WebMMD Opaque Cull Pipeline",
    "back",
    false,
  );
  const opaqueNoCull = createPipeline(
    "WebMMD Opaque No Cull Pipeline",
    "none",
    false,
  );
  const transparentCullBack = createPipeline(
    "WebMMD Transparent Cull Back Pipeline",
    "back",
    true,
  );
  const transparentCullFront = createPipeline(
    "WebMMD Transparent Cull Front Pipeline",
    "front",
    true,
  );

  // Outline Render Pipeline
  const outline = device.createRenderPipeline({
    label: "WebMMD Inverted Hull Outline Pipeline",
    layout: pipelineLayout,
    vertex: {
      module: shaderModule,
      entryPoint: "vs_outline",
      buffers: [vertexBufferLayout],
    },
    fragment: {
      module: shaderModule,
      entryPoint: "fs_outline",
      targets: [
        {
          format: canvasFormat,
          blend: {
            color: {
              srcFactor: "src-alpha",
              dstFactor: "one-minus-src-alpha",
              operation: "add",
            },
            alpha: {
              srcFactor: "one",
              dstFactor: "one-minus-src-alpha",
              operation: "add",
            },
          },
        },
      ],
    },
    primitive: {
      topology: "triangle-list",
      frontFace: "cw",
      cullMode: "front", // Inverted hull requires front-face culling to show the inner outline mesh
    },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: true,
      depthCompare: "less-equal",
    },
  });

  return {
    opaqueCull,
    opaqueNoCull,
    transparentCullBack,
    transparentCullFront,
    outline,
    cameraBindGroupLayout,
    materialBindGroupLayout,
  };
}
