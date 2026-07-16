// SPDX-License-Identifier: AGPL-3.0-or-later

export async function createTextureFromImage(
  device: GPUDevice,
  bitmap: ImageBitmap,
  label: string,
  format: GPUTextureFormat = "rgba8unorm-srgb",
): Promise<GPUTexture> {
  const texture = device.createTexture({
    label,
    size: [bitmap.width, bitmap.height, 1],
    format,
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });

  device.queue.copyExternalImageToTexture(
    { source: bitmap, flipY: false },
    { texture },
    [bitmap.width, bitmap.height, 1],
  );

  return texture;
}

export function createFallbackTexture(
  device: GPUDevice,
  color: [number, number, number, number] = [255, 255, 255, 255],
): GPUTexture {
  const texture = device.createTexture({
    label: "Fallback Texture",
    size: [2, 2, 1],
    format: "rgba8unorm-srgb",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });

  const data = new Uint8Array([
    color[0],
    color[1],
    color[2],
    color[3],
    color[0],
    color[1],
    color[2],
    color[3],
    color[0],
    color[1],
    color[2],
    color[3],
    color[0],
    color[1],
    color[2],
    color[3],
  ]);

  device.queue.writeTexture(
    { texture },
    data,
    { bytesPerRow: 8, rowsPerImage: 2 },
    [2, 2, 1],
  );

  return texture;
}

export function createFallbackSampler(device: GPUDevice): GPUSampler {
  return device.createSampler({
    label: "Default Sampler",
    magFilter: "linear",
    minFilter: "linear",
    addressModeU: "repeat",
    addressModeV: "repeat",
  });
}

export function createSharedToonTexture(
  device: GPUDevice,
  index: number,
): GPUTexture {
  const shadows: [number, number, number][] = [
    [128, 128, 128], // toon01
    [230, 204, 204], // toon02 (warm skin shadow)
    [153, 153, 153], // toon03
    [204, 204, 204], // toon04
    [102, 102, 102], // toon05
    [178, 178, 178], // toon06
    [153, 128, 128], // toon07
    [128, 128, 128], // toon08
    [191, 191, 191], // toon09
    [217, 217, 217], // toon10
  ];
  const shadow = shadows[index] || [128, 128, 128];

  const texture = device.createTexture({
    label: `Shared Toon Texture ${index + 1}`,
    size: [1, 2, 1],
    format: "rgba8unorm-srgb",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });

  const data = new Uint8Array([
    shadow[0]!,
    shadow[1]!,
    shadow[2]!,
    255, // Pixel 0 (shadow)
    255,
    255,
    255,
    255, // Pixel 1 (highlight)
  ]);

  device.queue.writeTexture(
    { texture },
    data,
    { bytesPerRow: 4, rowsPerImage: 2 },
    [1, 2, 1],
  );

  return texture;
}
