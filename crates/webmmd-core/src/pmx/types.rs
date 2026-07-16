// SPDX-License-Identifier: GPL-3.0-or-later

use crate::math::{Quat, Vec3, Vec4};

#[derive(Debug, Copy, Clone, PartialEq)]
pub struct Vec2 {
    pub x: f32,
    pub y: f32,
}

impl Vec2 {
    pub fn new(x: f32, y: f32) -> Self {
        Self { x, y }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum DeformType {
    Bdef1 {
        bone: i32,
    },
    Bdef2 {
        bone1: i32,
        bone2: i32,
        weight1: f32,
    },
    Bdef4 {
        bone1: i32,
        bone2: i32,
        bone3: i32,
        bone4: i32,
        weight1: f32,
        weight2: f32,
        weight3: f32,
        weight4: f32,
    },
    Sdef {
        bone1: i32,
        bone2: i32,
        weight1: f32,
        c: Vec3,
        r0: Vec3,
        r1: Vec3,
    },
    Qdef {
        bone1: i32,
        bone2: i32,
        bone3: i32,
        bone4: i32,
        weight1: f32,
        weight2: f32,
        weight3: f32,
        weight4: f32,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct Vertex {
    pub position: Vec3,
    pub normal: Vec3,
    pub uv: Vec2,
    pub additional_uvs: Vec<Vec4>,
    pub deform: DeformType,
    pub edge_scale: f32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Material {
    pub name_local: String,
    pub name_universal: String,
    pub diffuse: Vec4,
    pub specular: Vec3,
    pub shininess: f32,
    pub ambient: Vec3,
    pub flags: u8,
    pub edge_color: Vec4,
    pub edge_size: f32,
    pub texture_index: i32,
    pub sphere_texture_index: i32,
    pub sphere_mode: u8,
    pub toon_mode: u8,
    pub toon_texture_index: i32,
    pub comments: String,
    pub surface_count: i32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct InheritTransform {
    pub parent_index: i32,
    pub influence: f32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LocalCoordinate {
    pub x_axis: Vec3,
    pub z_axis: Vec3,
}

#[derive(Debug, Clone, PartialEq)]
pub struct IkLimit {
    pub min: Vec3,
    pub max: Vec3,
}

#[derive(Debug, Clone, PartialEq)]
pub struct IkLink {
    pub bone_index: i32,
    pub limit: Option<IkLimit>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Ik {
    pub target_index: i32,
    pub loop_count: i32,
    pub limit_angle: f32, // in radians
    pub links: Vec<IkLink>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Bone {
    pub name_local: String,
    pub name_universal: String,
    pub position: Vec3,
    pub parent_index: i32,
    pub transform_layer: i32,
    pub flags: u16,
    pub tail_position: Vec3,
    pub tail_index: i32,
    pub inherit_rotation: Option<InheritTransform>,
    pub inherit_translation: Option<InheritTransform>,
    pub fixed_axis: Option<Vec3>,
    pub local_coordinate: Option<LocalCoordinate>,
    pub external_parent: Option<i32>,
    pub ik: Option<Ik>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct GroupMorphOffset {
    pub morph_index: i32,
    pub influence: f32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct VertexMorphOffset {
    pub vertex_index: i32,
    pub offset: Vec3,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BoneMorphOffset {
    pub bone_index: i32,
    pub translation: Vec3,
    pub rotation: Quat,
}

#[derive(Debug, Clone, PartialEq)]
pub struct UvMorphOffset {
    pub vertex_index: i32,
    pub offset: Vec4,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MaterialMorphOffset {
    pub material_index: i32,
    pub operation: u8,
    pub diffuse: Vec4,
    pub specular: Vec3,
    pub shininess: f32,
    pub ambient: Vec3,
    pub edge_color: Vec4,
    pub edge_size: f32,
    pub texture_tint: Vec4,
    pub sphere_tint: Vec4,
    pub toon_tint: Vec4,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FlipMorphOffset {
    pub morph_index: i32,
    pub influence: f32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ImpulseMorphOffset {
    pub rigid_body_index: i32,
    pub local_flag: u8,
    pub velocity: Vec3,
    pub torque: Vec3,
}

#[derive(Debug, Clone, PartialEq)]
pub enum MorphOffsets {
    Group(Vec<GroupMorphOffset>),
    Vertex(Vec<VertexMorphOffset>),
    Bone(Vec<BoneMorphOffset>),
    Uv(Vec<UvMorphOffset>),
    Material(Vec<MaterialMorphOffset>),
    Flip(Vec<FlipMorphOffset>),
    Impulse(Vec<ImpulseMorphOffset>),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Morph {
    pub name_local: String,
    pub name_universal: String,
    pub panel: u8,
    pub morph_type: u8,
    pub offsets: MorphOffsets,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RigidBody {
    pub name_local: String,
    pub name_universal: String,
    pub bone_index: i32,
    pub group: u8,
    pub collision_mask: u16,
    pub shape: u8,
    pub size: Vec3,
    pub position: Vec3,
    pub rotation: Vec3,
    pub mass: f32,
    pub linear_damping: f32,
    pub angular_damping: f32,
    pub restitution: f32,
    pub friction: f32,
    pub mode: u8,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Joint {
    pub name_local: String,
    pub name_universal: String,
    pub joint_type: u8,
    pub body_a_index: i32,
    pub body_b_index: i32,
    pub position: Vec3,
    pub rotation: Vec3,
    pub linear_limit_min: Vec3,
    pub linear_limit_max: Vec3,
    pub angular_limit_min: Vec3,
    pub angular_limit_max: Vec3,
    pub linear_stiffness: Vec3,
    pub angular_stiffness: Vec3,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SoftBodyConfig {
    pub aerodynamics: f32,
    pub pose_match: f32,
    pub rigid_contacts: f32,
    pub k_l_s: f32,
    pub k_a_s: f32,
    pub k_v_s: f32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SoftBody {
    pub name_local: String,
    pub name_universal: String,
    pub shape: u8,
    pub material_index: i32,
    pub group: u8,
    pub collision_mask: u16,
    pub flags: u8,
    pub b_link_distance: i32,
    pub num_clusters: i32,
    pub total_mass: f32,
    pub collision_margin: f32,
    pub config: SoftBodyConfig,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PmxModel {
    pub version: f32,
    pub name_local: String,
    pub name_universal: String,
    pub comments_local: String,
    pub comments_universal: String,
    pub vertices: Vec<Vertex>,
    pub indices: Vec<i32>,
    pub textures: Vec<String>,
    pub materials: Vec<Material>,
    pub bones: Vec<Bone>,
    pub morphs: Vec<Morph>,
    pub rigid_bodies: Vec<RigidBody>,
    pub joints: Vec<Joint>,
    pub soft_bodies: Vec<SoftBody>,
}
