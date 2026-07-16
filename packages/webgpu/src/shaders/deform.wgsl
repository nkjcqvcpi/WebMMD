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

struct RenderVertex {
  pos: vec3<f32>,
  normal_x: f32,
  normal_y: f32,
  normal_z: f32,
  u: f32,
  v: f32,
};

struct VertexMorphContribution {
  morph_index: f32,
  offset_x: f32,
  offset_y: f32,
  offset_z: f32,
};

struct UvMorphContribution {
  morph_index: f32,
  offset_u: f32,
  offset_v: f32,
  padding: f32,
};

struct SkinningParams {
  vertex_count: u32,
  padding1: u32,
  padding2: u32,
  padding3: u32,
};

@group(0) @binding(0) var<storage, read> inputs: array<SkinningInput>;
@group(0) @binding(1) var<storage, read_write> output_vertices: array<RenderVertex>;
@group(0) @binding(2) var<storage, read> bone_matrices: array<mat4x4<f32>>;
@group(0) @binding(3) var<storage, read> vertex_morph_adjacency: array<vec2<u32>>;
@group(0) @binding(4) var<storage, read> vertex_morph_contributions: array<VertexMorphContribution>;
@group(0) @binding(5) var<storage, read> uv_morph_adjacency: array<vec2<u32>>;
@group(0) @binding(6) var<storage, read> uv_morph_contributions: array<UvMorphContribution>;
@group(0) @binding(7) var<storage, read> active_morph_weights: array<f32>;
@group(0) @binding(8) var<uniform> skinning_params: SkinningParams;

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

fn rotate_vec3(q: vec4<f32>, v: vec3<f32>) -> vec3<f32> {
  let q_vec = q.xyz;
  let uv = cross(q_vec, v);
  let uuv = cross(q_vec, uv);
  return v + uv * (2.0 * q.w) + uuv * 2.0;
}

struct DualQuat {
  real: vec4<f32>,
  dual: vec4<f32>,
};

fn dq_from_mat4(m: mat4x4<f32>) -> DualQuat {
  let qr = quat_from_mat4(m);
  let t = m[3].xyz; // translation column
  let real = qr;
  let dual = 0.5 * vec4<f32>(
     t.x * real.w + t.y * real.z - t.z * real.y,
     t.y * real.w - t.x * real.z + t.z * real.x,
     t.z * real.w + real.y * t.x - real.x * t.y,
    -t.x * real.x - t.y * real.y - t.z * real.z
  );
  return DualQuat(real, dual);
}

fn dq_to_translation(dq: DualQuat) -> vec3<f32> {
  let r = dq.real;
  let d = dq.dual;
  return 2.0 * vec3<f32>(
    d.w * -r.x + d.x * r.w + d.y * -r.z - d.z * -r.y,
    d.w * -r.y - d.x * -r.z + d.y * r.w + d.z * -r.x,
    d.w * -r.z + d.x * -r.y - d.y * -r.x + d.z * r.w
  );
}

fn dq_transform_point(dq: DualQuat, p: vec3<f32>) -> vec3<f32> {
  let rotated = rotate_vec3(dq.real, p);
  let t = dq_to_translation(dq);
  return rotated + t;
}

fn dq_transform_direction(dq: DualQuat, n: vec3<f32>) -> vec3<f32> {
  return rotate_vec3(dq.real, n);
}

fn blend_dqs(dq0: DualQuat, dq1: DualQuat, dq2: DualQuat, dq3: DualQuat, weights: vec4<f32>) -> DualQuat {
  var w = weights;
  if (dot(dq0.real, dq1.real) < 0.0) { w.y = -w.y; }
  if (dot(dq0.real, dq2.real) < 0.0) { w.z = -w.z; }
  if (dot(dq0.real, dq3.real) < 0.0) { w.w = -w.w; }
  
  var real = dq0.real * w.x + dq1.real * w.y + dq2.real * w.z + dq3.real * w.w;
  var dual = dq0.dual * w.x + dq1.dual * w.y + dq2.dual * w.z + dq3.dual * w.w;
  
  let len = length(real);
  if (len > 0.0001) {
    real = real / len;
    dual = dual / len;
  }
  return DualQuat(real, dual);
}

@compute @workgroup_size(64)
fn deform_vertices(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let idx = global_id.x;
  if (idx >= skinning_params.vertex_count) {
    return;
  }

  let input = inputs[idx];
  
  // 1. Accumulate Vertex Morphs
  var morphed_pos = input.position;
  let v_morph_adj = vertex_morph_adjacency[idx];
  let v_morph_start = v_morph_adj.x;
  let v_morph_count = v_morph_adj.y;
  for (var i = 0u; i < v_morph_count; i = i + 1u) {
    let contrib = vertex_morph_contributions[v_morph_start + i];
    let morph_idx = u32(contrib.morph_index);
    let weight = active_morph_weights[morph_idx];
    morphed_pos += vec3<f32>(contrib.offset_x, contrib.offset_y, contrib.offset_z) * weight;
  }

  // 2. Accumulate UV Morphs
  var morphed_uv = input.uv;
  let uv_morph_adj = uv_morph_adjacency[idx];
  let uv_morph_start = uv_morph_adj.x;
  let uv_morph_count = uv_morph_adj.y;
  for (var i = 0u; i < uv_morph_count; i = i + 1u) {
    let contrib = uv_morph_contributions[uv_morph_start + i];
    let morph_idx = u32(contrib.morph_index);
    let weight = active_morph_weights[morph_idx];
    morphed_uv += vec2<f32>(contrib.offset_u, contrib.offset_v) * weight;
  }

  var final_pos = morphed_pos;
  var final_norm = input.normal;

  let deform_type = input.deform_type;

  if (deform_type == 0) { // BDEF1
    let bone_idx = input.bone_indices[0];
    if (bone_idx >= 0) {
      let m = bone_matrices[bone_idx];
      final_pos = (m * vec4<f32>(morphed_pos, 1.0)).xyz;
      final_norm = (m * vec4<f32>(input.normal, 0.0)).xyz;
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
      final_norm = (m * vec4<f32>(input.normal, 0.0)).xyz;
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
      final_norm = (m * vec4<f32>(input.normal, 0.0)).xyz;
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

      // Compute radius centers matching Saba pre-calculated SDEF behavior
      let center = input.sdef_c;
      let r0 = input.sdef_r0;
      let r1 = input.sdef_r1;

      let rw = r0 * w0 + r1 * w1;
      let r0_mod = center + r0 - rw;
      let r1_mod = center + r1 - rw;
      let cr0 = (center + r0_mod) * 0.5;
      let cr1 = (center + r1_mod) * 0.5;

      let cr0_world = m0 * vec4<f32>(cr0, 1.0);
      let cr1_world = m1 * vec4<f32>(cr1, 1.0);
      let c_world = cr0_world.xyz * w0 + cr1_world.xyz * w1;

      final_pos = (rot_mat * vec4<f32>(morphed_pos - center, 1.0)).xyz + c_world;
      final_norm = (rot_mat * vec4<f32>(input.normal, 0.0)).xyz;
    } else {
      var m = mat4x4<f32>(vec4<f32>(0.0), vec4<f32>(0.0), vec4<f32>(0.0), vec4<f32>(0.0));
      var weight_sum = 0.0;
      if (bone0 >= 0) { m += bone_matrices[bone0] * w0; weight_sum += w0; }
      if (bone1 >= 0) { m += bone_matrices[bone1] * w1; weight_sum += w1; }
      if (weight_sum > 0.0001) {
        final_pos = (m * vec4<f32>(morphed_pos, 1.0)).xyz / weight_sum;
        final_norm = (m * vec4<f32>(input.normal, 0.0)).xyz;
      }
    }
  }
  else if (deform_type == 4) { // QDEF (Real Dual Quaternion skinning)
    let bone0 = input.bone_indices[0];
    let bone1 = input.bone_indices[1];
    let bone2 = input.bone_indices[2];
    let bone3 = input.bone_indices[3];
    let w0 = input.bone_weights[0];
    let w1 = input.bone_weights[1];
    let w2 = input.bone_weights[2];
    let w3 = input.bone_weights[3];

    var dq0 = DualQuat(vec4<f32>(0.0, 0.0, 0.0, 1.0), vec4<f32>(0.0));
    var dq1 = DualQuat(vec4<f32>(0.0, 0.0, 0.0, 1.0), vec4<f32>(0.0));
    var dq2 = DualQuat(vec4<f32>(0.0, 0.0, 0.0, 1.0), vec4<f32>(0.0));
    var dq3 = DualQuat(vec4<f32>(0.0, 0.0, 0.0, 1.0), vec4<f32>(0.0));

    if (bone0 >= 0) { dq0 = dq_from_mat4(bone_matrices[bone0]); }
    if (bone1 >= 0) { dq1 = dq_from_mat4(bone_matrices[bone1]); }
    if (bone2 >= 0) { dq2 = dq_from_mat4(bone_matrices[bone2]); }
    if (bone3 >= 0) { dq3 = dq_from_mat4(bone_matrices[bone3]); }

    let blended_dq = blend_dqs(dq0, dq1, dq2, dq3, vec4<f32>(w0, w1, w2, w3));
    final_pos = dq_transform_point(blended_dq, morphed_pos);
    final_norm = dq_transform_direction(blended_dq, input.normal);
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
