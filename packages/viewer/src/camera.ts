// SPDX-License-Identifier: AGPL-3.0-or-later

import type { WasmModelBounds } from "@webmmd/protocol";

export class OrbitCamera {
  public target: [number, number, number] = [0, 10, 0];
  public radius = 25.0;
  public yaw = 0.0; // In radians
  public pitch = 0.05; // In radians

  private canvas: HTMLCanvasElement;
  private activePointers = new Map<
    number,
    { clientX: number; clientY: number }
  >();
  private initialPinchDistance = 0;
  private initialPinchRadius = 25.0;

  private currentNear = 0.1;
  private currentFar = 1000.0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.setupListeners();
  }

  public reset() {
    this.target = [0, 10, 0];
    this.radius = 25.0;
    this.yaw = 0.0;
    this.pitch = 0.05;
    this.currentNear = 0.1;
    this.currentFar = 1000.0;
    this.triggerChange();
  }

  public frameModel(bounds: WasmModelBounds) {
    this.target = [...bounds.recommendedCameraTarget] as [
      number,
      number,
      number,
    ];
    this.radius = bounds.recommendedCameraDistance;
    this.currentNear = bounds.nearPlane;
    this.currentFar = bounds.farPlane;
    this.yaw = 0.0;
    this.pitch = 0.05;
    this.triggerChange();
  }

  private setupListeners() {
    // Touch/Mouse unified handlers using Pointer Events
    this.canvas.addEventListener("pointerdown", (e) => {
      this.canvas.setPointerCapture(e.pointerId);
      this.activePointers.set(e.pointerId, {
        clientX: e.clientX,
        clientY: e.clientY,
      });

      if (this.activePointers.size === 2) {
        const pts = Array.from(this.activePointers.values());
        const dx = pts[0]!.clientX - pts[1]!.clientX;
        const dy = pts[0]!.clientY - pts[1]!.clientY;
        this.initialPinchDistance = Math.sqrt(dx * dx + dy * dy);
        this.initialPinchRadius = this.radius;
      }
      e.preventDefault();
    });

    this.canvas.addEventListener("pointermove", (e) => {
      if (!this.activePointers.has(e.pointerId)) return;

      const lastPos = this.activePointers.get(e.pointerId)!;
      const dx = e.clientX - lastPos.clientX;
      const dy = e.clientY - lastPos.clientY;

      this.activePointers.set(e.pointerId, {
        clientX: e.clientX,
        clientY: e.clientY,
      });

      if (this.activePointers.size === 1) {
        if (e.shiftKey) {
          // Panning
          const speed = this.radius * 0.002;
          const rightX = Math.cos(this.yaw);
          const rightZ = -Math.sin(this.yaw);

          this.target[0] -= rightX * dx * speed;
          this.target[2] -= rightZ * dx * speed;
          this.target[1] += dy * speed;
        } else {
          // Orbit Rotation
          this.yaw -= dx * 0.005;
          this.pitch = Math.max(
            -Math.PI / 2 + 0.05,
            Math.min(Math.PI / 2 - 0.05, this.pitch + dy * 0.005),
          );
        }
        this.triggerChange();
      } else if (this.activePointers.size === 2) {
        // Pinch-to-zoom
        const pts = Array.from(this.activePointers.values());
        const p1 = pts[0]!;
        const p2 = pts[1]!;
        const distance = Math.sqrt(
          (p1.clientX - p2.clientX) ** 2 + (p1.clientY - p2.clientY) ** 2,
        );

        if (this.initialPinchDistance > 0) {
          const ratio = this.initialPinchDistance / distance;
          this.radius = Math.max(
            1.0,
            Math.min(100.0, this.initialPinchRadius * ratio),
          );
          this.triggerChange();
        }
      }
      e.preventDefault();
    });

    const handlePointerUp = (e: PointerEvent) => {
      if (this.activePointers.has(e.pointerId)) {
        this.canvas.releasePointerCapture(e.pointerId);
        this.activePointers.delete(e.pointerId);
      }
      if (this.activePointers.size < 2) {
        this.initialPinchDistance = 0;
      }
    };

    this.canvas.addEventListener("pointerup", handlePointerUp);
    this.canvas.addEventListener("pointercancel", handlePointerUp);

    this.canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const factor = e.ctrlKey ? 0.05 : 0.02;
        this.radius = Math.max(
          1.0,
          Math.min(100.0, this.radius + e.deltaY * factor),
        );
        this.triggerChange();
      },
      { passive: false },
    );
  }

  private onChangeCallback: (() => void) | null = null;
  public onChange(callback: () => void) {
    this.onChangeCallback = callback;
  }

  private triggerChange() {
    if (this.onChangeCallback) {
      this.onChangeCallback();
    }
  }

  // Matrix math helpers for the camera uniforms
  public getMatrices(aspect: number): {
    viewProjection: Float32Array;
    view: Float32Array;
    eyePosition: Float32Array;
  } {
    // 1. Calculate eye position
    const eyeX =
      this.target[0] + this.radius * Math.cos(this.pitch) * Math.sin(this.yaw);
    const eyeY = this.target[1] + this.radius * Math.sin(this.pitch);
    const eyeZ =
      this.target[2] + this.radius * Math.cos(this.pitch) * Math.cos(this.yaw);

    // 2. Build lookAt view matrix
    const fx = this.target[0] - eyeX;
    const fy = this.target[1] - eyeY;
    const fz = this.target[2] - eyeZ;
    const flen = Math.sqrt(fx * fx + fy * fy + fz * fz);
    const zx = -fx / flen;
    const zy = -fy / flen;
    const zz = -fz / flen;

    const rx = zz;
    const rz = -zx;
    const rlen = Math.sqrt(rx * rx + rz * rz);
    const xx = rx / rlen;
    const xy = 0;
    const xz = rz / rlen;

    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;

    const view = new Float32Array([
      xx,
      xy,
      xz,
      0,
      yx,
      yy,
      yz,
      0,
      zx,
      zy,
      zz,
      0,
      -(xx * eyeX + xy * eyeY + xz * eyeZ),
      -(yx * eyeX + yy * eyeY + yz * eyeZ),
      -(zx * eyeX + zy * eyeY + zz * eyeZ),
      1,
    ]);

    // 3. Perspective projection matrix using dynamic bounds
    const fov = (45 * Math.PI) / 180;
    const near = this.currentNear;
    const far = this.currentFar;
    const f = 1.0 / Math.tan(fov / 2.0);
    const nf = 1.0 / (near - far);

    const proj = new Float32Array([
      f / aspect,
      0,
      0,
      0,
      0,
      f,
      0,
      0,
      0,
      0,
      (far + near) * nf,
      -1,
      0,
      0,
      2.0 * far * near * nf,
      0,
    ]);

    // 4. viewProjection = proj * view
    const viewProj = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        let sum = 0;
        for (let i = 0; i < 4; i++) {
          sum += proj[r + i * 4]! * view[i + c * 4]!;
        }
        viewProj[r + c * 4] = sum;
      }
    }

    return {
      viewProjection: viewProj,
      view,
      eyePosition: new Float32Array([eyeX, eyeY, eyeZ, 0]),
    };
  }
}
