// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { resolveRelativePath, collapseSegments } from "../src/path.js";

describe("collapseSegments", () => {
  it("should collapse basic parent references", () => {
    expect(collapseSegments("a/b/../c")).toBe("a/c");
  });

  it("should collapse dot segments", () => {
    expect(collapseSegments("a/./b/c/..")).toBe("a/b");
  });

  it("should handle excess parent references", () => {
    expect(collapseSegments("a/../../b")).toBe("../b");
  });

  it("should handle empty path", () => {
    expect(collapseSegments("")).toBe("");
  });

  it("should collapse multiple parent references", () => {
    expect(collapseSegments("a/b/c/../../../d")).toBe("d");
  });

  it("should collapse current dir references only", () => {
    expect(collapseSegments("./././a")).toBe("a");
  });

  it("should handle trailing slashes", () => {
    expect(collapseSegments("a/b/c/")).toBe("a/b/c");
  });

  it("should handle double slashes", () => {
    expect(collapseSegments("a//b//c")).toBe("a/b/c");
  });

  it("should handle only parent references", () => {
    expect(collapseSegments("../../..")).toBe("../../..");
  });

  it("should handle single segment", () => {
    expect(collapseSegments("file.png")).toBe("file.png");
  });

  it("should handle parent then child", () => {
    expect(collapseSegments("../textures/file.png")).toBe(
      "../textures/file.png",
    );
  });
});

describe("resolveRelativePath", () => {
  it("should resolve relative paths relative to base path", () => {
    expect(resolveRelativePath("models/lyn.pmx", "hair.png")).toBe(
      "models/hair.png",
    );
    expect(resolveRelativePath("models/lyn/lyn.pmx", "tex/hair.png")).toBe(
      "models/lyn/tex/hair.png",
    );
    expect(
      resolveRelativePath("models/lyn/lyn.pmx", "../common/toon.png"),
    ).toBe("models/common/toon.png");
  });

  it("should handle absolute or protocol paths directly", () => {
    expect(resolveRelativePath("models/lyn.pmx", "C:/textures/hair.png")).toBe(
      "c:/textures/hair.png",
    );
    expect(
      resolveRelativePath("models/lyn.pmx", "/absolute/path/file.png"),
    ).toBe("absolute/path/file.png");
  });

  it("should normalize backslashes in both paths", () => {
    expect(resolveRelativePath("models\\lyn\\lyn.pmx", "tex\\hair.png")).toBe(
      "models/lyn/tex/hair.png",
    );
  });

  it("should handle base path without directory", () => {
    expect(resolveRelativePath("model.pmx", "texture.png")).toBe("texture.png");
  });

  it("should handle deeply nested relative paths", () => {
    expect(resolveRelativePath("a/b/c/d/e.pmx", "../../f/g.png")).toBe(
      "a/b/f/g.png",
    );
  });

  it("should handle mixed case normalization", () => {
    expect(resolveRelativePath("Models/Lyn.pmx", "Hair.PNG")).toBe(
      "models/hair.png",
    );
  });

  it("should handle relative path with dot segment", () => {
    expect(resolveRelativePath("models/lyn.pmx", "./tex/hair.png")).toBe(
      "models/tex/hair.png",
    );
  });

  it("should handle Windows drive letter paths", () => {
    expect(
      resolveRelativePath("models/lyn.pmx", "D:\\Textures\\body.bmp"),
    ).toBe("d:/textures/body.bmp");
  });
});
