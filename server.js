// Tessera's app: receives tiles from job tasks and shows the mosaic filling in.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { GRID, TILE } from "./scene.js";

const port = Number(process.env.PORT ?? 3000);
const key = process.env.TILE_KEY ?? "";
const page = readFileSync(new URL("./index.html", import.meta.url));

// The newest render only: job id -> tiles by index. A restart starts empty.
let current = { job: "", tiles: new Map(), started: 0 };
const watchers = new Set();

function send(res, status, body, type = "text/plain") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

function broadcast(event) {
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const w of watchers) w.write(line);
}

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const tile = url.pathname.match(/^\/tiles\/([\w-]+)\/(\d+)(\.png)?$/);

  if (req.method === "GET" && url.pathname === "/") return send(res, 200, page, "text/html; charset=utf-8");
  if (req.method === "GET" && url.pathname === "/healthz") return send(res, 200, "ok");

  if (req.method === "GET" && url.pathname === "/state") {
    return send(res, 200, JSON.stringify({ grid: GRID, tile: TILE, job: current.job, done: [...current.tiles.keys()] }), "application/json");
  }

  if (req.method === "GET" && url.pathname === "/events") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    res.write(": hello\n\n");
    watchers.add(res);
    req.on("close", () => watchers.delete(res));
    return;
  }

  if (req.method === "GET" && tile) {
    const png = tile[1] === current.job && current.tiles.get(Number(tile[2]));
    return png ? send(res, 200, png, "image/png") : send(res, 404, "no such tile");
  }

  if (req.method === "POST" && tile) {
    if (!key || req.headers["x-tile-key"] !== key) return send(res, 403, "bad tile key");
    const index = Number(tile[2]);
    if (index >= GRID * GRID) return send(res, 400, "index out of range");
    const chunks = [];
    for await (const c of req) chunks.push(c);
    if (current.job !== tile[1]) {
      current = { job: tile[1], tiles: new Map(), started: Date.now() };
      broadcast({ type: "job", job: current.job });
    }
    current.tiles.set(index, Buffer.concat(chunks));
    broadcast({ type: "tile", job: current.job, index, ms: Number(req.headers["x-render-ms"] ?? 0) });
    return send(res, 201, "stored");
  }

  send(res, 404, "not found");
}).listen(port, "0.0.0.0", () => console.log(`tessera listening on :${port}`));
