import {
  MarswalkPlanner, ModelInputError, finiteNumber, objectValue, parseCell,
  parseMission, parseTerrainGrid, parseTravelParameters,
} from "./engine.js";
import type { TerrainGrid } from "./engine.js";
import type { CalculationResponse, FailureResponse } from "./protocol.js";

let loadedGrid: Promise<TerrainGrid> | undefined;
let currentPlanner: MarswalkPlanner | undefined;
let currentKey = "";

function grid(): Promise<TerrainGrid> {
  loadedGrid ??= fetch(new URL("../data/terrain_grid.json", import.meta.url)).then(async response => {
    if (!response.ok) throw new Error(`Terrain download failed: HTTP ${response.status}.`);
    const raw: unknown = await response.json();
    return parseTerrainGrid(raw);
  }).catch((error: unknown) => {
    loadedGrid = undefined;
    throw error;
  });
  return loadedGrid;
}

globalThis.addEventListener("message", async (event: MessageEvent<unknown>) => {
  let requestId = 0;
  try {
    const started = performance.now();
    const raw = objectValue(event.data, "worker request");
    requestId = finiteNumber(raw["requestId"], "requestId");
    if (!Number.isSafeInteger(requestId) || raw["kind"] !== "calculate") {
      throw new ModelInputError("Unsupported request kind or non-integer request id.");
    }
    const parameters = parseTravelParameters(raw["parameters"]);
    const origin = parseCell(raw["origin"], "origin");
    const destination = parseCell(raw["destination"], "destination");
    const mission = parseMission(raw["mission"]);
    const terrain = await grid();
    const key = JSON.stringify({ origin, parameters });
    const searchRebuilt = currentPlanner === undefined || key !== currentKey;
    if (searchRebuilt) {
      currentPlanner = new MarswalkPlanner(terrain, origin, parameters);
      currentKey = key;
    }
    if (currentPlanner === undefined) throw new Error("Planner initialization failed.");
    const response: CalculationResponse = {
      kind: "result", requestId,
      plan: currentPlanner.plan(destination, mission),
      field: currentPlanner.scienceOpportunity(mission),
      statistics: currentPlanner.statistics,
      searchRebuilt,
      elapsedMilliseconds: performance.now() - started,
      geometry: {
        width: terrain.width, height: terrain.height, affine: terrain.affine,
        crsWkt: terrain.crsWkt, radiusM: terrain.radiusM,
      },
    };
    globalThis.postMessage(response);
  } catch (error: unknown) {
    console.error("HOMEBOUND decision worker failed:", error);
    const response: FailureResponse = {
      kind: "error", requestId,
      code: error instanceof ModelInputError ? error.code : "MODEL_OR_DATA_ERROR",
      message: error instanceof Error ? error.message : "The model failed with an unexpected error.",
    };
    globalThis.postMessage(response);
  }
});
