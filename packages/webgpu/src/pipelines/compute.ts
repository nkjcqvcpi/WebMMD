// SPDX-License-Identifier: AGPL-3.0-or-later

import computeCode from "../shaders/deform.wgsl?raw";

export interface ComputePipelines {
  deform: GPUComputePipeline;
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
        binding: 1, // output_vertices: RenderVertex
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" },
      },
      {
        binding: 2, // bone_matrices: mat4x4
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 3, // vertex_morph_adjacency: vec2<u32>
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 4, // vertex_morph_contributions: VertexMorphContribution
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 5, // uv_morph_adjacency: vec2<u32>
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 6, // uv_morph_contributions: UvMorphContribution
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 7, // active_morph_weights: array<f32>
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 8, // skinning_params: SkinningParams
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "uniform" },
      },
    ],
  });

  const pipelineLayout = device.createPipelineLayout({
    label: "Compute Pipeline Layout",
    bindGroupLayouts: [bindGroupLayout],
  });

  const deform = device.createComputePipeline({
    label: "Deform Vertices Pipeline",
    layout: pipelineLayout,
    compute: {
      module: computeModule,
      entryPoint: "deform_vertices",
    },
  });

  return { deform, bindGroupLayout };
}
