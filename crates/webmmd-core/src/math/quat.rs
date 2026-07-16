// SPDX-License-Identifier: AGPL-3.0-or-later

use super::vec3::Vec3;

#[derive(Debug, Default, Copy, Clone, PartialEq)]
pub struct Quat {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub w: f32,
}

impl Quat {
    pub const IDENTITY: Self = Self {
        x: 0.0,
        y: 0.0,
        z: 0.0,
        w: 1.0,
    };

    pub fn new(x: f32, y: f32, z: f32, w: f32) -> Self {
        Self { x, y, z, w }
    }

    pub fn dot(self, other: Self) -> f32 {
        self.x * other.x + self.y * other.y + self.z * other.z + self.w * other.w
    }

    pub fn length_squared(self) -> f32 {
        self.dot(self)
    }

    pub fn length(self) -> f32 {
        self.length_squared().sqrt()
    }

    pub fn normalize(self) -> Self {
        let len = self.length();
        if len > 0.0 {
            Self {
                x: self.x / len,
                y: self.y / len,
                z: self.z / len,
                w: self.w / len,
            }
        } else {
            Self::IDENTITY
        }
    }

    pub fn mul(self, other: Self) -> Self {
        Self {
            x: self.w * other.x + self.x * other.w + self.y * other.z - self.z * other.y,
            y: self.w * other.y - self.x * other.z + self.y * other.w + self.z * other.x,
            z: self.w * other.z + self.x * other.y - self.y * other.x + self.z * other.w,
            w: self.w * other.w - self.x * other.x - self.y * other.y - self.z * other.z,
        }
    }

    pub fn mul_vec3(self, v: Vec3) -> Vec3 {
        let q_vec = Vec3::new(self.x, self.y, self.z);
        let uv = q_vec.cross(v);
        let uuv = q_vec.cross(uv);
        v.add(uv.scale(2.0 * self.w)).add(uuv.scale(2.0))
    }

    pub fn from_axis_angle(axis: Vec3, angle: f32) -> Self {
        let half_angle = angle * 0.5;
        let s = half_angle.sin();
        let c = half_angle.cos();
        let axis_n = axis.normalize();
        Self {
            x: axis_n.x * s,
            y: axis_n.y * s,
            z: axis_n.z * s,
            w: c,
        }
    }

    pub fn from_euler(x: f32, y: f32, z: f32) -> Self {
        // ZYX rotation order is typical for 3D orientation
        let cx = (x * 0.5).cos();
        let sx = (x * 0.5).sin();
        let cy = (y * 0.5).cos();
        let sy = (y * 0.5).sin();
        let cz = (z * 0.5).cos();
        let sz = (z * 0.5).sin();

        Self {
            x: sx * cy * cz - cx * sy * sz,
            y: cx * sy * cz + sx * cy * sz,
            z: cx * cy * sz - sx * sy * cz,
            w: cx * cy * cz + sx * sy * sz,
        }
    }

    pub fn slerp(self, mut other: Self, t: f32) -> Self {
        let mut dot = self.dot(other);

        if dot < 0.0 {
            other = Self {
                x: -other.x,
                y: -other.y,
                z: -other.z,
                w: -other.w,
            };
            dot = -dot;
        }

        if dot > 0.9995 {
            // Linear interpolation fallback
            return Self {
                x: self.x + (other.x - self.x) * t,
                y: self.y + (other.y - self.y) * t,
                z: self.z + (other.z - self.z) * t,
                w: self.w + (other.w - self.w) * t,
            }
            .normalize();
        }

        let theta_0 = dot.acos();
        let theta = theta_0 * t;
        let sin_theta = theta.sin();
        let sin_theta_0 = theta_0.sin();

        let s0 = (theta_0 - theta).sin() / sin_theta_0;
        let s1 = sin_theta / sin_theta_0;

        Self {
            x: s0 * self.x + s1 * other.x,
            y: s0 * self.y + s1 * other.y,
            z: s0 * self.z + s1 * other.z,
            w: s0 * self.w + s1 * other.w,
        }
    }
}
