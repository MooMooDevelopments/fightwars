/**
 * The dev server the two browser-driven perf harnesses measure against.
 *
 * Shared because ClientTickPerf and ClientMemoryPerf had byte-identical
 * copies of it, so the Windows bugs below had to be found twice.
 */
import { ChildProcess, spawn as spawnProcess } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const IS_WINDOWS = process.platform === "win32";

export async function startViteServer(port: number): Promise<ChildProcess> {
  // --strictPort makes vite exit instead of silently picking another port —
  // that also guards against measuring a different checkout's server.
  //
  // Spawned as node + vite's own entry rather than `npx vite`: `npx` is a
  // .cmd shim on Windows, which spawn() cannot execute without shell: true,
  // and shell: true would put a cmd.exe between us and the process we later
  // have to kill. This resolves the same binary npx would have.
  const child = spawnProcess(
    process.execPath,
    [
      path.join(PROJECT_ROOT, "node_modules/vite/bin/vite.js"),
      "--port",
      String(port),
      "--strictPort",
    ],
    {
      env: { ...process.env, SKIP_BROWSER_OPEN: "true" },
      stdio: ["ignore", "pipe", "pipe"],
      // Own process group, so cleanup kills vite's children. Windows has no
      // POSIX process groups — detached there only opens a new console, and
      // stopViteServer uses taskkill /T instead.
      detached: !IS_WINDOWS,
    },
  );
  let output = "";
  child.stdout?.on("data", (d: Buffer) => (output += d.toString()));
  child.stderr?.on("data", (d: Buffer) => (output += d.toString()));

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `vite exited with code ${child.exitCode} (port ${port} busy?)\n${output}`,
      );
    }
    try {
      const res = await fetch(`http://localhost:${port}/`);
      if (res.ok) return child;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`vite did not become ready on port ${port}\n${output}`);
}

export function stopViteServer(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  try {
    if (IS_WINDOWS) {
      // /T takes the child tree with it, which is what the process group
      // does elsewhere; /F because vite does not answer a polite close.
      spawnProcess("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } else {
      process.kill(-child.pid, "SIGTERM"); // whole process group
    }
  } catch {
    // already gone
  }
}
