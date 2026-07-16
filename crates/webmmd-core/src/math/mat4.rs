// SPDX-License-Identifier: AGPL-3.0-or-later

use super::quat::Quat;
use super::vec3::Vec3;

#[derive(Debug, Copy, Clone, PartialEq)]
pub struct Mat4 {
    // Column-major elements
    pub m: [f32; 16],
}

impl Default for Mat4 {
    fn default() -> Self {
        Self::IDENTITY
    }
}

impl Mat4 {
    pub const IDENTITY: Self = Self {
        m: [
            1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
        ],
    };

    pub fn new(m: [f32; 16]) -> Self {
        Self { m }
    }

    pub fn from_translation(t: Vec3) -> Self {
        Self {
            m: [
                1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, t.x, t.y, t.z, 1.0,
            ],
        }
    }

    pub fn from_scale(s: Vec3) -> Self {
        Self {
            m: [
                s.x, 0.0, 0.0, 0.0, 0.0, s.y, 0.0, 0.0, 0.0, 0.0, s.z, 0.0, 0.0, 0.0, 0.0, 1.0,
            ],
        }
    }

    pub fn from_quat(q: Quat) -> Self {
        let xx = q.x * q.x;
        let xy = q.x * q.y;
        let xz = q.x * q.z;
        let xw = q.x * q.w;
        let yy = q.y * q.y;
        let yz = q.y * q.z;
        let yw = q.y * q.w;
        let zz = q.z * q.z;
        let zw = q.z * q.w;

        Self {
            m: [
                1.0 - 2.0 * (yy + zz),
                2.0 * (xy + zw),
                2.0 * (xz - yw),
                0.0,
                2.0 * (xy - zw),
                1.0 - 2.0 * (xx + zz),
                2.0 * (yz + xw),
                0.0,
                2.0 * (xz + yw),
                2.0 * (yz - xw),
                1.0 - 2.0 * (xx + yy),
                0.0,
                0.0,
                0.0,
                0.0,
                1.0,
            ],
        }
    }

    pub fn from_rotation_translation(q: Quat, t: Vec3) -> Self {
        let xx = q.x * q.x;
        let xy = q.x * q.y;
        let xz = q.x * q.z;
        let xw = q.x * q.w;
        let yy = q.y * q.y;
        let yz = q.y * q.z;
        let yw = q.y * q.w;
        let zz = q.z * q.z;
        let zw = q.z * q.w;

        Self {
            m: [
                1.0 - 2.0 * (yy + zz),
                2.0 * (xy + zw),
                2.0 * (xz - yw),
                0.0,
                2.0 * (xy - zw),
                1.0 - 2.0 * (xx + zz),
                2.0 * (yz + xw),
                0.0,
                2.0 * (xz + yw),
                2.0 * (yz - xw),
                1.0 - 2.0 * (xx + yy),
                0.0,
                t.x,
                t.y,
                t.z,
                1.0,
            ],
        }
    }

    pub fn mul(self, other: Self) -> Self {
        let mut out = [0.0; 16];
        for col in 0..4 {
            for row in 0..4 {
                let mut sum = 0.0;
                for i in 0..4 {
                    sum += self.m[row + i * 4] * other.m[i + col * 4];
                }
                out[row + col * 4] = sum;
            }
        }
        Self { m: out }
    }

    pub fn transform_point(self, p: Vec3) -> Vec3 {
        Vec3 {
            x: self.m[0] * p.x + self.m[4] * p.y + self.m[8] * p.z + self.m[12],
            y: self.m[1] * p.x + self.m[5] * p.y + self.m[9] * p.z + self.m[13],
            z: self.m[2] * p.x + self.m[6] * p.y + self.m[10] * p.z + self.m[14],
        }
    }

    pub fn transform_direction(self, d: Vec3) -> Vec3 {
        Vec3 {
            x: self.m[0] * d.x + self.m[4] * d.y + self.m[8] * d.z,
            y: self.m[1] * d.x + self.m[5] * d.y + self.m[9] * d.z,
            z: self.m[2] * d.x + self.m[6] * d.y + self.m[10] * d.z,
        }
    }

    pub fn inverse(self) -> Option<Self> {
        let m = self.m;
        let mut inv = [0.0; 16];

        // Let's compute a general 4x4 matrix determinant and inverse
        let b00 = m[0] * m[5] - m[1] * m[4];
        let b01 = m[0] * m[6] - m[2] * m[4];
        let b02 = m[0] * m[7] - m[3] * m[4];
        let b03 = m[1] * m[6] - m[2] * m[5];
        let b04 = m[1] * m[7] - m[3] * m[5];
        let b05 = m[2] * m[7] - m[3] * m[6];
        let b06 = m[8] * m[13] - m[9] * m[12];
        let b07 = m[8] * m[14] - m[10] * m[12];
        let b08 = m[8] * m[15] - m[11] * m[12];
        let b09 = m[9] * m[14] - m[10] * m[13];
        let b10 = m[9] * m[15] - m[11] * m[13];
        let b11 = m[10] * m[15] - m[11] * m[14];

        let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;

        if det.abs() < 1e-8 {
            return None;
        }

        let inv_det = 1.0 / det;

        inv[0] = (m[5] * b11 - m[6] * b10 + m[7] * b09) * inv_det;
        inv[1] = (m[2] * b10 - m[1] * b11 - m[3] * b09) * inv_det;
        inv[2] = (m[13] * b05 - m[14] * b04 + m[15] * b03) * inv_det;
        inv[3] = (m[10] * b04 - m[9] * b05 - m[11] * b03) * inv_det;

        inv[4] = (m[6] * b08 - m[4] * b11 - m[7] * b07) * inv_det;
        inv[5] = (m[0] * b11 - m[2] * b08 + m[3] * b07) * inv_det;
        inv[6] = (m[14] * b02 - m[12] * b05 - m[15] * b01) * inv_det;
        inv[7] = (m[8] * b05 - m[10] * b02 + m[11] * b01) * inv_det;

        inv[8] = (m[4] * b10 - m[5] * b08 + m[7] * b06) * inv_det;
        inv[9] = (m[1] * b08 - m[0] * b10 - m[3] * b06) * inv_det;
        inv[10] = (m[12] * b04 - m[13] * b02 + m[15] * b00) * inv_det;
        inv[11] = (m[9] * b02 - m[8] * b04 - m[11] * b00) * inv_det;

        inv[12] = (m[5] * b07 - m[4] * b09 - m[6] * b06) * inv_det;
        inv[13] = (m[0] * b09 - m[1] * b07 + m[2] * b06) * inv_det;
        inv[14] = (m[13] * b01 - m[12] * b03 - m[14] * b00) * inv_det;
        inv[15] = (m[8] * b03 - m[9] * b01 + m[10] * b00) * inv_det;

        Some(Self { m: inv })
    }
}
