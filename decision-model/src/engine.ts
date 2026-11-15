export const MODEL_VERSION = "1.0.0";
export const TIME_EPSILON_MINUTES = 1e-9;
export const MAX_GRID_CELLS = 1_000_000;

export class ModelInputError extends Error {
  readonly code: string;

  constructor(message: string, code = "INVALID_INPUT") {
    super(message);
    this.name = "ModelInputError";
    this.code = code;
  }
}

export interface Cell {
  readonly row: number;
  readonly column: number;
}

export interface AffineGrid {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

export interface TerrainGrid {
  readonly width: number;
  readonly height: number;
  readonly affine: AffineGrid;
  readonly crsWkt: string;
  readonly radiusM: number;
  readonly elevationM: Float64Array;
  readonly slopeMaxDegrees: Float64Array;
  readonly known: Uint8Array;
}

export interface TravelParameters {
  readonly baseSpeedMPerMin: number;
  readonly maximumSlopeDegrees: number;
  readonly uphillPenalty: number;
  readonly downhillPenalty: number;
}

export interface MissionInput {
  readonly missionBudgetMinutes: number;
  readonly scienceMinutes: number;
  readonly reserveMinutes: number;
}

export interface TimeDecision extends MissionInput {
  readonly outboundMinutes: number;
  readonly returnMinutes: number;
  readonly requiredMinutes: number;
  readonly marginMinutes: number;
  readonly rawMarginMinutes: number;
  readonly maxScienceMinutes: number;
  readonly latestReturnDepartureMinute: number;
  readonly meetsModelBudget: boolean;
  readonly zeroExtraMargin: boolean;
}

export interface Route {
  readonly cells: readonly number[];
  readonly minutes: number;
  readonly distanceM: number;
  readonly ascentM: number;
  readonly descentM: number;
}

export type DecisionStatus =
  | "FEASIBLE"
  | "TIME_BUDGET_EXCEEDED"
  | "INSUFFICIENT_DATA"
  | "NO_MODELED_ROUTE";

export interface PlanResult {
  readonly modelVersion: string;
  readonly status: DecisionStatus;
  readonly reasonCode: string;
  readonly explanation: string;
  readonly origin: Cell;
  readonly destination: Cell;
  readonly parameters: TravelParameters;
  readonly mission: MissionInput;
  readonly time: TimeDecision | null;
  readonly outbound: Route | null;
  readonly return: Route | null;
  readonly scope: "PRE_DEPARTURE_TIME_ONLY_RESEARCH";
  readonly safetyCertified: false;
}

export const FIELD_CODES = {
  UNKNOWN: 0,
  EXCLUDED: 1,
  DISCONNECTED: 2,
  TIME_EXCEEDED: 3,
  FEASIBLE: 4,
  ZERO_EXTRA_MARGIN: 5,
} as const;

export interface ScienceOpportunityField {
  readonly width: number;
  readonly height: number;
  readonly marginMinutes: Float64Array;
  readonly codes: Uint8Array;
}

export interface SearchStatistics {
  readonly totalCells: number;
  readonly knownCells: number;
  readonly permittedCells: number;
  readonly outboundReached: number;
  readonly returnReached: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function objectValue(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ModelInputError(`${name} must be an object.`);
  }
  return value;
}

export function finiteNumber(value: unknown, name: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
    throw new ModelInputError(`${name} must be a finite number >= ${minimum}.`);
  }
  return value;
}

function signedNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ModelInputError(`${name} must be finite.`);
  }
  return value;
}

function integer(value: unknown, name: string, minimum = 0): number {
  const parsed = finiteNumber(value, name, minimum);
  if (!Number.isSafeInteger(parsed)) {
    throw new ModelInputError(`${name} must be a safe integer.`);
  }
  return parsed;
}

export function parseCell(value: unknown, name = "cell"): Cell {
  const parsed = objectValue(value, name);
  return {
    row: integer(parsed["row"], `${name}.row`),
    column: integer(parsed["column"], `${name}.column`),
  };
}

export function parseTravelParameters(value: unknown): TravelParameters {
  const parsed = objectValue(value, "travel parameters");
  const baseSpeedMPerMin = finiteNumber(parsed["baseSpeedMPerMin"], "baseSpeedMPerMin");
  const maximumSlopeDegrees = finiteNumber(parsed["maximumSlopeDegrees"], "maximumSlopeDegrees");
  if (baseSpeedMPerMin === 0 || maximumSlopeDegrees >= 90) {
    throw new ModelInputError("Speed must be > 0 and the slope limit must be < 90 degrees.");
  }
  return Object.freeze({
    baseSpeedMPerMin,
    maximumSlopeDegrees,
    uphillPenalty: finiteNumber(parsed["uphillPenalty"], "uphillPenalty"),
    downhillPenalty: finiteNumber(parsed["downhillPenalty"], "downhillPenalty"),
  });
}

export function parseMission(value: unknown): MissionInput {
  const parsed = objectValue(value, "mission");
  return {
    missionBudgetMinutes: finiteNumber(parsed["missionBudgetMinutes"], "missionBudgetMinutes"),
    scienceMinutes: finiteNumber(parsed["scienceMinutes"], "scienceMinutes"),
    reserveMinutes: finiteNumber(parsed["reserveMinutes"], "reserveMinutes"),
  };
}

export function parseTerrainGrid(value: unknown): TerrainGrid {
  const raw = objectValue(value, "terrain grid");
  const width = integer(raw["width"], "width", 1);
  const height = integer(raw["height"], "height", 1);
  const size = width * height;
  if (!Number.isSafeInteger(size) || size > MAX_GRID_CELLS) {
    throw new ModelInputError(`This browser model supports at most ${MAX_GRID_CELLS} cells.`);
  }
  if (
    raw["schema_version"] !== "1.0" ||
    raw["flattening"] !== "row-major" ||
    raw["horizontal_units"] !== "metres" ||
    raw["row_order"] !== "north to south; row zero at top"
  ) {
    throw new ModelInputError("Unsupported grid schema, flattening, units, or row direction.");
  }
  const affineInput = objectValue(raw["model_affine_pixel_corner"], "affine");
  const affine: AffineGrid = {
    a: signedNumber(affineInput["a"], "affine.a"),
    b: signedNumber(affineInput["b"], "affine.b"),
    c: signedNumber(affineInput["c"], "affine.c"),
    d: signedNumber(affineInput["d"], "affine.d"),
    e: signedNumber(affineInput["e"], "affine.e"),
    f: signedNumber(affineInput["f"], "affine.f"),
  };
  if (affine.a <= 0 || affine.e >= 0 || affine.b !== 0 || affine.d !== 0) {
    throw new ModelInputError("Only north-up, unrotated metric grids with positive x spacing are supported.");
  }
  const radiusM = finiteNumber(raw["working_radius_m"], "working_radius_m", 1);
  if (radiusM < 3_000_000 || radiusM > 4_000_000 || typeof raw["working_crs_wkt"] !== "string") {
    throw new ModelInputError("A declared Mars-scale radius and CRS are required; do not substitute Earth coordinates.");
  }
  const elevations = raw["elevation_m_mean"];
  const slopes = raw["slope_max_deg"];
  const mask = raw["valid_mask"];
  if (
    !Array.isArray(elevations) || !Array.isArray(slopes) || !Array.isArray(mask) ||
    elevations.length !== size || slopes.length !== size || mask.length !== size
  ) {
    throw new ModelInputError("Each grid array must contain exactly width * height samples.");
  }
  const elevationM = new Float64Array(size);
  const slopeMaxDegrees = new Float64Array(size);
  const known = new Uint8Array(size);
  for (let index = 0; index < size; index++) {
    const validity: unknown = mask[index];
    const elevation: unknown = elevations[index];
    const slope: unknown = slopes[index];
    if (validity !== 0 && validity !== 1) {
      throw new ModelInputError(`Mask sample ${index} must be 0 or 1.`);
    }
    if (validity === 0) {
      if (elevation !== null || slope !== null) {
        throw new ModelInputError(`Unknown cell ${index} must retain null numeric samples.`);
      }
      elevationM[index] = Number.NaN;
      slopeMaxDegrees[index] = Number.NaN;
    } else {
      elevationM[index] = signedNumber(elevation, `elevation[${index}]`);
      slopeMaxDegrees[index] = finiteNumber(slope, `slope[${index}]`);
      if (slopeMaxDegrees[index]! > 90) {
        throw new ModelInputError(`Slope at cell ${index} exceeds 90 degrees.`);
      }
      known[index] = 1;
    }
  }
  return { width, height, affine: Object.freeze(affine), radiusM, crsWkt: raw["working_crs_wkt"], elevationM, slopeMaxDegrees, known };
}

function snapNumericalZero(value: number): number {
  return Math.abs(value) <= TIME_EPSILON_MINUTES ? 0 : value;
}

export function evaluateTimeBudget(
  input: MissionInput & { readonly outboundMinutes: number; readonly returnMinutes: number },
): TimeDecision {
  const mission = parseMission(input);
  const outboundMinutes = finiteNumber(input.outboundMinutes, "outboundMinutes");
  const returnMinutes = finiteNumber(input.returnMinutes, "returnMinutes");
  const requiredMinutes = outboundMinutes + mission.scienceMinutes + returnMinutes + mission.reserveMinutes;
  if (!Number.isFinite(requiredMinutes)) {
    throw new ModelInputError("The time sum overflowed; choose representable parameter values.", "NUMERIC_RANGE");
  }
  const rawMarginMinutes = mission.missionBudgetMinutes - requiredMinutes;
  const marginMinutes = snapNumericalZero(rawMarginMinutes);
  return {
    ...mission, outboundMinutes, returnMinutes, requiredMinutes, rawMarginMinutes, marginMinutes,
    maxScienceMinutes: snapNumericalZero(mission.missionBudgetMinutes - outboundMinutes - returnMinutes - mission.reserveMinutes),
    latestReturnDepartureMinute: snapNumericalZero(mission.missionBudgetMinutes - returnMinutes - mission.reserveMinutes),
    meetsModelBudget: marginMinutes >= 0,
    zeroExtraMargin: marginMinutes === 0,
  };
}

interface QueueItem {
  readonly node: number;
  readonly cost: number;
}

class MinHeap {
  private readonly items: QueueItem[] = [];

  get length(): number { return this.items.length; }

  private before(left: QueueItem, right: QueueItem): boolean {
    return left.cost < right.cost || (left.cost === right.cost && left.node < right.node);
  }

  push(item: QueueItem): void {
    this.items.push(item);
    let child = this.items.length - 1;
    while (child > 0) {
      const parent = Math.floor((child - 1) / 2);
      if (!this.before(item, this.items[parent]!)) break;
      this.items[child] = this.items[parent]!;
      child = parent;
    }
    this.items[child] = item;
  }

  pop(): QueueItem {
    const first = this.items[0];
    const last = this.items.pop();
    if (first === undefined || last === undefined) throw new Error("Cannot pop an empty queue.");
    if (this.items.length > 0) {
      let parent = 0;
      while (true) {
        let child = parent * 2 + 1;
        if (child >= this.items.length) break;
        if (child + 1 < this.items.length && this.before(this.items[child + 1]!, this.items[child]!)) child++;
        if (!this.before(this.items[child]!, last)) break;
        this.items[parent] = this.items[child]!;
        parent = child;
      }
      this.items[parent] = last;
    }
    return first;
  }
}

const DIRECTIONS = [
  [-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1],
] as const;

function minutesText(value: number): string {
  return Math.abs(value) < 0.01 && value !== 0 ? value.toPrecision(3) : value.toFixed(2);
}

export class MarswalkPlanner {
  readonly grid: TerrainGrid;
  readonly origin: Cell;
  readonly parameters: TravelParameters;
  readonly statistics: SearchStatistics;
  private readonly originIndex: number;
  private readonly permitted: Uint8Array;
  private readonly outboundMinutes: Float64Array;
  private readonly returnMinutes: Float64Array;
  private readonly outboundParent: Int32Array;
  private readonly returnNext: Int32Array;

  constructor(grid: TerrainGrid, origin: Cell, parameters: TravelParameters, blockedCells: readonly Cell[] = []) {
    this.grid = grid;
    this.origin = Object.freeze({ ...parseCell(origin, "origin") });
    this.parameters = parseTravelParameters(parameters);
    this.originIndex = this.index(this.origin);
    const size = grid.width * grid.height;
    this.permitted = new Uint8Array(size);
    for (let index = 0; index < size; index++) {
      this.permitted[index] = grid.known[index] === 1 && grid.slopeMaxDegrees[index]! <= this.parameters.maximumSlopeDegrees ? 1 : 0;
    }
    for (const cell of blockedCells) this.permitted[this.index(parseCell(cell, "blocked cell"))] = 0;
    this.outboundMinutes = new Float64Array(size).fill(Infinity);
    this.returnMinutes = new Float64Array(size).fill(Infinity);
    this.outboundParent = new Int32Array(size).fill(-1);
    this.returnNext = new Int32Array(size).fill(-1);
    const outboundReached = this.permitted[this.originIndex] ? this.search(false) : 0;
    const returnReached = this.permitted[this.originIndex] ? this.search(true) : 0;
    this.statistics = Object.freeze({
      totalCells: size,
      knownCells: grid.known.reduce((sum, value) => sum + value, 0),
      permittedCells: this.permitted.reduce((sum, value) => sum + value, 0),
      outboundReached, returnReached,
    });
  }

  index(cell: Cell): number {
    if (!Number.isInteger(cell.row) || !Number.isInteger(cell.column) ||
      cell.row < 0 || cell.row >= this.grid.height || cell.column < 0 || cell.column >= this.grid.width) {
      throw new ModelInputError("Cell is outside the grid or has non-integer coordinates.");
    }
    return cell.row * this.grid.width + cell.column;
  }

  cell(index: number): Cell {
    if (!Number.isInteger(index) || index < 0 || index >= this.grid.width * this.grid.height) {
      throw new ModelInputError("Cell index is outside the grid.");
    }
    return { row: Math.floor(index / this.grid.width), column: index % this.grid.width };
  }

  center(cell: Cell): { eastingM: number; northingM: number } {
    this.index(cell);
    return {
      eastingM: this.grid.affine.a * (cell.column + 0.5) + this.grid.affine.c,
      northingM: this.grid.affine.e * (cell.row + 0.5) + this.grid.affine.f,
    };
  }

  private basicEdgeAllowed(from: number, to: number): boolean {
    if (!this.permitted[from] || !this.permitted[to]) return false;
    const dr = Math.floor(to / this.grid.width) - Math.floor(from / this.grid.width);
    const dc = to % this.grid.width - from % this.grid.width;
    const horizontal = Math.hypot(dc * this.grid.affine.a, dr * this.grid.affine.e);
    const rise = this.grid.elevationM[to]! - this.grid.elevationM[from]!;
    return Math.atan2(Math.abs(rise), horizontal) * 180 / Math.PI <= this.parameters.maximumSlopeDegrees;
  }

  edgeMinutes(from: number, to: number): number | null {
    const a = this.cell(from);
    const b = this.cell(to);
    const dr = b.row - a.row;
    const dc = b.column - a.column;
    if ((dr === 0 && dc === 0) || Math.abs(dr) > 1 || Math.abs(dc) > 1) return null;
    if (!this.basicEdgeAllowed(from, to)) return null;
    if (dr !== 0 && dc !== 0) {
      const sideA = a.row * this.grid.width + b.column;
      const sideB = b.row * this.grid.width + a.column;
      if (!this.basicEdgeAllowed(from, sideA) || !this.basicEdgeAllowed(sideA, to) ||
          !this.basicEdgeAllowed(from, sideB) || !this.basicEdgeAllowed(sideB, to)) return null;
    }
    const horizontal = Math.hypot(dc * this.grid.affine.a, dr * this.grid.affine.e);
    const rise = this.grid.elevationM[to]! - this.grid.elevationM[from]!;
    const grade = rise / horizontal;
    const penalty = 1 + this.parameters.uphillPenalty * Math.max(grade, 0) +
      this.parameters.downhillPenalty * Math.max(-grade, 0);
    const time = Math.hypot(horizontal, rise) / this.parameters.baseSpeedMPerMin * penalty;
    if (!Number.isFinite(time) || time <= 0) {
      throw new ModelInputError("Edge time is not finite and positive; check parameter magnitudes.", "NUMERIC_RANGE");
    }
    return time;
  }

  private search(reverse: boolean): number {
    const distances = reverse ? this.returnMinutes : this.outboundMinutes;
    const links = reverse ? this.returnNext : this.outboundParent;
    const heap = new MinHeap();
    distances[this.originIndex] = 0;
    heap.push({ node: this.originIndex, cost: 0 });
    let reached = 0;
    while (heap.length > 0) {
      const current = heap.pop();
      if (current.cost !== distances[current.node]) continue;
      reached++;
      const row = Math.floor(current.node / this.grid.width);
      const column = current.node % this.grid.width;
      for (const [dr, dc] of DIRECTIONS) {
        const nextRow = row + dr;
        const nextColumn = column + dc;
        if (nextRow < 0 || nextRow >= this.grid.height || nextColumn < 0 || nextColumn >= this.grid.width) continue;
        const next = nextRow * this.grid.width + nextColumn;
        // Reverse search must preserve the original next -> current directional cost.
        const edge = reverse ? this.edgeMinutes(next, current.node) : this.edgeMinutes(current.node, next);
        if (edge === null) continue;
        const candidate = current.cost + edge;
        if (!Number.isFinite(candidate)) {
          throw new ModelInputError("Path time overflowed.", "NUMERIC_RANGE");
        }
        if (candidate < distances[next]!) {
          distances[next] = candidate;
          links[next] = current.node;
          heap.push({ node: next, cost: candidate });
        }
      }
    }
    return reached;
  }

  private route(target: number, returning: boolean): Route {
    const links = returning ? this.returnNext : this.outboundParent;
    const cells = [target];
    let cursor = target;
    while (cursor !== this.originIndex) {
      cursor = links[cursor]!;
      if (cursor < 0 || cells.length > this.grid.width * this.grid.height) {
        throw new Error("Internal route reconstruction failed.");
      }
      cells.push(cursor);
    }
    if (!returning) cells.reverse();
    let distanceM = 0;
    let ascentM = 0;
    let descentM = 0;
    for (let index = 1; index < cells.length; index++) {
      const from = cells[index - 1]!;
      const to = cells[index]!;
      const a = this.cell(from);
      const b = this.cell(to);
      const rise = this.grid.elevationM[to]! - this.grid.elevationM[from]!;
      distanceM += Math.hypot((b.column - a.column) * this.grid.affine.a, (b.row - a.row) * this.grid.affine.e, rise);
      ascentM += Math.max(rise, 0);
      descentM += Math.max(-rise, 0);
    }
    return { cells, minutes: (returning ? this.returnMinutes : this.outboundMinutes)[target]!, distanceM, ascentM, descentM };
  }

  plan(destination: Cell, missionInput: MissionInput): PlanResult {
    const mission = parseMission(missionInput);
    const target = this.index(parseCell(destination, "destination"));
    const common = {
      modelVersion: MODEL_VERSION, origin: this.origin, destination: { ...destination },
      parameters: this.parameters, mission,
      scope: "PRE_DEPARTURE_TIME_ONLY_RESEARCH" as const, safetyCertified: false as const,
    };
    const unavailable = (status: "INSUFFICIENT_DATA" | "NO_MODELED_ROUTE", reasonCode: string, explanation: string): PlanResult =>
      ({ ...common, status, reasonCode, explanation, time: null, outbound: null, return: null });
    if (!this.grid.known[this.originIndex] || !this.grid.known[target]) {
      return unavailable("INSUFFICIENT_DATA", "ENDPOINT_DATA_UNKNOWN", "The origin or destination lacks required data; no feasibility result is asserted.");
    }
    if (!this.permitted[this.originIndex] || !this.permitted[target]) {
      return unavailable("NO_MODELED_ROUTE", "ENDPOINT_EXCLUDED", "The origin or destination is excluded by the current slope limit or an explicit blocked-cell rule.");
    }
    if (!Number.isFinite(this.outboundMinutes[target]) || !Number.isFinite(this.returnMinutes[target])) {
      return unavailable("NO_MODELED_ROUTE", "NO_KNOWN_PERMITTED_ROUNDTRIP", "No complete round trip exists within the known, permitted grid and current edge rules. This does not prove that no physical route exists.");
    }
    const time = evaluateTimeBudget({ ...mission, outboundMinutes: this.outboundMinutes[target]!, returnMinutes: this.returnMinutes[target]! });
    return {
      ...common,
      status: time.meetsModelBudget ? "FEASIBLE" : "TIME_BUDGET_EXCEEDED",
      reasonCode: time.meetsModelBudget ? (time.zeroExtraMargin ? "NO_EXTRA_MARGIN" : "WITHIN_TIME_MODEL") : "NEGATIVE_TIME_MARGIN",
      explanation: time.meetsModelBudget
        ? `The complete modeled excursion fits the budget, retains the stated reserve, and leaves ${minutesText(time.marginMinutes)} additional minutes. This is not a safety certification.`
        : `The complete modeled excursion exceeds the budget by ${minutesText(-time.marginMinutes)} minutes. Reduce science time or revise the plan; the reserve is not silently removed.`,
      time, outbound: this.route(target, false), return: this.route(target, true),
    };
  }

  scienceOpportunity(missionInput: MissionInput): ScienceOpportunityField {
    const mission = parseMission(missionInput);
    const codes = new Uint8Array(this.grid.width * this.grid.height);
    const marginMinutes = new Float64Array(codes.length).fill(Number.NaN);
    for (let index = 0; index < codes.length; index++) {
      if (!this.grid.known[this.originIndex] || !this.grid.known[index]) {
        codes[index] = FIELD_CODES.UNKNOWN;
      } else if (!this.permitted[this.originIndex] || !this.permitted[index]) {
        codes[index] = FIELD_CODES.EXCLUDED;
      } else if (!Number.isFinite(this.outboundMinutes[index]) || !Number.isFinite(this.returnMinutes[index])) {
        codes[index] = FIELD_CODES.DISCONNECTED;
      } else {
        const time = evaluateTimeBudget({
          ...mission, outboundMinutes: this.outboundMinutes[index]!, returnMinutes: this.returnMinutes[index]!,
        });
        marginMinutes[index] = time.marginMinutes;
        codes[index] = time.meetsModelBudget
          ? (time.zeroExtraMargin ? FIELD_CODES.ZERO_EXTRA_MARGIN : FIELD_CODES.FEASIBLE)
          : FIELD_CODES.TIME_EXCEEDED;
      }
    }
    return { width: this.grid.width, height: this.grid.height, marginMinutes, codes };
  }
}

export function serializeOpportunityField(field: ScienceOpportunityField): object {
  return {
    width: field.width, height: field.height, flattening: "row-major", codeDefinitions: FIELD_CODES,
    marginMinutes: Array.from(field.marginMinutes, value => Number.isFinite(value) ? value : null),
    codes: Array.from(field.codes),
    note: "Null means no evaluable plan. Codes describe model constraints, never physical safety.",
  };
}
