#!/usr/bin/env node
/**
 * 上线前隐私与密钥审计。三道独立口径，任一道命中即非 0：
 *   PASS-1 已知密钥/凭据模式（AK/SK、token、私钥、连接串、内网地址）
 *   PASS-2 本机绝对路径与内部代号（C:\Users、RHINE、KIRAHOOK、hu-xinyang、.src）
 *   PASS-3 个人信息与高熵串（手机号、身份证、银行卡、32+ 位随机串）
 * 只扫「会被发布」的文件（站点根下、排除 .src / tools / artifacts / node_modules）。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd());
const EXCLUDE = new Set([".src", "tools", "artifacts", "node_modules", ".git"]);
const TEXT_EXT = /\.(html|js|mjs|css|json|webmanifest|svg|txt|md|xml|map)$/i;

const walk = (dir, rel = "", out = []) => {
  for (const name of readdirSync(dir)) {
    if (!rel && EXCLUDE.has(name)) continue;
    const abs = path.join(dir, name);
    const r = rel ? `${rel}/${name}` : name;
    const st = statSync(abs);
    if (st.isDirectory()) walk(abs, r, out);
    else out.push({ rel: r, abs, size: st.size });
  }
  return out;
};

const files = walk(ROOT);
const textFiles = files.filter((f) => TEXT_EXT.test(f.rel));

const RULES = [
  ["PASS-1", "阿里云 AK", /LTAI[0-9A-Za-z]{12,}/g],
  ["PASS-1", "AWS AK", /AKIA[0-9A-Z]{16}/g],
  ["PASS-1", "通用 secret 赋值", /(?:secret|token|password|passwd|api[_-]?key|access[_-]?key)\s*[:=]\s*["'][^"'\s]{8,}["']/gi],
  ["PASS-1", "OpenAI/DeepSeek key", /sk-[A-Za-z0-9]{16,}/g],
  ["PASS-1", "私钥块", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ["PASS-1", "带凭据连接串", /(?:mysql|postgres|mongodb|redis):\/\/[^\s"']+:[^\s"']+@/gi],
  ["PASS-1", "内网/回环地址", /\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/g],
  ["PASS-2", "本机绝对路径", /[A-Za-z]:\\\\?Users\\\\?[^\s"'<>]+/g],
  ["PASS-2", "上游代號", /\b(?:RHINE[-_ ]?LAB|KIRAHOOK|hu-xinyang|HU XINYANG|胡鑫洋)\b/gi],
  ["PASS-2", "构建内部目录", /\b(?:\.src\/|tools\/|artifacts\/)/g],
  ["PASS-3", "手机号", /(?<!\d)1[3-9]\d{9}(?!\d)/g],
  ["PASS-3", "身份证", /(?<!\d)\d{17}[\dXx](?!\d)/g],
  ["PASS-3", "银行卡", /(?<!\d)\d{16,19}(?!\d)/g],
  ["PASS-3", "高熵串", /(?<![A-Za-z0-9])[A-Za-z0-9+/=_-]{32,}(?![A-Za-z0-9])/g],
];

/* 白名单：确认可公开的内容 */
const ALLOW = [
  { rule: "高熵串", test: (m) => /^[0-9a-f]{32,64}$/i.test(m) && false }, // 默认不豁免，下面按文件列
];
const ALLOW_FILES = new Set([
  "pwa-build.json", // 含 build 版本 sha1 与文件清单
  "assets/index-rs_UJF4L.js", // 压缩产物里含 sha/哈希类字符串
  "sw.js",
  "manifest.webmanifest",
  "licenses/kirahook-cv-web-mit.txt", // MIT 原文里必须保留上游名称
  "licenses/rhinelab-mit.txt",
  "README.md",
  "media/README.md",
]);

const ONLY = (process.argv.find((a) => a.startsWith("--only=")) ?? "").split("=")[1] ?? "";
const hits = [];
/** 第三方产物（pdf.js、字体包）不参与数字类 PII 与高熵串扫描：里面全是库常量与校验和 */
const isVendor = (rel) => rel.startsWith("assets/") || rel.startsWith("fonts/");
/** 数字类 PII 只扫「我们自己写的内容」 */
const isContent = (rel) => !isVendor(rel);
for (const f of textFiles) {
  if (f.size > 4 * 1024 * 1024) continue;
  const text = readFileSync(f.abs, "utf8");
  for (const [pass, label, re] of RULES) {
    if (ONLY && pass !== ONLY) continue;
    if (pass === "PASS-3" && label === "高熵串" && (isVendor(f.rel) || f.size > 512 * 1024)) continue;
    if (pass === "PASS-3" && label !== "高熵串" && !isContent(f.rel)) continue;
    const found = text.match(re);
    if (!found) continue;
    for (const m of [...new Set(found)].slice(0, 5)) {
      if (pass === "PASS-3" && label === "高熵串" && ALLOW_FILES.has(f.rel)) continue;
      if (pass === "PASS-3" && label === "高熵串") {
        // 纯小写 + 连字符的串是属性名/类名，不是密钥
        if (!/[A-Z]/.test(m) || !/[0-9]/.test(m)) continue;
      }
      if (label === "上游代號" && ALLOW_FILES.has(f.rel)) continue;
      hits.push({ pass, label, file: f.rel, sample: String(m).slice(0, 80) });
    }
  }
}

const byPass = { "PASS-1": 0, "PASS-2": 0, "PASS-3": 0 };
for (const h of hits) byPass[h.pass] += 1;

console.log(`[audit] 扫描 ${files.length} 个文件（文本 ${textFiles.length}）`);
for (const [p, n] of Object.entries(byPass)) console.log(`  ${p}: ${n} 处`);
if (hits.length) {
  console.log("\n命中明细（前 40 条）：");
  for (const h of hits.slice(0, 40)) console.log(`  [${h.pass}] ${h.label} · ${h.file} · ${h.sample}`);
}
process.exit(hits.length ? 1 : 0);
