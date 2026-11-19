# Sea Farer

An isometric, watercolor-style sailing scene in a single self-contained `index.html`, rendered with raw WebGPU. No engine, no textures and no model files: every mesh, colour and paper grain is made in code.

## Controls

| Key | Action |
| --- | --- |
| **S / D** | Push the tiller left / right |
| **I** | Sheet in (pull the sail in) |
| **O** | Sheet out (let the sail out) |
| **A** | Drop or raise the anchor |
| Mouse wheel | Zoom |

The wind blows from a fixed direction that drifts slowly. The boom swings to the leeward side, up to the angle the sheet allows. If the sheet is too loose for the wind angle, the sail luffs: it flaps, loses power and the boat slows. Trim it in until it fills. Into the wind there is no drive. On a run the sail works by drag, on a reach by lift. The boat heels and the pennant shows the apparent wind. A seagull lands on the mast from time to time.

## URL flags

- `?bench`: runs a 60 s scripted fly-through (autopilot plus zoom sweep), then prints a JSON report with the average, p99 and max of the frame interval and of the GPU time from timestamp queries. It also shows the report on screen.
- `?shot=0..5`: the six fixed camera poses used for visual review.
- `?capture`: deterministic frame stepping through `window.__frame(t)`. It renders off-screen and reads the frame back.
- `?offscreen`: renders without presenting to the canvas. Use it for headless runs.
- `&w=…&h=…`: forces the render resolution.

## Build

Source lives in `src/`. Run `node tools/build.mjs` to produce the minified `index.html`. First run `npm i` in `tools/`, which installs esbuild.

## Verification tools

- `tools/shoot.mjs`: renders the six poses at 2560×1440.
- `tools/seq.mjs`: renders a contiguous frame sequence for temporal review.
- `tools/bench.mjs`: runs `?bench` and records a CDP sampling heap profile, which shows where per-frame JS allocations come from.
