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
  FRAME_MS: 2000,
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
