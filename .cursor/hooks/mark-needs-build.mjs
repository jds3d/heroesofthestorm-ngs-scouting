import { writeFileSync } from "node:fs";
import { basename } from "node:path";

const watchedNames = new Set([
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "next.config.ts",
  "next.config.mjs",
  "next.config.js",
  "postcss.config.mjs",
  "postcss.config.js",
  "eslint.config.mjs",
  "eslint.config.js",
]);

const watchedExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".css",
]);

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve(""));
  });
}

function shouldBuild(filePath) {
  const normalized = filePath.replaceAll("\\", "/");
  if (!normalized) return false;
  if (normalized.includes("/node_modules/") || normalized.includes("/.next/")) return false;
  if (normalized.includes("/.cursor/") || normalized.includes("/drafts/") || normalized.includes("/.cache/")) {
    return false;
  }
  const name = basename(normalized);
  if (watchedNames.has(name)) return true;
  const slash = normalized.lastIndexOf("/");
  const ext = normalized.slice(normalized.lastIndexOf("."));
  if (!watchedExtensions.has(ext)) return false;
  const inSrc = normalized.includes("/src/");
  const inScripts = normalized.includes("/scripts/");
  return inSrc || inScripts || slash === -1;
}

const raw = await readStdin();
let filePath = "";
try {
  const input = JSON.parse(raw || "{}");
  filePath = String(input.file_path ?? input.path ?? "");
} catch {
  filePath = "";
}

if (shouldBuild(filePath)) {
  writeFileSync(new URL("../needs-build", import.meta.url), `${filePath}\n`, "utf8");
}

process.stdout.write("{}\n");
