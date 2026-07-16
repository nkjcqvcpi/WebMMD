// SPDX-License-Identifier: AGPL-3.0-or-later

export function createBuffer(
  device: GPUDevice,
  label: string,
  size: number,
  usage: GPUBufferUsageFlags,
  mappedAtCreation: boolean = false,
): GPUBuffer {
  // Size must be aligned to 4 bytes
  const alignedSize = Math.max(4, (size + 3) & ~3);
  return device.createBuffer({
    label,
    size: alignedSize,
    usage,
    mappedAtCreation,
  });
}

export function createBufferWithData(
  device: GPUDevice,
  label: string,
  data: ArrayBuffer,
  usage: GPUBufferUsageFlags,
): GPUBuffer {
  const buffer = createBuffer(
    device,
    label,
    data.byteLength,
    usage | GPUBufferUsage.COPY_DST,
  );
  device.queue.writeBuffer(buffer, 0, data);
  return buffer;
}
