"""Genererer app- og udvidelsesikoner. Kør: python3 scripts/make_icons.py"""
from PIL import Image, ImageDraw
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = 1024

def gradient(size):
    top, bottom = (16, 76, 200), (10, 170, 160)
    img = Image.new('RGB', (size, size))
    d = ImageDraw.Draw(img)
    for y in range(size):
        t = y / (size - 1)
        d.line([(0, y), (size, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip(top, bottom)))
    return img

def symbol(draw, s, color=(255, 255, 255)):
    # Tunnel-bue
    w = int(s * 0.07)
    box = [s * 0.22, s * 0.24, s * 0.78, s * 0.80]
    draw.arc(box, 180, 360, fill=color, width=w)
    draw.line([(box[0] + w / 2, (box[1] + box[3]) / 2), (box[0] + w / 2, s * 0.78)], fill=color, width=w)
    draw.line([(box[2] - w / 2, (box[1] + box[3]) / 2), (box[2] - w / 2, s * 0.78)], fill=color, width=w)
    r = w / 2
    for x in (box[0] + w / 2, box[2] - w / 2):
        draw.ellipse([x - r, s * 0.78 - r, x + r, s * 0.78 + r], fill=color)
    # Flueben
    pts = [(s * 0.37, s * 0.56), (s * 0.47, s * 0.66), (s * 0.65, s * 0.46)]
    draw.line(pts, fill=color, width=w, joint='curve')
    for p in (pts[0], pts[-1]):
        draw.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=color)

def app_icon():
    img = gradient(S)
    symbol(ImageDraw.Draw(img), S)
    img.save(os.path.join(ROOT, 'App/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png'))
    return img

def rounded(img, size):
    big = img.resize((size * 4, size * 4), Image.LANCZOS)
    mask = Image.new('L', big.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, big.size[0] - 1, big.size[1] - 1], radius=int(big.size[0] * 0.225), fill=255)
    out = Image.new('RGBA', big.size, (0, 0, 0, 0))
    out.paste(big, (0, 0), mask)
    return out.resize((size, size), Image.LANCZOS)

def toolbar(size):
    big = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    symbol(ImageDraw.Draw(big), S, color=(0, 0, 0, 255))
    return big.resize((size, size), Image.LANCZOS)

if __name__ == '__main__':
    icon = app_icon()
    res = os.path.join(ROOT, 'SafariExtension/Resources')
    for n in (48, 96, 128, 256, 512):
        rounded(icon, n).save(os.path.join(res, f'icon-{n}.png'))
    for n in (16, 32):
        toolbar(n).save(os.path.join(res, f'toolbar-{n}.png'))
    print('ok')
