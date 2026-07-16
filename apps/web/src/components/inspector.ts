// SPDX-License-Identifier: GPL-3.0-or-later

import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { WasmModelMetadata } from "@webmmd/protocol";

@customElement("webmmd-inspector")
export class WebMmdInspector extends LitElement {
  @property({ type: Object }) metadata: WasmModelMetadata | null = null;
  @state() private activeTab: string = "summary";

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: rgba(18, 18, 26, 0.85);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border-left: 1px solid rgba(255, 255, 255, 0.08);
      color: #e2e8f0;
      font-family:
        "Outfit",
        "Inter",
        system-ui,
        -apple-system,
        sans-serif;
      overflow: hidden;
      width: 100%;
    }

    .tabs {
      display: flex;
      background: rgba(10, 10, 15, 0.5);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      overflow-x: auto;
      scrollbar-width: none;
    }
    .tabs::-webkit-scrollbar {
      display: none;
    }

    .tab {
      padding: 14px 18px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      color: #94a3b8;
      border-bottom: 2px solid transparent;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      white-space: nowrap;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .tab:hover {
      color: #f8fafc;
      background: rgba(255, 255, 255, 0.02);
    }

    .tab.active {
      color: #818cf8;
      border-bottom-color: #818cf8;
      background: rgba(129, 140, 248, 0.05);
    }

    .content {
      flex: 1;
      overflow-y: auto;
      padding: 24px;
      scrollbar-width: thin;
      scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
    }
    .content::-webkit-scrollbar {
      width: 6px;
    }
    .content::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.1);
      border-radius: 3px;
    }

    h2 {
      margin-top: 0;
      font-size: 20px;
      font-weight: 700;
      color: #f8fafc;
      letter-spacing: -0.02em;
    }

    h3 {
      font-size: 14px;
      font-weight: 600;
      color: #94a3b8;
      margin: 20px 0 10px 0;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .meta-grid {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 12px 24px;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 24px;
    }

    .label {
      color: #64748b;
      font-size: 13px;
      font-weight: 500;
    }

    .value {
      color: #cbd5e1;
      font-size: 13px;
      font-weight: 600;
      word-break: break-all;
    }

    .count-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: rgba(129, 140, 248, 0.1);
      border: 1px solid rgba(129, 140, 248, 0.2);
      color: #a5b4fc;
      font-size: 12px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 9999px;
      margin-left: 8px;
    }

    .list-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 8px;
      margin-bottom: 8px;
      transition: border-color 0.2s ease;
    }

    .list-item:hover {
      border-color: rgba(129, 140, 248, 0.3);
      background: rgba(129, 140, 248, 0.02);
    }

    .item-name {
      font-weight: 600;
      font-size: 13px;
      color: #cbd5e1;
    }

    .item-name-sub {
      font-size: 11px;
      color: #64748b;
      margin-top: 2px;
    }

    .item-detail {
      font-family: monospace;
      font-size: 11px;
      color: #818cf8;
      background: rgba(129, 140, 248, 0.08);
      padding: 2px 6px;
      border-radius: 4px;
    }

    .diagnostic-card {
      padding: 16px;
      border-radius: 8px;
      margin-bottom: 12px;
      border-left: 4px solid;
    }

    .diagnostic-card.error {
      background: rgba(239, 68, 68, 0.05);
      border-color: #ef4444;
      border-top: 1px solid rgba(239, 68, 68, 0.1);
      border-right: 1px solid rgba(239, 68, 68, 0.1);
      border-bottom: 1px solid rgba(239, 68, 68, 0.1);
    }

    .diagnostic-card.warning {
      background: rgba(245, 158, 11, 0.05);
      border-color: #f59e0b;
      border-top: 1px solid rgba(245, 158, 11, 0.1);
      border-right: 1px solid rgba(245, 158, 11, 0.1);
      border-bottom: 1px solid rgba(245, 158, 11, 0.1);
    }

    .diag-header {
      display: flex;
      justify-content: space-between;
      font-weight: 700;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 6px;
    }

    .diag-header.error {
      color: #f87171;
    }

    .diag-header.warning {
      color: #fbbf24;
    }

    .diag-msg {
      font-size: 13px;
      color: #e2e8f0;
      line-height: 1.5;
    }

    .diag-meta {
      margin-top: 8px;
      font-size: 11px;
      color: #64748b;
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: #64748b;
      text-align: center;
      padding: 40px;
    }

    .empty-icon {
      font-size: 48px;
      margin-bottom: 16px;
      color: #334155;
    }
  `;

  render() {
    if (!this.metadata) {
      return html`
        <div class="empty-state">
          <div class="empty-icon">📂</div>
          <p>No model loaded</p>
          <p style="font-size: 12px; margin-top: 8px; max-width: 200px;">
            Drag and drop a PMX file here or click "Open PMX" to inspect its
            structures.
          </p>
        </div>
      `;
    }

    const {
      version,
      nameLocal,
      nameUniversal,
      commentsLocal,
      commentsUniversal,
      textures,
      materials,
      bones,
      morphs,
      rigidBodies,
      joints,
      softBodies,
      diagnostics,
    } = this.metadata;

    return html`
      <div class="tabs">
        <div
          class="tab ${this.activeTab === "summary" ? "active" : ""}"
          @click=${() => (this.activeTab = "summary")}
        >
          Summary
        </div>
        <div
          class="tab ${this.activeTab === "materials" ? "active" : ""}"
          @click=${() => (this.activeTab = "materials")}
        >
          Materials <span class="count-badge">${materials.length}</span>
        </div>
        <div
          class="tab ${this.activeTab === "bones" ? "active" : ""}"
          @click=${() => (this.activeTab = "bones")}
        >
          Bones <span class="count-badge">${bones.length}</span>
        </div>
        <div
          class="tab ${this.activeTab === "morphs" ? "active" : ""}"
          @click=${() => (this.activeTab = "morphs")}
        >
          Morphs <span class="count-badge">${morphs.length}</span>
        </div>
        <div
          class="tab ${this.activeTab === "physics" ? "active" : ""}"
          @click=${() => (this.activeTab = "physics")}
        >
          Physics
          <span class="count-badge"
            >${rigidBodies.length + joints.length + softBodies.length}</span
          >
        </div>
        <div
          class="tab ${this.activeTab === "diagnostics" ? "active" : ""}"
          @click=${() => (this.activeTab = "diagnostics")}
        >
          Diagnostics <span class="count-badge">${diagnostics.length}</span>
        </div>
      </div>

      <div class="content">
        ${
          this.activeTab === "summary"
            ? html`
                <h2>${nameLocal || "Unnamed PMX Model"}</h2>
                <p
                  style="color: #64748b; font-size: 13px; margin: -8px 0 20px 0;"
                >
                  ${nameUniversal}
                </p>

                <div class="meta-grid">
                  <div class="label">PMX Version</div>
                  <div class="value">${version.toFixed(1)}</div>

                  <div class="label">Textures</div>
                  <div class="value">${textures.length} files</div>

                  <div class="label">Materials</div>
                  <div class="value">${materials.length} ranges</div>

                  <div class="label">Bones</div>
                  <div class="value">${bones.length} joints</div>

                  <div class="label">Morphs</div>
                  <div class="value">${morphs.length} sliders</div>

                  <div class="label">Rigid Bodies</div>
                  <div class="value">${rigidBodies.length} elements</div>

                  <div class="label">Joints</div>
                  <div class="value">${joints.length} items</div>

                  <div class="label">Soft Bodies</div>
                  <div class="value">${softBodies.length} meshes</div>
                </div>

                <h3>Comments (Local)</h3>
                <p
                  style="font-size: 13px; color: #cbd5e1; line-height: 1.6; background: rgba(0,0,0,0.2); padding: 12px; border-radius: 8px; white-space: pre-wrap; font-family: monospace;"
                >
                  ${commentsLocal || "No local comments."}
                </p>

                <h3>Comments (Universal)</h3>
                <p
                  style="font-size: 13px; color: #cbd5e1; line-height: 1.6; background: rgba(0,0,0,0.2); padding: 12px; border-radius: 8px; white-space: pre-wrap; font-family: monospace;"
                >
                  ${commentsUniversal || "No universal comments."}
                </p>
              `
            : ""
        }
        ${
          this.activeTab === "materials"
            ? html`
                <h2>Materials</h2>
                ${materials.map(
                  (m, index) => html`
                    <div class="list-item">
                      <div>
                        <div class="item-name">
                          ${m.nameLocal || "Unnamed Material"}
                        </div>
                        <div class="item-name-sub">${m.nameUniversal}</div>
                      </div>
                      <div class="item-detail">
                        range: ${m.surfaceCount} idx
                      </div>
                    </div>
                  `,
                )}
              `
            : ""
        }
        ${
          this.activeTab === "bones"
            ? html`
                <h2>Bones</h2>
                ${bones.map(
                  (b, index) => html`
                    <div class="list-item">
                      <div>
                        <div class="item-name">
                          ${b.nameLocal || "Unnamed Bone"}
                        </div>
                        <div class="item-name-sub">
                          layer: ${b.transformLayer} | parent: ${b.parentIndex}
                        </div>
                      </div>
                      <div class="item-detail">
                        flags: 0x${b.flags.toString(16).toUpperCase()}
                      </div>
                    </div>
                  `,
                )}
              `
            : ""
        }
        ${
          this.activeTab === "morphs"
            ? html`
                <h2>Morphs</h2>
                ${morphs.map(
                  (m, index) => html`
                    <div
                      class="list-item"
                      style="flex-direction: column; align-items: stretch; gap: 8px;"
                    >
                      <div
                        style="display: flex; justify-content: space-between; align-items: center;"
                      >
                        <div>
                          <div class="item-name">
                            ${m.nameLocal || "Unnamed Morph"}
                          </div>
                          <div class="item-name-sub">${m.nameUniversal}</div>
                        </div>
                        <div class="item-detail">type: ${m.morphType}</div>
                      </div>
                      <!-- Interactive Morph Slider -->
                      <div
                        style="display: flex; align-items: center; gap: 12px; margin-top: 4px;"
                      >
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.01"
                          value="0"
                          @input=${(e: Event) => this.handleMorphChange(index, e)}
                          style="flex: 1; accent-color: #818cf8; cursor: pointer; height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px;"
                        />
                        <span
                          style="font-family: monospace; font-size: 12px; color: #818cf8; min-width: 32px; text-align: right;"
                          >0.00</span
                        >
                      </div>
                    </div>
                  `,
                )}
              `
            : ""
        }
        ${
          this.activeTab === "physics"
            ? html`
                <h2>Physics Structural Data</h2>

                <h3>Rigid Bodies (${rigidBodies.length})</h3>
                ${rigidBodies.length === 0 ? html`<p style="color: #64748b; font-size: 13px;">No rigid bodies parsed.</p>` : ""}
                ${rigidBodies.map(
                  (rb) => html`
                    <div class="list-item">
                      <div>
                        <div class="item-name">
                          ${rb.nameLocal || "Unnamed RigidBody"}
                        </div>
                        <div class="item-name-sub">group: ${rb.group}</div>
                      </div>
                      <div class="item-detail">bone: ${rb.boneIndex}</div>
                    </div>
                  `,
                )}

                <h3>Joints (${joints.length})</h3>
                ${joints.length === 0 ? html`<p style="color: #64748b; font-size: 13px;">No joints parsed.</p>` : ""}
                ${joints.map(
                  (j) => html`
                    <div class="list-item">
                      <div>
                        <div class="item-name">
                          ${j.nameLocal || "Unnamed Joint"}
                        </div>
                        <div class="item-name-sub">type: ${j.jointType}</div>
                      </div>
                      <div class="item-detail">
                        ${j.bodyAIndex} 🔗 ${j.bodyBIndex}
                      </div>
                    </div>
                  `,
                )}

                <h3>Soft Bodies (${softBodies.length})</h3>
                ${softBodies.length === 0 ? html`<p style="color: #64748b; font-size: 13px;">No soft bodies parsed.</p>` : ""}
                ${softBodies.map(
                  (sb) => html`
                    <div class="list-item">
                      <div>
                        <div class="item-name">
                          ${sb.nameLocal || "Unnamed SoftBody"}
                        </div>
                        <div class="item-name-sub">
                          material: ${sb.materialIndex}
                        </div>
                      </div>
                    </div>
                  `,
                )}
              `
            : ""
        }
        ${
          this.activeTab === "diagnostics"
            ? html`
                <h2>Diagnostics & Conformance</h2>
                ${
                  diagnostics.length === 0
                    ? html`
                        <div
                          style="background: rgba(34, 197, 94, 0.05); border: 1px solid rgba(34, 197, 94, 0.2); color: #4ade80; border-radius: 8px; padding: 16px; font-size: 13px; font-weight: 600;"
                        >
                          ✓ Model passed all validation checks with zero errors
                          and warnings.
                        </div>
                      `
                    : ""
                }
                ${diagnostics.map(
                  (diag) => html`
                    <div class="diagnostic-card ${diag.severity}">
                      <div class="diag-header ${diag.severity}">
                        <span>${diag.severity} • code: ${diag.code}</span>
                        <span>section: ${diag.section}</span>
                      </div>
                      <div class="diag-msg">${diag.message}</div>
                      <div class="diag-meta">
                        ${diag.itemIndex !== undefined ? `Item Index: ${diag.itemIndex}` : ""}
                      </div>
                    </div>
                  `,
                )}
              `
            : ""
        }
      </div>
    `;
  }

  private handleMorphChange(index: number, e: Event) {
    const input = e.target as HTMLInputElement;
    const value = parseFloat(input.value);
    const span = input.nextElementSibling as HTMLSpanElement;
    if (span) {
      span.textContent = value.toFixed(2);
    }
    this.dispatchEvent(
      new CustomEvent("morph-change", {
        detail: { index, weight: value },
        bubbles: true,
        composed: true,
      }),
    );
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "webmmd-inspector": WebMmdInspector;
  }
}
