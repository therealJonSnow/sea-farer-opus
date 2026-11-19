# Verification

## Deliverable

`index.html` is a single self-contained file: raw WebGPU, no engine, and no textures or model files. Everything is procedural.

- Minified size: **59,257 bytes** (24,148 bytes gzipped). It was 50,818 / 20,691 before the performance pass; the extra ~8 KB is the adaptive-quality ladder, the 1× MSAA path, culling and the extended bench harness.

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

## Gate 2: Performance (measured on a real GPU, 2026-11-19)

**Machine:** Apple M2 Max (30-core GPU, Metal 3), macOS, Google Chrome 157.0.8103.79. Adapter reported as `{vendor: "apple", architecture: "metal-3"}`, not a fallback adapter. Displays: built-in 120 Hz ProMotion and an external 60 Hz 2560×1440 monitor.

### How it's measured

- `node tools/gpubench.mjs W H` is the A/B measure. Each of the six critic poses is rendered 600 times back to back (`?shot=K&gpubench`), with the GPU saturated so Apple's clock scaling stays at peak. It reports the **median** GPU time from timestamp queries, per pass and in total.
- `node tools/bench.mjs W H "&secs=30"` runs the scripted fly-through, presented to a visible window with real vsync. It reports frame pacing, GPU avg/p50/p99/max per pass, the adapter, resolution and DPR, and a budget PASS/FAIL. The on-screen report has a "Copy report" button.
- **Per-pass attribution:** pass times are "exclusive" (this pass's end minus the previous pass's end). On a tile-based GPU, raw begin/end spans overlap and don't add up. `&split` times water separately from the other objects.
- **Caveat:** in presented runs at 60 Hz the M2 Max clocks down, so GPU ms looks higher than in saturated runs. Compare like with like.

### Before → after, GPU ms per frame (fixed-pose median, mean of six poses)

| Pass | 2560×1440 before | after | 1280×720 before | after |
| --- | --- | --- | --- | --- |
| Shadow (2048²) | 0.16 | 0.07 | 0.13 | 0.08 |
| Objects (terrain, trees, boat…) | 1.82 | 1.03 | 0.78 | 0.71 |
| Water + streaks | 10.34 | 2.84 | 3.21 | 1.11 |
| Post (ink, watercolor, HUD) | 1.20 | 0.77 | 0.33 | 0.43 |
| **Total** | **13.66** | **4.74** | **4.47** | **2.33** |

"Before" is the original renderer (commit 59793b1) with only the new timing harness added. It's pixel-identical to the original renders. "After" is at the top quality level (native resolution, 4× MSAA, 2048² shadows). The table was measured before the last outline/crescent tweak, which only removes work.

Fly-through baseline on the original build, presented, 60 s: 2560×1440 GPU 13.2 ms avg / 19.1 p99 / 21.9 max, 1,374 frames over 16.7 ms. 1280×720: 6.1 / 7.5 / 8.9 ms.
Fly-through after, presented, 30 s at 1280×720: GPU 3.9 avg / 4.9 p99, 120 Hz with 6 missed vsyncs out of 3,589 frames. With `&adaptive` at 2560×1440 on the 60 Hz display: 0 missed vsyncs out of 1,799 frames, PASS. The presented fixed-level run at 2560×1440 kept closing its browser window in this session, so that number still needs a re-run.

### What changed

- **Water:**
  - `shoreD` used to loop over 22 islands per pixel and per vertex. Now a 720² `r8uint` nearest-island grid is baked at init, so each lookup evaluates one island exactly. The coastline stays analytic and pixel-identical.
  - The wave normal is analytic and computed per vertex (it was 3 Gerstner evaluations per pixel).
  - The Voronoi foam computes its 9 feature points once and reuses them for the border pass. That replaces 9 + 25 cells with hashing and sines, with identical output.
  - Very low-frequency fields (pigment, calm patches, cloud shadow) are now per vertex.
  - Line-width and lapping-ring noise only run where they can show.
  - The wake loop skips 8-segment groups by CPU-computed bounding boxes.
- **Post:** the static screen-space paper, wobble and pigment noise is baked once per canvas size into an `rgba8` texture, replacing about 13 value-noise evaluations per pixel.
- **Objects:** cloud shadow per vertex. Per-island culling against the camera and shadow frusta through indirect draws, so the bundles stay static and culling is a tiny buffer write only when visibility changes.
- **Visual changes requested on 2026-11-19:** removed the white "crest crescent" (horseshoe) wave marks, and made the ink outline thinner (sampling radius about −30%) and lighter (0.85 → 0.6 opacity).

### Adaptive quality

The ladder runs from level 0 to 7: `[scene megapixels, MSAA, shadow map, water detail]`. The post pass and HUD always render at native resolution; only the 3D scene is scaled.

| Level | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Scene | 0.9 MP | 1.2 | 1.6 | 2.1 | 2.1 | 2.8 | 3.7 | native |
| MSAA | 1× | 4× | 4× | 4× | 4× | 4× | 4× | 4× |
| Shadow | 1024 | 1024 | 1024 | 1024 | 2048 | 2048 | 2048 | 2048 |
| Water detail | low | low | low | full | full | full | full | full |
| GPU ms (1440p, M2 Max) | 2.43 | 2.80 | — | 3.23 | 4.35 | — | 4.30 | 4.74 |

- **No 2× MSAA tier.** WebGPU only allows sample counts 1 and 4, so 2× isn't possible. Resolution drops first, and 1× (with a hard alpha-tested coastline) is only the bottom rung.
- **Start level:** discrete NVIDIA/AMD starts at 7, Apple at 6, and everything else (integrated, mobile, unknown) at 3. A fallback adapter starts at 0.
- **Controller:**
  - Every 0.5 s it compares the average whole-frame GPU time (timestamp readback every 4th frame) with 80% of the measured display period. It steps down when over and steps up when under 62%.
  - A step up that doesn't fit blocks further steps up for 15 s.
  - On high-refresh displays below level 4 it switches to rendering every other vsync rather than degrading further.
  - The pipelines for the other MSAA count compile in the background.
- **Flags:** `?q=N` pins a level, and `&adaptive` turns the controller on in bench mode.
- Verified: every level renders correctly (shots at levels 0, 1, 3, 4 and 6), and the controller climbed from 6 to 7 on the M2 Max. **Not verified:** a run on a genuinely weaker GPU. This machine has no integrated GPU to force.

## Per-frame JS allocations

Re-measured on 2026-11-19 with `node tools/alloc.mjs`, after JIT warm-up:

- **CPU path** (sim plus uniform upload, the same measure as before): **62 B/frame**, unchanged from 61 B/frame within sampling noise. The culling test and wake boxes allocate nothing.
- **Full frame** (new measure, including command encoding and submission): **221 B/frame**. This is mostly WebGPU's own wrapper objects (encoder, pass encoders, command buffer, swap-chain view) plus one `mapAsync` promise every 4th frame for the adaptive controller. There was no earlier full-frame figure to compare against.

These were measured with a CDP sampling heap profile, which records objects even after they've been collected. It ran over 20,000 frames of the real per-frame CPU path (simulation plus uniform upload) after JIT warm-up: `node tools/alloc.mjs`, output in `docs/alloc.json`.

- Before fixing: about **1,880 B/frame**, almost all from `Math.hypot` and boxed float returns.
- After: about **61 B/frame**, all inside `step()`. These are V8 heap-number boxes that I couldn't remove; converting the state to typed arrays made it worse at 195 B/frame. At 180 Hz that's about 11 KB/s, so a young-generation scavenge happens roughly every 20+ minutes and takes well under 1 ms.
- My code allocates **no** arrays, objects or closures per frame. All buffers, uniforms, pass descriptors and command bundles are preallocated.
- WebGPU's API itself still creates a few wrapper objects every frame: the command encoder, the three pass encoders, the command buffer, and the swap-chain texture view. The API offers no way to avoid these.

So the brief's "zero per-frame allocations" is met for application data. It is **not literally zero** because of this residual V8 boxing and the WebGPU wrapper objects.

## Open items (paused 2026-11-19)

- **Visual critic gate not re-run** after the performance pass and the outline/crescent change. The renders before the outline change were pixel-identical, or within 1–4/255, to the approved set. The outline change is a deliberate look change. Work-in-progress stills are in `docs/renders/wip/`, and the approved set in `docs/renders/` is untouched.
- Remaining minor visual items not yet addressed: flickering canopy ink speck, hairpin wind streaks, straight cliff shading seam, cliff-corner sawtooth, overlapping gulls.
- Presented 2560×1440 fixed-level fly-through needs a re-run: the visible browser window closed mid-run here.
- No weaker-GPU run yet. Force a level with `?q=0..7` to preview the tiers.
- Further GPU headroom: water is still about 60% of the frame (gust and warp noise, 9-tap shadow PCF on water), and the post ink pass does 9 MSAA depth loads plus 8 aux taps.
