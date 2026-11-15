#!/usr/bin/env python3
"""Turn the weather art (firmware/tools/art/*.png) into firmware + web data.

  python3 firmware/tools/mkwxart.py

Sources (pixel art made with SpriteCook, transparent backgrounds):
  kid_sheet.png   the kid in 8 outfits, 4x2 grid:
                  hot, warm, mild, cool, freezing, rain, snow, night
  sky_sheet.png   one row: big cloud, medium cloud, small cloud, rain cloud, sun, moon
  bg_*.png        the same countryside spot as summer, spring, autumn, winter, night
                  (sky left transparent: the firmware paints its own)

Writes:
  firmware/LarpCharm/wx_art.h   palettes (RGB888) + 8-bit pixels, index 0 = transparent
  wxart.js                      the same pixels as PNG data URIs for the web preview
Needs Pillow + numpy.  PREVIEW=/path/out.png also writes a contact sheet.
"""
import base64, io, os, sys
from collections import deque
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.join(HERE, 'art')
ROOT = os.path.dirname(os.path.dirname(HERE))
SCR_W, SCR_H = 240, 280
KID_H = 66
SKY_W = [64, 48, 34, 62, 36, 28]          # target widths: big, medium, small cloud, rain cloud, sun, moon
BGS = ['summer', 'spring', 'autumn', 'winter', 'night']


def blobs(alpha):
    H, W = alpha.shape
    lab = np.zeros((H, W), np.int32)
    out, n = [], 0
    for y in range(H):
        for x in range(W):
            if alpha[y, x] and not lab[y, x]:
                n += 1
                q = deque([(y, x)]); lab[y, x] = n
                x0 = x1 = x; y0 = y1 = y; c = 0
                while q:
                    cy, cx = q.popleft(); c += 1
                    x0, x1, y0, y1 = min(x0, cx), max(x1, cx), min(y0, cy), max(y1, cy)
                    for dy in (-1, 0, 1):
                        for dx in (-1, 0, 1):
                            ny, nx = cy + dy, cx + dx
                            if 0 <= ny < H and 0 <= nx < W and alpha[ny, nx] and not lab[ny, nx]:
                                lab[ny, nx] = n; q.append((ny, nx))
                out.append([c, x0, y0, x1, y1])
    return out


def shrink(img, w, h):
    """Premultiplied resize, so transparent edges don't bleed a halo. Returns (rgb uint8, opaque mask)."""
    arr = np.array(img).astype(np.float32)
    arr[:, :, :3] *= arr[:, :, 3:4] / 255
    sm = np.array(Image.fromarray(arr.clip(0, 255).astype(np.uint8)).resize((w, h), Image.LANCZOS)).astype(np.float32)
    al = np.array(img.getchannel('A').resize((w, h), Image.BOX)).astype(np.float32)
    rgb = (sm[:, :, :3] * 255 / np.maximum(al[:, :, None], 1)).clip(0, 255).astype(np.uint8)
    return rgb, al > 110


def quantize(pieces, ncol):
    """pieces: list of (rgb, mask). One shared palette; returns (palette Nx3, index arrays with 0 = transparent)."""
    allpx = np.concatenate([r[m] for r, m in pieces])
    pimg = Image.fromarray(allpx.reshape(1, -1, 3)).quantize(colors=ncol, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    n = len(set(np.array(pimg).flatten().tolist()))
    pal = np.array(pimg.getpalette()[:ncol * 3]).reshape(-1, 3)[:max(n, 1)]
    out = []
    for rgb, m in pieces:
        q = np.array(Image.fromarray(rgb).quantize(palette=pimg, dither=Image.Dither.NONE)).astype(np.uint8) + 1
        q[~m] = 0
        out.append(q)
    return pal.astype(np.uint8), out


def to_png(pal, idx):
    lut = np.vstack([[0, 0, 0], pal]).astype(np.uint8)
    rgba = np.dstack([lut[idx], np.where(idx > 0, 255, 0).astype(np.uint8)])
    return Image.fromarray(rgba, 'RGBA')


def data_uri(img):
    """Indexed PNG (exact colours, palette slot 0 transparent) keeps the page light."""
    b = io.BytesIO()
    a = np.array(img); opaque = a[:, :, 3] > 0
    cols, inv = np.unique(a[:, :, :3][opaque], axis=0, return_inverse=True)
    if len(cols) <= 255:
        idx = np.zeros(a.shape[:2], np.uint8); idx[opaque] = inv.flatten() + 1
        p = Image.fromarray(idx, 'P'); p.putpalette([0, 0, 0] + cols.flatten().tolist())
        p.save(b, 'PNG', optimize=True, transparency=0)
    else:
        img.save(b, 'PNG', optimize=True)
    return 'data:image/png;base64,' + base64.b64encode(b.getvalue()).decode()


def c_bytes(fh, arr, per=40):
    flat = np.asarray(arr).flatten()
    for i in range(0, len(flat), per):
        fh.write('  ' + ','.join(str(int(v)) for v in flat[i:i + per]) + ',\n')


def kid():
    im = Image.open(os.path.join(ART, 'kid_sheet.png')).convert('RGBA')
    a = np.array(im)
    bl = [b for b in blobs(a[:, :, 3] > 100) if b[0] > 20]
    cw, ch = im.width / 4, im.height / 2
    cells = [None] * 8
    for c, x0, y0, x1, y1 in bl:                          # a held umbrella or lantern may be its own blob: merge by grid cell
        k = int(((y0 + y1) / 2) // ch) * 4 + int(((x0 + x1) / 2) // cw)
        cells[k] = [x0, y0, x1, y1] if cells[k] is None else [min(cells[k][0], x0), min(cells[k][1], y0), max(cells[k][2], x1), max(cells[k][3], y1)]
    if any(c is None for c in cells):
        sys.exit('kid sheet: an empty cell')
    tall = max(c[3] - c[1] + 1 for c in cells)
    k = KID_H / tall
    pieces = []
    for x0, y0, x1, y1 in cells:
        cell = im.crop((x0, y0, x1 + 1, y1 + 1))
        pieces.append(shrink(cell, max(1, round(cell.width * k)), max(1, round(cell.height * k))))
    pal, idx = quantize(pieces, 160)
    W = max(i.shape[1] for i in idx); H = max(i.shape[0] for i in idx)
    frames = []
    for q in idx:
        f = np.zeros((H, W), np.uint8); h, w = q.shape
        f[H - h:, (W - w) // 2:(W - w) // 2 + w] = q          # centred, feet on the same row
        frames.append(f)
    # the paper lantern (night outfit): centroid of its warm, bright pixels, for a glow
    lut = np.vstack([[0, 0, 0], pal]).astype(int)
    rgb = lut[frames[7]]
    warm = (frames[7] > 0) & (rgb[:, :, 0] > 200) & (rgb[:, :, 1] > 90) & (rgb[:, :, 1] < 200) & (rgb[:, :, 2] < 120)
    ys, xs = np.nonzero(warm)
    lantern = (int(xs.mean()), int(ys.mean())) if len(xs) else (W - 6, H // 2)
    return pal, frames, W, H, lantern


def sky():
    im = Image.open(os.path.join(ART, 'sky_sheet.png')).convert('RGBA')
    a = np.array(im)
    bl = sorted([b for b in blobs(a[:, :, 3] > 60) if b[0] > 150], key=lambda b: b[1])
    if len(bl) != 6:
        sys.exit('sky sheet: expected 6 pieces, found %d' % len(bl))
    pieces = []
    for (c, x0, y0, x1, y1), tw in zip(bl, SKY_W):
        cell = im.crop((x0, y0, x1 + 1, y1 + 1))
        pieces.append(shrink(cell, tw, max(1, round(cell.height * tw / cell.width))))
    pal, idx = quantize(pieces, 96)
    return pal, idx


def background(name):
    im = Image.open(os.path.join(ART, 'bg_%s.png' % name)).convert('RGBA')
    s = max(SCR_W / im.width, 240 / im.height)              # cover the width, at least 240 rows of land
    w, h = round(im.width * s), round(im.height * s)
    im = im.resize((w, h), Image.NEAREST)
    ox = round((w - SCR_W) * 0.3)                            # keep more of the left (the torii)
    im = im.crop((ox, 0, ox + SCR_W, h))
    a = np.array(im)
    m = a[:, :, 3] > 128
    rows = np.nonzero(m.any(axis=1))[0]
    top = int(rows[0]); a = a[top:]; m = m[top:]
    pal, (q,) = quantize([(a[:, :, :3], m)], 255)
    return pal, q, SCR_H - q.shape[0]                        # bottom-aligned on screen


def main():
    kpal, kfr, KW, KH, lantern = kid()
    spal, sidx = sky()
    bgs = [background(n) for n in BGS]

    hp = os.path.join(ROOT, 'firmware', 'LarpCharm', 'wx_art.h')
    with open(hp, 'w') as fh:
        fh.write('// generated by firmware/tools/mkwxart.py from firmware/tools/art/*.png - do not edit\n')
        fh.write('#pragma once\n#include <pgmspace.h>\n\n')
        fh.write('// the kid: outfits hot, warm, mild, cool, freezing, rain, snow, night\n')
        fh.write('#define WXK_W %d\n#define WXK_H %d\n#define WXK_N 8\n#define WXK_LX %d\n#define WXK_LY %d\n' % (KW, KH, lantern[0], lantern[1]))
        fh.write('static const uint8_t WXK_PAL[%d] PROGMEM = {0,0,0,\n' % ((len(kpal) + 1) * 3)); c_bytes(fh, kpal); fh.write('};\n')
        fh.write('static const uint8_t WXK_PX[WXK_N][WXK_H * WXK_W] PROGMEM = {\n')
        for f in kfr:
            fh.write(' {\n'); c_bytes(fh, f); fh.write(' },\n')
        fh.write('};\n\n')
        fh.write('// sky pieces: big cloud, medium cloud, small cloud, rain cloud, sun, moon\n#define WXS_N 6\n')
        fh.write('static const uint8_t WXS_PAL[%d] PROGMEM = {0,0,0,\n' % ((len(spal) + 1) * 3)); c_bytes(fh, spal); fh.write('};\n')
        fh.write('static const uint8_t WXS_W[WXS_N] = {%s};\n' % ','.join(str(q.shape[1]) for q in sidx))
        fh.write('static const uint8_t WXS_H[WXS_N] = {%s};\n' % ','.join(str(q.shape[0]) for q in sidx))
        offs = np.cumsum([0] + [q.size for q in sidx])
        fh.write('static const uint16_t WXS_OFF[WXS_N] = {%s};\n' % ','.join(str(int(o)) for o in offs[:-1]))
        fh.write('static const uint8_t WXS_PX[%d] PROGMEM = {\n' % offs[-1])
        for q in sidx: c_bytes(fh, q)
        fh.write('};\n\n')
        fh.write('// backgrounds: %s (240 wide, bottom-aligned, top rows are sky)\n#define WXB_N %d\n' % (', '.join(BGS), len(BGS)))
        fh.write('static const uint8_t WXB_PAL[WXB_N][256 * 3] PROGMEM = {\n')
        for pal, q, y0 in bgs:
            p = np.zeros((256, 3), np.uint8); p[1:len(pal) + 1] = pal
            fh.write(' {\n'); c_bytes(fh, p, 48); fh.write(' },\n')
        fh.write('};\n')
        fh.write('static const uint16_t WXB_Y0[WXB_N] = {%s};\n' % ','.join(str(y0) for _, _, y0 in bgs))
        offs = np.cumsum([0] + [q.size for _, q, _ in bgs])
        fh.write('static const uint32_t WXB_OFF[WXB_N] = {%s};\n' % ','.join(str(int(o)) for o in offs[:-1]))
        fh.write('static const uint8_t WXB_PX[%d] PROGMEM = {\n' % offs[-1])
        for _, q, _ in bgs: c_bytes(fh, q)
        fh.write('};\n')

    kstrip = Image.new('RGBA', (KW * 8, KH))
    for i, f in enumerate(kfr): kstrip.paste(to_png(kpal, f), (i * KW, 0))
    sw = sum(q.shape[1] for q in sidx); sh = max(q.shape[0] for q in sidx)
    sstrip = Image.new('RGBA', (sw, sh)); sx = []
    x = 0
    for q in sidx: sstrip.paste(to_png(spal, q), (x, 0)); sx.append(x); x += q.shape[1]
    jp = os.path.join(ROOT, 'wxart.js')
    with open(jp, 'w') as fh:
        fh.write('// generated by firmware/tools/mkwxart.py - the weather art, same pixels as the firmware\'s wx_art.h\n')
        fh.write('window.WXART = {\n')
        fh.write(' kid: {w: %d, h: %d, n: 8, lantern: [%d, %d], src: "%s"},\n' % (KW, KH, lantern[0], lantern[1], data_uri(kstrip)))
        fh.write(' sky: {x: [%s], w: [%s], h: [%s], src: "%s"},\n' % (
            ','.join(map(str, sx)), ','.join(str(q.shape[1]) for q in sidx), ','.join(str(q.shape[0]) for q in sidx), data_uri(sstrip)))
        fh.write(' bg: [\n')
        for (pal, q, y0), n in zip(bgs, BGS):
            fh.write('  {name: "%s", y0: %d, src: "%s"},\n' % (n, y0, data_uri(to_png(pal, q))))
        fh.write(' ]};\n')

    if os.environ.get('PREVIEW'):
        sheet = Image.new('RGBA', (SCR_W * 5 + 40, SCR_H + KH + 70), (40, 40, 40, 255))
        for i, (pal, q, y0) in enumerate(bgs):
            sky_bg = Image.new('RGBA', (SCR_W, SCR_H), (110, 170, 235, 255) if i != 4 else (16, 24, 60, 255))
            sky_bg.alpha_composite(to_png(pal, q), (0, y0))
            sheet.paste(sky_bg, (i * (SCR_W + 10), 0))
        sheet.alpha_composite(kstrip, (0, SCR_H + 10)); sheet.alpha_composite(sstrip, (0, SCR_H + KH + 20))
        sheet.save(os.environ['PREVIEW'])
    kb = os.path.getsize(hp) // 1024
    print('kid %dx%d (%d colours), sky %d pieces, bgs %s -> %s (%d KB source), %s' % (
        KW, KH, len(kpal), len(sidx), [(q.shape, len(p)) for p, q, _ in bgs], hp, kb, jp))


if __name__ == '__main__':
    main()
