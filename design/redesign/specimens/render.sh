#!/usr/bin/env bash
# render.sh — html -> pdf -> png(200dpi) -> 780px png，并测量墨迹盒 / 诗行左沿 / 分页。
# 用法：./render.sh            （在 specimens/ 下执行）
# 调参：V2_LH=2.5 V2_GAP=8mm V3_FS=11pt V3_LH=1.9 ./render.sh
set -euo pipefail
cd "$(dirname "$0")"

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PDFTOPPM="/opt/homebrew/bin/pdftoppm"
PDFINFO="/opt/homebrew/bin/pdfinfo"
PYTHON="${PYTHON:-python3}"

VARIANTS=(v0-current v1-align v2-stanza v3-vertical)

node gen.mjs

TMP="$(mktemp -d "${TMPDIR:-/tmp}/specimens.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

echo
echo "── render ────────────────────────────────────────────"
for v in "${VARIANTS[@]}"; do
  html="$PWD/$v.html"
  pdf="$PWD/$v.pdf"
  # Chrome 会往 stderr 打 CVDisplayLink 噪声；只看产物。
  "$CHROME" --headless=new --disable-gpu --no-pdf-header-footer \
    --virtual-time-budget=1500 --print-to-pdf="$pdf" "file://$html" 2>/dev/null || true
  [ -s "$pdf" ] || { echo "FAIL: $v.pdf 未生成"; exit 1; }
  pages="$("$PDFINFO" "$pdf" | awk '/^Pages:/{print $2}')"
  printf '  %-12s pages=%s\n' "$v" "$pages"
  echo "$pages" > "$TMP/$v.pages"
  "$PDFTOPPM" -png -r 200 "$pdf" "$TMP/$v" >/dev/null 2>&1
done

echo
echo "── png + measure ─────────────────────────────────────"
"$PYTHON" - "$PWD" "$TMP" "${VARIANTS[@]}" <<'PY'
import sys, os
from PIL import Image

here, tmp = sys.argv[1], sys.argv[2]
variants = sys.argv[3:]
DPI = 200.0
MM = 25.4 / DPI          # mm per pixel
INK = 248                # < INK 视为墨
MARGIN = dict(l=18.0, r=18.0, t=15.0, b=16.0)
TOL = 0.6                # mm 容差（抗锯齿）

def mask_of(im):
    return im.convert("L").point(lambda p: 255 if p < INK else 0)

def bands(im, axis="y", min_thick=2, min_hit=2):
    """投影切带：axis=y 按行投影（横排的一行文字），axis=x 按列投影（竖排的一列）。"""
    m = mask_of(im)
    w, h = m.size
    px = m.load()
    n = h if axis == "y" else w
    other = w if axis == "y" else h
    on = []
    for i in range(n):
        hit = 0
        for j in range(other):
            v = px[j, i] if axis == "y" else px[i, j]
            if v:
                hit += 1
                if hit >= min_hit:
                    break
        on.append(hit >= min_hit)
    out, start = [], None
    for i, f in enumerate(on + [False]):
        if f and start is None:
            start = i
        elif not f and start is not None:
            if i - start >= min_thick:
                out.append((start, i))
            start = None
    return out

def edge(im, band, axis="y"):
    """带内墨迹在另一轴上的 [起, 止]（按 ≥2 墨像素计，压掉抗锯齿噪点）。"""
    m = mask_of(im)
    w, h = m.size
    px = m.load()
    lo, hi = (w if axis == "y" else h), -1
    a0, a1 = band
    for t in range(a0, a1):
        cnt_lo, cnt_hi = 0, 0
        for o in range(w if axis == "y" else h):
            v = px[o, t] if axis == "y" else px[t, o]
            if v:
                if o < lo:
                    cnt_lo += 1
                    if cnt_lo >= 2:
                        lo = min(lo, o)
                if o > hi:
                    cnt_hi += 1
                    if cnt_hi >= 2:
                        hi = max(hi, o)
    return lo, hi

rows = []
print(f"{'variant':<12}{'pg':<3}{'L':>6}{'R':>6}{'T':>6}{'B':>6}{'w':>7}{'h':>7}"
      f"  {'blocks':<7}{'left-spread':>12}  checks")
for v in variants:
    pages = int(open(os.path.join(tmp, v + ".pages")).read().strip())
    src = os.path.join(tmp, v + "-1.png")
    im = Image.open(src)
    pw, ph = im.size[0] * MM, im.size[1] * MM

    # 780px 交付图（第 1 页）
    out = im.convert("RGB").resize((780, round(im.size[1] * 780 / im.size[0])), Image.LANCZOS)
    out.save(os.path.join(here, v + ".png"), optimize=True)

    bb = mask_of(im).getbbox()
    l, t, r, b = bb
    L, R, T, B = l * MM, pw - r * MM, t * MM, ph - b * MM

    vertical = v.startswith("v3")
    if vertical:
        cols = bands(im, axis="x")
        nblocks = len(cols)
        tops = [edge(im, c, axis="x")[0] * MM for c in cols]
        bots = [edge(im, c, axis="x")[1] * MM for c in cols]
        pitch = (cols[-1][0] - cols[0][0]) * MM / max(1, len(cols) - 1)
        spread = None
        detail = (f"cols={nblocks} pitch={pitch:.2f}mm "
                  f"col-h={(max(bots) - min(tops)):.1f}mm top-spread={max(tops)-min(tops):.2f}mm")
    else:
        bs = bands(im, axis="y")
        body = bs[2:]                        # 前两条 = 标题 / 作者
        lefts = [edge(im, x)[0] * MM for x in body]
        nblocks = len(body)
        spread = max(lefts) - min(lefts)
        detail = (f"lines={nblocks} left={min(lefts):.2f}..{max(lefts):.2f}mm "
                  f"spread={spread:.2f}mm")

    checks = []
    checks.append("1page" if pages == 1 else f"!!{pages}pages")
    inside = (L >= MARGIN["l"] - TOL and R >= MARGIN["r"] - TOL
              and T >= MARGIN["t"] - TOL and B >= MARGIN["b"] - TOL)
    checks.append("in-margins" if inside else "!!OUT")
    if not vertical:
        checks.append("left-aligned" if spread <= 1.0 else "left-ragged")
        checks.append("n=18" if nblocks == 18 else f"!!n={nblocks}")
    else:
        checks.append("cols=18" if nblocks == 18 else f"!!cols={nblocks}")

    print(f"{v:<12}{pages:<3}{L:>6.1f}{R:>6.1f}{T:>6.1f}{B:>6.1f}{(r-l)*MM:>7.1f}{(b-t)*MM:>7.1f}"
          f"  {nblocks:<7}{('%.2f' % spread) if spread is not None else '    n/a':>12}  {' '.join(checks)}")
    print(f"    page={pw:.1f}x{ph:.1f}mm | ink box from page edges: L={L:.1f} R={R:.1f} T={T:.1f} B={B:.1f}"
          f" | ink w={(r-l)*MM:.1f} h={(b-t)*MM:.1f} mm | slack below ink={ph-b*MM:.1f}mm")
    print(f"    {detail}")
    rows.append(dict(v=v, pages=pages, L=L, R=R, T=T, B=B))
PY

echo
echo "── done ──────────────────────────────────────────────"
