// SPDX-License-Identifier: AGPL-3.0-or-later

pub mod reader;
pub mod types;

use crate::math::Vec3;
pub use reader::{PmxParseError, PmxReader};
pub use types::*;

pub fn parse_pmx(data: &[u8]) -> Result<PmxModel, PmxParseError> {
    let mut r = PmxReader::new(data);

    // 1. Header
    let signature = r.read_bytes(4)?;
    if signature != [0x50, 0x4D, 0x58, 0x20] {
        return Err(PmxParseError::InvalidSignature);
    }

    let version = r.read_f32()?;
    if version != 2.0 && version != 2.1 {
        return Err(PmxParseError::UnsupportedVersion(version));
    }

    let globals_count = r.read_u8()?;
    if globals_count < 8 {
        return Err(PmxParseError::InvalidGlobalsCount(globals_count));
    }

    let mut globals = Vec::with_capacity(globals_count as usize);
    for _ in 0..globals_count {
        globals.push(r.read_u8()?);
    }

    let encoding = globals[0];
    if encoding != 0 && encoding != 1 {
        return Err(PmxParseError::InvalidGlobalValue {
            index: 0,
            value: encoding,
        });
    }

    let additional_uvs = globals[1];
    if additional_uvs > 4 {
        return Err(PmxParseError::InvalidGlobalValue {
            index: 1,
            value: additional_uvs,
        });
    }

    let vertex_idx_size = globals[2];
    if vertex_idx_size != 1 && vertex_idx_size != 2 && vertex_idx_size != 4 {
        return Err(PmxParseError::InvalidGlobalValue {
            index: 2,
            value: vertex_idx_size,
        });
    }

    let texture_idx_size = globals[3];
    if texture_idx_size != 1 && texture_idx_size != 2 && texture_idx_size != 4 {
        return Err(PmxParseError::InvalidGlobalValue {
            index: 3,
            value: texture_idx_size,
        });
    }

    let material_idx_size = globals[4];
    if material_idx_size != 1 && material_idx_size != 2 && material_idx_size != 4 {
        return Err(PmxParseError::InvalidGlobalValue {
            index: 4,
            value: material_idx_size,
        });
    }

    let bone_idx_size = globals[5];
    if bone_idx_size != 1 && bone_idx_size != 2 && bone_idx_size != 4 {
        return Err(PmxParseError::InvalidGlobalValue {
            index: 5,
            value: bone_idx_size,
        });
    }

    let morph_idx_size = globals[6];
    if morph_idx_size != 1 && morph_idx_size != 2 && morph_idx_size != 4 {
        return Err(PmxParseError::InvalidGlobalValue {
            index: 6,
            value: morph_idx_size,
        });
    }

    let rigidbody_idx_size = globals[7];
    if rigidbody_idx_size != 1 && rigidbody_idx_size != 2 && rigidbody_idx_size != 4 {
        return Err(PmxParseError::InvalidGlobalValue {
            index: 7,
            value: rigidbody_idx_size,
        });
    }

    let name_local = r.read_string(encoding)?;
    let name_universal = r.read_string(encoding)?;
    let comments_local = r.read_string(encoding)?;
    let comments_universal = r.read_string(encoding)?;

    // 2. Vertices
    let vertex_count = r.read_i32()?;
    if vertex_count < 0 {
        return Err(PmxParseError::NegativeCount("vertex count".to_string()));
    }

    let mut vertices = Vec::with_capacity(vertex_count as usize);
    for _ in 0..vertex_count {
        let position = r.read_vec3()?;
        let normal = r.read_vec3()?;
        let uv = r.read_vec2()?;

        let mut vert_add_uvs = Vec::with_capacity(additional_uvs as usize);
        for _ in 0..additional_uvs {
            vert_add_uvs.push(r.read_vec4()?);
        }

        let deform_type_u8 = r.read_u8()?;
        let deform = match deform_type_u8 {
            0 => {
                let bone = r.read_index(bone_idx_size, true)?;
                DeformType::Bdef1 { bone }
            }
            1 => {
                let bone1 = r.read_index(bone_idx_size, true)?;
                let bone2 = r.read_index(bone_idx_size, true)?;
                let weight1 = r.read_f32()?;
                DeformType::Bdef2 {
                    bone1,
                    bone2,
                    weight1,
                }
            }
            2 => {
                let bone1 = r.read_index(bone_idx_size, true)?;
                let bone2 = r.read_index(bone_idx_size, true)?;
                let bone3 = r.read_index(bone_idx_size, true)?;
                let bone4 = r.read_index(bone_idx_size, true)?;
                let weight1 = r.read_f32()?;
                let weight2 = r.read_f32()?;
                let weight3 = r.read_f32()?;
                let weight4 = r.read_f32()?;
                DeformType::Bdef4 {
                    bone1,
                    bone2,
                    bone3,
                    bone4,
                    weight1,
                    weight2,
                    weight3,
                    weight4,
                }
            }
            3 => {
                let bone1 = r.read_index(bone_idx_size, true)?;
                let bone2 = r.read_index(bone_idx_size, true)?;
                let weight1 = r.read_f32()?;
                let c = r.read_vec3()?;
                let r0 = r.read_vec3()?;
                let r1 = r.read_vec3()?;
                DeformType::Sdef {
                    bone1,
                    bone2,
                    weight1,
                    c,
                    r0,
                    r1,
                }
            }
            4 => {
                if version < 2.1 {
                    return Err(PmxParseError::InvalidDeformType(deform_type_u8));
                }
                let bone1 = r.read_index(bone_idx_size, true)?;
                let bone2 = r.read_index(bone_idx_size, true)?;
                let bone3 = r.read_index(bone_idx_size, true)?;
                let bone4 = r.read_index(bone_idx_size, true)?;
                let weight1 = r.read_f32()?;
                let weight2 = r.read_f32()?;
                let weight3 = r.read_f32()?;
                let weight4 = r.read_f32()?;
                DeformType::Qdef {
                    bone1,
                    bone2,
                    bone3,
                    bone4,
                    weight1,
                    weight2,
                    weight3,
                    weight4,
                }
            }
            _ => return Err(PmxParseError::InvalidDeformType(deform_type_u8)),
        };

        let edge_scale = r.read_f32()?;

        vertices.push(Vertex {
            position,
            normal,
            uv,
            additional_uvs: vert_add_uvs,
            deform,
            edge_scale,
        });
    }

    // 3. Surfaces (Indices)
    let surface_count = r.read_i32()?;
    if surface_count < 0 {
        return Err(PmxParseError::NegativeCount("surface count".to_string()));
    }
    if surface_count % 3 != 0 {
        // PMX surfaces must define triangles (index count divisible by 3)
        // We will validate this in validation module but let's parse it
    }

    let mut indices = Vec::with_capacity(surface_count as usize);
    for _ in 0..surface_count {
        // Vertex indices are read as unsigned
        let idx = r.read_index(vertex_idx_size, false)?;
        indices.push(idx);
    }

    // 4. Textures
    let texture_count = r.read_i32()?;
    if texture_count < 0 {
        return Err(PmxParseError::NegativeCount("texture count".to_string()));
    }

    let mut textures = Vec::with_capacity(texture_count as usize);
    for _ in 0..texture_count {
        textures.push(r.read_string(encoding)?);
    }

    // 5. Materials
    let material_count = r.read_i32()?;
    if material_count < 0 {
        return Err(PmxParseError::NegativeCount("material count".to_string()));
    }

    let mut materials = Vec::with_capacity(material_count as usize);
    for _ in 0..material_count {
        let name_local = r.read_string(encoding)?;
        let name_universal = r.read_string(encoding)?;
        let diffuse = r.read_vec4()?;
        let specular = r.read_vec3()?;
        let shininess = r.read_f32()?;
        let ambient = r.read_vec3()?;
        let flags = r.read_u8()?;
        let edge_color = r.read_vec4()?;
        let edge_size = r.read_f32()?;
        let texture_index = r.read_index(texture_idx_size, true)?;
        let sphere_texture_index = r.read_index(texture_idx_size, true)?;
        let sphere_mode = r.read_u8()?;
        let toon_mode = r.read_u8()?;
        let toon_texture_index = if toon_mode == 0 {
            r.read_index(texture_idx_size, true)?
        } else {
            r.read_u8()? as i32
        };
        let comments = r.read_string(encoding)?;
        let surface_count = r.read_i32()?;

        materials.push(Material {
            name_local,
            name_universal,
            diffuse,
            specular,
            shininess,
            ambient,
            flags,
            edge_color,
            edge_size,
            texture_index,
            sphere_texture_index,
            sphere_mode,
            toon_mode,
            toon_texture_index,
            comments,
            surface_count,
        });
    }

    // 6. Bones
    let bone_count = r.read_i32()?;
    if bone_count < 0 {
        return Err(PmxParseError::NegativeCount("bone count".to_string()));
    }

    let mut bones = Vec::with_capacity(bone_count as usize);
    for _ in 0..bone_count {
        let name_local = r.read_string(encoding)?;
        let name_universal = r.read_string(encoding)?;
        let position = r.read_vec3()?;
        let parent_index = r.read_index(bone_idx_size, true)?;
        let transform_layer = r.read_i32()?;
        let flags = r.read_u16()?;

        let mut tail_position = Vec3::ZERO;
        let mut tail_index = -1;
        if (flags & 0x0001) == 0 {
            tail_position = r.read_vec3()?;
        } else {
            tail_index = r.read_index(bone_idx_size, true)?;
        }

        let mut inherit_rotation = None;
        let mut inherit_translation = None;
        if (flags & 0x0100) != 0 || (flags & 0x0200) != 0 {
            let parent_idx = r.read_index(bone_idx_size, true)?;
            let influence = r.read_f32()?;
            let inherit = InheritTransform {
                parent_index: parent_idx,
                influence,
            };
            if (flags & 0x0100) != 0 {
                inherit_rotation = Some(inherit.clone());
            }
            if (flags & 0x0200) != 0 {
                inherit_translation = Some(inherit);
            }
        }

        let mut fixed_axis = None;
        if (flags & 0x0400) != 0 {
            fixed_axis = Some(r.read_vec3()?);
        }

        let mut local_coordinate = None;
        if (flags & 0x0800) != 0 {
            let x_axis = r.read_vec3()?;
            let z_axis = r.read_vec3()?;
            local_coordinate = Some(LocalCoordinate { x_axis, z_axis });
        }

        let mut external_parent = None;
        if (flags & 0x2000) != 0 {
            external_parent = Some(r.read_i32()?);
        }

        let mut ik = None;
        if (flags & 0x0020) != 0 {
            let target_index = r.read_index(bone_idx_size, true)?;
            let loop_count = r.read_i32()?;
            let limit_angle = r.read_f32()?;
            let links_count = r.read_i32()?;
            if links_count < 0 {
                return Err(PmxParseError::NegativeCount("IK links count".to_string()));
            }

            let mut links = Vec::with_capacity(links_count as usize);
            for _ in 0..links_count {
                let link_bone = r.read_index(bone_idx_size, true)?;
                let limit_flag = r.read_u8()?;
                let mut limit = None;
                if limit_flag == 1 {
                    let min = r.read_vec3()?;
                    let max = r.read_vec3()?;
                    limit = Some(IkLimit { min, max });
                }
                links.push(IkLink {
                    bone_index: link_bone,
                    limit,
                });
            }
            ik = Some(Ik {
                target_index,
                loop_count,
                limit_angle,
                links,
            });
        }

        bones.push(Bone {
            name_local,
            name_universal,
            position,
            parent_index,
            transform_layer,
            flags,
            tail_position,
            tail_index,
            inherit_rotation,
            inherit_translation,
            fixed_axis,
            local_coordinate,
            external_parent,
            ik,
        });
    }

    // 7. Morphs
    let morph_count = r.read_i32()?;
    if morph_count < 0 {
        return Err(PmxParseError::NegativeCount("morph count".to_string()));
    }

    let mut morphs = Vec::with_capacity(morph_count as usize);
    for _ in 0..morph_count {
        let name_local = r.read_string(encoding)?;
        let name_universal = r.read_string(encoding)?;
        let panel = r.read_u8()?;
        let morph_type = r.read_u8()?;
        let offsets_count = r.read_i32()?;
        if offsets_count < 0 {
            return Err(PmxParseError::NegativeCount(
                "morph offsets count".to_string(),
            ));
        }

        let offsets = match morph_type {
            0 => {
                let mut list = Vec::with_capacity(offsets_count as usize);
                for _ in 0..offsets_count {
                    let idx = r.read_index(morph_idx_size, true)?;
                    let influence = r.read_f32()?;
                    list.push(GroupMorphOffset {
                        morph_index: idx,
                        influence,
                    });
                }
                MorphOffsets::Group(list)
            }
            1 => {
                let mut list = Vec::with_capacity(offsets_count as usize);
                for _ in 0..offsets_count {
                    let idx = r.read_index(vertex_idx_size, false)?;
                    let offset = r.read_vec3()?;
                    list.push(VertexMorphOffset {
                        vertex_index: idx,
                        offset,
                    });
                }
                MorphOffsets::Vertex(list)
            }
            2 => {
                let mut list = Vec::with_capacity(offsets_count as usize);
                for _ in 0..offsets_count {
                    let idx = r.read_index(bone_idx_size, true)?;
                    let translation = r.read_vec3()?;
                    let rotation = r.read_quat()?;
                    list.push(BoneMorphOffset {
                        bone_index: idx,
                        translation,
                        rotation,
                    });
                }
                MorphOffsets::Bone(list)
            }
            3 | 4 | 5 | 6 | 7 => {
                let mut list = Vec::with_capacity(offsets_count as usize);
                for _ in 0..offsets_count {
                    let idx = r.read_index(vertex_idx_size, false)?;
                    let offset = r.read_vec4()?;
                    list.push(UvMorphOffset {
                        vertex_index: idx,
                        offset,
                    });
                }
                MorphOffsets::Uv(list)
            }
            8 => {
                let mut list = Vec::with_capacity(offsets_count as usize);
                for _ in 0..offsets_count {
                    let idx = r.read_index(material_idx_size, true)?;
                    let operation = r.read_u8()?;
                    let diffuse = r.read_vec4()?;
                    let specular = r.read_vec3()?;
                    let shininess = r.read_f32()?;
                    let ambient = r.read_vec3()?;
                    let edge_color = r.read_vec4()?;
                    let edge_size = r.read_f32()?;
                    let texture_tint = r.read_vec4()?;
                    let sphere_tint = r.read_vec4()?;
                    let toon_tint = r.read_vec4()?;
                    list.push(MaterialMorphOffset {
                        material_index: idx,
                        operation,
                        diffuse,
                        specular,
                        shininess,
                        ambient,
                        edge_color,
                        edge_size,
                        texture_tint,
                        sphere_tint,
                        toon_tint,
                    });
                }
                MorphOffsets::Material(list)
            }
            9 => {
                let mut list = Vec::with_capacity(offsets_count as usize);
                for _ in 0..offsets_count {
                    let idx = r.read_index(morph_idx_size, true)?;
                    let influence = r.read_f32()?;
                    list.push(FlipMorphOffset {
                        morph_index: idx,
                        influence,
                    });
                }
                MorphOffsets::Flip(list)
            }
            10 => {
                let mut list = Vec::with_capacity(offsets_count as usize);
                for _ in 0..offsets_count {
                    let idx = r.read_index(rigidbody_idx_size, true)?;
                    let local_flag = r.read_u8()?;
                    let velocity = r.read_vec3()?;
                    let torque = r.read_vec3()?;
                    list.push(ImpulseMorphOffset {
                        rigid_body_index: idx,
                        local_flag,
                        velocity,
                        torque,
                    });
                }
                MorphOffsets::Impulse(list)
            }
            _ => return Err(PmxParseError::InvalidDeformType(morph_type)),
        };

        morphs.push(Morph {
            name_local,
            name_universal,
            panel,
            morph_type,
            offsets,
        });
    }

    // 8. Display Frames (parse and skip, but validate count to ensure correct bounds check)
    let display_frame_count = r.read_i32()?;
    if display_frame_count < 0 {
        return Err(PmxParseError::NegativeCount(
            "display frame count".to_string(),
        ));
    }
    for _ in 0..display_frame_count {
        let _name_local = r.read_string(encoding)?;
        let _name_universal = r.read_string(encoding)?;
        let _type_flag = r.read_u8()?;
        let members_count = r.read_i32()?;
        if members_count < 0 {
            return Err(PmxParseError::NegativeCount(
                "display frame members count".to_string(),
            ));
        }
        for _ in 0..members_count {
            let target = r.read_u8()?;
            if target == 0 {
                let _bone_idx = r.read_index(bone_idx_size, true)?;
            } else {
                let _morph_idx = r.read_index(morph_idx_size, true)?;
            }
        }
    }

    // 9. Rigid Bodies
    let rigid_body_count = r.read_i32()?;
    if rigid_body_count < 0 {
        return Err(PmxParseError::NegativeCount("rigid body count".to_string()));
    }

    let mut rigid_bodies = Vec::with_capacity(rigid_body_count as usize);
    for _ in 0..rigid_body_count {
        let name_local = r.read_string(encoding)?;
        let name_universal = r.read_string(encoding)?;
        let bone_index = r.read_index(bone_idx_size, true)?;
        let group = r.read_u8()?;
        let collision_mask = r.read_u16()?;
        let shape = r.read_u8()?;
        let size = r.read_vec3()?;
        let position = r.read_vec3()?;
        let rotation = r.read_vec3()?;
        let mass = r.read_f32()?;
        let linear_damping = r.read_f32()?;
        let angular_damping = r.read_f32()?;
        let restitution = r.read_f32()?;
        let friction = r.read_f32()?;
        let mode = r.read_u8()?;

        rigid_bodies.push(RigidBody {
            name_local,
            name_universal,
            bone_index,
            group,
            collision_mask,
            shape,
            size,
            position,
            rotation,
            mass,
            linear_damping,
            angular_damping,
            restitution,
            friction,
            mode,
        });
    }

    // 10. Joints
    let joint_count = r.read_i32()?;
    if joint_count < 0 {
        return Err(PmxParseError::NegativeCount("joint count".to_string()));
    }

    let mut joints = Vec::with_capacity(joint_count as usize);
    for _ in 0..joint_count {
        let name_local = r.read_string(encoding)?;
        let name_universal = r.read_string(encoding)?;
        let joint_type = r.read_u8()?;
        let body_a_index = r.read_index(rigidbody_idx_size, true)?;
        let body_b_index = r.read_index(rigidbody_idx_size, true)?;
        let position = r.read_vec3()?;
        let rotation = r.read_vec3()?;
        let linear_limit_min = r.read_vec3()?;
        let linear_limit_max = r.read_vec3()?;
        let angular_limit_min = r.read_vec3()?;
        let angular_limit_max = r.read_vec3()?;
        let linear_stiffness = r.read_vec3()?;
        let angular_stiffness = r.read_vec3()?;

        joints.push(Joint {
            name_local,
            name_universal,
            joint_type,
            body_a_index,
            body_b_index,
            position,
            rotation,
            linear_limit_min,
            linear_limit_max,
            angular_limit_min,
            angular_limit_max,
            linear_stiffness,
            angular_stiffness,
        });
    }

    // 11. Soft Bodies (PMX 2.1 only)
    let mut soft_bodies = Vec::new();
    if version >= 2.1 && !r.is_eof() {
        let soft_body_count = r.read_i32()?;
        if soft_body_count < 0 {
            return Err(PmxParseError::NegativeCount("soft body count".to_string()));
        }
        soft_bodies.reserve(soft_body_count as usize);
        for _ in 0..soft_body_count {
            let name_local = r.read_string(encoding)?;
            let name_universal = r.read_string(encoding)?;
            let shape = r.read_u8()?;
            let material_index = r.read_index(material_idx_size, true)?;
            let group = r.read_u8()?;
            let collision_mask = r.read_u16()?;
            let flags = r.read_u8()?;
            let b_link_distance = r.read_i32()?;
            let num_clusters = r.read_i32()?;
            let total_mass = r.read_f32()?;
            let collision_margin = r.read_f32()?;
            let aerodynamics = r.read_f32()?;
            let pose_match = r.read_f32()?;
            let rigid_contacts = r.read_f32()?;
            let k_l_s = r.read_f32()?;
            let k_a_s = r.read_f32()?;
            let k_v_s = r.read_f32()?;

            soft_bodies.push(SoftBody {
                name_local,
                name_universal,
                shape,
                material_index,
                group,
                collision_mask,
                flags,
                b_link_distance,
                num_clusters,
                total_mass,
                collision_margin,
                config: SoftBodyConfig {
                    aerodynamics,
                    pose_match,
                    rigid_contacts,
                    k_l_s,
                    k_a_s,
                    k_v_s,
                },
            });
        }
    }

    Ok(PmxModel {
        version,
        name_local,
        name_universal,
        comments_local,
        comments_universal,
        vertices,
        indices,
        textures,
        materials,
        bones,
        morphs,
        rigid_bodies,
        joints,
        soft_bodies,
    })
}
