#!/usr/bin/env node
/**
 * 墨量（ink%）测量：背景色取左上角像素，统计非背景像素占比。
 *
 * 为什么用这个指标：它虽然不是「好看」的度量，但能抓住「一屏两行字」这类
 * 明显没做完的图（t68 复审：浅底 <6% 基本就是空白页）。深色工作台同理由
 * captain 定 ≥12%。
 *
 * 用法：node tools/media/ink.mjs [--min-light=6] [--min-dark=12]
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const arg = (n, d) => Number(process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? d);
const MIN_LIGHT = arg("min-light", 6);
const MIN_DARK = arg("min-dark", 12);

/* 用 JPEG 解码：Node 没有内置解码器，这里借助 playwright 的 Chrome 解一次，
 * 避免为一个指标引入原生图像库。 */
const { chromium } = await import("./playwright.mjs");
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();

const files = [];
for (const dir of readdirSync("media")) {
  if (!/^x\d{3}$/.test(dir)) continue;
  for (const f of readdirSync(path.join("media", dir)).sort()) {
    if (/\.jpg$/i.test(f)) files.push(path.posix.join("media", dir, f));
  }
}
files.sort();

const rows = [];
for (const file of files) {
  const b64 = readFileSync(file).toString("base64");
  const stat = await page.evaluate(async (src) => {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = src;
    });
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const bg = [d[0], d[1], d[2]];
    const dark = (bg[0] + bg[1] + bg[2]) / 3 < 64;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 24) n++;
    }
    return { w: c.width, h: c.height, ink: +((n / (c.width * c.height)) * 100).toFixed(2), dark };
  }, `data:image/jpeg;base64,${b64}`);
  const min = stat.dark ? MIN_DARK : MIN_LIGHT;
  rows.push({ file, ...stat, min, pass: stat.ink >= min });
}
await browser.close();

const bad = rows.filter((r) => !r.pass);
for (const r of rows) {
  console.log(`${r.pass ? "  ok " : " LOW "} ${r.file.padEnd(22)} ${r.w}×${r.h}  ink ${String(r.ink).padStart(5)}%  (≥${r.min}%)`);
}
console.log(`\n[ink] ${rows.length} 张 / 达标 ${rows.length - bad.length} / 未达标 ${bad.length}`);
process.exit(bad.length ? 1 : 0);
