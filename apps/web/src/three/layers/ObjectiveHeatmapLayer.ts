import { hasPolytopeLines } from "@lpviz/polytope/polytopeTypes";
import type { Lines } from "@lpviz/math/types";
import { DataTexture, DoubleSide, Mesh, MeshBasicMaterial, NearestFilter, PlaneGeometry, RGBAFormat, UnsignedByteType } from "three";
import { inferno } from "../helpers/colormap";
import { RENDER_ORDER } from "../helpers/renderOrder";
import type { SceneContext } from "../SceneContext";
import { LayerBase } from "./base/LayerBase";

// Background objective-function heatmap, generated CPU-side (no shader
// programming): each coarseness cell (objectiveHeatmapCell world units) is
// rendered at a constant 16x16 texels, so the texel size is always 1/16th of a
// cell. Color is computed once per cell from the objective value at the cell
// center; cells are masked against the polytope at texel resolution so the
// region edge stays crisp.
//
// The region is the viewport-visible rectangle (snapped to the cell grid) at
// rebuild time and is baked into a static DataTexture quad. Rebuilds happen
// only when the objective, the polytope, or the heatmap toggles/settings
// change (invalidationKeys = ["objectiveHeatmap"]); pan/zoom/orbit repaint the
// grid but leave the heatmap untouched.
const TEXELS_PER_CELL = 16;
const CELL_VISIBLE_MARGIN = 1;
const MAX_TEXTURE_DIM = 1024;
const MIN_TEXTURE_DIM = 8;
const MIN_CELL_SIZE = 0.01;
const MASK_EPSILON = 1e-6;
const FLAT_COLOR_T = 0.5;

const pointInsidePolytope = (lines: Lines, x: number, y: number): boolean => {
  for (const [a, b, c] of lines) {
    if (a * x + b * y > c + MASK_EPSILON) return false;
  }
  return true;
};

export class ObjectiveHeatmapLayer extends LayerBase {
  readonly object3D: Mesh;
  override readonly renderPass = "background" as const;
  override readonly invalidationKeys = ["objectiveHeatmap"] as const;

  private material: MeshBasicMaterial;
  private texture: DataTexture | null = null;

  constructor() {
    super();
    const material = new MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    const mesh = new Mesh(new PlaneGeometry(1, 1), material);
    mesh.renderOrder = RENDER_ORDER.heatmap;
    mesh.frustumCulled = false;
    mesh.visible = false;
    this.object3D = mesh;
    this.material = material;
  }

  protected dependencies(ctx: SceneContext): readonly unknown[] {
    const raw = ctx.getState();
    return [raw.objectiveHeatmapEnabled, raw.objectiveHeatmapCell, raw.objectiveHidden, raw.objectiveVector, raw.currentObjective, raw.completionMode, raw.polytope];
  }

  protected rebuild(ctx: SceneContext): void {
    const raw = ctx.getState();
    this.object3D.visible = false;
    if (!raw.objectiveHeatmapEnabled || raw.objectiveHidden) return;
    if (!hasPolytopeLines(raw.polytope)) return;
    const target = raw.objectiveVector ?? (raw.completionMode !== "draft" ? raw.currentObjective : null);
    if (!target || Math.hypot(target.x, target.y) < 1e-9) return;

    const lines = raw.polytope.lines;
    const cellSize = Math.max(MIN_CELL_SIZE, raw.objectiveHeatmapCell);
    const snap = ctx.getSnapshot();
    const halfWidth = (snap.orthographic.right - snap.orthographic.left) / 2;
    const halfHeight = (snap.orthographic.top - snap.orthographic.bottom) / 2;
    const margin = cellSize * CELL_VISIBLE_MARGIN;
    const minX = Math.floor((snap.target.x - halfWidth - margin) / cellSize) * cellSize;
    const maxX = Math.ceil((snap.target.x + halfWidth + margin) / cellSize) * cellSize;
    const minY = Math.floor((snap.target.y - halfHeight - margin) / cellSize) * cellSize;
    const maxY = Math.ceil((snap.target.y + halfHeight + margin) / cellSize) * cellSize;
    const width = maxX - minX;
    const height = maxY - minY;
    if (width <= 0 || height <= 0) return;

    const texelSize = cellSize / TEXELS_PER_CELL;
    const resWidth = clampTextureDim(Math.round(width / texelSize));
    const resHeight = clampTextureDim(Math.round(height / texelSize));
    const stepX = width / resWidth;
    const stepY = height / resHeight;

    // Objective value per cell, sampled at the cell center and normalized over
    // the in-polytope cells so the colormap spans the current region/extreme.
    const cellColumns = Math.round(width / cellSize);
    const cellRows = Math.round(height / cellSize);
    const cellValues = new Float64Array(cellColumns * cellRows);
    let minValue = Infinity;
    let maxValue = -Infinity;
    for (let row = 0; row < cellRows; row++) {
      const worldY = minY + (row + 0.5) * cellSize;
      for (let col = 0; col < cellColumns; col++) {
        const worldX = minX + (col + 0.5) * cellSize;
        const value = target.x * worldX + target.y * worldY;
        cellValues[row * cellColumns + col] = value;
        if (!pointInsidePolytope(lines, worldX, worldY)) continue;
        if (value < minValue) minValue = value;
        if (value > maxValue) maxValue = value;
      }
    }
    // no cell of the region is feasible (empty/degenerate region, or the
    // current view misses the polytope entirely after a pan without a repaint)
    if (!Number.isFinite(minValue)) return;

    const valueRange = maxValue - minValue;
    const data = new Uint8ClampedArray(resWidth * resHeight * 4);
    for (let row = 0; row < resHeight; row++) {
      const worldY = minY + (row + 0.5) * stepY;
      const cellRow = Math.min(cellRows - 1, Math.max(0, Math.floor((worldY - minY) / cellSize)));
      for (let col = 0; col < resWidth; col++) {
        const offset = (row * resWidth + col) * 4;
        const worldX = minX + (col + 0.5) * stepX;
        if (!pointInsidePolytope(lines, worldX, worldY)) continue;
        const cellCol = Math.min(cellColumns - 1, Math.max(0, Math.floor((worldX - minX) / cellSize)));
        // boundary texels inherit their cell's value so the masked triangles
        // at the region edge stay colored instead of falling back to minValue;
        // out-of-range values clamp to the colormap extremes
        const value = cellValues[cellRow * cellColumns + cellCol];
        const t = valueRange > 0 ? (value - minValue) / valueRange : FLAT_COLOR_T;
        const [r, g, b] = inferno(t);
        data[offset] = r;
        data[offset + 1] = g;
        data[offset + 2] = b;
        data[offset + 3] = 255;
      }
    }

    const texture = new DataTexture(data, resWidth, resHeight, RGBAFormat, UnsignedByteType);
    texture.minFilter = NearestFilter;
    texture.magFilter = NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    this.texture?.dispose();
    this.texture = texture;

    this.object3D.geometry.dispose();
    this.object3D.geometry = new PlaneGeometry(width, height);
    this.object3D.position.set((minX + maxX) / 2, (minY + maxY) / 2, 0);

    this.material.map = texture;
    this.material.needsUpdate = true;
    this.object3D.visible = true;
  }

  dispose(): void {
    this.texture?.dispose();
    this.object3D.geometry.dispose();
    this.material.dispose();
  }
}

function clampTextureDim(size: number): number {
  return Math.max(MIN_TEXTURE_DIM, Math.min(MAX_TEXTURE_DIM, size));
}
