// SPDX-License-Identifier: GPL-3.0-or-later

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
