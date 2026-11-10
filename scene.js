// The picture: one deep view of the Mandelbrot set, cut into a GRID x GRID
// mosaic. Each job task renders one tile of it.
export const GRID = 8;
export const TILE = 480; // px per tile side; the full image is 3840 x 3840
export const SAMPLES = 4; // supersampling per axis
export const MAX_ITER = 1500;

// Seahorse valley, zoomed in ~400x.
export const CENTER = [-0.7448, 0.1306];
export const SPAN = 0.0075;

// The long exposure: a deeper view (the double spiral near Seahorse Valley),
// 8192 x 8192 at up to 5000 iterations. Each task spends its whole time
// budget on samples; the page shows 256 px previews.
export const LONG = {
  GRID: 8,
  TILE: 1024,
  PREVIEW: 256,
  MAX_ITER: 5000,
  MAX_SPP: 4096,
  CENTER: [-0.743643887037151, 0.131825904205330],
  SPAN: 0.00012,
};
