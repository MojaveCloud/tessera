# Tessera

A render farm in two files, built on [Mojave Jobs](https://mojave.sh/docs/jobs).

Tessera renders one 3840 × 3840 view of the Mandelbrot set (Seahorse Valley) as an 8 × 8 mosaic.
Every tile is a separate job task, and each task runs in its own microVM. The app page shows the
mosaic filling in as tiles arrive.

- `server.js` is the app. It takes tile uploads and streams them to the page.
- `render.js` is the task. It renders tile `$MOJAVE_TASK_INDEX` and uploads it.
- `scene.js` sets the view, tile size and quality.

## Run it

```sh
mojave deploy --repo MojaveCloud/tessera
mojave env set tessera TILE_KEY=$(openssl rand -hex 16)
mojave env set --plain tessera TESSERA_URL=https://tessera.mojavedev.sh   # your project's URL
mojave jobs run --tasks 64 tessera -- node render.js
```

On one core the whole image takes about a minute. As 64 tasks it takes a few seconds.

Locally, `node render.js` with `MOJAVE_TASK_INDEX=0` writes `tile-0.png` instead of uploading.

MIT licensed.
