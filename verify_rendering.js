// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from "fs";

try {
  const buffer = readFileSync("test-results/test.bmp");

  // Verify BM signature
  if (
    buffer.readAsciiString
      ? buffer.readAsciiString(0, 2) !== "BM"
      : buffer.toString("ascii", 0, 2) !== "BM"
  ) {
    throw new Error("Not a valid BMP file.");
  }

  const offset = buffer.readUInt32LE(10);
  const width = Math.abs(buffer.readInt32LE(18));
  const height = Math.abs(buffer.readInt32LE(22));
  const bpp = buffer.readUInt16LE(28);

  console.log(
    `BMP Details: Dimensions = ${width}x${height}, BitsPerPixel = ${bpp}, DataOffset = ${offset}`,
  );

  if (bpp !== 24 && bpp !== 32) {
    throw new Error(`Unsupported BMP bits per pixel: ${bpp}`);
  }

  const bytesPerPixel = bpp / 8;
  const rowSize = Math.floor((bpp * width + 31) / 32) * 4;

  // Background color is approximately [R: 9, G: 9, B: 15] (or [R: 9, G: 9, B: 15] in hex)
  // Let's count pixels in the left-center quadrant that differ from the background
  let nonBgCount = 0;
  let totalScanned = 0;

  // Scan region: Left half of screen, avoiding headers/sidebars
  const startX = Math.floor(width * 0.15);
  const endX = Math.floor(width * 0.45);
  const startY = Math.floor(height * 0.2);
  const endY = Math.floor(height * 0.8);

  for (let y = startY; y < endY; y++) {
    const rowOffset = offset + y * rowSize;
    for (let x = startX; x < endX; x++) {
      const pixelOffset = rowOffset + x * bytesPerPixel;
      if (pixelOffset + 3 > buffer.length) continue;

      const b = buffer[pixelOffset];
      const g = buffer[pixelOffset + 1];
      const r = buffer[pixelOffset + 2];

      totalScanned++;

      // Check distance from dark background color [R: 9, G: 9, B: 15]
      const rDiff = Math.abs(r - 9);
      const gDiff = Math.abs(g - 9);
      const bDiff = Math.abs(b - 15);

      if (rDiff > 10 || gDiff > 10 || bDiff > 10) {
        nonBgCount++;
      }
    }
  }

  const ratio = nonBgCount / totalScanned;
  console.log(`Scanned ${totalScanned} pixels in viewport area.`);
  console.log(`Found ${nonBgCount} pixels differing from background.`);
  console.log(`Rendered ratio: ${(ratio * 100).toFixed(2)}%`);

  // Sample and log a 5x5 grid from the center of the viewport area
  console.log("\n--- Pixel Color Samples from Center of Viewport ---");
  const centerY = Math.floor((startY + endY) / 2);
  const centerX = Math.floor((startX + endX) / 2);
  for (let dy = -2; dy <= 2; dy++) {
    const y = centerY + dy;
    const rowOffset = offset + y * rowSize;
    const lineColors = [];
    for (let dx = -2; dx <= 2; dx++) {
      const x = centerX + dx;
      const pixelOffset = rowOffset + x * bytesPerPixel;
      const b = buffer[pixelOffset];
      const g = buffer[pixelOffset + 1];
      const r = buffer[pixelOffset + 2];
      lineColors.push(`[${r},${g},${b}]`);
    }
    console.log(`y=${y}: ${lineColors.join(" ")}`);
  }
  console.log("--------------------------------------------------\n");

  if (ratio > 0.01) {
    console.log(
      "✅ Success: Model rendering verified inside the canvas viewport!",
    );
    process.exit(0);
  } else {
    console.error(
      "❌ Error: Viewport area is blank! The model was not rendered.",
    );
    process.exit(1);
  }
} catch (err) {
  console.error("Verification failed:", err.message);
  process.exit(2);
}
