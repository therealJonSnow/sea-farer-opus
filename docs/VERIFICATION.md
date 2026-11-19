# Verification

## Deliverable

`index.html` is a single self-contained file: raw WebGPU, no engine, and no textures or model files. Everything is procedural.

- Minified size: **50,818 bytes** (20,691 bytes gzipped).

## Gate 1: Visual critic

The critic was an independent subagent that saw only the rendered images, never the code or my reasoning. Each round it reviewed:

- Six fixed camera poses (`?shot=0..5`) at 2560×1440.
- 90 contiguous frames at 30 fps and 2560×1440, delivered as an overview sheet plus 1:1 crops of four consecutive frames from three screen regions at two points in time. These checked for shimmer, crawling aliasing, popping and banding.

It took four rounds.

| Round | Above-minor findings | Main fixes |
| --- | --- | --- |
| 1 | 2 major, 7 moderate | Rebuilt the wake: it was blocky and too long. Scaled up the sailor. Added calm patches to the foam lines. Made creature shapes crisper. Raised the ink-edge thresholds. Restyled the key-hint box. Brightened the crabs. Strengthened the watercolor. |
| 2 | 3 moderate | Made the coastline analytic and anti-aliased with alpha-to-coverage. Stopped ink lines on terrain triangle creases. Classified rock by face normal. Spaced trees apart by size. |
| 3 | 1 moderate | Gave the whales a recognizable silhouette (flippers, a lit spine, no bending). Spaced out the gulls that follow the boat. |
| 4 | **none** | n/a |

**Final verdict (round 4):** "Nothing above 'minor' remains." The temporal check found no shimmer, crawling jaggies, banding or popping. The one exception is an occasional isolated ink speck on one tree canopy.

The remaining minor issues are:
- Isolated ink specks that flicker on one canopy.
- Some wind streaks bend back on themselves in a hairpin.
- A straight shading seam on one cliff face.
- Regular sawtooth edges at cliff corners.
- Occasional overlaps between gulls, or a gull over a crab or the sailor.
- A gull passing over the compass.

Final renders are in `docs/renders/`: six stills and `flythrough.mp4`, which is the 3-second, 90-frame sequence the critic reviewed.

## Gate 2: Performance — NOT verified on the target hardware

The target is an RTX 5070 Ti with Chrome 157 at 2560×1440: average GPU time ≤ 11 ms and no frame over 16.7 ms during a 60 s scripted fly-through.

**I could not measure this.** The build container has no GPU, and Chromium here runs WebGPU on SwiftShader, a CPU rasterizer. Presenting to a WebGPU canvas also loses the device in this headless setup, so capture renders off-screen and reads the frame back.

What *is* done:

- **Harness:** `?bench` runs a 60 s scripted fly-through. The boat sails on autopilot through waypoints while the camera zoom sweeps. The harness records:
  - GPU timestamp queries covering the whole frame, from the start of the shadow pass to the end of the post pass. Each frame's result is resolved and copied into a large GPU buffer and read back once at the end, so there are no per-frame map/await calls.
  - The `requestAnimationFrame` interval for every frame, in a preallocated `Float64Array`.

  It reports average, p99 and max for both, plus the number of frames over 16.7 ms. The report goes to the console, to `window.__bench` and to an on-screen panel.
- **Harness validated on SwiftShader** at 1280×720: the timestamps resolve correctly and the report is generated. The numbers themselves (about 3.4 s of GPU time per frame on a CPU) say nothing about an RTX 5070 Ti.
- **Design for frame pacing:**
  - All pipelines are compiled up front with `createRenderPipelineAsync` before the first frame.
  - All draw commands are recorded once into render bundles, and all animation runs from one uniform buffer.
  - Shadows use one 2048² depth map, snapped to texels.
  - The scene renders into an MSAA 4× rgba16f color target plus an rgba8 aux target, then a single full-screen post pass.
  - Geometry is about 0.5 M vertices.

**To run the perf gate on the target machine:** open `index.html?bench` from a local HTTP server in Chrome on the 5070 Ti at 2560×1440, with the window fullscreen and DPR 1, or add `&w=2560&h=1440`. Wait about 62 s and read the JSON report. Alternatively run `node tools/bench.mjs 2560 1440 ""` with a GPU-backed Chrome.

## Per-frame JS allocations

These were measured with a CDP sampling heap profile, which records objects even after they've been collected. It ran over 20,000 frames of the real per-frame CPU path (simulation plus uniform upload) after JIT warm-up: `node tools/alloc.mjs`, output in `docs/alloc.json`.

- Before fixing: about **1,880 B/frame**, almost all from `Math.hypot` and boxed float returns.
- After: about **61 B/frame**, all inside `step()`. These are V8 heap-number boxes that I couldn't remove; converting the state to typed arrays made it worse at 195 B/frame. At 180 Hz that's about 11 KB/s, so a young-generation scavenge happens roughly every 20+ minutes and takes well under 1 ms.
- My code allocates **no** arrays, objects or closures per frame. All buffers, uniforms, pass descriptors and command bundles are preallocated.
- WebGPU's API itself still creates a few wrapper objects every frame: the command encoder, the three pass encoders, the command buffer, and the swap-chain texture view. The API offers no way to avoid these.

So the brief's "zero per-frame allocations" is met for application data. It is **not literally zero** because of this residual V8 boxing and the WebGPU wrapper objects.
