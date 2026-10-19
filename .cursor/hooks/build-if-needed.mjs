import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";

const flagPath = new URL("../needs-build", import.meta.url);

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve(""));
  });
}

function emit(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

const raw = await readStdin();
let status = "completed";
try {
  status = JSON.parse(raw || "{}").status ?? "completed";
} catch {
  status = "completed";
}

if (status === "aborted" || !existsSync(flagPath)) {
  emit({});
  process.exit(0);
}

const build = spawn("npm", ["run", "build"], {
  cwd: process.cwd(),
  shell: true,
  windowsHide: true,
});

let output = "";
const keep = (chunk) => {
  output += chunk.toString();
  if (output.length > 80_000) output = output.slice(-80_000);
};
build.stdout.on("data", keep);
build.stderr.on("data", keep);

const code = await new Promise((resolve) => {
  build.on("error", () => resolve(1));
  build.on("close", (exitCode) => resolve(exitCode ?? 1));
});

if (code === 0) {
  rmSync(flagPath, { force: true });
  emit({});
  process.exit(0);
}

const tail = output.trim().split(/\r?\n/).slice(-40).join("\n");
emit({
  followup_message: [
    "npm run build failed. Fix the build before stopping.",
    tail || `npm run build exited ${code}.`,
  ].join("\n\n"),
});
