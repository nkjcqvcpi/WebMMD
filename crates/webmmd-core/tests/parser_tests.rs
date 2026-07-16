// SPDX-License-Identifier: AGPL-3.0-or-later

#![allow(clippy::approx_constant)]

use std::fs::read;
use std::path::PathBuf;
use webmmd_core::math::{Mat4, Quat, Vec3, Vec4};
use webmmd_core::packing::pack_model;
use webmmd_core::pmx::{parse_pmx, PmxParseError};
use webmmd_core::validation::validate_pmx;

#[test]
fn test_parse_lynette() {
    let mut pmx_path = PathBuf::from(".tests-local/extracted/【琳妮特】.pmx");
    if !pmx_path.exists() {
        pmx_path = PathBuf::from("../../.tests-local/extracted/【琳妮特】.pmx");
    }
    if !pmx_path.exists() {
        println!("Skipping lynette parse test (test.zip not extracted).");
        return;
    }

    let data = read(pmx_path).expect("Failed to read Lynette PMX");
    let model = parse_pmx(&data).expect("Failed to parse PMX");

    assert!(model.version == 2.0 || model.version == 2.1);
    assert!(!model.vertices.is_empty());
    assert!(!model.indices.is_empty());

    let diagnostics = validate_pmx(&model);
    for diag in &diagnostics {
        println!("[Diag] {} {}: {}", diag.severity, diag.code, diag.message);
    }

    // Call packing to verify packing module works
    let packed = pack_model(&model);
    assert!(!packed.vertices_bin.is_empty());
    assert!(!packed.indices_bin.is_empty());
    assert!(!packed.materials_bin.is_empty());
}

#[test]
fn test_math() {
    // Test Vec3
    let v1 = Vec3::new(1.0, 2.0, 3.0);
    let v2 = Vec3::new(4.0, 5.0, 6.0);
    assert_eq!(v1.add(v2), Vec3::new(5.0, 7.0, 9.0));
    assert_eq!(v1.sub(v2), Vec3::new(-3.0, -3.0, -3.0));
    assert_eq!(v1.scale(2.0), Vec3::new(2.0, 4.0, 6.0));
    assert_eq!(v1.dot(v2), 32.0);
    let cross = v1.cross(v2);
    assert_eq!(cross, Vec3::new(-3.0, 6.0, -3.0));

    // Test Vec4
    let v4 = Vec4::new(1.0, 2.0, 3.0, 4.0);
    assert_eq!(v4.scale(2.0), Vec4::new(2.0, 4.0, 6.0, 8.0));

    // Test Quat
    let q1 = Quat::IDENTITY;
    let q2 = Quat::from_axis_angle(Vec3::new(0.0, 1.0, 0.0), 3.1415926);
    let slerped = q1.slerp(q2, 0.5);
    assert!(slerped.length() > 0.99);

    // Test Mat4
    let m1 = Mat4::from_translation(Vec3::new(1.0, 2.0, 3.0));
    let pt = Vec3::new(0.0, 0.0, 0.0);
    assert_eq!(m1.transform_point(pt), Vec3::new(1.0, 2.0, 3.0));
    let inv = m1.inverse().expect("Mat4 inverse failed");
    assert_eq!(
        inv.transform_point(Vec3::new(1.0, 2.0, 3.0)),
        Vec3::new(0.0, 0.0, 0.0)
    );
}

#[test]
fn test_parse_malformed_signature() {
    let malformed_data = b"PMY \x00\x00\x80\x3f\x08..."; // Invalid signature PMY
    let result = parse_pmx(malformed_data);
    assert!(matches!(result, Err(PmxParseError::InvalidSignature)));
}

#[test]
fn test_parse_truncated_data() {
    let truncated_data = b"PMX "; // Signature only, no version
    let result = parse_pmx(truncated_data);
    assert!(matches!(result, Err(PmxParseError::UnexpectedEof)));
}

use webmmd_core::pmx::types::{
    Bone, BoneMorphOffset, GroupMorphOffset, Ik, IkLink, InheritTransform, Material,
    MaterialMorphOffset, Morph, MorphOffsets, PmxModel,
};
use webmmd_core::runtime::ModelRuntime;

fn create_dummy_model() -> PmxModel {
    PmxModel {
        version: 2.0,
        name_local: "Dummy".to_string(),
        name_universal: "Dummy".to_string(),
        comments_local: String::new(),
        comments_universal: String::new(),
        vertices: Vec::new(),
        indices: Vec::new(),
        textures: Vec::new(),
        materials: Vec::new(),
        bones: Vec::new(),
        morphs: Vec::new(),
        rigid_bodies: Vec::new(),
        joints: Vec::new(),
        soft_bodies: Vec::new(),
    }
}

#[test]
fn test_quat_euler_xyz_conversions() {
    let angles = [(0.1f32, 0.2f32, 0.3f32), (-0.5, 0.8, -1.2), (0.0, 1.5, 0.0)];
    for (x, y, z) in angles {
        let q = Quat::from_euler_xyz(x, y, z);
        let euler = q.to_euler_xyz();
        let reconstructed = Quat::from_euler_xyz(euler.x, euler.y, euler.z);
        assert!((reconstructed.dot(q).abs() - 1.0).abs() < 1e-4);
    }
}

#[test]
fn test_group_flip_morph_graph() {
    let mut model = create_dummy_model();
    model.morphs = vec![
        Morph {
            name_local: "M0".to_string(),
            name_universal: "M0".to_string(),
            panel: 1,
            morph_type: 0,
            offsets: MorphOffsets::Group(vec![
                GroupMorphOffset {
                    morph_index: 1,
                    influence: 0.5,
                },
                GroupMorphOffset {
                    morph_index: 2,
                    influence: 1.5,
                },
            ]),
        },
        Morph {
            name_local: "M1".to_string(),
            name_universal: "M1".to_string(),
            panel: 1,
            morph_type: 1,
            offsets: MorphOffsets::Vertex(Vec::new()),
        },
        Morph {
            name_local: "M2".to_string(),
            name_universal: "M2".to_string(),
            panel: 1,
            morph_type: 0,
            offsets: MorphOffsets::Group(vec![GroupMorphOffset {
                morph_index: 3,
                influence: 2.0,
            }]),
        },
        Morph {
            name_local: "M3".to_string(),
            name_universal: "M3".to_string(),
            panel: 1,
            morph_type: 1,
            offsets: MorphOffsets::Vertex(Vec::new()),
        },
    ];

    let mut runtime = ModelRuntime::new(model);
    runtime.set_morph_weight(0, 1.0);
    runtime.evaluate();

    assert_eq!(runtime.morph_weights[0], 1.0);
    assert_eq!(runtime.morph_weights[1], 0.5);
    assert_eq!(runtime.morph_weights[2], 1.5);
    assert_eq!(runtime.morph_weights[3], 3.0);
}

#[test]
fn test_bone_morph() {
    let mut model = create_dummy_model();
    model.bones = vec![Bone {
        name_local: "Bone0".to_string(),
        name_universal: "Bone0".to_string(),
        position: Vec3::ZERO,
        parent_index: -1,
        transform_layer: 0,
        flags: 0,
        tail_position: Vec3::ZERO,
        tail_index: -1,
        inherit_rotation: None,
        inherit_translation: None,
        fixed_axis: None,
        local_coordinate: None,
        external_parent: None,
        ik: None,
    }];
    model.morphs = vec![Morph {
        name_local: "BM0".to_string(),
        name_universal: "BM0".to_string(),
        panel: 1,
        morph_type: 2,
        offsets: MorphOffsets::Bone(vec![BoneMorphOffset {
            bone_index: 0,
            translation: Vec3::new(1.0, 2.0, 3.0),
            rotation: Quat::from_axis_angle(Vec3::new(0.0, 1.0, 0.0), 1.0),
        }]),
    }];

    let mut runtime = ModelRuntime::new(model);
    runtime.set_morph_weight(0, 0.5);
    runtime.evaluate();

    assert!((runtime.morph_translations[0].x - 0.5).abs() < 1e-4);
    assert!((runtime.morph_translations[0].y - 1.0).abs() < 1e-4);
    assert!((runtime.morph_translations[0].z - 1.5).abs() < 1e-4);

    let expected_rot =
        Quat::IDENTITY.slerp(Quat::from_axis_angle(Vec3::new(0.0, 1.0, 0.0), 1.0), 0.5);
    assert!((runtime.morph_rotations[0].dot(expected_rot).abs() - 1.0).abs() < 1e-4);
}

#[test]
fn test_material_morph() {
    let mut model = create_dummy_model();
    model.materials = vec![Material {
        name_local: "Mat0".to_string(),
        name_universal: "Mat0".to_string(),
        diffuse: Vec4::new(1.0, 1.0, 1.0, 1.0),
        specular: Vec3::new(1.0, 1.0, 1.0),
        shininess: 10.0,
        ambient: Vec3::new(1.0, 1.0, 1.0),
        flags: 0,
        edge_color: Vec4::new(1.0, 1.0, 1.0, 1.0),
        edge_size: 1.0,
        texture_index: -1,
        sphere_texture_index: -1,
        sphere_mode: 0,
        toon_mode: 0,
        toon_texture_index: -1,
        comments: String::new(),
        surface_count: 0,
    }];
    model.morphs = vec![Morph {
        name_local: "MM0".to_string(),
        name_universal: "MM0".to_string(),
        panel: 1,
        morph_type: 8,
        offsets: MorphOffsets::Material(vec![MaterialMorphOffset {
            material_index: 0,
            operation: 0,
            diffuse: Vec4::new(0.5, 0.5, 0.5, 1.0),
            specular: Vec3::new(0.5, 0.5, 0.5),
            shininess: 0.5,
            ambient: Vec3::new(0.5, 0.5, 0.5),
            edge_color: Vec4::new(0.5, 0.5, 0.5, 1.0),
            edge_size: 0.5,
            texture_tint: Vec4::new(0.5, 0.5, 0.5, 1.0),
            sphere_tint: Vec4::new(0.5, 0.5, 0.5, 1.0),
            toon_tint: Vec4::new(0.5, 0.5, 0.5, 1.0),
        }]),
    }];

    let mut runtime = ModelRuntime::new(model);
    runtime.set_morph_weight(0, 1.0);
    runtime.evaluate();

    assert!((runtime.material_states[0].diffuse.x - 0.5).abs() < 1e-4);
    assert!((runtime.material_states[0].edge_size - 0.5).abs() < 1e-4);

    let states = runtime.get_material_states();
    assert_eq!(states.len(), 32);
}

#[test]
fn test_append_grants() {
    let mut model = create_dummy_model();
    model.bones = vec![
        Bone {
            name_local: "Parent".to_string(),
            name_universal: "Parent".to_string(),
            position: Vec3::ZERO,
            parent_index: -1,
            transform_layer: 0,
            flags: 0,
            tail_position: Vec3::ZERO,
            tail_index: -1,
            inherit_rotation: None,
            inherit_translation: None,
            fixed_axis: None,
            local_coordinate: None,
            external_parent: None,
            ik: None,
        },
        Bone {
            name_local: "Child".to_string(),
            name_universal: "Child".to_string(),
            position: Vec3::new(0.0, 1.0, 0.0),
            parent_index: 0,
            transform_layer: 0,
            flags: 0,
            tail_position: Vec3::ZERO,
            tail_index: -1,
            inherit_rotation: Some(InheritTransform {
                parent_index: 0,
                influence: 0.5,
            }),
            inherit_translation: Some(InheritTransform {
                parent_index: 0,
                influence: 0.5,
            }),
            fixed_axis: None,
            local_coordinate: None,
            external_parent: None,
            ik: None,
        },
    ];

    let mut runtime = ModelRuntime::new(model);
    runtime.set_bone_pose(
        0,
        Vec3::new(2.0, 0.0, 0.0),
        Quat::from_axis_angle(Vec3::new(0.0, 0.0, 1.0), 1.0),
    );
    runtime.evaluate();

    assert!((runtime.append_translations[1].x - 1.0).abs() < 1e-4);

    let expected_rot =
        Quat::IDENTITY.slerp(Quat::from_axis_angle(Vec3::new(0.0, 0.0, 1.0), 1.0), 0.5);
    assert!((runtime.append_rotations[1].dot(expected_rot).abs() - 1.0).abs() < 1e-4);
}

#[test]
fn test_ik_solvers() {
    let mut model = create_dummy_model();
    model.bones = vec![
        Bone {
            name_local: "Root".to_string(),
            name_universal: "Root".to_string(),
            position: Vec3::ZERO,
            parent_index: -1,
            transform_layer: 0,
            flags: 0,
            tail_position: Vec3::ZERO,
            tail_index: -1,
            inherit_rotation: None,
            inherit_translation: None,
            fixed_axis: None,
            local_coordinate: None,
            external_parent: None,
            ik: None,
        },
        Bone {
            name_local: "Joint1".to_string(),
            name_universal: "Joint1".to_string(),
            position: Vec3::new(0.0, 1.0, 0.0),
            parent_index: 0,
            transform_layer: 0,
            flags: 0,
            tail_position: Vec3::ZERO,
            tail_index: -1,
            inherit_rotation: None,
            inherit_translation: None,
            fixed_axis: None,
            local_coordinate: None,
            external_parent: None,
            ik: None,
        },
        Bone {
            name_local: "Effector".to_string(),
            name_universal: "Effector".to_string(),
            position: Vec3::new(0.0, 2.0, 0.0),
            parent_index: 1,
            transform_layer: 0,
            flags: 0,
            tail_position: Vec3::ZERO,
            tail_index: -1,
            inherit_rotation: None,
            inherit_translation: None,
            fixed_axis: None,
            local_coordinate: None,
            external_parent: None,
            ik: None,
        },
        Bone {
            name_local: "Target".to_string(),
            name_universal: "Target".to_string(),
            position: Vec3::new(1.0, 1.0, 0.0),
            parent_index: -1,
            transform_layer: 0,
            flags: 0,
            tail_position: Vec3::ZERO,
            tail_index: -1,
            inherit_rotation: None,
            inherit_translation: None,
            fixed_axis: None,
            local_coordinate: None,
            external_parent: None,
            ik: Some(Ik {
                target_index: 2,
                loop_count: 20,
                limit_angle: 0.5,
                links: vec![
                    IkLink {
                        bone_index: 1,
                        limit: None,
                    },
                    IkLink {
                        bone_index: 0,
                        limit: None,
                    },
                ],
            }),
        },
    ];

    let mut runtime = ModelRuntime::new(model);
    runtime.evaluate();

    let final_effector_pos = runtime.world_matrices[2].transform_point(Vec3::ZERO);
    let dist = final_effector_pos.sub(Vec3::new(1.0, 1.0, 0.0)).length();
    assert!(dist < 0.1);
}

#[test]
fn test_validation_errors() {
    use webmmd_core::pmx::types::*;
    use webmmd_core::validation::validate_pmx;

    let mut model = create_dummy_model();

    // 1. Textures: Path traversal check
    model.textures = vec![
        "safe.png".to_string(),
        "../unsafe.png".to_string(),
        "/absolute.png".to_string(),
        "c:\\windows\\system32.png".to_string(),
    ];

    // 2. Vertices: Out-of-bounds bone refs
    model.vertices = vec![
        Vertex {
            position: Vec3::ZERO,
            normal: Vec3::new(0.0, 1.0, 0.0),
            uv: Vec2::new(0.0, 0.0),
            additional_uvs: Vec::new(),
            deform: DeformType::Bdef1 { bone: 99 },
            edge_scale: 1.0,
        },
        Vertex {
            position: Vec3::ZERO,
            normal: Vec3::new(0.0, 1.0, 0.0),
            uv: Vec2::new(0.0, 0.0),
            additional_uvs: Vec::new(),
            deform: DeformType::Bdef2 {
                bone1: 0,
                bone2: 99,
                weight1: 0.5,
            },
            edge_scale: 1.0,
        },
        Vertex {
            position: Vec3::ZERO,
            normal: Vec3::new(0.0, 1.0, 0.0),
            uv: Vec2::new(0.0, 0.0),
            additional_uvs: Vec::new(),
            deform: DeformType::Bdef4 {
                bone1: 0,
                bone2: 1,
                bone3: 2,
                bone4: 99,
                weight1: 0.25,
                weight2: 0.25,
                weight3: 0.25,
                weight4: 0.25,
            },
            edge_scale: 1.0,
        },
        Vertex {
            position: Vec3::ZERO,
            normal: Vec3::new(0.0, 1.0, 0.0),
            uv: Vec2::new(0.0, 0.0),
            additional_uvs: Vec::new(),
            deform: DeformType::Sdef {
                bone1: 0,
                bone2: 99,
                weight1: 0.5,
                c: Vec3::ZERO,
                r0: Vec3::ZERO,
                r1: Vec3::ZERO,
            },
            edge_scale: 1.0,
        },
    ];

    // 3. Materials: Out-of-bounds texture refs
    model.materials = vec![Material {
        name_local: "Mat0".to_string(),
        name_universal: "Mat0".to_string(),
        diffuse: Vec4::new(1.0, 1.0, 1.0, 1.0),
        specular: Vec3::new(1.0, 1.0, 1.0),
        shininess: 10.0,
        ambient: Vec3::new(1.0, 1.0, 1.0),
        flags: 0,
        edge_color: Vec4::new(1.0, 1.0, 1.0, 1.0),
        edge_size: 1.0,
        texture_index: 99,
        sphere_texture_index: 99,
        sphere_mode: 0,
        toon_mode: 0,
        toon_texture_index: 99,
        comments: String::new(),
        surface_count: 0,
    }];

    // 4. Bones: Parent, inherit, IK out-of-bounds & cycle refs
    model.bones = vec![
        Bone {
            name_local: "Bone0".to_string(),
            name_universal: "Bone0".to_string(),
            position: Vec3::ZERO,
            parent_index: 99,
            transform_layer: 0,
            flags: 0,
            tail_position: Vec3::ZERO,
            tail_index: -1,
            inherit_rotation: Some(InheritTransform {
                parent_index: 99,
                influence: 1.0,
            }),
            inherit_translation: Some(InheritTransform {
                parent_index: 99,
                influence: 1.0,
            }),
            fixed_axis: None,
            local_coordinate: None,
            external_parent: None,
            ik: Some(Ik {
                target_index: 99,
                loop_count: 10,
                limit_angle: 1.0,
                links: vec![IkLink {
                    bone_index: 99,
                    limit: None,
                }],
            }),
        },
        Bone {
            name_local: "Bone1".to_string(),
            name_universal: "Bone1".to_string(),
            position: Vec3::ZERO,
            parent_index: 2,
            transform_layer: 0,
            flags: 0,
            tail_position: Vec3::ZERO,
            tail_index: -1,
            inherit_rotation: None,
            inherit_translation: None,
            fixed_axis: None,
            local_coordinate: None,
            external_parent: None,
            ik: None,
        },
        Bone {
            name_local: "Bone2".to_string(),
            name_universal: "Bone2".to_string(),
            position: Vec3::ZERO,
            parent_index: 1, // Cycle: 1 -> 2 -> 1
            transform_layer: 0,
            flags: 0,
            tail_position: Vec3::ZERO,
            tail_index: -1,
            inherit_rotation: None,
            inherit_translation: None,
            fixed_axis: None,
            local_coordinate: None,
            external_parent: None,
            ik: None,
        },
        Bone {
            name_local: "Bone3".to_string(),
            name_universal: "Bone3".to_string(),
            position: Vec3::ZERO,
            parent_index: 3, // Self cycle
            transform_layer: 0,
            flags: 0,
            tail_position: Vec3::ZERO,
            tail_index: -1,
            inherit_rotation: None,
            inherit_translation: None,
            fixed_axis: None,
            local_coordinate: None,
            external_parent: None,
            ik: None,
        },
    ];

    // 5. Morphs: Group morph cycle checks and index verification
    model.morphs = vec![
        Morph {
            name_local: "Morph0".to_string(),
            name_universal: "Morph0".to_string(),
            panel: 1,
            morph_type: 0,
            offsets: MorphOffsets::Group(vec![GroupMorphOffset {
                morph_index: 0, // self cycle
                influence: 1.0,
            }]),
        },
        Morph {
            name_local: "Morph1".to_string(),
            name_universal: "Morph1".to_string(),
            panel: 1,
            morph_type: 0,
            offsets: MorphOffsets::Group(vec![GroupMorphOffset {
                morph_index: 99, // out of bounds
                influence: 1.0,
            }]),
        },
        Morph {
            name_local: "Morph2".to_string(),
            name_universal: "Morph2".to_string(),
            panel: 1,
            morph_type: 1,
            offsets: MorphOffsets::Vertex(vec![VertexMorphOffset {
                vertex_index: 99, // out of bounds
                offset: Vec3::ZERO,
            }]),
        },
        Morph {
            name_local: "Morph3".to_string(),
            name_universal: "Morph3".to_string(),
            panel: 1,
            morph_type: 2,
            offsets: MorphOffsets::Bone(vec![BoneMorphOffset {
                bone_index: 99, // out of bounds
                translation: Vec3::ZERO,
                rotation: Quat::IDENTITY,
            }]),
        },
        Morph {
            name_local: "Morph4".to_string(),
            name_universal: "Morph4".to_string(),
            panel: 1,
            morph_type: 3,
            offsets: MorphOffsets::Uv(vec![UvMorphOffset {
                vertex_index: 99, // out of bounds
                offset: Vec4::ZERO,
            }]),
        },
        Morph {
            name_local: "Morph5".to_string(),
            name_universal: "Morph5".to_string(),
            panel: 1,
            morph_type: 8,
            offsets: MorphOffsets::Material(vec![MaterialMorphOffset {
                material_index: 99, // out of bounds
                operation: 0,
                diffuse: Vec4::ZERO,
                specular: Vec3::ZERO,
                shininess: 0.0,
                ambient: Vec3::ZERO,
                edge_color: Vec4::ZERO,
                edge_size: 0.0,
                texture_tint: Vec4::ZERO,
                sphere_tint: Vec4::ZERO,
                toon_tint: Vec4::ZERO,
            }]),
        },
    ];

    // 6. Rigid bodies and joints out-of-bounds references
    model.rigid_bodies = vec![RigidBody {
        name_local: "Rb0".to_string(),
        name_universal: "Rb0".to_string(),
        bone_index: 99,
        group: 0,
        collision_mask: 0,
        shape: 0,
        size: Vec3::ZERO,
        position: Vec3::ZERO,
        rotation: Vec3::ZERO,
        mass: 0.0,
        linear_damping: 0.0,
        angular_damping: 0.0,
        restitution: 0.0,
        friction: 0.0,
        mode: 0,
    }];

    model.joints = vec![Joint {
        name_local: "Joint0".to_string(),
        name_universal: "Joint0".to_string(),
        joint_type: 0,
        body_a_index: 99,
        body_b_index: 99,
        position: Vec3::ZERO,
        rotation: Vec3::ZERO,
        linear_limit_min: Vec3::ZERO,
        linear_limit_max: Vec3::ZERO,
        angular_limit_min: Vec3::ZERO,
        angular_limit_max: Vec3::ZERO,
        linear_stiffness: Vec3::ZERO,
        angular_stiffness: Vec3::ZERO,
    }];

    let diagnostics = validate_pmx(&model);
    assert!(!diagnostics.is_empty());
}
