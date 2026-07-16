// SPDX-License-Identifier: GPL-3.0-or-later

use super::types::*;
use crate::math::{Quat, Vec3, Vec4};

#[derive(Debug, Clone)]
pub enum PmxParseError {
    UnexpectedEof,
    InvalidSignature,
    UnsupportedVersion(f32),
    InvalidGlobalsCount(u8),
    InvalidGlobalValue { index: usize, value: u8 },
    InvalidStringEncoding,
    InvalidDeformType(u8),
    NegativeCount(String),
    Overflow(String),
}

impl std::fmt::Display for PmxParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnexpectedEof => write!(f, "Unexpected end of file"),
            Self::InvalidSignature => write!(f, "Invalid PMX file signature"),
            Self::UnsupportedVersion(v) => write!(f, "Unsupported PMX version: {}", v),
            Self::InvalidGlobalsCount(c) => write!(f, "Invalid PMX globals count: {}", c),
            Self::InvalidGlobalValue { index, value } => {
                write!(f, "Invalid PMX global value at index {}: {}", index, value)
            }
            Self::InvalidStringEncoding => write!(f, "Failed to decode PMX string"),
            Self::InvalidDeformType(t) => write!(f, "Invalid vertex deform type: {}", t),
            Self::NegativeCount(s) => write!(f, "Negative count encountered: {}", s),
            Self::Overflow(s) => write!(f, "Integer overflow encountered: {}", s),
        }
    }
}

impl std::error::Error for PmxParseError {}

pub struct PmxReader<'a> {
    data: &'a [u8],
    cursor: usize,
}

impl<'a> PmxReader<'a> {
    pub fn new(data: &'a [u8]) -> Self {
        Self { data, cursor: 0 }
    }

    pub fn byte_offset(&self) -> usize {
        self.cursor
    }

    pub fn is_eof(&self) -> bool {
        self.cursor >= self.data.len()
    }

    fn check_bounds(&self, size: usize) -> Result<(), PmxParseError> {
        if self.cursor + size > self.data.len() {
            Err(PmxParseError::UnexpectedEof)
        } else {
            Ok(())
        }
    }

    pub fn read_u8(&mut self) -> Result<u8, PmxParseError> {
        self.check_bounds(1)?;
        let val = self.data[self.cursor];
        self.cursor += 1;
        Ok(val)
    }

    pub fn read_i8(&mut self) -> Result<i8, PmxParseError> {
        Ok(self.read_u8()? as i8)
    }

    pub fn read_bytes(&mut self, len: usize) -> Result<&'a [u8], PmxParseError> {
        self.check_bounds(len)?;
        let slice = &self.data[self.cursor..self.cursor + len];
        self.cursor += len;
        Ok(slice)
    }

    pub fn read_u16(&mut self) -> Result<u16, PmxParseError> {
        self.check_bounds(2)?;
        let slice = &self.data[self.cursor..self.cursor + 2];
        let val = u16::from_le_bytes([slice[0], slice[1]]);
        self.cursor += 2;
        Ok(val)
    }

    pub fn read_i16(&mut self) -> Result<i16, PmxParseError> {
        Ok(self.read_u16()? as i16)
    }

    pub fn read_u32(&mut self) -> Result<u32, PmxParseError> {
        self.check_bounds(4)?;
        let slice = &self.data[self.cursor..self.cursor + 4];
        let val = u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]);
        self.cursor += 4;
        Ok(val)
    }

    pub fn read_i32(&mut self) -> Result<i32, PmxParseError> {
        Ok(self.read_u32()? as i32)
    }

    pub fn read_f32(&mut self) -> Result<f32, PmxParseError> {
        self.check_bounds(4)?;
        let slice = &self.data[self.cursor..self.cursor + 4];
        let val = f32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]);
        self.cursor += 4;
        Ok(val)
    }

    pub fn read_vec2(&mut self) -> Result<Vec2, PmxParseError> {
        let x = self.read_f32()?;
        let y = self.read_f32()?;
        Ok(Vec2::new(x, y))
    }

    pub fn read_vec3(&mut self) -> Result<Vec3, PmxParseError> {
        let x = self.read_f32()?;
        let y = self.read_f32()?;
        let z = self.read_f32()?;
        Ok(Vec3::new(x, y, z))
    }

    pub fn read_vec4(&mut self) -> Result<Vec4, PmxParseError> {
        let x = self.read_f32()?;
        let y = self.read_f32()?;
        let z = self.read_f32()?;
        let w = self.read_f32()?;
        Ok(Vec4::new(x, y, z, w))
    }

    pub fn read_quat(&mut self) -> Result<Quat, PmxParseError> {
        let x = self.read_f32()?;
        let y = self.read_f32()?;
        let z = self.read_f32()?;
        let w = self.read_f32()?;
        Ok(Quat::new(x, y, z, w))
    }

    pub fn read_string(&mut self, encoding: u8) -> Result<String, PmxParseError> {
        let len = self.read_i32()?;
        if len < 0 {
            return Err(PmxParseError::NegativeCount("string length".to_string()));
        }
        if len == 0 {
            return Ok(String::new());
        }
        let bytes = self.read_bytes(len as usize)?;

        if encoding == 1 {
            // UTF-8
            String::from_utf8(bytes.to_vec()).map_err(|_| PmxParseError::InvalidStringEncoding)
        } else {
            // UTF-16LE
            if bytes.len() % 2 != 0 {
                return Err(PmxParseError::InvalidStringEncoding);
            }
            let u16_chars: Vec<u16> = bytes
                .chunks_exact(2)
                .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
                .collect();
            String::from_utf16(&u16_chars).map_err(|_| PmxParseError::InvalidStringEncoding)
        }
    }

    pub fn read_index(&mut self, size: u8, signed: bool) -> Result<i32, PmxParseError> {
        match size {
            1 => {
                if signed {
                    Ok(self.read_i8()? as i32)
                } else {
                    Ok(self.read_u8()? as i32)
                }
            }
            2 => {
                if signed {
                    Ok(self.read_i16()? as i32)
                } else {
                    Ok(self.read_u16()? as i32)
                }
            }
            4 => Ok(self.read_i32()?),
            _ => Err(PmxParseError::InvalidGlobalValue {
                index: 99, // Unknown index size error
                value: size,
            }),
        }
    }
}
