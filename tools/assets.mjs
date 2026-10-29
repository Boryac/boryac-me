#!/usr/bin/env node
/**
 * 资产装配：把「我们自己的」文件放进站点，把参考站的私产清出去。
 *
 * 做的四件事：
 *   1. `documents/` 换成我们的 PDF（CV + 作品集），删掉对方的申请表/专利/作品集；
 *   2. `archives/` 换成按数据集生成的 12 份原始档案文本（对方是 22 份 RHINE-LAB）；
 *   3. 删掉只属于对方的目录：brands / evidence / papers / exhibitions / conferences / audio；
 *   4. 按**实际文件清单**重生成 `sw.js` 的预缓存列表与 `pwa-build.json` 的版本号 ——
 *      清单不重算的话，service worker 会去预缓存已经不存在的文件，首屏直接白。
 *
 * 幂等：目录清空后重新写入，重复执行结果一致。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { loadArchives } from "./lib/load-archives.mjs";

const ROOT = path.resolve(process.cwd());
const OUTER = path.join(ROOT, "..");
const RECORDS = loadArchives(ROOT);
const fails = [];

/* ── 1 · documents ──────────────────────────────────────────────────────── */
const docsDir = path.join(ROOT, "documents");
rmSync(docsDir, { recursive: true, force: true });
mkdirSync(docsDir, { recursive: true });
const cvSrc = path.join(OUTER, "Project_Habitat_Codex_Kit", "public", "resume", "resume.pdf");
if (!existsSync(cvSrc)) fails.push("documents: 找不到源 CV（public/resume/resume.pdf）");
else copyFileSync(cvSrc, path.join(docsDir, "boryac-cv.pdf"));
const folioSrc = path.join(ROOT, "tools", "boryac-portfolio.pdf");
if (!existsSync(folioSrc)) fails.push("documents: 找不到作品集 PDF（先跑 tools/plates.py）");
else { copyFileSync(folioSrc, path.join(docsDir, "boryac-portfolio.pdf")); console.log("[docs] boryac-cv.pdf + boryac-portfolio.pdf"); }

/* ── 2 · archives 文本 ──────────────────────────────────────────────────── */
const archDir = path.join(ROOT, "archives");
rmSync(archDir, { recursive: true, force: true });
mkdirSync(archDir, { recursive: true });
const strip = (s) => s.replace(/\s+$/, "");
for (const r of RECORDS) {
  const body = [
    "BORV · PERSONAL PORTFOLIO",
    `FILE ${r.id} / ${r.title}`,
    r.en,
    "",
    `项目性质：${r.projectType}`,
    `时间：${r.date}`,
    `创作者：黄博弈 / BORV`,
    `访问范围：${r.clearance}`,
    "",
    r.abstract,
    "",
    `设计重点：${r.focus}`,
    `方法：${r.methods}`,
    `产出：${r.deliverables.join("、")}`,
    `原稿页码：${r.pageNumbers.join(" / ")}`,
    "",
    `背景：${r.study.context}`,
    "",
    "设计说明",
    ...r.findings.map((f, i) => `${i + 1}. ${f}`),
    "",
    `研究：${r.study.research}`,
    `决策：${r.study.design}`,
    `流程：${r.study.flow}`,
    `范围：${r.study.scope}`,
    "",
    r.contentNote,
    "",
    `原始文档：${r.document}`,
    "来源：黄博弈提供的 CV 与作品集。",
  ].join("\n");
  writeFileSync(path.join(archDir, `BORV-${r.id}.txt`), strip(body) + "\n");
}
console.log(`[archives] ${readdirSync(archDir).length} 份`);

/* ── 3 · 清掉对方的私产 ─────────────────────────────────────────────────── */
const DROP = ["brands", "evidence", "papers", "exhibitions", "conferences", "audio"];
for (const dir of DROP) {
  const p = path.join(ROOT, dir);
  if (existsSync(p)) {
    const n = readdirSync(p).length;
    rmSync(p, { recursive: true, force: true });
    console.log(`[drop] ${dir}/ (${n})`);
  }
}
// contact QR 是对方的微信二维码，不能留
const qr = path.join(ROOT, "images", "contact-qr.png");
if (existsSync(qr)) {
  rmSync(qr);
  console.log("[drop] images/contact-qr.png");
}

/* ── 4 · 预缓存清单（T66：只预缓存「应用外壳」） ────────────────────────────
 *
 * 改之前：FILES/CORE 都是**整站**（163 个文件 / 17.3 MB），SW 一装上就在后台
 * 把两个 GLB（3.3 MB + 3.5 MB）、图集、43 个字体分片一起拖下来 —— 用户的首访
 * 带宽被自己的缓存抢走。实测（tools/perf/measure.mjs）首屏 5.0 MB 里 3.48 MB
 * 就是这个 GLB。
 *
 * 现在：
 *   · SHELL：外壳 10 个文件，安装时只拉这些（其余一律 runtime）；
 *   · FILES 保持「离线保存」用的清单语义，同样只写外壳 —— 需要整站离线时
 *     由 runtime 分级在用户真正访问时补；
 *   · 分级策略写进 sw.js 的 runtime 段（幂等 marker：BORV_RUNTIME_V1）：
 *       images / plates / glb / fonts → cache-first
 *       documents / pdf            → stale-while-revalidate
 *       videos/                    → 只走网络，永不缓存
 */
const SKIP = new Set([".src", "tools", "artifacts", "sw.js", "pwa-build.json", ".git", "node_modules"]);
const files = [];
const walk = (dir, base = "") => {
  for (const name of readdirSync(dir)) {
    if (!base && SKIP.has(name)) continue;
    const abs = path.join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    if (statSync(abs).isDirectory()) walk(abs, rel);
    else if (!/\.(gif|psd|ai)$/i.test(name)) files.push(rel);
  }
};
walk(ROOT);
files.sort();
const bytes = files.reduce((sum, rel) => sum + statSync(path.join(ROOT, rel)).size, 0);

const SHELL_PATTERNS = [
  /^index\.html$/,
  /^latest\.html$/,
  /^assets\/index-[^/]+\.js$/,
  /^assets\/index-[^/]+\.css$/,
  /^favicon\.svg$/,
  /^manifest\.webmanifest$/,
  /^icons\/apple-touch-icon\.png$/,
  /^fonts\/misans-webfont-4\.3\.1\/(?:regular|bold|demibold)\/0\.woff2$/,
];
const shell = files.filter((rel) => SHELL_PATTERNS.some((re) => re.test(rel)));
if (shell.length === 0) fails.push("sw.js: 外壳清单为空");
if (shell.length > 12) fails.push(`sw.js: 外壳清单 ${shell.length} 个文件，超过 12 个的上限`);
const shellBytes = shell.reduce((sum, rel) => sum + statSync(path.join(ROOT, rel)).size, 0);
const shellGzip = shell.reduce((sum, rel) => {
  const buf = readFileSync(path.join(ROOT, rel));
  return sum + gzipSync(buf, { level: 9 }).length;
}, 0);

const version = createHash("sha1").update(files.join("|")).digest("hex").slice(0, 16);

const swPath = path.join(ROOT, "sw.js");
/*
 * 永远从 `.src/sw.js`（参考站原始产物）出发再打补丁 —— 与 build.mjs 的
 * 「每次从快照重建」同一原则。改现有 sw.js 会在第二次运行时找不到锚点（幂等性
 * 就靠这一点），t66 第一版正是踩在这里。
 */
const swSrcPath = path.join(ROOT, ".src", "sw.js");
if (!existsSync(swSrcPath)) fails.push("sw.js: 缺少 .src/sw.js 快照");
const sw = readFileSync(swSrcPath, "utf8").replace(/RHINE_/g, "BORV_");
let nextSw = sw
  .replace(/const VERSION = "[^"]*";/, `const VERSION = "${version}";`)
  .replace(/const FILES = \[[^\]]*\];/, `const FILES = ${JSON.stringify(shell)};`)
  .replace(/const CORE = \[[^\]]*\];/, `const CORE = ${JSON.stringify(shell)};`);
if (!nextSw.includes(`const FILES = ${JSON.stringify(shell)};`)) fails.push("sw.js: FILES 未替换成功");
if (!nextSw.includes(`const CORE = ${JSON.stringify(shell)};`)) fails.push("sw.js: CORE 未替换成功");

/* runtime 分级：marker 幂等 —— 已存在就整段替换，不存在就插在 fetch 处理器前 */
const RUNTIME_MARK = "/* BORV_RUNTIME_V1 */";
const runtimeBlock = `${RUNTIME_MARK}
/*
 * 运行时缓存分级（T66）。预缓存只有外壳，其它资源按类型分级：
 *   · 图片 / 图版 / GLB / 字体 → cache-first（内容哈希命名，永不变）
 *   · 文档 / PDF             → stale-while-revalidate（允许离线旧版，但会后台更新）
 *   · videos/               → 只走网络（大文件，缓存只会挤占配额）
 */
const RUNTIME_CACHE = PREFIX + "runtime-v1";
const isVideo = (p) => p.startsWith("/videos/");
const isDoc = (p) => p.startsWith("/documents/") || p.toLowerCase().endsWith(".pdf");
const isAsset = (p) =>
  /\.(png|jpe?g|webp|avif|gif|svg|glb|gltf|bin|ktx2|woff2?)$/i.test(p);
async function runtimeCacheFirst(request, key) {
  const cache = await caches.open(RUNTIME_CACHE);
  const hit = await cache.match(key);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.status === 200 && !response.redirected) await cache.put(key, response.clone()).catch(() => {});
  return response;
}
async function runtimeSwr(request, key) {
  const cache = await caches.open(RUNTIME_CACHE);
  const hit = await cache.match(key);
  const network = fetch(request)
    .then(async (response) => {
      if (response.status === 200 && !response.redirected) await cache.put(key, response.clone()).catch(() => {});
      return response;
    })
    .catch(() => null);
  if (hit) return hit;
  const fresh = await network;
  if (fresh) return fresh;
  return new Response("offline", { status: 503 });
}
`;

const fetchAnchor = "self.addEventListener('fetch',event=>{";
if (!nextSw.includes(fetchAnchor)) fails.push("sw.js: 找不到 fetch 处理器锚点");
else {
  nextSw = nextSw.replace(fetchAnchor, runtimeBlock + fetchAnchor);
  const allowedAnchor = "const key=navigation?index:url.href;if(!allowed.has(key))return;";
  if (!nextSw.includes(allowedAnchor)) fails.push("sw.js: 找不到 allowed 判断锚点");
  else {
    nextSw = nextSw.replace(
      allowedAnchor,
      "const key=navigation?index:url.href;" +
        "if(!allowed.has(key)){" +
        "if(isVideo(url.pathname))return;" +
        "if(isDoc(url.pathname)){event.respondWith(runtimeSwr(event.request,key));return;}" +
        "if(isAsset(url.pathname)){event.respondWith(runtimeCacheFirst(event.request,key));return;}" +
        "return;}",
    );
    if (!nextSw.includes("if(isVideo(url.pathname))return;")) fails.push("sw.js: runtime 分级未写入");
  }
}
writeFileSync(swPath, nextSw);

const pwa = JSON.parse(readFileSync(path.join(ROOT, "pwa-build.json"), "utf8"));
pwa.version = version;
pwa.bytes = bytes;
pwa.coreFiles = shell;
pwa.coreBytes = shellBytes;
/* files 之前一直是**参考站的陈旧清单**（1034 条，其中 22 个 RHINE-LAB-*.txt），
 * 既不反映本站 221 个文件，也把上游的档案名暴露在公开 JSON 里。按实际文件重写。 */
pwa.files = files;
writeFileSync(path.join(ROOT, "pwa-build.json"), JSON.stringify(pwa, null, 2) + "\n");
console.log(
  `[sw] 外壳 ${shell.length} 个 / 原始 ${(shellBytes / 1024 / 1024).toFixed(2)} MB / gzip ${(shellGzip / 1024).toFixed(0)} KB / v${version}`,
);
console.log(`[sw] 全站 ${files.length} 个 / ${(bytes / 1024 / 1024).toFixed(1)} MB（仅用于 runtime 统计，不再预缓存）`);

/* ── 4.5 · 许可目录：只留"必须随发行保留"的许可文本 ────────────────────────
 * 参考站的 licenses/ 里还有一批**它自己**的来源说明（品牌素材来源、赛事来源、
 * 会议来源、补充材料来源）。那是他们的出处档案，不是我们要分发的内容 —— 删掉。
 * 保留：字体许可、pdf.js、Lucide、以及上游 MIT 版权声明。 */
const LICENSES_DROP = [
  "brand-sources.md",
  "competition-sources.md",
  "conference-sources.md",
  "paper-metadata-sources.md",
  "supplement-sources.md",
  "blackout-reference.md",
];
for (const name of LICENSES_DROP) {
  const p = path.join(ROOT, "licenses", name);
  if (existsSync(p)) { rmSync(p); console.log(`[licenses] 移除 ${name}`); }
}

/* 首屏优化（内联 / preload / 预缓存去重）已挪到 tools/perf.mjs —— make 的最后一步。
 * 原因：样式表要等 tools/fonts.mjs 瘦身之后才能内联（否则会把 753 条 @font-face 焊进 HTML）。 */

/* ── 5 · MIT 许可与致谢（保留上游版权声明） ─────────────────────────────── */
const upstream = path.join(OUTER, "KIRAHOOK-src", "LICENSE");
if (existsSync(upstream)) {
  copyFileSync(upstream, path.join(ROOT, "licenses", "kirahook-cv-web-mit.txt"));
  console.log("[license] licenses/kirahook-cv-web-mit.txt（上游 MIT 原样保留）");
}

if (fails.length) {
  console.error("[FAIL]");
  for (const f of fails) console.error("  · " + f);
  process.exit(1);
}
console.log("[assets] OK");
