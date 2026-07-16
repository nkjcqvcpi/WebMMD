// SPDX-License-Identifier: GPL-3.0-or-later

export class OrbitCamera {
  public target: [number, number, number] = [0, 10, 0]; // Orbit center (look at MMD center, e.g. torso level)
  public radius = 25.0;
  public yaw = 0.0; // In radians
  public pitch = 0.05; // In radians

  private canvas: HTMLCanvasElement;
  private isPointerDown = false;
  private lastX = 0;
  private lastY = 0;

  // Touch tracking for pinch-to-zoom
  private lastTouchDistance = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.setupListeners();
  }

  public reset() {
    this.target = [0, 10, 0];
    this.radius = 25.0;
    this.yaw = 0.0;
    this.pitch = 0.05;
  }

  private setupListeners() {
    this.canvas.addEventListener("mousedown", (e) => {
      this.isPointerDown = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      try {
        const promise = this.canvas.requestPointerLock?.();
        if (promise && typeof promise.catch === "function") {
          promise.catch((err: any) =>
            console.warn("Pointer lock failed:", err),
          );
        }
      } catch (err) {
        console.warn("Pointer lock failed synchronously:", err);
      }
    });

    window.addEventListener("mouseup", () => {
      if (this.isPointerDown) {
        this.isPointerDown = false;
        document.exitPointerLock?.();
      }
    });

    window.addEventListener("mousemove", (e) => {
      if (!this.isPointerDown) return;

      const dx = e.movementX ?? e.clientX - this.lastX;
      const dy = e.movementY ?? e.clientY - this.lastY;

      this.lastX = e.clientX;
      this.lastY = e.clientY;

      if (e.shiftKey) {
        // Panning: slide the target
        const speed = this.radius * 0.002;
        // Direction vectors in camera space projected on horizontal plane
        const rightX = Math.cos(this.yaw);
        const rightZ = -Math.sin(this.yaw);

        this.target[0] -= rightX * dx * speed;
        this.target[2] -= rightZ * dx * speed;
        this.target[1] += dy * speed;
      } else {
        // Orbit rotation
        this.yaw -= dx * 0.005;
        this.pitch = Math.max(
          -Math.PI / 2 + 0.05,
          Math.min(Math.PI / 2 - 0.05, this.pitch + dy * 0.005),
        );
      }

      this.triggerChange();
    });

    this.canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.radius = Math.max(
          1.0,
          Math.min(100.0, this.radius + e.deltaY * 0.02),
        );
        this.triggerChange();
      },
      { passive: false },
    );

    // Touch controls for mobile Safari (iOS/iPadOS)
    this.canvas.addEventListener("touchstart", (e) => {
      if (e.touches.length === 1 && e.touches[0]) {
        this.isPointerDown = true;
        this.lastX = e.touches[0].clientX;
        this.lastY = e.touches[0].clientY;
      } else if (e.touches.length === 2 && e.touches[0] && e.touches[1]) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        this.lastTouchDistance = Math.sqrt(dx * dx + dy * dy);
      }
    });

    this.canvas.addEventListener("touchmove", (e) => {
      if (e.touches.length === 1 && this.isPointerDown && e.touches[0]) {
        const x = e.touches[0].clientX;
        const y = e.touches[0].clientY;
        const dx = x - this.lastX;
        const dy = y - this.lastY;
        this.lastX = x;
        this.lastY = y;

        this.yaw -= dx * 0.007;
        this.pitch = Math.max(
          -Math.PI / 2 + 0.05,
          Math.min(Math.PI / 2 - 0.05, this.pitch + dy * 0.007),
        );
        this.triggerChange();
      } else if (e.touches.length === 2 && e.touches[0] && e.touches[1]) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        const delta = this.lastTouchDistance - dist;
        this.lastTouchDistance = dist;
        this.radius = Math.max(
          1.0,
          Math.min(100.0, this.radius + delta * 0.05),
        );
        this.triggerChange();
      }
    });

    this.canvas.addEventListener("touchend", () => {
      this.isPointerDown = false;
      this.lastTouchDistance = 0;
    });
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
    // Forward direction: normalize(target - eye)
    const fx = this.target[0] - eyeX;
    const fy = this.target[1] - eyeY;
    const fz = this.target[2] - eyeZ;
    const flen = Math.sqrt(fx * fx + fy * fy + fz * fz);
    const zx = -fx / flen;
    const zy = -fy / flen;
    const zz = -fz / flen;

    // Up vector: [0, 1, 0]
    // Right vector: cross(up, z)
    const rx = zz;
    const rz = -zx;
    const rlen = Math.sqrt(rx * rx + rz * rz);
    const xx = rx / rlen;
    const xy = 0;
    const xz = rz / rlen;

    // Actual up: cross(z, x)
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

    // 3. Perspective projection matrix
    const fov = (45 * Math.PI) / 180;
    const near = 0.1;
    const far = 1000.0;
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
