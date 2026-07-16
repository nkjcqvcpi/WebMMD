// SPDX-License-Identifier: GPL-3.0-or-later

import computeCode from "../shaders/deform.wgsl?raw";

export interface ComputePipelines {
  reset: GPUComputePipeline;
  vertexMorph: GPUComputePipeline;
  uvMorph: GPUComputePipeline;
  skin: GPUComputePipeline;
  bindGroupLayout: GPUBindGroupLayout;
}

export function createComputePipelines(device: GPUDevice): ComputePipelines {
  const computeModule = device.createShaderModule({
    label: "Compute Deform Shaders",
    code: computeCode,
  });

  const bindGroupLayout = device.createBindGroupLayout({
    label: "Compute Bind Group Layout",
    entries: [
      {
        binding: 0, // inputs: SkinningInput
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 1, // morphed_vertices: MorphedVertex
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" },
      },
      {
        binding: 2, // output_vertices: RenderVertex
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" },
      },
      {
        binding: 3, // bone_matrices: mat4x4
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 4, // vertex_morph_offsets: VertexMorphOffset
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 5, // uv_morph_offsets: UvMorphOffset
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 6, // morph_params: MorphParams
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "uniform" },
      },
      {
        binding: 7, // skinning_params: SkinningParams
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "uniform" },
      },
    ],
  });

  const pipelineLayout = device.createPipelineLayout({
    label: "Compute Pipeline Layout",
    bindGroupLayouts: [bindGroupLayout],
  });

  const reset = device.createComputePipeline({
    label: "Reset Vertices Pipeline",
    layout: pipelineLayout,
    compute: {
      module: computeModule,
      entryPoint: "reset_vertices",
    },
  });

  const vertexMorph = device.createComputePipeline({
    label: "Apply Vertex Morph Pipeline",
    layout: pipelineLayout,
    compute: {
      module: computeModule,
      entryPoint: "apply_vertex_morph",
    },
  });

  const uvMorph = device.createComputePipeline({
    label: "Apply UV Morph Pipeline",
    layout: pipelineLayout,
    compute: {
      module: computeModule,
      entryPoint: "apply_uv_morph",
    },
  });

  const skin = device.createComputePipeline({
    label: "Skin Vertices Pipeline",
    layout: pipelineLayout,
    compute: {
      module: computeModule,
      entryPoint: "skin_vertices",
    },
  });

  return { reset, vertexMorph, uvMorph, skin, bindGroupLayout };
}
