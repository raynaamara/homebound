import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const deployment = path.join(root, "deploy");
const source = path.resolve(root, "..", "data", "homebound", "web");
const { applicationVersion } = JSON.parse(await readFile(path.join(root, "config", "application.json"), "utf8"));
const javascriptNames = (await readdir(path.join(root, "dist"))).filter(name => name.endsWith(".js")).sort();
const buildHash = createHash("sha256");
for (const name of javascriptNames) buildHash.update(await readFile(path.join(root, "dist", name)));
for (const relative of ["public/styles.css", "public/mars-illustration.svg", "config/application.json", "config/illustrative-preset.json", "scripts/stage.mjs"]) {
  buildHash.update(await readFile(path.join(root, relative)));
}
for (const name of ["sources.json", "regional-context.json", "regional-context.svg"]) {
  buildHash.update(await readFile(path.join(source, name)));
}
const assetVersion = `${applicationVersion}-${buildHash.digest("hex").slice(0, 12)}`;
const marker = path.join(deployment, "HOMEBOUND_BUILD.txt");
try {
  await access(deployment);
  await access(marker);
  await rm(deployment, { recursive: true });
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  try {
    await access(deployment);
    throw new Error("Refusing to replace an existing deploy directory without HOMEBOUND_BUILD.txt.");
  } catch (inspection) {
    if (inspection.code !== "ENOENT") throw inspection;
  }
}
await mkdir(path.join(deployment, "js"), { recursive: true });
await mkdir(path.join(deployment, "data"), { recursive: true });
for (const name of await readdir(path.join(root, "public"))) {
  if (name === "index.html") {
    const html = await readFile(path.join(root, "public", name), "utf8");
    await writeFile(path.join(deployment, name), html
      .replace('href="./styles.css"', `href="./styles.css?v=${assetVersion}"`)
      .replace('src="./js/app.js"', `src="./js/app.js?v=${assetVersion}"`)
      .replaceAll('src="./mars-illustration.svg"', `src="./mars-illustration.svg?v=${assetVersion}"`));
  } else {
    await copyFile(path.join(root, "public", name), path.join(deployment, name));
  }
}
for (const name of await readdir(path.join(root, "dist"))) {
  if (name.endsWith(".js")) {
    const code = await readFile(path.join(root, "dist", name), "utf8");
    const versioned = code
      .replace(/(["'])(\.\/[\w-]+\.js)\1/g, `$1$2?v=${assetVersion}$1`)
      .replace(/(["'])(\.\.?\/data\/[\w-]+\.json)\1/g, `$1$2?v=${assetVersion}$1`);
    await writeFile(path.join(deployment, "js", name), versioned);
  }
}
const dataFiles = [
  "terrain_grid.json", "scenario.json", "manifest.json", "sources.json", "optical.webp",
  "elevation.png", "slope.png", "thermal_context.png", "valid_mask.png",
  "regional-context.json", "regional-context.svg",
];
const hashes = [];
for (const name of dataFiles) {
  const bytes = await readFile(path.join(source, name));
  await copyFile(path.join(source, name), path.join(deployment, "data", name));
  hashes.push({ filename: name, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
}
await copyFile(path.join(root, "config", "illustrative-preset.json"), path.join(deployment, "data", "preset.json"));
await copyFile(path.join(root, "config", "application.json"), path.join(deployment, "data", "application.json"));
await writeFile(marker,
  `HOMEBOUND application ${applicationVersion}; decision model 1.0.0. Research prototype only.\n` +
  "Upload these directory CONTENTS, not TypeScript or node_modules.\n" +
  "No Node.js/Python/PHP backend, account, API key, or external runtime dependency.\n" +
  "Serve using HTTP(S), not file://. Relative URLs support a domain root or subfolder.\n" +
  "Do not replace an existing website or .htaccess without reviewing its contents.\n",
);
await mkdir(path.join(root, "evidence"), { recursive: true });
await writeFile(path.join(root, "evidence", "application-deployment-inputs.json"), JSON.stringify(hashes, null, 2));
console.log("Static Rumahweb-compatible build:", deployment);
console.log("Compiled JavaScript modules and", dataFiles.length, "source-prepared web inputs, including local regional context, staged.");
