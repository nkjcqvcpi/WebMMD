// SPDX-License-Identifier: AGPL-3.0-or-later

import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { WasmModelMetadata } from "@webmmd/protocol";
import { WebMmdViewer } from "@webmmd/viewer";
import { unzipSync } from "fflate";
import "../components/inspector.js";

@customElement("webmmd-app-shell")
export class WebMmdAppShell extends LitElement {
  @state() private metadata: WasmModelMetadata | null = null;
  @state() private parsing: boolean = false;
  @state() private parseError: string | null = null;
  @state() private sidebarOpen: boolean = true;
  @state() private zipPmxFiles: { key: string; name: string }[] = [];
  @state() private showPmxSelector: boolean = false;
  @state() private showLicenseModal: boolean = false;
  @state() private licenseAccepted: boolean = false;

  private worker: Worker | null = null;
  private viewer: WebMmdViewer | null = null;
  private zipFileMap: Map<string, File> = new Map();

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      width: 100vw;
      height: 100vh;
      background: radial-gradient(circle at 30% 20%, #1e1b4b 0%, #09090b 100%);
      color: #f8fafc;
      overflow: hidden;
      font-family:
        "Inter",
        -apple-system,
        sans-serif;
    }

    .app-container {
      display: flex;
      flex: 1;
      overflow: hidden;
      position: relative;
    }

    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 28px;
      background: rgba(10, 10, 15, 0.7);
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      z-index: 10;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .logo {
      font-size: 24px;
      font-weight: 800;
      background: linear-gradient(
        135deg,
        #a5b4fc 0%,
        #818cf8 50%,
        #6366f1 100%
      );
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      letter-spacing: -0.03em;
      font-family: "Outfit", sans-serif;
    }

    .version-tag {
      font-size: 11px;
      font-weight: 700;
      background: rgba(129, 140, 248, 0.1);
      border: 1px solid rgba(129, 140, 248, 0.2);
      color: #a5b4fc;
      padding: 2px 6px;
      border-radius: 4px;
      letter-spacing: 0.05em;
    }

    .controls {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    button {
      background: linear-gradient(135deg, #4f46e5 0%, #4338ca 100%);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: #f8fafc;
      padding: 10px 20px;
      font-size: 13px;
      font-weight: 600;
      border-radius: 8px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 4px 12px rgba(79, 70, 229, 0.3);
    }

    button:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 16px rgba(79, 70, 229, 0.4);
      filter: brightness(1.1);
    }

    button:active {
      transform: translateY(0);
    }

    .viewport {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      position: relative;
    }

    #gpu-canvas {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: 1;
      display: none;
    }

    #gpu-canvas.active {
      display: block;
    }

    .canvas-placeholder {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
      color: #64748b;
      z-index: 2;
    }

    .pulse-circle {
      width: 72px;
      height: 72px;
      border-radius: 50%;
      background: rgba(129, 140, 248, 0.1);
      border: 2px solid rgba(129, 140, 248, 0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 28px;
      animation: pulse 2s infinite;
      box-shadow: 0 0 20px rgba(129, 140, 248, 0.15);
    }

    @keyframes pulse {
      0% {
        transform: scale(0.95);
        box-shadow: 0 0 0 0 rgba(129, 140, 248, 0.4);
      }
      70% {
        transform: scale(1);
        box-shadow: 0 0 0 16px rgba(129, 140, 248, 0);
      }
      100% {
        transform: scale(0.95);
        box-shadow: 0 0 0 0 rgba(129, 140, 248, 0);
      }
    }

    .sidebar {
      width: 420px;
      height: 100%;
      display: flex;
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      z-index: 5;
    }

    .sidebar.closed {
      transform: translateX(100%);
      width: 0;
      overflow: hidden;
    }

    .toggle-sidebar {
      position: absolute;
      right: 20px;
      bottom: 20px;
      background: rgba(15, 23, 42, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: #cbd5e1;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      cursor: pointer;
      z-index: 6;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    }

    /* Drag and drop overlay */
    .drop-overlay {
      position: absolute;
      inset: 0;
      background: rgba(79, 70, 229, 0.2);
      border: 3px dashed #818cf8;
      z-index: 100;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      font-weight: 700;
      color: #e0e7ff;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease;
      backdrop-filter: blur(4px);
    }

    .drop-overlay.active {
      opacity: 1;
    }

    /* Processing Overlay */
    .processing-overlay {
      position: absolute;
      inset: 0;
      background: rgba(9, 9, 11, 0.8);
      z-index: 99;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
      backdrop-filter: blur(8px);
    }

    .spinner {
      width: 48px;
      height: 48px;
      border: 4px solid rgba(129, 140, 248, 0.1);
      border-left-color: #818cf8;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    .error-alert {
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #fca5a5;
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 13px;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 12px;
      max-width: 400px;
      z-index: 10;
    }

    /* License Modal Overlay */
    .license-modal-overlay {
      position: absolute;
      inset: 0;
      background: rgba(9, 9, 11, 0.95);
      z-index: 200;
      display: flex;
      align-items: center;
      justify-content: center;
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
    }

    .license-modal-card {
      background: rgba(15, 12, 50, 0.95);
      border: 1px solid rgba(129, 140, 248, 0.3);
      border-radius: 16px;
      padding: 32px;
      width: 90%;
      max-width: 500px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.8);
      text-align: center;
    }

    /* PMX Selector Overlay */
    .pmx-selector-overlay {
      position: absolute;
      inset: 0;
      background: rgba(9, 9, 11, 0.85);
      z-index: 100;
      display: flex;
      align-items: center;
      justify-content: center;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
    }

    .pmx-selector-card {
      background: rgba(30, 27, 75, 0.9);
      border: 1px solid rgba(129, 140, 248, 0.2);
      border-radius: 16px;
      padding: 32px;
      width: 90%;
      max-width: 500px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
      text-align: center;
    }

    .pmx-option-btn {
      width: 100%;
      text-align: left;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.06);
      padding: 12px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      color: #cbd5e1;
      cursor: pointer;
      display: block;
      transition: all 0.2s ease;
      box-shadow: none;
      margin-bottom: 8px;
    }

    .pmx-option-btn:hover {
      background: rgba(129, 140, 248, 0.15) !important;
      border-color: rgba(129, 140, 248, 0.4) !important;
      color: #f8fafc !important;
      transform: translateY(-1px);
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener("dragover", this.handleDragOver);
    this.addEventListener("dragleave", this.handleDragLeave);
    this.addEventListener("drop", this.handleDrop);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener("dragover", this.handleDragOver);
    this.removeEventListener("dragleave", this.handleDragLeave);
    this.removeEventListener("drop", this.handleDrop);

    if (this.worker) {
      this.worker.terminate();
    }
    this.viewer?.dispose();
  }

  async firstUpdated() {
    const accepted = localStorage.getItem("webmmd_license_accepted");
    if (!accepted) {
      this.showLicenseModal = true;
    }

    (window as any).__webmmdTest = {
      ready: false,
      loaded: false,
      frameRenderedCount: 0,
      setMorphWeight: (index: number, weight: number) => {
        if (this.viewer) {
          this.viewer.setMorphWeight(index, weight);
        }
      },
      loadModelFromZipUrl: async (url: string, pmxPath: string) => {
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP error ${res.status}`);
          const blob = await res.blob();
          const file = new File([blob], "model.zip", {
            type: "application/zip",
          });

          const buffer = await file.arrayBuffer();
          const unzipped = unzipSync(new Uint8Array(buffer));

          const decodeFilename = (bytes: Uint8Array): string => {
            try {
              return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
            } catch {
              return new TextDecoder("shift-jis").decode(bytes);
            }
          };

          const fileMap = new Map<string, File>();
          const pmxKeys: string[] = [];

          for (const [garbledKey, data] of Object.entries(unzipped)) {
            if (data.length === 0) continue;

            const bytes = new Uint8Array(
              garbledKey.split("").map((c) => c.charCodeAt(0)),
            );
            const decodedKey = decodeFilename(bytes);
            const lowerKey = decodedKey.toLowerCase();

            const parts = decodedKey.split("/");
            const name = parts[parts.length - 1] || "file";

            const f = new File([data], name);
            fileMap.set(lowerKey, f);

            if (lowerKey.endsWith(".pmx")) {
              pmxKeys.push(decodedKey);
            }
          }

          this.zipFileMap = fileMap;

          const matchingKey = pmxKeys.find((k) =>
            k.toLowerCase().includes(pmxPath.toLowerCase()),
          );
          if (!matchingKey) {
            throw new Error(`PMX file "${pmxPath}" not found in zip archive.`);
          }

          this.selectZipPmx(matchingKey);
          return true;
        } catch (err: any) {
          console.error("loadModelFromZipUrl failed:", err);
          throw err;
        }
      },
    };

    const canvas = this.shadowRoot?.querySelector(
      "#gpu-canvas",
    ) as HTMLCanvasElement;
    if (canvas) {
      try {
        this.viewer = new WebMmdViewer(canvas);
        await this.viewer.initialize((lostReason) => {
          this.parseError = `WebGPU Device Lost: ${lostReason}. Reloading page might be required.`;
        });
        if ((window as any).__webmmdTest) {
          (window as any).__webmmdTest.ready = true;
        }
      } catch (err: any) {
        console.error("Failed to initialize WebGPU viewer:", err);
        this.parseError = err.message || "WebGPU initialization failed.";
      }
    }
  }

  private handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    this.shadowRoot?.querySelector(".drop-overlay")?.classList.add("active");
  };

  private handleDragLeave = () => {
    this.shadowRoot?.querySelector(".drop-overlay")?.classList.remove("active");
  };

  private handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    this.handleDragLeave();

    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      const zipFile = Array.from(files).find((f) =>
        f.name.toLowerCase().endsWith(".zip"),
      );
      if (zipFile) {
        this.loadFile(zipFile);
        return;
      }
    }

    const items = e.dataTransfer?.items;
    if (!items || items.length === 0) return;

    this.parsing = true;
    this.parseError = null;
    this.metadata = null;
    this.showPmxSelector = false;

    const fileMap = new Map<string, File>();

    // Helper to traverse directories recursively
    const traverseEntry = async (entry: any, path = "") => {
      if (entry.isFile) {
        const file = await new Promise<File>((resolve, reject) => {
          entry.file(resolve, reject);
        });
        fileMap.set((path + entry.name).toLowerCase(), file);
      } else if (entry.isDirectory) {
        const dirReader = entry.createReader();
        const readAllEntries = async (): Promise<any[]> => {
          let allEntries: any[] = [];
          let results = await new Promise<any[]>((resolve, reject) => {
            dirReader.readEntries(resolve, reject);
          });
          while (results.length > 0) {
            allEntries = allEntries.concat(results);
            results = await new Promise<any[]>((resolve, reject) => {
              dirReader.readEntries(resolve, reject);
            });
          }
          return allEntries;
        };
        const entries = await readAllEntries();
        for (const child of entries) {
          await traverseEntry(child, path + entry.name + "/");
        }
      }
    };

    // Traverse all dropped items
    const traversePromises: Promise<void>[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item) {
        const entry = item.webkitGetAsEntry?.();
        if (entry) {
          traversePromises.push(traverseEntry(entry));
        } else {
          const file = item.getAsFile();
          if (file) {
            fileMap.set(file.name.toLowerCase(), file);
          }
        }
      }
    }

    await Promise.all(traversePromises);

    // Find the PMX file
    let pmxFile: File | undefined = undefined;
    let pmxKey = "";
    for (const [key, file] of fileMap.entries()) {
      if (file.name.toLowerCase().endsWith(".pmx")) {
        pmxFile = file;
        pmxKey = key;
        break;
      }
    }

    if (!pmxFile) {
      this.parsing = false;
      this.parseError =
        "No valid .pmx file found in the dropped files/folders.";
      return;
    }

    // Adjust VFS key mapping relative to PMX parent directory
    const pmxFolder = pmxKey.substring(0, pmxKey.lastIndexOf("/") + 1);
    const relativeFileMap = new Map<string, File>();
    for (const [key, file] of fileMap.entries()) {
      if (key.startsWith(pmxFolder)) {
        const relativeKey = key.substring(pmxFolder.length);
        relativeFileMap.set(relativeKey, file);
      } else {
        relativeFileMap.set(key, file);
      }
    }

    if (this.viewer) {
      this.viewer.setVfs(relativeFileMap);
    }

    // Read PMX file and start parsing worker
    const reader = new FileReader();
    reader.onload = () => {
      const arrayBuffer = reader.result as ArrayBuffer;
      this.startParsingWorker(arrayBuffer);
    };
    reader.onerror = () => {
      this.parsing = false;
      this.parseError = "Failed to read PMX file from disk.";
    };
    reader.readAsArrayBuffer(pmxFile);
  };

  private triggerFileInput() {
    const input = this.shadowRoot?.querySelector(
      "#file-input",
    ) as HTMLInputElement;
    if (input) {
      input.click();
    }
  }

  private handleFileInputChange(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) {
      this.loadFile(file);
    }
  }

  private loadFile(file: File) {
    this.parsing = true;
    this.parseError = null;
    this.metadata = null;
    this.showPmxSelector = false;

    const reader = new FileReader();
    reader.onload = () => {
      const arrayBuffer = reader.result as ArrayBuffer;
      if (file.name.toLowerCase().endsWith(".zip")) {
        this.loadZip(arrayBuffer);
      } else {
        // VFS with single file
        const fileMap = new Map<string, File>();
        fileMap.set(file.name.toLowerCase(), file);
        this.viewer?.setVfs(fileMap);
        this.startParsingWorker(arrayBuffer);
      }
    };
    reader.onerror = () => {
      this.parsing = false;
      this.parseError = "Failed to read file from disk.";
    };
    reader.readAsArrayBuffer(file);
  }

  private loadZip(buffer: ArrayBuffer) {
    this.parsing = true;
    this.parseError = null;

    try {
      const unzipped = unzipSync(new Uint8Array(buffer));
      const sjisDecoder = new TextDecoder("shift-jis");

      // Helper to decode legacy Shift-JIS / UTF-8 zip filenames
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

      const fileMap = new Map<string, File>();
      const pmxKeys: string[] = [];

      for (const [garbledKey, data] of Object.entries(unzipped)) {
        if (garbledKey.endsWith("/")) continue; // Skip directories

        const decodedKey = decodeFilename(garbledKey);
        const normalizedKey = decodedKey.replace(/\\/g, "/");
        const filename = normalizedKey.substring(
          normalizedKey.lastIndexOf("/") + 1,
        );

        const blob = new Blob([data]);
        const file = new File([blob], filename);
        fileMap.set(normalizedKey.toLowerCase(), file);

        if (normalizedKey.toLowerCase().endsWith(".pmx")) {
          pmxKeys.push(normalizedKey);
        }
      }

      if (pmxKeys.length === 0) {
        this.parsing = false;
        this.parseError = "No valid .pmx files found in the zip archive.";
        return;
      }

      this.zipFileMap = fileMap;

      if (pmxKeys.length === 1) {
        this.selectZipPmx(pmxKeys[0]!);
      } else {
        this.zipPmxFiles = pmxKeys.map((key) => ({ key, name: key }));
        this.showPmxSelector = true;
        this.parsing = false;
      }
    } catch (err: any) {
      this.parsing = false;
      this.parseError = `Failed to decompress zip archive: ${err.message || err}`;
    }
  }

  private selectZipPmx(pmxKey: string) {
    this.showPmxSelector = false;
    this.parsing = true;
    this.parseError = null;

    const pmxFile = this.zipFileMap.get(pmxKey.toLowerCase());
    if (!pmxFile) {
      this.parsing = false;
      this.parseError = `Model file ${pmxKey} not found in extracted files.`;
      return;
    }

    // Normalizing paths relative to the PMX file folder
    const pmxFolder = pmxKey
      .substring(0, pmxKey.lastIndexOf("/") + 1)
      .toLowerCase();
    const relativeFileMap = new Map<string, File>();

    for (const [key, file] of this.zipFileMap.entries()) {
      if (key.startsWith(pmxFolder)) {
        const relativeKey = key.substring(pmxFolder.length);
        relativeFileMap.set(relativeKey, file);
      } else {
        relativeFileMap.set(key, file);
      }
    }

    if (this.viewer) {
      this.viewer.setVfs(relativeFileMap);
    }

    const reader = new FileReader();
    reader.onload = () => {
      const arrayBuffer = reader.result as ArrayBuffer;
      this.startParsingWorker(arrayBuffer);
    };
    reader.onerror = () => {
      this.parsing = false;
      this.parseError = "Failed to read PMX file from memory.";
    };
    reader.readAsArrayBuffer(pmxFile);
  }

  private cancelZipSelection() {
    this.showPmxSelector = false;
    this.zipPmxFiles = [];
    this.zipFileMap.clear();
  }

  private startParsingWorker(buffer: ArrayBuffer) {
    if (this.worker) {
      this.worker.terminate();
    }

    this.worker = new Worker(
      new URL("../workers/parser.worker.ts", import.meta.url),
      { type: "module" },
    );

    this.worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === "LOAD_PMX_SUCCESS") {
        this.parsing = false;
        this.metadata = msg.metadata;

        console.log("[App Shell] PMX successfully parsed! Loading into GPU...");
        if (this.viewer) {
          this.viewer
            .loadModel(
              msg.metadata,
              msg.vertices,
              msg.indices,
              msg.materials,
              msg.vertexMorphOffsets,
              msg.uvMorphOffsets,
              msg.additionalUvs,
            )
            .then(() => {
              if ((window as any).__webmmdTest) {
                (window as any).__webmmdTest.loaded = true;
                (window as any).__webmmdTest.metadata = msg.metadata;
              }
            })
            .catch((err: any) => {
              console.error("Failed to load model into WebGPU:", err);
              this.parseError = `GPU Loading Failed: ${err.message || err}`;
            });
        }
      } else if (msg.type === "LOAD_PMX_ERROR") {
        this.parsing = false;
        this.parseError = msg.message;
      }
    };

    this.worker.postMessage(
      {
        type: "LOAD_PMX",
        fileData: buffer,
      },
      [buffer],
    );
  }

  private handleMorphChange = (e: Event) => {
    const { index, weight } = (e as CustomEvent).detail;
    if (this.viewer) {
      this.viewer.setMorphWeight(index, weight);
    }
  };

  private resetPose = () => {
    if (this.viewer) {
      this.viewer.resetPose();
      const sliders = this.shadowRoot?.querySelectorAll('input[type="range"]');
      if (sliders) {
        sliders.forEach((slider: any) => {
          slider.value = "0";
          const span = slider.nextElementSibling as HTMLSpanElement;
          if (span) {
            span.textContent = "0.00";
          }
        });
      }
    }
  };

  private resetCamera = () => {
    this.viewer?.resetCamera();
  };

  private toggleOutlines = (e: Event) => {
    const checked = (e.target as HTMLInputElement).checked;
    this.viewer?.toggleOutlines(checked);
  };

  render() {
    return html`
      ${
        this.showLicenseModal
          ? html`
              <div class="license-modal-overlay">
                <div class="license-modal-card">
                  <div style="font-size: 40px; margin-bottom: 12px;">⚖️</div>
                  <h2
                    style="font-size: 22px; font-weight: 700; color: #f8fafc; margin: 0 0 12px 0; font-family: 'Outfit';"
                  >
                    License & Notices
                  </h2>
                  <p
                    style="font-size: 13px; color: #cbd5e1; margin: 0 0 20px 0; line-height: 1.6; text-align: left;"
                  >
                    This application is open source and licensed under the
                    <strong>AGPL-3.0-or-later</strong>. Please read the project
                    license and third-party notices by clicking the links below:
                  </p>
                  <div
                    style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 24px; text-align: left;"
                  >
                    <a
                      href="/NOTICE.md"
                      target="_blank"
                      class="license-link"
                      style="color: #818cf8; text-decoration: underline; font-size: 14px; font-weight: 600;"
                      >📄 Project License (NOTICE.md)</a
                    >
                    <a
                      href="/THIRD_PARTY_NOTICES.md"
                      target="_blank"
                      class="license-link"
                      style="color: #818cf8; text-decoration: underline; font-size: 14px; font-weight: 600;"
                      >📄 Third-Party Notices (THIRD_PARTY_NOTICES.md)</a
                    >
                  </div>
                  <div
                    style="display: flex; align-items: center; gap: 8px; margin-bottom: 24px; text-align: left;"
                  >
                    <input
                      type="checkbox"
                      id="accept-license-checkbox"
                      @change=${(e: Event) =>
                        (this.licenseAccepted = (
                          e.target as HTMLInputElement
                        ).checked)}
                    />
                    <label
                      for="accept-license-checkbox"
                      style="font-size: 13px; color: #94a3b8; user-select: none; cursor: pointer;"
                    >
                      I accept the license terms and notices.
                    </label>
                  </div>
                  <button
                    ?disabled=${!this.licenseAccepted}
                    @click=${() => {
                      localStorage.setItem("webmmd_license_accepted", "true");
                      this.showLicenseModal = false;
                    }}
                    style="background: #6366f1; color: white; font-weight: bold; border: none; padding: 12px 24px; border-radius: 8px; cursor: pointer; width: 100%; font-size: 14px; opacity: ${
                      this.licenseAccepted ? 1.0 : 0.5
                    };"
                  >
                    Accept & Continue
                  </button>
                </div>
              </div>
            `
          : ""
      }
      <header>
        <div class="brand">
          <div class="logo">WebMMD</div>
          <div class="version-tag">0.1.1</div>
        </div>
        <div class="controls">
          <input
            type="file"
            id="file-input"
            accept=".pmx,.zip"
            @change=${this.handleFileInputChange}
            style="display: none;"
          />
          ${
            this.metadata
              ? html`
                  <button
                    @click=${this.resetPose}
                    style="background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1);"
                  >
                    Reset Pose
                  </button>
                  <button
                    @click=${this.resetCamera}
                    style="background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1);"
                  >
                    Reset Camera
                  </button>
                  <label
                    style="display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; cursor: pointer; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255,255,255,0.06); padding: 8px 14px; border-radius: 8px;"
                  >
                    <input
                      type="checkbox"
                      checked
                      @change=${this.toggleOutlines}
                      style="accent-color: #818cf8;"
                    />
                    Outlines
                  </label>
                `
              : ""
          }
          <button @click=${this.triggerFileInput}>
            <span>📂</span> Open Model
          </button>
        </div>
      </header>

      <div class="app-container">
        <div class="drop-overlay"><span>📥</span> Drop PMX or ZIP here</div>

        ${
          this.parsing
            ? html`
                <div class="processing-overlay">
                  <div class="spinner"></div>
                  <div style="font-weight: 600; font-size: 15px;">
                    Parsing MMD model...
                  </div>
                  <div style="color: #64748b; font-size: 12px;">
                    WebAssembly is validating buffers off the main thread
                  </div>
                </div>
              `
            : ""
        }
        ${
          this.showPmxSelector
            ? html`
                <div class="pmx-selector-overlay">
                  <div class="pmx-selector-card">
                    <div style="font-size: 36px; margin-bottom: 16px;">🤖</div>
                    <h3
                      style="font-size: 20px; font-weight: 700; color: #f8fafc; margin: 0 0 8px 0; font-family: 'Outfit';"
                    >
                      Multiple Models Found
                    </h3>
                    <p
                      style="font-size: 13px; color: #94a3b8; margin: 0 0 24px 0; line-height: 1.5;"
                    >
                      This zip archive contains multiple PMX files. Please
                      select which model you would like to load:
                    </p>

                    <div
                      style="max-height: 240px; overflow-y: auto; text-align: left; margin-bottom: 24px; display: flex; flex-direction: column; gap: 4px; padding-right: 4px; scrollbar-width: thin;"
                    >
                      ${this.zipPmxFiles.map(
                        (opt) => html`
                          <button
                            class="pmx-option-btn"
                            @click=${() => this.selectZipPmx(opt.key)}
                          >
                            ${opt.key}
                          </button>
                        `,
                      )}
                    </div>

                    <button
                      @click=${this.cancelZipSelection}
                      style="background: transparent; border: 1px solid rgba(255,255,255,0.1); color: #94a3b8; font-weight: 600; font-size: 13px; padding: 10px 20px; border-radius: 8px; cursor: pointer; box-shadow: none; margin: 0 auto; display: block;"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              `
            : ""
        }

        <div class="viewport">
          <canvas
            id="gpu-canvas"
            class=${this.metadata ? "active" : ""}
          ></canvas>

          ${
            this.parseError
              ? html`
                  <div class="error-alert">
                    <span>⚠️</span>
                    <div>
                      <strong>Failed to load model</strong>
                      <div
                        style="font-size: 12px; margin-top: 4px; opacity: 0.85;"
                      >
                        ${this.parseError}
                      </div>
                    </div>
                  </div>
                `
              : ""
          }
          ${
            !this.metadata
              ? html`
                  <div class="canvas-placeholder">
                    <div class="pulse-circle">🤖</div>
                    <div
                      style="font-weight: 700; color: #cbd5e1; font-family: 'Outfit'; font-size: 18px;"
                    >
                      Awaiting Model Load
                    </div>
                    <div
                      style="font-size: 13px; text-align: center; max-width: 320px; line-height: 1.5;"
                    >
                      Drag and drop a PMX folder, PMX file, or ZIP archive here.
                    </div>
                  </div>
                `
              : ""
          }

          <button
            class="toggle-sidebar"
            @click=${() => (this.sidebarOpen = !this.sidebarOpen)}
          >
            ${this.sidebarOpen ? "➡️" : "⬅️"}
          </button>
        </div>

        <div class="sidebar ${this.sidebarOpen ? "" : "closed"}">
          <webmmd-inspector
            .metadata=${this.metadata}
            @morph-change=${this.handleMorphChange}
          >
          </webmmd-inspector>
        </div>
      </div>
    `;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "webmmd-app-shell": WebMmdAppShell;
  }
}
