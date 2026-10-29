#!/usr/bin/env node
/**
 * 字体瘦身：参考站随包带了 761 个 MiSans 分片（24 MB），而我们的文案只用到其中 37 个。
 *
 * 做法：
 *   1. 以 `artifacts/diag/fonts-used.json`（真机浏览全站时抓到的分片请求）为准；
 *   2. 再按"分片号越小越常用"的经验，为每个字重补一批兜底分片，防止以后改文案掉字；
 *   3. 删掉其余 woff2；
 *   4. 把 CSS 里指向已删分片的 @font-face 整块移除 —— 留着会 404，且白白撑大样式表。
 *
 * 这不是"改字体文件"：分片逐字节不动，只是**不发**用不到的那些。
 */
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd());
const FONT_ROOT = path.join(ROOT, "fonts");

const used = JSON.parse(readFileSync(path.join(ROOT, "artifacts", "diag", "fonts-used.json"), "utf8"));
const keep = new Set(used.map((u) => u.replace(/^\//, "")));

/* 兜底：每个字重保留编号最小的 N 个分片（编号≈字频） */
const SPARE = { regular: 40, bold: 24, demibold: 16, light: 16, thin: 8, heavy: 12, medium: 16, semibold: 16 };
let spares = 0;
for (const weight of readdirSync(FONT_ROOT).includes("misans-webfont-4.3.1") ? readdirSync(path.join(FONT_ROOT, "misans-webfont-4.3.1")) : []) {
  const dir = path.join(FONT_ROOT, "misans-webfont-4.3.1", weight);
  if (!statSync(dir).isDirectory()) continue;
  const limit = SPARE[weight] ?? 8;
  const names = readdirSync(dir).filter((n) => n.endsWith(".woff2")).map((n) => [n, Number(n.replace(/\.woff2$/, ""))]).filter(([, i]) => Number.isFinite(i)).sort((a, b) => a[1] - b[1]);
  for (const [name] of names.slice(0, limit)) {
    const rel = path.posix.join("fonts", "misans-webfont-4.3.1", weight, name);
    if (!keep.has(rel)) { keep.add(rel); spares += 1; }
  }
}

let removed = 0;
let keptBytes = 0;
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) { walk(abs); continue; }
    if (!name.endsWith(".woff2")) continue;
    const rel = path.relative(ROOT, abs).split(path.sep).join("/");
    if (keep.has(rel)) keptBytes += statSync(abs).size;
    else { rmSync(abs); removed += 1; }
  }
};
walk(FONT_ROOT);

/* CSS：删掉指向已删分片的 @font-face */
const cssPath = path.join(ROOT, "assets", "index-DY0MSdxT.css");
let css = readFileSync(cssPath, "utf8");
let dropped = 0;
css = css.replace(/@font-face\s*\{[^}]*\}/g, (block) => {
  const m = /url\(\s*"?'?([^)"']+\.woff2)"?'?\s*\)/.exec(block);
  if (!m) return block;
  const rel = m[1].replace(/^\//, "");
  if (existsSync(path.join(ROOT, rel))) return block;
  dropped += 1;
  return "";
});
writeFileSync(cssPath, css);

console.log(`[fonts] 保留 ${keep.size} 个分片（其中兜底 ${spares}）/ ${(keptBytes / 1048576).toFixed(1)} MB，删除 ${removed} 个；CSS 去掉 ${dropped} 条 @font-face`);
