import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../deploy/", import.meta.url)));
const portArgument = process.argv.indexOf("--port");
const port = portArgument >= 0 ? Number(process.argv[portArgument + 1]) : 4173;
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid preview port.");
const qaArgument = process.argv.indexOf("--qa-case");
const qaCase = qaArgument >= 0 ? process.argv[qaArgument + 1] : undefined;
if (qaCase !== undefined && !["missing-practice", "delayed-grid", "config-failure"].includes(qaCase)) throw new Error("Unsupported QA case.");
let configRequests = 0;
await stat(path.join(root, "index.html"));
const mime = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".webp": "image/webp", ".txt": "text/plain; charset=utf-8",
};
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    let relative = decodeURIComponent(url.pathname);
    if (relative.startsWith("/nested/homebound/")) relative = relative.slice("/nested/homebound".length);
    if (relative === "/") relative = "/index.html";
    const filename = path.resolve(root, "." + relative);
    if (!filename.startsWith(root + path.sep) || relative.split("/").some(part => part.startsWith("."))) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    if (qaCase === "config-failure" && relative === "/data/application.json" && configRequests++ === 0) {
      response.writeHead(503, { "Content-Type": "text/plain", "X-Homebound-QA-Fixture": qaCase });
      response.end("Intentional development-only configuration failure.");
      return;
    }
    if (qaCase === "delayed-grid" && relative === "/data/terrain_grid.json") await new Promise(resolve => setTimeout(resolve, 1500));
    let data = await readFile(filename);
    if (qaCase === "missing-practice" && relative === "/data/terrain_grid.json") {
      const fixture = JSON.parse(data.toString("utf8"));
      const index = 70 * fixture.width + 37;
      fixture.valid_mask[index] = 0; fixture.elevation_m_mean[index] = null; fixture.slope_max_deg[index] = null;
      data = Buffer.from(JSON.stringify(fixture));
    }
    response.writeHead(200, {
      "Content-Type": mime[path.extname(filename)] ?? "application/octet-stream",
      "Cache-Control": "no-store",
      ...(qaCase === undefined ? {} : { "X-Homebound-QA-Fixture": qaCase }),
    });
    response.end(data);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EISDIR") {
      response.writeHead(404);
      response.end("Not found");
    } else {
      console.error("Preview request failed:", error);
      response.writeHead(500);
      response.end("Preview server error");
    }
  }
});
server.on("error", error => { console.error(error); process.exitCode = 1; });
server.listen(port, "127.0.0.1", () => {
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("Preview address unavailable.");
  console.log(`HOMEBOUND preview ready: http://127.0.0.1:${address.port}/`);
  console.log(`Subfolder test: http://127.0.0.1:${address.port}/nested/homebound/`);
  if (qaCase !== undefined) console.log(`DEVELOPMENT QA FIXTURE ACTIVE: ${qaCase}. Source files are not changed; never use this helper as production hosting.`);
});
