// SPDX-License-Identifier: AGPL-3.0-or-later

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
  ikTargetIndex?: number;
  ikLinkIndices?: number[];
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

export interface WasmModelBounds {
  min: [number, number, number];
  max: [number, number, number];
  center: [number, number, number];
  boundingSphereRadius: number;
  height: number;
  recommendedCameraTarget: [number, number, number];
  recommendedCameraDistance: number;
  nearPlane: number;
  farPlane: number;
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
  additionalUvCount: number;
  bounds: WasmModelBounds;
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
      additionalUvs: ArrayBuffer;
    }
  | { type: "LOAD_PMX_ERROR"; message: string }
  | { type: "CANCELLED" };

export interface WebMmdTestState {
  applicationReady: boolean;
  webGpuReady: boolean;
  wasmReady: boolean;
  parserReady: boolean;
  modelParsed: boolean;
  modelValidated: boolean;
  gpuUploadComplete: boolean;
  firstFrameSubmitted: boolean;
  firstFrameCompleted: boolean;
  modelName: string | null;
  vertexCount: number;
  materialCount: number;
  boneCount: number;
  activeMorphCount: number;
  uncapturedGpuErrors: string[];
  applicationErrors: string[];
}
