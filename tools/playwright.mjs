/**
 * playwright-core 解析（同 tools/perf/measure.mjs 的理由：本站没有 node_modules）。
 * 顺序：正常包 → PERF_PLAYWRIGHT → 同级 Project_Habitat_Codex_Kit 的安装。
 */
const candidates = [
  "playwright-core",
  process.env.PERF_PLAYWRIGHT,
  new URL("../../../Project_Habitat_Codex_Kit/node_modules/playwright-core/index.js", import.meta.url).href,
].filter(Boolean);

let mod = null;
for (const spec of candidates) {
  try {
    const m = await import(spec);
    mod = m?.chromium ? m : m?.default;
    if (mod?.chromium) break;
  } catch {
    /* 下一个 */
  }
}
if (!mod?.chromium) throw new Error("找不到 playwright-core（装一个或设置 PERF_PLAYWRIGHT）");
export const { chromium } = mod;
export default mod;
