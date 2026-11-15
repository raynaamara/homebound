import { finiteNumber, objectValue, parseCell } from "./engine.js";
import type {
  AffineGrid, Cell, MissionInput, PlanResult, ScienceOpportunityField, SearchStatistics, TravelParameters,
} from "./engine.js";

export interface CalculateRequest {
  readonly kind: "calculate";
  readonly requestId: number;
  readonly origin: Cell;
  readonly destination: Cell;
  readonly parameters: TravelParameters;
  readonly mission: MissionInput;
}

export interface CalculationResponse {
  readonly kind: "result";
  readonly requestId: number;
  readonly plan: PlanResult;
  readonly field: ScienceOpportunityField;
  readonly statistics: SearchStatistics;
  readonly searchRebuilt: boolean;
  readonly elapsedMilliseconds: number;
  readonly geometry: {
    readonly width: number;
    readonly height: number;
    readonly affine: AffineGrid;
    readonly crsWkt: string;
    readonly radiusM: number;
  };
}

export interface FailureResponse {
  readonly kind: "error";
  readonly requestId: number;
  readonly code: string;
  readonly message: string;
}

export type WorkerResponse = CalculationResponse | FailureResponse;

export interface ScenarioPoint extends Cell {
  readonly id: string;
  readonly name: string;
  readonly scienceMinutes: number;
}

export interface Scenario {
  readonly gridWidth: number;
  readonly gridHeight: number;
  readonly origin: ScenarioPoint;
  readonly targets: readonly ScenarioPoint[];
  readonly missionBudgetMinutes: number;
  readonly reserveMinutes: number;
}

export function parseScenario(value: unknown): Scenario {
  const raw = objectValue(value, "scenario");
  if (!Array.isArray(raw["points"])) throw new Error("Scenario points are missing.");
  const points = raw["points"].map((item: unknown) => {
    const point = objectValue(item, "scenario point");
    if (typeof point["id"] !== "string" || typeof point["name"] !== "string") {
      throw new Error("Scenario points require string identifiers and names.");
    }
    return {
      ...parseCell(point),
      id: point["id"], name: point["name"],
      scienceMinutes: finiteNumber(point["science_minutes"], "scenario science_minutes"),
    };
  });
  const origin = points.find(point => point.id === "H");
  if (!origin || new Set(points.map(point => point.id)).size !== points.length) {
    throw new Error("Scenario must have one H origin and unique point identifiers.");
  }
  const targets = points.filter(point => point.id !== "H");
  if (targets.length === 0) throw new Error("Scenario has no candidate destinations.");
  const gridWidth = finiteNumber(raw["grid_width"], "scenario grid_width", 1);
  const gridHeight = finiteNumber(raw["grid_height"], "scenario grid_height", 1);
  if (!Number.isSafeInteger(gridWidth) || !Number.isSafeInteger(gridHeight) ||
      points.some(point => point.row >= gridHeight || point.column >= gridWidth || point.id === "custom")) {
    throw new Error("Scenario dimensions or point coordinates are invalid, or a point uses the reserved custom identifier.");
  }
  return {
    origin, targets,
    gridWidth, gridHeight,
    missionBudgetMinutes: finiteNumber(raw["mission_time_budget_minutes"], "scenario budget"),
    reserveMinutes: finiteNumber(raw["reserve_minutes"], "scenario reserve"),
  };
}
