// SPDX-License-Identifier: GPL-3.0-or-later

use crate::pmx::types::*;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub severity: String, // "error" | "warning"
    pub code: String,
    pub section: String,
    pub item_index: Option<usize>,
    pub message: String,
}

pub fn validate_pmx(model: &PmxModel) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();

    let num_vertices = model.vertices.len();
    let num_textures = model.textures.len();
    let num_materials = model.materials.len();
    let num_bones = model.bones.len();
    let num_morphs = model.morphs.len();
    let num_rigid_bodies = model.rigid_bodies.len();

    // 1. Textures: Path traversal check
    for (i, tex) in model.textures.iter().enumerate() {
        if tex.contains("..") || tex.starts_with('/') || tex.contains(':') {
            diagnostics.push(Diagnostic {
                severity: "error".to_string(),
                code: "PATH_TRAVERSAL_ATTEMPT".to_string(),
                section: "Texture".to_string(),
                item_index: Some(i),
                message: format!(
                    "Unsafe texture path '{}' rejected. Path traversal or absolute paths not allowed.",
                    tex
                ),
            });
        }
    }

    // 2. Vertices: Bone index verification
    for (i, v) in model.vertices.iter().enumerate() {
        let verify_bone = |b_idx: i32, diag: &mut Vec<Diagnostic>| {
            if b_idx >= 0 && (b_idx as usize) >= num_bones {
                diag.push(Diagnostic {
                    severity: "error".to_string(),
                    code: "OUT_OF_BOUNDS_BONE_REF".to_string(),
                    section: "Vertex".to_string(),
                    item_index: Some(i),
                    message: format!("Vertex refers to out-of-bounds bone index: {}", b_idx),
                });
            }
        };

        match &v.deform {
            DeformType::Bdef1 { bone } => verify_bone(*bone, &mut diagnostics),
            DeformType::Bdef2 { bone1, bone2, .. } => {
                verify_bone(*bone1, &mut diagnostics);
                verify_bone(*bone2, &mut diagnostics);
            }
            DeformType::Bdef4 {
                bone1,
                bone2,
                bone3,
                bone4,
                ..
            }
            | DeformType::Qdef {
                bone1,
                bone2,
                bone3,
                bone4,
                ..
            } => {
                verify_bone(*bone1, &mut diagnostics);
                verify_bone(*bone2, &mut diagnostics);
                verify_bone(*bone3, &mut diagnostics);
                verify_bone(*bone4, &mut diagnostics);
            }
            DeformType::Sdef { bone1, bone2, .. } => {
                verify_bone(*bone1, &mut diagnostics);
                verify_bone(*bone2, &mut diagnostics);
            }
        }
    }

    // 3. Materials: Texture references
    for (i, mat) in model.materials.iter().enumerate() {
        let verify_tex = |tex_idx: i32, label: &str, diag: &mut Vec<Diagnostic>| {
            if tex_idx >= 0 && (tex_idx as usize) >= num_textures {
                diag.push(Diagnostic {
                    severity: "error".to_string(),
                    code: "OUT_OF_BOUNDS_TEXTURE_REF".to_string(),
                    section: "Material".to_string(),
                    item_index: Some(i),
                    message: format!(
                        "Material '{}' refers to out-of-bounds {} texture index: {}",
                        mat.name_local, label, tex_idx
                    ),
                });
            }
        };

        verify_tex(mat.texture_index, "base", &mut diagnostics);
        verify_tex(mat.sphere_texture_index, "sphere", &mut diagnostics);
        if mat.toon_mode == 0 {
            verify_tex(mat.toon_texture_index, "toon", &mut diagnostics);
        }
    }

    // 4. Bones: Parent indices, inherit references, and cycles
    for (i, bone) in model.bones.iter().enumerate() {
        if bone.parent_index >= 0 {
            if (bone.parent_index as usize) >= num_bones {
                diagnostics.push(Diagnostic {
                    severity: "error".to_string(),
                    code: "OUT_OF_BOUNDS_PARENT_REF".to_string(),
                    section: "Bone".to_string(),
                    item_index: Some(i),
                    message: format!(
                        "Bone '{}' parent index is out of bounds: {}",
                        bone.name_local, bone.parent_index
                    ),
                });
            } else if bone.parent_index as usize == i {
                diagnostics.push(Diagnostic {
                    severity: "error".to_string(),
                    code: "SELF_PARENTING_CYCLE".to_string(),
                    section: "Bone".to_string(),
                    item_index: Some(i),
                    message: format!("Bone '{}' cannot parent to itself.", bone.name_local),
                });
            }
        }

        // Inherit rotations / translations references
        let verify_inherit =
            |inherit: &InheritTransform, label: &str, diag: &mut Vec<Diagnostic>| {
                if inherit.parent_index < 0 || (inherit.parent_index as usize) >= num_bones {
                    diag.push(Diagnostic {
                        severity: "error".to_string(),
                        code: "OUT_OF_BOUNDS_INHERIT_REF".to_string(),
                        section: "Bone".to_string(),
                        item_index: Some(i),
                        message: format!(
                            "Bone '{}' inherits {} from out-of-bounds bone index: {}",
                            bone.name_local, label, inherit.parent_index
                        ),
                    });
                }
            };

        if let Some(ref rotate) = bone.inherit_rotation {
            verify_inherit(rotate, "rotation", &mut diagnostics);
        }
        if let Some(ref translate) = bone.inherit_translation {
            verify_inherit(translate, "translation", &mut diagnostics);
        }

        // IK target and links references
        if let Some(ref ik) = bone.ik {
            if ik.target_index < 0 || (ik.target_index as usize) >= num_bones {
                diagnostics.push(Diagnostic {
                    severity: "error".to_string(),
                    code: "OUT_OF_BOUNDS_IK_TARGET_REF".to_string(),
                    section: "Bone".to_string(),
                    item_index: Some(i),
                    message: format!(
                        "Bone '{}' IK target index is out of bounds: {}",
                        bone.name_local, ik.target_index
                    ),
                });
            }

            for link in &ik.links {
                if link.bone_index < 0 || (link.bone_index as usize) >= num_bones {
                    diagnostics.push(Diagnostic {
                        severity: "error".to_string(),
                        code: "OUT_OF_BOUNDS_IK_LINK_REF".to_string(),
                        section: "Bone".to_string(),
                        item_index: Some(i),
                        message: format!(
                            "Bone '{}' IK link bone index is out of bounds: {}",
                            bone.name_local, link.bone_index
                        ),
                    });
                }
            }
        }
    }

    // Bone Parenting Cycle detection
    let mut visited = vec![0; num_bones]; // 0: unvisited, 1: visiting, 2: visited
    for i in 0..num_bones {
        if visited[i] == 0 {
            detect_bone_cycle(i, &model.bones, &mut visited, &mut diagnostics);
        }
    }

    // 5. Morphs: Group morph cycle checks and index verification
    for (i, morph) in model.morphs.iter().enumerate() {
        match &morph.offsets {
            MorphOffsets::Group(offsets) => {
                for offset in offsets {
                    if offset.morph_index < 0 || (offset.morph_index as usize) >= num_morphs {
                        diagnostics.push(Diagnostic {
                            severity: "error".to_string(),
                            code: "OUT_OF_BOUNDS_MORPH_REF".to_string(),
                            section: "Morph".to_string(),
                            item_index: Some(i),
                            message: format!(
                                "Group morph '{}' refers to out-of-bounds morph index: {}",
                                morph.name_local, offset.morph_index
                            ),
                        });
                    }
                }
            }
            MorphOffsets::Vertex(offsets) => {
                for offset in offsets {
                    if offset.vertex_index < 0 || (offset.vertex_index as usize) >= num_vertices {
                        diagnostics.push(Diagnostic {
                            severity: "error".to_string(),
                            code: "OUT_OF_BOUNDS_VERTEX_REF".to_string(),
                            section: "Morph".to_string(),
                            item_index: Some(i),
                            message: format!(
                                "Vertex morph '{}' refers to out-of-bounds vertex index: {}",
                                morph.name_local, offset.vertex_index
                            ),
                        });
                    }
                }
            }
            MorphOffsets::Bone(offsets) => {
                for offset in offsets {
                    if offset.bone_index < 0 || (offset.bone_index as usize) >= num_bones {
                        diagnostics.push(Diagnostic {
                            severity: "error".to_string(),
                            code: "OUT_OF_BOUNDS_BONE_REF".to_string(),
                            section: "Morph".to_string(),
                            item_index: Some(i),
                            message: format!(
                                "Bone morph '{}' refers to out-of-bounds bone index: {}",
                                morph.name_local, offset.bone_index
                            ),
                        });
                    }
                }
            }
            MorphOffsets::Uv(offsets) => {
                for offset in offsets {
                    if offset.vertex_index < 0 || (offset.vertex_index as usize) >= num_vertices {
                        diagnostics.push(Diagnostic {
                            severity: "error".to_string(),
                            code: "OUT_OF_BOUNDS_VERTEX_REF".to_string(),
                            section: "Morph".to_string(),
                            item_index: Some(i),
                            message: format!(
                                "UV morph '{}' refers to out-of-bounds vertex index: {}",
                                morph.name_local, offset.vertex_index
                            ),
                        });
                    }
                }
            }
            MorphOffsets::Material(offsets) => {
                for offset in offsets {
                    // material_index of -1 is acceptable (means all materials)
                    if offset.material_index >= 0
                        && (offset.material_index as usize) >= num_materials
                    {
                        diagnostics.push(Diagnostic {
                            severity: "error".to_string(),
                            code: "OUT_OF_BOUNDS_MATERIAL_REF".to_string(),
                            section: "Morph".to_string(),
                            item_index: Some(i),
                            message: format!(
                                "Material morph '{}' refers to out-of-bounds material index: {}",
                                morph.name_local, offset.material_index
                            ),
                        });
                    }
                }
            }
            MorphOffsets::Flip(offsets) => {
                for offset in offsets {
                    if offset.morph_index < 0 || (offset.morph_index as usize) >= num_morphs {
                        diagnostics.push(Diagnostic {
                            severity: "error".to_string(),
                            code: "OUT_OF_BOUNDS_MORPH_REF".to_string(),
                            section: "Morph".to_string(),
                            item_index: Some(i),
                            message: format!(
                                "Flip morph '{}' refers to out-of-bounds morph index: {}",
                                morph.name_local, offset.morph_index
                            ),
                        });
                    }
                }
            }
            MorphOffsets::Impulse(offsets) => {
                for offset in offsets {
                    if offset.rigid_body_index < 0
                        || (offset.rigid_body_index as usize) >= num_rigid_bodies
                    {
                        diagnostics.push(Diagnostic {
                            severity: "error".to_string(),
                            code: "OUT_OF_BOUNDS_RIGIDBODY_REF".to_string(),
                            section: "Morph".to_string(),
                            item_index: Some(i),
                            message: format!(
                                "Impulse morph '{}' refers to out-of-bounds rigid body index: {}",
                                morph.name_local, offset.rigid_body_index
                            ),
                        });
                    }
                }
            }
        }
    }

    // Morph cycle detection
    let mut morph_visited = vec![0; num_morphs];
    for i in 0..num_morphs {
        if morph_visited[i] == 0 {
            detect_morph_cycle(i, &model.morphs, &mut morph_visited, &mut diagnostics);
        }
    }

    diagnostics
}

fn detect_bone_cycle(
    current: usize,
    bones: &[Bone],
    visited: &mut [u8],
    diagnostics: &mut Vec<Diagnostic>,
) -> bool {
    visited[current] = 1; // Visiting

    let parent = bones[current].parent_index;
    if parent >= 0 && (parent as usize) < bones.len() {
        let parent_usize = parent as usize;
        if visited[parent_usize] == 1 {
            diagnostics.push(Diagnostic {
                severity: "error".to_string(),
                code: "BONE_PARENT_CYCLE".to_string(),
                section: "Bone".to_string(),
                item_index: Some(current),
                message: format!(
                    "Bone Parenting Cycle detected involving bone '{}' and parent '{}'",
                    bones[current].name_local, bones[parent_usize].name_local
                ),
            });
            visited[current] = 2;
            return true;
        } else if visited[parent_usize] == 0 {
            if detect_bone_cycle(parent_usize, bones, visited, diagnostics) {
                visited[current] = 2;
                return true;
            }
        }
    }

    visited[current] = 2; // Visited
    false
}

fn detect_morph_cycle(
    current: usize,
    morphs: &[Morph],
    visited: &mut [u8],
    diagnostics: &mut Vec<Diagnostic>,
) -> bool {
    visited[current] = 1; // Visiting

    let mut cycle_detected = false;

    match &morphs[current].offsets {
        MorphOffsets::Group(offsets) => {
            for offset in offsets {
                if offset.morph_index >= 0 && (offset.morph_index as usize) < morphs.len() {
                    let next = offset.morph_index as usize;
                    if visited[next] == 1 {
                        diagnostics.push(Diagnostic {
                            severity: "error".to_string(),
                            code: "CYCLIC_MORPH_DEPENDENCY".to_string(),
                            section: "Morph".to_string(),
                            item_index: Some(current),
                            message: format!(
                                "Cyclic dependency detected: Group morph '{}' depends on morph '{}' which cycle-refers back.",
                                morphs[current].name_local, morphs[next].name_local
                            ),
                        });
                        cycle_detected = true;
                    } else if visited[next] == 0 {
                        if detect_morph_cycle(next, morphs, visited, diagnostics) {
                            cycle_detected = true;
                        }
                    }
                }
            }
        }
        MorphOffsets::Flip(offsets) => {
            for offset in offsets {
                if offset.morph_index >= 0 && (offset.morph_index as usize) < morphs.len() {
                    let next = offset.morph_index as usize;
                    if visited[next] == 1 {
                        diagnostics.push(Diagnostic {
                            severity: "error".to_string(),
                            code: "CYCLIC_MORPH_DEPENDENCY".to_string(),
                            section: "Morph".to_string(),
                            item_index: Some(current),
                            message: format!(
                                "Cyclic dependency detected: Flip morph '{}' depends on morph '{}' which cycle-refers back.",
                                morphs[current].name_local, morphs[next].name_local
                            ),
                        });
                        cycle_detected = true;
                    } else if visited[next] == 0 {
                        if detect_morph_cycle(next, morphs, visited, diagnostics) {
                            cycle_detected = true;
                        }
                    }
                }
            }
        }
        _ => {}
    }

    visited[current] = 2; // Visited
    cycle_detected
}
