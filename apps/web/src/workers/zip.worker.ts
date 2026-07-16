// SPDX-License-Identifier: AGPL-3.0-or-later

import { unzipSync } from "fflate";

self.onmessage = async (e: MessageEvent<{ buffer: ArrayBuffer }>) => {
  try {
    const { buffer } = e.data;
    const unzipped = unzipSync(new Uint8Array(buffer));
    const sjisDecoder = new TextDecoder("shift-jis");

    const decodeFilename = (garbledKey: string): string => {
      let isUtf8 = false;
      for (let i = 0; i < garbledKey.length; i++) {
        if (garbledKey.charCodeAt(i) > 0xff) {
          isUtf8 = true;
          break;
        }
      }
      if (isUtf8) {
        return garbledKey;
      }
      const bytes = new Uint8Array(garbledKey.length);
      for (let i = 0; i < garbledKey.length; i++) {
        bytes[i] = garbledKey.charCodeAt(i) & 0xff;
      }
      return sjisDecoder.decode(bytes);
    };

    const MAX_FILES = 2000;
    const MAX_TOTAL_SIZE = 500 * 1024 * 1024; // 500 MB

    let fileCount = 0;
    let totalSize = 0;
    const files: {
      normalizedKey: string;
      filename: string;
      data: Uint8Array;
    }[] = [];

    for (const [garbledKey, data] of Object.entries(unzipped)) {
      if (garbledKey.endsWith("/")) continue; // Skip directories
      if (data.length === 0) continue;

      fileCount++;
      totalSize += data.length;

      if (fileCount > MAX_FILES) {
        throw new Error(
          `Zip archive exceeds safety limits (maximum ${MAX_FILES} files allowed).`,
        );
      }
      if (totalSize > MAX_TOTAL_SIZE) {
        throw new Error(
          `Zip archive exceeds safety limits (maximum 500MB total unzipped size allowed).`,
        );
      }

      const decodedKey = decodeFilename(garbledKey);
      const normalizedKey = decodedKey.replace(/\\/g, "/");
      const filename = normalizedKey.substring(
        normalizedKey.lastIndexOf("/") + 1,
      );

      files.push({
        normalizedKey,
        filename,
        data,
      });
    }

    const transferables = files.map((f) => f.data.buffer);
    self.postMessage({ type: "UNZIP_SUCCESS", files }, transferables);
  } catch (err: any) {
    self.postMessage({
      type: "UNZIP_ERROR",
      message: err.message || String(err),
    });
  }
};
