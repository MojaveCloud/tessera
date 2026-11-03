// One job task: render tile $MOJAVE_TASK_INDEX and upload it to the app.
import { deflateSync, crc32 } from "node:zlib";
import { GRID, TILE, SAMPLES, MAX_ITER, CENTER, SPAN } from "./scene.js";

const index = Number(process.env.MOJAVE_TASK_INDEX ?? 0);
const job = process.env.MOJAVE_JOB_ID ?? "local";
const appURL = process.env.TESSERA_URL;
const col = index % GRID;
const row = Math.floor(index / GRID);

const started = performance.now();
const rgb = renderTile(col, row);
const png = encodePNG(TILE, TILE, rgb);
const ms = Math.round(performance.now() - started);

if (appURL) {
  const res = await fetch(`${appURL}/tiles/${job}/${index}`, {
    method: "POST",
    headers: { "content-type": "image/png", "x-tile-key": process.env.TILE_KEY ?? "", "x-render-ms": String(ms) },
    body: png,
  });
  if (!res.ok) throw new Error(`upload failed: ${res.status} ${await res.text()}`);
} else {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(`tile-${index}.png`, png);
}
console.log(`tile ${index} (${col},${row}) rendered in ${ms} ms`);

function renderTile(col, row) {
  const out = new Uint8Array(TILE * TILE * 3);
  const px = SPAN / (GRID * TILE);
  const x0 = CENTER[0] - SPAN / 2 + col * TILE * px;
  const y0 = CENTER[1] - SPAN / 2 + row * TILE * px;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const [cr, cg, cb] = shade(x0 + (x + (sx + 0.5) / SAMPLES) * px, y0 + (y + (sy + 0.5) / SAMPLES) * px);
          r += cr; g += cg; b += cb;
        }
      }
      const n = SAMPLES * SAMPLES, o = (y * TILE + x) * 3;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
    }
  }
  return out;
}

// Smooth escape-time colouring through a cosine palette over near-black.
function shade(cx, cy) {
  let zx = 0, zy = 0, i = 0;
  while (i < MAX_ITER) {
    const xx = zx * zx, yy = zy * zy;
    if (xx + yy > 256) break;
    zy = 2 * zx * zy + cy;
    zx = xx - yy + cx;
    i++;
  }
  if (i === MAX_ITER) return [4, 4, 10];
  const nu = i + 1 - Math.log2(Math.log2(zx * zx + zy * zy) / 2);
  const t = Math.log(nu) * 0.42;
  const glow = Math.min(1, 0.25 + nu / 160);
  return [
    255 * glow * (0.5 + 0.5 * Math.cos(6.2832 * (t + 0.00))),
    255 * glow * (0.5 + 0.5 * Math.cos(6.2832 * (t + 0.15))),
    255 * glow * (0.5 + 0.5 * Math.cos(6.2832 * (t + 0.30))),
  ];
}

function encodePNG(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}
