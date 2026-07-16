// SPDX-License-Identifier: AGPL-3.0-or-later

struct SkinningInput {
  position: vec3<f32>,
  padding1: f32,
  normal: vec3<f32>,
  padding2: f32,
  uv: vec2<f32>,
  padding3: vec2<f32>,
  bone_indices: vec4<i32>,
  bone_weights: vec4<f32>,
  deform_type: i32,
  edge_scale: f32,
  padding4: vec2<f32>,
  sdef_c: vec3<f32>,
  padding5: f32,
  sdef_r0: vec3<f32>,
  padding6: f32,
  sdef_r1: vec3<f32>,
  padding7: f32,
};

struct MorphedVertex {
  pos: vec3<f32>,
  normal_x: f32,
  normal_y: f32,
  normal_z: f32,
  u: f32,
  v: f32,
};

struct RenderVertex {
  pos: vec3<f32>,
  normal_x: f32,
  normal_y: f32,
  normal_z: f32,
  u: f32,
  v: f32,
};

struct VertexMorphOffset {
  vertex_idx: u32,
  padding: vec3<u32>,
  offset: vec3<f32>,
  padding2: f32,
};

struct UvMorphOffset {
  vertex_idx: u32,
  padding: vec3<u32>,
  offset: vec4<f32>,
};

struct MorphParams {
  weight: f32,
  offset_start: u32,
  offset_count: u32,
  channel: u32,
};

struct SkinningParams {
  vertex_count: u32,
  padding1: u32,
  padding2: u32,
  padding3: u32,
};

@group(0) @binding(0) var<storage, read> inputs: array<SkinningInput>;
@group(0) @binding(1) var<storage, read_write> morphed_vertices: array<MorphedVertex>;
@group(0) @binding(2) var<storage, read_write> output_vertices: array<RenderVertex>;
@group(0) @binding(3) var<storage, read> bone_matrices: array<mat4x4<f32>>;
@group(0) @binding(4) var<storage, read> vertex_morph_offsets: array<VertexMorphOffset>;
@group(0) @binding(5) var<storage, read> uv_morph_offsets: array<UvMorphOffset>;
@group(0) @binding(6) var<uniform> morph_params: MorphParams;
@group(0) @binding(7) var<uniform> skinning_params: SkinningParams;

@compute @workgroup_size(64)
fn reset_vertices(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let idx = global_id.x;
  if (idx >= skinning_params.vertex_count) {
    return;
  }
  let input = inputs[idx];
  morphed_vertices[idx].pos = input.position;
  morphed_vertices[idx].normal_x = input.normal.x;
  morphed_vertices[idx].normal_y = input.normal.y;
  morphed_vertices[idx].normal_z = input.normal.z;
  morphed_vertices[idx].u = input.uv.x;
  morphed_vertices[idx].v = input.uv.y;
}

@compute @workgroup_size(64)
fn apply_vertex_morph(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let thread_idx = global_id.x;
  if (thread_idx >= morph_params.offset_count) {
    return;
  }
  let offset_idx = morph_params.offset_start + thread_idx;
  let item = vertex_morph_offsets[offset_idx];
  let v_idx = item.vertex_idx;
  let weight = morph_params.weight;

  morphed_vertices[v_idx].pos += item.offset * weight;
}

@compute @workgroup_size(64)
fn apply_uv_morph(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let thread_idx = global_id.x;
  if (thread_idx >= morph_params.offset_count) {
    return;
  }
  let offset_idx = morph_params.offset_start + thread_idx;
  let item = uv_morph_offsets[offset_idx];
  let v_idx = item.vertex_idx;
  let weight = morph_params.weight;

  if (morph_params.channel == 0u) {
    morphed_vertices[v_idx].u += item.offset.x * weight;
    morphed_vertices[v_idx].v += item.offset.y * weight;
  }
}

// Math Helpers for SDEF and QDEF
fn quat_from_mat4(m: mat4x4<f32>) -> vec4<f32> {
  let tr = m[0][0] + m[1][1] + m[2][2];
  var q: vec4<f32>;
  if (tr > 0.0) {
    let s = sqrt(tr + 1.0) * 2.0;
    q.w = 0.25 * s;
    q.x = (m[1][2] - m[2][1]) / s;
    q.y = (m[2][0] - m[0][2]) / s;
    q.z = (m[0][1] - m[1][0]) / s;
  } else if ((m[0][0] > m[1][1]) && (m[0][0] > m[2][2])) {
    let s = sqrt(1.0 + m[0][0] - m[1][1] - m[2][2]) * 2.0;
    q.w = (m[1][2] - m[2][1]) / s;
    q.x = 0.25 * s;
    q.y = (m[0][1] + m[1][0]) / s;
    q.z = (m[2][0] + m[0][2]) / s;
  } else if (m[1][1] > m[2][2]) {
    let s = sqrt(1.0 + m[1][1] - m[0][0] - m[2][2]) * 2.0;
    q.w = (m[2][0] - m[0][2]) / s;
    q.x = (m[0][1] + m[1][0]) / s;
    q.y = 0.25 * s;
    q.z = (m[1][2] + m[2][1]) / s;
  } else {
    let s = sqrt(1.0 + m[2][2] - m[0][0] - m[1][1]) * 2.0;
    q.w = (m[0][1] - m[1][0]) / s;
    q.x = (m[2][0] + m[0][2]) / s;
    q.y = (m[1][2] + m[2][1]) / s;
    q.z = 0.25 * s;
  }
  return normalize(q);
}

fn quat_slerp(q1: vec4<f32>, q2: vec4<f32>, t: f32) -> vec4<f32> {
  var dot_p = dot(q1, q2);
  var target_q2 = q2;
  if (dot_p < 0.0) {
    dot_p = -dot_p;
    target_q2 = -q2;
  }
  if (dot_p > 0.9995) {
    return normalize(q1 + (target_q2 - q1) * t);
  }
  let theta_0 = acos(dot_p);
  let theta = theta_0 * t;
  let sin_theta = sin(theta);
  let sin_theta_0 = sin(theta_0);
  let s0 = sin(theta_0 - theta) / sin_theta_0;
  let s1 = sin_theta / sin_theta_0;
  return q1 * s0 + target_q2 * s1;
}

fn mat4_from_quat(q: vec4<f32>) -> mat4x4<f32> {
  let xx = q.x * q.x;
  let xy = q.x * q.y;
  let xz = q.x * q.z;
  let xw = q.x * q.w;
  let yy = q.y * q.y;
  let yz = q.y * q.z;
  let yw = q.y * q.w;
  let zz = q.z * q.z;
  let zw = q.z * q.w;

  return mat4x4<f32>(
    vec4<f32>(1.0 - 2.0 * (yy + zz),       2.0 * (xy + zw),       2.0 * (xz - yw), 0.0),
    vec4<f32>(      2.0 * (xy - zw), 1.0 - 2.0 * (xx + zz),       2.0 * (yz + xw), 0.0),
    vec4<f32>(      2.0 * (xz + yw),       2.0 * (yz - xw), 1.0 - 2.0 * (xx + yy), 0.0),
    vec4<f32>(0.0, 0.0, 0.0, 1.0)
  );
}

@compute @workgroup_size(64)
fn skin_vertices(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let idx = global_id.x;
  if (idx >= skinning_params.vertex_count) {
    return;
  }

  let input = inputs[idx];
  let morphed = morphed_vertices[idx];
  let morphed_pos = morphed.pos;
  let morphed_normal = vec3<f32>(morphed.normal_x, morphed.normal_y, morphed.normal_z);
  let morphed_uv = vec2<f32>(morphed.u, morphed.v);

  var final_pos = morphed_pos;
  var final_norm = morphed_normal;

  let deform_type = input.deform_type;

  if (deform_type == 0) { // BDEF1
    let bone_idx = input.bone_indices[0];
    if (bone_idx >= 0) {
      let m = bone_matrices[bone_idx];
      final_pos = (m * vec4<f32>(morphed_pos, 1.0)).xyz;
      final_norm = (m * vec4<f32>(morphed_normal, 0.0)).xyz;
    }
  } 
  else if (deform_type == 1) { // BDEF2
    let bone0 = input.bone_indices[0];
    let bone1 = input.bone_indices[1];
    let w0 = input.bone_weights[0];
    let w1 = input.bone_weights[1];

    var m = mat4x4<f32>(vec4<f32>(0.0), vec4<f32>(0.0), vec4<f32>(0.0), vec4<f32>(0.0));
    var weight_sum = 0.0;
    if (bone0 >= 0) { m += bone_matrices[bone0] * w0; weight_sum += w0; }
    if (bone1 >= 0) { m += bone_matrices[bone1] * w1; weight_sum += w1; }

    if (weight_sum > 0.0001) {
      final_pos = (m * vec4<f32>(morphed_pos, 1.0)).xyz / weight_sum;
      final_norm = (m * vec4<f32>(morphed_normal, 0.0)).xyz;
    }
  } 
  else if (deform_type == 2) { // BDEF4
    let bone0 = input.bone_indices[0];
    let bone1 = input.bone_indices[1];
    let bone2 = input.bone_indices[2];
    let bone3 = input.bone_indices[3];
    let w0 = input.bone_weights[0];
    let w1 = input.bone_weights[1];
    let w2 = input.bone_weights[2];
    let w3 = input.bone_weights[3];

    var m = mat4x4<f32>(vec4<f32>(0.0), vec4<f32>(0.0), vec4<f32>(0.0), vec4<f32>(0.0));
    var weight_sum = 0.0;
    if (bone0 >= 0) { m += bone_matrices[bone0] * w0; weight_sum += w0; }
    if (bone1 >= 0) { m += bone_matrices[bone1] * w1; weight_sum += w1; }
    if (bone2 >= 0) { m += bone_matrices[bone2] * w2; weight_sum += w2; }
    if (bone3 >= 0) { m += bone_matrices[bone3] * w3; weight_sum += w3; }

    if (weight_sum > 0.0001) {
      final_pos = (m * vec4<f32>(morphed_pos, 1.0)).xyz / weight_sum;
      final_norm = (m * vec4<f32>(morphed_normal, 0.0)).xyz;
    }
  }
  else if (deform_type == 3) { // SDEF
    let bone0 = input.bone_indices[0];
    let bone1 = input.bone_indices[1];
    let w0 = input.bone_weights[0];
    let w1 = input.bone_weights[1];

    if (bone0 >= 0 && bone1 >= 0) {
      let m0 = bone_matrices[bone0];
      let m1 = bone_matrices[bone1];

      let q0 = quat_from_mat4(m0);
      let q1 = quat_from_mat4(m1);
      let q = quat_slerp(q0, q1, w1);
      let rot_mat = mat4_from_quat(q);

      // Compute radius centers
      let center = input.sdef_c;
      let r0_world = m0 * vec4<f32>(center - input.sdef_r0, 1.0);
      let r1_world = m1 * vec4<f32>(center - input.sdef_r1, 1.0);
      let c_world = r0_world.xyz * w0 + r1_world.xyz * w1;

      final_pos = (rot_mat * vec4<f32>(morphed_pos - center, 1.0)).xyz + c_world;
      final_norm = (rot_mat * vec4<f32>(morphed_normal, 0.0)).xyz;
    } else {
      var m = mat4x4<f32>(vec4<f32>(0.0), vec4<f32>(0.0), vec4<f32>(0.0), vec4<f32>(0.0));
      var weight_sum = 0.0;
      if (bone0 >= 0) { m += bone_matrices[bone0] * w0; weight_sum += w0; }
      if (bone1 >= 0) { m += bone_matrices[bone1] * w1; weight_sum += w1; }
      if (weight_sum > 0.0001) {
        final_pos = (m * vec4<f32>(morphed_pos, 1.0)).xyz / weight_sum;
        final_norm = (m * vec4<f32>(morphed_normal, 0.0)).xyz;
      }
    }
  }
  else if (deform_type == 4) { // QDEF (Dual Quaternion skinning)
    let bone0 = input.bone_indices[0];
    let bone1 = input.bone_indices[1];
    let bone2 = input.bone_indices[2];
    let bone3 = input.bone_indices[3];
    let w0 = input.bone_weights[0];
    let w1 = input.bone_weights[1];
    let w2 = input.bone_weights[2];
    let w3 = input.bone_weights[3];

    var m = mat4x4<f32>(vec4<f32>(0.0), vec4<f32>(0.0), vec4<f32>(0.0), vec4<f32>(0.0));
    var weight_sum = 0.0;
    if (bone0 >= 0) { m += bone_matrices[bone0] * w0; weight_sum += w0; }
    if (bone1 >= 0) { m += bone_matrices[bone1] * w1; weight_sum += w1; }
    if (bone2 >= 0) { m += bone_matrices[bone2] * w2; weight_sum += w2; }
    if (bone3 >= 0) { m += bone_matrices[bone3] * w3; weight_sum += w3; }

    if (weight_sum > 0.0001) {
      final_pos = (m * vec4<f32>(morphed_pos, 1.0)).xyz / weight_sum;
      final_norm = (m * vec4<f32>(morphed_normal, 0.0)).xyz;
    }
  }

  output_vertices[idx].pos = final_pos;
  
  let norm_len = length(final_norm);
  var norm = vec3<f32>(0.0, 1.0, 0.0);
  if (norm_len > 0.0001) {
    norm = final_norm / norm_len;
  }
  output_vertices[idx].normal_x = norm.x;
  output_vertices[idx].normal_y = norm.y;
  output_vertices[idx].normal_z = norm.z;
  output_vertices[idx].u = morphed_uv.x;
  output_vertices[idx].v = morphed_uv.y;
}
