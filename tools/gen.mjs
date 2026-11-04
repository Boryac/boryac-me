#!/usr/bin/env node
/**
 * 档案示例图生成器（t68）。
 *
 * 做法：data.json（每张图的标题 / KPI / 表格行 / 序列） + tpl/*.html 模板
 *      → 注入 JSON → Playwright 在 2000×1250 截图 → JPEG q82。
 *
 * 三条硬约束，全部由脚本自己守：
 *  1. **数字必须有出处**：从图上抠出所有数字 token，逐个到 tools/archives-d/X-00N.json
 *     的正文（abstract / findings / focus / methods / deliverables …）里找；找不到就红。
 *     这条是为了防「图表看起来专业，数字却是编的」——那正是四条红线里最先破的一条。
 *  2. **幂等**：关动画、关平滑滚动、固定 DPR=1 与 zh-CN locale、等 document.fonts.ready，
 *     同输入重跑产物逐字节一致。
 *  3. **规格**：2000×1250、JPEG q82、单张 ≤400 KB；目录名 = id 小写，文件名 01/02 连续。
 *
 * 用法：
 *   node tools/media/gen.mjs            # 生成全部
 *   node tools/media/gen.mjs --check    # 只校验（不写文件、不截图）
 *   node tools/media/gen.mjs --only=X-001
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { chromium } from "./playwright.mjs";
import { archiveText as archiveTextShared, checkNumbers as checkNumbersShared } from "./numbers.mjs";

const ROOT = path.resolve(process.cwd());
const CHECK_ONLY = process.argv.includes("--check");
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice("--only=".length) ?? null;
const DATA = JSON.parse(readFileSync(path.join(ROOT, "tools/media/data.json"), "utf8"));
const MAX_BYTES = 400 * 1024;
const CANVAS = DATA.canvas ?? { width: 2000, height: 1250 };

const fails = [];
const rows = [];

/* ── 数字出处校验（实现见 numbers.mjs，与 shell.mjs 共用同一把尺子） ─────────── */
const ID = /^X-\d{3}$/;
const ORDINAL_ALLOW = new Set();

function archiveText(id) {
  return archiveTextShared(ROOT, id);
}

function checkNumbers(shot, text, label) {
  checkNumbersShared(shot, text, label, fails, ORDINAL_ALLOW);
}

/* ── 渲染 ─────────────────────────────────────────────────────────────────── */
const items = DATA.items.filter((it) => {
  if (!ID.test(it.id)) {
    fails.push(`data.json: id ${it.id} 不符合 X-000 形式`);
    return false;
  }
  return ONLY ? it.id === ONLY : true;
});

const browser = CHECK_ONLY || items.length === 0 ? null : await chromium.launch({ channel: "chrome" });

for (const item of items) {
  const text = archiveText(item.id);
  const dirName = item.id.toLowerCase().replace("-", "");
  /*
   * 不再硬编码「每条 2 张」：01 号图归 shell.mjs 的档案在本文件只登记 1 张。
   * 这里只断言「登记了就得对得上」，总数由下面的目录检查兜住（每条恰好 2 张 jpg）。
   */
  if (item.shots.length < 1 || item.shots.length > 2) fails.push(`${item.id}: 登记 ${item.shots.length} 张，应为 1–2 张`);

  for (const [, shot] of item.shots.entries()) {
    /*
     * 文件名位置不再等于数组下标：01 号若由 shell.mjs 负责，本文件第一条登记的是 02。
     * 改成「必须是 media/<id>/01|02.jpg」的约束，具体是哪一张由 data.json 登记决定。
     */
    if (!/^media\/x\d{3}\/0[12]\.jpg$/.test(shot.file)) {
      fails.push(`${item.id}: 文件名 ${shot.file} 不符合 media/<id>/01|02.jpg`);
    }
    if (!existsSync(path.join(ROOT, "tools/media/tpl", `${shot.tpl}.html`))) {
      fails.push(`${item.id}: 模板 ${shot.tpl}.html 不存在`);
      continue;
    }
    shot.__id = item.id;
    checkNumbers(shot, text, `${item.id}/${path.basename(shot.file)}`);

    if (CHECK_ONLY) continue;

    const tpl = readFileSync(path.join(ROOT, "tools/media/tpl", `${shot.tpl}.html`), "utf8");
    const payload = { ...shot, id: item.id, en: shot.en ?? item.en };
    delete payload.__id;
    const html = tpl.replace("/*DATA*/", JSON.stringify(payload));

    const page = await browser.newPage({
      viewport: CANVAS,
      deviceScaleFactor: 1,
      locale: "zh-CN",
      timezoneId: "Asia/Shanghai",
      reducedMotion: "reduce",
    });
    await page.setContent(html, { waitUntil: "load" });
    /* 固定渲染：等字体就绪 + 两帧 rAF，避免任何布局/字体回流的时序差 */
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
    const outPath = path.join(ROOT, shot.file);
    mkdirSync(path.dirname(outPath), { recursive: true });
    await page.screenshot({
      path: outPath,
      type: "jpeg",
      quality: DATA.defaults?.quality ?? 82,
      animations: "disabled",
      caret: "hide",
    });
    await page.close();

    const bytes = statSync(outPath).size;
    if (bytes > MAX_BYTES) fails.push(`${shot.file}: ${bytes} B 超过 400 KB`);
    rows.push({ id: item.id, file: shot.file, tpl: shot.tpl, bytes });
  }
}

if (browser) await browser.close();

/* ── 至少有一张 01 与一张 02、每个 id 目录恰好两张 ─────────────────────────── */
if (!CHECK_ONLY) {
  /*
   * 只校验**本任务负责的** id（其余目录是别人产的真实截图，张数不由我们决定）。
   */
  for (const item of items) {
    const dirName = item.id.toLowerCase().replace("-", "");
    const dir = path.join(ROOT, "media", dirName);
    if (!existsSync(dir)) {
      fails.push(`media/${dirName}: 目录不存在`);
      continue;
    }
    const n = readdirSync(dir).filter((f) => /\.jpe?g$/i.test(f));
    // 01 号可能由 shell.mjs 产出，所以目录里仍应恰好 2 张（01 + 02）
    if (n.length !== 2) fails.push(`media/${dirName}: 期望 2 张 jpg（01 可能来自 shell.mjs），实得 ${n.length}`);
  }
}

if (fails.length) {
  console.error("[media] 失败：");
  for (const f of fails) console.error(`  · ${f}`);
  process.exit(1);
}

if (CHECK_ONLY) {
  console.log(`[media] 校验通过：${items.length} 条档案 / ${items.length * 2} 张图的数字全部有出处`);
} else {
  rows.sort((a, b) => (a.file < b.file ? -1 : 1));
  const total = rows.reduce((n, r) => n + r.bytes, 0);
  for (const r of rows) {
    console.log(`  ${r.id}  ${r.file.padEnd(22)} ${String(CANVAS.width)}×${String(CANVAS.height)}  ${(r.bytes / 1024).toFixed(0).padStart(4)} KB  ${r.tpl}`);
  }
  console.log(`[media] ${rows.length} 张 / 合计 ${(total / 1024 / 1024).toFixed(2)} MB`);
  writeFileSync(
    path.join(ROOT, "artifacts/media-manifest.json"),
    JSON.stringify(
      rows.map((r) => ({ id: r.id, file: r.file, tpl: r.tpl, width: CANVAS.width, height: CANVAS.height, bytes: r.bytes })),
      null,
      2,
    ) + "\n",
  );
}
