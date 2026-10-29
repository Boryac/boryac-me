# boryac-me

[boryac.me](https://boryac.me) 的构建管线——把一份经 MIT 授权的三维作品集构建产物，
**镜像式**改造成自己的站点：保留场景、相机、着色器与交互，只替换身份、内容与资源。

这不是一个手写的前端项目，而是一套**可复现的构建脚本**：输入是一份静态构建快照，输出是可部署的站点。

## 为什么这么做

手写重做会丢掉材质、灯光、景深、节奏这些截图里没有的东西。镜像式复刻把视觉还原交给「复制」，
只让内容承担差异——对参考站的相似度从 11.39 dB / 0.512（亮度相关）提到 **21.26 dB / 0.937**。

## 管线

```
python tools/plates.py     图版 / 三维卡片图集 / 作品集 PDF
node   tools/build.mjs     根路径、品牌、数据集、CV 面板、视频通道补丁
node   tools/assets.mjs    PDF、档案文本、service worker 清单
node   tools/fonts.mjs     字体分片瘦身 + 裁剪 @font-face
node   tools/perf.mjs      关键 CSS 内联、字体预载、预缓存瘦身
```

一条命令跑完整链路（顺序即依赖）：

```bash
node tools/make.mjs
```

## 数据

`tools/archives-d/X-001.json … X-018.json`：一条档案一个文件，便于并行改写。
字段含摘要、6 条发现、五段研究、方法与产出、技术栈。

`tools/media/README.md` 约定示例图命名：`media/<id>/NN.jpg`，2000×1250。

## 内容边界

- 档案内容为个人作品记录，允许创作性补写，但**不编造专利、论文、奖项与媒体报道**；
- 站点不发布任何第三方公司标识、真实访客 IP、他人头像与联系方式；
- 上传前跑 `node tools/audit-privacy.mjs`（三道口径：密钥 / 本机路径与上游代号 / 个人信息）。

## 仓库里没有的东西

出于体积与授权原因，以下不进仓库：上游构建快照（`.src/`）、示例图与视频二进制、字体分片、
部署产物与内部工作记录。

## 许可

本站自有的构建脚本与内容以 MIT 发布，见 [LICENSE](LICENSE)。

上游基底来自 [LBEILC / RhineLabUI](https://github.com/LBEILC) 与
[kirahook / KIRAHOOK-CV-Web](https://github.com/kirahook/KIRAHOOK-CV-Web)（MIT, © 2026 LBEILC），
原始版权声明保留在 `licenses/`。站点内的「来源与下载」面板同样保留了致谢与仓库链接。

字体：MiSans 按小米的许可随包分发分片，未做二次修改（仅裁掉用不到的分片）。
开场英文短语使用 Novecento Sans Wide 的**轮廓图形**，未随包分发字体文件。
