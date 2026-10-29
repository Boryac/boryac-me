#!/usr/bin/env node
/**
 * 隐私脱敏（上传前必跑）。规则只有一条：**不可逆**。
 *
 *   · 真实人脸头像 / 真人照片        → 马赛克（块 ≥ 12px，不可还原）
 *   · 真实访客 IP / 姓名 / 账号      → 马赛克；能换安全源图的直接换
 *   · 第三方平台 logo / 二维码       → 不允许出现在图里
 *
 * 本脚本只处理"会被发布"的 media/*.jpg，源素材不动。
 * 跑完写 media/.privacy.json 台账（哪张图、哪个区域、做了什么），供三遍核查对照。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd());
const PY = process.env.PYTHON ?? "python";
const OUT = path.join(ROOT, "media");
const manifest = [];

const py = (code, args = []) => execFileSync(PY, ["-c", code, ...args], { stdio: "inherit" });

/** 马赛克一块矩形（坐标基于原图） */
const mosaic = (file, box, block = 16) =>
  py(
    `
import sys
from PIL import Image
p, x1,y1,x2,y2, b = sys.argv[1], *map(int, sys.argv[2:7])
im = Image.open(p).convert("RGB")
crop = im.crop((x1,y1,x2,y2))
small = crop.resize((max(1,(x2-x1)//b), max(1,(y2-y1)//b)), Image.BOX)
im.paste(small.resize((x2-x1, y2-y1), Image.NEAREST), (x1,y1))
im.save(p, "JPEG", quality=82, optimize=True)
print("mosaic", p, (x1,y1,x2,y2))
`,
    [file, ...box, String(block)],
  );

/** 把一张源图铺成 2000×1250（等比贴合宽度，剩余高度补边） */
const refit = (src, dst) =>
  py(
    `
import sys
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
W,H = 2000,1250
im = Image.open(src).convert("RGB")
s = W / im.width
im = im.resize((W, int(im.height*s)), Image.LANCZOS)
canvas = Image.new("RGB",(W,H),(245,246,248))
canvas.paste(im,(0,(H-im.height)//2))
canvas.save(dst,"JPEG",quality=82,optimize=True)
print("refit", dst, canvas.size)
`,
    [src, dst],
  );

/* 1 · x002/04：桌面端对话页右上角是**真人头像**，整块马赛克 */
mosaic(path.join(OUT, "x002", "04.jpg"), [1298, 80, 1402, 188], 14);
manifest.push({ file: "media/x002/04.jpg", action: "mosaic", box: [1298, 80, 1402, 188], why: "真实人脸头像" });

/* 2 · x009/02：原图是「Top 来源 IP」，含真实访客 IP。换安全源图（流量趋势/状态码分布，无 IP） */
const safeSrc = path.join(ROOT, "..", "截图素材", "网站工作台2.jpg");
if (fs.existsSync(safeSrc)) {
  refit(safeSrc, path.join(OUT, "x009", "02.jpg"));
  manifest.push({ file: "media/x009/02.jpg", action: "replace-source", from: "截图素材/网站工作台2.jpg", why: "原图含真实访客 IP，整页替换为无 IP 的流量页" });
} else {
  console.error("!! 缺安全源图，x009/02 仍是含 IP 的版本");
  process.exit(1);
}

/* 3 · 台账 */
fs.writeFileSync(path.join(ROOT, "tools", "media", ".privacy.json"), JSON.stringify({ at: new Date().toISOString(), items: manifest }, null, 2));
console.log(`\n[privacy] ${manifest.length} 项已脱敏，台账 tools/media/.privacy.json（不发布）`);
