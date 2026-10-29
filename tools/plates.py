"""生成作品图版（portfolio/page-*.jpg）、身份图（portrait.jpg）与三维卡片纹理图集。

为什么自己画：参考站的 portfolio/ 是作者自己的作品页，不能带走；我们要的是**同样的版面语言**
（暖纸底、大标题、细线、页码），不是同一批图。所以这里按同一套版式重排我们的档案（条数以 archives-d 实际文件数为准），
有真实截图的条目就把截图放进图版右侧，没有的就用排版图 —— 不伪造截图。

输出尺寸对齐参考站：page 2000×708；atlas 4000×(177×rows)、8 列、rows = ceil(N/8)。
N 一律取 `tools/archives-d/*.json` 的**实际条数**（现为 18 条：X-001…X-018），
图版张数、atlas 行数、PDF 页数三者必须相等 —— 见 main() 末尾的断言。
"""
import json
import pathlib

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
MEDIA = ROOT.parent / "Project_Habitat_Codex_Kit" / "public" / "media"
ARCHIVES = [json.loads(p.read_text(encoding="utf-8")) for p in sorted((ROOT / "tools" / "archives-d").glob("*.json"))]

INK = (23, 23, 19)
MUTED = (122, 120, 112)
PAPER = (246, 244, 238)
LINE = (23, 23, 19)

F_BOLD = "C:/Windows/Fonts/msyhbd.ttc"
F_REG = "C:/Windows/Fonts/msyh.ttc"
F_LAT = "C:/Windows/Fonts/arialbd.ttf"

# 有真实截图的条目 → 图版右侧放截图（路径相对 MEDIA）
# 右栏示例图：优先 media/<id 小写>/01.jpg（每条档案自己的图），
# 回落到旧的 public/media 素材，都没有就画大号档案号版式。
LEGACY_SHOTS = {
    "X-002": "yikang-health-guide/pc-home.webp",
    "X-007": "portfolio-site/home.webp",
    "X-009": "yikang-health-guide/ops-dashboard.webp",
    "X-004": "yikang-health-guide/admin-console.webp",
}


def find_shot(rec):
    d = ROOT / "media" / rec["id"].lower().replace("-", "")
    if d.is_dir():
        for name in ("01.jpg", "01.jpeg", "01.png", "01.webp"):
            f = d / name
            if f.exists():
                return f
    legacy = LEGACY_SHOTS.get(rec["id"])
    if legacy:
        f = MEDIA / legacy
        if f.exists():
            return f
    return None

W, H = 2000, 708
M = 96


def font(path, size, index=0):
    return ImageFont.truetype(path, size, index=index)


def draw_text(d, xy, text, f, fill=INK):
    d.text(xy, text, font=f, fill=fill)


def spaced(d, xy, text, f, fill=INK, gap=6):
    x, y = xy
    for ch in text:
        d.text((x, y), ch, font=f, fill=fill)
        x += d.textlength(ch, font=f) + gap


def plate(rec, idx):
    im = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(im)
    d.rectangle([M, 64, W - M, 65], fill=LINE)

    label = f"ARCHIVE {rec['id']}  /  {rec['category']}"
    spaced(d, (M, 84), label.upper() if False else label, font(F_REG, 22), MUTED, gap=2)
    d.text((W - M - d.textlength(f"P.{idx + 1:02d}", font=font(F_REG, 22)), 84), f"P.{idx + 1:02d}", font=font(F_REG, 22), fill=MUTED)

    title_f = font(F_BOLD, 86)
    d.text((M, 232), rec["title"], font=title_f, fill=INK)
    en_f = font(F_LAT, 26)
    spaced(d, (M, 356), rec["en"].upper(), en_f, MUTED, gap=3)

    meta_f = font(F_REG, 24)
    d.text((M, 424), f"{rec['date']}   /   {rec['projectType']}", font=meta_f, fill=INK)
    d.rectangle([M, 470, M + 64, 471], fill=LINE)
    abstract = rec["abstract"]
    # 摘要折行（按字符宽度切，避免中文断在标点前）
    f_abs = font(F_REG, 24)
    lines, cur = [], ""
    for ch in abstract:
        if d.textlength(cur + ch, font=f_abs) > 820:
            lines.append(cur)
            cur = ch
            if len(lines) >= 3:
                break
        else:
            cur += ch
    if len(lines) < 3 and cur:
        lines.append(cur)
    elif len(lines) >= 3:
        # 三条已满：末行补省略号，绝不再多出一行（旧实现会把越界的那一个字单独画成第 4 行）
        last = lines[2]
        while last and d.textlength(last + "…", font=f_abs) > 820:
            last = last[:-1]
        lines[2] = last + "…"
    for i, text in enumerate(lines[:3]):
        d.text((M, 494 + i * 38), text, font=f_abs, fill=MUTED)

    shot = find_shot(rec)
    if shot:
        src = Image.open(shot).convert("RGB")
        box = (1120, 150, W - M, 560)
        bw, bh = box[2] - box[0], box[3] - box[1]
        scale = min(bw / src.width, bh / src.height)
        nw, nh = int(src.width * scale), int(src.height * scale)
        resized = src.resize((nw, nh), Image.LANCZOS)
        ox, oy = box[0] + (bw - nw) // 2, box[1] + (bh - nh) // 2
        im.paste(resized, (ox, oy))
        d.rectangle([ox - 1, oy - 1, ox + nw, oy + nh], outline=LINE)
    else:
        # 排版图：大号档案号
        num_f = font(F_LAT, 220)
        num = rec["id"].split("-")[-1]
        d.text((1120, 190), num, font=num_f, fill=(226, 223, 214))
        d.text((1120, 470), "BORV / ARCHIVE", font=font(F_LAT, 24), fill=MUTED)

    d.rectangle([M, H - 74, W - M, H - 73], fill=LINE)
    d.text((M, H - 56), "BORV  ·  PERSONAL ARCHIVE", font=font(F_LAT, 20), fill=MUTED)
    right = f"{idx + 1:02d} / {len(ARCHIVES):02d}"
    d.text((W - M - d.textlength(right, font=font(F_LAT, 20)), H - 56), right, font=font(F_LAT, 20), fill=MUTED)
    return im


def portrait():
    w, h = 1200, 1600
    im = Image.new("RGB", (w, h), PAPER)
    d = ImageDraw.Draw(im)
    d.rectangle([110, 120, w - 110, 121], fill=LINE)
    spaced(d, (110, 150), "BORV", font(F_LAT, 40), INK, gap=14)
    d.text((110, 980), "黄博弈", font=font(F_BOLD, 120), fill=INK)
    spaced(d, (110, 1140), "AI × BUSINESS DEVELOPMENT", font(F_LAT, 26), MUTED, gap=3)
    d.text((110, 1200), "人工智能与商务拓展方向：AI 系统与检索、", font=font(F_REG, 30), fill=MUTED)
    d.text((110, 1250), "增长与商业化、工程实现。", font=font(F_REG, 30), fill=MUTED)
    d.rectangle([110, h - 150, w - 110, h - 149], fill=LINE)
    d.text((110, h - 128), "PERSONAL ARCHIVE  /  2026", font=font(F_LAT, 20), fill=MUTED)
    # 右上角：档案层符号
    for i, (x, y) in enumerate([(760, 220), (800, 300), (840, 380)]):
        d.rectangle([x, y, x + 260, y + 120], outline=INK, width=3)
    return im


def main():
    out = ROOT / "portfolio"
    out.mkdir(exist_ok=True)
    plates = []
    for i, rec in enumerate(ARCHIVES):
        im = plate(rec, i)
        im.save(out / f"page-{i + 1:02d}.jpg", quality=90, optimize=True)
        plates.append(im)

    # 陈旧图版：档案变少时不能把上一轮的 page-13…18.jpg 留在产物里（会被图版阅读器读到）
    keep = {f"page-{i + 1:02d}.jpg" for i in range(len(ARCHIVES))}
    removed = []
    for stale in sorted(out.glob("page-*.jpg")):
        if stale.name not in keep:
            stale.unlink()
            removed.append(stale.name)
    if removed:
        print(f"[plates] 清理陈旧图版 {len(removed)} 张：{' '.join(removed)}")
    portrait().save(out / "portrait.jpg", quality=92, optimize=True)

    # 三维卡片纹理图集：8 列 × 177 高，行数 = ceil(记录数/8)
    rows = max(1, -(-len(ARCHIVES) // 8))
    atlas = Image.new("RGB", (4000, 177 * rows), PAPER)
    d = ImageDraw.Draw(atlas)
    for i, im in enumerate(plates):
        tile = Image.new("RGB", (500, 177), PAPER)
        scale = min(500 / im.width, 177 / im.height)
        r = im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS)
        tile.paste(r, ((500 - r.width) // 2, (177 - r.height) // 2))
        atlas.paste(tile, (i % 8 * 500, i // 8 * 177))
    atlas.save(ROOT / "assets" / "portfolio-atlas.f52bd8ef8508a6be.png", optimize=True)

    # 作品集 PDF：一页一张图版，便于「下载完整作品集」
    pdf = ROOT / "tools" / "boryac-portfolio.pdf"
    pdf.parent.mkdir(exist_ok=True)
    plates[0].save(pdf, save_all=True, append_images=plates[1:], resolution=150.0)

    # ── 断言：张数 = 数据条数；atlas 行数 = ceil(N/8)；PDF 页数 = N ──────────
    n = len(ARCHIVES)
    expect_rows = max(1, -(-n // 8))
    assert rows == expect_rows, f"atlas 行数 {rows} ≠ ceil({n}/8)={expect_rows}"
    assert atlas.size == (4000, 177 * expect_rows), f"atlas 画布 {atlas.size} ≠ 4000×{177 * expect_rows}"
    # Pillow 读 PDF 需要 Ghostscript，本机不一定有；改成直接数 PDF 里的页对象。
    # Pillow 写出的是未压缩 PDF：每页一个 `/Type /Page` 对象，目录树是 `/Type /Pages`。
    raw = pdf.read_bytes()
    pages = raw.count(b"/Type /Page") - raw.count(b"/Type /Pages")
    assert pages == n, f"PDF 页数 {pages} ≠ 图版数 {n}"
    assert len(list(out.glob("page-*.jpg"))) == n, "portfolio/ 里的图版张数与档案条数不一致"
    print(
        f"plates={len(plates)} atlas={atlas.size} rows={rows} (ceil({n}/8)={expect_rows}) "
        f"pdf={pdf.stat().st_size} bytes pages={pages}"
    )


if __name__ == "__main__":
    main()
