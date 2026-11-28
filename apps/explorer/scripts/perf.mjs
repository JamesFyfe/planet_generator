/**
 * Scripted descent from orbit to the surface.
 * Reports average frame time, worst frame time, and the longest main-thread
 * task. The Long Task API only records work over 50 ms, so the task time
 * comes from Chrome's timeline (RunTask on the renderer thread).
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const port = 4173;
const flightMs = 8_000;
const appRoot = fileURLToPath(new URL("..", import.meta.url));
const screenshotDir = fileURLToPath(new URL("../../../docs/screenshots/phase-2/", import.meta.url));

function startPreview() {
  const child = spawn(
    "pnpm",
    ["exec", "vite", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    { cwd: appRoot, stdio: ["ignore", "pipe", "pipe"] },
  );
  return new Promise((resolve, reject) => {
    let started = false;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("vite preview did not start"));
    }, 30_000);
    let log = "";
    const onData = (chunk) => {
      log += chunk.toString();
      if (!started && (log.includes("Local:") || log.includes(`127.0.0.1:${port}`))) {
        started = true;
        clearTimeout(timer);
        resolve(child);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => {
      if (started) return;
      clearTimeout(timer);
      reject(new Error(`vite preview exited ${code}\n${log}`));
    });
  });
}

function trackTasks(client) {
  /** @type {Map<string, string>} */
  const threadName = new Map();
  /** @type {Map<string, { frame: number, call: number, message: number }>} */
  const longest = new Map();
  client.on("Tracing.dataCollected", (payload) => {
    const batch = Array.isArray(payload?.value) ? payload.value : [];
    for (const event of batch) {
      const key = `${event.pid}:${event.tid}`;
      if (event.ph === "M" && event.name === "thread_name") {
        const name = event.args?.name ?? event.args?.thread_name;
        if (typeof name === "string") threadName.set(key, name);
      }
      if (typeof event.dur !== "number") continue;
      const slot = longest.get(key) ?? { frame: 0, call: 0, message: 0 };
      if (event.name === "FireAnimationFrame" && event.dur > slot.frame) slot.frame = event.dur;
      if (event.name === "FunctionCall" && event.dur > slot.call) slot.call = event.dur;
      if (event.name === "HandlePostMessage" && event.dur > slot.message) slot.message = event.dur;
      longest.set(key, slot);
    }
  });
  return { threadName, longest };
}

function rendererTasks(threadName, longest) {
  for (const [key, slot] of longest) {
    if (threadName.get(key) !== "CrRendererMain") continue;
    // Chrome's timeline reports an animation callback as FireAnimationFrame
    // rather than RunTask. That slice is the main-thread task for the frame.
    return {
      longestTaskMs: slot.frame / 1000,
      longestFunctionMs: slot.call / 1000,
      longestWorkerMessageMs: slot.message / 1000,
    };
  }
  return { longestTaskMs: 0, longestFunctionMs: 0, longestWorkerMessageMs: 0 };
}

const preview = await startPreview();
const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const errors = [];
const workers = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => {
    errors.push(String(error));
  });
  page.on("response", (response) => {
    const url = response.url();
    if (url.includes("worker")) workers.push({ url, status: response.status() });
  });

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => {
      const stats = document.querySelector("[data-testid='chunk-stats']");
      const camera = window.__planetCamera;
      return Boolean(camera) && Boolean(stats?.textContent?.match(/Chunks\s+[1-9]/));
    },
    { timeout: 30_000 },
  );
  await page.waitForTimeout(500);

  if (process.env.PERF_SCREENSHOTS === "1") {
    await mkdir(screenshotDir, { recursive: true });
    await page.screenshot({ path: `${screenshotDir}/seed-1-worker-orbit.png` });
  }

  const client = await page.context().newCDPSession(page);
  const tasks = trackTasks(client);
  await client.send("Tracing.start", {
    transferMode: "ReportEvents",
    traceConfig: {
      recordMode: "recordUntilFull",
      includedCategories: ["devtools.timeline"],
    },
  });
  const flight = await page.evaluate(async (durationMs) => {
    const camera = window.__planetCamera;
    const start = camera.getView().distance;
    /** @type {number[]} */
    const frames = [];
    await new Promise((resolve) => {
      const t0 = performance.now();
      let last = t0;
      const step = (now) => {
        const u = Math.min(1, (now - t0) / durationMs);
        camera.setView({ distance: start * (1 / start) ** u });
        frames.push(now - last);
        last = now;
        if (u < 1) requestAnimationFrame(step);
        else resolve(undefined);
      };
      requestAnimationFrame(step);
    });
    const samples = frames.slice(1);
    const worstFrameMs = Math.max(...samples);
    const averageFrameMs = samples.reduce((sum, frame) => sum + frame, 0) / samples.length;
    const endDistance = await new Promise((resolve) => {
      requestAnimationFrame(() => resolve(camera.getView().distance));
    });
    return {
      averageFrameMs,
      worstFrameMs,
      frames: samples.length,
      startDistance: start,
      endDistance,
    };
  }, flightMs);
  await client.send("Tracing.end");
  await new Promise((resolve) => client.once("Tracing.tracingComplete", resolve));
  const tasksReport = rendererTasks(tasks.threadName, tasks.longest);
  const budgets = await page.evaluate(() => window.__planetPerf ?? null);

  if (process.env.PERF_SCREENSHOTS === "1") {
    await page.screenshot({ path: `${screenshotDir}/seed-1-worker-ground.png` });
  }

  const report = {
    ...flight,
    ...tasksReport,
    workers,
    errors,
    mainThread: budgets,
  };
  console.log(JSON.stringify(report, null, 2));
  if (workers.length === 0 || workers.some((worker) => worker.status >= 400)) {
    throw new Error("Chunk worker did not load");
  }
  if (errors.length > 0) {
    throw new Error(`Page errors:\n${errors.join("\n")}`);
  }
} finally {
  await browser.close();
  preview.kill();
}
