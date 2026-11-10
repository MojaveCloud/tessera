// Wind tunnel: one job task simulates airflow past one wing design.
//
//   node tunnel.js [minutes]
//
// Task $MOJAVE_TASK_INDEX picks a NACA airfoil (row) and an angle of attack
// (column) from tunnel-designs.js. The flow is a 2D lattice Boltzmann
// simulation (D2Q9, BGK). The task runs for its whole budget, averaging lift
// and drag once the flow has settled, and uploads a frame of the vorticity
// field a few times a second.
import { deflateSync, crc32 } from "node:zlib";
import { design, naca, TUNNEL } from "./tunnel-designs.js";

const { W, H, CHORD, U0, RE, CX, FRAME_MS } = TUNNEL;
const minutes = Number(process.argv[2] ?? process.env.TUNNEL_MINUTES ?? 120);
const index = Number(process.env.MOJAVE_TASK_INDEX ?? 0);
const job = process.env.MOJAVE_JOB_ID ?? "local";
const appURL = process.env.TESSERA_URL;
const tileKey = process.env.TILE_KEY ?? "";
const d = design(index);

const started = Date.now();
const deadline = started + minutes * 60_000;

// Lattice: 9 velocities, weights and opposites.
const EX = [0, 1, 0, -1, 0, 1, -1, -1, 1];
const EY = [0, 0, 1, 0, -1, 1, 1, -1, -1];
const WT = [4 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 36, 1 / 36, 1 / 36, 1 / 36];
const OPP = [0, 3, 4, 1, 2, 7, 8, 5, 6];
const N = W * H;
const nu = (U0 * CHORD) / RE;
const omega = 1 / (3 * nu + 0.5);

let f = new Float32Array(9 * N);
let g = new Float32Array(9 * N);
const ux = new Float32Array(N), uy = new Float32Array(N), rho = new Float32Array(N);
const solid = airfoilMask();

for (let k = 0; k < N; k++) {
  for (let i = 0; i < 9; i++) f[i * N + k] = feq(i, 1, U0, 0);
}

function feq(i, r, u, v) {
  const eu = EX[i] * u + EY[i] * v;
  return WT[i] * r * (1 + 3 * eu + 4.5 * eu * eu - 1.5 * (u * u + v * v));
}

// The airfoil, rotated about its quarter chord, in the left third of the tunnel.
function airfoilMask() {
  const m = new Uint8Array(N);
  const cx = W * CX, cy = H / 2;
  const a = (d.angle * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  for (let j = 0; j < H; j++) {
    for (let x = 0; x < W; x++) {
      // Screen y points down; the airfoil's y points up. A positive angle
      // pitches the nose up, into the oncoming flow from the left.
      const px = x - cx, py = cy - j;
      const xr = (px * ca - py * sa) / CHORD + 0.25;
      const yr = (px * sa + py * ca) / CHORD;
      if (xr < 0 || xr > 1) continue;
      const [yc, yt] = naca(d, xr);
      if (Math.abs(yr - yc) <= yt) m[j * W + x] = 1;
    }
  }
  return m;
}

// One step: collide, then stream with bounce-back on the airfoil.
// Returns the force the fluid put on the airfoil this step.
function step() {
  let fx = 0, fy = 0;
  for (let k = 0; k < N; k++) {
    if (solid[k]) continue;
    let r = 0, u = 0, v = 0;
    for (let i = 0; i < 9; i++) {
      const q = f[i * N + k];
      r += q; u += q * EX[i]; v += q * EY[i];
    }
    u /= r; v /= r;
    rho[k] = r; ux[k] = u; uy[k] = v;
    const x = k % W, j = (k - x) / W;
    for (let i = 0; i < 9; i++) {
      const q = f[i * N + k];
      const post = q + omega * (feq(i, r, u, v) - q);
      let tx = x + EX[i];
      if (tx < 0 || tx >= W) continue;
      let tj = j + EY[i];
      if (tj < 0) tj += H; else if (tj >= H) tj -= H;
      const t = tj * W + tx;
      if (solid[t]) {
        g[OPP[i] * N + k] = post;
        fx += 2 * post * EX[i];
        fy += 2 * post * EY[i];
      } else {
        g[i * N + t] = post;
      }
    }
  }
  // Inlet: uniform flow. Outlet: zero gradient.
  for (let j = 0; j < H; j++) {
    const a = j * W, b = j * W + W - 1;
    for (let i = 0; i < 9; i++) {
      g[i * N + a] = feq(i, 1, U0, 0);
      g[i * N + b] = g[i * N + b - 1];
    }
  }
  const s = f; f = g; g = s;
  return [fx, fy];
}

// Lift and drag, averaged once the flow has crossed the tunnel twice.
const settle = Math.round((2 * W) / U0);
const q = 0.5 * U0 * U0 * CHORD;
let steps = 0, sumL = 0, sumD = 0, avgN = 0, lastFrame = 0, cl = 0, cd = 0;
// How much the lift swings around its mean: vortex shedding makes it oscillate.
let liftMean = 0, liftVar = 0;

while (Date.now() < deadline) {
  const [fx, fy] = step();
  steps++;
  const inst = -fy / q;
  liftMean += 0.002 * (inst - liftMean);
  liftVar += 0.002 * ((inst - liftMean) ** 2 - liftVar);
  if (steps > settle) {
    sumD += fx; sumL += -fy; avgN++;
    cl = sumL / avgN / q; cd = sumD / avgN / q;
  } else {
    cl = -fy / q; cd = fx / q;
  }
  if ((steps & 15) === 0 && Date.now() - lastFrame > FRAME_MS) await upload(false);
  if (!Number.isFinite(cl)) throw new Error(`simulation diverged at step ${steps}`);
}
await upload(true);
console.log(`design ${index} NACA ${d.name} at ${d.angle}°: CL ${cl.toFixed(3)}, CD ${cd.toFixed(3)}, L/D ${(cl / cd).toFixed(2)}, swing ${Math.sqrt(liftVar).toFixed(3)}, ${steps} steps in ${((Date.now() - started) / 60000).toFixed(1)} min`);

// The frame: vorticity, cyan one way and orange the other, the wing in white.
function frame() {
  const out = new Uint8Array(N * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = y * W + x, o = k * 3;
      if (solid[k]) { out[o] = 245; out[o + 1] = 245; out[o + 2] = 250; continue; }
      const xl = x > 0 ? k - 1 : k, xr = x < W - 1 ? k + 1 : k;
      const yu = y > 0 ? k - W : k + (H - 1) * W, yd = y < H - 1 ? k + W : k - (H - 1) * W;
      const curl = (uy[xr] - uy[xl]) - (ux[yd] - ux[yu]);
      const sp = Math.hypot(ux[k], uy[k]) / U0;
      const w = Math.max(-1, Math.min(1, curl / (U0 * 0.5)));
      const a = Math.abs(w) ** 0.6;
      const base = [8 + 14 * sp, 10 + 18 * sp, 26 + 30 * sp]; // calm flow: deep blue, brighter where fast
      const hot = w > 0 ? [255, 150, 40] : [60, 200, 255];
      out[o] = base[0] + (hot[0] - base[0]) * a;
      out[o + 1] = base[1] + (hot[1] - base[1]) * a;
      out[o + 2] = base[2] + (hot[2] - base[2]) * a;
    }
  }
  return encodePNG(W, H, out);
}

async function upload(done) {
  lastFrame = Date.now();
  const png = frame();
  if (!appURL) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(`tunnel-${index}.png`, png);
    return;
  }
  const meta = {
    name: d.name, angle: d.angle, cl, cd, settled: steps > settle, steps, swing: Math.sqrt(Math.max(0, liftVar)),
    started, deadline, done,
  };
  try {
    const res = await fetch(`${appURL}/tunnel/${job}/${index}`, {
      method: "POST",
      headers: { "content-type": "image/png", "x-tile-key": tileKey, "x-meta": JSON.stringify(meta) },
      body: png,
    });
    if (!res.ok) console.error(`frame upload: ${res.status} ${await res.text()}`);
  } catch (err) {
    console.error(`frame upload: ${err.message}`);
  }
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
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 3 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}
