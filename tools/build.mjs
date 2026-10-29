#!/usr/bin/env node
/**
 * 一次构建 = 快照(.src) → 换根路径 → 换品牌 → 换数据集 → 图标/manifest → 校验。
 *
 * 为什么是「改构建产物」而不是「重写实现」：
 *   参考站是 Vite 产物（静态资源 + 一个 bundle）。要的是**原样**，所以保留它的
 *   渲染代码、着色器、GLB、字体、服务结构，只替换身份与内容。
 *   于是「视觉还原度」由复制保证，不由重画保证 —— 上一版正是死在"重画"上。
 *
 * 幂等：每次从 `.src/` 重建；重复执行输出一致。
 * 失败即红：替换未命中就退出非 0。
 */
import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildCatalogue, unknownCategories } from "./lib/categories.mjs";
import { loadArchives } from "./lib/load-archives.mjs";
import { injectPlateVideoStyle, patchPlateVideo } from "./lib/plate-video.mjs";

const ROOT = path.resolve(process.cwd());
const SRC = path.join(ROOT, ".src");
const read = (rel) => readFileSync(path.join(SRC, rel), "utf8");
const write = (rel, text) => writeFileSync(path.join(ROOT, rel), text);
const readdirSyncSafe = (dir) => { try { return readdirSync(dir); } catch { return []; } };

const fails = [];
const must = (text, from, to, label) => {
  if (!text.includes(from)) {
    fails.push(`${label}: 未命中 "${from.slice(0, 60)}"`);
    return text;
  }
  return text.split(from).join(to);
};

const BRAND = "BORV";
const NAME = "黄博弈";
const BASE_OLD = "/KIRAHOOK-CV-Web/"; // 参考站部署在子路径下
const BASE_NEW = "/"; // 本站部署在域名根

/* ── 0 · 品牌符号：档案卡片轮廓（自绘），塞进参考站同一个 viewBox ──────────
 *
 * 为什么是「卡轮廓」而不是「BORV 字形」：开场 logo 那段代码对 SVG 结构有硬约束 ——
 *   ① `svg.querySelector("path")` 取到的那条会被强制改写为 `MS`（描边动画的轮廓）；
 *   ② `path:not([pathLength])` 取到的那条会被 `insertBefore` 当锚点然后 `remove()`；
 *   ③ `+ / −` 两个符号由代码自己创建并插到 ② 之前。
 * 所以符号位必须保持「1 条轮廓 + 1 条可被删掉的占位」。轮廓换成我们自己的档案卡外形，
 * 占位留空 —— 结构一模一样，图形不再是参考站的 ∞。
 */
const CONTOUR =
  "M 46 26 H 264 A 22 22 0 0 1 286 48 V 97 A 22 22 0 0 1 264 119 H 46 A 22 22 0 0 1 24 97 V 48 A 22 22 0 0 1 46 26 Z";
const MARK_UPSTREAM =
  '<path d="M156 75C127 48 103 15 70 15C37 15 15 39 15 70S38 128 70 128C103 128 127 96 176 52M155 75C182 99 208 128 240 128C273 128 295 105 295 73S273 15 240 15C221 15 207 23 192 38" fill="none" stroke="currentColor" stroke-width="26"/><path d="M44 70h50M69 45v50M219 70h44" fill="none" stroke="currentColor" stroke-width="15"/>';
const MARK_OURS =
  `<path d="${CONTOUR}" fill="none" stroke="currentColor" stroke-width="26" stroke-linejoin="miter"/>` +
  `<path d="M 0 0" fill="none" stroke="currentColor" stroke-width="15"/>`;
const CONTOUR_UPSTREAM =
  'M295 73C295 41 273 15 240 15C221 15 207 23 192 38C186 43 181 47 176 52C127 96 103 128 70 128C38 128 15 101 15 70C15 39 37 15 70 15C103 15 127 48 156 75C182 99 208 128 240 128C273 128 295 105 295 73Z';

/* ── 1 · bundle ─────────────────────────────────────────────────────────── */
let js = read("assets/index-rs_UJF4L.js");
js = must(js, BASE_OLD, BASE_NEW, "bundle 根路径");

const YM = MARK_UPSTREAM;
js = must(js, YM, MARK_OURS, "品牌符号路径");
js = must(js, CONTOUR_UPSTREAM, CONTOUR, "描边轮廓");
js = must(js, 'letter-spacing="22">KIRAHOOK</text>', 'letter-spacing="34">BORV</text>', "小字标字距");
js = js.replace(/KIRAHOOK/g, BRAND);
js = js.replace(/胡鑫洋/g, NAME);
js = must(js, "INFORMATION & INTERACTION", "AI × BUSINESS DEVELOPMENT", "副标");
js = js.replace(/莱茵生命/g, "BORV STUDIO");
js = js.replace(/kirahook-full-portfolio-atlas/g, "borv-full-portfolio-atlas");
/* 顶栏品牌字原本用一套"字母轮廓"渲染（参考站的字形表）。我们的品牌只有 4 个字母，
 * 和那套字形的字距/字宽对不上，会渲染成残缺的几个轮廓 —— 直接改成纯文本节点。 */
js = js.replace('new ur(this.brandLines[0],["brand"]).setText("BORV")', 'this.brandLines[0].textContent="BORV"');
/* 开场文案与残余英文名：这些是纯文本（打字机/单词渲染），换掉即可 */
js = js.replace(/POWERED BY RHINE LAB/g, "POWERED BY BORV STUDIO");
js = js.replace(/ID CONFIRMED : JOYCE MOORE/g, "ID CONFIRMED : BORV");
js = js.replace(/JOYCE MOORE/g, "BORV");
js = js.replace(/RHINE_/g, "BORV_");
js = js.replace(/RHINE LAB\.LLC\./g, "BORV STUDIO");
js = js.replace(/RHINE LAB/g, "BORV STUDIO");
js = js.replace(/HU XINYANG/g, "HUANG BOYI");
js = js.replace(/XINYANG HU/g, "BOYI HUANG");
js = js.replace(/kirahook-saved-projects-v2/g, "borv-saved-projects-v2");
js = js.replace(/kirahook-saved-projects-v3/g, "borv-saved-projects-v3");
js = js.replace(/kirahook-settings/g, "borv-settings");
js = js.replace(/K \/<span>BORV/, "B /<span>BORV");

/* ── 1b · 图版阅读器：视频通道 + 技术栈行（t63） ─────────────────────────
 * 必须排在下面那些「路径改写」**之前**：下载链接的原文里带着对方的
 * `documents/hu-xinyang-portfolio.pdf`，后续的全局 replace 会先把它改掉，
 * 那样这处定点替换就再也对不上（实测踩到，构建红）。
 *
 * 不动 209 KB 的样式表，也不改参考站实现语义：只在 bundle 里做五处定点替换，
 * 未命中一律 fails.push（构建红），绝不静默产出"播不了视频"的站。 */
js = patchPlateVideo(js, must);

/* 数据集：JSON.parse('…') 载荷换成我们自己的档案 */
const RECORDS = loadArchives(ROOT);

/* 示例图接线：tools/media/pages.json 登记的多图**追加**到每条记录的 pages 后面。
 * 只追加磁盘上真实存在的文件 —— 图还没生成时跳过并计数，不让构建崩。 */
{
  const mediaMapPath = path.join(ROOT, "tools", "media", "pages.json");
  /* 目录名 = id 全小写去连字符：X-001 → media/x001（见 media/README.md 的硬约定） */
  const mediaDirOf = (rec) => `media/${rec.id.toLowerCase().replace(/-/g, "")}`;
  const hasMedia = new Set();
  let added = 0;
  let missing = 0;
  let covered = 0;

  if (existsSync(mediaMapPath)) {
    const map = JSON.parse(readFileSync(mediaMapPath, "utf8"));
    for (const rec of RECORDS) {
      const dir = mediaDirOf(rec);
      if (readdirSyncSafe(path.join(ROOT, dir)).some((n) => /^\d+\.(jpe?g|png|webp)$/i.test(n))) {
        hasMedia.add(rec.id);
      }
      const want = map[rec.id] ?? [];
      const have = new Set(rec.pages ?? []);
      for (const rel of want) {
        if (!existsSync(path.join(ROOT, rel))) {
          missing += 1;
          continue;
        }
        if (have.has(rel)) continue; // 去重：同一路径不出现两次
        rec.pages = [...(rec.pages ?? []), rel];
        have.add(rel);
        added += 1;
      }
      /* cover 用主图：图版右栏之外（卡片兜底）也走同一张，免得缺图时露出参考站封面 */
      const cover = `${dir}/01.jpg`;
      if (existsSync(path.join(ROOT, cover))) {
        rec.cover = cover;
        covered += 1;
      }
    }
    console.log(
      `[media] 追加示例图 ${added} 张${missing ? ` · 缺图 ${missing} 张（已跳过）` : ""}` +
        ` · cover 指向主图 ${covered} 条`,
    );
  }

  /* 断言：有图目录的条目，详情页至少 2 页（原图版 1 张 + media 至少 1 张）。
   * 图还在并行产出时，缺图目录只告警不判红 —— 否则构建会因为「别人还没画完」变红。 */
  const thin = [];
  for (const rec of RECORDS) {
    if (!hasMedia.has(rec.id)) continue;
    const count = (rec.pages ?? []).length;
    if (count < 2) thin.push(`${rec.id}:${count}`);
  }
  if (thin.length) fails.push(`断言: 详情页不足 2 页 → ${thin.join(", ")}`);

  const pending = RECORDS.filter((rec) => !hasMedia.has(rec.id)).map((rec) => rec.id);
  if (pending.length) {
    /* 用 stdout 而不是 stderr：make 成功时只回收 stdout，告警走 stderr 会被吞掉。 */
    console.log(`[media] 警告：以下 ${pending.length} 条还没有 media 目录，已跳过（不判红）：${pending.join(", ")}`);
  }
}
if (RECORDS.length) {
  const m = js.match(/JSON\.parse\('(\[\{"id":"X-001".*?\}\])'\)/s);
  if (!m) fails.push("数据集: 找不到 JSON.parse('…') 载荷");
  else {
    const next = RECORDS;
    const payload = JSON.stringify(next).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    js = js.replace(m[0], `JSON.parse('${payload}')`);
    console.log(`[dataset] ${JSON.parse(m[1]).length} 条 → ${next.length} 条`);
  }
  /* 分类 / 栏目 / 前序映射：长度与名字跟着数据集走 */
  const catPath = path.join(ROOT, "tools", "categories.json");
  if (existsSync(catPath)) {
    const { categories } = JSON.parse(readFileSync(catPath, "utf8"));
    /*
     * 分类名与顺序以 categories.json 为准（名字不得改）；**计数与起始页从数据算**。
     * 手写的 catalogue 一旦与数据集脱钩，三维档案架的栏位就会错位，而且不报错。
     */
    const catalogue = buildCatalogue(RECORDS, categories);
    const unknown = unknownCategories(RECORDS, categories);
    if (unknown.length) fails.push(`分类: 数据里有未登记的分类 ${unknown.join(" / ")}`);
    js = must(js, '["交互游戏设计","概念设计","产品设计","UI/UX设计","视觉设计","体验设计"]', JSON.stringify(categories), "列/分类表");
    const beforeCat = js;
    js = js.replace(/\[\{name:"[^"]*",sectionPage:[\dnull]+,count:\d+\}(,\{name:"[^"]*",sectionPage:[\dnull]+,count:\d+\})*\]/, JSON.stringify(catalogue).replace(/"name":/g, 'name:').replace(/"sectionPage":/g, "sectionPage:").replace(/"count":/g, "count:"));
    if (js === beforeCat) fails.push("列/分类表: catalogue 未命中（栏位表没换掉）");
    /* 上一版/下一版的 id 链：按记录顺序重建 */
    const ids = RECORDS.map((r) => r.id);
    const prev = {};
    ids.forEach((id, i) => (prev[id] = ids[i - 1] ?? id));
    js = js.replace(/\{"X-001":"[^"]*"(?:,"X-\d+":"[^"]*")*\}/, JSON.stringify(prev));
    console.log(
      `[taxonomy] 分类 ${categories.length} / 栏目 ${catalogue.length} / 链 ${ids.length} · ` +
        catalogue.map((c) => `${c.name}:${c.count}@p${c.sectionPage ?? "-"}`).join(" "),
    );
  }
}
/* ── CV 面板与次级数据：整表替换 ──────────────────────────────────────────
 *
 * 这些字面量都在同一条 `const A=[…],B=[…],C={…}` 链上。做法不是逐条改文案，
 * 而是**整表换掉** —— 因为其中混着对方的论文、证书、会议、社媒账号，
 * 一条条改必然漏；整表换掉之后，漏掉的就是"没有"，而不是"别人的"。
 *
 * 我们不invent（不虚构）对方的论文与专利：没有就给空表，界面上就是空，
 * 而不是挂一堆看不出真假的学术产出。
 */
const profPath = path.join(ROOT, "tools", "profile.json");
if (existsSync(profPath)) {
  const prof = JSON.parse(readFileSync(profPath, "utf8"));
  const CHAIN = {
    Ag: prof.intro,
    xg: prof.internships,
    bg: prof.competitions,
    yg: prof.exhibitions,
    Mg: prof.academic,
    _g: prof.patents,
    /* 联系卡：只放站上真的有的，logo 一律不带（对方那批是品牌标识图） */
    Sd: [
      { label: "邮箱 / EMAIL", value: "huangboryac@gmail.com", url: "mailto:huangboryac@gmail.com", note: "" },
      { label: "GITHUB", value: "Boryac", url: "https://github.com/Boryac", note: "" },
      { label: "站点 / SITE", value: "boryac.me", url: "https://boryac.me", note: "" },
    ],
    Sg: [{ id: "personal", title: "个人信息和通讯", entries: ["BORV", "EDUCATION", "CONTACT", "SKILLS"] }],
    wg: [],
    Eg: {},
    Cg: [],
    Tg: { papers: [] },
  };
  const chainSpan = (text) => {
    const spans = [];
    const scan = (p0) => {
      let depth = 0;
      for (let i = p0; i < text.length; i += 1) {
        const c = text[i];
        if (c === '"' || c === "'" || c === "`") {
          const q = c;
          i += 1;
          while (i < text.length) {
            if (text[i] === "\\") { i += 2; continue; }
            if (text[i] === q) break;
            i += 1;
          }
          continue;
        }
        if (c === "[" || c === "{" || c === "(") depth += 1;
        else if (c === "]" || c === "}" || c === ")") {
          depth -= 1;
          if (depth === 0) return i;
        }
      }
      return -1;
    };
    let p = text.indexOf("const Ag=[");
    if (p < 0) return spans;
    p += "const ".length;
    for (;;) {
      const m = /^([A-Za-z_$][\w$]*)=([\[{])/.exec(text.slice(p, p + 16));
      if (!m) break;
      const start = p + m[0].length - 1;
      const end = scan(start);
      if (end < 0) break;
      spans.push({ name: m[1], start, end });
      const next = /^,([A-Za-z_$][\w$]*)=([\[{])/.exec(text.slice(end + 1, end + 18));
      if (!next) break;
      p = end + 2;
    }
    return spans;
  };
  const spans = chainSpan(js);
  if (spans.length === 0) fails.push("CV 面板: 数据链解析失败");
  let touched = 0;
  for (const span of spans.reverse()) {
    const value = CHAIN[span.name];
    if (value === undefined) continue;
    js = js.slice(0, span.start) + JSON.stringify(value) + js.slice(span.end + 1);
    touched += 1;
  }
  console.log(`[profile] 数据链 ${spans.length} 节 / 替换 ${touched} 节`);

  /* 这几个不是链上成员，单独点名 */
  js = js.replace(/Dg=JSON\(['"]\[.*?\]\{0\}\2\)/s, "Dg=[]");
  js = js.replace(/Dg=JSON\.parse\('[\s\S]*?'\)/, "Dg=[]");
  js = js.replace(/Vp=\["atmosphere","motif","pulse"\]/, "Vp=[]");
  js = js.replace(/Rg="\d{4}-\d{2}-\d{2}"/, 'Rg="2026-10-28"');
}

/* 独立的专利表（对方的 1 项发明专利）——整表清空，不保留任何条目文本 */
{
  const idx = js.indexOf("Td=[");
  if (idx > 0) {
    let depth = 0;
    let end = -1;
    for (let i = idx + 3; i < js.length; i += 1) {
      const c = js[i];
      if (c === '"' || c === "'" || c === "`") {
        const q = c;
        i += 1;
        while (i < js.length) {
          if (js[i] === "\\") { i += 2; continue; }
          if (js[i] === q) break;
          i += 1;
        }
        continue;
      }
      if (c === "[" || c === "{" || c === "(") depth += 1;
      else if (c === "]" || c === "}" || c === ")") {
        depth -= 1;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end > 0) {
      js = js.slice(0, idx) + "Td=[]" + js.slice(end + 1);
      console.log("[patents] Td 已清空");
    }
  }
}

/* 通用清洗：任何 `X=JSON.parse('…')` 载荷只要还带着对方的私产路径，
 * 就把整段换成空表 —— 这些是"获奖证明 / 会议论文"清单，我们没有对应材料，
 * 与其挂一堆对不上号的条目，不如留空。 */
{
  const BANNED = ["brands/", "evidence/", "hu-xinyang", "RHINE-LAB", "audio/"];
  let i = 0;
  let scrubbed = 0;
  for (;;) {
    i = js.indexOf("JSON.parse('", i);
    if (i < 0) break;
    const qStart = i + "JSON.parse('".length;
    let j = qStart;
    while (j < js.length) {
      if (js[j] === "\\") { j += 2; continue; }
      if (js[j] === "'") break;
      j += 1;
    }
    const payload = js.slice(qStart, j);
    if (BANNED.some((t) => payload.includes(t))) {
      js = js.slice(0, i) + "[]" + js.slice(j + 2);
      scrubbed += 1;
      i += 2;
    } else {
      i = j + 1;
    }
  }
  if (scrubbed) console.log(`[scrub] 清空 ${scrubbed} 段对方载荷`);
}

/* 关于/来源面板：原文写的是对方的作品集页数与视觉参考，必须改成我们的，
 * 同时把上游 MIT 出处写清楚（这是许可证要求的署名，不是可选文案）。 */
{
  const credits = [
    "<h2>关于这份个人档案</h2>",
    "<p>作品与个人信息：黄博弈 / BORV。内容来自本人提供的 CV 与作品集，图版按同一套版式重排。</p>",
    "<p>本页的交互与三维场景基于 LBEILC / RhineLabUI 与 kirahook / KIRAHOOK-CV-Web 的 MIT 构建，",
    "保留原始版权声明；场景、相机、雾、景深与交互代码未作改动，仅替换身份与内容。</p>",
    "<p>字体 MiSans（小米）与 Rolling Number 依其各自许可使用，分片逐字节未改。",
    "相关商标与原作权利归各自权利人。</p>",
    '<div class="credits-links">',
  ].join("");
  const before = js;
  js = js.replace(/<h2>关于这份个人档案<\/h2>[\s\S]*?<div class="credits-links">/, credits);
  if (js === before) fails.push("来源面板: 未命中");
  js = js.replace(/展示内容来自所提供的 CV 与 90 页作品集。/g, "内容来自本人提供的 CV 与作品集。");
}

/* 下载链接与音频：资料来源换成我们的文件；背景音乐属于对方版权，按钮一并去掉 */
js = js.replace(/documents\/hu-xinyang-cv\.pdf/g, "documents/boryac-cv.pdf");
js = js.replace(/documents\/hu-xinyang-cv-supplement-2026-10\.pdf/g, "documents/boryac-cv.pdf");
js = js.replace(/documents\/hu-xinyang-portfolio\.pdf/g, "documents/boryac-portfolio.pdf");
js = js.replace('<button data-action="toggle-music"', '<button hidden data-action="toggle-music"');
js = js.replace(/images\/contact-qr\.png/g, "portfolio/portrait.jpg");

write("assets/index-rs_UJF4L.js", js);


/* ── 2 · HTML ───────────────────────────────────────────────────────────── */
for (const rel of ["index.html", "latest.html", "update.html"]) {
  if (!existsSync(path.join(SRC, rel))) continue;
  let html = read(rel);
  if (html.includes(BASE_OLD)) html = html.split(BASE_OLD).join(BASE_NEW);
  html = html.replace(/KIRAHOOK/g, BRAND).replace(/胡鑫洋/g, NAME);
  /* 描述统一改写一次：中文名替换会让原句出现"黄博弈 BORV 的胡鑫洋的…"这种叠词 */
  const DESC = "黄博弈 BORV 个人作品档案：AI 系统与检索、增长与商业化、工程实现。三维玻璃档案体验。";
  html = html.replace(/(<meta\s+name="description"\s+content=")[\s\S]*?("\s*\/?>)/, `$1${DESC}$2`);
  /* 图版视频通道的样式：写进本页 `<style id="borv-plate-video">`（带 marker，幂等） */
  html = injectPlateVideoStyle(html);
  if (!html.includes('id="borv-plate-video"')) fails.push(`样式注入: ${rel} 未写入 <style id="borv-plate-video">`);
  write(rel, html);
}

/* ── 3 · 样式表里的字体 URL ─────────────────────────────────────────────── */
let css = read("assets/index-DY0MSdxT.css");
css = must(css, BASE_OLD, BASE_NEW, "CSS 字体路径");
write("assets/index-DY0MSdxT.css", css);

/* ── 4 · manifest ───────────────────────────────────────────────────────── */
const manifest = JSON.parse(read("manifest.webmanifest"));
manifest.name = `${NAME} · ${BRAND} 个人作品档案`;
manifest.short_name = BRAND;
manifest.description = "个人 CV、AI 系统与检索、增长与商业化、工程实现的作品档案";
write("manifest.webmanifest", JSON.stringify(manifest, null, 2) + "\n");

/* ── 5 · favicon ────────────────────────────────────────────────────────── */
write(
  "favicon.svg",
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#e8e5e1"/><g fill="none" stroke="#111" stroke-width="6" stroke-linejoin="miter"><rect x="30" y="24" width="52" height="30" transform="rotate(-6 56 39)"/><rect x="22" y="40" width="52" height="30"/><rect x="14" y="56" width="52" height="30"/></g><path d="M14 92h72" stroke="#111" stroke-width="6"/></svg>`,
);

/* ── 6 · 收尾 ───────────────────────────────────────────────────────────── */
if (fails.length) {
  console.error("[FAIL] 构建断言未通过：");
  for (const f of fails) console.error("  · " + f);
  process.exit(1);
}

/* ── 7 · 残留检查：不许再引用对方私产目录 ──────────────────────────────── */
const banned = ["brands/", "evidence/", "RHINE-LAB", "hu-xinyang"];
if (!/Vp=\[\]/.test(js)) fails.push("音频: Vp 未清空（会去 fetch 对方音乐）");
const leftovers = banned.filter((token) => js.includes(token));
if (leftovers.length) {
  console.error("[FAIL] bundle 仍引用对方资产：" + leftovers.join(", "));
  process.exit(1);
}
console.log("[build] OK（无对方资产引用）");
