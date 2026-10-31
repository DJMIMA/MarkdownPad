// Runs every Playwright browser check in one go, the way CI does.
//
// If nothing answers at MARKDOWNPAD_URL (default http://127.0.0.1:1420), this
// starts the Vite dev server first and stops it again afterwards. A server
// that is already running is reused and left alone.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const baseUrl = process.env.MARKDOWNPAD_URL ?? "http://127.0.0.1:1420";
const checks = [
  "live-preview-check.mjs",
  "print-check.mjs",
  "click-caret-check.mjs",
  "drag-drift-check.mjs",
  "reading-mode-check.mjs",
  "editor-safety-check.mjs",
];

async function isUp() {
  try {
    const response = await fetch(baseUrl);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitUntilUp(server, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Vite exited early with code ${server.exitCode}`);
    }
    if (await isUp()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Vite did not answer at ${baseUrl} within ${timeoutMs} ms`);
}

function runCheck(file) {
  const path = fileURLToPath(new URL(file, import.meta.url));
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path], { stdio: "inherit" });
    child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

let server = null;
if (!(await isUp())) {
  console.log(`Starting Vite dev server for ${baseUrl} ...`);
  // detached puts Vite in its own process group so the whole group can be
  // stopped at the end, including the esbuild child processes.
  server = spawn("npm", ["run", "dev"], {
    stdio: "ignore",
    detached: true,
    shell: process.platform === "win32",
  });
}

function stopServer() {
  if (!server || server.exitCode !== null) {
    return;
  }
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(server.pid), "/t", "/f"]);
    } else {
      process.kill(-server.pid, "SIGTERM");
    }
  } catch {
    // Already gone.
  }
}

process.on("SIGINT", () => {
  stopServer();
  process.exit(130);
});

const failed = [];
try {
  if (server) {
    await waitUntilUp(server, 60_000);
  }
  for (const check of checks) {
    console.log(`\n=== ${check}`);
    const code = await runCheck(check);
    if (code !== 0) {
      failed.push(check);
    }
  }
} finally {
  stopServer();
}

if (failed.length > 0) {
  console.error(`\nFailed: ${failed.join(", ")}`);
  process.exit(1);
}
console.log(`\nAll ${checks.length} browser checks passed.`);
