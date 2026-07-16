// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    include: ["packages/*/tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["packages/viewer/src/path.ts"],
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/tests/**",
        "packages/test-support/**",
      ],
      thresholds: {
        lines: 95,
        functions: 95,
        statements: 95,
      },
    },
  },
  resolve: {
    alias: {
      "@webmmd/protocol": resolve(__dirname, "packages/protocol/src/index.ts"),
      "@webmmd/webgpu": resolve(__dirname, "packages/webgpu/src/index.ts"),
      "@webmmd/viewer": resolve(__dirname, "packages/viewer/src/index.ts"),
    },
  },
});
