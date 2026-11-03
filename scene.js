// The picture: one deep view of the Mandelbrot set, cut into a GRID x GRID
// mosaic. Each job task renders one tile of it.
export const GRID = 8;
export const TILE = 480; // px per tile side; the full image is 3840 x 3840
export const SAMPLES = 4; // supersampling per axis
export const MAX_ITER = 4000;

// Seahorse valley, zoomed in ~400x.
export const CENTER = [-0.743643887, 0.131825904];
export const SPAN = 0.0075;
