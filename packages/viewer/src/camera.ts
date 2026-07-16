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
    { clientX: number; clientY: number; button: number }
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

  private onPointerDown = (e: PointerEvent) => {
    if (e.button === 2) return; // Ignore right click completely for camera controls
    this.canvas.setPointerCapture(e.pointerId);
    this.activePointers.set(e.pointerId, {
      clientX: e.clientX,
      clientY: e.clientY,
      button: e.button,
    });

    if (this.activePointers.size === 2) {
      const pts = Array.from(this.activePointers.values());
      const dx = pts[0]!.clientX - pts[1]!.clientX;
      const dy = pts[0]!.clientY - pts[1]!.clientY;
      this.initialPinchDistance = Math.sqrt(dx * dx + dy * dy);
      this.initialPinchRadius = this.radius;
    }
    e.preventDefault();
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.activePointers.has(e.pointerId)) return;

    const lastPos = this.activePointers.get(e.pointerId)!;
    const dx = e.clientX - lastPos.clientX;
    const dy = e.clientY - lastPos.clientY;

    this.activePointers.set(e.pointerId, {
      clientX: e.clientX,
      clientY: e.clientY,
      button: lastPos.button,
    });

    if (this.activePointers.size === 1) {
      const isPanning = e.shiftKey || lastPos.button === 1;
      if (isPanning) {
        // Panning speed: matches cursor movement dynamically
        const fovRad = (45 * Math.PI) / 180;
        const halfFovTan = Math.tan(fovRad / 2);
        const height = this.canvas.clientHeight || 500;
        const speed = (2.0 * halfFovTan * this.radius) / height;

        // View-space axes in world space coordinates
        const rightX = Math.cos(this.yaw);
        const rightZ = -Math.sin(this.yaw);

        const upX = -Math.sin(this.pitch) * Math.sin(this.yaw);
        const upY = Math.cos(this.pitch);
        const upZ = -Math.sin(this.pitch) * Math.cos(this.yaw);

        this.target[0] -= (rightX * dx - upX * dy) * speed;
        this.target[1] += upY * dy * speed;
        this.target[2] -= (rightZ * dx - upZ * dy) * speed;
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
  };

  private onPointerUp = (e: PointerEvent) => {
    if (this.activePointers.has(e.pointerId)) {
      try {
        this.canvas.releasePointerCapture(e.pointerId);
      } catch (err) {
        // releasePointerCapture can throw if pointer was lost automatically
      }
      this.activePointers.delete(e.pointerId);
    }
    if (this.activePointers.size < 2) {
      this.initialPinchDistance = 0;
    }
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const factor = e.ctrlKey ? 0.05 : 0.02;
    this.radius = Math.max(
      1.0,
      Math.min(100.0, this.radius + e.deltaY * factor),
    );
    this.triggerChange();
  };

  private setupListeners() {
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerUp);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
  }

  public dispose() {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.activePointers.clear();
    this.onChangeCallback = null;
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

  public getMatrices(aspect: number): {
    viewProjection: Float32Array;
    view: Float32Array;
    eyePosition: Float32Array;
  } {
    const eyeX =
      this.target[0] + this.radius * Math.cos(this.pitch) * Math.sin(this.yaw);
    const eyeY = this.target[1] + this.radius * Math.sin(this.pitch);
    const eyeZ =
      this.target[2] + this.radius * Math.cos(this.pitch) * Math.cos(this.yaw);

    const upX = 0;
    const upY = 1;
    const upZ = 0;

    const zx = eyeX - this.target[0];
    const zy = eyeY - this.target[1];
    const zz = eyeZ - this.target[2];
    const zlen = Math.sqrt(zx * zx + zy * zy + zz * zz);
    const zX = zlen > 0 ? zx / zlen : 0;
    const zY = zlen > 0 ? zy / zlen : 0;
    const zZ = zlen > 0 ? zz / zlen : 1;

    const xx = upY * zZ - upZ * zY;
    const xy = upZ * zX - upX * zZ;
    const xz = upX * zY - upY * zX;
    const xlen = Math.sqrt(xx * xx + xy * xy + xz * xz);
    const xX = xlen > 0 ? xx / xlen : 1;
    const xY = xlen > 0 ? xy / xlen : 0;
    const xZ = xlen > 0 ? xz / xlen : 0;

    const yx = zY * xZ - zZ * xY;
    const yy = zZ * xX - zX * xZ;
    const yz = zX * xY - zY * xX;

    const view = new Float32Array([
      xX,
      yx,
      zX,
      0,
      xY,
      yy,
      zY,
      0,
      xZ,
      yz,
      zZ,
      0,
      -(xX * eyeX + xY * eyeY + xZ * eyeZ),
      -(yx * eyeX + yy * eyeY + yz * eyeZ),
      -(zX * eyeX + zY * eyeY + zZ * eyeZ),
      1,
    ]);

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
      far * nf,
      -1,
      0,
      0,
      far * near * nf,
      0,
    ]);

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
