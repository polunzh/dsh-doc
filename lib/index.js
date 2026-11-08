/**
 * 打印工坊（dsh-doc）：宿主侧入口。
 *
 * 只做三件事：解析路由、调用 core 里的纯函数、把子进程结果整理成 JSON。
 * 所有重活（探测/渲染/投递）都在 core 与下面的 runner 里，便于单测。
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { printWithPageNumbers } from "./cdp.js";
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
  const chromeProfile = join(homeRoot, "storages", NS, "chrome-profile");

  const templatesFile = join(homeRoot, "storages", NS, "templates.json");
  const draftFile = join(homeRoot, "storages", NS, "draft.json");
  /** 自定义版式模板（不含内置）；持久化到 storages。 */
  let customTemplates = loadTemplates();
  /** 内置模板的覆盖项：id → 完整模板。 */
  let builtinOverrides = {};

  /** 渲染产物缓存：id → 元信息。重启后按磁盘文件重建即可，内存只是加速。 */
  const renders = new Map();
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

  async function makePreviews(pdfPath, id, pages) {
    const limit = Math.min(pages, LIMITS.previewPages);
    if (!limit) return [];
    const prefix = join(workDir, `${id}-p`);
    const pp = await run("pdftoppm", ["-png", "-r", String(LIMITS.previewDpi), "-f", "1", "-l", String(limit), pdfPath, prefix], 20000);
    if (pp.code !== 0) return [];
    /** @type {Array<{page: number, dataUrl: string}>} */
    const previews = [];
    for (let page = 1; page <= limit; page += 1) {
      const candidates = [`${prefix}-${page}.png`, `${prefix}-0${page}.png`, `${prefix}-${String(page).padStart(2, "0")}.png`];
      const file = candidates.find((candidate) => existsSync(candidate));
      if (!file) continue;
      const stat = statSync(file);
      if (stat.size > LIMITS.maxPreviewBytes) continue;
      previews.push({ page, dataUrl: `data:image/png;base64,${readFileSync(file).toString("base64")}` });
    }
    return previews;
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

    const id = randomUUID();
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
    const htmlPath = join(workDir, `${id}.html`);
    const pdfPath = join(workDir, `${id}.pdf`);
    writeFileSync(htmlPath, html, "utf8");

    ensureDir(chromeProfile);

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
      const printed = await run(
        chrome,
        [
          "--headless=new",
          "--disable-gpu",
          "--no-first-run",
          "--no-default-browser-check",
          "--no-pdf-header-footer",
          `--user-data-dir=${chromeProfile}`,
          `--print-to-pdf=${pdfPath}`,
          pathToFileURL(htmlPath).href,
        ],
        LIMITS.chromeTimeoutMs,
      );

      if (!existsSync(pdfPath) || statSync(pdfPath).size < 800) {
        throw Object.assign(
          new Error(`Rendering failed: ${printed.stderr.trim().slice(-240) || "no PDF produced"}`),
          { code: "render-failed" },
        );
      }
    }

    if (!existsSync(pdfPath) || statSync(pdfPath).size < 800) {
      throw Object.assign(
        new Error(`Rendering failed: ${cdpError?.message ?? "no PDF produced"}`),
        { code: "render-failed" },
      );
    }

    const info = await pdfInfo(pdfPath);
    const signature = readFileSync(pdfPath).subarray(0, 5).toString("latin1");
    if (signature !== "%PDF-") {
      throw Object.assign(new Error("Rendered output is not a valid PDF"), { code: "not-pdf" });
    }

    const previews = await makePreviews(pdfPath, id, info.pages);
    pruneRenders();
    const plan = sheetPlan({ pages: info.pages, duplex: settings.duplex, isA4: info.isA4 });
    plan.guards.push(
      pageNumbers
        ? { level: "ok", code: "guard.pageNumbers", params: { pages: info.pages } }
        : { level: "warn", code: "guard.pageNumbersMissing" },
    );

    const record = {
      id,
      title,
      template: template.id,
      pages: info.pages,
      pageSize: info.size,
      isA4: info.isA4,
      pageNumbers,
      pdfPath,
      createdAt: Date.now(),
    };
    renders.set(id, record);

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
