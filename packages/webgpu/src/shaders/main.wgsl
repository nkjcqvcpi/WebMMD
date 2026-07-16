// SPDX-License-Identifier: AGPL-3.0-or-later

struct CameraUniforms {
  view_projection: mat4x4<f32>,
  view: mat4x4<f32>,
  eye_position: vec3<f32>,
  padding: f32,
};

struct StaticMaterial {
  texture_indices: vec4<i32>, // base, sphere, toon, render_class
  flags_modes: vec4<u32>,     // flags, sphere_mode, toon_mode, padding
};

struct DynamicMaterial {
  diffuse: vec4<f32>,
  ambient_shininess: vec4<f32>, // ambient (12 bytes) + shininess (4 bytes)
  specular: vec4<f32>,          // specular (12 bytes) + padding (4 bytes)
  edge_color: vec4<f32>,
  edge_parameters: vec4<f32>,   // edge_size, padding x 3
  texture_tint: vec4<f32>,
  sphere_tint: vec4<f32>,
  toon_tint: vec4<f32>,
};

@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(1) @binding(0) var<storage, read> static_materials: array<StaticMaterial>;
@group(1) @binding(1) var base_texture: texture_2d<f32>;
@group(1) @binding(2) var base_sampler: sampler;
@group(1) @binding(3) var sphere_texture: texture_2d<f32>;
@group(1) @binding(4) var sphere_sampler: sampler;
@group(1) @binding(5) var toon_texture: texture_2d<f32>;
@group(1) @binding(6) var toon_sampler: sampler;
@group(1) @binding(7) var<storage, read> dynamic_materials: array<DynamicMaterial>;

struct VertexInput {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
  @location(3) edge_scale: f32,
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

  let dyn_mat = dynamic_materials[mat_idx];
  let edge_size = dyn_mat.edge_parameters.x;
  let edge_scale = input.edge_scale;
  let globalOutlineScale = 0.01;

  // Extrude vertex along normal in object space
  let extruded_pos = input.position + output.normal * (edge_size * edge_scale * globalOutlineScale);
  let world_pos = vec4<f32>(extruded_pos, 1.0);

  output.world_position = world_pos.xyz;
  output.position = camera.view_projection * world_pos;
  output.view_normal = vec3<f32>(0.0);

  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  let mat_idx = input.material_idx;
  let stat_mat = static_materials[mat_idx];
  let dyn_mat = dynamic_materials[mat_idx];

  // Base texture
  var color = dyn_mat.diffuse;
  let has_base_tex = stat_mat.texture_indices.x >= 0;
  if (has_base_tex) {
    let tex_color = textureSample(base_texture, base_sampler, input.uv);
    color *= tex_color * dyn_mat.texture_tint;
  }

  // Alpha discard classification check
  let render_class = stat_mat.texture_indices.w;
  if (render_class == 1) { // Alpha Cutout
    if (color.a < 0.5) {
      discard;
    }
  } else if (color.a < 0.05) { // Opaque / Blend basic discard
    discard;
  }

  // Toon lighting
  let toon_mode = i32(stat_mat.flags_modes.z);
  let has_toon = stat_mat.texture_indices.z >= 0;
  
  var lighting = vec3<f32>(1.0);
  
  if (toon_mode == 0 && has_toon) { // Custom toon
    let light_dir = normalize(vec3<f32>(0.5, 1.0, 0.5)); // Fixed light direction
    let ndotl = dot(normalize(input.normal), light_dir);
    let toon_uv = vec2<f32>(0.5, clamp(ndotl * 0.5 + 0.5, 0.0, 1.0));
    let toon_color = textureSample(toon_texture, toon_sampler, toon_uv).rgb;
    lighting = toon_color * dyn_mat.toon_tint.rgb;
  } else if (toon_mode == 1) { // Shared toon
    let light_dir = normalize(vec3<f32>(0.5, 1.0, 0.5));
    let ndotl = dot(normalize(input.normal), light_dir);
    let toon_uv = vec2<f32>(0.5, clamp(ndotl * 0.5 + 0.5, 0.0, 1.0));
    let toon_color = textureSample(toon_texture, toon_sampler, toon_uv).rgb;
    lighting = toon_color * dyn_mat.toon_tint.rgb;
  } else {
    // Basic diffuse shading fallback
    let light_dir = normalize(vec3<f32>(0.5, 1.0, 0.5));
    let ndotl = max(dot(normalize(input.normal), light_dir), 0.0);
    lighting = vec3<f32>(ndotl * 0.6 + 0.4);
  }

  var final_rgb = color.rgb * (0.4 * dyn_mat.ambient_shininess.rgb + 0.8 * lighting);

  // Sphere map
  let sphere_mode = i32(stat_mat.flags_modes.y);
  let has_sphere = stat_mat.texture_indices.y >= 0;
  if (has_sphere && sphere_mode > 0) {
    // Generate view-space projected normal coordinates
    let sphere_uv = vec2<f32>(
      input.view_normal.x * 0.5 + 0.5,
      -input.view_normal.y * 0.5 + 0.5
    );
    let sphere_color = textureSample(sphere_texture, sphere_sampler, sphere_uv);
    let sphere_val = sphere_color.rgb * dyn_mat.sphere_tint.rgb;
    if (sphere_mode == 1) { // Multiply
      final_rgb *= sphere_val;
    } else if (sphere_mode == 2) { // Additive
      final_rgb += sphere_val * color.a; // Scale by alpha for transparency support
    }
  }

  return vec4<f32>(clamp(final_rgb, vec3<f32>(0.0), vec3<f32>(1.0)), color.a);
}

@fragment
fn fs_outline(input: VertexOutput) -> @location(0) vec4<f32> {
  let mat_idx = input.material_idx;
  let stat_mat = static_materials[mat_idx];
  let dyn_mat = dynamic_materials[mat_idx];

  // Alpha discard check if base texture is transparent
  var alpha = dyn_mat.edge_color.a;
  if (stat_mat.texture_indices.x >= 0) {
    let tex_color = textureSample(base_texture, base_sampler, input.uv);
    if (tex_color.a < 0.1) {
      discard;
    }
  }

  return vec4<f32>(dyn_mat.edge_color.rgb, alpha);
}
