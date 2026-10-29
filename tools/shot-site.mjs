import pw from "file:///<LOCAL_PATH>";
import path from "node:path";
const { chromium } = pw;
const ROOT = path.resolve(process.cwd());
const b = await chromium.launch({ channel: "chrome", headless: true });
// 1) 线上首屏
{
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  await p.goto("https://boryac.me/", { waitUntil: "load", timeout: 60000 });
  await p.waitForTimeout(9000);
  await p.screenshot({ path: path.join(ROOT, "artifacts", "capture", "live-home.png") });
  console.log("live-home ok");
  await p.close();
}
// 2) AutoBookForge Web UI
{
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  const url = "file:///" + path.join(ROOT, "..", "AutoBookForge", "web", "index.html").replace(/\\/g, "/");
  await p.goto(url, { waitUntil: "load", timeout: 60000 }).catch((e) => console.log("abf nav:", String(e).slice(0, 80)));
  await p.waitForTimeout(2500);
  await p.screenshot({ path: path.join(ROOT, "artifacts", "capture", "abf-web.png") });
  console.log("abf ok");
  await p.close();
}
await b.close();
