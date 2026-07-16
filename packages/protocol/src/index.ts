// SPDX-License-Identifier: GPL-3.0-or-later

export interface WebMmdDiagnostic {
  severity: "error" | "warning";
  code: string;
  section: string;
  byteOffset?: number;
  itemIndex?: number;
  message: string;
}

export interface WasmMaterialMeta {
  nameLocal: string;
  nameUniversal: string;
  surfaceCount: number;
}

export interface WasmBoneMeta {
  nameLocal: string;
  nameUniversal: string;
  parentIndex: number;
  transformLayer: number;
  flags: number;
}

export interface WasmMorphMeta {
  nameLocal: string;
  nameUniversal: string;
  panel: number;
  morphType: number;
}

export interface WasmRigidBodyMeta {
  nameLocal: string;
  nameUniversal: string;
  boneIndex: number;
  group: number;
}

export interface WasmJointMeta {
  nameLocal: string;
  nameUniversal: string;
  jointType: number;
  bodyAIndex: number;
  bodyBIndex: number;
}

export interface WasmSoftBodyMeta {
  nameLocal: string;
  nameUniversal: string;
  materialIndex: number;
}

export interface PackedMorphMeta {
  morphIndex: number;
  nameLocal: string;
  nameUniversal: string;
  offsetStart: number;
  offsetCount: number;
}

export interface WasmModelMetadata {
  version: number;
  nameLocal: string;
  nameUniversal: string;
  commentsLocal: string;
  commentsUniversal: string;
  textures: string[];
  materials: WasmMaterialMeta[];
  bones: WasmBoneMeta[];
  morphs: WasmMorphMeta[];
  rigidBodies: WasmRigidBodyMeta[];
  joints: WasmJointMeta[];
  softBodies: WasmSoftBodyMeta[];
  diagnostics: WebMmdDiagnostic[];
  vertexMorphMeta: PackedMorphMeta[];
  uvMorphMeta: PackedMorphMeta[];
}

export type ParserRequest =
  { type: "LOAD_PMX"; fileData: ArrayBuffer } | { type: "CANCEL" };

export type ParserResponse =
  | {
      type: "LOAD_PMX_SUCCESS";
      metadata: WasmModelMetadata;
      vertices: ArrayBuffer;
      indices: ArrayBuffer;
      materials: ArrayBuffer;
      vertexMorphOffsets: ArrayBuffer;
      uvMorphOffsets: ArrayBuffer;
    }
  | { type: "LOAD_PMX_ERROR"; message: string }
  | { type: "CANCELLED" };
