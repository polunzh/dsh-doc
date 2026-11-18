/**
 * 生成 README 用的中/英文工作台截图（真实 live.html + 真实 client）。
 * 会选中诗里的一句并加高亮，展示「选中文字格式」这一组控件。
 * 用法：node scripts/capture-selection-screenshot.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { startLiveServer } from "../preview/live-server.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CHROME = process.env.DSH_DOC_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function launchChrome() {
  const userDataDir = mkdtempSync(join(tmpdir(), "cap-sel-"));
  return new Promise((resolve, reject) => {
    const child = spawn(
      CHROME,
      ["--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run", "--no-default-browser-check",
        "--remote-debugging-port=0", `--user-data-dir=${userDataDir}`, "--window-size=1440,900", "about:blank"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let buffer = "";
    let settled = false;
    child.stderr.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(buffer);
      if (m && !settled) { settled = true; resolve({ child, wsUrl: m[1], userDataDir }); }
    });
    child.on("error", reject);
    setTimeout(() => !settled && reject(new Error("Chrome 启动超时")), 30_000);
  });
}

function createChannel(socket) {
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    }
  });
  return {
    call(method, params = {}, sessionId) {
      const id = nextId++;
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify(payload));
      });
    },
  };
}

async function shoot(ch, sessionId, locale, outFile) {
  await ch.call("Page.navigate", { url: `${liveUrl}?locale=${locale}` }, sessionId);
  const evalJson = async (expression) => {
    const r = await ch.call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
    return r?.result?.value;
  };
  for (let i = 0; i < 100; i += 1) {
    const txt = await evalJson(`(document.querySelector('.ddoc-word-canvas')?.innerText || '')`);
    if (txt && txt.includes("春江")) break;
    await sleep(100);
  }
  await sleep(400);
  // 选中一句并加高亮，展示字符级格式
  await evalJson(`(() => {
    const root=document.querySelector('.ddoc-word-canvas');
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    let node;
    while((node=walker.nextNode())){
      const i=node.nodeValue.indexOf('江天一色无纤尘');
      if(i>=0){const r=document.createRange();r.setStart(node,i);r.setEnd(node,i+7);const s=getSelection();s.removeAllRanges();s.addRange(r);document.dispatchEvent(new Event('selectionchange'));return true;}
    }
    return false;
  })()`);
  await sleep(200);
  // 打开高亮色板 → 选黄色
  await evalJson(`(() => { const b=[...document.querySelectorAll('button[title]')].find(x=>x.title.includes('高亮')||x.title.toLowerCase().includes('highlight')); if(!b) return false; b.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true})); b.click(); return true; })()`);
  await sleep(200);
  await evalJson(`(() => { const p=document.querySelector('.ddoc-swatch-pop'); if(!p) return false; const b=[...p.querySelectorAll('button.ddoc-pick')].find(x=>x.title==='#FFF59D'); if(!b) return false; b.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true})); b.click(); return true; })()`);
  await sleep(300);
  // 收起浮层后重新选中，让工具栏保持可用态
  await evalJson(`(() => { const root=document.querySelector('.ddoc-word-canvas'); const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT); let node; while((node=walker.nextNode())){ const i=node.nodeValue.indexOf('皎皎空中孤月轮'); if(i>=0){const r=document.createRange();r.setStart(node,i);r.setEnd(node,i+7);const s=getSelection();s.removeAllRanges();s.addRange(r);document.dispatchEvent(new Event('selectionchange'));return true;} } return false; })()`);
  await sleep(200);
  const shot = await ch.call("Page.captureScreenshot", { format: "png", fromSurface: true, clip: { x: 0, y: 0, width: 1440, height: 900, scale: 1 } }, sessionId);
  writeFileSync(outFile, Buffer.from(shot.data, "base64"));
  console.log("saved", outFile);
}

let liveUrl = "";
let live = null;
let chrome = null;
let socket = null;
try {
  live = await startLiveServer({ port: 0, quiet: true });
  liveUrl = live.url;
  chrome = await launchChrome();
  socket = new WebSocket(chrome.wsUrl);
  await new Promise((r) => socket.addEventListener("open", r));
  const ch = createChannel(socket);
  const target = await ch.call("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await ch.call("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  await ch.call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false }, sessionId);
  await ch.call("Page.enable", {}, sessionId);
  await ch.call("Runtime.enable", {}, sessionId);
  mkdirSync(join(ROOT, "preview", "screenshots"), { recursive: true });
  await shoot(ch, sessionId, "zh", join(ROOT, "preview", "screenshots", "workspace-zh.png"));
  await shoot(ch, sessionId, "en", join(ROOT, "preview", "screenshots", "workspace-en.png"));
} finally {
  try { socket?.close(); } catch {}
  try { chrome?.child?.kill("SIGKILL"); } catch {}
  await sleep(200);
  if (chrome?.userDataDir) { try { rmSync(chrome.userDataDir, { recursive: true, force: true }); } catch {} }
  if (live?.cleanup) { try { await live.cleanup(); } catch {} }
}
