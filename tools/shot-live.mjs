import pw from "file:///<LOCAL_PATH>";
import path from "node:path";
const { chromium } = pw;
const ROOT = path.resolve(process.cwd());
const out = path.join(ROOT, "artifacts", "capture", "live-home.png");
const b = await chromium.launch({ channel: "chrome", headless: false, args: ["--window-size=1700,1100"] });
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
await p.goto("https://boryac.me/", { waitUntil: "load", timeout: 60000 });
await p.waitForTimeout(11000);
// 真实交互：点屏幕中央 → 回车 → 等场景
await p.mouse.click(800, 520);
await p.waitForTimeout(1200);
await p.keyboard.press("Enter");
await p.waitForTimeout(9000);
await p.screenshot({ path: out });
const st = await p.evaluate(() => ({
  boot: document.querySelector("[data-boot]")?.getAttribute("data-boot") ?? null,
  text: document.body.innerText.replace(/\s+/g, " ").slice(0, 120),
}));
console.log(JSON.stringify(st));
await b.close();
