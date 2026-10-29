# boryac-clone —— 对 KIRAHOOK-CV-Web 的镜像式复刻

这个目录**不是**手写的站点，而是把参考站 `https://github.com/kirahook/KIRAHOOK-CV-Web`
（MIT，© 2026 LBEILC）的**构建产物**整套拿过来，只替换「身份 / 内容 / 资源」。
场景、相机、雾、景深、着色器、HUD 布局、交互代码一行未改。

## 为什么这么做

上一版是「照着截图重写实现」，结果视觉相似度只有 0.51（亮度相关）/ 11.4 dB（PSNR）——
因为重写必然丢掉材质、灯光、景深、节奏这些没写在截图里的东西。
镜像式复刻把还原度交给「复制」本身，只让内容承担差异：

| 指标（1440×900 终帧，对参考站） | 手写重做 | 镜像复刻 |
|---|---|---|
| PSNR | 11.39 dB | **21.26 dB** |
| 亮度 Pearson 相关 | 0.512 | **0.937** |
| 亮度直方图交集 | 0.362 | **0.962** |
| 平均亮度差 | 19.01% | **3.86%** |

剩余差异全部来自「品牌字、档案条目、图版」——也就是本来就该不同的部分。

## 目录约定

```
.src/            参考站构建的**原始快照**（首次运行时自动生成，构建永远从它出发）
tools/           构建与部署脚本（不随站点发布）
  plates.py      生成 portfolio/page-01..12.jpg、portrait.jpg、三维卡片纹理图集、作品集 PDF
  build.mjs      换部署根路径 / 换品牌 / 换数据集 / 换 CV 面板 / 清洗私产引用
  assets.mjs     换 PDF、生成 archives 文本、删对方资产目录、重算 service worker 清单、保留 MIT 许可
  fonts.mjs      字体瘦身（761 分片 → 100 片，只在用到的范围内）、同步裁剪 @font-face
  serve.mjs      本地静态服务
artifacts/diag/  诊断用的一次性脚本（不上线）
```

## 构建顺序（一条命令，可重跑、幂等）

```bash
node tools/make.mjs        # 顺序：plates → build → assets → fonts → assets → perf
```

拆开跑等价于：

```bash
python tools/plates.py     # 图版 / 三维卡片图集 / 作品集 PDF（条数 = tools/archives-d 文件数）
node   tools/build.mjs     # 换根路径 / 品牌 / 数据集 / CV 面板 / 视频通道补丁 / 注入 CSS
node   tools/assets.mjs    # 换 PDF、生成 archives、删私产、重算 sw 清单
node   tools/fonts.mjs     # 字体瘦身（761 分片 → 100 片）+ 裁剪 @font-face
node   tools/assets.mjs    # 再跑一次：让 sw 的 FILES 反映刚裁掉的字体
node   tools/perf.mjs      # 首屏：内联瘦身后的 CSS、字体预载、SW 预缓存瘦身
```

**顺序有依赖，别乱序**：`build.mjs` 每次会从 `.src` 还原**完整** CSS（753 条 @font-face），
必须由 `fonts.mjs` 之后再跑 `perf.mjs` 才能内联到瘦身版；`perf.mjs` 里有断言，
内联块 @font-face 数 ≠ CSS 文件条数或 >100 就直接 exit 1（宁可红，不要静默发胖）。

任何一步的替换都要**断言命中**，没命中就退非 0：宁可构建红，不要静默半套。

## 数据与媒体

```
tools/archives-d/X-001.json … X-018.json   每条档案一个文件（并行改写不冲突）
tools/lib/load-archives.mjs                读目录、按文件名排序；缺目录时回落单文件
videos/x017.mp4 x018.mp4                   全片 720p H.264（4.26 / 2.36 MB），禁原码率
videos/*-poster.jpg                        播放器海报（1280×720）
videos/*-tile.jpg                          三维卡片切片（2000×708 = 2.82:1）
```

`node tools/video.mjs` 从桌面源片重新转码（幂等，`--force` / `--only=x017`）；
ffmpeg 静态包解压在 `tools/bin/`，不进仓库发布。

## 许可与合规（必读）

- 上游代码 MIT（© 2026 LBEILC），**原样保留**在 `licenses/kirahook-cv-web-mit.txt`；
  站点内的「来源与下载」面板也保留了对应的致谢与仓库链接。这是 MIT 的硬性条件，不要删。
- 上游还依赖 `RhineLabUI`（MIT）与 `Rhine-Music-Demo`，其声明保留在 `licenses/rhinelab-mit.txt`。
- **字体**：MiSans（小米）随包分片**逐字节未改**，只做「不发布用不到的分片」；
  许可见 `licenses/`。开场大字用的 Novecento 轮廓图形**没有改**（改它就是改编字体）。
- **已移除的对方私产**：`brands/`（院校与企业标识）、`evidence/`（获奖证书照片）、
  `audio/`（作者原创配乐）、`documents/*.pdf`（作者作品集与专利）、`images/contact-qr.png`、
  `archives/RHINE-LAB-*.txt`、以及 `licenses/` 里对方自己的来源说明。
- **清空的对方数据**：专利表、论文表、会议/证书清单、社媒联系卡（换成我们自己的）。

## 部署（boryac.me）

```bash
tar czf ../site-clone.tar.gz --exclude=.src --exclude=tools --exclude=artifacts .
node ../Project_Habitat_Codex_Kit/artifacts/deploy-clone.mjs ../site-clone.tar.gz
```

通道是**阿里云云助手 SendFile**（`workbench` 被本机 Device Guard 拦；OSS 未开通、返回 `UserDisable`）：

- 单个 SendFile 文件必须 ≤16 KB，否则 `FileSize.ExceedLimit`；
- **落盘的是 base64 文本而不是解码后的字节**（实测：16 KB 源片落成 21848 字节的纯 ASCII），
  所以服务端必须 `for f in $(ls|sort); do base64 -d "$f" >> out; done` 逐片解码；
- 分片并行上传（并发 8–10），传完用 `du -sb` 比总字节、再比 `sha256` 才解包；
- 部署前自动把旧站打到 `/root/deploy-backup/site-<时间戳>.tar.gz`。

小改动不要重传整包：`artifacts/deploy-delta.mjs` 只推 HTML / sw.js / pwa-build.json / 许可文本。

## nginx 侧改动（2026-10-28）

- 新增旧路由 301：`/cv`、`/projects`、`/projects/*`、`/about`、`/en` → `/`
  （旧站是多页导出，新站是单页档案体验；保留外链积累）。
- `/assets/` 一周强缓存、`/fonts/` 一月强缓存。
- 打开动态 `gzip_types`：旧站依赖构建期 `.gz` 预压缩文件，那些文件已随旧站删除。
