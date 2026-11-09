/**
 * 打印工坊（dsh-doc）· 预览验证台驱动脚本（Live Preview Verification Harness）
 *
 * ── 用法 ───────────────────────────────────────────────────────────────
 *   node scripts/verify-preview.mjs                       # 默认草稿 test/sample.md
 *   node scripts/verify-preview.mjs --draft test/sample.md
 *   node scripts/verify-preview.mjs --port 0 --self-check
 *
 * 参数：
 *   --draft <path>  作为草稿种子的 Markdown 文件（默认 test/sample.md；需要多页文档才测得出第一页裁切）
 *   --port <n>      Live server 监听端口，默认 0（随机）；实际端口会打印
 *   --self-check    额外做一次「注入旧版 flex 居中 CSS」的反向探针，证明测项 A 真能测出裁切（默认关闭）
 *
 * ── 依赖 ───────────────────────────────────────────────────────────────
 *   运行时：Node 24+（用全局 WebSocket 连 CDP，无任何 npm 依赖）
 *   Chrome：/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
 *           （可用环境变量 DSH_DOC_CHROME 覆盖）
 *   仓库内：
 *     preview/live-server.mjs   真实后端（lib/index.js 的 handler + 静态服务；/print 是 dry-run 桩）
 *     preview/live.html         不 mock fetch 的 React 挂载页（支持 ?locale=zh|en、?modal=1）
 *     lib/client.js lib/index.js lib/core.js   由 live-server 加载，勿单独改
 *     test/sample.md            默认草稿（约 3 页）
 *   系统工具（lib 渲染链路会调用，只读）：pdftoppm、pdfinfo、lpstat、lpoptions
 *   字体：macOS 自带的 Songti SC / Kaiti SC / PingFang SC，另需安装 LXGW WenKai（霞鹜文楷），
 *         否则「文楷」一项会回落到 Songti SC，c 项的 4 种字体就会重复。
 *
 * ── 它会自己起停什么 ────────────────────────────────────────────────────
 *   启动：真实 HTTP 服务（临时 DSH_HOME，关闭后删除）+ 驱动用 Headless Chrome（临时 user-data-dir）。
 *   结束：CDP 连接关闭 → 驱动 Chrome SIGKILL 并删除临时 profile → live server 等渲染请求结束后
 *         调 lib/cdp.js 的 shutdownCdp() 收掉插件侧常驻 Chrome → closeAllConnections + close
 *         → 删除临时 DSH_HOME，最后 process.exit(0)。不留后台进程与临时目录。
 *
 * ── 安全 ───────────────────────────────────────────────────────────────
 *   POST /dsh-doc/api/print 被 live-server 换成 dry-run 桩，返回
 *   { ok:true, dryRun:true, jobId:"DRYRUN-1", queue:"dry-run", pages, sheets }；
 *   该分支在到达 lib/index.js 的 submitPrint 之前就返回，绝不会调用 lp / 真实出纸。
 *   本脚本还会抓取 /print 的响应体，确认 dryRun:true 后才会把 b 项记为通过。
 *
 * ── 输出 ───────────────────────────────────────────────────────────────
 *   人类可读报告（stdout，末尾 PASS/FAIL 摘要）+ JSON（.tmp-verify/report.json）
 *   + 截图（.tmp-verify/*.png：preview-top.png、font-*.png、modal-after-print.png）
 *   .tmp-verify/ 是临时产物目录，已在 .gitignore 中，不要提交。
 *
 * ── 四项验证 ────────────────────────────────────────────────────────────
 *   a. 第一页完整性：?modal=1 打开预览后把 .ddoc-pv-canvas scrollTop 设为 0，检查第一张
 *      .ddoc-pv-sheet 的 getBoundingClientRect 是否完全落在 canvas 可视区内
 *      （page1.top >= canvasTop 且 page1.bottom <= canvasBottom），并输出所有 sheet 的 rect
 *      与 canvas clientHeight/scrollHeight；截图 preview-top.png。
 *   b. 弹窗关闭：点弹窗内的「打印」（不是外层页面的按钮），2.5s 后检查
 *      document.querySelector('.ddoc-modal--preview') 是否仍在 DOM 里 → modalStillOpen。
 *   c. 字体：依次点 .ddoc-seg2 的「文楷/宋体/楷体/黑体」，用 CDP 的 DOM.getDocument +
 *      DOM.querySelectorAll + CSS.getPlatformFontsForNode 读 .ddoc-word-canvas p 的真实渲染字体
 *      （能分辨「CSS 变了但字形没变」）；再从系统字体下拉（.ddoc-font-select）里选一个系统字体测一次；
 *      每个状态存一张纸面截图。
 *   d. 性能：从点击「打印预览」到 .ddoc-pv-sheet img 出现（naturalWidth>0）的毫秒数。
 *      每轮先换字体 + 重载页面，确保服务端内容寻址缓存 miss（否则第二次起只剩 ~20ms 的缓存命中），
 *      重复 3 次，报告 renderMs。
 */
import { startLiveServer } from "../preview/live-server.mjs";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT_DIR = join(ROOT, ".tmp-verify");
const CHROME = process.env.DSH_DOC_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ─────────────────────────── Chrome / CDP ─────────────────────────── */

function launchChrome(chromePath) {
  const userDataDir = join(tmpdir(), `verify-preview-${Date.now()}`);
  mkdirSync(userDataDir, { recursive: true });
  return new Promise((resolveLaunch, rejectLaunch) => {
    const child = spawn(
      chromePath,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--no-first-run",
        "--no-default-browser-check",
        "--remote-debugging-port=0",
        `--user-data-dir=${userDataDir}`,
        "--window-size=1440,900",
        "about:blank",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let settled = false;
    let buffer = "";
    child.stderr.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(buffer);
      if (match && !settled) {
        settled = true;
        resolveLaunch({ child, wsUrl: match[1], userDataDir });
      }
    });
    child.on("error", rejectLaunch);
    setTimeout(() => {
      if (!settled) rejectLaunch(new Error("Chrome DevTools 端点启动超时"));
    }, 30_000);
  });
}

/** 极简 CDP 通道：命令 + 事件订阅。 */
function createCdpChannel(socket) {
  let nextId = 1;
  const pending = new Map();
  /** @type {Map<string, Array<(params: any, sessionId?: string) => void>>} */
  const listeners = new Map();

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message}`));
      else entry.resolve(message.result);
      return;
    }
    if (message.method) {
      for (const callback of listeners.get(message.method) ?? []) {
        try {
          callback(message.params, message.sessionId);
        } catch {
          /* 事件回调失败不影响主流程 */
        }
      }
    }
  });

  return {
    call(method, params = {}, sessionId) {
      const id = nextId++;
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      return new Promise((resolveCall, rejectCall) => {
        pending.set(id, { resolve: resolveCall, reject: rejectCall, method });
        socket.send(JSON.stringify(payload));
      });
    },
    on(method, callback) {
      if (!listeners.has(method)) listeners.set(method, []);
      listeners.get(method).push(callback);
    },
  };
}

/* ────────────────────────────── 主流程 ────────────────────────────── */

async function main() {
  const argv = process.argv.slice(2);
  let draftPath = join(ROOT, "test", "sample.md");
  let serverPort = 0;
  let selfCheck = false;

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = argv[i + 1];
    if (flag === "--draft" && next) {
      draftPath = resolve(process.cwd(), next);
      i += 1;
    } else if (flag === "--port" && next) {
      serverPort = Number.parseInt(next, 10) || 0;
      i += 1;
    } else if (flag === "--self-check") {
      selfCheck = true;
    } else if (flag === "--help" || flag === "-h") {
      console.log("用法: node scripts/verify-preview.mjs [--draft test/sample.md] [--port 0] [--self-check]");
      process.exit(0);
    }
  }

  mkdirSync(OUT_DIR, { recursive: true });
  // 清掉上一轮产物，避免旧截图/旧报告混进来
  for (const name of readdirSync(OUT_DIR)) {
    if (name.endsWith(".png") || name === "report.json") {
      rmSync(join(OUT_DIR, name), { force: true });
    }
  }

  console.log("=============================================================");
  console.log("        dsh-doc · Live Preview Verification Harness          ");
  console.log("=============================================================");
  console.log(`draft : ${draftPath}`);
  console.log(`output: ${OUT_DIR}`);
  console.log(`mode  : real backend + real Chrome (POST /print = dry-run)`);
  console.log("");

  let live = null;
  let chrome = null;
  let socket = null;

  try {
    // 1. 真实后端
    live = await startLiveServer({ port: serverPort, draft: draftPath, quiet: true });
    console.log(`[backend] ${live.url}  (DSH_HOME=${live.dshHome})`);
    console.log(`[backend] draft seeded via ${live.seededDraft?.source ?? "none"} (${live.seededDraft?.bytes ?? 0} bytes)`);

    // 2. 真实 Chrome
    chrome = await launchChrome(CHROME);
    socket = new WebSocket(chrome.wsUrl);
    await new Promise((r) => socket.addEventListener("open", r));
    const channel = createCdpChannel(socket);

    const target = await channel.call("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await channel.call("Target.attachToTarget", { targetId: target.targetId, flatten: true });

    await channel.call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false }, sessionId);
    await channel.call("Page.enable", {}, sessionId);
    await channel.call("Runtime.enable", {}, sessionId);
    await channel.call("DOM.enable", {}, sessionId);
    await channel.call("CSS.enable", {}, sessionId);
    await channel.call("Network.enable", {}, sessionId);
    await channel.call("Log.enable", {}, sessionId);

    /** 页面里的异常/错误日志：404、跨域、字体加载失败都会落在这里。 */
    /** @type {string[]} */
    const pageErrors = [];
    channel.on("Runtime.exceptionThrown", (params) => {
      const details = params?.exceptionDetails;
      pageErrors.push(`exception: ${details?.exception?.description ?? details?.text ?? "unknown"}`);
    });
    channel.on("Log.entryAdded", (params) => {
      const entry = params?.entry;
      if (!entry) return;
      if (entry.level !== "error" && entry.level !== "warning") return;
      // favicon 404 与验证无关，过滤掉
      if (`${entry.text} ${entry.url ?? ""}`.includes("favicon.ico")) return;
      pageErrors.push(`${entry.level}: ${entry.text}${entry.url ? ` (${entry.url})` : ""}`);
    });

    /** @type {Array<{url: string, method: string, status?: number, postData?: string, requestId: string}>} */
    const apiRequests = [];
    channel.on("Network.requestWillBeSent", (params) => {
      const url = params?.request?.url ?? "";
      if (!url.includes("/dsh-doc/api/")) return;
      apiRequests.push({
        url,
        method: params.request.method,
        postData: params.request.postData ?? null,
        requestId: params.requestId,
      });
    });
    channel.on("Network.responseReceived", (params) => {
      const url = params?.response?.url ?? "";
      if (!url.includes("/dsh-doc/api/")) return;
      const entry = apiRequests.find((item) => item.requestId === params.requestId);
      if (entry) entry.status = params.response.status;
    });

    const evaluate = async (expression) => {
      const result = await channel.call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (result?.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "Runtime.evaluate 异常");
      }
      return result?.result?.value;
    };

    const capture = async (filename) => {
      const png = await channel.call("Page.captureScreenshot", { format: "png", fromSurface: true }, sessionId);
      writeFileSync(join(OUT_DIR, filename), Buffer.from(png.data, "base64"));
      return filename;
    };

    /**
     * 截某元素的纸面图。
     * 先把元素滚进视口再量 rect：纸张在 .ddoc-desk 里是缩放+居中布局，直接量可能落在视口外，
     * clip 又要求非负坐标，会截出被裁掉左边的图。maxHeight 用来只截纸面上半部分，
     * 字体对比看标题+头几段就够了，不必把整张 297mm 空白也存下来。
     */
    const captureElement = async (selector, filename, maxHeight = 1100) => {
      const rect = await evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        el.scrollIntoView({ block: 'start', inline: 'center' });
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      })()`);
      if (!rect || rect.width < 2 || rect.height < 2) return capture(filename);
      await sleep(150);
      const rect2 = await evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      })()`);
      const box = rect2 ?? rect;
      // 左右各留 12px 余量，避免文字贴边被截
      const x = Math.max(0, Math.round(box.x) - 12);
      const y = Math.max(0, Math.round(box.y));
      const width = Math.max(2, Math.min(Math.round(box.width) + 24, 1440 - x));
      const height = Math.max(2, Math.min(Math.round(box.height), maxHeight, Math.max(2, 900 - y)));
      const png = await channel.call(
        "Page.captureScreenshot",
        { format: "png", captureBeyondViewport: true, clip: { x, y, width, height, scale: 1 } },
        sessionId,
      );
      writeFileSync(join(OUT_DIR, filename), Buffer.from(png.data, "base64"));
      return filename;
    };

    /**
     * 读一个选择器命中的第一个「有真实文本」的节点的渲染字体。
     * 说明：DOM.querySelector('.ddoc-word-canvas p') 常常命中文档里的空段落（<p><br></p>），
     * 它对 CSS.getPlatformFontsForNode 返回空数组；所以按 DOM.querySelectorAll 顺序找到
     * 第一个真正有字形的 p，并回报它的序号与文本片段作为证据。
     */
    const getPlatformFonts = async (selector) => {
      const doc = await channel.call("DOM.getDocument", { depth: -1 }, sessionId);
      const nodes = await channel.call("DOM.querySelectorAll", { nodeId: doc.root.nodeId, selector }, sessionId);
      if (!nodes?.nodeIds?.length) return { found: false, candidates: 0, fonts: [], matchedIndex: null, text: null };
      for (let index = 0; index < nodes.nodeIds.length; index += 1) {
        const nodeId = nodes.nodeIds[index];
        const fonts = await channel.call("CSS.getPlatformFontsForNode", { nodeId }, sessionId);
        const list = fonts?.fonts ?? [];
        if (list.length === 0) continue;
        const text = await evaluate(`(() => {
          const nodes = document.querySelectorAll(${JSON.stringify(selector)});
          const el = nodes[${index}];
          return el ? (el.innerText || el.textContent || "").trim().slice(0, 40) : null;
        })()`);
        return {
          found: true,
          candidates: nodes.nodeIds.length,
          matchedIndex: index,
          text,
          fonts: list.map((f) => ({ family: f.familyName, postScript: f.postScriptName, glyphs: f.glyphCount })),
        };
      }
      return { found: false, candidates: nodes.nodeIds.length, fonts: [], matchedIndex: null, text: null };
    };

    let navCounter = 0;
    const navigate = async (query) => {
      navCounter += 1;
      const url = `${live.origin}/preview/live?${query}&nav=${navCounter}`;
      apiRequests.length = 0;
      await channel.call("Page.navigate", { url }, sessionId);
      // 不能只看 window.__previewReady：导航提交前旧文档的该变量仍是 true。
      // 用唯一 URL + location.href + readyState 三重确认已经换成新文档。
      for (let i = 0; i < 400; i += 1) {
        await sleep(100);
        const state = await evaluate(
          `(() => ({ href: location.href, ready: document.readyState, preview: Boolean(window.__previewReady), ui: window.__liveUiReady }))()`,
        ).catch(() => null);
        if (state && state.href === url && state.ready === "complete" && state.preview) {
          if (state.ui === false) {
            console.warn("  ! 页面已就绪但版式工具条（.ddoc-seg2）未出现：status 可能较慢");
          }
          return state;
        }
      }
      const last = await evaluate(`(() => ({
        href: location.href,
        ready: document.readyState,
        preview: Boolean(window.__previewReady),
        ui: window.__liveUiReady,
        hasEditor: Boolean(document.querySelector('.ddoc-word-canvas')),
        hasSeg: Boolean(document.querySelector('.ddoc-seg2 button')),
        buttons: Array.from(document.querySelectorAll('button')).slice(0, 8).map((b) => b.innerText.trim()),
        bodyText: (document.body?.innerText ?? '').slice(0, 300),
      }))()`).catch((error) => ({ evalError: String(error?.message ?? error) }));
      throw new Error(
        `预览页面未在 40s 内就绪（${url}）state=${JSON.stringify(last)} pageErrors=${JSON.stringify(pageErrors.slice(0, 6))}`,
      );
    };

    const report = {
      generatedAt: new Date().toISOString(),
      backend: { url: live.url, dshHome: live.dshHome, draft: draftPath, seededDraft: live.seededDraft },
      pageErrors: [],
      testA_page1: null,
      testA_selfCheck: null,
      testB_modalClose: null,
      testC_fonts: null,
      testD_renderMs: null,
      summary: null,
    };

    /* ============================ Test C：字体 ============================ */
    console.log("\n--- [c] 字体：文楷 / 宋体 / 楷体 / 黑体 / 系统字体 ---");
    await navigate("locale=zh&modal=0");
    await sleep(500);

    const segButtons = await evaluate("document.querySelectorAll('.ddoc-seg2 button').length");
    if (!segButtons) {
      throw new Error("版式工具条 .ddoc-seg2 不存在（status 未加载或 UI 结构变了），无法测字体");
    }

    const fontPresets = [
      { key: "wenkai", label: "文楷", expectFamily: "LXGW WenKai" },
      { key: "song", label: "宋体", expectFamily: "Songti SC" },
      { key: "kaiti", label: "楷体", expectFamily: "Kaiti SC" },
      { key: "system", label: "黑体", expectFamily: "PingFang SC" },
    ];
    const fontResults = [];

    for (const preset of fontPresets) {
      const clicked = await evaluate(`(() => {
        const b = Array.from(document.querySelectorAll('.ddoc-seg2 button')).find(
          (x) => x.innerText.trim() === ${JSON.stringify(preset.label)},
        );
        if (!b) return false;
        b.click();
        return true;
      })()`);
      await sleep(450);
      const computed = await evaluate(`(() => {
        const p = document.querySelector('.ddoc-word-canvas p');
        return p ? getComputedStyle(p).fontFamily : null;
      })()`);
      const platform = await getPlatformFonts(".ddoc-word-canvas p");
      const screenshot = await captureElement(".ddoc-word-canvas", `font-${preset.key}.png`);
      fontResults.push({
        preset: preset.key,
        label: preset.label,
        clicked,
        expectedFamilyHint: preset.expectFamily,
        computedFontFamily: computed,
        platformFonts: platform.fonts,
        platformFontSummary: platform.fonts.map((f) => `${f.family} (${f.glyphs})`).join(", ") || "NONE",
        platformFontsMatchedParagraph: platform.matchedIndex,
        sampleText: platform.text,
        screenshot,
      });
      console.log(`  ${preset.label}: ${fontResults.at(-1).platformFontSummary}`);
      console.log(`    computed: ${computed}`);
    }

    // 系统字体下拉（FontPicker）：打开 → 选一个已安装的系统字体
    console.log("  系统字体下拉…");
    const pickerOpened = await evaluate(`(() => {
      const btn = document.querySelector('.ddoc-font-select');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    await sleep(400);
    let pickedFontName = null;
    if (pickerOpened) {
      pickedFontName = await evaluate(`(() => {
        const items = Array.from(document.querySelectorAll('.ddoc-font-list li'))
          .filter((el) => !el.className.includes('ddoc-font-header'));
        if (!items.length) return null;
        const preferred = ['PingFang SC', 'Songti SC', 'Kaiti SC', 'Helvetica Neue', 'Arial'];
        let target = null;
        for (const name of preferred) {
          target = items.find((el) => (el.innerText || '').trim().startsWith(name));
          if (target) break;
        }
        target = target || items[0];
        const name = (target.querySelector('.ddoc-font-name')?.innerText || target.innerText || '').trim();
        target.click();
        return name.split(String.fromCharCode(10))[0];
      })()`);
      await sleep(600);
      const computed = await evaluate(`(() => {
        const p = document.querySelector('.ddoc-word-canvas p');
        return p ? getComputedStyle(p).fontFamily : null;
      })()`);
      const platform = await getPlatformFonts(".ddoc-word-canvas p");
      const screenshot = await captureElement(".ddoc-word-canvas", "font-system-custom.png");
      fontResults.push({
        preset: "system-custom",
        label: `系统字体下拉 (${pickedFontName ?? "未选中"})`,
        clicked: Boolean(pickedFontName),
        expectedFamilyHint: pickedFontName,
        computedFontFamily: computed,
        platformFonts: platform.fonts,
        platformFontSummary: platform.fonts.map((f) => `${f.family} (${f.glyphs})`).join(", ") || "NONE",
        platformFontsMatchedParagraph: platform.matchedIndex,
        sampleText: platform.text,
        screenshot,
      });
      console.log(`  ${fontResults.at(-1).label}: ${fontResults.at(-1).platformFontSummary}`);
    } else {
      console.log("  未找到 .ddoc-font-select（系统字体下拉）");
    }

    // 判定字体是否真的换了字形：比较四个预设的首选家族名
    const actualFamilies = fontResults
      .filter((f) => ["wenkai", "song", "kaiti", "system"].includes(f.preset))
      .map((f) => f.platformFonts[0]?.family ?? null);
    const distinctFamilies = new Set(actualFamilies.filter(Boolean));
    report.testC_fonts = {
      results: fontResults,
      actualFamilies,
      distinctFamilyCount: distinctFamilies.size,
      glyphsActuallyChanged: distinctFamilies.size === 4,
    };

    /* ============================ Test D：性能 ============================ */
    console.log("\n--- [d] 性能：点击「打印预览」→ 第一张预览图出现 ---");
    const renderRuns = [];
    // 每一轮换一个字体，让最终 HTML 变掉，服务端的内容寻址缓存必然 miss——
    // 否则第二次开始会命中缓存（约 20ms），测到的就不是 Chrome 真实渲染耗时了。
    const perfFonts = [
      { round: 1, label: "宋体" },
      { round: 2, label: "楷体" },
      { round: 3, label: "黑体" },
    ];
    for (const item of perfFonts) {
      // 每轮重新加载页面，保证客户端也是冷启动（没有上一次的 result 可复用）
      await navigate("locale=zh&modal=0");
      await sleep(350);
      const fontClicked = await evaluate(`(() => {
        const b = Array.from(document.querySelectorAll('.ddoc-seg2 button')).find(
          (x) => x.innerText.trim() === ${JSON.stringify(item.label)},
        );
        if (!b) return false;
        b.click();
        return true;
      })()`);
      await sleep(300);
      const ms = await evaluate(`(async () => {
        const btn = Array.from(document.querySelectorAll('button')).find(
          (b) => b.innerText.includes('打印预览') || b.innerText.includes('Print preview'),
        );
        if (!btn) return -1;
        const started = performance.now();
        btn.click();
        while (performance.now() - started < 40000) {
          const img = document.querySelector('.ddoc-pv-sheet img');
          if (img && img.complete && img.naturalWidth > 0) return Math.round(performance.now() - started);
          await new Promise((r) => setTimeout(r, 16));
        }
        return -2;
      })()`);
      renderRuns.push({ round: item.round, font: item.label, fontClicked, renderMs: ms });
      console.log(`  round ${item.round} (${item.label}): ${ms} ms`);
    }
    const validRuns = renderRuns.map((r) => r.renderMs).filter((n) => Number.isFinite(n) && n >= 0);
    const sorted = [...validRuns].sort((a, b) => a - b);
    report.testD_renderMs = {
      runs: renderRuns,
      values: validRuns,
      min: sorted[0] ?? null,
      median: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
      max: sorted.at(-1) ?? null,
      average: validRuns.length ? Math.round(validRuns.reduce((a, b) => a + b, 0) / validRuns.length) : null,
      note: "每轮先换字体再冷启动页面，确保服务端内容寻址缓存 miss，测到的是真实 Chrome 渲染耗时",
    };
    console.log(`  min/median/max: ${report.testD_renderMs.min} / ${report.testD_renderMs.median} / ${report.testD_renderMs.max} ms`);

    /* ============================ Test A：第一页 ============================ */
    console.log("\n--- [a] 第一页完整性（scrollTop = 0） ---");
    // 用 ?modal=1 让 live.html 自己点开「打印预览」：既验证该参数，也保证 a 项
    // 是在「用户刚打开预览」的干净状态下量的（不依赖上一项残留的弹窗）。
    await navigate("locale=zh&modal=1");
    await sleep(400);
    let modalOpen = await evaluate("Boolean(document.querySelector('.ddoc-modal--preview'))");
    if (!modalOpen) {
      throw new Error("?modal=1 没有自动打开预览弹窗");
    }

    const measurePage1 = () => evaluate(`(() => {
      const canvas = document.querySelector('.ddoc-pv-canvas');
      if (!canvas) return { error: 'no .ddoc-pv-canvas' };
      canvas.scrollTop = 0;
      const c = canvas.getBoundingClientRect();
      const sheets = Array.from(document.querySelectorAll('.ddoc-pv-sheet')).map((sheet, index) => {
        const r = sheet.getBoundingClientRect();
        return {
          page: index + 1,
          top: Math.round(r.top * 100) / 100,
          bottom: Math.round(r.bottom * 100) / 100,
          left: Math.round(r.left * 100) / 100,
          width: Math.round(r.width * 100) / 100,
          height: Math.round(r.height * 100) / 100,
        };
      });
      const page1 = sheets[0] ?? null;
      const canvasTop = Math.round(c.top * 100) / 100;
      const canvasBottom = Math.round(c.bottom * 100) / 100;
      return {
        canvas: {
          top: canvasTop,
          bottom: canvasBottom,
          left: Math.round(c.left * 100) / 100,
          width: Math.round(c.width * 100) / 100,
          height: Math.round(c.height * 100) / 100,
          clientHeight: canvas.clientHeight,
          scrollHeight: canvas.scrollHeight,
          scrollTop: canvas.scrollTop,
        },
        page1,
        sheets,
        page1FullyVisible: Boolean(page1 && page1.top >= canvasTop && page1.bottom <= canvasBottom),
        topClippedPx: page1 ? Math.round((canvasTop - page1.top) * 100) / 100 : null,
        bottomOverflowPx: page1 ? Math.round((page1.bottom - canvasBottom) * 100) / 100 : null,
        oldScrollTop: canvas.scrollTop,
      };
    })()`);

    // 先把可能残留的 scrollTop 归零再测
    const page1 = await measurePage1();
    await sleep(300);
    const page1Stable = await measurePage1();
    const shotPreviewTop = await capture("preview-top.png");

    report.testA_page1 = {
      ...page1Stable,
      firstSample: page1,
      screenshot: shotPreviewTop,
      tolerancePx: 0,
    };
    console.log(`  canvas   : top=${page1Stable.canvas.top} bottom=${page1Stable.canvas.bottom} clientH=${page1Stable.canvas.clientHeight} scrollH=${page1Stable.canvas.scrollHeight}`);
    console.log(`  page1    : top=${page1Stable.page1?.top} bottom=${page1Stable.page1?.bottom} height=${page1Stable.page1?.height}`);
    console.log(`  sheets   : ${page1Stable.sheets.map((s) => `p${s.page}[${s.top},${s.bottom}]`).join("  ")}`);
    console.log(`  visible  : ${page1Stable.page1FullyVisible ? "YES" : "NO"}  (top clipped ${page1Stable.topClippedPx}px, bottom overflow ${page1Stable.bottomOverflowPx}px)`);

    // 反向探针：注入旧版 flex 居中 CSS，确认这项检测真的能抓到裁切
    if (selfCheck) {
      console.log("  self-check: 注入旧版 .ddoc-pv-canvas flex 居中 CSS，验证检测灵敏度…");
      await evaluate(`(() => {
        const tag = document.createElement('style');
        tag.id = '__verify_legacy_flex';
        tag.textContent = '.ddoc-pv-canvas{display:flex !important;align-items:center !important;justify-content:center !important;padding:22px !important} .ddoc-pv-pages{padding:0 !important;min-height:100% !important}';
        document.head.append(tag);
        document.querySelector('.ddoc-pv-canvas').scrollTop = 0;
        return true;
      })()`);
      await sleep(350);
      const legacy = await measurePage1();
      report.testA_selfCheck = {
        probe: "legacy flex-centering CSS injected",
        page1FullyVisible: legacy.page1FullyVisible,
        topClippedPx: legacy.topClippedPx,
        canvasTop: legacy.canvas.top,
        page1Top: legacy.page1?.top,
        reproducedClipping: legacy.page1FullyVisible === false,
        screenshot: await capture("preview-top-legacy-css.png"),
      };
      await evaluate(`(() => { document.getElementById('__verify_legacy_flex')?.remove(); return true; })()`);
      await sleep(250);
      console.log(`  self-check: ${report.testA_selfCheck.reproducedClipping ? "已复现旧版裁切（检测有效）" : "未复现（检测可能太宽松）"}，topClipped=${report.testA_selfCheck.topClippedPx}px`);
      // 恢复真实状态再继续
      await measurePage1();
    }

    /* ============================ Test B：弹窗关闭 ============================ */
    console.log("\n--- [b] 弹窗：点弹窗内「打印」后 2.5s 是否关闭 ---");
    // 确认弹窗仍开着（A 之后应还在）
    modalOpen = await evaluate("Boolean(document.querySelector('.ddoc-modal--preview'))");
    if (!modalOpen) {
      console.log("  ! 弹窗未打开，重新打开后再测");
      await evaluate(`(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(
          (b) => b.innerText.includes('打印预览') || b.innerText.includes('Print preview'),
        );
        if (btn) btn.click();
      })()`);
      await sleep(1500);
    }

    const printButtonInfo = await evaluate(`(() => {
      const modal = document.querySelector('.ddoc-modal--preview');
      if (!modal) return { found: false, error: 'modal not open' };
      const btn = modal.querySelector('.ddoc-modal-actions .ddoc-btn--primary');
      if (!btn) return { found: false, error: 'modal print button not found' };
      const r = btn.getBoundingClientRect();
      return {
        found: true,
        label: (btn.innerText || '').trim(),
        disabled: Boolean(btn.disabled),
        x: r.x + r.width / 2,
        y: r.y + r.height / 2,
      };
    })()`);

    let modalStillOpen = null;
    let shotModalAfter = null;
    let printResponse = null;
    if (printButtonInfo?.found && !printButtonInfo.disabled) {
      // 用真实鼠标事件点弹窗内的按钮（不是外层页面的按钮）
      await channel.call("Input.dispatchMouseEvent", { type: "mousePressed", x: printButtonInfo.x, y: printButtonInfo.y, button: "left", clickCount: 1 }, sessionId);
      await channel.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: printButtonInfo.x, y: printButtonInfo.y, button: "left", clickCount: 1 }, sessionId);
      console.log(`  点击弹窗内按钮：「${printButtonInfo.label}」`);
      await sleep(2500);
      modalStillOpen = await evaluate("Boolean(document.querySelector('.ddoc-modal--preview'))");
      shotModalAfter = await capture("modal-after-print.png");

      // 取 /print 的响应体，确认 dry-run
      const printReq = apiRequests.find((item) => item.url.endsWith("/print") && item.method === "POST");
      if (printReq) {
        try {
          const body = await channel.call("Network.getResponseBody", { requestId: printReq.requestId }, sessionId);
          printResponse = JSON.parse(body?.body ?? "{}");
        } catch (error) {
          printResponse = { error: String(error?.message ?? error) };
        }
      }
      console.log(`  /print 响应: ${JSON.stringify(printResponse)}`);
      console.log(`  modalStillOpen: ${modalStillOpen}`);
    } else {
      console.log(`  ! 弹窗内打印按钮不可点: ${JSON.stringify(printButtonInfo)}`);
    }

    report.testB_modalClose = {
      button: printButtonInfo,
      modalStillOpen,
      printResponse,
      dryRunUsed: printResponse?.dryRun === true,
      serverDryRuns: live.stats.dryRuns,
      serverLastDryRun: live.stats.lastDryRun,
      screenshot: shotModalAfter,
    };

    /* ============================ locale 检查 ============================ */
    await navigate("locale=en&modal=0");
    await sleep(400);
    const enCheck = await evaluate(`(() => {
      const previewBtn = Array.from(document.querySelectorAll('button')).find((b) => /preview/i.test(b.innerText));
      const title = document.querySelector('.ddoc-title')?.innerText ?? null;
      const seg = Array.from(document.querySelectorAll('.ddoc-seg2 button')).map((b) => b.innerText.trim());
      return { previewButton: previewBtn ? previewBtn.innerText.trim() : null, title, seg };
    })()`);
    report.localeCheck = {
      en: enCheck,
      ok: Boolean(enCheck?.previewButton && /preview/i.test(enCheck.previewButton)),
    };
    console.log(`\n[locale=en] 预览按钮="${enCheck?.previewButton}" 字体键=[${(enCheck?.seg ?? []).join(", ")}]`);

    /* ============================== 汇总 ============================== */
    const passA = report.testA_page1?.page1FullyVisible === true;
    const passB = report.testB_modalClose?.modalStillOpen === false;
    const passBdry = report.testB_modalClose?.dryRunUsed === true;

    report.summary = {
      A_page1_integrity: passA ? "PASS" : "FAIL",
      A_detail: report.testA_page1
        ? `page1.top=${report.testA_page1.page1?.top}, canvas.top=${report.testA_page1.canvas.top}, canvas.bottom=${report.testA_page1.canvas.bottom}, page1.bottom=${report.testA_page1.page1?.bottom}`
        : "no data",
      B_modal_closes: passB ? "PASS" : "FAIL",
      B_dryRun_only: passBdry ? "PASS" : "FAIL",
      C_font_families: report.testC_fonts?.actualFamilies,
      C_glyphs_changed: report.testC_fonts?.glyphsActuallyChanged ?? null,
      D_render_ms: report.testD_renderMs,
    };

    report.pageErrors = [...new Set(pageErrors)];

    writeFileSync(join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2), "utf8");

    console.log("\n=============================================================");
    console.log("                     PASS / FAIL SUMMARY                      ");
    console.log("=============================================================");
    console.log(` [a] 第一页完整性          : ${passA ? "PASS" : "FAIL"}`);
    if (report.testA_page1?.page1) {
      console.log(`     canvas y=${report.testA_page1.canvas.top}..${report.testA_page1.canvas.bottom} (clientH=${report.testA_page1.canvas.clientHeight}, scrollH=${report.testA_page1.canvas.scrollHeight})`);
      console.log(`     page1  y=${report.testA_page1.page1.top}..${report.testA_page1.page1.bottom}  topClipped=${report.testA_page1.topClippedPx}px bottomOverflow=${report.testA_page1.bottomOverflowPx}px`);
    }
    if (selfCheck && report.testA_selfCheck) {
      console.log(`     self-check（旧版 flex CSS）: ${report.testA_selfCheck.reproducedClipping ? "复现裁切 → 检测有效" : "未复现"}`);
    }
    console.log(` [b] 弹窗点打印后关闭      : ${passB ? "PASS" : "FAIL"}   (modalStillOpen=${report.testB_modalClose?.modalStillOpen})`);
    console.log(`     /print 仅 dry-run     : ${passBdry ? "PASS" : "FAIL"}   (jobId=${printResponse?.jobId ?? "-"}, queue=${printResponse?.queue ?? "-"}, dryRun=${printResponse?.dryRun ?? "-"})`);
    console.log(` [c] 字体真实字形          : ${report.testC_fonts?.glyphsActuallyChanged ? "4 种预设各自不同" : "存在重复/未切换"}`);
    console.log(`     ${(report.testC_fonts?.results ?? []).map((f) => `${f.label}=${f.platformFontSummary}`).join("\n     ")}`);
    console.log(` [d] 渲染耗时              : min=${report.testD_renderMs?.min}ms median=${report.testD_renderMs?.median}ms max=${report.testD_renderMs?.max}ms  runs=[${(report.testD_renderMs?.runs ?? []).map((r) => `${r.font}:${r.renderMs}ms`).join(", ")}]`);
    console.log("=============================================================");
    console.log(`报告: ${join(OUT_DIR, "report.json")}`);
    console.log(`截图: ${OUT_DIR}/*.png`);
    if (report.pageErrors.length) {
      console.log("页面错误 / 警告:");
      for (const line of report.pageErrors.slice(0, 12)) console.log(`  - ${line}`);
    } else {
      console.log("页面错误 / 警告: 无");
    }
    console.log("");

    if (!passA || !passB) {
      console.log("结论：存在未通过项，见上方明细。");
    } else {
      console.log("结论：a / b 全部通过。");
    }
  } finally {
    // 关停顺序：CDP → Chrome → 后端（后端会等正在跑的渲染）
    try {
      socket?.close();
    } catch {}
    try {
      chrome?.child?.kill("SIGKILL");
    } catch {}
    // 给被杀掉的 Chrome 一点时间释放文件句柄，再删临时 profile
    await sleep(250);
    if (chrome?.userDataDir) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          rmSync(chrome.userDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        } catch {}
        if (!existsSync(chrome.userDataDir)) break;
        await sleep(200);
      }
    }
    if (live) {
      try {
        await live.cleanup();
      } catch (error) {
        console.error("cleanup 失败:", error);
      }
    }
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error("验证失败:", error);
    process.exit(1);
  },
);
