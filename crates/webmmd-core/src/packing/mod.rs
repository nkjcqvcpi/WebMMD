// SPDX-License-Identifier: AGPL-3.0-or-later

use crate::pmx::types::*;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmModelBounds {
    pub min: [f32; 3],
    pub max: [f32; 3],
    pub center: [f32; 3],
    pub bounding_sphere_radius: f32,
    pub height: f32,
    pub recommended_camera_target: [f32; 3],
    pub recommended_camera_distance: f32,
    pub near_plane: f32,
    pub far_plane: f32,
}

pub struct PackedModel {
    pub vertices_bin: Vec<u8>,
    pub indices_bin: Vec<u8>,
    pub materials_bin: Vec<u8>,
    pub vertex_morph_offsets_bin: Vec<u8>,
    pub uv_morph_offsets_bin: Vec<u8>,
    pub additional_uvs_bin: Vec<u8>,
    pub vertex_morph_meta: Vec<PackedMorphMeta>,
    pub uv_morph_meta: Vec<PackedMorphMeta>,
    pub bounds: WasmModelBounds,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackedMorphMeta {
    pub morph_index: usize,
    pub name_local: String,
    pub name_universal: String,
    pub offset_start: u32,
    pub offset_count: u32,
}

pub fn pack_model(model: &PmxModel) -> PackedModel {
    // 1. Pack Vertices (144 bytes per vertex)
    let mut vertices_bin = Vec::with_capacity(model.vertices.len() * 144);
    for v in &model.vertices {
        // Position: vec3<f32> (12 bytes) + 4 bytes padding
        vertices_bin.extend_from_slice(&v.position.x.to_le_bytes());
        vertices_bin.extend_from_slice(&v.position.y.to_le_bytes());
        vertices_bin.extend_from_slice(&v.position.z.to_le_bytes());
        vertices_bin.extend_from_slice(&0.0f32.to_le_bytes()); // padding

        // Normal: vec3<f32> (12 bytes) + 4 bytes padding
        vertices_bin.extend_from_slice(&v.normal.x.to_le_bytes());
        vertices_bin.extend_from_slice(&v.normal.y.to_le_bytes());
        vertices_bin.extend_from_slice(&v.normal.z.to_le_bytes());
        vertices_bin.extend_from_slice(&0.0f32.to_le_bytes()); // padding

        // UV: vec2<f32> (8 bytes) + 8 bytes padding
        vertices_bin.extend_from_slice(&v.uv.x.to_le_bytes());
        vertices_bin.extend_from_slice(&v.uv.y.to_le_bytes());
        vertices_bin.extend_from_slice(&0.0f32.to_le_bytes()); // padding
        vertices_bin.extend_from_slice(&0.0f32.to_le_bytes()); // padding

        // Deform type and values
        let mut b_indices = [-1, -1, -1, -1];
        let mut b_weights = [0.0f32; 4];
        let deform_type: i32;
        let mut sdef_c = [0.0f32; 3];
        let mut sdef_r0 = [0.0f32; 3];
        let mut sdef_r1 = [0.0f32; 3];

        match &v.deform {
            DeformType::Bdef1 { bone } => {
                deform_type = 0;
                b_indices[0] = *bone;
                b_weights[0] = 1.0;
            }
            DeformType::Bdef2 {
                bone1,
                bone2,
                weight1,
            } => {
                deform_type = 1;
                b_indices[0] = *bone1;
                b_indices[1] = *bone2;
                b_weights[0] = *weight1;
                b_weights[1] = 1.0 - weight1;
            }
            DeformType::Bdef4 {
                bone1,
                bone2,
                bone3,
                bone4,
                weight1,
                weight2,
                weight3,
                weight4,
            } => {
                deform_type = 2;
                b_indices[0] = *bone1;
                b_indices[1] = *bone2;
                b_indices[2] = *bone3;
                b_indices[3] = *bone4;
                b_weights[0] = *weight1;
                b_weights[1] = *weight2;
                b_weights[2] = *weight3;
                b_weights[3] = *weight4;
            }
            DeformType::Sdef {
                bone1,
                bone2,
                weight1,
                c,
                r0,
                r1,
            } => {
                deform_type = 3;
                b_indices[0] = *bone1;
                b_indices[1] = *bone2;
                b_weights[0] = *weight1;
                b_weights[1] = 1.0 - weight1;
                sdef_c = [c.x, c.y, c.z];
                sdef_r0 = [r0.x, r0.y, r0.z];
                sdef_r1 = [r1.x, r1.y, r1.z];
            }
            DeformType::Qdef {
                bone1,
                bone2,
                bone3,
                bone4,
                weight1,
                weight2,
                weight3,
                weight4,
            } => {
                deform_type = 4;
                b_indices[0] = *bone1;
                b_indices[1] = *bone2;
                b_indices[2] = *bone3;
                b_indices[3] = *bone4;
                b_weights[0] = *weight1;
                b_weights[1] = *weight2;
                b_weights[2] = *weight3;
                b_weights[3] = *weight4;
            }
        }

        // bone_indices: vec4<i32> (16 bytes)
        for idx in b_indices {
            vertices_bin.extend_from_slice(&idx.to_le_bytes());
        }

        // bone_weights: vec4<f32> (16 bytes)
        for w in b_weights {
            vertices_bin.extend_from_slice(&w.to_le_bytes());
        }

        // deform_type: i32 (4 bytes)
        vertices_bin.extend_from_slice(&deform_type.to_le_bytes());

        // edge_scale: f32 (4 bytes)
        vertices_bin.extend_from_slice(&v.edge_scale.to_le_bytes());

        // padding to align to 16-byte (8 bytes)
        vertices_bin.extend_from_slice(&0.0f32.to_le_bytes());
        vertices_bin.extend_from_slice(&0.0f32.to_le_bytes());

        // sdef_c: vec3<f32> (12 bytes) + 4 bytes padding
        for val in sdef_c {
            vertices_bin.extend_from_slice(&val.to_le_bytes());
        }
        vertices_bin.extend_from_slice(&0.0f32.to_le_bytes());

        // sdef_r0: vec3<f32> (12 bytes) + 4 bytes padding
        for val in sdef_r0 {
            vertices_bin.extend_from_slice(&val.to_le_bytes());
        }
        vertices_bin.extend_from_slice(&0.0f32.to_le_bytes());

        // sdef_r1: vec3<f32> (12 bytes) + 4 bytes padding
        for val in sdef_r1 {
            vertices_bin.extend_from_slice(&val.to_le_bytes());
        }
        vertices_bin.extend_from_slice(&0.0f32.to_le_bytes());
    }

    // 2. Pack Indices (u32 array)
    let mut indices_bin = Vec::with_capacity(model.indices.len() * 4);
    for &idx in &model.indices {
        indices_bin.extend_from_slice(&(idx as u32).to_le_bytes());
    }

    // 3. Pack Materials (112 bytes per material)
    let mut materials_bin = Vec::with_capacity(model.materials.len() * 112);
    for m in &model.materials {
        // diffuse: vec4<f32> (16 bytes)
        materials_bin.extend_from_slice(&m.diffuse.x.to_le_bytes());
        materials_bin.extend_from_slice(&m.diffuse.y.to_le_bytes());
        materials_bin.extend_from_slice(&m.diffuse.z.to_le_bytes());
        materials_bin.extend_from_slice(&m.diffuse.w.to_le_bytes());

        // ambient + shininess: vec4<f32> (16 bytes)
        materials_bin.extend_from_slice(&m.ambient.x.to_le_bytes());
        materials_bin.extend_from_slice(&m.ambient.y.to_le_bytes());
        materials_bin.extend_from_slice(&m.ambient.z.to_le_bytes());
        materials_bin.extend_from_slice(&m.shininess.to_le_bytes());

        // specular: vec4<f32> (16 bytes)
        materials_bin.extend_from_slice(&m.specular.x.to_le_bytes());
        materials_bin.extend_from_slice(&m.specular.y.to_le_bytes());
        materials_bin.extend_from_slice(&m.specular.z.to_le_bytes());
        materials_bin.extend_from_slice(&0.0f32.to_le_bytes()); // padding

        // edge_color: vec4<f32> (16 bytes)
        materials_bin.extend_from_slice(&m.edge_color.x.to_le_bytes());
        materials_bin.extend_from_slice(&m.edge_color.y.to_le_bytes());
        materials_bin.extend_from_slice(&m.edge_color.z.to_le_bytes());
        materials_bin.extend_from_slice(&m.edge_color.w.to_le_bytes());

        // edge_parameters: vec4<f32> (16 bytes) -> edge_size + padding
        materials_bin.extend_from_slice(&m.edge_size.to_le_bytes());
        materials_bin.extend_from_slice(&0.0f32.to_le_bytes());
        materials_bin.extend_from_slice(&0.0f32.to_le_bytes());
        materials_bin.extend_from_slice(&0.0f32.to_le_bytes());

        // texture_indices: vec4<i32> (16 bytes) -> texture_index, sphere_texture_index, toon_texture_index, padding
        materials_bin.extend_from_slice(&m.texture_index.to_le_bytes());
        materials_bin.extend_from_slice(&m.sphere_texture_index.to_le_bytes());
        materials_bin.extend_from_slice(&m.toon_texture_index.to_le_bytes());
        materials_bin.extend_from_slice(&0i32.to_le_bytes());

        // material_flags: vec4<u32> (16 bytes) -> flags, sphere_mode, toon_mode, padding
        materials_bin.extend_from_slice(&(m.flags as u32).to_le_bytes());
        materials_bin.extend_from_slice(&(m.sphere_mode as u32).to_le_bytes());
        materials_bin.extend_from_slice(&(m.toon_mode as u32).to_le_bytes());
        materials_bin.extend_from_slice(&0u32.to_le_bytes());
    }
    assert_eq!(materials_bin.len(), model.materials.len() * 112);

    // 4. Pack Sparse Morphs
    let mut vertex_morph_offsets_bin = Vec::new();
    let mut uv_morph_offsets_bin = Vec::new();
    let mut vertex_morph_meta = Vec::new();
    let mut uv_morph_meta = Vec::new();

    for (i, morph) in model.morphs.iter().enumerate() {
        match &morph.offsets {
            MorphOffsets::Vertex(offsets) => {
                let start = (vertex_morph_offsets_bin.len() / 32) as u32; // struct size: 32 bytes
                for off in offsets {
                    // VertexMorphOffset in WGSL:
                    // struct VertexMorphOffset {
                    //     vertex_idx: u32,
                    //     padding: u32,
                    //     offset: vec3<f32>,
                    // }
                    // Size: 32 bytes (alignment 16)
                    vertex_morph_offsets_bin
                        .extend_from_slice(&(off.vertex_index as u32).to_le_bytes());
                    vertex_morph_offsets_bin.extend_from_slice(&0u32.to_le_bytes()); // padding
                    vertex_morph_offsets_bin.extend_from_slice(&0u32.to_le_bytes()); // padding
                    vertex_morph_offsets_bin.extend_from_slice(&0u32.to_le_bytes()); // padding

                    vertex_morph_offsets_bin.extend_from_slice(&off.offset.x.to_le_bytes());
                    vertex_morph_offsets_bin.extend_from_slice(&off.offset.y.to_le_bytes());
                    vertex_morph_offsets_bin.extend_from_slice(&off.offset.z.to_le_bytes());
                    vertex_morph_offsets_bin.extend_from_slice(&0.0f32.to_le_bytes());
                    // padding to 16
                }
                let count = offsets.len() as u32;
                vertex_morph_meta.push(PackedMorphMeta {
                    morph_index: i,
                    name_local: morph.name_local.clone(),
                    name_universal: morph.name_universal.clone(),
                    offset_start: start,
                    offset_count: count,
                });
            }
            MorphOffsets::Uv(offsets) => {
                let start = (uv_morph_offsets_bin.len() / 32) as u32; // struct size: 32 bytes
                for off in offsets {
                    // UvMorphOffset in WGSL:
                    // struct UvMorphOffset {
                    //     vertex_idx: u32,
                    //     padding: u32,
                    //     padding2: u32,
                    //     padding3: u32,
                    //     offset: vec4<f32>,
                    // }
                    // Size: 32 bytes (alignment 16)
                    uv_morph_offsets_bin
                        .extend_from_slice(&(off.vertex_index as u32).to_le_bytes());
                    uv_morph_offsets_bin.extend_from_slice(&0u32.to_le_bytes()); // padding
                    uv_morph_offsets_bin.extend_from_slice(&0u32.to_le_bytes()); // padding
                    uv_morph_offsets_bin.extend_from_slice(&0u32.to_le_bytes()); // padding

                    uv_morph_offsets_bin.extend_from_slice(&off.offset.x.to_le_bytes());
                    uv_morph_offsets_bin.extend_from_slice(&off.offset.y.to_le_bytes());
                    uv_morph_offsets_bin.extend_from_slice(&off.offset.z.to_le_bytes());
                    uv_morph_offsets_bin.extend_from_slice(&off.offset.w.to_le_bytes());
                }
                let count = offsets.len() as u32;
                uv_morph_meta.push(PackedMorphMeta {
                    morph_index: i,
                    name_local: morph.name_local.clone(),
                    name_universal: morph.name_universal.clone(),
                    offset_start: start,
                    offset_count: count,
                });
            }
            _ => {}
        }
    }

    let mut additional_uvs_bin = Vec::new();
    for v in &model.vertices {
        for uv in &v.additional_uvs {
            additional_uvs_bin.extend_from_slice(&uv.x.to_le_bytes());
            additional_uvs_bin.extend_from_slice(&uv.y.to_le_bytes());
            additional_uvs_bin.extend_from_slice(&uv.z.to_le_bytes());
            additional_uvs_bin.extend_from_slice(&uv.w.to_le_bytes());
        }
    }

    let mut min_x = f32::MAX;
    let mut min_y = f32::MAX;
    let mut min_z = f32::MAX;
    let mut max_x = f32::MIN;
    let mut max_y = f32::MIN;
    let mut max_z = f32::MIN;

    for v in &model.vertices {
        if v.position.x < min_x {
            min_x = v.position.x;
        }
        if v.position.y < min_y {
            min_y = v.position.y;
        }
        if v.position.z < min_z {
            min_z = v.position.z;
        }
        if v.position.x > max_x {
            max_x = v.position.x;
        }
        if v.position.y > max_y {
            max_y = v.position.y;
        }
        if v.position.z > max_z {
            max_z = v.position.z;
        }
    }

    if model.vertices.is_empty() {
        min_x = 0.0;
        min_y = 0.0;
        min_z = 0.0;
        max_x = 0.0;
        max_y = 0.0;
        max_z = 0.0;
    }

    let center = [
        (min_x + max_x) * 0.5,
        (min_y + max_y) * 0.5,
        (min_z + max_z) * 0.5,
    ];

    let height = max_y - min_y;

    let mut max_dist_sq = 0.0f32;
    for v in &model.vertices {
        let dx = v.position.x - center[0];
        let dy = v.position.y - center[1];
        let dz = v.position.z - center[2];
        let dist_sq = dx * dx + dy * dy + dz * dz;
        if dist_sq > max_dist_sq {
            max_dist_sq = dist_sq;
        }
    }
    let bounding_sphere_radius = max_dist_sq.sqrt();

    let recommended_camera_target = [center[0], (min_y + max_y) * 0.5, center[2]];

    let recommended_camera_distance = (bounding_sphere_radius * 2.2).clamp(10.0, 100.0);
    let near_plane = (recommended_camera_distance * 0.05).max(0.1);
    let far_plane = (recommended_camera_distance * 10.0).max(500.0);

    let bounds = WasmModelBounds {
        min: [min_x, min_y, min_z],
        max: [max_x, max_y, max_z],
        center,
        bounding_sphere_radius,
        height,
        recommended_camera_target,
        recommended_camera_distance,
        near_plane,
        far_plane,
    };

    PackedModel {
        vertices_bin,
        indices_bin,
        materials_bin,
        vertex_morph_offsets_bin,
        uv_morph_offsets_bin,
        additional_uvs_bin,
        vertex_morph_meta,
        uv_morph_meta,
        bounds,
    }
}
