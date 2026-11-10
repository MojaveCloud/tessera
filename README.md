# Tessera

A render farm in two files, built on [Mojave Jobs](https://mojave.sh/docs/jobs).

Tessera renders one 3840 × 3840 view of the Mandelbrot set (Seahorse Valley) as an 8 × 8 mosaic.
Every tile is a separate job task, and each task runs in its own microVM. The app page shows the
mosaic filling in as tiles arrive.

- `server.js` is the app. It starts renders, takes tile uploads and streams them to the page.
- `render.js` is the task. It renders tile `$MOJAVE_TASK_INDEX` and uploads it.
- `scene.js` sets the view, tile size and quality.

## Run it

```sh
mojave deploy --repo MojaveCloud/tessera
```

Open the URL it prints and click **Render**. The app starts a 64-task job with the token Mojave gives
every production deployment, and passes each task the upload URL and a one-time key. The first
render waits about 2 minutes for machines to start. After that a render takes under 10 seconds,
where one core takes about a minute.

The page is public, so it runs one render at a time and waits 30 seconds between starts.

### From the CLI

To start renders with `mojave jobs run` instead, give the tasks the app's URL and a shared key, then
redeploy so the app reads the key:

```sh
mojave env set <project> TILE_KEY=$(openssl rand -hex 16)
mojave env set --plain <project> TESSERA_URL=https://<project>.mojavedev.sh
mojave deploy --repo MojaveCloud/tessera
mojave jobs run --tasks 64 <project> -- node render.js
```

## Long exposure

`exposure.js` is the long-running version: an 8192 × 8192 render where each of the 64 tasks
spends a fixed time budget on samples, uploading a preview every 20 seconds. Open `/long` to watch
it, with a clock and a mark at Lambda's 15-minute limit. It uses the CLI setup above (`TILE_KEY`
and `TESSERA_URL`):

```sh
mojave jobs run --tasks 64 --vcpus 1 --mem 512 --timeout 10800 --detach <project> -- node exposure.js 150
```

The argument is the budget in minutes; a task may run for up to 3 hours.

Locally, `node render.js` with `MOJAVE_TASK_INDEX=0` writes `tile-0.png` instead of uploading.

MIT licensed.
