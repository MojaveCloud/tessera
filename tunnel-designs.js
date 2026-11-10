// The wind-tunnel sweep: 8 NACA airfoils (rows) x 8 angles of attack (columns).
// Task i flies airfoil floor(i / 8) at angle i % 8.
export const AIRFOILS = ["0006", "0012", "0018", "2412", "2418", "4412", "4418", "6412"];
export const ANGLES = [0, 3, 6, 9, 12, 15, 20, 25];

export const TUNNEL = {
  W: 320, // lattice cells
  H: 120,
  CHORD: 70,
  U0: 0.1, // inflow speed, lattice units
  RE: 600, // Reynolds number on the chord
  CX: 0.22, // the quarter chord sits this far along the tunnel, mid-height
  FRAME_MS: 600,
};

export function design(i) {
  const name = AIRFOILS[Math.floor(i / ANGLES.length) % AIRFOILS.length];
  return {
    name,
    angle: ANGLES[i % ANGLES.length],
    m: Number(name[0]) / 100,
    p: Number(name[1]) / 10,
    t: Number(name.slice(2)) / 100,
  };
}

// NACA 4-digit: camber line and half thickness at x (fraction of chord).
export function naca({ m, p, t }, x) {
  const yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
  let yc = 0;
  if (m > 0) yc = x < p ? (m / (p * p)) * (2 * p * x - x * x) : (m / ((1 - p) ** 2)) * (1 - 2 * p + 2 * p * x - x * x);
  return [yc, yt];
}

// The airfoil's outline in lattice cells (x right, y down), for drawing it.
export function outline(i, steps = 60) {
  const d = design(i);
  const { W, H, CHORD, CX } = TUNNEL;
  const a = (d.angle * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  const pt = (xr, yr) => {
    const u = CHORD * (xr - 0.25), v = CHORD * yr;
    return [W * CX + ca * u + sa * v, H / 2 - (-sa * u + ca * v)];
  };
  const xs = Array.from({ length: steps + 1 }, (_, k) => (1 - Math.cos((Math.PI * k) / steps)) / 2);
  const upper = xs.map((x) => { const [yc, yt] = naca(d, x); return pt(x, yc + yt); });
  const lower = xs.map((x) => { const [yc, yt] = naca(d, x); return pt(x, yc - yt); }).reverse();
  return [...upper, ...lower];
}
