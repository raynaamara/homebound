import { parseTerrainGrid } from "./engine.js";
import type { Cell, PlanResult, ScienceOpportunityField, TerrainGrid } from "./engine.js";
import type { Destination } from "./workflow.js";
import { describeLayer, elevationColor, visibleElevationRange } from "./layer-display.js";
import type { LayerDescription, LayerMetadata, MapViewport, ValueRange } from "./layer-display.js";
import { evidenceGeometry } from "./science-context.js";
import type { ScienceEvidence } from "./science-context.js";

export class MissionMap {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly images = new Map<string, HTMLImageElement>();
  private readonly width: number;
  private readonly height: number;
  private readonly metresPerCell: number;
  private readonly metadata: LayerMetadata;
  private terrain: TerrainGrid | undefined;
  private view: MapViewport;
  private currentViewMode: "focus" | "area" = "area";
  private readonly evidenceImages = new Map<string, ScienceEvidence>();

  constructor(canvas: HTMLCanvasElement, width: number, height: number, metresPerCell: number, metadata: LayerMetadata) {
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("Canvas 2D support is required to show the map.");
    this.canvas = canvas; this.context = context; this.width = width; this.height = height;
    this.metresPerCell = metresPerCell;
    this.metadata = metadata;
    this.view = { row: 0, column: 0, size: Math.max(width, height) };
  }

  get viewMode(): "focus" | "area" { return this.currentViewMode; }

  async load(): Promise<void> {
    const pictures = [
      ["optical", "optical.webp"],
      ["slope", "slope.png"], ["thermal", "thermal_context.png"],
    ].map(async ([name, filename]) => {
      const image = new Image();
      image.src = `./data/${filename}`;
      await image.decode();
      this.images.set(name!, image);
    });
    await Promise.all([...pictures, fetch("./data/terrain_grid.json").then(async response => {
      if (!response.ok) throw new Error(`Elevation data could not load: HTTP ${response.status}.`);
      const raw: unknown = await response.json();
      const terrain = parseTerrainGrid(raw);
      if (terrain.width !== this.width || terrain.height !== this.height ||
          Math.abs(terrain.affine.a - this.metresPerCell) > 1e-8) {
        throw new Error("Elevation grid geometry does not match the displayed map.");
      }
      this.terrain = terrain;
    })]);
  }

  fit(points: readonly Cell[]): void {
    if (points.length === 0) throw new Error("At least one point is required to focus the map.");
    let minRow = Infinity; let maxRow = -Infinity; let minColumn = Infinity; let maxColumn = -Infinity;
    for (const point of points) {
      minRow = Math.min(minRow, point.row); maxRow = Math.max(maxRow, point.row);
      minColumn = Math.min(minColumn, point.column); maxColumn = Math.max(maxColumn, point.column);
    }
    const size = Math.min(Math.max(this.width, this.height), Math.max(75, Math.max(maxRow - minRow, maxColumn - minColumn) + 40));
    const row = (minRow + maxRow) / 2 - size / 2;
    const column = (minColumn + maxColumn) / 2 - size / 2;
    this.view = { size, row: Math.max(0, Math.min(this.height - size, row)), column: Math.max(0, Math.min(this.width - size, column)) };
    this.currentViewMode = "focus";
  }

  fitArea(): void {
    this.view = { row: 0, column: 0, size: Math.max(this.width, this.height) };
    this.currentViewMode = "area";
  }

  pick(clientX: number, clientY: number): Cell {
    const bounds = this.canvas.getBoundingClientRect();
    return {
      row: Math.max(0, Math.min(this.height - 1, Math.floor(this.view.row + (clientY - bounds.top) / bounds.height * this.view.size))),
      column: Math.max(0, Math.min(this.width - 1, Math.floor(this.view.column + (clientX - bounds.left) / bounds.width * this.view.size))),
    };
  }

  draw(layer: string, origin: Cell, selected: Destination, originals: readonly Destination[], plan: PlanResult | null, field: ScienceOpportunityField | null,
    state: "not_calculated" | "calculating" | "stale" | "current"): LayerDescription {
    const context = this.context;
    const canvas = this.canvas;
    const view = this.view;
    let range: ValueRange | null = null;
    let image: CanvasImageSource | undefined;
    if (layer === "elevation") {
      if (this.terrain === undefined) throw new Error("Numeric elevation data have not loaded.");
      range = visibleElevationRange(this.terrain, view);
      const temporary = document.createElement("canvas");
      temporary.width = this.width; temporary.height = this.height;
      const small = temporary.getContext("2d");
      if (small === null) throw new Error("Cannot draw the numeric elevation layer.");
      const pixels = small.createImageData(this.width, this.height);
      for (let index = 0; index < this.terrain.elevationM.length; index++) {
        if (range === null || this.terrain.known[index] !== 1) continue;
        const color = elevationColor(this.terrain.elevationM[index]!, range);
        pixels.data.set([...color, 255], index * 4);
      }
      small.putImageData(pixels, 0, 0);
      image = temporary;
    } else {
      image = this.images.get(layer === "opportunity" ? "optical" : layer);
    }
    if (image === undefined) throw new Error(`Map layer unavailable: ${layer}`);
    const imageWidth = layer === "elevation" ? this.width : (image instanceof HTMLImageElement ? image.width : this.width);
    const imageHeight = layer === "elevation" ? this.height : (image instanceof HTMLImageElement ? image.height : this.height);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = layer === "optical" || (layer === "opportunity" && field === null);
    context.drawImage(image, view.column / this.width * imageWidth, view.row / this.height * imageHeight,
      view.size / this.width * imageWidth, view.size / this.height * imageHeight, 0, 0, canvas.width, canvas.height);
    if (layer === "opportunity" && field !== null) {
      const temporary = document.createElement("canvas");
      temporary.width = this.width; temporary.height = this.height;
      const small = temporary.getContext("2d");
      if (small === null) throw new Error("Cannot draw the opportunity overlay.");
      const pixels = small.createImageData(this.width, this.height);
      const colors = [[166, 170, 175, 220], [24, 40, 54, 180], [105, 129, 148, 160],
        [204, 67, 55, 190], [28, 158, 111, 130], [235, 181, 54, 200]];
      for (let index = 0; index < field.codes.length; index++) {
        const color = colors[field.codes[index]!]!;
        for (let c = 0; c < 4; c++) pixels.data[index * 4 + c] = color[c]!;
      }
      small.putImageData(pixels, 0, 0);
      context.imageSmoothingEnabled = false;
      context.drawImage(temporary, view.column, view.row, view.size, view.size, 0, 0, canvas.width, canvas.height);
    }
    if (plan !== null) {
      for (const [route, color, dashed] of [[plan.outbound, "#67d5ff", false], [plan.return, "#ffb552", true]] as const) {
        if (route === null) continue;
        context.beginPath();
        route.cells.forEach((index, sequence) => {
          const x = (index % this.width + 0.5 - view.column) / view.size * canvas.width;
          const y = (Math.floor(index / this.width) + 0.5 - view.row) / view.size * canvas.height;
          if (sequence === 0) context.moveTo(x, y); else context.lineTo(x, y);
        });
        context.strokeStyle = color; context.lineWidth = dashed ? 3 : 7;
        context.setLineDash(dashed ? [9, 8] : []); context.stroke();
      }
      context.setLineDash([]);
    }
    const points = [{ ...origin, id: "H" }, ...originals, selected];
    const seen = new Set<string>();
    for (const point of points) {
      if (seen.has(point.id)) continue;
      seen.add(point.id);
      const x = (point.column + 0.5 - view.column) / view.size * canvas.width;
      const y = (point.row + 0.5 - view.row) / view.size * canvas.height;
      if (x < 0 || y < 0 || x > canvas.width || y > canvas.height) continue;
      context.beginPath(); context.arc(x, y, point.id === selected.id ? 9 : 7, 0, Math.PI * 2);
      context.fillStyle = "#fff"; context.fill();
      context.strokeStyle = "#17324d"; context.lineWidth = 2; context.stroke();
      context.font = "bold 22px system-ui"; context.lineWidth = 4;
      context.strokeText(point.id, x + 13, y + 7); context.fillText(point.id, x + 13, y + 7);
    }
    const scaleM = view.size * this.metresPerCell < 700 ? 100 : 250;
    const scalePixels = scaleM / (view.size * this.metresPerCell) * canvas.width;
    context.strokeStyle = "#fff"; context.lineWidth = 5;
    context.beginPath(); context.moveTo(24, canvas.height - 30); context.lineTo(24 + scalePixels, canvas.height - 30); context.stroke();
    context.font = "18px system-ui"; context.fillStyle = "#fff"; context.lineWidth = 3; context.strokeStyle = "#17324d";
    context.strokeText(`${scaleM} m (map scale)`, 24, canvas.height - 45); context.fillText(`${scaleM} m (map scale)`, 24, canvas.height - 45);
    context.strokeText("N", canvas.width - 35, 35); context.fillText("N", canvas.width - 35, 35);
    return describeLayer(layer, this.metadata, view.size * this.metresPerCell, range, state);
  }

  image(): string { return this.canvas.toDataURL("image/png"); }

  scienceEvidence(destination: Destination): ScienceEvidence {
    const science = destination.science;
    if (science === null) throw new Error("This destination has no recorded science evidence.");
    const optical = this.images.get("optical");
    const terrain = this.terrain;
    if (optical === undefined || terrain === undefined) throw new Error("Science evidence requires the prepared optical image and terrain grid.");
    const key = JSON.stringify([destination.id, destination.row, destination.column, science]);
    const cached = this.evidenceImages.get(key);
    if (cached !== undefined) return cached;
    const crop = science.crop;
    const geometry = evidenceGeometry(destination, crop, this.width, this.height, optical.width, optical.height);
    const thumbnail = document.createElement("canvas");
    thumbnail.width = geometry.outputSize; thumbnail.height = geometry.outputSize;
    const context = thumbnail.getContext("2d");
    if (context === null) throw new Error("Cannot render the science evidence crop.");
    context.imageSmoothingEnabled = false;
    context.drawImage(optical, geometry.sourceX, geometry.sourceY, geometry.sourceWidth, geometry.sourceHeight,
      0, 0, geometry.outputSize, geometry.outputSize);
    context.beginPath(); context.arc(geometry.markerX, geometry.markerY, 5, 0, Math.PI * 2);
    context.fillStyle = "#fff"; context.fill(); context.strokeStyle = "#17324d"; context.lineWidth = 2; context.stroke();
    context.font = "bold 17px system-ui"; context.lineWidth = 4;
    context.strokeText(destination.id, geometry.markerX + 9, geometry.markerY + 6);
    context.fillText(destination.id, geometry.markerX + 9, geometry.markerY + 6);
    let knownCells = 0;
    for (let row = crop.row; row < crop.row + crop.size; row++) {
      for (let column = crop.column; column < crop.column + crop.size; column++) {
        if (terrain.known[row * this.width + column] === 1) knownCells++;
      }
    }
    const range = visibleElevationRange(terrain, crop);
    const index = destination.row * this.width + destination.column;
    const evidence: ScienceEvidence = {
      image: thumbnail.toDataURL("image/png"),
      summary: {
        location: { row: destination.row, column: destination.column }, markerCode: destination.id,
        crop, geometry, imageAsset: "./data/optical.webp",
        opticalSourceId: science.opticalSourceId, terrainSourceId: science.terrainSourceId,
        viewWidthM: crop.size * this.metresPerCell,
        opticalDisplayMetresPerPixel: this.metresPerCell * this.width / optical.width,
        modelMetresPerCell: this.metresPerCell, knownCells, totalCells: crop.size ** 2,
        elevationMinimumM: range?.minimum ?? null, elevationMaximumM: range?.maximum ?? null,
        targetElevationM: terrain.known[index] === 1 ? terrain.elevationM[index]! : null,
        targetSlopeMaxDegrees: terrain.known[index] === 1 ? terrain.slopeMaxDegrees[index]! : null,
      },
    };
    this.evidenceImages.set(key, evidence);
    return evidence;
  }
}
