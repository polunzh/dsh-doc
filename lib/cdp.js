/**
 * CDP 打印：让 Chromium 在页脚画出真实页码。
 *
 * 为什么不用 `--print-to-pdf`：CLI 只能整页开关页眉页脚，格式固定且难看；
 * 而 `Page.printToPDF` 支持 `footerTemplate`，能注入 `<span class="pageNumber">`
 * 和 `totalPages`，这是 Chromium 里唯一能拿到真实页码的正路。
 *
 * 为什么常驻一个浏览器：拉起 headless Chrome 并等 DevTools 端点就绪要 700ms 上下，
 * 占单次渲染的一半。这里把 Chrome 进程做成 module 级单例，之后的渲染只新建 target、
 * 导航、打印；空闲 60s 或进程退出时关掉，下次再按需冷启动。
 *
 * 为什么不常驻 WebSocket：Node 的全局 WebSocket 会一直把 event loop 撑住，
 * 「渲染完就该退出」的宿主（测试进程、一次性脚本）会白等到空闲超时才有机会退出。
 * 本地回环连一次只有几毫秒，所以每次打印单独连、打完就关；Chrome 进程本身 unref 掉，
 * 宿主可正常退出，退出钩子负责把它杀掉。常驻省下的 700ms 冷启动仍然成立。
 *
 * 依赖：Node 22+ 的全局 WebSocket。缺失时抛 `cdp-unavailable`，调用方回落到 CLI 路径。
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const DEFAULT_TIMEOUT = 30_000;

/** 空闲多久回收常驻 Chrome：太短会反复冷启动，太长白占内存（headless 实测约 100MB）。 */
const IDLE_TIMEOUT_MS = 60_000;

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
      { stdio: ["ignore", "ignore", "pipe"] },
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

/** 连上 DevTools 的 WebSocket；超时或出错时关掉 socket 再抛。 */
function openSocket(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      try {
        socket.close();
      } catch {
        /* 还没连上 */
      }
      reject(new Error("WebSocket 连接超时"));
    }, timeoutMs);
    socket.addEventListener(
      "open",
      () => {
        clearTimeout(timer);
        resolve(socket);
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        reject(new Error("WebSocket 连接失败"));
      },
      { once: true },
    );
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
  /** @type {Array<{method: string, sessionId?: string, resolve: Function, reject: Function}>} */
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

  /**
   * 连接断了就把所有未完成的请求拒掉：否则调用方会一直等到各自的超时，
   * 而浏览器其实早就不在了。
   */
  function fail(error) {
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
    for (const waiter of waiters.splice(0)) waiter.reject(error);
  }

  /** @param {string} method @param {object} [params] @param {string} [sessionId] @param {number} [timeoutMs] */
  function call(method, params = {}, sessionId, timeoutMs) {
    const id = nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      let timer = null;
      if (timeoutMs) {
        // 常驻浏览器一旦卡死，没有超时就会永久占住串行队列
        timer = setTimeout(() => {
          if (!pending.delete(id)) return;
          reject(new Error(`CDP ${method} 超时`));
        }, timeoutMs);
      }
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      try {
        socket.send(JSON.stringify(payload));
      } catch (error) {
        pending.delete(id);
        clearTimeout(timer);
        reject(error);
      }
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
      waiters.push({ method, sessionId, resolve: wrapped, reject });
    });
  }

  return { call, waitFor, fail };
}

/* ------------------------------------------------------------------ */
/* 常驻浏览器                                                          */
/* ------------------------------------------------------------------ */

/**
 * 当前常驻的 Chrome 进程（不含连接）。同一时刻最多一个：两个 Chrome 用同一个
 * user-data-dir 会互相抢，而且常驻的意义就是省掉重复冷启动。
 * @type {{key: string, child: import("node:child_process").ChildProcess, url: string, closed: boolean, idleTimer: NodeJS.Timeout|null} | null}
 */
let session = null;

/**
 * 打印串行队列：常驻 Chrome 上一次只跑一次打印。
 * 这样即使两个请求同时进来、甚至调用方传了同一个 pdfPath，也不会出现两个
 * printToPDF 交错写文件；顺带避免多个打印任务抢 CPU。
 */
let queueTail = Promise.resolve();

/** 进程退出钩子只装一次，避免每次冷启动都往 process 上挂监听。 */
let exitHookInstalled = false;

function clearIdleTimer(target) {
  clearTimeout(target.idleTimer);
  target.idleTimer = null;
}

/**
 * 关掉常驻 Chrome。
 *
 * 先 SIGTERM 让它自己收尾（关 target、刷 profile），超时再 SIGKILL。
 * 会话已经半死（socket 断、进程崩）时调用也没问题。
 */
async function shutdown() {
  const current = session;
  session = null;
  if (!current || current.closed) return;
  current.closed = true;
  clearIdleTimer(current);

  try {
    current.child.kill("SIGTERM");
  } catch {
    /* 已退出 */
  }
  if (current.child.exitCode === null) {
    await Promise.race([new Promise((resolve) => current.child.once("exit", resolve)), sleep(500)]);
  }
  if (current.child.exitCode === null) {
    try {
      current.child.kill("SIGKILL");
    } catch {
      /* 已退出 */
    }
  }
}

/**
 * 进程退出时同步杀 Chrome：`exit` 阶段不能 await，SIGKILL 的 kill() 是同步系统调用，
 * 足够保证 DSH 退出后不留下孤儿 headless 进程。
 */
function installExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once("exit", () => {
    const current = session;
    session = null;
    if (!current || current.closed) return;
    current.closed = true;
    clearIdleTimer(current);
    try {
      current.child.kill("SIGKILL");
    } catch {
      /* 已退出 */
    }
  });
}

/** 每次打印完重新计空闲：有活干时不要在后台被回收。 */
function scheduleIdle() {
  if (!session || session.closed) return;
  clearIdleTimer(session);
  session.idleTimer = setTimeout(() => {
    void shutdown();
  }, IDLE_TIMEOUT_MS);
  // 常驻 Chrome 不应该把 Node 的 event loop 撑住（尤其测试进程）
  session.idleTimer.unref?.();
}

/**
 * 拿到可用的常驻 Chrome；没有就冷启动一个。
 * @param {{chromePath: string, userDataDir: string, timeoutMs?: number}} options
 */
async function ensureBrowser(options) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
  const key = `${options.chromePath}\u0000${options.userDataDir}`;
  if (session && !session.closed && session.key === key) {
    clearIdleTimer(session);
    return session;
  }
  // 浏览器或 profile 变了（测试里每个 DSH_HOME 一份）就先收掉旧的，别让两个 Chrome 抢目录
  await shutdown();

  const { child, url } = await launchDevtools(options.chromePath, options.userDataDir, timeoutMs);
  installExitHook();
  // 常驻进程必须持续排空 stderr，否则管道写满会把 Chrome 卡住
  child.stderr.resume();
  // 放掉对子进程与其管道的引用：宿主该退出时就能退出，回收交给空闲定时器和退出钩子
  child.stderr.unref?.();
  child.unref();

  const current = { key, child, url, closed: false, idleTimer: null };
  child.once("exit", () => {
    current.closed = true;
    clearIdleTimer(current);
    if (session === current) session = null;
  });
  session = current;
  return current;
}

/**
 * 连一次 DevTools。连接按次建立、打完就关（原因见文件头的注释）。
 * @param {NonNullable<typeof session>} current
 * @param {number} timeoutMs
 */
async function openChannel(current, timeoutMs) {
  const socket = await openSocket(current.url, timeoutMs).catch(async (error) => {
    // Chrome 还在但连不上，说明它已经不健康了，别留着继续出错
    await shutdown();
    throw error;
  });
  const channel = createChannel(socket);
  const fail = (error) => channel.fail(error);
  socket.addEventListener("close", () => fail(new Error("DevTools 连接已关闭")));
  socket.addEventListener("error", () => fail(new Error("DevTools 连接出错")));
  return { socket, channel };
}

/**
 * 在一次渲染里新建 target、导航、打印、关 target。
 * 每次都用新 target：文档之间不共享 DOM/脚本状态，上一份内容不会漏到下一份。
 * @param {ReturnType<typeof createChannel>} channel
 * @param {{htmlPath: string, pdfPath: string, timeoutMs?: number, margin?: number}} options
 */
async function printPage(channel, options) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
  const mm = marginMmFrom(options.margin);

  const target = await channel.call("Target.createTarget", { url: "about:blank" }, undefined, timeoutMs);
  try {
    const { sessionId } = await channel.call(
      "Target.attachToTarget",
      { targetId: target.targetId, flatten: true },
      undefined,
      timeoutMs,
    );

    await channel.call("Page.enable", {}, sessionId, timeoutMs);
    await channel.call("Runtime.enable", {}, sessionId, timeoutMs);
    const loaded = channel.waitFor("Page.loadEventFired", sessionId, timeoutMs);
    await channel.call("Page.navigate", { url: pathToFileURL(options.htmlPath).href }, sessionId, timeoutMs);
    await loaded;

    // 等字体真正就绪，否则首屏可能用回退字体排版（与旧的每次新起进程实现一致）
    await channel
      .call(
        "Runtime.evaluate",
        { expression: "document.fonts.ready.then(() => true)", awaitPromise: true, returnByValue: true },
        sessionId,
        timeoutMs,
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
      timeoutMs,
    );

    if (!printed || typeof printed.data !== "string") {
      throw new Error("CDP 没有返回 PDF 数据");
    }
    writeFileSync(options.pdfPath, Buffer.from(printed.data, "base64"));
  } finally {
    // target 一定要关：常驻浏览器里漏 target 会一直累积内存
    await channel.call("Target.closeTarget", { targetId: target.targetId }, undefined, 2000).catch(() => undefined);
  }
}

/** 一次完整的打印尝试：拿浏览器 → 连一次 → 打印 → 记空闲时间。失败就整只收掉浏览器。 */
async function printOnce(options) {
  const current = await ensureBrowser(options);
  let socket = null;
  try {
    const opened = await openChannel(current, options.timeoutMs ?? DEFAULT_TIMEOUT);
    socket = opened.socket;
    await printPage(opened.channel, options);
    scheduleIdle();
  } catch (error) {
    await shutdown();
    throw error;
  } finally {
    try {
      socket?.close();
    } catch {
      /* 已关闭 */
    }
  }
}

/**
 * 主动关掉常驻 Chrome。
 *
 * 空闲超时和进程退出已经会回收；这里给插件卸载（开发时热重载的 dispose）
 * 和需要立即释放的场景一个入口，不必等 60s 空闲计时。
 */
export async function shutdownCdp() {
  await shutdown();
}

/**
 * 用 CDP 把 HTML 打成 PDF，页脚带「第 N 页 / 共 M 页」。
 *
 * 复用 module 级的常驻 Chrome；并发调用在这里排队串行执行（见 queueTail 的说明）。
 * @param {{chromePath: string, htmlPath: string, pdfPath: string, userDataDir: string, timeoutMs?: number, margin?: number}} options
 * @returns {Promise<void>}
 */
export async function printWithPageNumbers(options) {
  if (typeof WebSocket !== "function") {
    // 先收掉可能还活着的常驻 Chrome：CLI 回退要用同一个 user-data-dir，
    // 旧进程占着 profile 会让 CLI 启动失败。
    await shutdown();
    throw Object.assign(new Error("当前运行环境不支持 WebSocket，无法生成页码"), { code: "cdp-unavailable" });
  }
  const job = queueTail.then(
    () => printOnce(options),
    () => printOnce(options),
  );
  // 队列本身要吞掉失败，否则一次失败会把后续所有打印都带进 rejected 分支
  queueTail = job.catch(() => undefined);
  return job;
}
