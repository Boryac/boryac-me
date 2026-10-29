#!/usr/bin/env node
/**
 * t69 · 真实示例图流水线（六条有真实素材的档案，16 张）
 *
 * 一条命令重跑全部：node tools/media-capture.mjs
 *   --refresh     重新抓屏 / 重新抽帧（默认复用 artifacts/media-capture/raw 的缓存 → 重跑逐字节一致）
 *   --only=x017   只处理匹配的档案（substring，可逗号分隔多个）
 *   --no-verify   跳过 Pillow 自验与拼版
 *
 * 产物（media/<id>/NN.jpg，2000×1250，JPEG q82，单张 ≤400 KB）：
 *   x002/{01..04}  弈康：PC 官网 / 小程序对话 / 医务科数据后台 / 桌面端对话
 *   x007/{01,02}   borv. 作品集站点：线上 boryac.me 首屏 / 线上 vs 本仓「改版前后」+ 实算指标
 *   x009/{01,02}   应答系统运营后台：流量总览 / 访问明细
 *   x013/{01,02}   AutoBookForge：工作台界面 / 两本成品封面
 *   x017/{01..03}  自然志影像：x017.mp4 第 2 / 14 / 30 秒
 *   x018/{01..03}  人物志影像：x018.mp4 第 2 / 9 / 16 秒
 *
 * 原始素材（只读，不复制进仓库）：
 *   ..\截图素材\*.jpg
 *   ..\Project_Habitat_Codex_Kit\public\media\yikang-health-guide\ops-dashboard.webp
 *   ..\AutoBookForge\web\index.html（本机静态服务后抓屏）、..\AutoBookForge\output\*_cover.png
 *   videos/x017.mp4、videos/x018.mp4（抽帧用 tools/bin/ffmpeg.exe）
 *   https://boryac.me/（真机抓屏；Chrome headless + CDP，无第三方依赖）
 *
 * 写域：media/**、artifacts/media-capture/**、artifacts/media-real-preview.png。
 */

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  createReadStream,
  rmSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, ".."); // boryac-clone
const PARENT = path.resolve(ROOT, ".."); // 毕设
const MEDIA = path.join(ROOT, "media");
const ART = path.join(ROOT, "artifacts", "media-capture");
const RAW = path.join(ART, "raw");
const FFMPEG = path.join(ROOT, "tools", "bin", "ffmpeg.exe");
const PYTHON = process.env.PYTHON || "python";

const argv = process.argv.slice(2);
const FLAGS = {
  refresh: argv.includes("--refresh"),
  noVerify: argv.includes("--no-verify"),
  only: (argv.find((a) => a.startsWith("--only=")) || "").replace("--only=", ""),
};
const ONLY = FLAGS.only ? FLAGS.only.split(",").map((s) => s.trim()).filter(Boolean) : null;
const want = (id) => !ONLY || ONLY.some((o) => id.toLowerCase().includes(o.toLowerCase()));

// ---------------------------------------------------------------- 源路径

const S = {
  ykPcHome: path.join(PARENT, "截图素材", "PC官网首页-1.jpg"),
  ykWxChat: path.join(PARENT, "截图素材", "微信小程序-对话页.jpg"),
  ykAdmin: path.join(PARENT, "截图素材", "exe管理界面页-医生数据后台.jpg"),
  ykExeChat: path.join(PARENT, "截图素材", "exe界面页-对话.jpg"),
  ykOps: path.join(PARENT, "Project_Habitat_Codex_Kit", "public", "media", "yikang-health-guide", "ops-dashboard.webp"),
  ykOps2: path.join(PARENT, "截图素材", "网站工作台3.jpg"),
  abfWeb: path.join(PARENT, "AutoBookForge", "web"),
  abfCoverA: path.join(PARENT, "AutoBookForge", "output", "爱有天意_cover.png"),
  abfCoverB: path.join(PARENT, "AutoBookForge", "output", "沉重与卑微_cover.png"),
  v017: path.join(ROOT, "videos", "x017.mp4"),
  v018: path.join(ROOT, "videos", "x018.mp4"),
};
const VIEW = { width: 1600, height: 1000 };
const LIVE_URL = "https://boryac.me/";

const PAPER = [246, 244, 238]; // #f6f4ee 站点纸色
const NIGHT = [14, 16, 15]; // #0e100f 影像黑边

// ---------------------------------------------------------------- 小工具

const log = (...a) => console.log(...a);
const die = (msg) => {
  console.error("✗ " + msg);
  process.exit(1);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256File = (p) => crypto.createHash("sha256").update(readFileSync(p)).digest("hex");
const need = (p, label) => {
  if (!existsSync(p)) die(`缺少源素材：${label} → ${p}`);
  return p;
};

// ---------------------------------------------------------------- Chrome / CDP

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean);

function findChrome() {
  for (const p of CHROME_CANDIDATES) if (existsSync(p)) return p;
  die("找不到 Chrome/Edge；可用 CHROME_PATH 指定可执行文件");
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** 极简 CDP 客户端：Node 内建 WebSocket，无第三方依赖 */
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Set();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(`${msg.error.message} (${msg.error.code})`)) : resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners) fn(msg);
      }
    });
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", () => reject(new Error("CDP WebSocket 连接失败")), { once: true });
    });
    return new CDP(ws);
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP 超时：${method}`));
        }
      }, 45000);
    });
  }

  once(predicate, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const fn = (msg) => {
        if (!predicate(msg)) return;
        clearTimeout(timer);
        this.listeners.delete(fn);
        resolve(msg);
      };
      const timer = setTimeout(() => {
        this.listeners.delete(fn);
        reject(new Error("CDP 事件等待超时"));
      }, timeoutMs);
      this.listeners.add(fn);
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

async function launchChrome(width, height) {
  const exe = findChrome();
  const port = await freePort();
  const userDataDir = path.join(os.tmpdir(), `media-capture-chrome-${process.pid}-${port}`);
  const child = spawn(
    exe,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      `--window-size=${width},${height}`,
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
      "--force-device-scale-factor=1",
      "--font-render-hinting=none",
      "about:blank",
    ],
    { stdio: "ignore" }
  );
  const deadline = Date.now() + 30000;
  let info = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) {
        info = await res.json();
        break;
      }
    } catch {}
    await sleep(200);
  }
  if (!info) {
    try {
      child.kill();
    } catch {}
    die("Chrome 调试端口未就绪（30 s 超时）");
  }
  return { child, exe, wsUrl: info.webSocketDebuggerUrl, userDataDir };
}

async function runActions(cdp, session, actions) {
  for (const act of actions) {
    if (act.type === "wait") {
      await sleep(act.ms);
    } else if (act.type === "click") {
      await clickAt(cdp, session, act.x, act.y);
    } else if (act.type === "key") {
      await pressEnter(cdp, session);
    } else if (act.type === "waitFor") {
      const deadline = Date.now() + (act.timeout || 10000);
      let ok = false;
      while (Date.now() < deadline) {
        const r = await cdp.send("Runtime.evaluate", { expression: act.expr, returnByValue: true, awaitPromise: true }, session);
        if (r && r.result && r.result.value) {
          ok = true;
          break;
        }
        await sleep(200);
      }
      log(`    waitFor ${ok ? "OK" : "TIMEOUT（继续）"}：${act.expr.slice(0, 64)}…`);
    }
  }
}

async function clickAt(cdp, session, x, y) {
  const base = { x, y, button: "left", clickCount: 1, buttons: 1 };
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...base }, session);
  await sleep(60);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...base }, session);
}

async function pressEnter(cdp, session) {
  const k = {
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
    text: "\r",
    unmodifiedText: "\r",
  };
  await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...k }, session);
  await cdp.send("Input.dispatchKeyEvent", { type: "char", ...k }, session);
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...k }, session);
}

/**
 * 过开场门。站点的入口是 `[data-entry]` 对话框：
 *   data-entry="waiting" + `.entry-start` 解禁 = 资源就绪（「轻触屏幕或 Enter 开始」）
 *   进入后依次走 logo → scan → select → welcome → inspect → array → done
 * 所以必须**等按钮解禁**再点，否则 Enter 落在 disabled 上什么也不会发生（第一版就是这么抓到一张「正在准备终端…」）。
 */
const APP_MOUNTED = `!!document.querySelector('[data-boot], [data-entry], .entry-start, [data-mode]')`;

/** 就绪 = `.entry-start` 出现且解禁（「点击进入 →」）；或门已过完 */
const ENTRY_READY = `(() => {
  if (document.querySelector('[data-boot="done"]')) return true;
  for (const b of document.querySelectorAll('.entry-start')) {
    if (!b.disabled) return true;
  }
  return false;
})()`;

const ENTRY_STATE = `(() => {
  const el = document.querySelector('[data-entry]');
  const btns = [...document.querySelectorAll('.entry-start')].map((b) => ({ t: (b.textContent || '').trim().slice(0, 20), disabled: b.disabled }));
  const st = document.querySelector('.entry-status');
  return JSON.stringify({ entry: el ? el.getAttribute('data-entry') : null, btns,
                          status: st ? (st.textContent || '').trim().slice(0, 30) : null,
                          boot: [...document.querySelectorAll('[data-boot]')].map((e) => e.getAttribute('data-boot')).slice(0, 3) });
})()`;

const ENTRY_BTN = `(() => {
  for (const b of document.querySelectorAll('.entry-start')) {
    if (b.disabled) continue;
    const r = b.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    return JSON.stringify({ found: true, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2),
                            label: (b.textContent || '').trim().slice(0, 16) });
  }
  return JSON.stringify({ found: false });
})()`;

/** 入场动画链 access → auth → logo → scan → select → welcome → inspect → array → done（headless 约 15–20 s） */
const ENTRY_DONE = `!!document.querySelector('[data-boot="done"]')`;

async function enterSite(cdp, session, url, depth = 0) {
  const evalJS = async (expr) =>
    String((await cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, session)).result.value);
  const pollFor = async (expr, timeoutMs, stepMs = 300) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await evalJS(expr)) return true;
      await sleep(stepMs);
    }
    return false;
  };

  const before = await evalJS("location.href");
  const mounted = await pollFor(APP_MOUNTED, 25000);
  const ready = mounted && (await pollFor(ENTRY_READY, 60000));
  log(`    开场门：${ready ? "资源就绪" : "未就绪（继续尝试）"}`);
  if (!ready) log(`    门状态：${await evalJS(ENTRY_STATE)}`);
  const btn = JSON.parse(await evalJS(ENTRY_BTN));
  if (btn.found) {
    log(`    开场门：点击 .entry-start「${btn.label}」(${btn.x},${btn.y}) + Enter`);
    await clickAt(cdp, session, btn.x, btn.y);
    await sleep(200);
  } else {
    log("    开场门：没有可点的 .entry-start（门可能已过或结构变了）→ 只按 Enter");
  }
  await pressEnter(cdp, session);
  const done = await pollFor(ENTRY_DONE, 50000);
  log(`    过门：${done ? "OK（data-boot=done）" : "TIMEOUT（继续）"}`);
  if (!done) log(`    门状态：${await evalJS(ENTRY_STATE)}`);

  const after = await evalJS("location.href");
  if (after !== before) {
    log(`    ⚠ 抓屏目标被导航到 ${after} → 回退 ${before}`);
    if (depth >= 2) die("过门后反复被导航走，拿不到首屏");
    const loaded = cdp.once((m) => m.method === "Page.loadEventFired" && m.sessionId === session, 25000);
    await cdp.send("Page.navigate", { url: before }, session);
    try {
      await loaded;
    } catch {}
    await sleep(1500);
    await cdp.send("Runtime.evaluate", { expression: "document.fonts && document.fonts.ready", awaitPromise: true }, session);
    return enterSite(cdp, session, before, depth + 1);
  }
  await sleep(2600);
}

async function capturePage({ url, width, height, actions = [], gate = false, expectPath = null, out, label }) {
  const { child, exe, wsUrl, userDataDir } = await launchChrome(width, height);
  let cdp;
  try {
    cdp = await CDP.connect(wsUrl);
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
    await cdp.send(
      "Emulation.setEmulatedMedia",
      { features: [{ name: "prefers-reduced-motion", value: "reduce" }] },
      sessionId
    );
    const loaded = cdp.once((m) => m.method === "Page.loadEventFired" && m.sessionId === sessionId, 40000);
    await cdp.send("Page.navigate", { url }, sessionId);
    try {
      await loaded;
    } catch {
      log("    load 事件超时（继续）");
    }
    await sleep(1500);
    await cdp.send("Runtime.evaluate", { expression: "document.fonts && document.fonts.ready", awaitPromise: true }, sessionId);
    await sleep(300);
    if (gate) await enterSite(cdp, sessionId, url);
    if (expectPath) {
      const p = String((await cdp.send("Runtime.evaluate", { expression: "location.pathname", returnByValue: true }, sessionId)).result.value);
      if (p !== expectPath) die(`${label}：抓屏落点不是 ${expectPath}（实际 ${p}）`);
    }
    await runActions(cdp, sessionId, actions);
    await sleep(600);
    const shot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true }, sessionId);
    writeFileSync(out, Buffer.from(shot.data, "base64"));
    log(`  ✓ ${label} → ${path.relative(ROOT, out)}（${Math.round(statSync(out).size / 1024)} KB）`);
    return { url, width, height, chrome: exe };
  } finally {
    cdp?.close();
    try {
      child.kill();
    } catch {}
    await sleep(200);
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {}
  }
}

// ---------------------------------------------------------------- 静态服务

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".ico": "image/x-icon",
};

function startServer(root) {
  return new Promise((resolve, reject) => {
    const srv = createServer((req, res) => {
      const url = decodeURIComponent((req.url || "/").split("?")[0]);
      let file = path.join(root, url);
      if (!file.startsWith(root)) return res.writeHead(403).end("forbidden");
      if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, "index.html");
      if (!existsSync(file) && existsSync(file + ".html")) file += ".html";
      if (!existsSync(file)) return res.writeHead(404).end("404");
      res.writeHead(200, { "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream" });
      createReadStream(file).pipe(res);
    });
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => resolve({ srv, port: srv.address().port }));
  });
}

// ---------------------------------------------------------------- 抓屏

async function captureSites() {
  const out = {
    live: path.join(RAW, "live-home-1600x1000.png"),
    local: path.join(RAW, "local-home-1600x1000.png"),
    abf: path.join(RAW, "abf-web-1600x1000.png"),
  };
  const meta = {};
  const stale = (p) => FLAGS.refresh || !existsSync(p);

  if (want("x007") && stale(out.live)) {
    log("· 抓屏：线上 boryac.me 首屏（1600×1000，reduced-motion，过开场门）");
    try {
      meta.live = await capturePage({
        url: LIVE_URL,
        ...toWH(VIEW),
        gate: true,
        expectPath: "/",
        out: out.live,
        label: "线上首屏",
      });
    } catch (e) {
      die(`线上抓屏失败（${LIVE_URL}）：${e.message}`);
    }
  } else if (existsSync(out.live)) {
    log(`· 复用缓存：${path.relative(ROOT, out.live)}`);
  }

  if (want("x007") && stale(out.local)) {
    log("· 抓屏：本仓复刻首屏（静态服务 + 同一套过门动作）");
    const { srv, port } = await startServer(ROOT);
    try {
      meta.local = await capturePage({
        url: `http://127.0.0.1:${port}/`,
        ...toWH(VIEW),
        gate: true,
        expectPath: "/",
        out: out.local,
        label: "本仓首屏",
      });
    } finally {
      srv.close();
    }
  } else if (existsSync(out.local)) {
    log(`· 复用缓存：${path.relative(ROOT, out.local)}`);
  }

  if (want("x013") && stale(out.abf)) {
    log("· 抓屏：AutoBookForge 工作台（本机静态服务；file:// 下 fetch 会被 CORS 拦）");
    need(path.join(S.abfWeb, "index.html"), "AutoBookForge/web/index.html");
    const { srv, port } = await startServer(S.abfWeb);
    try {
      meta.abf = await capturePage({
        url: `http://127.0.0.1:${port}/`,
        ...toWH(VIEW),
        actions: [{ type: "wait", ms: 2500 }],
        out: out.abf,
        label: "AutoBookForge 工作台",
      });
    } finally {
      srv.close();
    }
  } else if (existsSync(out.abf)) {
    log(`· 复用缓存：${path.relative(ROOT, out.abf)}`);
  }

  return { ...out, meta };
}

const toWH = ({ width, height }) => ({ width, height });

// ---------------------------------------------------------------- 抽帧

const FRAMES = [
  { id: "x017", video: S.v017, times: [2, 14, 30] },
  { id: "x018", video: S.v018, times: [2, 9, 16] },
];

function ffprobeDuration(file) {
  const r = spawnSync(FFMPEG, ["-hide_banner", "-i", file], { encoding: "utf8" });
  const m = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec((r.stderr || "") + (r.stdout || ""));
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

async function extractFrames() {
  need(FFMPEG, "tools/bin/ffmpeg.exe");
  const out = [];
  for (const f of FRAMES) {
    if (!want(f.id)) continue;
    need(f.video, `${f.id}.mp4`);
    const dur = ffprobeDuration(f.video);
    log(`· ${f.id}.mp4 时长 ${dur == null ? "未知" : dur.toFixed(3) + " s"}，抽 ${f.times.join(" / ")} s`);
    for (const t of f.times) {
      if (dur != null && t >= dur) die(`${f.id}.mp4 只有 ${dur.toFixed(2)} s，抽不到第 ${t} 秒`);
      const p = path.join(RAW, `frame-${f.id}-${t}s.png`);
      if (!FLAGS.refresh && existsSync(p)) {
        log(`  复用缓存 ${path.relative(ROOT, p)}`);
        out.push({ id: f.id, t, path: p });
        continue;
      }
      // -ss 放在 -i 之后：帧精确（源片都在 1 分钟内，代价可忽略）
      const r = spawnSync(
        FFMPEG,
        ["-hide_banner", "-loglevel", "error", "-y", "-i", f.video, "-ss", String(t), "-frames:v", "1", "-f", "image2", p],
        { encoding: "utf8" }
      );
      if (r.status !== 0) die(`抽帧失败 ${f.id} @${t}s：${(r.stderr || "").trim()}`);
      log(`  ✓ 抽帧 ${f.id} @${t}s → ${path.relative(ROOT, p)}`);
      out.push({ id: f.id, t, path: p });
    }
  }
  return out;
}

// ---------------------------------------------------------------- 合成（Pillow）

const PY_COMPOSE = String.raw`
import json, sys, os
from PIL import Image, ImageFilter, ImageDraw, ImageFont

CANVAS = (2000, 1250)
FONT_CANDIDATES = [
    "C:/Windows/Fonts/msyh.ttc",
    "C:/Windows/Fonts/msyhl.ttc",
    "C:/Windows/Fonts/segoeui.ttf",
    "C:/Windows/Fonts/arial.ttf",
]

def font(size):
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()

def load(p):
    im = Image.open(p)
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
        bg.alpha_composite(im)
        im = bg
    return im.convert("RGB")

def mosaic(im, rects, block=14, blur=8):
    """不可逆打码：块内降采样 → 最近邻放大 → 高斯模糊。用于身份卡（头像/姓名/账号）。"""
    for r in rects or []:
        x0, y0, x1, y1 = [int(v) for v in r]
        x0, y0 = max(0, x0), max(0, y0)
        x1, y1 = min(im.width, x1), min(im.height, y1)
        if x1 <= x0 or y1 <= y0:
            continue
        w, h = x1 - x0, y1 - y0
        region = im.crop((x0, y0, x1, y1))
        small = region.resize((max(1, w // block), max(1, h // block)), Image.BILINEAR)
        region = small.resize((w, h), Image.NEAREST).filter(ImageFilter.GaussianBlur(blur))
        im.paste(region, (x0, y0))
    return im

def cover(im, size, zoom=1.0):
    W, H = size
    s = max(W / im.width, H / im.height) * zoom
    nw, nh = max(1, int(im.width * s + 0.5)), max(1, int(im.height * s + 0.5))
    im2 = im.resize((nw, nh), Image.LANCZOS)
    ox, oy = (nw - W) // 2, (nh - H) // 2
    return im2.crop((ox, oy, ox + W, oy + H))

def contain(im, maxw, maxh):
    s = min(maxw / im.width, maxh / im.height)
    return im.resize((max(1, int(im.width * s + 0.5)), max(1, int(im.height * s + 0.5))), Image.LANCZOS)

def rounded_mask(size, r):
    m = Image.new("L", size, 0)
    if r > 0:
        ImageDraw.Draw(m).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius=r, fill=255)
    else:
        ImageDraw.Draw(m).rectangle([0, 0, size[0] - 1, size[1] - 1], fill=255)
    return m

def paste_panel(base, panel, cx, cy, radius=14, shadow=0.35, hairline=None):
    W, H = panel.size
    x, y = int(cx - W / 2), int(cy - H / 2)
    mask = rounded_mask((W, H), radius)
    if shadow > 0:
        pad = 56
        sil = Image.new("L", (W + pad * 2, H + pad * 2), 0)
        sil.paste(mask, (pad, pad))
        sil = sil.filter(ImageFilter.GaussianBlur(20)).point(lambda v: int(v * shadow))
        base.paste(Image.new("RGB", sil.size, (0, 0, 0)), (x - pad, y - pad + 14), sil)
    base.paste(panel, (x, y), mask)
    if hairline:
        ImageDraw.Draw(base).rounded_rectangle(
            [x, y, x + W - 1, y + H - 1], radius=radius, outline=tuple(hairline), width=2)
    return (x, y, W, H)

def build(job):
    W, H = CANVAS
    base = Image.new("RGB", (W, H), tuple(job.get("bg", [246, 244, 238])))
    bd = job.get("backdrop")
    if bd:
        src = load(bd["src"])
        if bd.get("redact"):
            src = mosaic(src, bd["redact"], bd.get("block", 14))
        cov = cover(src, (W, H), bd.get("zoom", 1.0)).filter(ImageFilter.GaussianBlur(bd.get("blur", 34)))
        tint = Image.new("RGB", (W, H), tuple(bd.get("tint", [10, 12, 14])))
        base = Image.blend(cov, tint, bd.get("darken", 0.55))
    for layer in job.get("layers", []):
        kind = layer["type"]
        if kind == "exact":
            base = cover(load(layer["src"]), (W, H), layer.get("zoom", 1.0))
        elif kind == "panel":
            src = load(layer["src"])
            if layer.get("redact"):
                src = mosaic(src, layer["redact"], layer.get("block", 14))
            p = contain(src, layer["maxw"], layer["maxh"])
            paste_panel(base, p, layer.get("cx", W // 2), layer.get("cy", H // 2),
                        layer.get("radius", 14), layer.get("shadow", 0.35), layer.get("hairline"))
        elif kind == "pair":
            panels = [contain(load(item), 10 ** 6, layer["height"]) for item in layer["srcs"]]
            gap = layer.get("gap", 110)
            total = sum(p.width for p in panels) + gap * (len(panels) - 1)
            x = (W - total) // 2
            for p in panels:
                paste_panel(base, p, x + p.width // 2, layer.get("cy", H // 2),
                            layer.get("radius", 8), layer.get("shadow", 0.4), layer.get("hairline"))
                x += p.width + gap
    for cap in job.get("captions", []):
        d = ImageDraw.Draw(base)
        f = font(cap["size"])
        txt = cap["text"]
        x = cap.get("x", W // 2)
        if cap.get("align", "center") == "center":
            x -= d.textlength(txt, font=f) / 2
        d.text((x, cap["y"]), txt, font=f, fill=tuple(cap.get("color", [30, 30, 30])))
    out = job["out"]
    os.makedirs(os.path.dirname(out), exist_ok=True)
    base.save(out, "JPEG", quality=job.get("quality", 82), optimize=True, progressive=False, subsampling=2)
    return out

def main():
    cfg = json.load(open(sys.argv[1], encoding="utf-8"))
    made = [build(j) for j in cfg["jobs"]]
    print(json.dumps({"ok": True, "built": made}, ensure_ascii=False))

main()
`;

const tmpDir = () => {
  const d = path.join(os.tmpdir(), "boryac-media-capture");
  mkdirSync(d, { recursive: true });
  return d;
};

/** python 子进程统一 UTF-8（仓库路径含中文：stdout/argv 走 cp936 会把路径写坏） */
const PY_ENV = { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" };

function pythonRun(file, args, label) {
  const r = spawnSync(PYTHON, [path.join(tmpDir(), file), ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: PY_ENV,
  });
  if (r.status !== 0) die(`${label}失败：\n${(r.stderr || r.stdout || "").trim().slice(0, 4000)}`);
  return r.stdout.trim();
}

function composeAll(jobs) {
  writeFileSync(path.join(tmpDir(), "compose.py"), PY_COMPOSE, "utf8");
  const payload = path.join(tmpDir(), "compose.json");
  writeFileSync(payload, JSON.stringify({ jobs: jobs.map((j) => ({ ...j, quality: 82 })) }, null, 2), "utf8");
  const out = pythonRun("compose.py", [payload], "Pillow 合成");
  if (!out.includes('"ok": true')) die(`合成输出异常：${out.slice(0, 500)}`);
}

// ---------------------------------------------------------------- 度量（PSNR / Pearson / 直方图交集）

const PY_METRICS = String.raw`
import json, sys, math
from PIL import Image

a = Image.open(sys.argv[1]).convert("RGB").resize((800, 500), Image.LANCZOS)
b = Image.open(sys.argv[2]).convert("RGB").resize((800, 500), Image.LANCZOS)
pa, pb = list(a.getdata()), list(b.getdata())

mse = 0.0
for (r1, g1, b1), (r2, g2, b2) in zip(pa, pb):
    mse += (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2
mse /= (len(pa) * 3)
psnr = float("inf") if mse == 0 else 10 * math.log10((255.0 ** 2) / mse)

la = list(a.convert("L").getdata())
lb = list(b.convert("L").getdata())
n = len(la)
ma, mb = sum(la) / n, sum(lb) / n
cov = sum((x - ma) * (y - mb) for x, y in zip(la, lb))
va = math.sqrt(sum((x - ma) ** 2 for x in la))
vb = math.sqrt(sum((y - mb) ** 2 for y in lb))
pearson = 0.0 if va * vb == 0 else cov / (va * vb)

ha, hb = a.convert("L").histogram(), b.convert("L").histogram()
na, nb = sum(ha), sum(hb)
inter = sum(min(x / na, y / nb) for x, y in zip(ha, hb))

print(json.dumps({"psnr": psnr, "pearson": pearson, "histIntersection": inter,
                  "meanA": ma, "meanB": mb, "meanDiffPct": abs(ma - mb) / 255.0 * 100.0}))
`;

function measure(aPath, bPath) {
  writeFileSync(path.join(tmpDir(), "metrics.py"), PY_METRICS, "utf8");
  const out = pythonRun("metrics.py", [aPath, bPath], "指标计算");
  return JSON.parse(out);
}

// ---------------------------------------------------------------- 任务清单

function buildJobs(frames, sites) {
  const jobs = [];
  const abs = (p) => path.resolve(p);

  // ---- X-002 弈康 ------------------------------------------------
  if (want("x002")) {
    need(S.ykPcHome, "PC官网首页-1.jpg");
    need(S.ykWxChat, "微信小程序-对话页.jpg");
    need(S.ykAdmin, "exe管理界面页-医生数据后台.jpg");
    need(S.ykExeChat, "exe界面页-对话.jpg");
    jobs.push({
      key: "X-002/01",
      out: path.join(MEDIA, "x002", "01.jpg"),
      backdrop: { src: abs(S.ykPcHome), zoom: 1.16, blur: 40, darken: 0.6, tint: [10, 9, 8] },
      layers: [{ type: "panel", src: abs(S.ykPcHome), maxw: 1820, maxh: 1080, radius: 16, shadow: 0.4, hairline: [255, 255, 255, 26] }],
      source: "截图素材/PC官网首页-1.jpg（1661×836，弈康 PC 官网首屏真机截图）",
    });
    jobs.push({
      key: "X-002/02",
      out: path.join(MEDIA, "x002", "02.jpg"),
      backdrop: { src: abs(S.ykWxChat), zoom: 1.6, blur: 48, darken: 0.72, tint: [10, 12, 14] },
      layers: [{ type: "panel", src: abs(S.ykWxChat), maxw: 700, maxh: 1080, radius: 34, shadow: 0.5, hairline: [255, 255, 255, 30] }],
      source: "截图素材/微信小程序-对话页.jpg（310×689，微信小程序对话真机截图）",
    });
    jobs.push({
      key: "X-002/03",
      out: path.join(MEDIA, "x002", "03.jpg"),
      backdrop: { src: abs(S.ykAdmin), zoom: 1.16, blur: 40, darken: 0.6, tint: [10, 10, 12] },
      layers: [{
        type: "panel", src: abs(S.ykAdmin), maxw: 1820, maxh: 1080, radius: 16, shadow: 0.4, hairline: [255, 255, 255, 26],
        redact: [[10, 684, 240, 806]], block: 14,
      }],
      source: "截图素材/exe管理界面页-医生数据后台.jpg（1423×887）；左下用户身份卡（头像+姓名+账号+角色）已打码",
      redacted: true,
    });
    jobs.push({
      key: "X-002/04",
      out: path.join(MEDIA, "x002", "04.jpg"),
      backdrop: { src: abs(S.ykExeChat), zoom: 1.16, blur: 40, darken: 0.6, tint: [10, 10, 12] },
      layers: [{
        type: "panel", src: abs(S.ykExeChat), maxw: 1820, maxh: 1080, radius: 16, shadow: 0.4, hairline: [255, 255, 255, 26],
        redact: [[14, 698, 242, 830]], block: 14,
      }],
      source: "截图素材/exe界面页-对话.jpg（1432×889）；左下用户身份卡（头像+真实姓名+账号 huangbory…）已打码",
      redacted: true,
    });
  }

  // ---- X-007 borv. 作品集站点 -----------------------------------
  // 关于「改版前后」：..\Project_Habitat_Codex_Kit\artifacts\diag\compare-final.png 是唯一真实的
  // 「参考站 vs 本仓」对照图（图内自带 PSNR 21.26 dB / Pearson 0.937 / 直方图交集 0.962 / 平均亮度差 3.86%，
  // 与 X-007、X-014 文案同源）。但它的左幅是第三方站点（KIRAHOOK 字标 + kirahook.github.io），
  // 与 media/README「图上不得出现第三方 logo」冲突，所以 02 改用「线上 × 本仓」两张自采抓屏，
  // 指标由本脚本现算；若评审要求改用那张对照图，把 sites.live 换成 compare-final.png 即可。
  if (want("x007") && sites) {
    need(sites.live, "线上首屏抓屏");
    need(sites.local, "本仓首屏抓屏");
    jobs.push({
      key: "X-007/01",
      out: path.join(MEDIA, "x007", "01.jpg"),
      bg: PAPER,
      layers: [{ type: "exact", src: abs(sites.live), zoom: 1.0 }],
      source: "线上 https://boryac.me/ 首屏（1600×1000 抓屏，16:10 等比铺满画布）",
    });
    const m = measure(sites.live, sites.local);
    const psnrText = m.psnr === Infinity ? "∞（逐像素一致）" : `${m.psnr.toFixed(2)} dB`;
    // 判定口径写在图上，避免把「同一套构建」读成「改版差异」
    const verdict =
      m.psnr >= 40
        ? "判定：两侧是同一套构建，差异只在字体栅格与抗锯齿，不是改版差异"
        : "判定：两侧存在实质差异（标题栏/版式/内容不同）";
    jobs.push({
      key: "X-007/02",
      out: path.join(MEDIA, "x007", "02.jpg"),
      bg: PAPER,
      layers: [
        { type: "panel", src: abs(sites.live), maxw: 900, maxh: 540, cx: 520, cy: 500, radius: 8, shadow: 0.3, hairline: [0, 0, 0, 30] },
        { type: "panel", src: abs(sites.local), maxw: 900, maxh: 540, cx: 1480, cy: 500, radius: 8, shadow: 0.3, hairline: [0, 0, 0, 30] },
      ],
      captions: [
        { text: "线上 boryac.me × 本仓构建 · 首屏对照", size: 46, y: 104, color: [26, 26, 24] },
        { text: "线上 boryac.me", size: 30, y: 186, x: 520, color: [72, 70, 64] },
        { text: "本仓 boryac-clone 构建", size: 30, y: 186, x: 1480, color: [72, 70, 64] },
        { text: "同一视口 1600×1000 · reduced-motion · 过开场门后的首屏", size: 26, y: 800, color: [116, 112, 104] },
        {
          text: `PSNR ${psnrText}　·　亮度 Pearson ${m.pearson.toFixed(3)}　·　亮度直方图交集 ${m.histIntersection.toFixed(3)}　·　平均亮度差 ${m.meanDiffPct.toFixed(2)}%`,
          size: 36, y: 856, color: [26, 26, 24],
        },
        { text: verdict, size: 28, y: 918, color: [60, 58, 52] },
        {
          text: "口径：两图各缩到 800×500 后计算；PSNR 看像素误差、Pearson 看明暗结构、直方图交集看色调分布",
          size: 24, y: 970, color: [132, 126, 116],
        },
      ],
      metrics: m,
      source: `线上首屏 vs 本仓首屏（两张真机抓屏拼版）；指标由本脚本实算于 artifacts/media-capture/raw/*.png —— PSNR ${psnrText}、Pearson ${m.pearson.toFixed(3)}、直方图交集 ${m.histIntersection.toFixed(3)}、平均亮度差 ${m.meanDiffPct.toFixed(2)}%（${verdict.replace("判定：", "")}）`,
    });
  }

  // ---- X-009 应答系统运营后台 -----------------------------------
  if (want("x009")) {
    need(S.ykOps, "ops-dashboard.webp");
    need(S.ykOps2, "网站工作台3.jpg");
    jobs.push({
      key: "X-009/01",
      out: path.join(MEDIA, "x009", "01.jpg"),
      backdrop: { src: abs(S.ykOps), zoom: 1.16, blur: 40, darken: 0.6, tint: [8, 10, 14] },
      layers: [{ type: "panel", src: abs(S.ykOps), maxw: 1820, maxh: 1060, radius: 14, shadow: 0.4, hairline: [255, 255, 255, 26] }],
      source: "Project_Habitat_Codex_Kit/…/yikang-health-guide/ops-dashboard.webp（1600×802，运维工作台流量总览）",
    });
    jobs.push({
      key: "X-009/02",
      out: path.join(MEDIA, "x009", "02.jpg"),
      backdrop: { src: abs(S.ykOps2), zoom: 1.16, blur: 40, darken: 0.6, tint: [8, 10, 14] },
      layers: [{ type: "panel", src: abs(S.ykOps2), maxw: 1820, maxh: 1060, radius: 14, shadow: 0.4, hairline: [255, 255, 255, 26] }],
      source: "截图素材/网站工作台3.jpg（1659×836，Top 请求/路径与 4xx 明细）",
    });
  }

  // ---- X-013 AutoBookForge --------------------------------------
  if (want("x013") && sites) {
    need(sites.abf, "AutoBookForge 抓屏");
    need(S.abfCoverA, "爱有天意_cover.png");
    need(S.abfCoverB, "沉重与卑微_cover.png");
    jobs.push({
      key: "X-013/01",
      out: path.join(MEDIA, "x013", "01.jpg"),
      backdrop: { src: abs(sites.abf), zoom: 1.16, blur: 40, darken: 0.62, tint: [10, 10, 10] },
      layers: [{ type: "panel", src: abs(sites.abf), maxw: 1840, maxh: 1090, radius: 14, shadow: 0.42, hairline: [255, 255, 255, 24] }],
      source: "..\\AutoBookForge\\web\\index.html（本机静态服务抓屏 1600×1000）",
    });
    jobs.push({
      key: "X-013/02",
      out: path.join(MEDIA, "x013", "02.jpg"),
      backdrop: { src: abs(S.abfCoverA), zoom: 1.2, blur: 44, darken: 0.62, tint: [12, 10, 8] },
      layers: [{
        type: "pair", srcs: [abs(S.abfCoverA), abs(S.abfCoverB)], height: 1020, gap: 130,
        radius: 6, shadow: 0.45, hairline: [255, 255, 255, 22],
      }],
      source: "..\\AutoBookForge\\output\\爱有天意_cover.png + 沉重与卑微_cover.png（1600×2560 原图，两本成品封面）",
    });
  }

  // ---- X-017 / X-018 影像抽帧 -----------------------------------
  for (const f of FRAMES) {
    if (!want(f.id)) continue;
    f.times.forEach((t, i) => {
      const fr = frames.find((x) => x.id === f.id && x.t === t);
      if (!fr) die(`缺少抽帧 ${f.id} @${t}s`);
      jobs.push({
        key: `X-${f.id.slice(1)}/${String(i + 1).padStart(2, "0")}`,
        out: path.join(MEDIA, f.id, `${String(i + 1).padStart(2, "0")}.jpg`),
        bg: NIGHT,
        layers: [{ type: "panel", src: abs(fr.path), maxw: 2000, maxh: 1125, radius: 0, shadow: 0, cx: 1000, cy: 625 }],
        source: `videos/${path.basename(f.video)} 第 ${t} 秒（ffmpeg 抽帧，等比到 2000×1125，上下补 #0e100f）`,
      });
    });
  }
  return jobs;
}

// ---------------------------------------------------------------- 自验 + 拼版

const PY_VERIFY = String.raw`
import json, sys, os
from PIL import Image, ImageStat

rows, bad = [], []
for p in sys.argv[1:]:
    size = os.path.getsize(p)
    im = Image.open(p)
    im.load()
    w, h = im.size
    g = im.convert("L")
    st = ImageStat.Stat(g)
    std, mean = st.stddev[0], st.mean[0]
    colors = g.resize((200, 125), Image.NEAREST).getcolors(maxcolors=1 << 20)
    uniq = len(colors or [])
    flat = std < 6.0 or uniq < 12
    ok = (w, h) == (2000, 1250) and im.format == "JPEG" and size <= 400 * 1024 and not flat
    row = {"path": p, "w": w, "h": h, "bytes": size, "format": im.format,
           "stddev": round(std, 2), "mean": round(mean, 1), "colors": uniq, "flat": flat, "ok": ok}
    rows.append(row)
    if not ok:
        bad.append(row)
print(json.dumps({"rows": rows, "bad": bad}, ensure_ascii=False))
`;

function verifyAll(paths) {
  writeFileSync(path.join(tmpDir(), "verify.py"), PY_VERIFY, "utf8");
  return JSON.parse(pythonRun("verify.py", paths, "Pillow 自验"));
}

const PY_SHEET = String.raw`
import json, sys, os
from PIL import Image, ImageDraw, ImageFont

cfg = json.load(open(sys.argv[1], encoding="utf-8"))
items, out = cfg["items"], cfg["out"]
COLS, CW, CH, PAD, LAB = 4, 500, 312, 14, 30
rows = (len(items) + COLS - 1) // COLS
W = COLS * CW + PAD * (COLS + 1)
H = rows * (CH + LAB) + PAD * (rows + 1)
sheet = Image.new("RGB", (W, H), (18, 18, 18))
d = ImageDraw.Draw(sheet)
fp = None
for c in ["C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/segoeui.ttf"]:
    if os.path.exists(c):
        fp = c
        break
f = ImageFont.truetype(fp, 20) if fp else ImageFont.load_default()
for i, it in enumerate(items):
    im = Image.open(it["path"]).convert("RGB")
    im.thumbnail((CW, CH))
    r, c = divmod(i, COLS)
    x = PAD + c * (CW + PAD)
    y = PAD + r * (CH + LAB + PAD)
    sheet.paste(im, (x + (CW - im.width) // 2, y))
    d.text((x + 2, y + CH + 5), it["label"], font=f, fill=(228, 224, 214))
sheet.save(out, "PNG", optimize=True)
print(json.dumps({"w": W, "h": H, "n": len(items)}))
`;

function contactSheet(items, out) {
  writeFileSync(path.join(tmpDir(), "sheet.py"), PY_SHEET, "utf8");
  const cfg = path.join(tmpDir(), "sheet.json");
  writeFileSync(cfg, JSON.stringify({ items, out }, null, 2), "utf8");
  return JSON.parse(pythonRun("sheet.py", [cfg], "拼版"));
}

// ---------------------------------------------------------------- 主流程

async function main() {
  const t0 = Date.now();
  for (const d of [MEDIA, ART, RAW]) mkdirSync(d, { recursive: true });
  log("== t69 真实示例图流水线 ==");
  log(`仓库：${ROOT}`);

  const fv = spawnSync(FFMPEG, ["-version"], { encoding: "utf8" });
  if (fv.status !== 0) die("ffmpeg 不可用：tools/bin/ffmpeg.exe");
  log(`ffmpeg：${FFMPEG}`);
  log(`ffmpeg 版本：${(fv.stdout || "").split("\n")[0]}`);
  const pv = spawnSync(PYTHON, ["-c", "import PIL,sys;print(PIL.__version__, sys.executable)"], { encoding: "utf8" });
  if (pv.status !== 0) die("Pillow 不可用（合成与自验都需要 python + Pillow）");
  log(`Pillow：${pv.stdout.trim()}`);

  const sites = await captureSites();
  const frames = want("x017") || want("x018") ? await extractFrames() : [];

  const jobs = buildJobs(frames, sites);
  if (!jobs.length) die("没有匹配的任务（检查 --only）");
  log(`· 合成 ${jobs.length} 张 …`);
  composeAll(jobs);

  for (const j of jobs) {
    log(`  ✓ ${j.key} → ${path.relative(ROOT, j.out)}（${(statSync(j.out).size / 1024).toFixed(1)} KB）`);
  }

  // 规格自验：Pillow 重新打开每张产物
  const outs = jobs.map((j) => j.out);
  const v = verifyAll(outs);
  log("\n== 自验（Pillow 重新打开每张）==");
  log("   文件                        尺寸      字节   格式  亮度σ  唯一色  判定");
  for (let i = 0; i < v.rows.length; i++) {
    const r = v.rows[i];
    const label = jobs[i] ? path.relative(ROOT, jobs[i].out).replace(/\\/g, "/") : r.path;
    log(
      `   ${label.padEnd(24)} ${r.w}×${r.h} ${String(r.bytes).padStart(7)}  ${r.format}  ${String(r.stddev).padStart(5)}  ${String(r.colors).padStart(4)}   ${r.ok ? "OK" : "FAIL"}`
    );
  }
  writeFileSync(path.join(ART, "verify.json"), JSON.stringify(v, null, 2), "utf8");

  // 幂等：与上一次运行逐文件比 sha256
  const hashes = {};
  for (const p of outs) hashes[path.relative(ROOT, p).replace(/\\/g, "/")] = sha256File(p);
  const hashFile = path.join(ART, "hashes.json");
  const prev = existsSync(hashFile) ? JSON.parse(readFileSync(hashFile, "utf8")) : null;
  if (prev) {
    const changed = Object.keys(hashes).filter((k) => prev[k] !== hashes[k]);
    log(`\n== 幂等 ==\n   与上次运行比对：变化 ${changed.length} 张` + (changed.length ? `（${changed.join(", ")}）` : "　→ 逐字节一致"));
  } else {
    log("\n== 幂等 ==\n   首次运行，sha256 基线写入 artifacts/media-capture/hashes.json");
  }
  writeFileSync(hashFile, JSON.stringify(hashes, null, 2), "utf8");

  if (!FLAGS.noVerify) {
    const sheetOut = path.join(ROOT, "artifacts", "media-real-preview.png");
    const items = v.rows.map((r) => ({
      path: r.path,
      label: `${path.relative(ROOT, r.path).replace(/\\/g, "/").replace("media/", "")}　${Math.round(r.bytes / 1024)} KB`,
    }));
    const s = contactSheet(items, sheetOut);
    log(`\n· contact sheet → artifacts/media-real-preview.png（${s.w}×${s.h}，${s.n} 张）`);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    viewport: VIEW,
    items: jobs.map((j) => ({
      id: j.key.split("/")[0],
      file: path.relative(ROOT, j.out).replace(/\\/g, "/"),
      bytes: statSync(j.out).size,
      sha256: sha256File(j.out),
      source: j.source,
      redacted: Boolean(j.redacted),
      metrics: j.metrics || null,
    })),
    capture: sites.meta,
  };
  writeFileSync(path.join(ART, "report.json"), JSON.stringify(report, null, 2), "utf8");

  log(`\n== 清单（${report.items.length} 张，合计 ${(report.items.reduce((s, x) => s + x.bytes, 0) / 1024).toFixed(0)} KB）==`);
  for (const it of report.items) log(`   ${it.file.padEnd(20)} ${String(it.bytes).padStart(7)} B   ${it.source}`);

  if (v.bad.length) {
    console.error(`\n✗ ${v.bad.length} 张不达标`);
    process.exit(1);
  }
  log(`\n✓ 全部达标（${((Date.now() - t0) / 1000).toFixed(1)} s）`);
}

main().catch((e) => {
  console.error("✗ 未捕获异常：", e);
  process.exit(1);
});
