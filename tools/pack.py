# pack frame sequence for critic: 1:1 crops of consecutive frames + overview + mp4
import sys, os, glob, subprocess
from PIL import Image
d = sys.argv[1]; out = sys.argv[2]; os.makedirs(out, exist_ok=True)
fr = sorted(glob.glob(d + '/f*.png'))
# overview: every 12th frame, half-size
ov = [Image.open(f).resize((1280, 720)) for f in fr[::12]][:10]
sh = Image.new('RGB', (2560, 720 * ((len(ov) + 1) // 2)))
for i, im in enumerate(ov): sh.paste(im, ((i % 2) * 1280, (i // 2) * 720))
sh.save(out + '/seq_overview.png')
# 1:1 crops of 4 consecutive frames for 3 regions (centre/boat, top-left, bottom-right)
regs = {'center': (1280 - 400, 720 - 300), 'topleft': (200, 150), 'bottomright': (1700, 900)}
for name, (x, y) in regs.items():
    for start in (20, len(fr) - 6):
        strip = Image.new('RGB', (1600, 1200))
        for k in range(4):
            im = Image.open(fr[start + k]).crop((x, y, x + 800, y + 600))
            strip.paste(im, ((k % 2) * 800, (k // 2) * 600))
        strip.save(f'{out}/consec_{name}_{start}.png')
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', '30', '-i', d + '/f%04d.png', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', out + '/flythrough.mp4'])
print('packed', len(fr))
