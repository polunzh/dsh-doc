/**
 * 选中文字格式 · 端到端验证（真实 live.html + 真实 client.js + CDP）
 *
 * 用法：node scripts/verify-selection-format.mjs
 * 依赖：macOS Chrome（DSH_DOC_CHROME 可覆盖）、Node 22+ 全局 WebSocket。
 * 产出：.tmp-verify/selection-format-*.png 截图 + stdout 报告。
 *
 * 验证点：
 *  1. 选中文字后 B / I / U / S 生效，且下划线不再露成字面 <u>。
 *  2. 连续套格式时选区不丢。
 *  3. 选中文字单独设字体 / 字号 / 颜色 / 高亮，DOM 里出现带样式的 span。
 *  4. 这些样式经过 core.sanitizeBodyHtml 后仍保留（即能进 PDF）。
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { startLiveServer } from "../preview/live-server.mjs";
import { sanitizeBodyHtml } from "../lib/core.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT_DIR = join(ROOT, ".tmp-verify");
const CHROME = process.env.DSH_DOC_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SEEK = "测试文本";

function launchChrome() {
  const userDataDir = mkdtempSync(join(tmpdir(), "verify-sel-"));
  return new Promise((resolve, reject) => {
    const child = spawn(
      CHROME,
      [
        "--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run", "--no-default-browser-check",
        "--remote-debugging-port=0", `--user-data-dir=${userDataDir}`, "--window-size=1440,960", "about:blank",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let buffer = "";
    let settled = false;
    child.stderr.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(buffer);
      if (m && !settled) {
        settled = true;
        resolve({ child, wsUrl: m[1], userDataDir });
      }
    });
    child.on("error", reject);
    setTimeout(() => !settled && reject(new Error("Chrome DevTools 启动超时")), 30_000);
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
      msg.error ? p.reject(new Error(`${p.method}: ${msg.error.message}`)) : p.resolve(msg.result);
    }
  });
  return {
    call(method, params = {}, sessionId) {
      const id = nextId++;
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, method });
        socket.send(JSON.stringify(payload));
      });
    },
  };
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✔" : "✘"} ${name}${detail ? `  ${detail}` : ""}`);
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  let live = null;
  let chrome = null;
  let socket = null;
  try {
    live = await startLiveServer({ port: 0, quiet: true });
    console.log(`[backend] ${live.url}`);
    chrome = await launchChrome();
    socket = new WebSocket(chrome.wsUrl);
    await new Promise((r) => socket.addEventListener("open", r));
    const ch = createChannel(socket);
    const target = await ch.call("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await ch.call("Target.attachToTarget", { targetId: target.targetId, flatten: true });
    await ch.call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 2, mobile: false }, sessionId);
    await ch.call("Page.enable", {}, sessionId);
    await ch.call("Runtime.enable", {}, sessionId);

    const errors = [];
    socket.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === "Runtime.exceptionThrown") {
        errors.push(msg.params?.exceptionDetails?.exception?.description ?? msg.params?.exceptionDetails?.text ?? "exception");
      }
    });

    const evalJson = async (expression) => {
      const r = await ch.call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (r?.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r?.result?.value;
    };
    const screenshot = async (name) => {
      const shot = await ch.call("Page.captureScreenshot", { format: "png" }, sessionId);
      writeFileSync(join(OUT_DIR, name), Buffer.from(shot.data, "base64"));
    };

    await ch.call("Page.navigate", { url: `${live.url}?locale=zh` }, sessionId);
    for (let i = 0; i < 80; i += 1) {
      const ready = await evalJson(`!!document.querySelector('.ddoc-word-canvas') && !!document.querySelector('.ddoc-ribbon')`);
      if (ready) break;
      await sleep(100);
    }
    const ready = await evalJson(`!!document.querySelector('.ddoc-word-canvas') && !!document.querySelector('.ddoc-ribbon')`);
    if (!ready) throw new Error("live.html 未渲染出编辑区/工具栏");

    // 等草稿/示例异步种进纸面（status 到达后 initialHtml 才就位，过早注入会被种回）
    for (let i = 0; i < 100; i += 1) {
      const txt = await evalJson(`(document.querySelector('.ddoc-word-canvas')?.innerText || '')`);
      if (txt && txt.trim().length > 10) break;
      await sleep(100);
    }
    await sleep(300);

    // 用一段确定的文字替换纸面，避免依赖示例草稿结构；派发 input 让 React 同步 markdown 状态
    await evalJson(`(() => { const root=document.querySelector('.ddoc-word-canvas'); root.innerHTML='<p>Hello 世界 测试文本 ABC</p>'; root.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
    await sleep(200);

    const selectSeek = async () => {
      const res = await evalJson(`(() => {
        const root=document.querySelector('.ddoc-word-canvas');
        const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
        let node;
        while((node=walker.nextNode())){
          const i=node.nodeValue.indexOf(${JSON.stringify(SEEK)});
          if(i>=0){
            const r=document.createRange();r.setStart(node,i);r.setEnd(node,i+${SEEK.length});
            const s=getSelection();s.removeAllRanges();s.addRange(r);
            document.dispatchEvent(new Event('selectionchange'));
            return {ok:true,selected:s.toString()};
          }
        }
        return {ok:false};
      })()`);
      await sleep(120);
      return res;
    };
    const clickTitle = async (title) => {
      const res = await evalJson(`(() => {
        const b=[...document.querySelectorAll('button[title]')].find(x=>x.title===${JSON.stringify(title)});
        if(!b) return {ok:false,titles:[...document.querySelectorAll('button[title]')].map(x=>x.title)};
        b.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}));
        b.click();
        return {ok:true};
      })()`);
      await sleep(160);
      return res;
    };
    const setSelect = async (sel, value) => {
      const res = await evalJson(`(() => {
        const el=document.querySelector(${JSON.stringify(sel)});
        if(!el) return {ok:false,err:'no select'};
        if(el.disabled) return {ok:false,err:'disabled'};
        el.value=${JSON.stringify(value)};
        el.dispatchEvent(new Event('change',{bubbles:true}));
        return {ok:true};
      })()`);
      await sleep(160);
      return res;
    };
    const pickSwatch = async (title, color) => {
      await clickTitle(title);
      const res = await evalJson(`(() => {
        const pop=document.querySelector('.ddoc-swatch-pop');
        if(!pop) return {ok:false,err:'no pop'};
        const b=[...pop.querySelectorAll('button.ddoc-pick')].find(x=>x.title===${JSON.stringify(color)});
        if(!b) return {ok:false,err:'no swatch',titles:[...pop.querySelectorAll('button.ddoc-pick')].map(x=>x.title)};
        b.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}));
        b.click();
        return {ok:true};
      })()`);
      await sleep(180);
      return res;
    };
    const state = () => evalJson(`(() => { const root=document.querySelector('.ddoc-word-canvas'); const s=getSelection(); return { html: root.innerHTML, text: root.innerText, collapsed: s.isCollapsed, sel: s.toString() }; })()`);

    // ── 1. 连续 B / I / U / S ─────────────────────────────────────────
    let sel = await selectSeek();
    check("能选中目标文字", sel.ok && sel.selected === SEEK, JSON.stringify(sel));
    let r = await clickTitle("加粗 (⌘B)");
    check("B 按钮存在且可点", r.ok, r.ok ? "" : JSON.stringify(r));
    let st = await state();
    check("加粗生成了 <b>/<strong>", /<(b|strong)>/.test(st.html), st.html);
    check("加粗后选区未丢", st.collapsed === false && st.sel.includes(SEEK), `collapsed=${st.collapsed} sel=${st.sel}`);

    r = await clickTitle("斜体 (⌘I)");
    st = await state();
    check("斜体生成了 <i>/<em>", /<(i|em)>/.test(st.html), st.html);

    r = await clickTitle("下划线 (⌘U)");
    st = await state();
    check("下划线生成了 <u>", /<u>/.test(st.html), st.html);
    check("下划线没有露成字面标签", !st.html.includes("&lt;u&gt;") && !st.text.includes("<u>"), st.text);

    r = await clickTitle("删除线");
    st = await state();
    check("删除线生成了 <strike>/<s>/<del>", /<(strike|s|del)>/.test(st.html), st.html);
    await screenshot("selection-format-1-text.png");

    // ── 2. 字体 / 字号 / 颜色 / 高亮 ────────────────────────────────
    await selectSeek();
    r = await setSelect(".ddoc-sel-font", "song");
    check("字体下拉可用", r.ok, r.ok ? "" : JSON.stringify(r));
    st = await state();
    check("选中文字字体已改（Songti）", /font-family:[^;"']*Songti/i.test(st.html), st.html);

    await selectSeek();
    r = await setSelect(".ddoc-sel-size", "16");
    check("字号下拉可用", r.ok, r.ok ? "" : JSON.stringify(r));
    st = await state();
    check("选中文字字号 16pt", /font-size:\s*16pt/i.test(st.html), st.html);

    await selectSeek();
    r = await pickSwatch("选中文字的颜色", "#C0392B");
    check("颜色色板可用", r.ok, r.ok ? "" : JSON.stringify(r));
    st = await state();
    check("选中文字颜色 #c0392b", /color:\s*#c0392b/i.test(st.html), st.html);

    await selectSeek();
    r = await pickSwatch("选中文字的高亮", "#FFF59D");
    check("高亮色板可用", r.ok, r.ok ? "" : JSON.stringify(r));
    st = await state();
    check("选中文字高亮 #fff59d", /background-color:\s*#fff59d/i.test(st.html), st.html);
    await screenshot("selection-format-2-all.png");

    // ── 3. 打印白名单保留样式 ───────────────────────────────────────
    const finalState = await state();
    const printHtml = sanitizeBodyHtml(finalState.html);
    check("打印清洗保留字号", /font-size:\s*16pt/i.test(printHtml), printHtml);
    check("打印清洗保留颜色", /color:\s*#c0392b/i.test(printHtml), printHtml);
    check("打印清洗保留高亮", /background-color:\s*#fff59d/i.test(printHtml), printHtml);
    check("打印清洗保留字体", /font-family:[^;"']*Songti/i.test(printHtml), printHtml);
    check("打印清洗丢掉 data-ddoc-fmt", !printHtml.includes("data-ddoc-fmt"), "");

    // ── 4. 草稿持久化：刷新后字符样式仍在 ───────────────────────────
    await sleep(1300);
    await ch.call("Page.reload", {}, sessionId);
    for (let i = 0; i < 100; i += 1) {
      const t = await evalJson(`(document.querySelector('.ddoc-word-canvas')?.innerText || '')`);
      if (t && t.includes(SEEK)) break;
      await sleep(100);
    }
    await sleep(300);
    st = await state();
    check("刷新后文字仍在", st.text.includes(SEEK), st.text);
    check("刷新后字符样式仍在", /data-ddoc-fmt/.test(st.html) && /background-color:\s*#fff59d/i.test(st.html), st.html);

    check("页面无 JS 异常", errors.length === 0, errors.join(" | "));

    const failed = results.filter((x) => !x.ok);
    console.log("");
    console.log(`结果：${results.length - failed.length}/${results.length} 通过`);
    writeFileSync(join(OUT_DIR, "selection-format-report.json"), JSON.stringify(results, null, 2));
    if (failed.length) process.exitCode = 1;
  } finally {
    try { socket?.close(); } catch {}
    try { chrome?.child?.kill("SIGKILL"); } catch {}
    await sleep(200);
    if (chrome?.userDataDir) { try { rmSync(chrome.userDataDir, { recursive: true, force: true }); } catch {} }
    if (live?.cleanup) { try { await live.cleanup(); } catch (error) { console.error("cleanup 失败:", error); } }
  }
}

main().then(
  () => process.exit(process.exitCode || 0),
  (error) => {
    console.error("验证失败:", error);
    process.exit(1);
  },
);
