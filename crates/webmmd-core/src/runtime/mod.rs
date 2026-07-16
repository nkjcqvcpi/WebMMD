// SPDX-License-Identifier: AGPL-3.0-or-later

use crate::math::{Mat4, Quat, Vec3, Vec4};
use crate::pmx::types::{Ik, Material, MaterialMorphOffset, MorphOffsets, PmxModel};
use std::collections::{BTreeMap, HashSet};

#[derive(Debug, Clone)]
pub struct RuntimeMaterialState {
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

pub struct ModelRuntime {
    pub model: PmxModel,

    // Traversal and dependency order
    pub evaluation_order: Vec<usize>,
    pub morph_evaluation_order: Vec<usize>,

    // Dynamic morph weights
    pub input_morph_weights: Vec<f32>,
    pub morph_weights: Vec<f32>,

    // Bone manual pose state (translation & rotation offsets)
    pub manual_translations: Vec<Vec3>,
    pub manual_rotations: Vec<Quat>,

    // Current accumulated morph offsets
    pub morph_translations: Vec<Vec3>,
    pub morph_rotations: Vec<Quat>,

    // Appended transforms cached per frame
    pub append_translations: Vec<Vec3>,
    pub append_rotations: Vec<Quat>,

    // IK solved rotation offsets cached per frame
    pub ik_rotations: Vec<Quat>,

    // Outputs
    pub world_matrices: Vec<Mat4>,
    pub world_rotations: Vec<Quat>,
    pub skin_matrices: Vec<Mat4>,

    pub base_materials: Vec<Material>,
    pub material_states: Vec<RuntimeMaterialState>,
}

impl ModelRuntime {
    pub fn new(model: PmxModel) -> Self {
        let num_bones = model.bones.len();
        let num_morphs = model.morphs.len();
        let _num_materials = model.materials.len();

        // 1. Group bones by transform layer and sort by dependency order
        let mut layer_map: BTreeMap<i32, Vec<usize>> = BTreeMap::new();
        for (i, b) in model.bones.iter().enumerate() {
            layer_map.entry(b.transform_layer).or_default().push(i);
        }

        let mut evaluation_order = Vec::new();
        let mut resolved = HashSet::new();

        for (&_layer, bone_indices) in &layer_map {
            let mut layer_indices = bone_indices.clone();
            let mut attempts = 0;
            while !layer_indices.is_empty() && attempts < 1000 {
                attempts += 1;
                let mut progress = false;
                let mut next_indices = Vec::new();
                for idx in layer_indices {
                    let parent = model.bones[idx].parent_index;
                    if parent < 0
                        || resolved.contains(&(parent as usize))
                        || !bone_indices.contains(&(parent as usize))
                    {
                        evaluation_order.push(idx);
                        resolved.insert(idx);
                        progress = true;
                    } else {
                        next_indices.push(idx);
                    }
                }
                layer_indices = next_indices;
                if !progress {
                    for idx in layer_indices {
                        evaluation_order.push(idx);
                        resolved.insert(idx);
                    }
                    break;
                }
            }
        }

        // 2. Topological sort of morphs to evaluate Group/Flip graphs correctly without recursion in evaluate()
        let mut adj = vec![Vec::new(); num_morphs];
        for (i, m) in model.morphs.iter().enumerate() {
            match &m.offsets {
                MorphOffsets::Group(ref offsets) => {
                    for off in offsets {
                        if off.morph_index >= 0 {
                            adj[i].push(off.morph_index as usize);
                        }
                    }
                }
                MorphOffsets::Flip(ref offsets) => {
                    for off in offsets {
                        if off.morph_index >= 0 {
                            adj[i].push(off.morph_index as usize);
                        }
                    }
                }
                _ => {}
            }
        }

        let mut morph_evaluation_order = Vec::new();
        let mut visited = vec![0u8; num_morphs];

        fn dfs(idx: usize, adj: &[Vec<usize>], visited: &mut [u8], order: &mut Vec<usize>) {
            if visited[idx] != 0 {
                return;
            }
            visited[idx] = 1; // Visiting
            for &child in &adj[idx] {
                if child < adj.len() {
                    dfs(child, adj, visited, order);
                }
            }
            visited[idx] = 2; // Visited
            order.push(idx);
        }

        for i in 0..num_morphs {
            if visited[i] == 0 {
                dfs(i, &adj, &mut visited, &mut morph_evaluation_order);
            }
        }
        morph_evaluation_order.reverse();

        let base_materials = model.materials.clone();
        let material_states = base_materials
            .iter()
            .map(|m| RuntimeMaterialState {
                diffuse: m.diffuse,
                specular: m.specular,
                shininess: m.shininess,
                ambient: m.ambient,
                edge_color: m.edge_color,
                edge_size: m.edge_size,
                texture_tint: Vec4::new(1.0, 1.0, 1.0, 1.0),
                sphere_tint: Vec4::new(1.0, 1.0, 1.0, 1.0),
                toon_tint: Vec4::new(1.0, 1.0, 1.0, 1.0),
            })
            .collect();

        Self {
            model,
            evaluation_order,
            morph_evaluation_order,
            input_morph_weights: vec![0.0; num_morphs],
            morph_weights: vec![0.0; num_morphs],
            manual_translations: vec![Vec3::ZERO; num_bones],
            manual_rotations: vec![Quat::IDENTITY; num_bones],
            morph_translations: vec![Vec3::ZERO; num_bones],
            morph_rotations: vec![Quat::IDENTITY; num_bones],
            append_translations: vec![Vec3::ZERO; num_bones],
            append_rotations: vec![Quat::IDENTITY; num_bones],
            ik_rotations: vec![Quat::IDENTITY; num_bones],
            world_matrices: vec![Mat4::IDENTITY; num_bones],
            world_rotations: vec![Quat::IDENTITY; num_bones],
            skin_matrices: vec![Mat4::IDENTITY; num_bones],
            base_materials,
            material_states,
        }
    }

    pub fn set_morph_weight(&mut self, index: usize, weight: f32) {
        if index < self.input_morph_weights.len() {
            self.input_morph_weights[index] = weight;
        }
    }

    pub fn set_bone_pose(&mut self, index: usize, translation: Vec3, rotation: Quat) {
        if index < self.manual_translations.len() {
            self.manual_translations[index] = translation;
            self.manual_rotations[index] = rotation;
        }
    }

    pub fn reset_pose(&mut self) {
        self.input_morph_weights.fill(0.0);
        self.morph_weights.fill(0.0);
        self.manual_translations.fill(Vec3::ZERO);
        self.manual_rotations.fill(Quat::IDENTITY);
        self.morph_translations.fill(Vec3::ZERO);
        self.morph_rotations.fill(Quat::IDENTITY);
        self.append_translations.fill(Vec3::ZERO);
        self.append_rotations.fill(Quat::IDENTITY);
        self.ik_rotations.fill(Quat::IDENTITY);
        self.world_matrices.fill(Mat4::IDENTITY);
        self.world_rotations.fill(Quat::IDENTITY);
        self.skin_matrices.fill(Mat4::IDENTITY);
    }

    pub fn evaluate(&mut self) {
        // 1. Expand Group & Flip morph graphs topological-order propagation
        self.expand_morphs();

        // 2. Accumulate Bone Morphs
        self.morph_translations.fill(Vec3::ZERO);
        self.morph_rotations.fill(Quat::IDENTITY);
        for (morph_idx, &weight) in self.morph_weights.iter().enumerate() {
            if weight <= 0.0 {
                continue;
            }
            let morph = &self.model.morphs[morph_idx];
            if let MorphOffsets::Bone(ref offsets) = morph.offsets {
                for offset in offsets {
                    if offset.bone_index >= 0
                        && (offset.bone_index as usize) < self.model.bones.len()
                    {
                        let b_idx = offset.bone_index as usize;
                        self.morph_translations[b_idx] =
                            self.morph_translations[b_idx].add(offset.translation.scale(weight));
                        let scaled_rot = Quat::IDENTITY.slerp(offset.rotation, weight);
                        self.morph_rotations[b_idx] =
                            self.morph_rotations[b_idx].mul(scaled_rot).normalize();
                    }
                }
            }
        }

        // 3. Transform propagation stage-by-stage (grouped by layer)
        self.append_translations.fill(Vec3::ZERO);
        self.append_rotations.fill(Quat::IDENTITY);
        self.ik_rotations.fill(Quat::IDENTITY);

        let mut layer_map: BTreeMap<i32, Vec<usize>> = BTreeMap::new();
        for &idx in &self.evaluation_order {
            let b = &self.model.bones[idx];
            layer_map.entry(b.transform_layer).or_default().push(idx);
        }

        for (&_layer, bone_indices) in &layer_map {
            // Step A: Calculate initial world matrices for this layer
            for &idx in bone_indices {
                self.update_bone_world_matrix(idx);
            }

            // Step B: Apply append/grant transform constraints in this layer
            let mut recompute_needed = false;
            for &idx in bone_indices {
                let bone = &self.model.bones[idx];
                if let Some(ref inherit) = bone.inherit_rotation {
                    if inherit.parent_index >= 0
                        && (inherit.parent_index as usize) < self.model.bones.len()
                    {
                        let src_idx = inherit.parent_index as usize;
                        let src_local_rot = self.manual_rotations[src_idx]
                            .mul(self.morph_rotations[src_idx])
                            .normalize();
                        let inherited_rot = Quat::IDENTITY.slerp(src_local_rot, inherit.influence);
                        self.append_rotations[idx] = inherited_rot;
                        recompute_needed = true;
                    }
                }
                if let Some(ref inherit) = bone.inherit_translation {
                    if inherit.parent_index >= 0
                        && (inherit.parent_index as usize) < self.model.bones.len()
                    {
                        let src_idx = inherit.parent_index as usize;
                        let src_local_trans =
                            self.manual_translations[src_idx].add(self.morph_translations[src_idx]);
                        let inherited_trans = src_local_trans.scale(inherit.influence);
                        self.append_translations[idx] = inherited_trans;
                        recompute_needed = true;
                    }
                }
            }

            if recompute_needed {
                for &idx in bone_indices {
                    self.update_bone_world_matrix(idx);
                }
            }

            // Step C: Solve IK chains inside this layer
            for &idx in bone_indices {
                let ik_opt = self.model.bones[idx].ik.clone();
                if let Some(ref ik) = ik_opt {
                    self.solve_ccd_ik(idx, ik);
                }
            }
        }

        // 4. Calculate final skin matrices
        for idx in 0..self.model.bones.len() {
            let bone_pos = self.model.bones[idx].position;
            self.skin_matrices[idx] =
                self.world_matrices[idx].mul(Mat4::from_translation(bone_pos.scale(-1.0)));
        }

        // 5. Evaluate Material Morphs
        self.evaluate_material_morphs();
    }

    pub fn get_skin_matrices(&self) -> &[Mat4] {
        &self.skin_matrices
    }

    pub fn get_material_states(&self) -> Vec<f32> {
        let mut buffer = Vec::with_capacity(self.material_states.len() * 28);
        for (i, m) in self.material_states.iter().enumerate() {
            buffer.push(m.diffuse.x);
            buffer.push(m.diffuse.y);
            buffer.push(m.diffuse.z);
            buffer.push(m.diffuse.w);

            buffer.push(m.ambient.x);
            buffer.push(m.ambient.y);
            buffer.push(m.ambient.z);
            buffer.push(m.shininess);

            buffer.push(m.specular.x);
            buffer.push(m.specular.y);
            buffer.push(m.specular.z);
            buffer.push(0.0);

            buffer.push(m.edge_color.x);
            buffer.push(m.edge_color.y);
            buffer.push(m.edge_color.z);
            buffer.push(m.edge_color.w);

            buffer.push(m.edge_size);
            buffer.push(0.0);
            buffer.push(0.0);
            buffer.push(0.0);

            let base = &self.base_materials[i];

            let base_tex_idx = base.texture_index;
            let sphere_tex_idx = base.sphere_texture_index;
            let toon_tex_idx = base.toon_texture_index;
            buffer.push(f32::from_bits(base_tex_idx as u32));
            buffer.push(f32::from_bits(sphere_tex_idx as u32));
            buffer.push(f32::from_bits(toon_tex_idx as u32));
            buffer.push(0.0);

            buffer.push(f32::from_bits(base.flags as u32));
            buffer.push(f32::from_bits(base.sphere_mode as u32));
            buffer.push(f32::from_bits(base.toon_mode as u32));
            buffer.push(0.0);
        }
        buffer
    }

    fn update_bone_world_matrix(&mut self, idx: usize) {
        let bone = &self.model.bones[idx];
        let p_idx = bone.parent_index;

        let t_local = self.manual_translations[idx]
            .add(self.morph_translations[idx])
            .add(self.append_translations[idx]);

        let r_local = self.manual_rotations[idx]
            .mul(self.morph_rotations[idx])
            .mul(self.append_rotations[idx])
            .mul(self.ik_rotations[idx])
            .normalize();

        if p_idx >= 0 && (p_idx as usize) < self.model.bones.len() {
            let parent_idx = p_idx as usize;
            let parent_world = &self.world_matrices[parent_idx];
            let parent_world_rot = self.world_rotations[parent_idx];

            let offset = bone.position.sub(self.model.bones[parent_idx].position);
            self.world_rotations[idx] = parent_world_rot.mul(r_local).normalize();

            let trans = offset.add(t_local);
            let local_matrix = Mat4::from_rotation_translation(r_local, trans);
            self.world_matrices[idx] = parent_world.mul(local_matrix);
        } else {
            self.world_rotations[idx] = r_local;
            self.world_matrices[idx] =
                Mat4::from_rotation_translation(r_local, bone.position.add(t_local));
        }
    }

    fn expand_morphs(&mut self) {
        self.morph_weights
            .copy_from_slice(&self.input_morph_weights);
        for &i in &self.morph_evaluation_order {
            let w = self.morph_weights[i];
            if w == 0.0 {
                continue;
            }
            let offsets = &self.model.morphs[i].offsets;
            match offsets {
                MorphOffsets::Group(ref group_offsets) => {
                    for off in group_offsets {
                        if off.morph_index >= 0
                            && (off.morph_index as usize) < self.morph_weights.len()
                        {
                            self.morph_weights[off.morph_index as usize] += w * off.influence;
                        }
                    }
                }
                MorphOffsets::Flip(ref flip_offsets) => {
                    for off in flip_offsets {
                        if off.morph_index >= 0
                            && (off.morph_index as usize) < self.morph_weights.len()
                        {
                            self.morph_weights[off.morph_index as usize] += w * off.influence;
                        }
                    }
                }
                _ => {}
            }
        }
    }

    fn solve_ccd_ik(&mut self, ik_bone_idx: usize, ik: &Ik) {
        let effector_idx = ik.target_index as usize;

        for _iter in 0..ik.loop_count {
            let mut effector_pos = self.world_matrices[effector_idx].transform_point(Vec3::ZERO);
            let mut target_pos = self.world_matrices[ik_bone_idx].transform_point(Vec3::ZERO);

            let dist = target_pos.sub(effector_pos).length();
            if dist < 1e-4 {
                break;
            }

            for link in &ik.links {
                if link.bone_index < 0 || (link.bone_index as usize) >= self.model.bones.len() {
                    continue;
                }
                let link_idx = link.bone_index as usize;
                if link_idx == effector_idx {
                    continue;
                }

                effector_pos = self.world_matrices[effector_idx].transform_point(Vec3::ZERO);
                target_pos = self.world_matrices[ik_bone_idx].transform_point(Vec3::ZERO);

                let link_pos = self.world_matrices[link_idx].transform_point(Vec3::ZERO);

                let link_to_effector = effector_pos.sub(link_pos);
                let link_to_target = target_pos.sub(link_pos);

                let len_eff = link_to_effector.length();
                let len_tar = link_to_target.length();

                if len_eff < 1e-4 || len_tar < 1e-4 {
                    continue;
                }

                let inv_world_rot = self.world_rotations[link_idx].inverse();
                let local_effector = inv_world_rot.mul_vec3(link_to_effector).normalize();
                let local_target = inv_world_rot.mul_vec3(link_to_target).normalize();

                let dot = local_effector.dot(local_target).clamp(-1.0, 1.0);
                let mut angle = dot.acos();
                if angle < 1e-5 {
                    continue;
                }

                angle = angle.clamp(-ik.limit_angle, ik.limit_angle);

                let mut axis = local_effector.cross(local_target).normalize();
                if axis.length_squared() < 1e-5 {
                    continue;
                }

                let rot_local = if let Some(ref limit) = link.limit {
                    let is_x_only = limit.min.y.abs() < 1e-4
                        && limit.max.y.abs() < 1e-4
                        && limit.min.z.abs() < 1e-4
                        && limit.max.z.abs() < 1e-4;

                    if is_x_only {
                        axis = Vec3::new(1.0, 0.0, 0.0);
                        let proj_eff =
                            Vec3::new(0.0, local_effector.y, local_effector.z).normalize();
                        let proj_tar = Vec3::new(0.0, local_target.y, local_target.z).normalize();
                        let d = proj_eff.dot(proj_tar).clamp(-1.0, 1.0);
                        let mut a = d.acos();
                        let cross_x = proj_eff.cross(proj_tar).x;
                        if cross_x < 0.0 {
                            a = -a;
                        }
                        a = a.clamp(-ik.limit_angle, ik.limit_angle);

                        let current_rot = self.manual_rotations[link_idx]
                            .mul(self.morph_rotations[link_idx])
                            .mul(self.append_rotations[link_idx])
                            .mul(self.ik_rotations[link_idx])
                            .normalize();

                        let current_euler = current_rot.to_euler_xyz();
                        let mut next_x = current_euler.x + a;
                        next_x = next_x.clamp(limit.min.x, limit.max.x);
                        let delta_x = next_x - current_euler.x;

                        Quat::from_axis_angle(axis, delta_x)
                    } else {
                        let step_rot = Quat::from_axis_angle(axis, angle);
                        let current_rot = self.manual_rotations[link_idx]
                            .mul(self.morph_rotations[link_idx])
                            .mul(self.append_rotations[link_idx])
                            .mul(self.ik_rotations[link_idx])
                            .normalize();

                        let next_rot = step_rot.mul(current_rot).normalize();
                        let mut next_euler = next_rot.to_euler_xyz();
                        next_euler.x = next_euler.x.clamp(limit.min.x, limit.max.x);
                        next_euler.y = next_euler.y.clamp(limit.min.y, limit.max.y);
                        next_euler.z = next_euler.z.clamp(limit.min.z, limit.max.z);

                        let clamped_rot =
                            Quat::from_euler_xyz(next_euler.x, next_euler.y, next_euler.z);
                        clamped_rot
                            .mul(current_rot.normalize().inverse())
                            .normalize()
                    }
                } else {
                    Quat::from_axis_angle(axis, angle)
                };

                self.ik_rotations[link_idx] =
                    self.ik_rotations[link_idx].mul(rot_local).normalize();
                self.update_hierarchy_matrices(link_idx);
            }
        }
    }

    fn update_hierarchy_matrices(&mut self, start_idx: usize) {
        if let Some(pos) = self.evaluation_order.iter().position(|&x| x == start_idx) {
            for idx in pos..self.evaluation_order.len() {
                let bone_idx = self.evaluation_order[idx];
                if bone_idx == start_idx || self.is_descendant_of(bone_idx, start_idx) {
                    self.update_bone_world_matrix(bone_idx);
                }
            }
        }
    }

    fn is_descendant_of(&self, bone_idx: usize, ancestor_idx: usize) -> bool {
        let mut curr = self.model.bones[bone_idx].parent_index;
        while curr >= 0 {
            if curr as usize == ancestor_idx {
                return true;
            }
            curr = self.model.bones[curr as usize].parent_index;
        }
        false
    }

    fn evaluate_material_morphs(&mut self) {
        for (i, base) in self.base_materials.iter().enumerate() {
            self.material_states[i] = RuntimeMaterialState {
                diffuse: base.diffuse,
                specular: base.specular,
                shininess: base.shininess,
                ambient: base.ambient,
                edge_color: base.edge_color,
                edge_size: base.edge_size,
                texture_tint: Vec4::new(1.0, 1.0, 1.0, 1.0),
                sphere_tint: Vec4::new(1.0, 1.0, 1.0, 1.0),
                toon_tint: Vec4::new(1.0, 1.0, 1.0, 1.0),
            };
        }

        for (morph_idx, &weight) in self.morph_weights.iter().enumerate() {
            if weight <= 0.0 {
                continue;
            }
            let morph = &self.model.morphs[morph_idx];
            if let MorphOffsets::Material(ref offsets) = morph.offsets {
                for offset in offsets {
                    let apply_to = |state: &mut RuntimeMaterialState,
                                    off: &MaterialMorphOffset,
                                    w: f32| {
                        if off.operation == 0 {
                            let mult_diff = Vec4::new(
                                1.0 + (off.diffuse.x - 1.0) * w,
                                1.0 + (off.diffuse.y - 1.0) * w,
                                1.0 + (off.diffuse.z - 1.0) * w,
                                1.0 + (off.diffuse.w - 1.0) * w,
                            );
                            state.diffuse = Vec4::new(
                                state.diffuse.x * mult_diff.x,
                                state.diffuse.y * mult_diff.y,
                                state.diffuse.z * mult_diff.z,
                                state.diffuse.w * mult_diff.w,
                            );

                            let mult_spec = Vec3::new(
                                1.0 + (off.specular.x - 1.0) * w,
                                1.0 + (off.specular.y - 1.0) * w,
                                1.0 + (off.specular.z - 1.0) * w,
                            );
                            state.specular = Vec3::new(
                                state.specular.x * mult_spec.x,
                                state.specular.y * mult_spec.y,
                                state.specular.z * mult_spec.z,
                            );

                            state.shininess *= 1.0 + (off.shininess - 1.0) * w;

                            let mult_amb = Vec3::new(
                                1.0 + (off.ambient.x - 1.0) * w,
                                1.0 + (off.ambient.y - 1.0) * w,
                                1.0 + (off.ambient.z - 1.0) * w,
                            );
                            state.ambient = Vec3::new(
                                state.ambient.x * mult_amb.x,
                                state.ambient.y * mult_amb.y,
                                state.ambient.z * mult_amb.z,
                            );

                            let mult_edge = Vec4::new(
                                1.0 + (off.edge_color.x - 1.0) * w,
                                1.0 + (off.edge_color.y - 1.0) * w,
                                1.0 + (off.edge_color.z - 1.0) * w,
                                1.0 + (off.edge_color.w - 1.0) * w,
                            );
                            state.edge_color = Vec4::new(
                                state.edge_color.x * mult_edge.x,
                                state.edge_color.y * mult_edge.y,
                                state.edge_color.z * mult_edge.z,
                                state.edge_color.w * mult_edge.w,
                            );

                            state.edge_size *= 1.0 + (off.edge_size - 1.0) * w;

                            let mult_tex = Vec4::new(
                                1.0 + (off.texture_tint.x - 1.0) * w,
                                1.0 + (off.texture_tint.y - 1.0) * w,
                                1.0 + (off.texture_tint.z - 1.0) * w,
                                1.0 + (off.texture_tint.w - 1.0) * w,
                            );
                            state.texture_tint = Vec4::new(
                                state.texture_tint.x * mult_tex.x,
                                state.texture_tint.y * mult_tex.y,
                                state.texture_tint.z * mult_tex.z,
                                state.texture_tint.w * mult_tex.w,
                            );

                            let mult_sph = Vec4::new(
                                1.0 + (off.sphere_tint.x - 1.0) * w,
                                1.0 + (off.sphere_tint.y - 1.0) * w,
                                1.0 + (off.sphere_tint.z - 1.0) * w,
                                1.0 + (off.sphere_tint.w - 1.0) * w,
                            );
                            state.sphere_tint = Vec4::new(
                                state.sphere_tint.x * mult_sph.x,
                                state.sphere_tint.y * mult_sph.y,
                                state.sphere_tint.z * mult_sph.z,
                                state.sphere_tint.w * mult_sph.w,
                            );

                            let mult_toon = Vec4::new(
                                1.0 + (off.toon_tint.x - 1.0) * w,
                                1.0 + (off.toon_tint.y - 1.0) * w,
                                1.0 + (off.toon_tint.z - 1.0) * w,
                                1.0 + (off.toon_tint.w - 1.0) * w,
                            );
                            state.toon_tint = Vec4::new(
                                state.toon_tint.x * mult_toon.x,
                                state.toon_tint.y * mult_toon.y,
                                state.toon_tint.z * mult_toon.z,
                                state.toon_tint.w * mult_toon.w,
                            );
                        } else {
                            state.diffuse = state.diffuse.add(off.diffuse.scale(w));
                            state.specular = state.specular.add(off.specular.scale(w));
                            state.shininess += off.shininess * w;
                            state.ambient = state.ambient.add(off.ambient.scale(w));
                            state.edge_color = state.edge_color.add(off.edge_color.scale(w));
                            state.edge_size += off.edge_size * w;
                            state.texture_tint = state.texture_tint.add(off.texture_tint.scale(w));
                            state.sphere_tint = state.sphere_tint.add(off.sphere_tint.scale(w));
                            state.toon_tint = state.toon_tint.add(off.toon_tint.scale(w));
                        }
                    };

                    if offset.material_index < 0 {
                        for state in &mut self.material_states {
                            apply_to(state, offset, weight);
                        }
                    } else if (offset.material_index as usize) < self.material_states.len() {
                        let m_idx = offset.material_index as usize;
                        apply_to(&mut self.material_states[m_idx], offset, weight);
                    }
                }
            }
        }

        for state in &mut self.material_states {
            state.diffuse.x = state.diffuse.x.clamp(0.0, 1.0);
            state.diffuse.y = state.diffuse.y.clamp(0.0, 1.0);
            state.diffuse.z = state.diffuse.z.clamp(0.0, 1.0);
            state.diffuse.w = state.diffuse.w.clamp(0.0, 1.0);

            state.specular.x = state.specular.x.clamp(0.0, 1.0);
            state.specular.y = state.specular.y.clamp(0.0, 1.0);
            state.specular.z = state.specular.z.clamp(0.0, 1.0);

            state.ambient.x = state.ambient.x.clamp(0.0, 1.0);
            state.ambient.y = state.ambient.y.clamp(0.0, 1.0);
            state.ambient.z = state.ambient.z.clamp(0.0, 1.0);

            state.edge_color.x = state.edge_color.x.clamp(0.0, 1.0);
            state.edge_color.y = state.edge_color.y.clamp(0.0, 1.0);
            state.edge_color.z = state.edge_color.z.clamp(0.0, 1.0);
            state.edge_color.w = state.edge_color.w.clamp(0.0, 1.0);

            state.edge_size = state.edge_size.max(0.0);
        }
    }
}
