/**
 * 诊断：同一个字体选择下，「编辑区实际渲染字体」与「PDF 实际内嵌字体」是否一致。
 *
 * 做法：一个 headless Chrome 里
 *   1) 用 client.js 的 paperFontStack()（逐字复制）渲染一段正文 → CSS.getPlatformFontsForNode 读实际字体；
 *   2) 用真实的 core.js wrapPrintHtml()/printStyles() 生成打印页 → Page.printToPDF → pdffonts 读内嵌字体。
 * 两者一致才算「编辑区所见 = PDF 所得」。
 *
 * 用法：node scripts/diag-font-pdf.mjs
 */
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fontStackOf, sanitizeBodyHtml, wrapPrintHtml } from "../lib/core.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = join(root, ".tmp-diag", "fontpdf");
mkdirSync(outDir, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 与 lib/client.js 的 paperFontStack 完全相同（逐字复制，便于对照两套栈） */
function paperFontStack(font) {
  const value = String(font ?? "wenkai").trim();
  switch (value) {
    case "song":
      return '"Songti SC", "STSong", "Source Han Serif SC", "Hiragino Mincho ProN", serif';
    case "kaiti":
      return '"Kaiti SC", "STKaiti", "KaiTi", "LXGW WenKai", serif';
    case "system":
      return '-apple-system, "PingFang SC", "Helvetica Neue", "Segoe UI", sans-serif';
    case "wenkai":
      return '"LXGW WenKai", "Songti SC", "STSong", "Times New Roman", serif';
    default:
      return `"${value.replace(/["'\\]/g, "")}", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`;
  }
}

const SAMPLE = "A: I think Art is the easiest subject for me. 学习英语口语 the lessons feel relaxing.";
const CASES = ["wenkai", "song", "kaiti", "system", "LXGW WenKai", "Songti SC", "PingFang SC", "霞鹜文楷", "Times New Roman", "Helvetica Neue"];

function launchDevtools() {
  const userDataDir = join(tmpdir(), "diag-fontpdf-" + Date.now());
  mkdirSync(userDataDir, { recursive: true });
  return new Promise((res, rej) => {
    const child = spawn(
      CHROME,
      ["--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run", "--remote-debugging-port=0",
        `--user-data-dir=${userDataDir}`, "--window-size=1440,900", "about:blank"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let settled = false;
    let buffer = "";
    child.stderr.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(buffer);
      if (m && !settled) { settled = true; res({ child, url: m[1] }); }
    });
    child.on("error", rej);
  });
}

function createChannel(socket) {
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const e = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) e.reject(new Error(msg.error.message));
      else e.resolve(msg.result);
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

async function main() {
  const { child, url: wsUrl } = await launchDevtools();
  const socket = new WebSocket(wsUrl);
  await new Promise((r) => socket.addEventListener("open", r));
  const channel = createChannel(socket);
  const target = await channel.call("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await channel.call("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  await channel.call("Page.enable", {}, sessionId);
  await channel.call("Runtime.enable", {}, sessionId);
  await channel.call("DOM.enable", {}, sessionId);
  await channel.call("CSS.enable", {}, sessionId);
  const frameId = (await channel.call("Page.getFrameTree", {}, sessionId)).frameTree.frame.id;

  const evaluate = async (expression) => {
    const res = await channel.call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (res?.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails).slice(0, 300));
    return res?.result?.value;
  };
  const platformFonts = async (selector) => {
    const { root: docRoot } = await channel.call("DOM.getDocument", { depth: -1 }, sessionId);
    const { nodeId } = await channel.call("DOM.querySelector", { nodeId: docRoot.nodeId, selector }, sessionId);
    if (!nodeId) return [];
    const res = await channel.call("CSS.getPlatformFontsForNode", { nodeId }, sessionId);
    return (res?.fonts || []).map((f) => f.familyName);
  };
  const pdfFonts = (pdfPath) => {
    const out = execFileSync("/opt/homebrew/bin/pdffonts", [pdfPath], { encoding: "utf8" });
    return out
      .split("\n")
      .slice(2)
      .map((line) => line.trim().split(/\s+/)[0])
      .filter(Boolean)
      .map((name) => name.replace(/^[A-Z]{6}\+/, "").replace(/-Regular|-Bold|-Light/, ""));
  };

  const rows = [];
  for (const font of CASES) {
    // 1) 编辑区：用 class 避免 inline style 双引号破坏 HTML 属性
    const stack = paperFontStack(font);
    const editorPage = `<!doctype html><meta charset="utf-8">
      <style>body{margin:0} .ed-box { font-family: ${stack}; font-size: 14px; padding: 8px; }</style>
      <div id="ed" class="ed-box"><p>${SAMPLE}</p></div>`;
    await channel.call("Page.navigate", { url: "data:text/html;charset=utf-8," + encodeURIComponent(editorPage) }, sessionId);
    await sleep(220);
    const editorFonts = await platformFonts("#ed p");
    const editorW = await evaluate(`(() => { const p = document.querySelector('#ed p'); const r = document.createRange(); r.selectNodeContents(p); return +r.getBoundingClientRect().width.toFixed(2); })()`);

    // 2) PDF：真实 core.js 打印页
    const printHtml = wrapPrintHtml({
      title: "PET Speaking",
      subtitle: "",
      bodyHtml: sanitizeBodyHtml(`<p>${SAMPLE}</p>`),
      accent: "#1F5C3F",
      fontSize: 10.5,
      lineHeight: 1.7,
      margin: 18,
      columns: 1,
      font,
    });
    await channel.call("Page.navigate", { url: "data:text/html;charset=utf-8," + encodeURIComponent(printHtml) }, sessionId);
    await sleep(260);
    const pdfData = await channel.call("Page.printToPDF", { printBackground: true, preferCSSPageSize: true }, sessionId);
    const pdfPath = join(outDir, `print-${font.replace(/[^\w\u4e00-\u9fff-]+/g, "_")}.pdf`);
    writeFileSync(pdfPath, Buffer.from(pdfData.data, "base64"));
    const embedded = pdfFonts(pdfPath);
    const pdfStack = fontStackOf(font);

    const editorSet = [...new Set(editorFonts)].sort().join(",");
    const pdfSet = [...new Set(embedded)].sort().join(",");
    const same = editorSet === pdfSet;
    rows.push({ font, pdfStack, editorFonts, embedded, editorW, same });
    console.log(
      `${font.padEnd(16)} 编辑区=${editorSet || "-"} (w=${editorW})  |  PDF=${pdfSet || "-"}  ` +
        `${same ? "✅一致" : "❌不一致"}`,
    );
  }
  writeFileSync(join(outDir, "report.json"), JSON.stringify(rows, null, 2));
  console.log(`\n报告：${join(outDir, "report.json")}  PDF：${outDir}`);

  socket.close();
  child.kill("SIGKILL");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
