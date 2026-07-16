// SPDX-License-Identifier: GPL-3.0-or-later

export async function createTextureFromImage(
  device: GPUDevice,
  bitmap: ImageBitmap,
  label: string,
): Promise<GPUTexture> {
  const texture = device.createTexture({
    label,
    size: [bitmap.width, bitmap.height, 1],
    format: "rgba8unorm",
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
    format: "rgba8unorm",
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
