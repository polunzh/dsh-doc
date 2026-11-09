#!/usr/bin/env node
/**
 * 打印工坊（dsh-doc）· 真实后端预览验证台（Live harness）
 *
 * 目的：把 `lib/index.js` 的真实 HTTP handler 接到一个真实的 Node HTTP 服务上，
 * 让 `preview/live.html` 在不 mock fetch 的情况下跑完整链路（status / render / draft），
 * 给 4 个 UI bug 提供可复现、可量化的证据。
 *
 * 用法：
 *   node preview/live-server.mjs [--port 0] [--draft test/sample.md] [--dsh-home <dir>]
 *
 *   --port <n>      监听端口，0 表示随机端口（默认 0）
 *   --draft <path>  启动时把该 Markdown 文件作为草稿种子，通过插件自己的 POST /dsh-doc/api/draft 写入
 *   --dsh-home <dir> DSH_HOME（插件持久化根目录），默认 mkdtemp 的临时目录，关闭后删除
 *
 * 安全：POST /dsh-doc/api/print 被替换成 dry-run 桩，返回
 *   { ok: true, jobId: "DRYRUN-1", queue: "dry-run", pages, sheets, dryRun: true }
 * 绝不会调用 lp / 真实打印机。其它 /dsh-doc/api/* 全部交给 lib/index.js 的真实 handler。
 *
 * 作为模块：
 *   import { startLiveServer } from "./preview/live-server.mjs";
 *   const { port, cleanup } = await startLiveServer({ draft: "test/sample.md" });
 *   ... ; await cleanup();
 *
 * 同一个进程内只建议跑一个实例（DSH_HOME 是进程级环境变量）。
 */
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { countPdfPagesFallback } from "../lib/core.js";
// lib/cdp.js 现在会常驻一个 headless Chrome（省 700ms 冷启动），关停时必须收掉，
// 否则它会在临时 DSH_HOME 被删之后继续往 chrome-profiles/ 写缓存，留下空目录。
import { shutdownCdp } from "../lib/cdp.js";
import { apply } from "../lib/index.js";

// fileURLToPath 对目录 URL 会带尾部斜杠，去掉后 startsWith(ROOT + sep) 的越界检查才正确。
const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/[\\/]+$/, "");
/** 与 lib/core.js 的 PREFIX 保持一致。 */
const API_PREFIX = "/dsh-doc/api";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".mjs": "application/javascript; charset=utf-8",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 把 `/dsh-doc/api/xxx` 归一化成 `xxx`；不属于本插件前缀时返回 null。
 * 与 lib/core.js 的 routeOf 语义一致。
 * @param {string} pathname
 * @returns {string|null}
 */
function apiRoute(pathname) {
  const normalized = pathname.replace(/\/+$/, "");
  if (normalized === API_PREFIX) return "";
  if (normalized.startsWith(`${API_PREFIX}/`)) return normalized.slice(API_PREFIX.length + 1);
  return null;
}

/**
 * 读完请求体（有上限，避免验证台被大包拖死）。
 * @param {import("node:http").IncomingMessage} req
 * @param {number} [maxBytes]
 */
function readBody(req, maxBytes = 8 * 1024 * 1024) {
  return new Promise((resolveBody) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total <= maxBytes) chunks.push(chunk);
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks)));
    req.on("error", () => resolveBody(Buffer.concat(chunks)));
  });
}

/** @param {import("node:http").ServerResponse} res */
function sendJson(res, status, body, extraHeaders = {}) {
  const payload = Buffer.from(JSON.stringify(body), "utf8");
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": payload.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  res.end(payload);
}

/**
 * 起一个带真实插件后端的 Live HTTP 服务。
 * @param {{ port?: number, draft?: string|null, dshHome?: string|null, quiet?: boolean }} [options]
 */
export async function startLiveServer(options = {}) {
  const { quiet = false } = options;
  const port = Number.isFinite(options.port) ? options.port : 0;
  const ownHome = !options.dshHome;
  const homeRoot = options.dshHome || mkdtempSync(join(tmpdir(), "dsh-doc-live-"));
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = homeRoot;

  const storageDir = join(homeRoot, "storages", "dsh-doc");
  mkdirSync(storageDir, { recursive: true, mode: 0o700 });

  const draftMarkdown = options.draft && existsSync(options.draft) ? readFileSync(options.draft, "utf8") : null;

  // ── 用最小 Cordis ctx 启动真实插件后端 ────────────────────────────────
  /** @type {any[]} */
  const routes = [];
  const logger = quiet
    ? { info() {}, warn() {}, error() {} }
    : {
        info: (...args) => console.log("[live-server]", ...args),
        warn: (...args) => console.warn("[live-server]", ...args),
        error: (...args) => console.error("[live-server]", ...args),
      };
  const ctx = {
    logger,
    effect: (fn) => fn(),
    webServer: { register: (route) => (routes.push(route), () => {}) },
    // 宿主网关在这里不做 Host/Origin 拦截；写操作仍然强制 application/json（见 requestAdmission）。
    connection: { requestRejection: () => undefined },
  };
  apply(ctx, {});
  const pluginHandler = routes[0]?.handler;
  if (typeof pluginHandler !== "function") {
    throw new Error("lib/index.js 没有注册 /dsh-doc/api 前缀路由");
  }

  /** 在处理的请求数：关停时等它们结束，避免打断一次 Chrome 渲染。 */
  let inflight = 0;
  /** @type {{ dryRuns: number, lastDryRun: any }} */
  const stats = { dryRuns: 0, lastDryRun: null };

  const server = createServer(async (req, res) => {
    inflight += 1;
    res.once("close", () => {
      inflight -= 1;
    });

    let pathname = "/";
    try {
      pathname = new URL(req.url ?? "/", `http://${req.headers.host || "127.0.0.1"}`).pathname;
    } catch {
      /* 非法 URL 一律当成 / 处理 */
    }

    try {
      // 1. live 页面
      if (
        pathname === "/preview/live" ||
        pathname === "/preview/live/" ||
        pathname === "/preview/live.html" ||
        pathname === "/live" ||
        pathname === "/live.html"
      ) {
        const liveHtml = join(ROOT, "preview", "live.html");
        if (existsSync(liveHtml)) {
          res.writeHead(200, { "content-type": MIME[".html"] });
          res.end(readFileSync(liveHtml));
          return;
        }
      }

      // 2. /dsh-doc/api/*：print 走 dry-run 桩，其余交给真实 handler
      const route = apiRoute(pathname);
      if (route !== null) {
        // 硬性安全要求：打印一律 dry-run，绝不调用 lp。
        if (route === "print") {
          const raw = await readBody(req, 64 * 1024);
          /** @type {any} */
          let body = {};
          try {
            body = JSON.parse(raw.toString("utf8") || "{}");
          } catch {
            body = {};
          }
          const id = typeof body.id === "string" ? body.id : "";
          let pages = Number.isFinite(Number(body.pages)) ? Number(body.pages) : 0;
          // 有真实 PDF 就按真实 PDF 数页（只是读文件，不会打印）
          if (id && /^[0-9a-f-]{36}$/i.test(id)) {
            const pdfPath = join(homeRoot, "storages", "dsh-doc", "work", `${id}.pdf`);
            if (existsSync(pdfPath)) {
              try {
                pages = countPdfPagesFallback(readFileSync(pdfPath));
              } catch {
                /* 保留 body.pages */
              }
            }
          }
          if (!pages) pages = 1;
          const duplex = String(body.duplex ?? "long");
          const sheets = duplex === "none" ? pages : Math.ceil(pages / 2);
          const payload = {
            ok: true,
            dryRun: true,
            jobId: "DRYRUN-1",
            queue: "dry-run",
            requestedQueue: typeof body.printer === "string" ? body.printer : null,
            id: id || null,
            title: typeof body.title === "string" ? body.title : "讲义",
            pages,
            sheets,
            duplex,
            submittedAt: Date.now(),
          };
          stats.dryRuns += 1;
          stats.lastDryRun = payload;
          sendJson(res, 200, payload);
          return;
        }
        await pluginHandler(req, res);
        return;
      }

      // 3. 静态文件：按 preview/server.mjs 的方式服务仓库根目录
      //    只允许仓库内的文件，挡掉 /../../ 之类的越界路径。
      let filePath = resolve(ROOT, `.${pathname}`);
      if (pathname === "/" || pathname === "/preview" || pathname === "/preview/") {
        filePath = join(ROOT, "preview", "index.html");
      }
      const insideRoot = filePath === ROOT || filePath.startsWith(`${ROOT}${sep}`);
      if (insideRoot && existsSync(filePath)) {
        const ext = extname(filePath).toLowerCase();
        res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream" });
        res.end(readFileSync(filePath));
        return;
      }

      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not Found");
    } catch (error) {
      if (!res.headersSent) {
        sendJson(res, 500, { ok: false, error: String(error?.message ?? error) });
      } else {
        try {
          res.end();
        } catch {
          /* 连接可能已断开 */
        }
      }
    }
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  const origin = `http://127.0.0.1:${actualPort}`;

  // ── 草稿种子：走插件自己的持久化（POST /dsh-doc/api/draft） ─────────────
  let seededDraft = null;
  if (draftMarkdown !== null) {
    try {
      const response = await fetch(`${origin}${API_PREFIX}/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown: draftMarkdown, html: "" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`);
      seededDraft = { source: API_PREFIX + "/draft", bytes: Buffer.byteLength(draftMarkdown, "utf8") };
    } catch (error) {
      // 兜底：直接写 draft.json（格式与 lib/index.js 的 saveDraft 一致）
      writeFileSync(
        join(storageDir, "draft.json"),
        JSON.stringify({ markdown: draftMarkdown, html: "", updatedAt: Date.now() }),
        "utf8",
      );
      seededDraft = { source: "draft.json-fallback", bytes: Buffer.byteLength(draftMarkdown, "utf8"), error: String(error?.message ?? error) };
    }
  }

  let closed = false;
  const cleanup = async () => {
    if (closed) return;
    closed = true;
    // 等正在跑的请求（可能是 lib 里一次 Chrome 渲染）跑完
    const deadline = Date.now() + 10_000;
    while (inflight > 0 && Date.now() < deadline) await sleep(50);
    // 收掉 lib/cdp.js 的常驻 Chrome：它握着 DSH_HOME 里的 chrome-profiles，
    // 不先杀掉就删目录，它会边删边写、留下空壳目录。
    try {
      await shutdownCdp();
    } catch (error) {
      console.warn(`[live-server] 关闭常驻 Chrome 失败（忽略）：${error?.message ?? error}`);
    }
    // 断开所有 keep-alive 连接，否则 server.close 会一直等
    server.closeAllConnections?.();
    await new Promise((resolveClose) => server.close(() => resolveClose()));
    if (ownHome) {
      // Chrome 被杀后文件句柄可能还没释放，第一次删不掉就稍等再删
      let lastError = null;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          rmSync(homeRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
          lastError = null;
        } catch (error) {
          lastError = error;
        }
        if (!existsSync(homeRoot)) break;
        await sleep(250);
      }
      if (existsSync(homeRoot)) {
        console.warn(`[live-server] 临时 DSH_HOME 未能删除（不影响使用）：${homeRoot}${lastError ? ` (${lastError.message})` : ""}`);
      }
    }
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
  };

  return {
    server,
    port: actualPort,
    origin,
    url: `${origin}/preview/live`,
    dshHome: homeRoot,
    seededDraft,
    stats,
    cleanup,
  };
}

/* ────────────────────────────── CLI ────────────────────────────── */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  let port = 0;
  let draft = null;
  let dshHome = null;

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = argv[i + 1];
    if (flag === "--port" && next) {
      port = Number.parseInt(next, 10) || 0;
      i += 1;
    } else if (flag === "--draft" && next) {
      draft = resolve(process.cwd(), next);
      i += 1;
    } else if (flag === "--dsh-home" && next) {
      dshHome = resolve(process.cwd(), next);
      i += 1;
    } else if (flag === "--help" || flag === "-h") {
      console.log("用法: node preview/live-server.mjs [--port 0] [--draft test/sample.md] [--dsh-home <dir>]");
      process.exit(0);
    }
  }

  if (draft && !existsSync(draft)) {
    console.error(`找不到草稿文件: ${draft}`);
    process.exit(1);
  }

  const { port: actualPort, dshHome: home, url, cleanup } = await startLiveServer({ port, draft, dshHome });
  console.log(`Live preview server: ${url}`);
  console.log(`  port: ${actualPort}`);
  console.log(`  DSH_HOME: ${home}`);
  console.log("  POST /dsh-doc/api/print 已替换为 dry-run（不会真的打印）");

  let stopping = false;
  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    console.log(`\n${signal}: 关闭 Live server…`);
    await cleanup();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
