import { readFileSync } from "node:fs";

/**
 * 图版阅读器的「视频通道」补丁（t63）。
 *
 * 背景：参考站的图版阅读器只认静态图（`<img class="plate-image">`）。我们要在同一套
 * 版式里播 720p 的 AI 影像，又不能改它的实现语义（相机、雾、交互代码一律不动），
 * 所以只做**定点字符串替换**：
 *   ① `Kp()` 的 dialog innerHTML 里，图后追加一个 `<video class="plate-video">`；
 *   ② `br()` 切换图版时按扩展名分支：`.mp4` → 隐藏图、设 video 的 src/poster 并 play()，
 *      其余 → 暂停并清空 video、恢复图；
 *   ③ `gg()` 缩略图：视频项用 poster + ▶ 角标与「AI 影像」，并把 `N 幅原始图版` 换成
 *      能容纳影像的表述；
 *   ④ `gg()` 的下载链接：记录没有 document 或首图是 mp4 时，改指「下载压缩版 MP4 720p」；
 *   ⑤ `Jm()` 的元信息表：追加 `STACK / 技术栈` 一行（`n.stack` 不存在就不渲染）。
 *
 * 为什么每一处都要 `must()` 兜底：这些替换是在**别人的压缩产物**上做手术。产物一变，
 * 字符串就可能对不上；此时**必须红**，而不是静默产出一个"看起来正常但播不了视频"的站。
 */

/** 助手源码放在同名 .txt 里：它本身是**要被写进 bundle 的代码**，
 *  不是本文件的一部分 —— 放在 .txt 里可以不转义地保留反引号与 `${}`。 */
const HELPERS = readFileSync(new URL("./plate-helpers.txt", import.meta.url), "utf8");

/** 写进 index.html 的 `<style>`（不动 209 KB 的样式文件）。 */
export const PLATE_VIDEO_CSS = `/* borv-plate-video v1（marker：幂等，构建每次重写同一段） */
.plate-video{display:none;width:100%;height:100%;object-fit:contain;background:#080c10}
.plate-scroll.is-video .plate-image{display:none}
.plate-scroll.is-video .plate-video{display:block}
.portfolio-plate.is-video{position:relative}
.portfolio-plate.is-video .plate-video-badge{position:absolute;left:10px;top:10px;z-index:2;display:inline-flex;align-items:center;gap:6px;padding:4px 8px;font-style:normal;font-size:11px;letter-spacing:.08em;color:#f2efe8;background:rgba(8,12,16,.72);border:1px solid rgba(242,239,232,.35);border-radius:2px;pointer-events:none}`;

/**
 * 对 bundle 施加五处替换。
 * @param {string} js
 * @param {(text:string, from:string, to:string, label:string)=>string} must
 * @returns {string} 打过补丁的 bundle
 */
export function patchPlateVideo(js, must) {
  /* ① dialog innerHTML：图后追加 video */
  js = must(
    js,
    '<div class="plate-scroll"><img class="plate-image" alt=""/></div>',
    '<div class="plate-scroll"><img class="plate-image" alt=""/><video class="plate-video" muted loop playsinline preload="none" controls></video></div>',
    "图版阅读器: dialog innerHTML",
  );

  /* ② br()：按扩展名分支 */
  js = must(
    js,
    'const n=Mi.pages??[],e=It.querySelector(".plate-image");e.src=ft(n[Bi]),e.alt=',
    'const n=Mi.pages??[],e=It.querySelector(".plate-image"),v=It.querySelector(".plate-video"),isV=borvIsVideo(n[Bi]),p=ft(n[Bi]);' +
      'if(v){if(isV){v.poster=ft(borvPoster(n[Bi]));v.src=p;It.querySelector(".plate-scroll").classList.add("is-video");try{v.play()}catch{}}' +
      'else{v.pause();v.removeAttribute("src");It.querySelector(".plate-scroll").classList.remove("is-video")}}' +
      "if(!isV)e.src=p;e.alt=",
    "图版阅读器: br() 切换分支",
  );

  /* ③ 缩略图：视频项 poster + ▶ 角标；同时把「N 幅原始图版」改成能容纳影像的表述 */
  js = must(js, "${e.length} 幅原始图版 · 点击放大阅读", '${e.length} 份图版 · 图片与影像 · 点击放大阅读', "图版: intro 文案");
  js = must(
    js,
    '${e.map((t,i)=>`<button class="portfolio-plate" data-portfolio="open" data-record="${n.id}" data-page="${i}" aria-label="放大 ${Y(n.title)} 第 ${i+1} 幅图版"><img src="${ft(t)}" loading="lazy" alt="${Y(n.title)} 原始图版 ${i+1}"/><span>${String(i+1).padStart(2,"0")} <small>${n.pageNumbers?.[i]?`PDF P.${n.pageNumbers[i]}`:"ORIGINAL CV"}</small><b>↗</b></span></button>`).join("")}',
    '${e.map((t,i)=>borvPlateTile(n,t,i)).join("")}',
    "图版: 缩略图模板",
  );

  /* ④ 下载链接：视频记录改指压缩版 MP4 */
  js = must(
    js,
    '<a class="portfolio-download" href="${ft(n.document??"documents/hu-xinyang-portfolio.pdf")}" download>下载原始 ${n.document?.includes("-cv")?"CV":"作品集"} PDF <span>↓</span></a>',
    "${borvPlateDownload(n)}",
    "图版: 下载链接",
  );

  /* ⑤ Jm() 元信息：追加 STACK 行（无 stack 不渲染） */
  js = must(
    js,
    '张图版`]];return',
    '张图版`]];if(n.stack)e.push(["STACK / 技术栈",n.stack]);return',
    "项目概述: STACK 行",
  );

  /* 助手函数插到 `function gg(n){` 之前（gg 与 br 都要用） */
  js = must(js, "function gg(n){", `${HELPERS}\nfunction gg(n){`, "图版: 注入助手函数");

  return js;
}

/** 把 `<style>` 注入 HTML（幂等：先剥掉旧的一段，再插新的）。 */
export function injectPlateVideoStyle(html) {
  const stripped = html.replace(/\n?\s*<style id="borv-plate-video">[\s\S]*?<\/style>/g, "");
  if (!stripped.includes("</head>")) return stripped;
  return stripped.replace(
    "</head>",
    `  <style id="borv-plate-video">\n${PLATE_VIDEO_CSS}\n  </style>\n  </head>`,
  );
}
