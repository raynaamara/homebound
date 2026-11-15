import { finiteNumber, objectValue, parseCell, parseMission, parseTravelParameters } from "./engine.js";
import type { Cell, PlanResult, TravelParameters } from "./engine.js";
import { parseScenario } from "./protocol.js";
import type { CalculateRequest, CalculationResponse, Scenario, WorkerResponse } from "./protocol.js";
import {
  APPLICATION_VERSION, CLAIM_BOUNDARY, assumptionSummary, briefText, comparePlans,
  decisionTitle, decisionExplanation, displayedPlan, destinationCode, destinationKindLabel,
  destinationLabel, destinationsFromConfig, markerKey,
  minutes, missionWithExtra, nextAction, parseRegionalContext, parseSources,
  planningPresetContext, planningPresetForInputs, planningPresetsFromConfig, requestKey,
} from "./workflow.js";
import type { Destination, PlanningPreset, PlanningPresetCatalog, RegionalContext, SourceReference, Step } from "./workflow.js";
import { MissionMap } from "./map-view.js";
import { parseLayerMetadata } from "./layer-display.js";
import type { LayerDescription } from "./layer-display.js";
import { evidenceCaption, scienceExportContext, scienceSources } from "./science-context.js";
import type { ScienceEvidence } from "./science-context.js";

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`Missing application element: ${id}`);
  return found;
}
function typed<T extends HTMLElement>(id: string, constructor: { new(): T }): T {
  const found = element(id);
  if (!(found instanceof constructor)) throw new Error(`Unexpected element type: ${id}`);
  return found;
}
function input(id: string): HTMLInputElement { return typed(id, HTMLInputElement); }
function button(id: string): HTMLButtonElement { return typed(id, HTMLButtonElement); }
function setText(id: string, value: string): void { element(id).textContent = value; }

const form = typed("mission-form", HTMLFormElement);
const canvas = typed("map", HTMLCanvasElement);
const layer = typed("map-layer", HTMLSelectElement);
const presetControl = typed("planning-preset", HTMLSelectElement);
const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
let scenario: Scenario | undefined;
let destinations: readonly Destination[] = [];
let selected: Destination | undefined;
let sources: readonly SourceReference[] = [];
let regionalContext: RegionalContext | undefined;
let regionalImageUrl: string | undefined;
let nominal: TravelParameters | undefined;
let planningPresets: PlanningPresetCatalog | undefined;
let map: MissionMap | undefined;
let ready = false;
let step: Step = 1;
let revision = 0;
let nextRequestId = 0;
let baseline: CalculationResponse | null = null;
let revised: CalculationResponse | null = null;
let comparisonPending = false;
let picking = false;
let hasCalculatedPlan = false;
let displayedLayer: LayerDescription | null = null;
let pending: { id: number; revision: number; key: string; kind: "baseline" | "candidate" } | null = null;
const downloadUrls: string[] = [];

function active(): CalculationResponse | null {
  return comparisonPending || pending !== null ? null : revised ?? baseline;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The application encountered an unexpected error.";
}

function showError(message: string, retry = false): void {
  setText("error-text", message);
  element("error").hidden = false;
  button("retry-data").hidden = !retry;
  element("error").focus({ preventScroll: true });
}

function run(action: () => void): void {
  try { action(); } catch (error: unknown) {
    console.error("HOMEBOUND action failed:", error);
    showError(errorMessage(error));
    updateNavigation();
  }
}

function clearExports(): void {
  for (const url of downloadUrls) URL.revokeObjectURL(url);
  downloadUrls.length = 0;
  element("mission-brief").replaceChildren();
  element("mission-brief").hidden = true;
  element("download-text").hidden = true;
  element("download-json").hidden = true;
  setText("result-json", "");
  button("print").disabled = true;
  document.body.dataset["printReady"] = "false";
}

function updateNavigation(): void {
  for (const navigation of document.querySelectorAll<HTMLButtonElement>("[data-step]")) {
    const number = navigation.dataset["step"];
    navigation.disabled = !ready || (number === "3" && baseline === null) || (number === "4" && active() === null);
    if (number === String(step)) navigation.setAttribute("aria-current", "step");
    else navigation.removeAttribute("aria-current");
  }
  button("to-activities").disabled = !ready;
  presetControl.disabled = !ready;
  button("review-plan").disabled = !ready || pending !== null;
  button("to-save").disabled = active() === null;
  button("compare").disabled = baseline?.plan.time === null || baseline === null || pending !== null;
  typed("what-if", HTMLFieldSetElement).disabled = baseline === null || baseline.plan.time === null;
  element("what-if").hidden = baseline === null || baseline.plan.time === null;
}

function stepNumber(value: string | undefined): Step {
  if (value === "1") return 1;
  if (value === "2") return 2;
  if (value === "3") return 3;
  if (value === "4") return 4;
  throw new Error("Unsupported planning step.");
}

function navigate(next: Step, computing = false): void {
  if (!ready) throw new Error("Wait for the prepared data to load.");
  if (next === 3 && baseline === null && !computing) throw new Error("Review an observation plan before opening this step.");
  if (next === 4 && active() === null) throw new Error("Calculate the current plan or comparison before saving.");
  step = next;
  for (const number of [1, 2, 3, 4]) element(`step-${number}`).hidden = number !== next;
  element("intro").hidden = true;
  element("workspace").hidden = false;
  picking = false;
  button("pick-point").setAttribute("aria-pressed", "false");
  canvas.classList.remove("picking");
  updateNavigation();
  draw();
  if (next === 4) renderBrief();
  element(`title-${next}`).focus({ preventScroll: true });
  element("workspace").scrollIntoView({ block: "start" });
}

function invalidate(): void {
  revision++;
  pending = null;
  baseline = null;
  revised = null;
  comparisonPending = false;
  clearExports();
  element("time-results").hidden = true;
  element("comparison-section").hidden = true;
  setText("status", "Plan changed; review it again.");
  element("status").dataset["status"] = "STALE";
  setText("explanation", "Previous results have been cleared. The edited plan has not been calculated.");
  setText("next-action", "Continue to activities and review the plan.");
  setText("review-preset", "");
  element("error").hidden = true;
  if (step >= 3 && ready) navigate(2);
  updateAssumptions();
  updatePlanningPreset();
  updateNavigation();
  draw();
}

function updateAssumptions(): void {
  const values = ["speed", "slope-limit", "uphill", "downhill"].map(id => input(id).valueAsNumber);
  const message = values.every(Number.isFinite)
    ? `Current research assumptions: ${values[0]} m/min; ${values[1]}-degree limit; uphill ${values[2]}; downhill ${values[3]}.`
    : "Travel assumptions contain incomplete values. Correct them before calculation.";
  setText("assumption-summary", message);
}

function travelInputs(): TravelParameters {
  return {
    baseSpeedMPerMin: input("speed").valueAsNumber, maximumSlopeDegrees: input("slope-limit").valueAsNumber,
    uphillPenalty: input("uphill").valueAsNumber, downhillPenalty: input("downhill").valueAsNumber,
  };
}

function setPlanningPresetInputs(preset: PlanningPreset): void {
  input("budget").value = String(preset.missionBudgetMinutes); input("reserve").value = String(preset.reserveMinutes);
  input("speed").value = String(preset.parameters.baseSpeedMPerMin); input("slope-limit").value = String(preset.parameters.maximumSlopeDegrees);
  input("uphill").value = String(preset.parameters.uphillPenalty); input("downhill").value = String(preset.parameters.downhillPenalty);
}

function updatePlanningPreset(): void {
  if (planningPresets === undefined) throw new Error("Planning presets are not loaded.");
  const preset = planningPresetForInputs(planningPresets.presets, {
    missionBudgetMinutes: input("budget").valueAsNumber, reserveMinutes: input("reserve").valueAsNumber,
  }, travelInputs());
  presetControl.value = preset?.id ?? "custom";
  const message = preset === null ? "Custom settings: the budget, reserve or travel inputs differ from the named presets." :
    `${preset.name}: ${preset.missionBudgetMinutes}-minute budget; ${preset.parameters.maximumSlopeDegrees}-degree slope limit. ${preset.description}`;
  if (element("preset-summary").textContent !== message) setText("preset-summary", message);
}

function currentDestination(): Destination {
  if (selected === undefined || scenario === undefined) throw new Error("Choose a destination first.");
  if (selected.kind !== "custom") return selected;
  const cell = parseCell({ row: input("row").valueAsNumber, column: input("column").valueAsNumber });
  if (cell.row >= scenario.gridHeight || cell.column >= scenario.gridWidth) throw new Error("Custom coordinates are outside the prepared grid.");
  return { ...selected, ...cell };
}

function chooseDestination(id: string): void {
  if (scenario === undefined) throw new Error("The scenario is not loaded.");
  if (id === "custom") {
    selected = {
      id: "X", name: "Custom inspection point", row: input("row").valueAsNumber,
      column: input("column").valueAsNumber, scienceMinutes: 20, kind: "custom",
      description: "A user-selected point in the prepared grid.",
      objective: "Inspect the travel and observation timing for your selected point.",
      evidence: "A user-selected location within the prepared terrain grid.",
      science: null,
    };
  } else {
    const found = destinations.find(destination => destination.id === id);
    if (found === undefined) throw new Error("Unknown destination selection.");
    selected = found;
    input("science").value = String(found.scienceMinutes);
  }
  input("row").disabled = id !== "custom";
  input("column").disabled = id !== "custom";
  input("extra").value = "0";
  setText("selected-purpose", `${destinationLabel(selected)}. ${selected.objective} ${selected.evidence}`);
  renderScienceContext(element("science-content"), selected, true);
  if (id === "custom") typed("custom-location", HTMLDetailsElement).open = true;
  invalidate();
  const destination = currentDestination();
  map?.fit([scenario.origin, destination]);
  draw();
}

function renderScienceContext(container: HTMLElement, destination: Destination, offerScience = false): void {
  container.replaceChildren();
  function paragraph(value: string): void {
    const item = document.createElement("p"); item.textContent = value; container.append(item);
  }
  const science = destination.science;
  if (science === null) {
    paragraph(`${destinationKindLabel(destination)}. ${destination.objective}`);
    paragraph("The image-supported observation question and its fixed evidence window are available at Location S.");
    if (offerScience) {
      const action = document.createElement("button"); action.type = "button"; action.className = "secondary";
      action.textContent = "Explore the science case at Location S";
      action.addEventListener("click", () => run(() => {
        const radio = document.querySelector<HTMLInputElement>('input[name="destination"][value="S"]');
        if (radio === null) throw new Error("Science candidate control is missing.");
        radio.checked = true; chooseDestination("S");
        typed("science-context", HTMLDetailsElement).open = true;
        typed("science-context", HTMLDetailsElement).querySelector("summary")?.focus();
        element("science-context").scrollIntoView({ block: "nearest" });
      }));
      container.append(action);
    }
    return;
  }
  if (map === undefined) throw new Error("Science evidence is not ready.");
  const evidence = map.scienceEvidence(destination);
  const badge = document.createElement("p"); badge.className = "science-badge";
  badge.textContent = "Image-supported observation candidate"; container.append(badge);
  const fields = document.createElement("dl");
  for (const [label, value] of [
    ["Science objective", science.question],
    ["What to observe", science.observationTask],
    ["Why here?", science.whyHere],
    ["Observed in the image", science.observed],
    ["Interpretation to investigate", science.interpretation],
  ]) {
    const term = document.createElement("dt"); term.textContent = label!;
    const detail = document.createElement("dd"); detail.textContent = value!;
    fields.append(term, detail);
  }
  container.append(fields);
  const figure = document.createElement("figure"); figure.className = "science-figure";
  const image = new Image(); image.src = evidence.image; image.width = 360; image.height = 360;
  image.alt = `Prepared HiRISE optical crop with the exact selected Location ${destination.id} marked.`;
  const caption = document.createElement("figcaption"); caption.textContent = evidenceCaption(evidence.summary);
  figure.append(image, caption); container.append(figure);
  const summary = evidence.summary;
  paragraph(`Optical observation: ${science.opticalObservationDate}. Credit: NASA/JPL-Caltech/University of Arizona.`);
  paragraph(summary.elevationMinimumM === null || summary.elevationMaximumM === null
    ? "Terrain measurements require additional data in this evidence window."
    : `Model elevation in this window: ${summary.elevationMinimumM.toFixed(1)} to ${summary.elevationMaximumM.toFixed(1)} m above the Mars datum. ` +
      `Terrain grid spacing: ${summary.modelMetresPerCell.toFixed(2)} m; ${summary.knownCells} of ${summary.totalCells} cells have terrain data.`);
  const heading = document.createElement("h4"); heading.textContent = "Evidence & sources"; container.append(heading);
  const list = document.createElement("ul"); list.className = "science-sources";
  for (const { source, role } of scienceSources(science, sources)) {
    const item = document.createElement("li"); item.append(document.createTextNode(`${role}: `));
    const link = document.createElement("a"); link.href = source.providerUrl; link.target = "_blank"; link.rel = "noopener noreferrer";
    link.textContent = source.productId; item.append(link); list.append(item);
  }
  const item = document.createElement("li");
  const link = document.createElement("a"); link.href = science.observationPageUrl; link.target = "_blank"; link.rel = "noopener noreferrer";
  link.textContent = "HiRISE acquisition metadata"; item.append(link); list.append(item);
  container.append(list);
  paragraph("THEMIS adds regional qualitative context at native 100 m spacing. Terrain elevation and slope drive routing; science interest and route/time feasibility are assessed separately.");
}

function renderRegionalContext(container: HTMLElement): void {
  const context = regionalContext;
  if (context === undefined || regionalImageUrl === undefined) throw new Error("Regional context is not ready.");
  container.replaceChildren();
  const description = document.createElement("p"); description.textContent = context.description;
  const figure = document.createElement("figure"); figure.className = "regional-figure";
  const image = new Image(720, 850); image.src = regionalImageUrl;
  image.alt = "NASA Mars Trek MGS/MOLA regional relief of Gale Crater. An orange footprint and locator ring identify HOMEBOUND's study area, not a walking route.";
  const caption = document.createElement("figcaption");
  caption.textContent = `${context.credit}. Regional context only; source spacing about ${context.nativeResolutionM} m. The larger locator ring is for visibility.`;
  figure.append(image, caption);
  const scope = document.createElement("p"); scope.className = "regional-scope"; scope.textContent = context.scope;
  const links = document.createElement("p");
  for (const [label, url] of [["Open NASA Mars Trek", context.source.providerUrl], ["Map service metadata", context.serviceMetadata.url]]) {
    if (links.childNodes.length > 0) links.append(document.createTextNode(" | "));
    const link = document.createElement("a"); link.textContent = label!; link.href = url!;
    link.target = "_blank"; link.rel = "noopener noreferrer"; link.setAttribute("aria-label", `${label} (opens in a new tab)`);
    links.append(link);
  }
  container.append(description, figure, scope, links);
}

function draw(): void {
  if (map === undefined || scenario === undefined || selected === undefined) return;
  button("focus-map").setAttribute("aria-pressed", String(map.viewMode === "focus"));
  button("fit-map").setAttribute("aria-pressed", String(map.viewMode === "area"));
  const destination = selected.kind === "custom"
    ? { ...selected, row: input("row").valueAsNumber, column: input("column").valueAsNumber }
    : selected;
  if (!Number.isInteger(destination.row) || !Number.isInteger(destination.column)) return;
  const response = active();
  const state = response !== null ? "current" : pending !== null ? "calculating" : hasCalculatedPlan || comparisonPending ? "stale" : "not_calculated";
  displayedLayer = map.draw(layer.value, scenario.origin, destination, destinations, response?.plan ?? null, response?.field ?? null, state);
  setText("layer-title", displayedLayer.title);
  setText("layer-detail", displayedLayer.detail);
  element("layer-notice").hidden = displayedLayer.notice === null;
  setText("layer-notice", displayedLayer.notice ?? "");
  const scaleContainer = element("layer-scale");
  scaleContainer.replaceChildren();
  scaleContainer.hidden = displayedLayer.scale === null;
  if (displayedLayer.scale !== null) {
    const scale = displayedLayer.scale;
    const title = document.createElement("strong"); title.textContent = scale.title;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 300 18"); svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("role", "img"); svg.setAttribute("aria-label", `${scale.minimum.toFixed(1)} to ${scale.maximum.toFixed(1)} ${scale.units}. ${scale.title}`);
    const definitions = document.createElementNS(svg.namespaceURI, "defs");
    const gradient = document.createElementNS(svg.namespaceURI, "linearGradient"); gradient.setAttribute("id", "layer-gradient");
    scale.colors.forEach((color, index) => {
      const stop = document.createElementNS(svg.namespaceURI, "stop");
      stop.setAttribute("offset", String(scale.colors.length === 1 ? 0 : index / (scale.colors.length - 1)));
      stop.setAttribute("stop-color", `rgb(${color.join(",")})`); gradient.append(stop);
    });
    definitions.append(gradient); svg.append(definitions);
    const rectangle = document.createElementNS(svg.namespaceURI, "rect");
    rectangle.setAttribute("width", "300"); rectangle.setAttribute("height", "18"); rectangle.setAttribute("fill", "url(#layer-gradient)");
    svg.append(rectangle);
    const labels = document.createElement("div"); labels.className = "layer-scale-labels";
    for (const value of [scale.minimum, scale.maximum]) {
      const label = document.createElement("span"); label.textContent = `${value.toFixed(1)} ${scale.units}`; labels.append(label);
    }
    scaleContainer.append(title, svg, labels);
  }
  element("field-legend").hidden = layer.value !== "opportunity" || response === null;
  setText("map-caption", `${destinationLabel(destination)}. ${destinationKindLabel(destination)}. ${destination.evidence} ${layer.value === "thermal" ? "Thermal context is qualitative, native 100 m." : ""}`);
  for (const entry of document.querySelectorAll<HTMLElement>("#marker-key [data-marker-code]")) {
    entry.dataset["selected"] = String(entry.dataset["markerCode"] === destinationCode(destination));
  }
}

function request(kind: "baseline" | "candidate"): void {
  if (scenario === undefined) throw new Error("Scenario data are unavailable.");
  if (planningPresets === undefined) throw new Error("Planning presets are not loaded.");
  const invalid = form.querySelector(":invalid");
  if (invalid?.closest("#advanced-assumptions")) typed("advanced-assumptions", HTMLDetailsElement).open = true;
  if (!form.reportValidity()) throw new Error("Correct the highlighted activity or travel inputs before calculating.");
  if (kind === "candidate" && (!input("extra").reportValidity() || baseline === null)) {
    throw new Error("A valid original plan and nonnegative additional observation duration are required.");
  }
  const parameters = parseTravelParameters(travelInputs());
  const mission = parseMission({
    missionBudgetMinutes: input("budget").valueAsNumber, scienceMinutes: input("science").valueAsNumber,
    reserveMinutes: input("reserve").valueAsNumber,
  });
  const destination = currentDestination();
  const message: CalculateRequest = {
    kind: "calculate", requestId: ++nextRequestId, origin: scenario.origin, destination, parameters,
    mission: kind === "candidate" ? missionWithExtra(mission, input("extra").valueAsNumber) : mission,
  };
  if (kind === "baseline") {
    baseline = revised = null;
    input("extra").value = "0";
  }
  pending = { id: message.requestId, revision, kind, key: requestKey(message) };
  comparisonPending = kind === "candidate";
  clearExports();
  element("error").hidden = true;
  element("time-results").hidden = true;
  element("comparison-section").hidden = true;
  setText("status", kind === "baseline" ? "Calculating the complete excursion..." : "Calculating the revised observation...");
  setText("review-preset", `Planning preset: ${planningPresetContext(planningPresets.presets, message.mission, message.parameters).name}`);
  element("status").dataset["status"] = "COMPUTING";
  setText("explanation", "The model runs in a browser worker. No assumptions or endpoints are changed automatically.");
  setText("next-action", "Please wait for this calculation.");
  navigate(3, true);
  worker.postMessage(message);
}

function renderTimeline(plan: PlanResult): void {
  if (plan.time === null) return;
  const time = plan.time;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 600 38");
  svg.setAttribute("role", "img");
  const caption = `Outbound ${minutes(time.outboundMinutes)}; observation ${minutes(time.scienceMinutes)}; return ${minutes(time.returnMinutes)}; reserve ${minutes(time.reserveMinutes)}. Required ${minutes(time.requiredMinutes)} of ${minutes(time.missionBudgetMinutes)}. ${time.marginMinutes >= 0 ? "Unallocated extra margin" : "Budget margin"}: ${minutes(time.marginMinutes)}.`;
  svg.setAttribute("aria-label", caption);
  const scale = 600 / Math.max(time.requiredMinutes, time.missionBudgetMinutes, 1);
  let x = 0;
  for (const [value, color] of [
    [time.outboundMinutes, "#287b9d"], [time.scienceMinutes, "#00716a"],
    [time.returnMinutes, "#b66a24"], [time.reserveMinutes, "#b9a16d"],
    [Math.max(0, time.marginMinutes), "#e0e8e2"],
  ] as const) {
    const rectangle = document.createElementNS(svg.namespaceURI, "rect");
    rectangle.setAttribute("x", String(x)); rectangle.setAttribute("y", "6");
    rectangle.setAttribute("width", String(value * scale)); rectangle.setAttribute("height", "25");
    rectangle.setAttribute("fill", color); svg.append(rectangle); x += value * scale;
  }
  const budgetLine = document.createElementNS(svg.namespaceURI, "line");
  for (const [attribute, value] of [["x1", time.missionBudgetMinutes * scale], ["x2", time.missionBudgetMinutes * scale], ["y1", 0], ["y2", 38], ["stroke-width", 3]] as const) budgetLine.setAttribute(attribute, String(value));
  budgetLine.setAttribute("stroke", "#17324d"); svg.append(budgetLine);
  element("time-bar").replaceChildren(svg);
  setText("time-caption", caption);
}

function renderComparison(): void {
  const body = typed("comparison-table", HTMLTableElement).tBodies[0];
  if (body === undefined) throw new Error("The comparison table body is missing.");
  body.replaceChildren();
  if (baseline === null || revised === null) { element("comparison-section").hidden = true; return; }
  comparePlans(baseline.plan, revised.plan);
  const a = baseline.plan; const b = revised.plan;
  for (const values of [
    ["Decision", decisionTitle(a), decisionTitle(b)],
    ["Observation", minutes(a.mission.scienceMinutes), minutes(b.mission.scienceMinutes)],
    ["Required incl. reserve", minutes(a.time?.requiredMinutes ?? null), minutes(b.time?.requiredMinutes ?? null)],
    ["Extra margin", minutes(a.time?.marginMinutes ?? null), minutes(b.time?.marginMinutes ?? null)],
    ["Protected reserve", minutes(a.mission.reserveMinutes), minutes(b.mission.reserveMinutes)],
  ]) {
    const row = body.insertRow();
    values.forEach((value, index) => {
      const cell = index === 0 ? document.createElement("th") : document.createElement("td");
      if (cell instanceof HTMLTableCellElement && index === 0) cell.scope = "row";
      cell.textContent = value; row.append(cell);
    });
  }
  element("comparison-section").hidden = false;
}

function renderReview(): void {
  const response = active();
  if (response === null) return;
  const plan = response.plan;
  if (planningPresets === undefined) throw new Error("Planning presets are not loaded.");
  setText("review-preset", `Planning preset: ${planningPresetContext(planningPresets.presets, plan.mission, plan.parameters).name}`);
  const destination = currentDestination();
  element("science-review").hidden = destination.science === null;
  setText("science-review", destination.science === null ? "" : `Science objective: ${destination.science.question} Observation allowance in this plan: ${minutes(plan.mission.scienceMinutes)}.`);
  setText("result-label", revised === null ? "Original plan" : "Revised plan");
  setText("status", decisionTitle(plan));
  element("status").dataset["status"] = plan.status;
  setText("explanation", decisionExplanation(plan));
  setText("next-action", nextAction(plan));
  element("time-results").hidden = plan.time === null;
  if (plan.time !== null) {
    setText("allowance", minutes(plan.time.maxScienceMinutes));
    setText("margin", minutes(plan.time.marginMinutes));
    setText("return-deadline", `Latest planned departure from this waypoint: mission minute ${plan.time.latestReturnDepartureMinute.toFixed(2)} after leaving the origin, based on the current scenario.`);
    renderTimeline(plan);
  }
  typed("what-if", HTMLFieldSetElement).disabled = baseline?.plan.time === null;
  element("comparison-unavailable").hidden = baseline?.plan.time !== null;
  element("practice-tip").hidden = selected?.kind !== "hypothetical_practice";
  setText("review-assumptions", `${assumptionSummary(plan.parameters)} ${CLAIM_BOUNDARY}`);
  setText("runtime-note", `${response.statistics.outboundReached.toLocaleString()} of ${response.statistics.totalCells.toLocaleString()} cells are connected under this model. ${response.elapsedMilliseconds.toFixed(1)} ms locally; ${response.searchRebuilt ? "route search rebuilt" : "cached route search reused"}. No cross-device speed guarantee.`);
  renderComparison(); updateNavigation(); draw();
}

function renderBrief(): void {
  const response = active();
  if (response === null) throw new Error("There is no current result to save.");
  if (planningPresets === undefined) throw new Error("Planning presets are not loaded.");
  const preset = planningPresetContext(planningPresets.presets, response.plan.mission, response.plan.parameters);
  const destination = currentDestination();
  clearExports();
  const container = element("mission-brief");
  function paragraph(text: string, className = ""): void {
    const item = document.createElement("p"); item.textContent = text; item.className = className; container.append(item);
  }
  const title = document.createElement("h3"); title.textContent = "HOMEBOUND / Mission brief"; container.append(title);
  paragraph(`Application ${APPLICATION_VERSION} | Model ${response.plan.modelVersion} | ${new Date().toISOString()}`);
  paragraph(CLAIM_BOUNDARY, "brief-boundary");
  paragraph(`Origin / return marker H: fixed scenario starting point.`);
  paragraph(`${destinationLabel(destination)} - ${destinationKindLabel(destination)}`);
  paragraph(destination.objective);
  paragraph(destination.evidence);
  paragraph(`Planning preset: ${preset.name}`);
  paragraph(preset.scope);
  let scienceEvidence: ScienceEvidence | null = null;
  if (destination.science !== null) {
    if (map === undefined) throw new Error("Science evidence is not ready for the brief.");
    scienceEvidence = map.scienceEvidence(destination);
  }
  paragraph(`Decision: ${decisionTitle(response.plan)}`);
  paragraph(decisionExplanation(response.plan));
  const table = document.createElement("table");
  const time = response.plan.time;
  for (const [label, value] of [
    ["Budget", response.plan.mission.missionBudgetMinutes], ["Observation", response.plan.mission.scienceMinutes],
    ["Protected reserve", response.plan.mission.reserveMinutes], ["Outbound", time?.outboundMinutes ?? null],
    ["Return", time?.returnMinutes ?? null], ["Required including reserve", time?.requiredMinutes ?? null],
    ["Extra margin", time?.marginMinutes ?? null], ["Maximum total observation", time?.maxScienceMinutes ?? null],
  ] as const) {
    const row = table.insertRow(); const labelCell = document.createElement("th");
    labelCell.scope = "row"; labelCell.textContent = label; row.append(labelCell);
    row.insertCell().textContent = minutes(value);
  }
  container.append(table);
  paragraph(time === null ? "Return-departure time: requires a complete route calculation." : `Latest planned return departure: mission minute ${time.latestReturnDepartureMinute.toFixed(2)} after mission start.`);
  if (map !== undefined) {
    const image = new Image(); image.src = map.image(); image.alt = `Current Mars map with scenario origin and destination. Layer: ${layer.value}.`;
    container.append(image);
  }
  paragraph(`Map layer: ${layer.value}. Coordinate cell: row ${response.plan.destination.row}, column ${response.plan.destination.column}. These are not Earth latitude/longitude coordinates.`);
  if (displayedLayer !== null) {
    paragraph(`${displayedLayer.title}. ${displayedLayer.detail}`);
    if (displayedLayer.scale !== null) paragraph(`Displayed legend: ${displayedLayer.scale.minimum.toFixed(1)} to ${displayedLayer.scale.maximum.toFixed(1)} ${displayedLayer.scale.units}. ${displayedLayer.scale.title}.`);
  }
  paragraph(`Assumptions: ${assumptionSummary(response.plan.parameters)}`);
  if (revised !== null && baseline !== null) {
    const comparison = comparePlans(baseline.plan, revised.plan);
    paragraph(`Compared with original: +${comparison.extraScienceMinutes} observation minutes; margin change ${minutes(comparison.marginDeltaMinutes)}.`);
  }
  if (scienceEvidence !== null) {
    const section = document.createElement("section"); section.className = "science-brief";
    const scienceHeading = document.createElement("h4"); scienceHeading.textContent = "Science context";
    section.append(scienceHeading);
    const content = document.createElement("div"); content.className = "science-content";
    renderScienceContext(content, destination);
    section.append(content); container.append(section);
  }
  const regionalSection = document.createElement("section"); regionalSection.className = "regional-brief";
  const regionalHeading = document.createElement("h4"); regionalHeading.textContent = "Regional setting";
  const regionalContent = document.createElement("div"); regionalContent.className = "regional-content";
  renderRegionalContext(regionalContent);
  regionalSection.append(regionalHeading, regionalContent); container.append(regionalSection);
  const heading = document.createElement("h4"); heading.textContent = "Data and methods"; container.append(heading);
  paragraph("HiRISE terrain elevation and slope support route timing; optical imagery provides surface context. THEMIS adds qualitative thermal-derived context at native 100 m spacing. Mars Trek MGS/MOLA relief shows the regional setting, not a route calculation.");
  const sourceList = document.createElement("ul"); sourceList.className = "brief-sources";
  for (const source of sources) {
    const item = document.createElement("li"); item.textContent = `${source.mission} / ${source.instrument}: ${source.productId}. Role: ${source.role} ${source.url} SHA-256: ${source.sha256}`;
    sourceList.append(item);
  }
  container.append(sourceList);
  const { science: _science, ...exportDestination } = destination;
  const exported = {
    applicationVersion: APPLICATION_VERSION, destination: exportDestination,
    planningPreset: preset,
    scienceContext: scienceExportContext(destination, sources, scienceEvidence?.summary ?? null),
    regionalContext,
    modelResult: displayedPlan(response.plan), geometry: response.geometry, searchStatistics: response.statistics,
    originalPlan: revised !== null && baseline !== null ? displayedPlan(baseline.plan) : null,
    comparison: revised !== null && baseline !== null ? comparePlans(baseline.plan, revised.plan) : null,
    sources, claimBoundary: CLAIM_BOUNDARY,
    mapDisplay: { layer: layer.value, description: displayedLayer, markerKey: markerKey(destinations) },
  };
  const json = JSON.stringify(exported, null, 2);
  setText("result-json", json);
  for (const [id, content, type] of [
    ["download-text", briefText(destination, response, revised !== null ? baseline?.plan ?? null : null, sources, scienceEvidence?.summary ?? null, regionalContext, planningPresets.presets) +
      (displayedLayer === null ? "" : `\n\nMAP DISPLAY\n${displayedLayer.title}\n${displayedLayer.detail}\n` +
        (displayedLayer.scale === null ? "" : `Legend: ${displayedLayer.scale.minimum.toFixed(1)} to ${displayedLayer.scale.maximum.toFixed(1)} ${displayedLayer.scale.units}; ${displayedLayer.scale.title}.\n`)),
      "text/plain;charset=utf-8"],
    ["download-json", json, "application/json"],
  ]) {
    const link = typed(id!, HTMLAnchorElement);
    const url = URL.createObjectURL(new Blob([content!], { type: type! }));
    downloadUrls.push(url); link.href = url; link.hidden = false;
  }
  container.hidden = false;
  button("print").disabled = false;
  document.body.dataset["printReady"] = "true";
}

worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => run(() => {
  const expected = pending;
  if (expected === null || event.data.requestId !== expected.id || expected.revision !== revision) return;
  pending = null;
  if (event.data.kind === "error") {
    comparisonPending = expected.kind === "candidate";
    setText("status", "This calculation could not be completed.");
    element("status").dataset["status"] = "ERROR";
    showError(`${event.data.code}: ${event.data.message}`); updateNavigation(); draw(); return;
  }
  if (requestKey(event.data.plan) !== expected.key) throw new Error("The result does not match the current request; it was not displayed.");
  if (expected.kind === "baseline") { baseline = event.data; revised = null; }
  else {
    if (baseline === null) throw new Error("The original plan was invalidated before comparison.");
    comparePlans(baseline.plan, event.data.plan); revised = event.data;
  }
  comparisonPending = false; hasCalculatedPlan = true; renderReview();
}));

worker.addEventListener("error", event => {
  console.error("HOMEBOUND worker error:", event.message);
  pending = null; baseline = revised = null; clearExports(); updateNavigation(); draw();
  showError(`The calculation worker failed: ${event.message}. Reload the application after checking its JavaScript and data URLs.`);
});

button("start").addEventListener("click", () => run(() => navigate(1)));
document.querySelector<HTMLAnchorElement>(".skip-link")?.addEventListener("click", event => {
  event.preventDefault();
  if (ready) run(() => navigate(1));
  else {
    element("intro-title").tabIndex = -1;
    element("intro-title").focus();
  }
});
element("home-link").addEventListener("click", () => { element("intro").hidden = false; });
for (const navigation of document.querySelectorAll<HTMLButtonElement>("[data-step]")) navigation.addEventListener("click", () => run(() => navigate(stepNumber(navigation.dataset["step"]))));
for (const back of document.querySelectorAll<HTMLButtonElement>("[data-back]")) back.addEventListener("click", () => run(() => navigate(stepNumber(back.dataset["back"]))));
button("to-activities").addEventListener("click", () => run(() => {
  selected = currentDestination();
  if (scenario !== undefined) map?.fit([scenario.origin, selected]);
  navigate(2);
}));
button("choose-another").addEventListener("click", () => run(() => navigate(1)));
button("inspect-assumptions").addEventListener("click", () => run(() => {
  navigate(2); typed("advanced-assumptions", HTMLDetailsElement).open = true; input("slope-limit").focus();
}));
form.addEventListener("input", event => { if (event.target !== presetControl) run(invalidate); });
presetControl.addEventListener("change", () => run(() => {
  const preset = planningPresets?.presets.find(item => item.id === presetControl.value);
  if (preset === undefined) throw new Error("Choose an available planning preset.");
  setPlanningPresetInputs(preset);
  invalidate();
}));
form.addEventListener("submit", event => { event.preventDefault(); run(() => request("baseline")); });
for (const id of ["row", "column"]) input(id).addEventListener("input", invalidate);
button("compare").addEventListener("click", () => run(() => request("candidate")));

function extraChanged(): void {
  pending = null; revised = null; comparisonPending = true; clearExports();
  element("time-results").hidden = true; element("comparison-section").hidden = true;
  setText("status", "Additional activity changed; calculate the comparison.");
  element("status").dataset["status"] = "STALE";
  setText("result-label", "Comparison pending");
  setText("explanation", "The original plan is retained. The edited additional activity has not been evaluated.");
  setText("next-action", "Compare with original, or explicitly restore it.");
  updateNavigation(); draw();
}
input("extra").addEventListener("input", extraChanged);
for (const shortcut of document.querySelectorAll<HTMLButtonElement>("[data-extra]")) shortcut.addEventListener("click", () => {
  input("extra").value = shortcut.dataset["extra"]!; extraChanged();
});
button("restore-original").addEventListener("click", () => run(() => {
  if (baseline === null) throw new Error("There is no original plan to restore.");
  pending = null; revised = null; comparisonPending = false; input("extra").value = "0"; clearExports(); renderReview();
}));
button("to-save").addEventListener("click", () => run(() => navigate(4)));
button("print").addEventListener("click", () => run(() => {
  if (active() === null) throw new Error("Recalculate before printing.");
  renderBrief(); window.print();
}));
layer.addEventListener("change", () => run(() => { draw(); if (step === 4 && active() !== null) renderBrief(); }));
button("fit-map").addEventListener("click", () => run(() => {
  if (map === undefined) throw new Error("Map data are not ready.");
  // Validate before changing the viewport so the map and active option stay aligned.
  currentDestination();
  map.fitArea(); draw(); if (step === 4 && active() !== null) renderBrief();
}));
button("focus-map").addEventListener("click", () => run(() => {
  if (scenario === undefined || map === undefined) throw new Error("Map data are not ready.");
  const response = active();
  const indices = [...(response?.plan.outbound?.cells ?? []), ...(response?.plan.return?.cells ?? [])];
  const cells: Cell[] = indices.map(index => ({ row: Math.floor(index / scenario!.gridWidth), column: index % scenario!.gridWidth }));
  map.fit([scenario.origin, currentDestination(), ...cells]); draw(); if (step === 4 && active() !== null) renderBrief();
}));
button("pick-point").addEventListener("click", () => run(() => {
  typed("custom-location", HTMLDetailsElement).open = true;
  const custom = document.querySelector<HTMLInputElement>('input[name="destination"][value="custom"]');
  if (custom === null) throw new Error("Custom destination control is missing.");
  custom.checked = true; chooseDestination("custom"); picking = !picking;
  button("pick-point").setAttribute("aria-pressed", String(picking)); canvas.classList.toggle("picking", picking);
  if (picking) typed("map-panel", HTMLDetailsElement).open = true;
}));
canvas.addEventListener("click", event => run(() => {
  if (!picking || map === undefined) return;
  const cell = map.pick(event.clientX, event.clientY);
  input("row").value = String(cell.row); input("column").value = String(cell.column);
  selected = currentDestination(); invalidate(); draw();
}));
element("data-link").addEventListener("click", () => { typed("data-section", HTMLDetailsElement).open = true; });

async function json(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}.`);
  return response.json();
}

async function initialize(): Promise<void> {
  ready = false; button("start").disabled = true; button("retry-data").disabled = true;
  try {
    const [rawScenario, rawPreset, config, rawSources, rawManifest, rawRegional] = await Promise.all([
      json("./data/scenario.json"), json("./data/preset.json"), json("./data/application.json"),
      json("./data/sources.json"), json("./data/manifest.json"), json("./data/regional-context.json"),
    ]);
    scenario = parseScenario(rawScenario); nominal = parseTravelParameters(rawPreset);
    destinations = destinationsFromConfig(scenario, config); sources = parseSources(rawSources);
    planningPresets = planningPresetsFromConfig(scenario, nominal, config);
    presetControl.replaceChildren();
    for (const preset of planningPresets.presets) {
      const option = document.createElement("option"); option.value = preset.id; option.textContent = preset.name;
      presetControl.append(option);
    }
    const customOption = document.createElement("option"); customOption.value = "custom"; customOption.textContent = "Custom settings"; customOption.disabled = true;
    presetControl.append(customOption);
    regionalContext = parseRegionalContext(rawRegional, sources);
    regionalImageUrl = new URL(`../data/${regionalContext.imageAsset}?v=${regionalContext.imageSha256}`, import.meta.url).href;
    const regionalImage = new Image(); regionalImage.src = regionalImageUrl;
    for (const destination of destinations) {
      if (destination.science !== null) scienceSources(destination.science, sources);
    }
    const bounds = objectValue(rawManifest, "map manifest")["bounds_projected_m"];
    if (!Array.isArray(bounds) || bounds.length !== 4) throw new Error("Map bounds are missing.");
    const numbers = bounds.map((value: unknown) => {
      if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Map bounds must be finite.");
      return value;
    });
    const spacing = finiteNumber((numbers[2]! - numbers[0]!) / scenario.gridWidth, "map spacing", Number.MIN_VALUE);
    map = new MissionMap(canvas, scenario.gridWidth, scenario.gridHeight, spacing, parseLayerMetadata(rawManifest));
    await Promise.all([map.load(), regionalImage.decode()]);
    renderRegionalContext(element("regional-content"));
    const options = element("destination-options"); options.replaceChildren();
    for (const destination of [...destinations, { id: "custom", name: "Custom inspection point", description: "Use the optional coordinates or explicitly enable map picking.", kind: "custom" as const }]) {
      const label = document.createElement("label"); label.className = "destination";
      const radio = document.createElement("input"); radio.type = "radio"; radio.name = "destination"; radio.value = destination.id;
      radio.checked = destination.id === destinations[0]?.id;
      radio.addEventListener("change", () => run(() => chooseDestination(destination.id)));
      const name = document.createElement("strong"); name.textContent = destinationLabel(destination);
      const type = document.createElement("span"); type.className = "type";
      type.textContent = destinationKindLabel(destination);
      const description = document.createElement("small"); description.textContent = destination.description;
      label.append(radio, name, type, description); options.append(label);
    }
    const key = element("marker-key");
    key.replaceChildren();
    for (const entry of markerKey(destinations)) {
      const item = document.createElement("li"); item.dataset["markerCode"] = entry.code;
      const code = document.createElement("strong"); code.className = "marker-code"; code.textContent = entry.code;
      const detail = document.createElement("div");
      const name = document.createElement("span"); name.textContent = entry.name;
      const note = document.createElement("small"); note.textContent = entry.note;
      detail.append(name, note); item.append(code, detail); key.append(item);
    }
    const list = element("source-list"); list.replaceChildren();
    for (const source of sources) {
      const item = document.createElement("li");
      const link = document.createElement("a"); link.href = source.url; link.target = "_blank"; link.rel = "noopener noreferrer";
      link.textContent = `${source.mission} / ${source.instrument}: ${source.productId}`;
      item.append(link, document.createTextNode(`. ${source.role}`)); list.append(item);
    }
    setPlanningPresetInputs(planningPresets.defaultPreset);
    input("row").max = String(scenario.gridHeight - 1); input("column").max = String(scenario.gridWidth - 1);
    ready = true; chooseDestination(destinations[0]!.id); button("start").disabled = false;
    setText("load-status", "Mars data ready. Start a guided plan and explore your observation options.");
    element("error").hidden = true; updateNavigation();
  } catch (error: unknown) {
    console.error("HOMEBOUND data initialization failed:", error);
    setText("load-status", "Prepared data could not be loaded. No substitute data were used.");
    showError(errorMessage(error), true);
  } finally { button("retry-data").disabled = false; }
}
button("retry-data").addEventListener("click", () => { void initialize(); });
void initialize();
