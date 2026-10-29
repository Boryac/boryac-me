# 构建说明

## 前置

- Node.js ≥ 20
- Python 3.10+（Pillow；用于图版与作品集 PDF）
- 可选：ffmpeg（`tools/bin/ffmpeg.exe`）用于影像转码

## 输入

把参考站的静态构建快照放在 `.src/`（不随仓库分发）。构建永远从 `.src/` 出发，因此幂等。

## 跑

```bash
node tools/make.mjs
```

顺序：plates → build → assets → fonts → assets → perf。

**顺序有依赖**：`build.mjs` 每次会从 `.src` 还原完整 CSS，必须由 `fonts.mjs` 之后
再跑 `perf.mjs` 才能内联到瘦身版；`perf.mjs` 里有断言，内联块 `@font-face` 数量与
CSS 文件不一致就直接失败。

## 自检

```bash
node tools/audit-privacy.mjs        # 三道隐私口径，0 命中才可发布
```

## 可复现性

同一输入连跑两次，`assets/*.js`、`index.html`、`sw.js` 逐字节一致。
