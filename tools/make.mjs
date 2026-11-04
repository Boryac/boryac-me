#!/usr/bin/env node
/**
 * 一条命令跑完整构建（顺序即依赖关系），任一步失败立即退出非 0。
 *
 *   node   tools/media/shell.mjs  6 张后台界面截图（01 号图，需 Chrome）
 *   node   tools/media/gen.mjs    其余构造示意图（需 Chrome）
 *   python tools/plates.py        出图版 / 卡片图集 / 作品集 PDF（依赖 tools/archives-d 与 media）
 *   node   tools/build.mjs   换根路径 / 品牌 / 数据集 / CV 面板 / 注入视频通道与 CSS
 *   node   tools/assets.mjs  换 PDF、生成 archives、删私产、重算 sw 清单
 *   node   tools/fonts.mjs   字体瘦身 + 裁剪 @font-face
 *   node   tools/assets.mjs  再跑一次：让 sw 的 FILES 反映刚裁掉的字体
 *   node   tools/perf.mjs    首屏优化（若存在）：关键 CSS 内联 / 字体预载 / sw 预缓存瘦身
 *
 * 每一步都幂等：同输入连跑两次输出逐字节一致。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd());
const PY = process.env.PYTHON ?? "python";

const steps = [];
const add = (label, cmd, args) => steps.push({ label, cmd, args });
const addIf = (label, script, cmd, args) => {
  if (existsSync(path.join(ROOT, script))) add(label, cmd, args);
};

/*
 * 示例图在 plates 之前生成，原因：plates.py 会按 media/<id>/01.jpg 自动发现首图，
 * 图没落盘就会退回大编号占位。shell.mjs 负责 6 张后台界面（01 号），
 * gen.mjs 负责其余构造图（02 号及其它档案的 01 号）—— 两者写不同文件，不会互相覆盖。
 */
addIf("media:shell", "tools/media/shell.mjs", process.execPath, ["tools/media/shell.mjs"]);
addIf("media:gen", "tools/media/gen.mjs", process.execPath, ["tools/media/gen.mjs"]);
add("plates", PY, ["tools/plates.py"]);
add("build", process.execPath, ["tools/build.mjs"]);
add("assets#1", process.execPath, ["tools/assets.mjs"]);
addIf("fonts", "tools/fonts.mjs", process.execPath, ["tools/fonts.mjs"]);
add("assets#2", process.execPath, ["tools/assets.mjs"]);
addIf("perf", "tools/perf.mjs", process.execPath, ["tools/perf.mjs"]);

const t0 = Date.now();
for (const s of steps) {
  const started = Date.now();
  process.stdout.write(`\n▶ ${s.label} … `);
  try {
    const out = execFileSync(s.cmd, s.args, { cwd: ROOT, stdio: "pipe", encoding: "utf8" });
    process.stdout.write(`ok (${((Date.now() - started) / 1000).toFixed(1)}s)\n`);
    /*
     * 成功时默认丢弃子进程输出（一步一行才看得清）。但「告警」不能让 make 吞掉 ——
     * 缺图 / 跳过这类提示只在 build.mjs 里打印，若被吞，跑 make 的人永远不知道
     * 哪条档案的示例图还没落盘。这里只把带告警标记的行原样转出来。
     */
    for (const line of String(out ?? "").split("\n")) {
      if (/警告|⚠|\[media\]|\[missing\]/.test(line)) process.stdout.write(`  ${line.trim()}\n`);
    }
  } catch (err) {
    process.stdout.write(`FAIL\n`);
    const out = `${err.stdout ?? ""}${err.stderr ?? ""}`.trim();
    if (out) console.error(out.split("\n").slice(-40).join("\n"));
    console.error(`\n[make] ${s.label} 失败，构建中止。`);
    process.exit(1);
  }
}

/* 构建后自检：档案条数 / 视频是否在预缓存里 / 关键文件存在 */
const checks = [];
const files = readFileSync(path.join(ROOT, "sw.js"), "utf8");
const dir = path.join(ROOT, "tools", "archives-d");
const n = existsSync(dir)
  ? readFileSync(path.join(ROOT, "tools", "categories.json"), "utf8")
  : "";
const catalogue = JSON.parse(readFileSync(path.join(ROOT, "tools", "categories.json"), "utf8")).catalogue;
const total = catalogue.reduce((a, c) => a + (c.count ?? 0), 0);
checks.push([`栏目 count 合计 = ${total}`, total > 0]);
checks.push(["sw.js 未预缓存 videos/", !/videos\//.test(files.split("const FILES")[1]?.split(";")[0] ?? "")]);
/* 入口 bundle 现在按内容哈希改名，所以从 index.html 里反查实际引用 */
const entryJs = (readFileSync(path.join(ROOT, "index.html"), "utf8").match(/\/assets\/(index-[^"]+\.js)/) ?? [])[1];
const entryPath = entryJs ? `assets/${entryJs}` : "assets/__entry_missing__.js";
for (const f of ["index.html", entryPath, "assets/index-DY0MSdxT.css"]) {
  checks.push([`${f} 存在`, existsSync(path.join(ROOT, f))]);
}
const resumeNames = ["黄博弈this_is_my_resume.pdf", "My_name_is_Huangborv_EN.pdf"];
for (const name of resumeNames) {
  checks.push([`documents/${name} 存在`, existsSync(path.join(ROOT, "documents", name))]);
}

console.log("\n── 构建后自检 ──");
let bad = 0;
for (const [label, ok] of checks) {
  console.log(`  ${ok ? "✔" : "✘"} ${label}`);
  if (!ok) bad++;
}
console.log(`\n[make] 全部完成 ${((Date.now() - t0) / 1000).toFixed(1)}s${bad ? `，自检 ${bad} 项失败` : ""}`);
process.exit(bad ? 1 : 0);
