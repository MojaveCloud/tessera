// Long exposure: one job task that renders one tile for as long as it's given.
//
//   node exposure.js [minutes]
//
// The tile is rendered top to bottom. Each row gets as many samples per pixel
// as the remaining time allows, so the task works through its whole budget
// and finishes on time: a 2-hour task spends 2 hours computing. Every 20
// seconds it uploads a preview of the rows done so far.
import { deflateSync, crc32 } from "node:zlib";
import { LONG } from "./scene.js";

const { GRID, TILE, PREVIEW, MAX_ITER, CENTER, SPAN, MAX_SPP } = LONG;
const minutes = Number(process.argv[2] ?? process.env.EXPOSURE_MINUTES ?? 120);
const index = Number(process.env.MOJAVE_TASK_INDEX ?? 0);
const job = process.env.MOJAVE_JOB_ID ?? "local";
const appURL = process.env.TESSERA_URL;
const tileKey = process.env.TILE_KEY ?? "";
const col = index % GRID;
const row = Math.floor(index / GRID);

const started = Date.now();
const deadline = started + minutes * 60_000;
const px = SPAN / (GRID * TILE);
const x0 = CENTER[0] - SPAN / 2 + col * TILE * px;
const y0 = CENTER[1] - SPAN / 2 + row * TILE * px;

const rgb = new Float32Array(TILE * TILE * 3); // final colour per pixel
let rows = 0, samples = 0, lastUpload = 0;
let msPerSampleRow = 0; // running estimate of one sample across one row

for (let y = 0; y < TILE; y++) {
  // Spend the time left evenly on the rows left.
  const left = deadline - Date.now();
  let spp = 1;
  if (msPerSampleRow > 0) spp = Math.floor(left / (TILE - y) / msPerSampleRow);
  spp = Math.max(1, Math.min(MAX_SPP, spp));

  const t = performance.now();
  renderRow(y, spp);
  const ms = performance.now() - t;
  const est = ms / spp;
  msPerSampleRow = msPerSampleRow ? 0.8 * msPerSampleRow + 0.2 * est : est;
  rows = y + 1;
  samples += spp * TILE;

  if (Date.now() - lastUpload > 20_000 || rows === TILE) await upload(rows === TILE);
}
// A row capped at MAX_SPP can leave time over; the task still ends then.
console.log(`tile ${index} (${col},${row}): ${TILE} rows, ${samples.toLocaleString()} samples in ${((Date.now() - started) / 60000).toFixed(1)} min`);

function renderRow(y, spp) {
  // Jittered samples on a rotating R2 sequence: even coverage at any count.
  const a1 = 0.7548776662466927, a2 = 0.5698402909980532;
  for (let x = 0; x < TILE; x++) {
    let r = 0, g = 0, b = 0;
    for (let s = 0; s < spp; s++) {
      const jx = (0.5 + a1 * (s + 1)) % 1, jy = (0.5 + a2 * (s + 1)) % 1;
      const c = shade(x0 + (x + jx) * px, y0 + (y + jy) * px);
      r += c[0]; g += c[1]; b += c[2];
    }
    const o = (y * TILE + x) * 3;
    rgb[o] = r / spp; rgb[o + 1] = g / spp; rgb[o + 2] = b / spp;
  }
}

// The preview: the tile scaled down to PREVIEW px, rows not yet rendered left dark.
function preview() {
  const f = TILE / PREVIEW;
  const out = new Uint8Array(PREVIEW * PREVIEW * 3);
  const doneRows = Math.floor(rows / f);
  for (let y = 0; y < doneRows; y++) {
    for (let x = 0; x < PREVIEW; x++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < f; dy++) {
        for (let dx = 0; dx < f; dx++) {
          const o = ((y * f + dy) * TILE + x * f + dx) * 3;
          r += rgb[o]; g += rgb[o + 1]; b += rgb[o + 2];
        }
      }
      const o = (y * PREVIEW + x) * 3, n = f * f;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
    }
  }
  return out;
}

async function upload(done) {
  lastUpload = Date.now();
  const png = encodePNG(PREVIEW, PREVIEW, preview());
  if (!appURL) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(`long-${index}.png`, png);
    return;
  }
  const headers = {
    "content-type": "image/png",
    "x-tile-key": tileKey,
    "x-rows": String(rows),
    "x-of": String(TILE),
    "x-samples": String(samples),
    "x-started": String(started),
    "x-deadline": String(deadline),
    "x-done": done ? "1" : "0",
  };
  // A failed preview isn't fatal: the next one carries the same rows and more.
  try {
    const res = await fetch(`${appURL}/long/${job}/${index}`, { method: "POST", headers, body: png });
    if (!res.ok) console.error(`preview upload: ${res.status} ${await res.text()}`);
  } catch (err) {
    console.error(`preview upload: ${err.message}`);
  }
}

// Smooth escape-time colouring: a cool palette, so it reads apart from the quick render.
function shade(cx, cy) {
  let zx = 0, zy = 0, i = 0;
  while (i < MAX_ITER) {
    const xx = zx * zx, yy = zy * zy;
    if (xx + yy > 256) break;
    zy = 2 * zx * zy + cy;
    zx = xx - yy + cx;
    i++;
  }
  if (i === MAX_ITER) return [3, 3, 8];
  const nu = i + 1 - Math.log2(Math.log2(zx * zx + zy * zy) / 2);
  const t = Math.log(nu) * 0.55;
  const glow = Math.min(1, 0.12 + nu / 190);
  return [
    255 * glow * (0.5 + 0.5 * Math.cos(6.2832 * (t + 0.55))),
    255 * glow * (0.5 + 0.5 * Math.cos(6.2832 * (t + 0.40))),
    255 * glow * (0.5 + 0.5 * Math.cos(6.2832 * (t + 0.25))),
  ];
}

function encodePNG(w, h, pix) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(pix.buffer, y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
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
