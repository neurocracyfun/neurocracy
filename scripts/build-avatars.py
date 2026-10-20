#!/usr/bin/env python3
"""Build the square X avatar library: public/img/avatars/{id}.png, 400x400, centered on cream paper #f3f0e8.
Source per persona: public/img/minds/{id}.webp, else any {id}.jpg/.png under public/img/minds or a dir given as argv[1].
Missing sources are skipped. Usage: python3 scripts/build-avatars.py [extra_source_dir]"""
import os, sys
from PIL import Image
IDS = ['owl', 'cat', 'pirate', 'degen', 'dino', 'space', 'ocean', 'chef', 'ghost', 'bard', 'lord', 'romantic']
ROOT = os.path.join(os.path.dirname(__file__), '..')
DIRS = [os.path.join(ROOT, 'public/img/minds')] + sys.argv[1:]
OUT = os.path.join(ROOT, 'public/img/avatars'); os.makedirs(OUT, exist_ok=True)
CREAM = (243, 240, 232); SIZE = 400; PAD = 0.86
def find(i):
    for d in DIRS:
        for e in ('webp', 'png', 'jpg', 'jpeg'):
            p = os.path.join(d, f'{i}.{e}')
            if os.path.exists(p): return p
done = 0
for i in IDS:
    src = find(i)
    if not src: print('skip', i, '(no source)'); continue
    im = Image.open(src).convert('RGBA'); im.thumbnail((int(SIZE * PAD), int(SIZE * PAD)), Image.LANCZOS)
    bg = Image.new('RGBA', (SIZE, SIZE), CREAM + (255,)); bg.alpha_composite(im, ((SIZE - im.width) // 2, (SIZE - im.height) // 2))
    bg.convert('RGB').save(os.path.join(OUT, f'{i}.png'), optimize=True); done += 1; print('ok', i)
print(f'{done}/{len(IDS)} avatars written')
