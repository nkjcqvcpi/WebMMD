// SPDX-License-Identifier: AGPL-3.0-or-later

struct CameraUniforms {
  view_projection: mat4x4<f32>,
  view: mat4x4<f32>,
  eye_position: vec3<f32>,
  padding: f32,
};

struct Material {
  diffuse: vec4<f32>,
  ambient_shininess: vec4<f32>, // ambient (12 bytes) + shininess (4 bytes)
  specular: vec4<f32>, // specular (12 bytes) + padding (4 bytes)
  edge_color: vec4<f32>,
  edge_parameters: vec4<f32>, // edge_size, padding
  texture_indices: vec4<i32>, // base, sphere, toon, padding
  material_flags: vec4<u32>, // flags, sphere_mode, toon_mode, padding
};

@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(1) @binding(0) var<storage, read> materials: array<Material>;
@group(1) @binding(1) var base_texture: texture_2d<f32>;
@group(1) @binding(2) var base_sampler: sampler;
@group(1) @binding(3) var sphere_texture: texture_2d<f32>;
@group(1) @binding(4) var sphere_sampler: sampler;
@group(1) @binding(5) var toon_texture: texture_2d<f32>;
@group(1) @binding(6) var toon_sampler: sampler;

struct VertexInput {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
  @builtin(instance_index) instance_idx: u32,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) world_position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
  @location(3) view_normal: vec3<f32>,
  @location(4) @interpolate(flat) material_idx: u32,
};

@vertex
fn vs_main(
  input: VertexInput,
  @builtin(vertex_index) vertex_idx: u32,
) -> VertexOutput {
  var output: VertexOutput;
  let mat_idx = input.instance_idx;
  output.material_idx = mat_idx;
  output.uv = input.uv;
  output.normal = normalize(input.normal);

  // View space normal for sphere mapping
  let view_normal_4 = camera.view * vec4<f32>(output.normal, 0.0);
  output.view_normal = normalize(view_normal_4.xyz);

  let world_pos = vec4<f32>(input.position, 1.0);
  output.world_position = world_pos.xyz;
  output.position = camera.view_projection * world_pos;

  return output;
}

@vertex
fn vs_outline(
  input: VertexInput,
  @builtin(vertex_index) vertex_idx: u32,
) -> VertexOutput {
  var output: VertexOutput;
  let mat_idx = input.instance_idx;
  output.material_idx = mat_idx;
  output.uv = input.uv;
  output.normal = normalize(input.normal);

  let material = materials[mat_idx];
  let edge_size = material.edge_parameters.x;

  // Extrude vertex along normal in object space
  let extruded_pos = input.position + output.normal * (edge_size * 0.01);
  let world_pos = vec4<f32>(extruded_pos, 1.0);

  output.world_position = world_pos.xyz;
  output.position = camera.view_projection * world_pos;
  output.view_normal = vec3<f32>(0.0);

  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  let mat_idx = input.material_idx;
  let material = materials[mat_idx];

  // Base texture
  var color = material.diffuse;
  let has_base_tex = material.texture_indices.x >= 0;
  if (has_base_tex) {
    let tex_color = textureSample(base_texture, base_sampler, input.uv);
    color *= tex_color;
  }

  // Early alpha discard
  if (color.a < 0.05) {
    discard;
  }

  // Toon lighting
  let toon_mode = i32(material.material_flags.z);
  let has_toon = material.texture_indices.z >= 0;
  
  var lighting = vec3<f32>(1.0);
  
  if (toon_mode == 0 && has_toon) { // Custom toon
    let light_dir = normalize(vec3<f32>(0.5, 1.0, 0.5)); // Fixed light direction
    let ndotl = dot(normalize(input.normal), light_dir);
    let toon_uv = vec2<f32>(0.5, clamp(ndotl * 0.5 + 0.5, 0.0, 1.0));
    let toon_color = textureSample(toon_texture, toon_sampler, toon_uv).rgb;
    lighting = toon_color;
  } else if (toon_mode == 1) { // Shared toon
    let light_dir = normalize(vec3<f32>(0.5, 1.0, 0.5));
    let ndotl = dot(normalize(input.normal), light_dir);
    let toon_uv = vec2<f32>(0.5, clamp(ndotl * 0.5 + 0.5, 0.0, 1.0));
    let toon_color = textureSample(toon_texture, toon_sampler, toon_uv).rgb;
    lighting = toon_color;
  } else {
    // Basic diffuse shading fallback
    let light_dir = normalize(vec3<f32>(0.5, 1.0, 0.5));
    let ndotl = max(dot(normalize(input.normal), light_dir), 0.0);
    lighting = vec3<f32>(ndotl * 0.6 + 0.4);
  }

  var final_rgb = color.rgb * (0.4 * material.ambient_shininess.rgb + 0.8 * lighting);

  // Sphere map
  let sphere_mode = i32(material.material_flags.y);
  let has_sphere = material.texture_indices.y >= 0;
  if (has_sphere && sphere_mode > 0) {
    // Generate view-space projected normal coordinates
    let sphere_uv = vec2<f32>(
      input.view_normal.x * 0.5 + 0.5,
      -input.view_normal.y * 0.5 + 0.5
    );
    let sphere_color = textureSample(sphere_texture, sphere_sampler, sphere_uv);
    if (sphere_mode == 1) { // Multiply
      final_rgb *= sphere_color.rgb;
    } else if (sphere_mode == 2) { // Additive
      final_rgb += sphere_color.rgb * color.a; // Scale by alpha for transparency support
    }
  }

  return vec4<f32>(clamp(final_rgb, vec3<f32>(0.0), vec3<f32>(1.0)), color.a);
}

@fragment
fn fs_outline(input: VertexOutput) -> @location(0) vec4<f32> {
  let mat_idx = input.material_idx;
  let material = materials[mat_idx];

  // Alpha discard check if base texture is transparent
  var alpha = material.edge_color.a;
  if (material.texture_indices.x >= 0) {
    let tex_color = textureSample(base_texture, base_sampler, input.uv);
    if (tex_color.a < 0.1) {
      discard;
    }
  }

  return vec4<f32>(material.edge_color.rgb, alpha);
}
