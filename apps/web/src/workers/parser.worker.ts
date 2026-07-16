// SPDX-License-Identifier: GPL-3.0-or-later

import init, { parse_and_pack_pmx } from "../wasm/webmmd_wasm.js";
import type { ParserRequest, WasmModelMetadata } from "@webmmd/protocol";

let wasmInitialized = false;

async function ensureWasm() {
  if (!wasmInitialized) {
    // Initialize WASM binary
    await init();
    wasmInitialized = true;
  }
}

self.onmessage = async (e: MessageEvent<ParserRequest>) => {
  const request = e.data;

  if (request.type === "LOAD_PMX") {
    try {
      await ensureWasm();

      // Wrap the incoming ArrayBuffer in a Uint8Array for WASM
      const dataView = new Uint8Array(request.fileData);
      const packedModel = parse_and_pack_pmx(dataView);

      // Extract array buffers and free wasm model memory
      const vertices = packedModel.vertices;
      const indices = packedModel.indices;
      const materials = packedModel.materials;
      const vertexMorphOffsets = packedModel.vertex_morph_offsets;
      const uvMorphOffsets = packedModel.uv_morph_offsets;
      const metadataJson = packedModel.metadata_json;

      packedModel.free();

      const metadata = JSON.parse(metadataJson) as WasmModelMetadata;

      // Transfer ownership of buffers to avoid copying
      const verticesBuffer = vertices.buffer;
      const indicesBuffer = indices.buffer;
      const materialsBuffer = materials.buffer;
      const vmOffsetsBuffer = vertexMorphOffsets.buffer;
      const uvOffsetsBuffer = uvMorphOffsets.buffer;

      self.postMessage(
        {
          type: "LOAD_PMX_SUCCESS",
          metadata,
          vertices: verticesBuffer,
          indices: indicesBuffer,
          materials: materialsBuffer,
          vertexMorphOffsets: vmOffsetsBuffer,
          uvMorphOffsets: uvOffsetsBuffer,
        },
        [
          verticesBuffer,
          indicesBuffer,
          materialsBuffer,
          vmOffsetsBuffer,
          uvOffsetsBuffer,
        ],
      );
    } catch (err: any) {
      console.error("[Parser Worker] Error parsing PMX:", err);
      self.postMessage({
        type: "LOAD_PMX_ERROR",
        message: err.message || String(err),
      });
    }
  }
};
