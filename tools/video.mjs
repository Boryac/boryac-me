#!/usr/bin/env node
/**
 * 视频转码：源片 → 站点可播的 720p H.264（**全片时长不减**），并产出海报与三维卡片切片。
 *
 *   node tools/video.mjs          幂等：产物比源新就跳过
 *   node tools/video.mjs --force  强制重编
 *
 * 硬性：
 *   · 时长不裁剪（输出与源时长差 < 0.2 s），这是用户明确要求；
 *   · 单条 ≤ 4.5 / 2.5 MB，禁止把原始 81.5 MB 复制进仓库；
 *   · HEVC 源必须转 H.264（Chrome 播不了 HEVC）；
 *   · 任一步失败 exit 非 0。
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd());
const FF = path.join(ROOT, "tools", "bin", "ffmpeg.exe");
const FP = path.join(ROOT, "tools", "bin", "ffprobe.exe");
const OUT = path.join(ROOT, "videos");
const FORCE = process.argv.includes("--force");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) ?? "").split("=")[1] ?? "";

const JOBS = [
  {
    id: "x017",
    src: "<LOCAL_PATH>",
    maxMB: 4.5,
    rate: "800k",
    expectSec: 40.01,
    label: "自然志 40s 1080p → 720p",
  },
  {
    id: "x018",
    src: "<LOCAL_PATH>",
    maxMB: 2.5,
    rate: "900k",
    expectSec: 20.33,
    label: "人物志 20s HEVC → 720p H.264",
  },
];

const TILE_BG = "0xf6f4ee"; // 与 plates.py 的 PAPER 一致

if (!existsSync(FF)) {
  console.error(`[video] 找不到 ${FF}，先解压 ffmpeg 到 tools/bin/`);
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const run = (args) => {
  execFileSync(FF, args, { cwd: ROOT, stdio: "pipe", maxBuffer: 1 << 26 });
};

function probe(file) {
  const json = execFileSync(
    FP,
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height,duration", "-of", "json", file],
    { cwd: ROOT, encoding: "utf8" },
  );
  const s = JSON.parse(json).streams[0];
  return { codec: s.codec_name, w: s.width, h: s.height, dur: Number(s.duration) };
}

const need = (dst, src) => FORCE || !existsSync(dst) || statSync(dst).mtimeMs < statSync(src).mtimeMs;

let failed = 0;
for (const j of JOBS) {
  if (ONLY && j.id !== ONLY) continue;
  const out = path.join(OUT, `${j.id}.mp4`);
  if (!existsSync(j.src)) {
    console.error(`[video] 源片不存在：${j.src}`);
    failed++;
    continue;
  }
  if (!need(out, j.src)) {
    console.log(`[video] ${j.id} 已是最新，跳过`);
  } else {
    console.log(`[video] ${j.id} ${j.label} …`);
    const scale = "scale=1280:-2:flags=lanczos";
    const venc = ["-c:v", "libx264", "-preset", "slow", "-profile:v", "high", "-level", "4.0"];
    const rate = ["-b:v", j.rate, "-maxrate", "1100k", "-bufsize", "1650k"];
    const log = path.join(ROOT, "tools", "bin", `pass-${j.id}`);
    run(["-y", "-i", j.src, "-vf", scale, ...venc, ...rate, "-pass", "1", "-passlogfile", log, "-an", "-f", "null", "-"]);
    run(["-y", "-i", j.src, "-vf", scale, ...venc, ...rate, "-pass", "2", "-passlogfile", log, "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", out]);
  }

  // 海报 + 卡片切片（同样是幂等）
  const poster = path.join(OUT, `${j.id}-poster.jpg`);
  if (need(poster, out)) {
    run(["-y", "-ss", "1.2", "-i", out, "-frames:v", "1", "-vf", "scale=1280:-2:flags=lanczos", "-q:v", "3", poster]);
  }
  const tile = path.join(OUT, `${j.id}-tile.jpg`);
  if (need(tile, out)) {
    run(["-y", "-ss", "1.2", "-i", out, "-frames:v", "1",
      "-vf", `scale=-2:708:flags=lanczos,pad=2000:708:(ow-iw)/2:(oh-ih)/2:color=${TILE_BG}`, "-q:v", "3", tile]);
  }

  // 校验
  const p = probe(out);
  const mb = statSync(out).size / 1048576;
  const dErr = Math.abs(p.dur - j.expectSec);
  const checks = [
    [`${j.id} 分辨率 1280×720`, p.w === 1280 && p.h === 720],
    [`${j.id} 编码 h264`, p.codec === "h264"],
    [`${j.id} 时长误差 ${dErr.toFixed(3)}s < 0.2`, dErr < 0.2],
    [`${j.id} 体积 ${mb.toFixed(2)} MB ≤ ${j.maxMB}`, mb <= j.maxMB],
    [`${j.id} 海报存在`, existsSync(poster)],
    [`${j.id} 卡片切片 2000×708`, existsSync(tile) && (() => {
      const t = probe(tile); return t.w === 2000 && t.h === 708;
    })()],
  ];
  for (const [label, ok] of checks) {
    console.log(`  ${ok ? "✔" : "✘"} ${label}`);
    if (!ok) failed++;
  }
}

console.log(failed ? `\n[video] ${failed} 项不达标` : "\n[video] 全部达标");
process.exit(failed ? 1 : 0);
