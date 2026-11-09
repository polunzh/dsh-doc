import sys
from PIL import Image, ImageChops

def compare(path_a, path_b):
    im_a = Image.open(path_a).convert("RGB")
    im_b = Image.open(path_b).convert("RGB")
    if im_a.size != im_b.size:
        return f"size mismatch: {im_a.size} vs {im_b.size}"
    diff = ImageChops.difference(im_a, im_b)
    bbox = diff.getbbox()
    if not bbox:
        return "identical: 0 diff pixels"
    w, h = diff.size
    pixels = diff.load()
    diff_count = 0
    max_delta = 0
    for y in range(h):
        for x in range(w):
            r, g, b = pixels[x, y]
            delta = max(r, g, b)
            if delta > 10:
                diff_count += 1
            if delta > max_delta:
                max_delta = delta
    total = w * h
    return f"diff pixels (>10): {diff_count} / {total} ({diff_count*100.0/total:.2f}%), max_delta={max_delta}"

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("usage: compare.py img_a img_b")
        sys.exit(1)
    print(f"{sys.argv[1]} vs {sys.argv[2]}: {compare(sys.argv[1], sys.argv[2])}")
