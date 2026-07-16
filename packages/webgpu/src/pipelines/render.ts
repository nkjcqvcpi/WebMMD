// SPDX-License-Identifier: GPL-3.0-or-later

import shaderCode from "../shaders/main.wgsl?raw";

export interface RenderPipelines {
  main: GPURenderPipeline;
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
    ],
  });

  const pipelineLayout = device.createPipelineLayout({
    label: "Main Render Pipeline Layout",
    bindGroupLayouts: [cameraBindGroupLayout, materialBindGroupLayout],
  });

  // Vertex buffer layout for the skinned output vertices (positions, normals, uvs)
  const vertexBufferLayout: GPUVertexBufferLayout = {
    arrayStride: 32, // pos(12) + normal(12) + uv(8) = 32 bytes
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
    ],
  };

  // Main Render Pipeline
  const main = device.createRenderPipeline({
    label: "WebMMD Main Render Pipeline",
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
      cullMode: "none", // Double-sided control is dynamic via culling options in code, default none
    },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: true,
      depthCompare: "less-equal",
    },
  });

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
      cullMode: "front", // Inverted hull requires front-face culling to show the inner outline mesh
    },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: true,
      depthCompare: "less-equal",
    },
  });

  return { main, outline, cameraBindGroupLayout, materialBindGroupLayout };
}
