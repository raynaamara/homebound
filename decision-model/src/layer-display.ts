import { finiteNumber, objectValue } from "./engine.js";
import type { TerrainGrid } from "./engine.js";

export interface MapViewport { readonly column: number; readonly row: number; readonly size: number }
export interface ValueRange { readonly minimum: number; readonly maximum: number }
export type RGB = readonly [number, number, number];
export const ELEVATION_COLORS: readonly RGB[] = [
  [37, 63, 120], [41, 126, 167], [73, 173, 159], [181, 204, 121], [249, 224, 137],
];
export interface LayerMetadata {
  readonly thermalResolutionM: number;
  readonly slopeDisplayMaximumDegrees: number;
}
export interface LayerScale extends ValueRange {
  readonly title: string;
  readonly units: string;
  readonly colors: readonly RGB[];
}
export interface LayerDescription {
  readonly title: string;
  readonly detail: string;
  readonly notice: string | null;
  readonly scale: LayerScale | null;
}

export function parseLayerMetadata(value: unknown): LayerMetadata {
  const raw = objectValue(value, "layer metadata");
  if (!Array.isArray(raw["display_assets"])) throw new Error("Layer display metadata are missing.");
  const assets = raw["display_assets"].map((item: unknown) => objectValue(item, "display asset"));
  const thermal = assets.find(item => item["url"] === "thermal_context.png");
  const slope = assets.find(item => item["url"] === "slope.png");
  if (thermal === undefined || slope === undefined) throw new Error("Thermal or slope display metadata are absent.");
  const thermalResolutionM = finiteNumber(thermal["native_resolution_m"], "native thermal resolution", Number.MIN_VALUE);
  const range = slope["display_range_degrees"];
  if (!Array.isArray(range) || range.length !== 2 || range[0] !== 0) throw new Error("Unsupported slope display range.");
  return {
    thermalResolutionM,
    slopeDisplayMaximumDegrees: finiteNumber(range[1], "slope display maximum", Number.MIN_VALUE),
  };
}

export function visibleElevationRange(grid: TerrainGrid, view: MapViewport): ValueRange | null {
  if (![view.column, view.row, view.size].every(Number.isFinite) || view.size <= 0) {
    throw new Error("The displayed map window must be finite and have positive size.");
  }
  let minimum = Infinity;
  let maximum = -Infinity;
  for (let row = Math.max(0, Math.floor(view.row)); row < Math.min(grid.height, Math.ceil(view.row + view.size)); row++) {
    for (let column = Math.max(0, Math.floor(view.column)); column < Math.min(grid.width, Math.ceil(view.column + view.size)); column++) {
      const index = row * grid.width + column;
      const value = grid.elevationM[index]!;
      if (grid.known[index] !== 1 || !Number.isFinite(value)) continue;
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
    }
  }
  return minimum === Infinity ? null : { minimum, maximum };
}

export function elevationColor(value: number, range: ValueRange): RGB {
  if (![value, range.minimum, range.maximum].every(Number.isFinite) || range.maximum < range.minimum) {
    throw new Error("A color scale requires a finite value and ordered range.");
  }
  const normalized = range.maximum === range.minimum ? 0.5
    : Math.max(0, Math.min(1, (value - range.minimum) / (range.maximum - range.minimum)));
  const position = normalized * (ELEVATION_COLORS.length - 1);
  const index = Math.min(ELEVATION_COLORS.length - 2, Math.floor(position));
  const fraction = position - index;
  const left = ELEVATION_COLORS[index]!;
  const right = ELEVATION_COLORS[index + 1]!;
  return [
    Math.round(left[0] + (right[0] - left[0]) * fraction),
    Math.round(left[1] + (right[1] - left[1]) * fraction),
    Math.round(left[2] + (right[2] - left[2]) * fraction),
  ];
}

export function describeLayer(
  layer: string,
  metadata: LayerMetadata,
  viewWidthM: number,
  range: ValueRange | null,
  state: "not_calculated" | "calculating" | "stale" | "current",
): LayerDescription {
  if (layer === "opportunity") {
    const notice = state === "current" ? null : state === "calculating"
      ? "Calculating the time-margin overlay. Optical base shown until the current result is ready."
      : state === "stale"
        ? "The plan changed. Recalculate in Activities / Review, or restore the original comparison. Optical base shown; no current overlay is displayed."
        : "This overlay needs a calculated plan. Complete Activities / Review first. Optical base shown; time-margin colors are not available yet.";
    return {
      title: state === "current" ? "Current time-margin overlay" : "Time-margin overlay not available",
      detail: state === "current"
        ? "Colors show routing and time-budget outcomes for the current observation duration and reserve."
        : "This calculated layer becomes available after you review the current plan.",
      notice, scale: null,
    };
  }
  if (layer === "elevation") {
    return {
      title: "Elevation: visible-view contrast",
      detail: range === null ? "No valid elevation samples in this view; unknown data are not replaced with zero."
        : range.minimum === range.maximum
          ? "All known samples in this view share the same elevation and are shown in one color."
          : "Colors stretch across the elevations in the current view. The legend changes when you focus or fit the map; numeric terrain and model inputs are unchanged.",
      notice: range === null ? "Elevation data are unavailable in this displayed window." : null,
      scale: range === null ? null : {
        ...range, title: "Elevation above the source Mars datum", units: "m",
        colors: range.minimum === range.maximum ? [elevationColor(range.minimum, range)] : ELEVATION_COLORS,
      },
    };
  }
  if (layer === "thermal") {
    return {
      title: "Qualitative thermal context",
      detail: `Native information spacing: ${metadata.thermalResolutionM} m. This view is about ${Math.round(viewWidthM)} m wide, or ${(viewWidthM / metadata.thermalResolutionM).toFixed(1)} native pixel widths. The blocks preserve the source resolution. Gray values are relative display codes for qualitative thermal context.`,
      notice: null,
      scale: { minimum: 0, maximum: 255, title: "Relative grayscale display code", units: "DN", colors: [[0, 0, 0], [255, 255, 255]] },
    };
  }
  if (layer === "slope") {
    return {
      title: "Maximum native slope per model cell",
      detail: "Derived from topography. The upper color also includes values steeper than the displayed maximum.",
      notice: null,
      scale: { minimum: 0, maximum: metadata.slopeDisplayMaximumDegrees, title: "Slope; upper color includes values above the displayed maximum", units: "degrees", colors: [[28, 62, 91], [30, 153, 150], [248, 188, 69], [188, 46, 40]] },
    };
  }
  if (layer !== "optical") throw new Error(`Unknown map layer: ${layer}`);
  return { title: "Optical surface context", detail: "HiRISE image brightness provides visual surface context with a display contrast stretch.", notice: null, scale: null };
}
