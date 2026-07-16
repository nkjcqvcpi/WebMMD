// SPDX-License-Identifier: AGPL-3.0-or-later

export interface WebGpuContext {
  adapter: GPUAdapter;
  device: GPUDevice;
  format: GPUTextureFormat;
}

export async function initWebGpu(
  canvas: HTMLCanvasElement,
  onDeviceLost?: (reason: string) => void,
): Promise<WebGpuContext> {
  if (!navigator.gpu) {
    throw new Error(
      "WebGPU is not supported in this browser. Please use Safari 26+ or enable WebGPU.",
    );
  }

  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: "high-performance",
  });

  if (!adapter) {
    throw new Error("No compatible GPU adapter found.");
  }

  // Inspect limits and features
  console.log("[WebGPU] Supported Features:", Array.from(adapter.features));
  console.log("[WebGPU] Limits:", {
    maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
    maxBufferSize: adapter.limits.maxBufferSize,
    maxComputeWorkgroupsPerDimension:
      adapter.limits.maxComputeWorkgroupsPerDimension,
  });

  const device = await adapter.requestDevice({
    requiredFeatures: [], // Keep it standard for Safari 26 compatibility
  });

  if (!device) {
    throw new Error("Failed to create WebGPU device.");
  }

  // Setup uncaptured error handling
  device.addEventListener("uncapturederror", (event: Event) => {
    const errorEvent = event as GPUUncapturedErrorEvent;
    console.error("[WebGPU Validation Error]:", errorEvent.error.message);
  });

  // Handle device loss
  device.lost.then((info) => {
    console.warn(
      `[WebGPU] Device lost: ${info.message} (Reason: ${info.reason})`,
    );
    if (onDeviceLost) {
      onDeviceLost(info.message);
    }
  });

  const format = navigator.gpu.getPreferredCanvasFormat();
  const context = canvas.getContext("webgpu");
  if (!context) {
    throw new Error("Failed to get WebGPU context from canvas.");
  }

  context.configure({
    device,
    format,
    alphaMode: "opaque",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });

  return { adapter, device, format };
}
