// SPDX-License-Identifier: GPL-3.0-or-later
import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  root: resolve(__dirname),
  publicDir: resolve(__dirname, "public"),
  server: {
    port: 5173,
    strictPort: true,
  },
  resolve: {
    alias: {
      "@webmmd/protocol": resolve(
        __dirname,
        "../../packages/protocol/src/index.ts",
      ),
      "@webmmd/webgpu": resolve(
        __dirname,
        "../../packages/webgpu/src/index.ts",
      ),
      "@webmmd/viewer": resolve(
        __dirname,
        "../../packages/viewer/src/index.ts",
      ),
    },
  },
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    target: "es2022",
  },
});
