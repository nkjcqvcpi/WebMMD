// SPDX-License-Identifier: AGPL-3.0-or-later

use wasm_bindgen::prelude::*;
use webmmd_core::packing::pack_model;
use webmmd_core::pmx::parse_pmx;
use webmmd_core::validation::validate_pmx;

#[wasm_bindgen]
pub struct WasmPackedModel {
    vertices: Vec<u8>,
    indices: Vec<u8>,
    materials: Vec<u8>,
    vertex_morph_offsets: Vec<u8>,
    uv_morph_offsets: Vec<u8>,
    additional_uvs: Vec<u8>,
    metadata_json: String,
}

#[wasm_bindgen]
impl WasmPackedModel {
    #[wasm_bindgen(getter)]
    pub fn vertices(&self) -> js_sys::Uint8Array {
        js_sys::Uint8Array::from(&self.vertices[..])
    }

    #[wasm_bindgen(getter)]
    pub fn indices(&self) -> js_sys::Uint8Array {
        js_sys::Uint8Array::from(&self.indices[..])
    }

    #[wasm_bindgen(getter)]
    pub fn materials(&self) -> js_sys::Uint8Array {
        js_sys::Uint8Array::from(&self.materials[..])
    }

    #[wasm_bindgen(getter)]
    pub fn vertex_morph_offsets(&self) -> js_sys::Uint8Array {
        js_sys::Uint8Array::from(&self.vertex_morph_offsets[..])
    }

    #[wasm_bindgen(getter)]
    pub fn uv_morph_offsets(&self) -> js_sys::Uint8Array {
        js_sys::Uint8Array::from(&self.uv_morph_offsets[..])
    }

    #[wasm_bindgen(getter)]
    pub fn additional_uvs(&self) -> js_sys::Uint8Array {
        js_sys::Uint8Array::from(&self.additional_uvs[..])
    }

    #[wasm_bindgen(getter)]
    pub fn metadata_json(&self) -> String {
        self.metadata_json.clone()
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WasmModelMetadata {
    version: f32,
    name_local: String,
    name_universal: String,
    comments_local: String,
    comments_universal: String,
    textures: Vec<String>,
    materials: Vec<WasmMaterialMeta>,
    bones: Vec<WasmBoneMeta>,
    morphs: Vec<WasmMorphMeta>,
    rigid_bodies: Vec<WasmRigidBodyMeta>,
    joints: Vec<WasmJointMeta>,
    soft_bodies: Vec<WasmSoftBodyMeta>,
    diagnostics: Vec<webmmd_core::validation::Diagnostic>,
    vertex_morph_meta: Vec<webmmd_core::packing::PackedMorphMeta>,
    uv_morph_meta: Vec<webmmd_core::packing::PackedMorphMeta>,
    additional_uv_count: usize,
    bounds: webmmd_core::packing::WasmModelBounds,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WasmMaterialMeta {
    name_local: String,
    name_universal: String,
    surface_count: i32,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WasmBoneMeta {
    name_local: String,
    name_universal: String,
    parent_index: i32,
    transform_layer: i32,
    flags: u16,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WasmMorphMeta {
    name_local: String,
    name_universal: String,
    panel: u8,
    morph_type: u8,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WasmRigidBodyMeta {
    name_local: String,
    name_universal: String,
    bone_index: i32,
    group: u8,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WasmJointMeta {
    name_local: String,
    name_universal: String,
    joint_type: u8,
    body_a_index: i32,
    body_b_index: i32,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WasmSoftBodyMeta {
    name_local: String,
    name_universal: String,
    material_index: i32,
}

#[wasm_bindgen]
pub fn parse_and_pack_pmx(data: &[u8]) -> Result<WasmPackedModel, JsValue> {
    let model =
        parse_pmx(data).map_err(|e| JsValue::from_str(&format!("PMX parse error: {}", e)))?;

    // Validate model
    let diagnostics = validate_pmx(&model);
    if diagnostics.iter().any(|d| d.severity == "error") {
        let first_error = diagnostics.iter().find(|d| d.severity == "error").unwrap();
        return Err(JsValue::from_str(&format!(
            "Fatal validation error ({} in {}): {}",
            first_error.code, first_error.section, first_error.message
        )));
    }

    let packed = pack_model(&model);

    // Collect metadata
    let materials_meta = model
        .materials
        .iter()
        .map(|m| WasmMaterialMeta {
            name_local: m.name_local.clone(),
            name_universal: m.name_universal.clone(),
            surface_count: m.surface_count,
        })
        .collect();

    let bones_meta = model
        .bones
        .iter()
        .map(|b| WasmBoneMeta {
            name_local: b.name_local.clone(),
            name_universal: b.name_universal.clone(),
            parent_index: b.parent_index,
            transform_layer: b.transform_layer,
            flags: b.flags,
        })
        .collect();

    let morphs_meta = model
        .morphs
        .iter()
        .map(|m| WasmMorphMeta {
            name_local: m.name_local.clone(),
            name_universal: m.name_universal.clone(),
            panel: m.panel,
            morph_type: m.morph_type,
        })
        .collect();

    let rigid_bodies_meta = model
        .rigid_bodies
        .iter()
        .map(|rb| WasmRigidBodyMeta {
            name_local: rb.name_local.clone(),
            name_universal: rb.name_universal.clone(),
            bone_index: rb.bone_index,
            group: rb.group,
        })
        .collect();

    let joints_meta = model
        .joints
        .iter()
        .map(|j| WasmJointMeta {
            name_local: j.name_local.clone(),
            name_universal: j.name_universal.clone(),
            joint_type: j.joint_type,
            body_a_index: j.body_a_index,
            body_b_index: j.body_b_index,
        })
        .collect();

    let soft_bodies_meta = model
        .soft_bodies
        .iter()
        .map(|sb| WasmSoftBodyMeta {
            name_local: sb.name_local.clone(),
            name_universal: sb.name_universal.clone(),
            material_index: sb.material_index,
        })
        .collect();

    let additional_uv_count = model
        .vertices
        .first()
        .map(|v| v.additional_uvs.len())
        .unwrap_or(0);

    let meta = WasmModelMetadata {
        version: model.version,
        name_local: model.name_local,
        name_universal: model.name_universal,
        comments_local: model.comments_local,
        comments_universal: model.comments_universal,
        textures: model.textures,
        materials: materials_meta,
        bones: bones_meta,
        morphs: morphs_meta,
        rigid_bodies: rigid_bodies_meta,
        joints: joints_meta,
        soft_bodies: soft_bodies_meta,
        diagnostics,
        vertex_morph_meta: packed.vertex_morph_meta,
        uv_morph_meta: packed.uv_morph_meta,
        additional_uv_count,
        bounds: packed.bounds,
    };

    let metadata_json = serde_json::to_string(&meta)
        .map_err(|e| JsValue::from_str(&format!("Serde serialize error: {}", e)))?;

    Ok(WasmPackedModel {
        vertices: packed.vertices_bin,
        indices: packed.indices_bin,
        materials: packed.materials_bin,
        vertex_morph_offsets: packed.vertex_morph_offsets_bin,
        uv_morph_offsets: packed.uv_morph_offsets_bin,
        additional_uvs: packed.additional_uvs_bin,
        metadata_json,
    })
}
