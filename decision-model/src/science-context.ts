import { finiteNumber, objectValue, parseCell } from "./engine.js";
import type { Cell } from "./engine.js";
import type { SourceReference } from "./workflow.js";

export interface EvidenceWindow extends Cell {
  readonly size: number;
}

export interface ScienceContext {
  readonly status: "image_supported_candidate";
  readonly question: string;
  readonly observationTask: string;
  readonly whyHere: string;
  readonly observed: string;
  readonly interpretation: string;
  readonly opticalObservationDate: string;
  readonly observationPageUrl: string;
  readonly opticalSourceId: string;
  readonly terrainSourceId: string;
  readonly thermalSourceId: string;
  readonly crop: EvidenceWindow;
}

export interface EvidenceGeometry {
  readonly sourceX: number;
  readonly sourceY: number;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly markerX: number;
  readonly markerY: number;
  readonly outputSize: number;
}

export interface EvidenceSummary {
  readonly location: Cell;
  readonly markerCode: string;
  readonly crop: EvidenceWindow;
  readonly geometry: EvidenceGeometry;
  readonly imageAsset: string;
  readonly opticalSourceId: string;
  readonly terrainSourceId: string;
  readonly viewWidthM: number;
  readonly opticalDisplayMetresPerPixel: number;
  readonly modelMetresPerCell: number;
  readonly knownCells: number;
  readonly totalCells: number;
  readonly elevationMinimumM: number | null;
  readonly elevationMaximumM: number | null;
  readonly targetElevationM: number | null;
  readonly targetSlopeMaxDegrees: number | null;
}

export interface ScienceEvidence {
  readonly image: string;
  readonly summary: EvidenceSummary;
}

interface ScienceLocation extends Cell {
  readonly id: string;
  readonly science: ScienceContext | null;
}

export function requiredText(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} must be a non-empty string.`);
  return value;
}

export function sourceUrl(value: unknown, name: string): string {
  const url = new URL(requiredText(value, name));
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`${name} must use HTTP(S).`);
  return url.href;
}

function positiveInteger(value: unknown, name: string): number {
  const result = finiteNumber(value, name, 1);
  if (!Number.isInteger(result)) throw new Error(`${name} must be an integer.`);
  return result;
}

export function parseScienceContext(value: unknown, location: Cell, width: number, height: number): ScienceContext {
  const raw = objectValue(value, "science context");
  if (raw["status"] !== "image_supported_candidate") throw new Error("Science context must identify an image-supported candidate.");
  const window = objectValue(raw["crop"], "science evidence window");
  const crop = { ...parseCell(window, "science evidence window"), size: positiveInteger(window["size"], "science evidence size") };
  evidenceGeometry(location, crop, width, height, width, height);
  const result: ScienceContext = {
    status: "image_supported_candidate",
    question: requiredText(raw["question"], "science question"),
    observationTask: requiredText(raw["observationTask"], "science observation task"),
    whyHere: requiredText(raw["whyHere"], "science location rationale"),
    observed: requiredText(raw["observed"], "image observation"),
    interpretation: requiredText(raw["interpretation"], "interpretation to investigate"),
    opticalObservationDate: requiredText(raw["opticalObservationDate"], "optical observation date"),
    observationPageUrl: sourceUrl(raw["observationPageUrl"], "observation metadata URL"),
    opticalSourceId: requiredText(raw["opticalSourceId"], "optical evidence source"),
    terrainSourceId: requiredText(raw["terrainSourceId"], "terrain evidence source"),
    thermalSourceId: requiredText(raw["thermalSourceId"], "thermal context source"),
    crop,
  };
  if (new Set([result.opticalSourceId, result.terrainSourceId, result.thermalSourceId]).size !== 3) {
    throw new Error("Science context must distinguish the optical, terrain and regional thermal sources.");
  }
  return result;
}

export function evidenceGeometry(location: Cell, crop: EvidenceWindow, width: number, height: number,
  imageWidth: number, imageHeight: number, outputSize = 360): EvidenceGeometry {
  const cell = parseCell(location, "science evidence location");
  const origin = parseCell(crop, "science evidence window");
  const size = positiveInteger(crop.size, "science evidence size");
  for (const [value, name] of [[width, "grid width"], [height, "grid height"], [imageWidth, "optical image width"],
    [imageHeight, "optical image height"], [outputSize, "evidence output size"]] as const) positiveInteger(value, name);
  if (origin.row + size > height || origin.column + size > width ||
      cell.row < origin.row || cell.row >= origin.row + size || cell.column < origin.column || cell.column >= origin.column + size) {
    throw new Error("The science evidence window must be inside the grid and contain its selected location.");
  }
  return {
    sourceX: origin.column / width * imageWidth, sourceY: origin.row / height * imageHeight,
    sourceWidth: size / width * imageWidth, sourceHeight: size / height * imageHeight,
    markerX: (cell.column + 0.5 - origin.column) / size * outputSize,
    markerY: (cell.row + 0.5 - origin.row) / size * outputSize, outputSize,
  };
}

export function scienceSources(science: ScienceContext, sources: readonly SourceReference[]): readonly { source: SourceReference; role: string }[] {
  return [
    [science.opticalSourceId, "Location-specific optical evidence"],
    [science.terrainSourceId, "Elevation and slope context; terrain routing"],
    [science.thermalSourceId, "Regional qualitative thermal context; native 100 m spacing"],
  ].map(([id, role]) => {
    const source = sources.find(item => item.id === id);
    if (source === undefined) throw new Error(`Unknown science source: ${id}`);
    if ((id === science.opticalSourceId && source.dataType !== "optical") ||
        (id === science.terrainSourceId && source.dataType !== "topographic") ||
        (id === science.thermalSourceId && !source.dataType.includes("thermal"))) {
      throw new Error(`Science source data type does not match its evidence role: ${id}`);
    }
    return { source, role: requiredText(role, "science source role") };
  });
}

export function evidenceCaption(summary: EvidenceSummary): string {
  const crop = summary.crop;
  return `Marker ${summary.markerCode}: row ${summary.location.row}, column ${summary.location.column}. ` +
    `Prepared optical crop: rows ${crop.row}-${crop.row + crop.size - 1}, columns ${crop.column}-${crop.column + crop.size - 1}. ` +
    `View width ${summary.viewWidthM.toFixed(1)} m; optical display spacing ${summary.opticalDisplayMetresPerPixel.toFixed(2)} m/pixel. ` +
    "The marker is a scenario annotation on the unchanged optical display.";
}

function assertEvidenceMatches(location: ScienceLocation, summary: EvidenceSummary | null): void {
  const science = location.science;
  if (science === null) {
    if (summary !== null) throw new Error("A planning example cannot inherit another location's science evidence.");
    return;
  }
  if (summary !== null && (summary.markerCode !== location.id || summary.location.row !== location.row || summary.location.column !== location.column ||
      summary.opticalSourceId !== science.opticalSourceId || summary.terrainSourceId !== science.terrainSourceId ||
      summary.crop.row !== science.crop.row || summary.crop.column !== science.crop.column || summary.crop.size !== science.crop.size)) {
    throw new Error("Science evidence does not match the selected location and sources.");
  }
}

export function scienceExportContext(location: ScienceLocation, sources: readonly SourceReference[], summary: EvidenceSummary | null) {
  assertEvidenceMatches(location, summary);
  if (location.science === null) return null;
  if (summary === null) throw new Error("A science export requires its current evidence snapshot.");
  return {
    ...location.science, location: { row: location.row, column: location.column }, markerCode: location.id,
    evidence: summary, references: scienceSources(location.science, sources),
  };
}

export function scienceBriefLines(location: ScienceLocation, sources: readonly SourceReference[],
  summary: EvidenceSummary | null = null): readonly string[] {
  assertEvidenceMatches(location, summary);
  const science = location.science;
  if (science === null) return [];
  return [
    "", "SCIENCE CONTEXT - IMAGE-SUPPORTED CANDIDATE",
    `Science question: ${science.question}`,
    `What to observe: ${science.observationTask}`,
    `Why here: ${science.whyHere}`,
    `Observed in imagery: ${science.observed}`,
    `Interpretation to investigate: ${science.interpretation}`,
    `Optical observation date: ${science.opticalObservationDate}`,
    `Acquisition metadata: ${science.observationPageUrl}`,
    `Evidence location: row ${location.row}, column ${location.column}; crop row ${science.crop.row}, column ${science.crop.column}, size ${science.crop.size} cells.`,
    "Scientific rationale and route/time feasibility are assessed separately.",
    ...(summary === null ? [] : [evidenceCaption(summary)]),
    ...scienceSources(science, sources).map(({ source, role }) =>
      `${role}: ${source.productId}\n${source.providerUrl}\nOriginal product: ${source.url}\nSHA-256: ${source.sha256}`),
  ];
}
