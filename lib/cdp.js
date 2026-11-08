/**
 * CDP 打印：让 Chromium 在页脚画出真实页码。
 *
 * 为什么不用 `--print-to-pdf`：CLI 只能整页开关页眉页脚，格式固定且难看；
 * 而 `Page.printToPDF` 支持 `footerTemplate`，能注入 `<span class="pageNumber">`
 * 和 `totalPages`，这是 Chromium 里唯一能拿到真实页码的正路。
 *
 * 依赖：Node 22+ 的全局 WebSocket。缺失时抛 `cdp-unavailable`，调用方回落到 CLI 路径。
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const DEFAULT_TIMEOUT = 30_000;

/**
 * 默认 A4 边距（毫米），与 printStyles 的 `@page` 保持一致。
 * 调用方可按模板的页边距覆盖；上下比左右略窄是同一条既有规则。
 */
export const DEFAULT_MARGIN_MM = Object.freeze({ top: 15, bottom: 16, left: 18, right: 18 });

/**
 * 由单一「页边距」值推出四边（毫米）。与 core.printStyles 用同一套规则，
 * 否则 CSS 的 @page 与 CDP 的 printToPDF 会打架，出现双重留白。
 * @param {number} margin
 */
export function marginMmFrom(margin) {
  const side = Math.max(8, Number.isFinite(margin) ? margin : DEFAULT_MARGIN_MM.left);
  return { top: Math.max(8, side - 3), bottom: Math.max(8, side - 2), left: side, right: side };
}

/** @param {number} ms */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 启动一个只用于打印的 headless Chrome，返回浏览器级 WebSocket 地址。
 * @param {string} chromePath
 * @param {string} userDataDir
 * @param {number} timeoutMs
 */
function launchDevtools(chromePath, userDataDir, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      chromePath,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--remote-debugging-port=0",
        `--user-data-dir=${userDataDir}`,
        "about:blank",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    let settled = false;
    let buffer = "";
    const timer = setTimeout(() => finish(new Error("等待 DevTools 端点超时")), timeoutMs);

    function finish(error, url) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stderr.off("data", onData);
      if (error) {
        try {
          child.kill("SIGKILL");
        } catch {
          /* 进程可能已自行退出 */
        }
        reject(error);
        return;
      }
      resolve({ child, url });
    }

    function onData(chunk) {
      buffer += chunk.toString("utf8");
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(buffer);
      if (match) finish(null, match[1]);
    }

    child.stderr.on("data", onData);
    child.on("error", (error) => finish(error));
    child.on("exit", (code) => finish(new Error(`Chrome 提前退出（code ${code}）`)));
  });
}

/**
 * 最小 CDP 通道：按 id 配对请求/响应，同时把事件分发给等待者。
 * @param {WebSocket} socket
 */
function createChannel(socket) {
  let nextId = 1;
  /** @type {Map<number, {resolve: Function, reject: Function}>} */
  const pending = new Map();
  /** @type {Array<{method: string, sessionId?: string, resolve: Function}>} */
  const waiters = [];

  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
    } catch {
      return;
    }
    if (message.id && pending.has(message.id)) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message ?? "CDP 错误"));
      else entry.resolve(message.result ?? {});
      return;
    }
    if (message.method) {
      for (let index = waiters.length - 1; index >= 0; index -= 1) {
        const waiter = waiters[index];
        const sameMethod = waiter.method === message.method;
        const sameSession = (waiter.sessionId ?? null) === (message.sessionId ?? null);
        if (sameMethod && sameSession) {
          waiters.splice(index, 1);
          waiter.resolve(message.params ?? {});
        }
      }
    }
  });

  /** @param {string} method @param {object} [params] @param {string} [sessionId] */
  function call(method, params = {}, sessionId) {
    const id = nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify(payload));
    });
  }

  /** @param {string} method @param {string|undefined} sessionId @param {number} timeoutMs */
  function waitFor(method, sessionId, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = waiters.findIndex((item) => item.resolve === wrapped);
        if (index >= 0) waiters.splice(index, 1);
        reject(new Error(`等待 ${method} 超时`));
      }, timeoutMs);
      const wrapped = (params) => {
        clearTimeout(timer);
        resolve(params);
      };
      waiters.push({ method, sessionId, resolve: wrapped });
    });
  }

  return { call, waitFor };
}

/**
 * 用 CDP 把 HTML 打成 PDF，页脚带「第 N 页 / 共 M 页」。
 * @param {{chromePath: string, htmlPath: string, pdfPath: string, userDataDir: string, timeoutMs?: number, margin?: number}} options
 * @returns {Promise<void>}
 */
export async function printWithPageNumbers(options) {
  if (typeof WebSocket !== "function") {
    throw Object.assign(new Error("当前运行环境不支持 WebSocket，无法生成页码"), { code: "cdp-unavailable" });
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
  const mm = marginMmFrom(options.margin);
  const { child, url } = await launchDevtools(options.chromePath, options.userDataDir, timeoutMs);

  let socket = null;
  try {
    socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("WebSocket 连接超时")), timeoutMs);
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("WebSocket 连接失败"));
      });
    });

    const channel = createChannel(socket);
    const target = await channel.call("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await channel.call("Target.attachToTarget", { targetId: target.targetId, flatten: true });

    await channel.call("Page.enable", {}, sessionId);
    await channel.call("Runtime.enable", {}, sessionId);
    const loaded = channel.waitFor("Page.loadEventFired", sessionId, timeoutMs);
    await channel.call(
      "Page.navigate",
      { url: pathToFileURL(options.htmlPath).href },
      sessionId,
    );
    await loaded;

    // 等字体真正就绪，否则首屏可能用回退字体排版
    await channel
      .call(
        "Runtime.evaluate",
        { expression: "document.fonts.ready.then(() => true)", awaitPromise: true, returnByValue: true },
        sessionId,
      )
      .catch(() => undefined);
    await sleep(60);

    const printed = await channel.call(
      "Page.printToPDF",
      {
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate:
          `<div style="width:100%;box-sizing:border-box;padding:0 ${mm.left}mm;` +
          "font-size:8.5px;color:#8A8F84;text-align:center;" +
          "font-family:-apple-system,'PingFang SC','Helvetica Neue',sans-serif;\">" +
          '第 <span class="pageNumber"></span> 页 / 共 <span class="totalPages"></span> 页' +
          "</div>",
        marginTop: mm.top / 25.4,
        marginBottom: mm.bottom / 25.4,
        marginLeft: mm.left / 25.4,
        marginRight: mm.right / 25.4,
      },
      sessionId,
    );

    if (!printed || typeof printed.data !== "string") {
      throw new Error("CDP 没有返回 PDF 数据");
    }
    writeFileSync(options.pdfPath, Buffer.from(printed.data, "base64"));
    await channel.call("Target.closeTarget", { targetId: target.targetId }).catch(() => undefined);
  } finally {
    try {
      socket?.close();
    } catch {
      /* 已关闭 */
    }
    try {
      child.kill("SIGTERM");
    } catch {
      /* 已退出 */
    }
  }
}
