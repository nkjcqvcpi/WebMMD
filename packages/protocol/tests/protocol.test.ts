// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, it, expect } from "vitest";
import type { WasmModelMetadata } from "../src/index.js";

describe("WebMMD TypeScript Protocol", () => {
  it("should compile and validate types correctly", () => {
    // Basic structural validation check
    const mockMeta: WasmModelMetadata = {
      version: 2.1,
      nameLocal: "Test Model",
      nameUniversal: "Test Model EN",
      commentsLocal: "Comment Local",
      commentsUniversal: "Comment EN",
      textures: ["tex1.png", "tex2.png"],
      materials: [
        {
          nameLocal: "Material 1",
          nameUniversal: "Material 1 EN",
          surfaceCount: 30,
        },
      ],
      bones: [
        {
          nameLocal: "Bone 1",
          nameUniversal: "Bone 1 EN",
          parentIndex: -1,
          transformLayer: 0,
          flags: 0,
        },
      ],
      morphs: [],
      rigidBodies: [],
      joints: [],
      softBodies: [],
      diagnostics: [],
      vertexMorphMeta: [],
      uvMorphMeta: [],
    };

    expect(mockMeta.version).toBe(2.1);
    expect(mockMeta.nameLocal).toBe("Test Model");
    expect(mockMeta.textures.length).toBe(2);
  });
});
