// Tessera's app: starts renders, receives tiles from job tasks and shows the
// mosaic filling in.
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { GRID, TILE } from "./scene.js";

const port = Number(process.env.PORT ?? 3000);
const page = readFileSync(new URL("./index.html", import.meta.url));

// Mojave gives a production deployment a token that starts jobs in its own
// project. Without it (local, or jobs off) only the CLI starts renders.
const api = process.env.MOJAVE_API_URL;
const token = process.env.MOJAVE_TOKEN;

// The page is public, so one render runs at a time and a new one waits out
// a short cooldown: a visitor can't start renders back to back.
const COOLDOWN_MS = 30_000;

// Tiles are accepted with the newest render's key, or with TILE_KEY for
// renders started from the CLI.
const cliKey = process.env.TILE_KEY ?? "";
let renderKey = "";
let starting = false; // a /render call is creating its job

// The newest render only: job id -> tiles by index. A restart starts empty.
let current = { job: "", tiles: new Map(), started: 0, status: "" };
const watchers = new Set();

function send(res, status, body, type = "text/plain") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

function broadcast(event) {
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const w of watchers) w.write(line);
}

// status is "" for a render started from the CLI: the app isn't following
// that job, so it never holds the Render button back.
function newRender(job, status) {
  current = { job, tiles: new Map(), started: Date.now(), status };
  broadcast({ type: "job", job, status });
}

async function workload(path, init = {}) {
  const res = await fetch(`${api}/api/v1/workload${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `${res.status}`);
  return body;
}

// Start a render: one task per tile, each told where to upload and with what key.
async function startRender(req) {
  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  const proto = req.headers["x-forwarded-proto"] ?? (/localhost|localtest\.me/.test(host) ? "http" : "https");
  const key = randomBytes(16).toString("hex");
  const input = JSON.stringify({ url: `${proto}://${host}`, key });
  const job = await workload("/jobs", {
    method: "POST",
    body: JSON.stringify({ command: "node render.js", inputs: Array(GRID * GRID).fill(input), vcpus: 1, memMiB: 512 }),
  });
  renderKey = key;
  newRender(job.id, "pending");
  watch(job.id);
}

// Follow the job so the page can say what it's waiting for.
async function watch(id) {
  while (current.job === id) {
    try {
      const j = await workload(`/jobs/${id}`);
      const status = j.finishedAt ? j.status : j.running > 0 ? "running" : "pending";
      if (status !== current.status) {
        current.status = status;
        broadcast({ type: "status", job: id, status });
      }
      if (j.finishedAt) return;
    } catch (err) {
      console.error(`watch job ${id}: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const tile = url.pathname.match(/^\/tiles\/([\w-]+)\/(\d+)(\.png)?$/);

  if (req.method === "GET" && url.pathname === "/") return send(res, 200, page, "text/html; charset=utf-8");
  if (req.method === "GET" && url.pathname === "/healthz") return send(res, 200, "ok");

  if (req.method === "GET" && url.pathname === "/state") {
    return send(res, 200, JSON.stringify({
      grid: GRID, tile: TILE, job: current.job, status: current.status,
      done: [...current.tiles.keys()], canRender: Boolean(api && token),
    }), "application/json");
  }

  if (req.method === "GET" && url.pathname === "/events") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    res.write(": hello\n\n");
    watchers.add(res);
    req.on("close", () => watchers.delete(res));
    return;
  }

  if (req.method === "POST" && url.pathname === "/render") {
    if (!api || !token) return send(res, 503, "this deployment can't start jobs; use `mojave jobs run`");
    const busy = starting || current.status === "pending" || current.status === "running";
    if (busy || Date.now() - current.started < COOLDOWN_MS) return send(res, 429, "a render just ran; try again in a moment");
    starting = true;
    try {
      await startRender(req);
      return send(res, 202, JSON.stringify({ job: current.job }), "application/json");
    } catch (err) {
      console.error(`start render: ${err.message}`);
      return send(res, 502, `could not start the render: ${err.message}`);
    } finally {
      starting = false;
    }
  }

  if (req.method === "GET" && tile) {
    const png = tile[1] === current.job && current.tiles.get(Number(tile[2]));
    return png ? send(res, 200, png, "image/png") : send(res, 404, "no such tile");
  }

  if (req.method === "POST" && tile) {
    const given = req.headers["x-tile-key"] ?? "";
    if (!given || (given !== renderKey && given !== cliKey)) return send(res, 403, "bad tile key");
    const index = Number(tile[2]);
    if (index >= GRID * GRID) return send(res, 400, "index out of range");
    const chunks = [];
    for await (const c of req) chunks.push(c);
    if (current.job !== tile[1]) newRender(tile[1], ""); // a render started from the CLI
    current.tiles.set(index, Buffer.concat(chunks));
    broadcast({ type: "tile", job: current.job, index, ms: Number(req.headers["x-render-ms"] ?? 0) });
    return send(res, 201, "stored");
  }

  send(res, 404, "not found");
}).listen(port, "0.0.0.0", () => console.log(`tessera listening on :${port}`));
