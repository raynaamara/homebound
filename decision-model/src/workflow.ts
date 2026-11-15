import { finiteNumber, objectValue, parseCell, parseMission, parseTravelParameters } from "./engine.js";
import type { Cell, MissionInput, PlanResult, TravelParameters } from "./engine.js";
import type { CalculateRequest, CalculationResponse, Scenario } from "./protocol.js";
import { parseScienceContext, requiredText as text, scienceBriefLines, sourceUrl } from "./science-context.js";
import type { EvidenceSummary, ScienceContext } from "./science-context.js";

export const APPLICATION_VERSION = "1.1.12";
export type Step = 1 | 2 | 3 | 4;

export interface PlanningPreset {
  readonly id: "science_walkthrough" | "terrain_exploration";
  readonly name: string;
  readonly description: string;
  readonly missionBudgetMinutes: number;
  readonly reserveMinutes: number;
  readonly parameters: TravelParameters;
}

export interface PlanningPresetCatalog {
  readonly defaultPreset: PlanningPreset;
  readonly presets: readonly PlanningPreset[];
}

export interface PlanningPresetContext {
  readonly id: PlanningPreset["id"] | null;
  readonly name: string;
  readonly description: string;
  readonly scope: string;
}

export interface Destination extends Cell {
  readonly id: string;
  readonly name: string;
  readonly scienceMinutes: number;
  readonly kind: "hypothetical_practice" | "science_candidate" | "original_case" | "custom";
  readonly description: string;
  readonly objective: string;
  readonly evidence: string;
  readonly science: ScienceContext | null;
}

export function destinationCode(destination: Pick<Destination, "id" | "kind">): string {
  if (destination.kind === "custom") {
    if (destination.id !== "custom" && destination.id !== "X") throw new Error("Custom destinations must use map code X.");
    return "X";
  }
  if (!/^[A-Z]$/.test(destination.id) || destination.id === "H" || destination.id === "X") {
    throw new Error("A destination requires its own single-letter map code; H is reserved for the origin.");
  }
  return destination.id;
}

export function destinationLabel(destination: Pick<Destination, "id" | "kind" | "name">): string {
  return `Location ${destinationCode(destination)}: ${destination.name}`;
}

export function markerKey(destinations: readonly Destination[]): readonly { code: string; name: string; note: string }[] {
  const entries = [
    { code: "H", name: "Scenario planning origin", note: "Fixed starting and return point for this map." },
    ...destinations.map(destination => ({
      code: destinationCode(destination), name: destination.name,
      note: destination.kind === "hypothetical_practice" ? "Guided-practice waypoint." :
        destination.kind === "science_candidate" ? "Image-supported science observation candidate." : "Example observation location.",
    })),
    { code: "X", name: "Custom inspection point", note: "Appears on the map only when a custom point is selected." },
  ];
  if (new Set(entries.map(entry => entry.code)).size !== entries.length) throw new Error("Map marker codes must be unique.");
  return entries;
}

export interface SourceReference {
  readonly id: string;
  readonly mission: string;
  readonly instrument: string;
  readonly dataType: string;
  readonly role: string;
  readonly productId: string;
  readonly url: string;
  readonly providerUrl: string;
  readonly sha256: string;
}

export interface GeographicBounds {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

export interface RegionalContext {
  readonly title: string;
  readonly imageAsset: string;
  readonly imageSha256: string;
  readonly description: string;
  readonly scope: string;
  readonly usedForRouting: false;
  readonly nativeResolutionM: number;
  readonly credit: string;
  readonly source: SourceReference;
  readonly studyArea: {
    readonly bounds: GeographicBounds;
    readonly widthM: number;
    readonly heightM: number;
    readonly latitudeConvention: "planetocentric";
    readonly longitudeConvention: "east-positive";
  };
  readonly mapBounds: GeographicBounds;
  readonly serviceMetadata: { readonly url: string; readonly sha256: string };
  readonly tiles: readonly { readonly url: string; readonly sha256: string }[];
  readonly georeferencingSourceSha256: string;
}

export interface PlanComparison {
  readonly statusChanged: boolean;
  readonly extraScienceMinutes: number;
  readonly requiredDeltaMinutes: number | null;
  readonly marginDeltaMinutes: number | null;
  readonly evaluable: boolean;
}

export const CLAIM_BOUNDARY = "Planning estimates for the selected Mars terrain and mission assumptions.";

export function destinationKindLabel(destination: Pick<Destination, "kind">): string {
  switch (destination.kind) {
    case "hypothetical_practice": return "Guided practice";
    case "science_candidate": return "Science observation candidate";
    case "original_case": return "Observation example";
    case "custom": return "Custom location";
  }
}

function applicationConfiguration(value: unknown): Record<string, unknown> {
  const config = objectValue(value, "application configuration");
  if (config["applicationVersion"] !== APPLICATION_VERSION || config["scenarioPolicy"] !== "guided_practice") {
    throw new Error("Unsupported application configuration or scenario policy.");
  }
  return config;
}

export function planningPresetsFromConfig(scenario: Scenario, nominal: TravelParameters, value: unknown): PlanningPresetCatalog {
  const config = applicationConfiguration(value);
  const entries = config["planningPresets"];
  if (!Array.isArray(entries) || entries.length !== 2) throw new Error("Two explicit planning presets are required.");
  const presets = entries.map((entry: unknown): PlanningPreset => {
    const raw = objectValue(entry, "planning preset");
    const id = raw["id"];
    if (id !== "science_walkthrough" && id !== "terrain_exploration") throw new Error("Unknown planning preset identifier.");
    return {
      id, name: text(raw["name"], "planning preset name"), description: text(raw["description"], "planning preset description"),
      missionBudgetMinutes: finiteNumber(raw["missionBudgetMinutes"], "preset mission budget"),
      reserveMinutes: scenario.reserveMinutes,
      parameters: parseTravelParameters({ ...nominal, maximumSlopeDegrees: raw["maximumSlopeDegrees"] }),
    };
  });
  if (new Set(presets.map(preset => preset.id)).size !== presets.length) throw new Error("Planning preset identifiers must be unique.");
  const defaultPreset = presets.find(preset => preset.id === config["defaultPlanningPreset"]);
  if (defaultPreset?.id !== "science_walkthrough" ||
      planningPresetForInputs([defaultPreset], { missionBudgetMinutes: scenario.missionBudgetMinutes, reserveMinutes: scenario.reserveMinutes }, nominal) === null) {
    throw new Error("The default Science walkthrough must preserve the original scenario and travel assumptions.");
  }
  return { defaultPreset, presets };
}

export function planningPresetForInputs(presets: readonly PlanningPreset[],
  mission: Pick<MissionInput, "missionBudgetMinutes" | "reserveMinutes">, parameters: TravelParameters): PlanningPreset | null {
  return presets.find(preset => preset.missionBudgetMinutes === mission.missionBudgetMinutes && preset.reserveMinutes === mission.reserveMinutes &&
    preset.parameters.baseSpeedMPerMin === parameters.baseSpeedMPerMin && preset.parameters.maximumSlopeDegrees === parameters.maximumSlopeDegrees &&
    preset.parameters.uphillPenalty === parameters.uphillPenalty && preset.parameters.downhillPenalty === parameters.downhillPenalty) ?? null;
}

export function planningPresetContext(presets: readonly PlanningPreset[],
  mission: Pick<MissionInput, "missionBudgetMinutes" | "reserveMinutes">, parameters: TravelParameters): PlanningPresetContext {
  const preset = planningPresetForInputs(presets, mission, parameters);
  return {
    id: preset?.id ?? null, name: preset?.name ?? "Custom settings",
    description: preset?.description ?? "Manually edited budget, reserve or travel assumptions.",
    scope: "Budget, reserve and travel assumptions only; destination and observation duration are separate.",
  };
}

export function destinationsFromConfig(scenario: Scenario, value: unknown): readonly Destination[] {
  const config = applicationConfiguration(value);
  const practice = objectValue(config["practice"], "practice waypoint");
  const cell = parseCell(practice, "practice waypoint");
  if (practice["kind"] !== "hypothetical_practice" || cell.row >= scenario.gridHeight || cell.column >= scenario.gridWidth) {
    throw new Error("Practice must be explicitly hypothetical and inside the declared grid.");
  }
  const originals = objectValue(config["originalCases"], "original case descriptions");
  const first: Destination = {
    ...cell, id: text(practice["id"], "practice id"), name: text(practice["name"], "practice name"),
    scienceMinutes: finiteNumber(practice["scienceMinutes"], "practice observation minutes"),
    kind: "hypothetical_practice",
    description: text(practice["description"], "practice description"),
    objective: text(practice["objective"], "practice objective"),
    evidence: text(practice["evidence"], "practice evidence"),
    science: null,
  };
  if (first.id === "H" || first.id === "custom" || scenario.targets.some(point => point.id === first.id)) {
    throw new Error("Practice identifier conflicts with another destination.");
  }
  const candidate = objectValue(config["scienceCandidate"], "science candidate");
  const candidateCell = parseCell(candidate, "science candidate");
  if (candidate["kind"] !== "science_candidate") throw new Error("The science waypoint must be an observation candidate.");
  const science = parseScienceContext(candidate["science"], candidateCell, scenario.gridWidth, scenario.gridHeight);
  const supported: Destination = {
    ...candidateCell, id: text(candidate["id"], "science candidate id"), name: text(candidate["name"], "science candidate name"),
    scienceMinutes: finiteNumber(candidate["scienceMinutes"], "science candidate observation minutes"),
    kind: "science_candidate", description: text(candidate["description"], "science candidate description"),
    objective: science.question, evidence: science.observed, science,
  };
  destinationCode(supported);
  if (supported.id !== "S") throw new Error("The recorded science candidate must use map code S.");
  if (supported.id === first.id || scenario.targets.some(point => point.id === supported.id)) throw new Error("Science candidate identifier conflicts with another destination.");
  return [
    first,
    supported,
    ...scenario.targets.map(point => ({
      ...point, kind: "original_case" as const,
      description: text(originals[point.id], `description for ${point.id}`),
      objective: "Plan an observation here and compare its round-trip and activity timing.",
      evidence: "This example uses prepared terrain data at the original scenario coordinates.",
      science: null,
    })),
  ];
}

export function parseSources(value: unknown): readonly SourceReference[] {
  const raw = objectValue(value, "source summary");
  if (!Array.isArray(raw["sources"]) || raw["sources"].length === 0) throw new Error("Source references are missing.");
  return raw["sources"].map((item: unknown) => {
    const source = objectValue(item, "source");
    const url = sourceUrl(source["url"], "source URL");
    const providerUrl = sourceUrl(source["provider_page"], "source provider page");
    return {
      id: text(source["id"], "source id"), mission: text(source["mission"], "mission"),
      instrument: text(source["instrument"], "instrument"),
      dataType: text(source["data_type"], "source data type"),
      role: text(source["role"], "source role"),
      productId: text(source["product_id"], "product id"), url, providerUrl,
      sha256: text(source["sha256"], "source hash"),
    };
  });
}

export function parseRegionalContext(value: unknown, sources: readonly SourceReference[]): RegionalContext {
  const raw = objectValue(value, "regional context");
  if (raw["schemaVersion"] !== 1 || raw["usedForRouting"] !== false) {
    throw new Error("Regional context must use schema 1 and remain separate from route calculation.");
  }
  if (raw["imageAsset"] !== "regional-context.svg") throw new Error("Regional context requires its local prepared map image.");
  const matches = sources.filter(source => source.id === raw["sourceId"]);
  const source = matches[0];
  if (matches.length !== 1 || source === undefined || source.mission !== "Mars Global Surveyor" ||
      source.instrument !== "MOLA" || source.dataType !== "regional topographic visualization") {
    throw new Error("Regional context must resolve its distinct MGS/MOLA source.");
  }
  function hash(value: unknown, name: string): string {
    const result = text(value, name);
    if (!/^[a-f0-9]{64}$/.test(result)) throw new Error(`${name} must be a SHA-256 digest.`);
    return result;
  }
  function bounds(value: unknown): GeographicBounds {
    const item = objectValue(value, "Mars geographic bounds");
    const result = {
      west: finiteNumber(item["west"], "western longitude", -180),
      east: finiteNumber(item["east"], "eastern longitude", -180),
      south: finiteNumber(item["south"], "southern latitude", -90),
      north: finiteNumber(item["north"], "northern latitude", -90),
    };
    if (result.west >= result.east || result.east > 180 || result.south >= result.north || result.north > 90) {
      throw new Error("Mars geographic bounds must be ordered within the regional map's longitude/latitude range.");
    }
    return result;
  }
  const area = objectValue(raw["studyArea"], "study area");
  if (area["latitudeConvention"] !== "planetocentric" || area["longitudeConvention"] !== "east-positive") {
    throw new Error("Regional context requires the recorded Mars coordinate conventions.");
  }
  const areaBounds = bounds(area["bounds"]);
  const mapBounds = bounds(raw["mapBounds"]);
  if (areaBounds.west < mapBounds.west || areaBounds.east > mapBounds.east ||
      areaBounds.south < mapBounds.south || areaBounds.north > mapBounds.north) {
    throw new Error("The regional map must contain the complete study-area footprint.");
  }
  if (!Array.isArray(raw["tiles"]) || raw["tiles"].length !== 4) throw new Error("Regional context requires its four original source tiles.");
  const tiles = raw["tiles"].map((item: unknown) => {
    const tile = objectValue(item, "regional source tile");
    return { url: sourceUrl(tile["url"], "regional source tile URL"), sha256: hash(tile["sha256"], "regional source tile hash") };
  });
  if (new Set(tiles.map(tile => tile.url)).size !== tiles.length ||
      !tiles.some(tile => tile.url === source.url && tile.sha256 === source.sha256)) {
    throw new Error("Regional source tiles must be distinct and match the catalogued study-area tile.");
  }
  const metadata = objectValue(raw["serviceMetadata"], "regional service metadata");
  const georeferencing = objectValue(raw["georeferencing"], "regional georeferencing");
  return {
    title: text(raw["title"], "regional context title"),
    imageAsset: raw["imageAsset"], imageSha256: hash(raw["imageSha256"], "regional image hash"),
    description: text(raw["description"], "regional context description"),
    scope: text(raw["scope"], "regional context scope"),
    usedForRouting: false, nativeResolutionM: finiteNumber(raw["nativeResolutionM"], "regional source spacing", Number.MIN_VALUE),
    credit: text(raw["credit"], "regional image credit"), source,
    studyArea: { bounds: areaBounds, widthM: finiteNumber(area["widthM"], "study-area width", Number.MIN_VALUE),
      heightM: finiteNumber(area["heightM"], "study-area height", Number.MIN_VALUE),
      latitudeConvention: "planetocentric", longitudeConvention: "east-positive" },
    mapBounds,
    serviceMetadata: { url: sourceUrl(metadata["url"], "regional service metadata URL"), sha256: hash(metadata["sha256"], "regional metadata hash") },
    tiles, georeferencingSourceSha256: hash(georeferencing["sourceMetadataSha256"], "study-area georeferencing hash"),
  };
}

export function regionalBriefLines(context: RegionalContext): readonly string[] {
  const bounds = context.studyArea.bounds;
  return [
    "", "REGIONAL CONTEXT - NASA MARS TREK", context.description,
    `Source: ${context.source.mission} / ${context.source.instrument}: ${context.source.productId}`,
    `Use: ${context.scope} Source spacing about ${context.nativeResolutionM} m.`,
    `Study area: ${bounds.west.toFixed(5)} to ${bounds.east.toFixed(5)} degrees east; ${bounds.south.toFixed(5)} to ${bounds.north.toFixed(5)} degrees planetocentric latitude.`,
    `Study-area size: ${context.studyArea.widthM.toFixed(1)} x ${context.studyArea.heightM.toFixed(1)} m.`,
    "The footprint is georeferenced; the larger locator ring is for visibility, not a walking route.",
    `Credit: ${context.credit}`,
    `Provider: ${context.source.providerUrl}`,
    `Service metadata: ${context.serviceMetadata.url}\nSHA-256: ${context.serviceMetadata.sha256}`,
    `Prepared image: ${context.imageAsset}\nSHA-256: ${context.imageSha256}`,
    `Study-area georeferencing SHA-256: ${context.georeferencingSourceSha256}`,
    ...context.tiles.map(tile => `Original WMTS tile: ${tile.url}\nSHA-256: ${tile.sha256}`),
  ];
}

export function requestKey(input: Pick<CalculateRequest, "origin" | "destination" | "parameters" | "mission">): string {
  const { origin, destination, parameters, mission } = input;
  return JSON.stringify([
    origin.row, origin.column, destination.row, destination.column,
    parameters.baseSpeedMPerMin, parameters.maximumSlopeDegrees, parameters.uphillPenalty, parameters.downhillPenalty,
    mission.missionBudgetMinutes, mission.scienceMinutes, mission.reserveMinutes,
  ]);
}

function comparisonKey(plan: PlanResult): string {
  return requestKey({ ...plan, mission: { ...plan.mission, scienceMinutes: 0 } });
}

export function comparePlans(baseline: PlanResult, revised: PlanResult): PlanComparison {
  if (comparisonKey(baseline) !== comparisonKey(revised)) {
    throw new Error("Only observation duration may differ in this comparison. Rebuild the original plan after other changes.");
  }
  const extraScienceMinutes = revised.mission.scienceMinutes - baseline.mission.scienceMinutes;
  if (extraScienceMinutes < 0) throw new Error("The additional observation duration cannot be negative.");
  return {
    statusChanged: baseline.status !== revised.status,
    extraScienceMinutes,
    requiredDeltaMinutes: baseline.time !== null && revised.time !== null ? revised.time.requiredMinutes - baseline.time.requiredMinutes : null,
    marginDeltaMinutes: baseline.time !== null && revised.time !== null ? revised.time.marginMinutes - baseline.time.marginMinutes : null,
    evaluable: baseline.time !== null && revised.time !== null,
  };
}

export function missionWithExtra(mission: MissionInput, extra: number): MissionInput {
  finiteNumber(extra, "additional observation minutes");
  return parseMission({ ...mission, scienceMinutes: mission.scienceMinutes + extra });
}

export function decisionTitle(plan: PlanResult): string {
  switch (plan.status) {
    case "FEASIBLE": return plan.time?.zeroExtraMargin ? "Fits the time model, with no extra margin" : "Fits the current time model";
    case "TIME_BUDGET_EXCEEDED": return "Revise this plan: time budget exceeded";
    case "NO_MODELED_ROUTE": return "No route under the selected assumptions";
    case "INSUFFICIENT_DATA": return "Not enough data to evaluate this plan";
  }
}

export function nextAction(plan: PlanResult): string {
  switch (plan.status) {
    case "FEASIBLE": return "Compare a longer observation or save your mission brief.";
    case "TIME_BUDGET_EXCEEDED": return "Reduce observation time or adjust the plan while retaining your protected reserve.";
    case "NO_MODELED_ROUTE": return "Compare another destination or review the selected terrain and slope settings.";
    case "INSUFFICIENT_DATA": return "Review data coverage or select a location with complete terrain inputs.";
  }
}

export function decisionExplanation(plan: PlanResult): string {
  if (plan.time !== null) {
    const time = plan.time;
    return plan.status === "FEASIBLE"
      ? `Your complete round trip fits the selected budget, retains ${time.reserveMinutes.toFixed(2)} minutes of protected reserve, and leaves ${time.marginMinutes.toFixed(2)} additional minutes.`
      : `This plan needs ${(-time.marginMinutes).toFixed(2)} minutes more than the selected budget. The calculation retains ${time.reserveMinutes.toFixed(2)} minutes of protected reserve.`;
  }
  return plan.status === "INSUFFICIENT_DATA"
    ? "This location needs additional terrain data before a complete round trip can be evaluated."
    : "The current terrain settings exclude a complete round trip for this destination. Compare another location or review the route assumptions.";
}

export function displayedPlan(plan: PlanResult): PlanResult {
  return { ...plan, explanation: decisionExplanation(plan) };
}

export function minutes(value: number | null): string {
  if (value === null) return "Not evaluable";
  if (!Number.isFinite(value)) throw new Error("A displayed time must be finite or explicitly unavailable.");
  return `${Math.abs(value) > 0 && Math.abs(value) < 0.01 ? value.toPrecision(3) : value.toFixed(2)} min`;
}

export function briefText(destination: Destination, response: CalculationResponse, baseline: PlanResult | null, sources: readonly SourceReference[],
  scienceEvidence: EvidenceSummary | null = null, regionalContext: RegionalContext | null = null, planningPresets: readonly PlanningPreset[] = []): string {
  const { plan } = response;
  if (destination.row !== plan.destination.row || destination.column !== plan.destination.column) {
    throw new Error("The mission brief destination does not match the calculated plan.");
  }
  const time = plan.time;
  const comparison = baseline === null ? null : comparePlans(baseline, plan);
  return [
    "HOMEBOUND - MISSION BRIEF",
    `Application ${APPLICATION_VERSION}; decision model ${plan.modelVersion}`,
    CLAIM_BOUNDARY,
    "",
    "Origin / return marker: H (fixed scenario starting point).",
    `Destination: ${destinationLabel(destination)}`,
    `Scenario: ${destinationKindLabel(destination)}`,
    `Purpose: ${destination.objective}`,
    `Location: row ${plan.destination.row}, column ${plan.destination.column} (zero-based Mars grid)`,
    `Scenario context: ${destination.evidence}`,
    ...scienceBriefLines(destination, sources, scienceEvidence),
    ...(regionalContext === null ? [] : regionalBriefLines(regionalContext)),
    "",
    ...(planningPresets.length === 0 ? [] : [`Planning preset: ${planningPresetContext(planningPresets, plan.mission, plan.parameters).name}`,
      "Preset identity follows the calculated budget, reserve and travel assumptions; observation duration is separate."]),
    `Decision: ${decisionTitle(plan)}`,
    decisionExplanation(plan),
    `Next action: ${nextAction(plan)}`,
    "",
    `Mission budget: ${minutes(plan.mission.missionBudgetMinutes)}`,
    `Observation: ${minutes(plan.mission.scienceMinutes)}`,
    `Protected reserve: ${minutes(plan.mission.reserveMinutes)}`,
    `Outbound: ${minutes(time?.outboundMinutes ?? null)}`,
    `Return: ${minutes(time?.returnMinutes ?? null)}`,
    `Required including reserve: ${minutes(time?.requiredMinutes ?? null)}`,
    `Extra margin beyond reserve: ${minutes(time?.marginMinutes ?? null)}`,
    `Maximum total observation time: ${minutes(time?.maxScienceMinutes ?? null)}`,
    `Latest planned return departure: ${time === null ? "Not evaluable" : `mission minute ${time.latestReturnDepartureMinute.toFixed(2)} after departure`}`,
    "",
    `Assumptions: flat speed ${plan.parameters.baseSpeedMPerMin} m/min; slope limit ${plan.parameters.maximumSlopeDegrees} degrees; uphill ${plan.parameters.uphillPenalty}; downhill ${plan.parameters.downhillPenalty}.`,
    "Travel estimates use the selected speed, slope limit, and directional time coefficients.",
    comparison === null ? "Original observation plan." : `Compared with original: +${comparison.extraScienceMinutes} observation minutes; margin change ${minutes(comparison.marginDeltaMinutes)}.`,
    "",
    "DATA AND METHODS",
    "HiRISE optical imagery is visual context; terrain elevation/slope support the route model.",
    "THEMIS provides qualitative thermal-derived context at native 100 m spacing.",
    "Terrain elevation and slope support the route calculation; A/B/C are example observation locations.",
    ...sources.map(source => `${source.mission} / ${source.instrument}: ${source.productId}\nRole: ${source.role}\n${source.url}\nSHA-256: ${source.sha256}`),
  ].join("\n");
}

export function assumptionSummary(parameters: TravelParameters): string {
  return `${parameters.baseSpeedMPerMin} m/min reference speed; ${parameters.maximumSlopeDegrees}-degree slope limit; uphill ${parameters.uphillPenalty}; downhill ${parameters.downhillPenalty}.`;
}
