/**
 * 打印工坊（dsh-doc）：宿主侧入口。
 *
 * 只做三件事：解析路由、调用 core 里的纯函数、把子进程结果整理成 JSON。
 * 所有重活（探测/渲染/投递）都在 core 与下面的 runner 里，便于单测。
 */
import { execFile } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { printWithPageNumbers, shutdownCdp } from "./cdp.js";
import { getFontAliases, getSystemFonts } from "./fonts.js";
import {
  LIMITS,
  NS,
  PREFIX,
  buildOptionArgs,
  countPdfPagesFallback,
  normalizeColor,
  normalizeDuplex,
  normalizeMedia,
  parseLpJobId,
  parseLpoptions,
  parseLpstatDevices,
  parseLpstatPrinters,
  parsePdfInfo,
  parsePrinterState,
  planOptionMapping,
  renderMarkdown,
  requestAdmission,
  resolveDocumentTitle,
  resolveJobState,
  resolveTemplate,
  routeOf,
  sanitizeText,
  TEMPLATE_LIMITS,
  listTemplates,
  localizeGuards,
  applyStyleOverride,
  mergeBuiltinOverride,
  normalizeDraft,
  sanitizeBodyHtml,
  normalizeLocale,
  normalizeTemplate,
  parseTemplatesFile,
  serializeTemplates,
  TEMPLATES,
  sheetPlan,
  splitLeadingTitle,
  wrapPrintHtml,
} from "./core.js";

export const inject = ["webServer", "connection"];

const TOOL_NAME = "print_handout";

const TOOL_DESCRIPTION = `Render text or Markdown into a print-ready A4 PDF and, when asked, send it to a LAN printer.

Layout is detected automatically: classical Chinese poems (short lines with punctuation) are centered line by line with the title and author extracted; "numbered question + following A/B answers" blocks are locked together so pagination never splits them; everything else flows as paragraphs.

Actions:
- printers: list print queues with duplex/colour capability and the system default (read-only).
- render: render the PDF and return page count, sheet count and layout guards; does NOT print.
- print: actually prints, which is irreversible; reuse a previous render via id, or render inline via markdown.
- status: query a submitted job (processing / completed / unknown).

Recommended flow: render first, check pages and guards, then print.`;

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];

const DEFAULTS = Object.freeze({
  duplex: "long",
  color: "gray",
  media: "A4",
  copies: 1,
  keepRenders: 20,
});

/**
 * 预览图参数。
 *
 * 为什么不用 core 的 LIMITS.previewDpi（180dpi）：A4 一页 180dpi 的 PNG 约 380KB，
 * base64 后单页 517KB，两三页预览的 JSON 就超过 1MB，前端解析和贴图都慢。
 * 144dpi 已经比预览面板、放大镜实际需要的像素多，再按最长边 1400px 封顶
 * （A4 约 992×1403），单页 PNG 降到约 230KB，体积降四成，版式照样看得清。
 */
const PREVIEW_DPI = 144;
const PREVIEW_MAX_EDGE = 1400;

/** 内容寻址缓存留几份产物：一份约 0.5–1MB（PDF + 中间 HTML + 预览图），磁盘占用可控。 */
const RENDER_CACHE_LIMIT = 12;

/**
 * 跑一个子进程，永不抛异常，把结果摊平成 {code, stdout, stderr}。
 * @param {string} command
 * @param {string[]} args
 * @param {number} [timeoutMs]
 * @param {import("node:child_process").ExecFileOptionsWithStringEncoding} [extra]
 */
function run(command, args, timeoutMs = LIMITS.commandTimeoutMs, extra = {}) {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, encoding: "utf8", ...extra },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === "number" ? error.code : 127) : 0;
        resolve({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), error });
      },
    );
  });
}

/** @param {unknown} config */
function normalizeConfig(config) {
  const input = config && typeof config === "object" ? config : {};
  return {
    duplex: normalizeDuplex(input.duplex ?? DEFAULTS.duplex),
    color: normalizeColor(input.color ?? DEFAULTS.color),
    media: normalizeMedia(input.media ?? DEFAULTS.media),
    copies: clampCopies(input.copies),
    chromePath: typeof input.chromePath === "string" && input.chromePath ? input.chromePath : null,
  };
}

/** @param {unknown} value */
function clampCopies(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULTS.copies;
  return Math.min(LIMITS.copies, Math.max(1, Math.trunc(n)));
}

/**
 * @param {import("node:http").ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
function json(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body), "utf8");
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": payload.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  res.end(payload);
}

/**
 * 读取并限制请求体大小。
 * @param {import("node:http").IncomingMessage} req
 * @param {number} maxBytes
 */
function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!total) return resolve({});
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        resolve(parsed && typeof parsed === "object" ? parsed : {});
      } catch {
        reject(new Error("请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

/** 把工具结果压成一句话，供聊天卡片展示。 */
function summarizeToolResult(value) {
  if (!value || value.ok !== true) return "Handout operation failed";
  if (value.action === "printers") {
    return `Found ${value.printers?.length ?? 0} printer(s); default: ${value.defaultQueue ?? "none"}`;
  }
  if (value.action === "render") {
    return `Rendered ${value.pages} page(s) · ${value.sheets} sheet(s)${value.pageNumbers ? " · with page numbers" : ""}`;
  }
  if (value.action === "print") {
    return `Submitted: ${value.queue ?? ""} ${value.jobId ?? ""} (${value.pages} pages / ${value.sheets} sheets)`.trim();
  }
  if (value.action === "status") {
    return `Job ${value.jobId}: ${value.state}`;
  }
  return "Handout operation finished";
}

export function apply(ctx, config) {
  const settings = normalizeConfig(config);
  const logger = ctx.logger ?? console;
  const homeRoot = process.env.DSH_HOME || join(homedir(), ".dsh");
  const workDir = join(homeRoot, "storages", NS, "work");
  /**
   * 每个宿主进程用独立的 Chrome profile 目录。
   *
   * 为什么不再共用一份：Chrome 会锁住 user-data-dir，宿主被 SIGKILL 硬崩后留下的
   * 那个 headless 进程会长期占着锁，之后每次渲染都会失败（连 CLI 回落都起不来），
   * 只能手动杀进程。按 pid 分目录后，残留的最多是几个可以随手删的旧目录。
   */
  const chromeProfileRoot = join(homeRoot, "storages", NS, "chrome-profiles");
  const chromeProfile = join(chromeProfileRoot, `p${process.pid}`);

  const templatesFile = join(homeRoot, "storages", NS, "templates.json");
  const draftFile = join(homeRoot, "storages", NS, "draft.json");
  /** 自定义版式模板（不含内置）；持久化到 storages。 */
  let customTemplates = loadTemplates();
  /** 内置模板的覆盖项：id → 完整模板。 */
  let builtinOverrides = {};

  /** 渲染产物缓存：id → 元信息。重启后按磁盘文件重建即可，内存只是加速。 */
  const renders = new Map();
  /**
   * 内容寻址缓存：内容 hash → 产物元信息（PDF、中间 HTML、预览 PNG 都在 renderCacheDir）。
   * 为什么需要：预览面板改一下再点一次渲染，内容没变也重跑一遍 Chrome + poppler
   * 要 1.5s；命中缓存只剩复制文件 + 读图，20ms 上下。
   */
  const renderCache = new Map();
  /**
   * 正在渲染的内容。同一份内容被并发请求时后来者直接等这一次的结果：
   * 前端连点不会把同一条流水线跑两遍，也不会两次渲染同时往同一个缓存文件里写。
   */
  const inflightRenders = new Map();
  /** 缓存产物目录：独立于 work 目录，pruneRenders 不扫这里，由缓存自己按 LRU 回收。 */
  const renderCacheDir = join(workDir, "cache");
  let renderCacheReady = false;
  /** 每个进程只做一次：清理过期 profile 目录并确保自己的目录存在。 */
  let chromeProfileReady = false;
  /** 打印机能力表缓存，5 秒内不重复问 CUPS。 */
  let printerCache = { at: 0, value: null };

  function ensureDir(dir) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
  }

  /** 读取上次的草稿；文件缺失或损坏时返回 null。 */
  function loadDraft() {
    try {
      if (!existsSync(draftFile)) return null;
      return normalizeDraft(JSON.parse(readFileSync(draftFile, "utf8")));
    } catch (error) {
      logger?.warn?.(`${NS}: 草稿读取失败（忽略）：${error?.message ?? error}`);
      return null;
    }
  }

  /** 原子写入草稿。 */
  function saveDraft(markdown, html = "") {
    try {
      ensureDir(join(homeRoot, "storages", NS));
      const tmp = `${draftFile}.tmp`;
      writeFileSync(tmp, JSON.stringify({ markdown, html, updatedAt: Date.now() }), "utf8");
      renameSync(tmp, draftFile);
    } catch (error) {
      logger?.warn?.(`${NS}: 草稿保存失败：${error?.message ?? error}`);
      throw Object.assign(new Error("Failed to save draft"), { code: "save-failed" });
    }
  }

  /** 读取自定义模板；文件缺失或损坏时回落到空列表，不阻断插件启动。 */
  function loadTemplates() {
    try {
      if (!existsSync(templatesFile)) return [];
      const parsed = parseTemplatesFile(JSON.parse(readFileSync(templatesFile, "utf8")));
      builtinOverrides = parsed.builtinOverrides ?? {};
      return parsed;
    } catch (error) {
      logger?.warn?.(`${NS}: 自定义模板读取失败（忽略）：${error?.message ?? error}`);
      return [];
    }
  }

  /** 原子写入：先写临时文件再改名，避免半截 JSON。 */
  function saveTemplates() {
    try {
      ensureDir(join(homeRoot, "storages", NS));
      const tmp = `${templatesFile}.tmp`;
      writeFileSync(tmp, serializeTemplates(customTemplates, builtinOverrides), "utf8");
      renameSync(tmp, templatesFile);
    } catch (error) {
      logger?.warn?.(`${NS}: 自定义模板保存失败：${error?.message ?? error}`);
      throw Object.assign(new Error("Failed to save template"), { code: "save-failed" });
    }
  }

  /* ---------------- 打印机 ---------------- */

  async function probePrinters() {
    if (printerCache.value && Date.now() - printerCache.at < 5000) return printerCache.value;

    const [p, v] = await Promise.all([run("lpstat", ["-p", "-d"]), run("lpstat", ["-v"])]);
    const { queues, defaultQueue } = parseLpstatPrinters(p.stdout);
    const devices = parseLpstatDevices(v.stdout);

    /** @type {any[]} */
    const printers = [];
    for (const queue of queues) {
      const [detail, options] = await Promise.all([
        run("lpstat", ["-p", queue, "-l"]),
        run("lpoptions", ["-p", queue, "-l"]),
      ]);
      const state = parsePrinterState(detail.stdout);
      const caps = parseLpoptions(options.stdout);
      const mapping = planOptionMapping(caps);
      printers.push({
        queue,
        uri: devices[queue] ?? null,
        state: state.state,
        detail: state.detail,
        isDefault: queue === defaultQueue,
        capabilities: {
          duplex: Boolean(mapping.duplex),
          color: Boolean(mapping.color),
          media: Boolean(mapping.media),
          labels: {
            duplex: mapping.duplex ? mapping.duplex.friendly ?? null : null,
          },
          // 原始关键字是最有价值的调试信息，UI 折叠展示
          raw: {
            duplex: mapping.duplex?.key ?? null,
            media: mapping.media?.key ?? null,
            color: mapping.color?.key ?? null,
          },
        },
      });
    }

    const chrome = findChrome();
    const value = {
      printers,
      defaultQueue,
      chrome: chrome ? { path: chrome, available: true } : { path: null, available: false },
      lpstatError: p.stdout ? null : p.stderr.trim() || "lpstat 无输出",
    };
    printerCache = { at: Date.now(), value };
    return value;
  }

  function findChrome() {
    if (settings.chromePath && existsSync(settings.chromePath)) return settings.chromePath;
    for (const candidate of CHROME_CANDIDATES) {
      if (existsSync(candidate)) return candidate;
    }
    const envPath = process.env.DSH_DOC_CHROME;
    if (envPath && existsSync(envPath)) return envPath;
    return null;
  }

  /* ---------------- 渲染 ---------------- */

  async function pdfInfo(pdfPath) {
    const info = await run("pdfinfo", [pdfPath], 8000);
    if (info.code === 0 && /^Pages:/im.test(info.stdout)) {
      return parsePdfInfo(info.stdout);
    }
    // 没有 poppler 时退回到字节扫描，至少能拿到页数
    const pages = countPdfPagesFallback(readFileSync(pdfPath));
    return { pages, size: "未知（缺 pdfinfo）", isA4: true };
  }

  /** 文件字节数；文件不在时返回 -1，省掉调用方到处 try。 */
  function fileSize(file) {
    try {
      return statSync(file).size;
    } catch {
      return -1;
    }
  }

  /** 只读开头 5 个字节判断 PDF 签名，避免为了一个签名把整份 PDF 读进内存。 */
  function hasPdfSignature(pdfPath) {
    let fd = null;
    try {
      fd = openSync(pdfPath, "r");
      const head = Buffer.alloc(5);
      readSync(fd, head, 0, 5, 0);
      return head.toString("latin1") === "%PDF-";
    } catch {
      return false;
    } finally {
      if (fd !== null) {
        try {
          closeSync(fd);
        } catch {
          /* 已关闭 */
        }
      }
    }
  }

  /**
   * 渲染一页预览 PNG，直接落在缓存目录里（缓存命中时不用重新出图）。
   *
   * 为什么一页一个 pdftoppm 进程：它是单线程的，两页串行约 490ms，
   * 拆成两个进程并行约 300ms；页数最多 previewPages，进程数有上限。
   * @returns {Promise<{page: number, file: string} | null>} 出图失败或过大时返回 null（少一张预览，不影响 PDF）
   */
  async function previewPage(pdfPath, hash, page) {
    const prefix = join(renderCacheDir, `${hash}-p${page}`);
    const pp = await run(
      "pdftoppm",
      [
        "-png",
        "-r",
        String(PREVIEW_DPI),
        // 按最长边封顶：超长页不会把 PNG（以及塞进 JSON 的 base64）撑大
        "-scale-to",
        String(PREVIEW_MAX_EDGE),
        "-f",
        String(page),
        "-l",
        String(page),
        pdfPath,
        prefix,
      ],
      20000,
    );
    if (pp.code !== 0) return null;
    // pdftoppm 的页码位数跟着总页数走（1 / 01 / 001 / 0001），几种都试一遍
    for (let width = 1; width <= 4; width += 1) {
      const file = `${prefix}-${String(page).padStart(width, "0")}.png`;
      if (!existsSync(file)) continue;
      // 过大的图会直接把 JSON 撑爆，宁可少一张预览
      if (fileSize(file) > LIMITS.maxPreviewBytes) return null;
      return { page, file };
    }
    return null;
  }

  /** @returns {Promise<Array<{page: number, file: string}>>} */
  async function makePreviews(pdfPath, hash, pages) {
    const limit = Math.min(pages, LIMITS.previewPages);
    if (!limit) return [];
    const pagesToRender = [];
    for (let page = 1; page <= limit; page += 1) pagesToRender.push(previewPage(pdfPath, hash, page));
    return (await Promise.all(pagesToRender)).filter(Boolean);
  }

  /**
   * 缓存目录初始化。
   *
   * 缓存索引只在内存里，进程重启后旧文件没人再引用，第一次渲染时清掉，
   * 免得磁盘上一直堆着用不到的历史产物。
   */
  function ensureRenderCache() {
    if (renderCacheReady) return;
    renderCacheReady = true;
    try {
      ensureDir(renderCacheDir);
      for (const file of readdirSync(renderCacheDir)) rmSync(join(renderCacheDir, file), { force: true });
    } catch (error) {
      logger?.warn?.(`${NS}: 渲染缓存目录不可用（本次渲染会失败）：${error?.message ?? error}`);
    }
  }

  /** 一个缓存条目占的磁盘文件：PDF、中间 HTML、预览 PNG。 */
  function cacheFilesOf(entry) {
    return [entry.pdfPath, entry.htmlPath, ...entry.previews.map((preview) => preview.file)];
  }

  function forgetRender(hash) {
    const entry = renderCache.get(hash);
    if (!entry) return;
    renderCache.delete(hash);
    for (const file of cacheFilesOf(entry)) rmSync(file, { force: true });
  }

  /** 记入缓存；超过上限时淘汰最久没用的那一份（Map 的插入顺序就是 LRU 顺序）。 */
  function rememberRender(hash, entry) {
    renderCache.set(hash, entry);
    while (renderCache.size > RENDER_CACHE_LIMIT) {
      const oldest = renderCache.keys().next().value;
      // 理论上淘汰不到刚放进去的这份，保底防止死循环
      if (oldest === hash) break;
      forgetRender(oldest);
    }
  }

  /**
   * 查缓存。文件缺了（被系统清理、上次写到一半）就当没命中，老实重渲，
   * 绝不把半截 PDF 当正常结果返回。
   */
  function readRenderCache(hash) {
    const entry = renderCache.get(hash);
    if (!entry) return null;
    const usable =
      fileSize(entry.pdfPath) >= 800 &&
      fileSize(entry.htmlPath) >= 0 &&
      entry.previews.every((preview) => fileSize(preview.file) > 0);
    if (!usable) {
      forgetRender(hash);
      return null;
    }
    // 命中后挪到队尾：下次淘汰的是更久没用的
    renderCache.delete(hash);
    renderCache.set(hash, entry);
    return entry;
  }

  /**
   * 真正跑一遍渲染，产物留在缓存目录里（按内容 hash 命名）。
   * @param {{chrome: string, title: string, template: any}} context
   */
  async function renderFresh(hash, html, context) {
    const { chrome, title, template } = context;
    const pdfPath = join(renderCacheDir, `${hash}.pdf`);
    const htmlPath = join(renderCacheDir, `${hash}.html`);
    writeFileSync(htmlPath, html, "utf8");
    ensureRenderCache();
    if (!chromeProfileReady) {
      chromeProfileReady = true;
      pruneStaleProfiles();
      ensureDir(chromeProfile);
    }

    // 首选 CDP：能画出真实页码。失败再退回 CLI，宁可不带页码也不要渲染不出来。
    let pageNumbers = false;
    let cdpError = null;
    try {
      await printWithPageNumbers({
        chromePath: chrome,
        htmlPath,
        pdfPath,
        userDataDir: chromeProfile,
        timeoutMs: LIMITS.chromeTimeoutMs,
        margin: template.margin,
      });
      pageNumbers = true;
    } catch (error) {
      cdpError = error;
      logger?.warn?.(`${NS}: CDP 打印失败，退回 CLI（无页码）：${error?.message ?? error}`);
      // cdp.js 失败时会先收掉常驻浏览器，CLI 才能用同一个 profile 重新启动
      const printed = await run(
        chrome,
        [
          "--headless=new",
          "--disable-gpu",
          // 与 cdp.js 的启动参数保持一致：少了它这台机器上 GPU 进程会直接崩，CLI 回退拿不到 PDF
          "--no-sandbox",
          "--no-first-run",
          "--no-default-browser-check",
          "--no-pdf-header-footer",
          `--user-data-dir=${chromeProfile}`,
          `--print-to-pdf=${pdfPath}`,
          pathToFileURL(htmlPath).href,
        ],
        LIMITS.chromeTimeoutMs,
      );

      if (fileSize(pdfPath) < 800) {
        throw Object.assign(
          new Error(`Rendering failed: ${printed.stderr.trim().slice(-240) || "no PDF produced"}`),
          { code: "render-failed" },
        );
      }
    }

    if (fileSize(pdfPath) < 800) {
      throw Object.assign(
        new Error(`Rendering failed: ${cdpError?.message ?? "no PDF produced"}`),
        { code: "render-failed" },
      );
    }
    if (!hasPdfSignature(pdfPath)) {
      throw Object.assign(new Error("Rendered output is not a valid PDF"), { code: "not-pdf" });
    }

    // pdfinfo 要先跑：预览只出真正存在的前几页，不必为空白页白起进程
    const info = await pdfInfo(pdfPath);
    const previews = await makePreviews(pdfPath, hash, info.pages);

    const entry = {
      title,
      pages: info.pages,
      pageSize: info.size,
      isA4: info.isA4,
      pageNumbers,
      pdfPath,
      htmlPath,
      previews,
    };
    rememberRender(hash, entry);
    return entry;
  }

  /**
   * 同一份内容的渲染只跑一次：后来的并发请求等这一次的结果，而不是重跑一遍流水线。
   * 失败时所有等待者拿到同一个错误，错误码语义与单请求一致。
   */
  async function produceRender(hash, html, context) {
    const running = inflightRenders.get(hash);
    if (running) return running;
    const task = renderFresh(hash, html, context);
    inflightRenders.set(hash, task);
    try {
      return await task;
    } finally {
      if (inflightRenders.get(hash) === task) inflightRenders.delete(hash);
    }
  }

  /**
   * 把缓存产物落成一次「新的渲染」。
   *
   * 为什么还要复制：缓存按内容命名，但对外每次渲染都要新 id、新的 `<id>.pdf`
   * ——打印接口按 id 找文件，清理逻辑也按 id 归组，复用不能打破这两个约定。
   */
  function materializeRender(entry, template, locale) {
    const id = randomUUID();
    const pdfPath = join(workDir, `${id}.pdf`);
    // 中间 HTML 也留一份：出问题时可以直接看交给 Chrome 的排版
    writeFileSync(join(workDir, `${id}.html`), readFileSync(entry.htmlPath, "utf8"), "utf8");
    copyFileSync(entry.pdfPath, pdfPath);
    const previews = entry.previews.map((preview) => ({
      page: preview.page,
      dataUrl: `data:image/png;base64,${readFileSync(preview.file).toString("base64")}`,
    }));

    const plan = sheetPlan({ pages: entry.pages, duplex: settings.duplex, isA4: entry.isA4 });
    plan.guards.push(
      entry.pageNumbers
        ? { level: "ok", code: "guard.pageNumbers", params: { pages: entry.pages } }
        : { level: "warn", code: "guard.pageNumbersMissing" },
    );

    const record = {
      id,
      title: entry.title,
      template: template.id,
      pages: entry.pages,
      pageSize: entry.pageSize,
      isA4: entry.isA4,
      pageNumbers: entry.pageNumbers,
      pdfPath,
      createdAt: Date.now(),
    };
    renders.set(id, record);
    pruneRenders();

    return {
      ...record,
      pdfPath: undefined,
      sheets: plan.sheets,
      duplex: plan.duplex,
      guards: localizeGuards(plan.guards, locale),
      guardCodes: plan.guards,
      previews,
    };
  }

  async function renderDocument(input) {
    const locale = normalizeLocale(input.locale);
    const chrome = findChrome();
    if (!chrome) {
      throw Object.assign(new Error("Chrome/Chromium not found; cannot render the handout to PDF"), { code: "no-chrome" });
    }
    const baseTemplate = resolveTemplate(input.template, customTemplates, builtinOverrides);
    // style 是面板上的临时调整（未保存），只影响这一次渲染
    const template = applyStyleOverride(input.style, baseTemplate);
    const markdown = String(input.markdown ?? "");
    // 富文本编辑器直接给 HTML：走直通路径，屏幕上的对齐/标题/列表原样进 PDF
    const richHtml = sanitizeBodyHtml(input.html);
    if (!richHtml && !markdown.trim()) {
      throw Object.assign(new Error("Content is empty; write something to lay out first"), { code: "empty" });
    }
    const payloadBytes = Buffer.byteLength(richHtml || markdown, "utf8");
    if (payloadBytes > LIMITS.markdownBytes) {
      throw Object.assign(new Error("Content exceeds 400KB; split it into several handouts"), { code: "too-large" });
    }

    ensureDir(workDir);
    // 文首 `# 标题` 优先于模板标题；抽走后正文不再重复渲染一遍标题
    const leading = richHtml ? { title: null, body: "" } : splitLeadingTitle(markdown);
    const bodyHtml = richHtml || renderMarkdown(leading.body);
    const title = resolveDocumentTitle({
      explicitTitle: sanitizeText(input.title) || leading.title,
      bodyHtml,
      templateTitle: template.title,
    });
    const html = wrapPrintHtml({
      title,
      subtitle: template.subtitle,
      bodyHtml,
      accent: template.accent,
      fontSize: template.fontSize,
      lineHeight: template.lineHeight,
      margin: template.margin,
      columns: template.columns,
      font: template.font,
    });

    // 缓存键取最终 HTML 的 hash：标题、正文、模板样式、页边距全在里面，
    // 任何一项变化都会换键，不会出现「改了字号却拿到旧排版」。
    const hash = createHash("sha256").update(html).digest("hex").slice(0, 32);
    ensureRenderCache();

    const entry = readRenderCache(hash) ?? (await produceRender(hash, html, { chrome, title, template }));
    return materializeRender(entry, template, locale);
  }

  function pruneRenders() {
    try {
      const files = readdirSync(workDir);
      /** @type {Map<string, {pdf?: string, html?: string, age: number}>} */
      const groups = new Map();
      for (const file of files) {
        const m = /^([0-9a-f-]{36})(?:\.(html|pdf)|-p-\d+\.png)$/i.exec(file);
        if (!m) continue;
        const entry = groups.get(m[1]) ?? { age: 0 };
        if (m[2] === "pdf") entry.pdf = file;
        if (m[2] === "html") entry.html = file;
        const full = join(workDir, file);
        try {
          entry.age = Math.max(entry.age, statSync(full).mtimeMs);
        } catch {
          /* 文件刚被删掉，忽略 */
        }
        groups.set(m[1], entry);
      }
      const ordered = [...groups.entries()].sort((a, b) => b[1].age - a[1].age);
      for (const [id, entry] of ordered.slice(DEFAULTS.keepRenders)) {
        if (entry.pdf) rmSync(join(workDir, entry.pdf), { force: true });
        if (entry.html) rmSync(join(workDir, entry.html), { force: true });
        renders.delete(id);
        for (const file of readdirSync(workDir)) {
          if (file.startsWith(`${id}-p-`)) rmSync(join(workDir, file), { force: true });
        }
      }
    } catch (error) {
      logger?.warn?.(`${NS}: 清理旧渲染失败（忽略）：${error?.message ?? error}`);
    }
  }

  /* ---------------- 打印 ---------------- */

  async function submitPrint(input) {
    const id = String(input.id ?? "");
    const pdfPath = join(workDir, `${id}.pdf`);
    const known = renders.get(id) ?? (existsSync(pdfPath) ? { id, pages: 0, pdfPath } : null);
    if (!known || !existsSync(pdfPath)) {
      throw Object.assign(new Error("No rendered PDF for this handout; render it first"), { code: "no-render" });
    }

    const probed = await probePrinters();
    const queue = String(input.printer ?? "").trim() || probed.defaultQueue;
    if (!queue) {
      throw Object.assign(new Error("No printer queue available"), { code: "no-printer" });
    }
    const printer = probed.printers.find((item) => item.queue === queue);
    if (!printer) {
      throw Object.assign(new Error(`Unknown print queue: ${queue}`), { code: "unknown-printer" });
    }
    if (printer.state === "disabled") {
      throw Object.assign(new Error(`Printer ${queue} is disabled`), { code: "printer-disabled" });
    }

    const options = await run("lpoptions", ["-p", queue, "-l"]);
    const mapping = planOptionMapping(parseLpoptions(options.stdout));
    const wanted = {
      duplex: input.duplex ?? settings.duplex,
      media: input.media ?? settings.media,
      color: input.color ?? settings.color,
    };
    const { args, applied, skipped } = buildOptionArgs(mapping, wanted);

    const copies = clampCopies(input.copies ?? settings.copies);
    const title = sanitizeText(input.title) || "讲义";
    const lpArgs = ["-d", queue, "-t", title, "-n", String(copies), ...args, pdfPath];
    const submitted = await run("lp", lpArgs, 15000);

    if (submitted.code !== 0) {
      throw Object.assign(new Error(submitted.stderr.trim() || submitted.stdout.trim() || "lp 提交失败"), {
        code: "lp-failed",
      });
    }
    const { jobId } = parseLpJobId(submitted.stdout);
    const pages = known.pages || (await pdfInfo(pdfPath)).pages;
    const plan = sheetPlan({ pages, duplex: wanted.duplex, isA4: true });

    logger?.info?.(`${NS}: 已提交打印 ${jobId ?? "(无 id)"} → ${queue} ${JSON.stringify(applied)}`);

    return {
      jobId,
      queue,
      title,
      copies,
      applied,
      skipped,
      pages,
      sheets: plan.sheets,
      duplex: plan.duplex,
      submittedAt: Date.now(),
    };
  }

  async function jobStatus(queue, jobId) {
    const [active, completed] = await Promise.all([
      run("lpstat", ["-o", queue]),
      run("lpstat", ["-W", "completed", "-o", queue]),
    ]);
    return resolveJobState({ active: active.stdout, completed: completed.stdout, jobId });
  }

  /* ---------------- 路由 ---------------- */

  async function handle(route, req, res) {
    const method = (req.method || "GET").toUpperCase();

    if ((route === "" || route === "status") && method === "GET") {
      const [probed, systemFonts, fontAliases] = await Promise.all([
        probePrinters(),
        getSystemFonts(),
        getFontAliases(),
      ]);
      const recent = [...renders.values()]
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 5)
        .map(({ pdfPath, ...rest }) => rest);
      json(res, 200, {
        ok: true,
        printers: probed.printers,
        defaultQueue: probed.defaultQueue,
        chrome: probed.chrome,
        defaults: { duplex: settings.duplex, color: settings.color, media: settings.media, copies: settings.copies },
        templates: listTemplates(customTemplates, builtinOverrides),
        draft: loadDraft(),
        recent,
        systemFonts,
        fontAliases,
      });
      return;
    }

    if (route === "fonts" && method === "GET") {
      const [fonts, aliases] = await Promise.all([getSystemFonts(), getFontAliases()]);
      json(res, 200, { ok: true, fonts, aliases });
      return;
    }

    if (route === "render" && method === "POST") {
      const body = await readJsonBody(req, LIMITS.markdownBytes + 16 * 1024);
      const result = await renderDocument({
        markdown: body.markdown,
        html: body.html,
        template: body.template,
        title: body.title,
        locale: body.locale,
        style: body.style,
      });
      json(res, 200, { ok: true, ...result });
      return;
    }

    if (route === "print" && method === "POST") {
      const body = await readJsonBody(req, 32 * 1024);
      const result = await submitPrint({ ...body, locale: body.locale });
      json(res, 200, { ok: true, ...result });
      return;
    }

    if (route === "draft" && method === "POST") {
      const body = await readJsonBody(req, LIMITS.draftBytes * 2 + 16 * 1024);
      const markdown = typeof body.markdown === "string" ? body.markdown : "";
      const html = typeof body.html === "string" ? body.html.slice(0, LIMITS.draftBytes) : "";
      if (Buffer.byteLength(markdown, "utf8") > LIMITS.draftBytes || Buffer.byteLength(html, "utf8") > LIMITS.draftBytes) {
        json(res, 413, { ok: false, error: "Draft exceeds 400KB" });
        return;
      }
      saveDraft(markdown, html);
      json(res, 200, { ok: true, savedAt: Date.now() });
      return;
    }

    if (route === "templates" && method === "POST") {
      const body = await readJsonBody(req, 16 * 1024);
      const action = String(body.action ?? "create");

      if (action === "delete") {
        const id = String(body.id ?? "");
        const next = customTemplates.filter((item) => item.id !== id);
        if (next.length === customTemplates.length) {
          json(res, 404, { ok: false, error: "Template not found" });
          return;
        }
        customTemplates = next;
        saveTemplates();
        json(res, 200, { ok: true, templates: listTemplates(customTemplates, builtinOverrides) });
        return;
      }

      if (action === "update") {
        const id = String(body.id ?? "").toLowerCase();

        // 内置模板的改动存成覆盖项，而不是另建一个副本
        if (Object.prototype.hasOwnProperty.call(TEMPLATES, id)) {
          const template = mergeBuiltinOverride(id, body.template);
          builtinOverrides = { ...builtinOverrides, [id]: template };
          saveTemplates();
          json(res, 200, {
            ok: true,
            template,
            templates: listTemplates(customTemplates, builtinOverrides),
          });
          return;
        }

        const index = customTemplates.findIndex((item) => item.id === id);
        if (index < 0) {
          json(res, 404, { ok: false, error: "Template not found" });
          return;
        }
        const template = normalizeTemplate(body.template, { id, builtIn: false });
        customTemplates = customTemplates.map((item, i) => (i === index ? template : item));
        saveTemplates();
        json(res, 200, { ok: true, template, templates: listTemplates(customTemplates, builtinOverrides) });
        return;
      }

      if (action === "reset") {
        const id = String(body.id ?? "").toLowerCase();
        if (!Object.prototype.hasOwnProperty.call(TEMPLATES, id)) {
          json(res, 400, { ok: false, error: "Only built-in templates can be reset" });
          return;
        }
        const next = { ...builtinOverrides };
        delete next[id];
        builtinOverrides = next;
        saveTemplates();
        json(res, 200, { ok: true, templates: listTemplates(customTemplates, builtinOverrides) });
        return;
      }

      if (action === "create") {
        if (customTemplates.length >= TEMPLATE_LIMITS.max) {
          json(res, 400, { ok: false, error: `At most ${TEMPLATE_LIMITS.max} custom templates` });
          return;
        }
        const id = `tpl-${randomUUID().replace(/-/g, "").slice(0, 8)}`;
        const template = normalizeTemplate(body.template, { id, builtIn: false });
        customTemplates = [...customTemplates, template];
        saveTemplates();
        json(res, 200, { ok: true, template, templates: listTemplates(customTemplates, builtinOverrides) });
        return;
      }

      json(res, 400, { ok: false, error: "Unknown template action" });
      return;
    }

    if (route === "job" && method === "GET") {
      const url = new URL(req.url ?? "/", "http://localhost");
      const queue = String(url.searchParams.get("queue") ?? "");
      const jobId = String(url.searchParams.get("id") ?? "");
      if (!queue || !jobId) {
        json(res, 400, { ok: false, error: "queue and id are required" });
        return;
      }
      json(res, 200, { ok: true, state: await jobStatus(queue, jobId) });
      return;
    }

    json(res, 404, { ok: false, error: "not-found" });
  }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "prefix",
        path: PREFIX,
        handler: async (req, res) => {
          const admission = requestAdmission(ctx.connection, req);
          if (!admission.ok) {
            json(res, admission.status, { ok: false, error: admission.reason });
            return;
          }
          const route = routeOf(req.url);
          if (route === null) {
            json(res, 404, { ok: false, error: "not-found" });
            return;
          }
          try {
            await handle(route, req, res);
          } catch (error) {
            const status = error && error.code === "too-large" ? 413 : 400;
            logger?.warn?.(`${NS}: ${route} 失败：${error?.message ?? error}`);
            json(res, status, { ok: false, error: String(error?.message ?? error) });
          }
        },
      }),
    `${NS}: ${PREFIX} routes`,
  );

  // 插件卸载（开发时热重载）时立刻收掉常驻 Chrome，不必等 60s 空闲超时
  ctx.effect(
    () => () => {
      void shutdownCdp().then(() => {
        try {
          rmSync(chromeProfile, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
        } catch {
          /* 清理不掉只是留一个目录，不影响下次启动 */
        }
      });
    },
    `${NS}: 常驻 Chrome 回收`,
  );

  /** 清掉以前几次硬崩留下的 profile 目录：它们既占磁盘，也不再被任何活进程使用。 */
  function pruneStaleProfiles() {
    let entries = [];
    try {
      entries = readdirSync(chromeProfileRoot, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^p\d+$/.test(entry.name)) continue;
      if (entry.name === `p${process.pid}`) continue;
      const pid = Number(entry.name.slice(1));
      let alive = true;
      try {
        process.kill(pid, 0);
      } catch (error) {
        alive = error?.code === "EPERM"; // EPERM 说明进程还在，只是没权限发信号
      }
      if (alive) continue;
      try {
        rmSync(join(chromeProfileRoot, entry.name), { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      } catch {
        /* 下次启动再试 */
      }
    }
  }

  /* ---------------- Agent 工具 ---------------- */

  async function runTool(args) {
    const input = args && typeof args === "object" ? args : {};
    const action = String(input.action ?? "render");

    if (action === "printers") {
      const probed = await probePrinters();
      return {
        ok: true,
        action,
        defaultQueue: probed.defaultQueue,
        printers: probed.printers.map((item) => ({
          queue: item.queue,
          state: item.state,
          isDefault: item.isDefault,
          duplex: item.capabilities.duplex,
          color: item.capabilities.color,
        })),
      };
    }

    if (action === "render") {
      if (typeof input.markdown !== "string" || !input.markdown.trim()) {
        throw new Error("action=render requires markdown");
      }
      const rendered = await renderDocument({
        markdown: input.markdown,
        template: input.template,
        title: input.title,
      });
      return {
        ok: true,
        action,
        id: rendered.id,
        title: rendered.title,
        pages: rendered.pages,
        sheets: rendered.sheets,
        duplex: rendered.duplex,
        pageNumbers: rendered.pageNumbers,
        guards: rendered.guards,
      };
    }

    if (action === "print") {
      let id = typeof input.id === "string" ? input.id : "";
      if (!id) {
        if (typeof input.markdown !== "string" || !input.markdown.trim()) {
          throw new Error("action=print requires either id (reuse a render) or markdown (render inline)");
        }
        const rendered = await renderDocument({
          markdown: input.markdown,
          template: input.template,
          title: input.title,
        });
        id = rendered.id;
      }
      const submitted = await submitPrint({
        id,
        printer: input.printer,
        duplex: input.duplex,
        copies: input.copies,
        title: input.title,
      });
      return { ok: true, action, id, ...submitted };
    }

    if (action === "status") {
      const queue = String(input.queue ?? input.printer ?? "");
      const jobId = String(input.jobId ?? "");
      if (!queue || !jobId) throw new Error("action=status requires queue and jobId");
      return { ok: true, action, queue, jobId, state: await jobStatus(queue, jobId) };
    }

    throw new Error(`Unknown action: ${action}`);
  }

  const toolDefinition = {
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: {
          type: "string",
          enum: ["printers", "render", "print", "status"],
          description: "要执行的动作，默认 render。",
        },
        markdown: { type: "string", description: "要排版的文本或 Markdown。" },
        template: {
          type: "string",
          description: "版式模板 id（内置 generic，或面板里创建的 tpl-xxxxxxxx）。",
        },
        title: { type: "string", description: "文档标题；省略时自动从正文首行提取或保持无大标题。" },
        id: { type: "string", description: "action=print 时复用已有渲染结果。" },
        printer: { type: "string", description: "打印队列名；省略时用系统默认打印机。" },
        duplex: { type: "string", enum: ["long", "short", "none"], description: "双面模式。" },
        copies: { type: "number", description: "份数，默认 1。" },
        queue: { type: "string", description: "action=status 时的打印队列。" },
        jobId: { type: "string", description: "action=status 时的任务 id。" },
      },
      required: ["action"],
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: true,
        properties: {
          ok: { type: "boolean" },
          action: { type: "string" },
          pages: { type: "number" },
          sheets: { type: "number" },
          jobId: { type: "string" },
          queue: { type: "string" },
          state: { type: "string" },
          summary: { type: "string" },
        },
      },
      render: (_args, value) => {
        const text = value && typeof value.summary === "string" ? value.summary : "讲义操作已完成";
        return [{ type: "text", text }];
      },
    },
    isConcurrencySafe: () => false,
    async execute(args) {
      const value = await runTool(args);
      return { ...value, summary: summarizeToolResult(value) };
    },
    presentCall: (args) => ({
      card: "generic",
      title: "排版并打印讲义",
      kind: "execute",
      rawInput: args,
    }),
  };

  const tools = typeof ctx.get === "function" ? ctx.get("tools") : undefined;
  if (tools && typeof tools.register === "function") {
    ctx.effect(() => tools.register(toolDefinition), `${NS}: ${TOOL_NAME} tool`);
  } else {
    logger?.warn?.(`${NS}: 没有 tools 服务，跳过 ${TOOL_NAME} 注册`);
  }

  logger?.info?.(`${NS}: 已挂载 ${PREFIX}（${findChrome() ? "Chrome 就绪" : "未找到 Chrome"}）`);
}
