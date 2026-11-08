/**
 * 打印工坊（dsh-doc）：宿主侧核心逻辑。
 *
 * 职责分三层，全部是纯函数或薄封装，便于单测：
 *  1. 打印机探测：把 `lpstat` / `lpoptions` 的输出解析成「能力表」，
 *     而不是把 PPD 原文丢给上层去猜。
 *  2. 排版渲染：Markdown → 打印样式 HTML → Chrome headless → A4 PDF，
 *     再由 `pdfinfo` / `pdftoppm` 取页数、纸张与预览图。
 *  3. 打印投递：按能力表映射参数（Duplex= 还是 sides=），`lp` 提交，
 *     `lpstat` 轮询，最终给出「队列已收下」这一层级的回执。
 *
 * 本模块不 import 任何第三方包：插件零依赖是这些插件的既有约定。
 */

export const NS = "dsh-doc";
export const PREFIX = "/dsh-doc/api";
export const STATE_VERSION = 1;

export const LIMITS = Object.freeze({
  markdownBytes: 400 * 1024,
  titleChars: 120,
  draftBytes: 400 * 1024,
  copies: 20,
  previewPages: 3,
  previewDpi: 180,
  commandTimeoutMs: 20_000,
  chromeTimeoutMs: 45_000,
  maxPreviewBytes: 3 * 1024 * 1024,
});

/* ------------------------------------------------------------------ */
/* 路由与准入                                                          */
/* ------------------------------------------------------------------ */

/**
 * 把 `/dsh-doc/api/xxx` 归一化成 `xxx`；不属于本插件前缀时返回 null。
 * @param {string} rawUrl
 * @returns {string|null}
 */
export function routeOf(rawUrl) {
  let pathname;
  try {
    pathname = new URL(rawUrl ?? "/", "http://localhost").pathname;
  } catch {
    return null;
  }
  const normalized = pathname.replace(/\/+$/, "");
  if (normalized === PREFIX) return "";
  if (normalized.startsWith(`${PREFIX}/`)) return normalized.slice(PREFIX.length + 1).replace(/^\/+/, "");
  return null;
}

/**
 * 请求准入判定。
 *
 * 宿主 `connection.requestRejection()` 负责 Host/Origin fence 与鉴权；这里在守卫
 * 缺失时 fail-closed，并要求写操作必须是 `application/json`，这样跨站表单发不出写请求。
 * @param {unknown} connection ctx.connection 服务
 * @param {{method?: string, headers?: Record<string, unknown>}} request
 * @returns {{ok: true} | {ok: false, status: number, reason: string}}
 */
export function requestAdmission(connection, request) {
  const guard = connection && typeof connection.requestRejection === "function" ? connection : null;
  if (!guard) return { ok: false, status: 503, reason: "no-connection-guard" };
  let rejection;
  try {
    rejection = guard.requestRejection(request);
  } catch {
    return { ok: false, status: 403, reason: "guard-error" };
  }
  if (rejection !== undefined) {
    return { ok: false, status: typeof rejection === "number" ? rejection : 403, reason: "rejected" };
  }
  const method = String(request?.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    const contentType = String(request?.headers?.["content-type"] ?? "").toLowerCase();
    if (!contentType.startsWith("application/json")) {
      return { ok: false, status: 415, reason: "unsupported-media-type" };
    }
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

/** @param {unknown} value */
export function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 截断并清理文本字段（标题、任务名），去掉控制字符。
 * @param {unknown} value
 * @param {number} max
 * @returns {string}
 */
export function sanitizeText(value, max = LIMITS.titleChars) {
  const text = typeof value === "string" ? value : "";
  const cleaned = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  return cleaned.length > max ? cleaned.slice(0, max) : cleaned;
}

/**
 * 布尔化：接受 true / "true" / 1 / "1" / "on" / "yes"。
 * @param {unknown} value
 * @returns {boolean}
 */
export function asBool(value) {
  if (value === true) return true;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    return v === "true" || v === "1" || v === "on" || v === "yes";
  }
  return value === 1;
}

/**
 * 双面模式归一化：none | long | short。
 * @param {unknown} value
 * @returns {"none"|"long"|"short"}
 */
export function normalizeDuplex(value) {
  const v = String(value ?? "").trim().toLowerCase();
  if (v === "none" || v === "single" || v === "one-sided" || v === "off") return "none";
  if (v === "short" || v === "tumble" || v.includes("short")) return "short";
  return "long";
}

/**
 * 颜色模式归一化：gray | color。
 * @param {unknown} value
 * @returns {"gray"|"color"}
 */
export function normalizeColor(value) {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "color" || v === "rgb" || v === "colour" ? "color" : "gray";
}

/**
 * 纸张归一化：只接受 A4 / A5 / Letter / Legal，其余落回 A4。
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeMedia(value) {
  const v = String(value ?? "").trim().toLowerCase();
  if (v === "a5") return "A5";
  if (v === "letter") return "Letter";
  if (v === "legal") return "Legal";
  return "A4";
}

/* ------------------------------------------------------------------ */
/* 打印机探测                                                          */
/* ------------------------------------------------------------------ */

/**
 * 解析 `lpstat -p -d`。
 * @param {string} text
 * @returns {{queues: string[], defaultQueue: string|null}}
 */
export function parseLpstatPrinters(text) {
  const queues = [];
  let defaultQueue = null;
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const def = /^system default destination:\s*(\S+)/i.exec(line);
    if (def) {
      defaultQueue = def[1];
      continue;
    }
    const printer = /^printer\s+(\S+)\s+is\s+(.+)$/i.exec(line);
    if (printer) {
      const name = printer[1];
      if (!queues.includes(name)) queues.push(name);
    }
  }
  return { queues, defaultQueue };
}

/**
 * 解析 `lpstat -p <queue> -l` 里的一行状态：idle / processing / disabled。
 * @param {string} text
 * @returns {{state: "idle"|"processing"|"disabled"|"unknown", detail: string}}
 */
export function parsePrinterState(text) {
  const src = String(text ?? "");
  if (/\bdisabled\b/i.test(src)) {
    const reason = /reason:\s*([^.\n]+)/i.exec(src);
    return { state: "disabled", detail: (reason?.[1] ?? "").trim() };
  }
  if (/now (?:processing|printing)/i.test(src)) return { state: "processing", detail: "" };
  if (/is\s+idle/i.test(src)) return { state: "idle", detail: "" };
  return { state: "unknown", detail: "" };
}

/**
 * 解析 `lpstat -v`（队列 → 设备 URI）。
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseLpstatDevices(text) {
  /** @type {Record<string, string>} */
  const devices = {};
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    const m = /^device for\s+(\S+):\s*(\S+)/i.exec(line);
    if (m) devices[m[1]] = m[2];
  }
  return devices;
}

/**
 * 解析 `lpoptions -p <queue> -l`。
 *
 * 形如 `Duplex/2-Sided Printing: None *DuplexNoTumble DuplexTumble`，
 * 星号标出当前默认值。返回的能力表是后面参数映射的唯一依据。
 * @param {string} text
 * @returns {Array<{key: string, label: string, values: Array<{value: string, isDefault: boolean}>}>}
 */
export function parseLpoptions(text) {
  /** @type {Array<{key: string, label: string, values: Array<{value: string, isDefault: boolean}>}>} */
  const options = [];
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = /^([A-Za-z0-9_.-]+)(?:\/([^:]*))?:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    const label = (m[2] ?? "").trim();
    const values = m[3]
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => {
        const isDefault = token.startsWith("*");
        return { value: isDefault ? token.slice(1) : token, isDefault };
      })
      .filter((v) => v.value.length > 0);
    options.push({ key, label, values });
  }
  return options;
}

/**
 * 从能力表里挑出双面/纸张/彩色三组选项名，并给出「意图 → 该机关键字」的映射。
 *
 * 这是本插件最值钱的一小块：不同驱动同一件事叫法完全不同——PPD 驱动叫
 * `Duplex/DuplexNoTumble`，IPP Everywhere 叫 `sides/two-sided-long-edge`。
 * @param {ReturnType<typeof parseLpoptions>} options
 */
export function planOptionMapping(options) {
  const byKey = new Map(options.map((o) => [o.key.toLowerCase(), o]));

  /** @type {{duplex?: {key: string, values: Record<string,string>}, media?: {key: string, values: Record<string,string>}, color?: {key: string, values: Record<string,string>}}} */
  const mapping = {};

  const duplex = byKey.get("duplex");
  if (duplex) {
    const values = {};
    for (const v of duplex.values) {
      const lower = v.value.toLowerCase();
      if (lower.includes("none") && !values.none) values.none = v.value;
      else if (lower.includes("notumble")) values.long = v.value;
      else if (lower.includes("tumble")) values.short = v.value;
    }
    if (values.none && values.long) {
      values.short = values.short ?? values.long;
      mapping.duplex = { key: duplex.key, values };
    }
  }
  const sides = byKey.get("sides");
  if (!mapping.duplex && sides) {
    mapping.duplex = {
      key: sides.key,
      values: { none: "one-sided", long: "two-sided-long-edge", short: "two-sided-short-edge" },
    };
  }

  const pageSize = byKey.get("pagesize") ?? byKey.get("media") ?? byKey.get("mediasize");
  if (pageSize) {
    const values = {};
    for (const v of pageSize.values) {
      const lower = v.value.toLowerCase();
      if (lower === "a4" || lower.includes("iso_a4") || lower.includes("210x297")) values.A4 = v.value;
      if (lower === "a5" || lower.includes("iso_a5")) values.A5 = v.value;
      if (lower === "letter" || lower.includes("na_letter")) values.Letter = v.value;
      if (lower === "legal" || lower.includes("na_legal")) values.Legal = v.value;
    }
    mapping.media = { key: pageSize.key, values };
  }

  const colorModel = byKey.get("colormodel");
  if (colorModel) {
    const values = {};
    for (const v of colorModel.values) {
      const lower = v.value.toLowerCase();
      if (lower === "gray" || lower === "monochrome" || lower === "grey") values.gray = v.value;
      if (lower === "rgb" || lower === "color" || lower === "cmyk") values.color = v.value;
    }
    mapping.color = { key: colorModel.key, values };
  }
  if (!mapping.color && byKey.get("print-color-mode")) {
    mapping.color = { key: "print-color-mode", values: { gray: "monochrome", color: "color" } };
  }

  return mapping;
}

/**
 * 生成 `lp` 的 `-o` 参数列表。无法映射的意图会被跳过并在 `applied` 里说明，
 * 而不是假装生效。
 * @param {ReturnType<typeof planOptionMapping>} mapping
 * @param {{duplex?: string, media?: string, color?: string}} wanted
 * @returns {{args: string[], applied: Record<string,string>, skipped: string[]}}
 */
export function buildOptionArgs(mapping, wanted) {
  const args = [];
  /** @type {Record<string,string>} */
  const applied = {};
  const skipped = [];

  const duplex = normalizeDuplex(wanted.duplex);
  if (mapping.duplex) {
    const value = mapping.duplex.values[duplex] ?? mapping.duplex.values.long;
    if (value) {
      args.push("-o", `${mapping.duplex.key}=${value}`);
      applied.duplex = value;
    } else {
      skipped.push("duplex");
    }
  } else {
    skipped.push("duplex");
  }

  const media = normalizeMedia(wanted.media);
  if (mapping.media) {
    const value = mapping.media.values[media];
    if (value) {
      args.push("-o", `${mapping.media.key}=${value}`);
      applied.media = value;
    } else {
      skipped.push("media");
    }
  } else {
    skipped.push("media");
  }

  const color = normalizeColor(wanted.color);
  if (mapping.color) {
    const value = mapping.color.values[color];
    if (value) {
      args.push("-o", `${mapping.color.key}=${value}`);
      applied.color = value;
    } else {
      skipped.push("color");
    }
  } else {
    skipped.push("color");
  }

  return { args, applied, skipped };
}

/**
 * 从 `lp` 的 stdout 里取任务 id，例如
 * `request id is HP_LaserJet-406 (1 file(s))`。
 * @param {string} text
 * @returns {{jobId: string|null, queue: string|null}}
 */
export function parseLpJobId(text) {
  const m = /request id is\s+(\S+)/i.exec(String(text ?? ""));
  if (!m) return { jobId: null, queue: null };
  const token = m[1];
  const dash = token.lastIndexOf("-");
  if (dash <= 0) return { jobId: token, queue: null };
  return { jobId: token, queue: token.slice(0, dash) };
}

/* ------------------------------------------------------------------ */
/* PDF 元信息                                                          */
/* ------------------------------------------------------------------ */

/**
 * 解析 `pdfinfo` 输出。
 * @param {string} text
 * @returns {{pages: number, size: string, isA4: boolean}}
 */
export function parsePdfInfo(text) {
  const src = String(text ?? "");
  const pagesMatch = /^Pages:\s+(\d+)/im.exec(src);
  const sizeMatch = /^Page size:\s+(.+)$/im.exec(src);
  const pages = pagesMatch ? Number(pagesMatch[1]) : 0;
  const size = sizeMatch ? sizeMatch[1].trim() : "";
  const isA4 = /a4/i.test(size) || /59[0-9](\.\d+)?\s*x\s*8[34][0-9](\.\d+)?/.test(size);
  return { pages, size, isA4 };
}

/**
 * 没有 poppler 时的兜底页数统计：数 `/Type /Page`（排除 `/Pages`）。
 * @param {Buffer|string} buffer
 * @returns {number}
 */
export function countPdfPagesFallback(buffer) {
  const text = Buffer.isBuffer(buffer) ? buffer.toString("latin1") : String(buffer ?? "");
  const matches = text.match(/\/Type\s*\/Page(?!s)/g);
  return matches ? matches.length : 0;
}

/**
 * 双面与纸张的派生信息，供 UI 的「纸张分摊」与校验条目复用。
 * @param {{pages: number, duplex: string, isA4: boolean}} input
 */
export function sheetPlan(input) {
  const pages = Number.isFinite(input.pages) ? input.pages : 0;
  const duplex = normalizeDuplex(input.duplex);
  const sheets = duplex === "none" ? pages : Math.ceil(pages / 2);
  /**
   * 校验条目只返回语义码与参数，文案交给界面按语言渲染；
   * 这样宿主不必猜用户界面语言，同一个结果也能同时给面板和 Agent 用。
   * @type {Array<{level: "ok"|"warn"|"bad", code: string, params?: Record<string, unknown>}>}
   */
  const guards = [];
  if (pages <= 0) {
    guards.push({ level: "bad", code: "guard.noPages" });
  } else {
    guards.push({ level: input.isA4 ? "ok" : "warn", code: input.isA4 ? "guard.paperOk" : "guard.paperMismatch" });
    if (duplex === "none") {
      guards.push({ level: "ok", code: "guard.singleSided", params: { pages, sheets } });
    } else if (pages % 2 === 0) {
      guards.push({ level: "ok", code: "guard.duplexEven", params: { pages, sheets } });
    } else {
      guards.push({ level: "warn", code: "guard.duplexOdd", params: { pages, sheets } });
    }
  }
  guards.push({ level: "ok", code: "guard.keepTogether" });
  return { pages, sheets, duplex, guards };
}

/** 校验条目的三语文案；缺语言时回落英文。 */
export const GUARD_TEXT = Object.freeze({
  en: {
    "guard.noPages": "No pages were produced",
    "guard.paperOk": "A4 · matches the preview",
    "guard.paperMismatch": "Page size is not A4",
    "guard.singleSided": "Single sided: {pages} pages = {sheets} sheet(s)",
    "guard.duplexEven": "Duplex fit: {pages} pages = {sheets} sheet(s), fronts and backs paired",
    "guard.duplexOdd": "Odd page count: the last sheet's back side stays blank",
    "guard.keepTogether": "Questions and answers locked together (keep-together)",
    "guard.pageNumbers": "Footer page numbers · {pages} page(s)",
    "guard.pageNumbersMissing": "Page numbers unavailable (CDP unavailable, fell back to CLI printing)",
  },
  zh: {
    "guard.noPages": "没有生成任何页面",
    "guard.paperOk": "纸张 A4 · 与预览一致",
    "guard.paperMismatch": "纸张尺寸与 A4 不符",
    "guard.singleSided": "单面打印：{pages} 页 = {sheets} 张",
    "guard.duplexEven": "双面适配：{pages} 页 = {sheets} 张，正反面成对",
    "guard.duplexOdd": "奇数页：最后一张背面会空白",
    "guard.keepTogether": "题目与答法锁定（keep-together）",
    "guard.pageNumbers": "页脚页码 · 共 {pages} 页",
    "guard.pageNumbersMissing": "未生成页码（CDP 不可用，已退回命令行打印）",
  },
  ja: {
    "guard.noPages": "ページが生成されませんでした",
    "guard.paperOk": "A4 · プレビューと一致",
    "guard.paperMismatch": "用紙サイズが A4 と異なります",
    "guard.singleSided": "片面印刷：{pages} ページ = {sheets} 枚",
    "guard.duplexEven": "両面対応：{pages} ページ = {sheets} 枚、表裏が揃っています",
    "guard.duplexOdd": "奇数ページ：最後の用紙の裏面は空白になります",
    "guard.keepTogether": "設問と解答を分断しない（keep-together）",
    "guard.pageNumbers": "フッターのページ番号 · 全 {pages} ページ",
    "guard.pageNumbersMissing": "ページ番号なし（CDP 利用不可のためコマンドライン印刷に切替）",
  },
});

/** 支持的语言，默认英文。 */
export const LOCALES = Object.freeze(["en", "zh", "ja"]);

/**
 * @param {unknown} value
 * @returns {"en"|"zh"|"ja"}
 */
export function normalizeLocale(value) {
  const key = String(value ?? "").trim().toLowerCase();
  if (key.startsWith("zh")) return "zh";
  if (key.startsWith("ja")) return "ja";
  return "en";
}

/**
 * 把校验条目渲染成目标语言的文本。
 * @param {Array<{level: string, code: string, params?: Record<string, unknown>}>} guards
 * @param {unknown} [locale]
 */
export function localizeGuards(guards, locale = "en") {
  const table = GUARD_TEXT[normalizeLocale(locale)] ?? GUARD_TEXT.en;
  const list = Array.isArray(guards) ? guards : [];
  return list.map((guard) => {
    let text = table[guard.code] ?? GUARD_TEXT.en[guard.code] ?? guard.code;
    if (guard.params) {
      for (const [key, value] of Object.entries(guard.params)) {
        text = text.replaceAll(`{${key}}`, String(value));
      }
    }
    return { ...guard, text };
  });
}

/* ------------------------------------------------------------------ */
/* Markdown → 打印 HTML                                                */
/* ------------------------------------------------------------------ */

/**
 * @param {string} text
 * @returns {string}
 */
export function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 行内标记：`**粗体**`、`*斜体*`、`` `代码` ``。先转义再替换，避免注入。
 * @param {string} text
 * @returns {string}
 */
export function renderInline(text) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  return out;
}

const CJK_CHAR = /[\u4e00-\u9fff]/;
const CJK_PUNCT = /[，。！？；：、]/;
/** 作者行只认带间隔号的写法（`唐 · 张若虚`），裸名字误判率太高。 */
const AUTHOR_LINE = /^[\u4e00-\u9fff]{0,3}\s*[·・]\s*[\u4e00-\u9fff]{2,4}$/;

/** 汉字占比，用来区分中文与英文行。 */
function cjkRatio(text) {
  const chars = [...String(text)];
  if (!chars.length) return 0;
  return chars.filter((ch) => CJK_CHAR.test(ch)).length / chars.length;
}

/**
 * 判断一段连续非空行是否是一首诗，并抽出标题/作者。
 *
 * 判据看的是**整体比例**而不是逐行严格：长篇古诗里常有「（… 一作：…）」注文、
 * 长题、换行位置不同的版本，一行超标不该让整首诗降级。
 *
 * - `classical`：中文为主、多数行带中文标点或整体短句 → 居中排，像诗；
 * - `free`：多行短句但不像古诗（歌词、清单）→ 保留换行，左对齐；
 * - `null`：普通段落。
 *
 * @param {string[]} lines
 * @returns {{kind: "classical"|"free", title: string|null, author: string|null, lines: string[]}|null}
 */
export function detectPoem(lines) {
  const clean = (Array.isArray(lines) ? lines : [])
    .map((line) => String(line).trim())
    .filter(Boolean);
  if (clean.length < 2) return null;

  const looksChinese = (line) => line.length <= 40 && cjkRatio(line) >= 0.5;
  const hits = clean.filter(looksChinese).length;
  if (hits / clean.length < 0.7) return null;

  const punctuated = clean.filter((line) => CJK_PUNCT.test(line)).length;
  const punctuatedRatio = punctuated / clean.length;
  const averageLength = clean.reduce((sum, line) => sum + line.length, 0) / clean.length;
  const allShort = clean.every((line) => line.length <= 18);
  const classical = allShort || (punctuatedRatio >= 0.3 && averageLength <= 30);
  const free = !classical && punctuatedRatio === 0 && clean.length >= 3;
  if (!classical && !free) return null;

  let rest = clean;
  let title = null;
  let author = null;

  if (classical) {
    const punctuatedAfter = (list) =>
      list.length === 0 ? 0 : list.filter((line) => CJK_PUNCT.test(line)).length / list.length;

    // 题目的判据：短、无句读，且「后面的行是带句读的诗句」——否则像《静夜思》这种
    // 通篇不带标点的诗，首句会被误当成题目。
    if (
      rest.length >= 4 &&
      !CJK_PUNCT.test(rest[0]) &&
      rest[0].length <= 12 &&
      punctuatedAfter(rest.slice(1)) >= 0.4
    ) {
      title = rest[0];
      rest = rest.slice(1);
    }
    if (rest.length >= 3 && !CJK_PUNCT.test(rest[0]) && AUTHOR_LINE.test(rest[0])) {
      author = rest[0];
      rest = rest.slice(1);
    }
  }

  return { kind: classical ? "classical" : "free", title, author, lines: rest };
}

/**
 * 规范化诗行：剔除中文标点符号（，。！？；：、）后面误输入的半角空格，折叠连续多余空格。
 * @param {string} text
 * @returns {string}
 */
function normalisePoemLine(text) {
  return String(text ?? "")
    .replace(/([，。！？；：、])[ \t]+/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** @param {ReturnType<typeof detectPoem>} poem */
function renderPoem(poem) {
  const cls = ["poem", poem.kind === "classical" ? "poem--classic" : "poem--free"];
  if (poem.lines.length > 14) cls.push("poem--long");
  const head = [];
  if (poem.title) head.push(`<div class="poem-title">${renderInline(poem.title)}</div>`);
  if (poem.author) head.push(`<div class="poem-author">${renderInline(poem.author)}</div>`);

  const cleanLines = poem.lines.map(normalisePoemLine);

  let body = "";
  if (poem.kind === "classical" && cleanLines.length >= 6) {
    const avgLen = cleanLines.reduce((s, l) => s + l.length, 0) / cleanLines.length;
    const stanzaSize = avgLen > 10 ? 2 : 4;
    const stanzas = [];
    for (let i = 0; i < cleanLines.length; i += stanzaSize) {
      const group = cleanLines.slice(i, i + stanzaSize);
      stanzas.push(
        `<div class="stanza">${group.map((line) => `<span class="pl">${renderInline(line)}</span>`).join("")}</div>`
      );
    }
    body = stanzas.join("");
  } else {
    body = cleanLines.map((line) => `<span class="pl">${renderInline(line)}</span>`).join("");
  }

  return `<div class="${cls.join(" ")}">${head.join("")}<div class="poem-body">${body}</div></div>`;
}

const QUESTION_RE = /^\s*(\d{1,2})\s*[.、)]\s+(.*)$/;

/** 去掉整行包裹的 **粗体**，让「**1. 题目**」也能被识别成结构。 */
function stripWrappingEmphasis(text) {
  const match = /^\*\*(.+)\*\*$/.exec(text.trim());
  return match ? match[1].trim() : text.trim();
}
const ANSWER_RE = /^\s*([AB])\s*[:：]\s*(.*)$/;

/**
 * 把 Markdown 拆成块，并把「编号问题 + 紧随其后的 A/B 答法」包进同一个
 * `.qa` 容器——打印时这个容器整体 `break-inside: avoid`，于是题目与答案
 * 不会被分页撕开。这正是上一版手工排版里反复返工的那条规则。
 * @param {string} markdown
 * @returns {string}
 */
export function renderMarkdown(markdown) {
  const lines = String(markdown ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let list = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ kind: "p", lines: paragraph.slice() });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      blocks.push({ kind: "ul", items: list.slice() });
      list = [];
    }
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      blocks.push({ kind: `h${level}`, text: heading[2].trim() });
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      flushParagraph();
      list.push(line.replace(/^\s*[-*+]\s+/, "").trim());
      continue;
    }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "hr" });
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "quote", text: line.replace(/^\s*>\s?/, "").trim() });
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();

  /** @type {string[]} */
  const html = [];
  let qa = null;
  const closeQa = () => {
    if (qa) {
      html.push(`<div class="qa">${qa.join("")}</div>`);
      qa = null;
    }
  };

  for (const block of blocks) {
    if (block.kind === "p") {
      const joined = block.lines.join(" ");
      const plain = stripWrappingEmphasis(joined);
      const question = QUESTION_RE.exec(plain);
      if (question) {
        closeQa();
        qa = [`<p class="q"><span class="qn">${escapeHtml(question[1])}</span>${renderInline(question[2])}</p>`];
        continue;
      }
      const answer = ANSWER_RE.exec(plain);
      if (answer && qa) {
        qa.push(`<p class="a"><span class="an">${escapeHtml(answer[1])}</span>${renderInline(answer[2])}</p>`);
        continue;
      }
      closeQa();
      const poem = detectPoem(block.lines);
      if (poem) {
        html.push(renderPoem(poem));
        continue;
      }
      html.push(`<p>${renderInline(joined)}</p>`);
      continue;
    }
    closeQa();
    if (block.kind === "ul") {
      html.push(`<ul>${block.items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ul>`);
      continue;
    }
    if (block.kind === "quote") {
      html.push(`<blockquote>${renderInline(block.text)}</blockquote>`);
      continue;
    }
    if (block.kind === "hr") {
      html.push("<hr>");
      continue;
    }
    const level = Number(block.kind.slice(1));
    html.push(`<h${level}>${renderInline(block.text)}</h${level}>`);
  }
  closeQa();
  return html.join("\n");
}

/**
 * 讲义的打印样式。分页能力全部交给渲染引擎：这里只声明约束，不猜几何。
 * @param {{accent?: string}} [options]
 */
export function printStyles(options = {}) {
  const accent = options.accent ?? "#1F5C3F";
  const fontStack = fontStackOf(options.font);
  const base = Number.isFinite(options.fontSize) ? options.fontSize : 10.5;
  const lineHeight = Number.isFinite(options.lineHeight) ? options.lineHeight : 1.55;
  const margin = Number.isFinite(options.margin) ? options.margin : 18;
  const columns = Number(options.columns) === 2 ? 2 : 1;

  // 上下边距比左右略窄：与「左右 18mm / 上下 15–16mm」的既有版式一致
  const marginSide = Math.max(8, margin);
  const marginTop = Math.max(8, margin - 3);
  const marginBottom = Math.max(8, margin - 2);
  // 一切尺寸都以基准字号换算，用户调字号时整篇等比缩放
  const pt = (value) => `${((value * base) / 10.5).toFixed(2)}pt`;
  const mm = (value) => `${value}mm`;
  const columnRule =
    columns === 2
      ? `article { column-count: 2; column-gap: ${mm(8)}; }
article > * { break-inside: avoid-column; }`
      : `article { column-count: 1; }`;

  return `
@page { size: A4; margin: ${mm(marginTop)} ${mm(marginSide)} ${mm(marginBottom)}; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: ${fontStack};
  font-size: ${pt(10.5)}; line-height: ${lineHeight.toFixed(2)}; color: #1D211C;
  -webkit-font-smoothing: antialiased;
}
${columnRule}
h1 { font-size: ${pt(19)}; line-height: 1.2; color: ${accent}; margin: 0 0 ${mm(3)}; letter-spacing: .01em; break-after: avoid; }
h1 + p { color: #565C52; margin: 0 0 ${mm(5)}; }
h2 {
  font-size: ${pt(12.5)}; color: ${accent}; margin: ${mm(7)} 0 ${mm(3.5)}; padding-bottom: ${mm(1.8)};
  border-bottom: .8pt solid ${accent}; break-after: avoid; page-break-after: avoid;
}
h3 { font-size: ${pt(11)}; margin: ${mm(5)} 0 ${mm(2.5)}; break-after: avoid; }
p { margin: 0 0 ${mm(2.4 * (lineHeight / 1.55))}; orphans: 2; widows: 2; }
ul { margin: 0 0 ${mm(3)}; padding-left: ${mm(6)}; }
li { margin-bottom: ${mm(1.4)}; }
blockquote { margin: 0 0 ${mm(3)}; padding-left: ${mm(4)}; border-left: 2pt solid #E9F0EA; color: #565C52; }
code {
  font-family: "SF Mono", "Menlo", monospace; font-size: ${pt(9)};
  background: #F4F2EC; padding: .3mm 1.2mm; border-radius: 1mm;
}
.qa {
  break-inside: avoid; page-break-inside: avoid;
  margin: 0 0 ${mm(3.6)}; padding: 0 0 0 ${mm(4)};
  border-left: 2.4pt solid ${accent}22;
}
.qa .q { font-weight: 600; margin: 0 0 ${mm(1.2)}; }
.qa .q .qn {
  display: inline-block; min-width: ${mm(5)}; margin-right: ${mm(2)}; color: ${accent}; font-weight: 700;
}
.qa .a { margin: 0 0 ${mm(0.9 * (lineHeight / 1.55))}; color: #2E332C; }
.qa .a .an {
  display: inline-block; min-width: ${mm(4)}; margin-right: ${mm(1.6)}; color: ${accent}; font-weight: 700;
}
.qa .a:last-child { margin-bottom: 0; }
.poem { margin: ${mm(5)} 0 ${mm(6)}; break-inside: avoid; page-break-inside: avoid; }
.poem--long { break-inside: auto; page-break-inside: auto; }
.poem--classic { text-align: center; }
.poem--classic .poem-title {
  font-size: ${pt(16)}; font-weight: 600; color: ${accent};
  margin: 0 0 ${mm(2.5)}; letter-spacing: .18em; text-indent: .18em;
  break-after: avoid; page-break-after: avoid; text-align: center;
}
.poem--classic .poem-author {
  font-size: ${pt(9)}; color: #6B7269; margin: 0 0 ${mm(7.5)};
  letter-spacing: .22em; text-indent: .22em; break-after: avoid; page-break-after: avoid; text-align: center;
}
.poem--classic .poem-body {
  display: block; width: max-content; max-width: 100%;
  margin: 0 auto; text-align: left;
}
.poem--classic .stanza { display: block; margin: 0 0 ${mm(3.5)}; }
.poem--classic .stanza:last-child { margin-bottom: 0; }
.poem--classic .pl {
  display: block;
  line-height: ${(lineHeight * 1.15).toFixed(2)};
  letter-spacing: .05em;
}
.poem-title {
  font-size: ${pt(15)}; font-weight: 600; color: ${accent};
  margin: 0 0 ${mm(2)}; letter-spacing: .05em;
  break-after: avoid; page-break-after: avoid;
}
.poem-author {
  font-size: ${pt(9.5)}; color: #6B7269; margin: 0 0 ${mm(5)};
  letter-spacing: .06em; break-after: avoid; page-break-after: avoid;
}
.poem-body { display: block; }
.poem .pl { display: block; }
.poem--free { text-align: left; padding-left: ${mm(2)}; }
.poem--free .poem-body { line-height: ${(lineHeight * 1.19).toFixed(2)}; }
hr { border: 0; border-top: .6pt solid #D9D3C5; margin: ${mm(5)} 0; }
`.trim();
}

/**
 * 校验草稿文件内容。空草稿也是合法状态（用户可能有意清空）。
 * @param {unknown} raw
 * @returns {{markdown: string, updatedAt: number} | null}
 */
export function normalizeDraft(raw) {
  if (!isRecord(raw) || typeof raw.markdown !== "string") return null;
  if (Buffer.byteLength(raw.markdown, "utf8") > LIMITS.draftBytes) return null;
  const updatedAt = Number(raw.updatedAt);
  return { markdown: raw.markdown, updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0 };
}

/**
 * 决定文档大标题。
 *
 * 优先级：显式标题（`# 标题` 或调用方传入）＞ 纯诗时留空 ＞ 模板标题。
 * 纯诗不补模板标题，是因为诗的标题行已经承担了这个角色，再压一个大标题会打架。
 * @param {{explicitTitle?: unknown, bodyHtml?: string, templateTitle?: string}} input
 * @returns {string}
 */
export function resolveDocumentTitle(input) {
  const explicit = sanitizeText(input.explicitTitle, 200);
  if (explicit) return explicit;
  const body = String(input.bodyHtml ?? "").trim();
  const purePoem = /^<div class="poem[^"]*">/.test(body) && !/<(?:h\d|p|ul|blockquote)\b/.test(body);
  return purePoem ? "" : sanitizeText(input.templateTitle ?? "", 200);
}

/**
 * 包一层完整 HTML 文档，交给 Chrome 打印。
 * @param {{title: string, subtitle?: string, bodyHtml: string, accent?: string, fontSize?: number, lineHeight?: number, margin?: number, columns?: number, font?: string}} input
 * @returns {string}
 */
export function wrapPrintHtml(input) {
  const rawTitle = sanitizeText(input.title, 200);
  const title = rawTitle ? escapeHtml(rawTitle) : "";
  const subtitle = rawTitle && input.subtitle ? `<p>${escapeHtml(input.subtitle)}</p>` : "";
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${title}</title>
<style>${printStyles({
  accent: input.accent,
  fontSize: input.fontSize,
  lineHeight: input.lineHeight,
  margin: input.margin,
  columns: input.columns,
  font: input.font,
})}</style></head>
<body>
<article>
${title ? `<h1>${title}</h1>` : ""}
${subtitle}
${input.bodyHtml}
</article>
</body></html>`;
}

/**
 * 如果正文第一行是一级标题，把它当成文档标题抽走，避免与模板标题重复。
 * @param {string} markdown
 * @returns {{title: string|null, body: string}}
 */
export function splitLeadingTitle(markdown) {
  const lines = String(markdown ?? "").replace(/\r\n?/g, "\n").split("\n");
  let index = 0;
  while (index < lines.length && !lines[index].trim()) index += 1;
  const match = index < lines.length ? /^#\s+(.+?)\s*$/.exec(lines[index]) : null;
  if (!match) return { title: null, body: markdown };
  const body = lines.slice(0, index).concat(lines.slice(index + 1)).join("\n");
  return { title: match[1].trim(), body };
}

/* ------------------------------------------------------------------ */
/* 模板                                                                */
/* ------------------------------------------------------------------ */

/**
 * 内置模板。自定义模板与它同构：
 * { id, title, subtitle, accent, fontSize, columns, builtIn }
 */
export const TEMPLATES = Object.freeze({
  generic: {
    id: "generic",
    title: "通用讲义",
    subtitle: "",
    accent: "#1F5C3F",
    fontSize: 10.5,
    lineHeight: 1.55,
    margin: 18,
    columns: 1,
    font: "wenkai",
    builtIn: true,
  },
});

/** 可选正文字体。stack 里第一个装不上就自动回退，不会排成豆腐块。 */
export const FONTS = Object.freeze({
  wenkai: {
    id: "wenkai",
    label: "霞鹜文楷",
    stack: '"LXGW WenKai", "Songti SC", "STSong", "Times New Roman", serif',
  },
  song: {
    id: "song",
    label: "宋体",
    stack: '"Songti SC", "STSong", "Source Han Serif SC", "Hiragino Mincho ProN", serif',
  },
  kaiti: {
    id: "kaiti",
    label: "楷体",
    stack: '"Kaiti SC", "STKaiti", "KaiTi", "LXGW WenKai", serif',
  },
  system: {
    id: "system",
    label: "系统黑体",
    stack: '-apple-system, "PingFang SC", "Helvetica Neue", "Segoe UI", sans-serif',
  },
});

/**
 * 依据字体名称构建 CSS 字体栈。
 * 内置字体（wenkai、song、kaiti、system）使用预设的多级兜底栈；
 * 系统字体或自定义字体名称则优先匹配该字族，并跟随系统常规安全回退。
 * @param {unknown} font
 * @returns {string}
 */
export function fontStackOf(font) {
  const norm = normalizeFont(font);
  if (Object.prototype.hasOwnProperty.call(FONTS, norm)) {
    return FONTS[norm].stack;
  }
  const safe = norm.replace(/["'\\]/g, "");
  return `"${safe}", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`;
}

/**
 * 规范化字体标识。
 * 支持内置字体 key（wenkai、song、kaiti、system），
 * 也支持任意系统字体名称（如 "PingFang SC"、"Times New Roman"）。
 * 为防止 CSS 注入，过滤危险字符；若为空或全为非法字符则回落文楷。
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeFont(value) {
  if (value === null || value === undefined) return "wenkai";
  const str = String(value).trim();
  if (!str) return "wenkai";
  const lower = str.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(FONTS, lower)) {
    return lower;
  }
  const safe = str.replace(/[;{}<>"'\\\r\n]/g, "").trim().slice(0, 80);
  return safe || "wenkai";
}

export const TEMPLATE_LIMITS = Object.freeze({
  max: 24,
  titleChars: 40,
  subtitleChars: 120,
  fontSizeMin: 8.5,
  fontSizeMax: 18,
  lineHeightMin: 1.2,
  lineHeightMax: 2.4,
  marginMin: 8,
  marginMax: 35,
});

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * 校验并归一化一个模板。非法字段回落到内置默认值，而不是抛错。
 * @param {unknown} input
 * @param {{id?: string, builtIn?: boolean}} [meta]
 */
export function normalizeTemplate(input, meta = {}) {
  const raw = isRecord(input) ? input : {};
  const accent = typeof raw.accent === "string" && HEX_COLOR.test(raw.accent.trim()) ? raw.accent.trim().toLowerCase() : TEMPLATES.generic.accent;
  const size = Number(raw.fontSize);
  const fontSize = Number.isFinite(size)
    ? Math.min(TEMPLATE_LIMITS.fontSizeMax, Math.max(TEMPLATE_LIMITS.fontSizeMin, Math.round(size * 2) / 2))
    : TEMPLATES.generic.fontSize;
  const columns = Number(raw.columns) === 2 ? 2 : 1;

  const lh = Number(raw.lineHeight);
  const lineHeight = Number.isFinite(lh)
    ? Math.min(TEMPLATE_LIMITS.lineHeightMax, Math.max(TEMPLATE_LIMITS.lineHeightMin, Math.round(lh * 20) / 20))
    : TEMPLATES.generic.lineHeight;

  const mg = Number(raw.margin);
  const margin = Number.isFinite(mg)
    ? Math.min(TEMPLATE_LIMITS.marginMax, Math.max(TEMPLATE_LIMITS.marginMin, Math.round(mg)))
    : TEMPLATES.generic.margin;

  return {
    id: meta.id ?? null,
    font: normalizeFont(raw.font),
    title: sanitizeText(raw.title, TEMPLATE_LIMITS.titleChars) || "未命名模板",
    subtitle: sanitizeText(raw.subtitle, TEMPLATE_LIMITS.subtitleChars),
    accent,
    fontSize,
    lineHeight,
    margin,
    columns,
    builtIn: Boolean(meta.builtIn),
  };
}

/**
 * 把「临时样式覆盖」叠到模板上，用于未保存时的实时预览。
 *
 * 只认四个排版维度 + 主色，其余字段（标题、副标题）仍然以模板为准；
 * 每个值都按模板的限制夹一次，避免界面传来越界值把排版搞崩。
 * @param {unknown} patch
 * @param {ReturnType<typeof normalizeTemplate>} template
 */
export function applyStyleOverride(patch, template) {
  const base = isRecord(template) ? template : TEMPLATES.generic;
  if (!isRecord(patch)) return base;
  const merged = { ...base };
  if (patch.font !== undefined) merged.font = normalizeFont(patch.font);
  for (const [key, min, max, round] of [
    ["fontSize", TEMPLATE_LIMITS.fontSizeMin, TEMPLATE_LIMITS.fontSizeMax, 0.5],
    ["lineHeight", TEMPLATE_LIMITS.lineHeightMin, TEMPLATE_LIMITS.lineHeightMax, 20],
    ["margin", TEMPLATE_LIMITS.marginMin, TEMPLATE_LIMITS.marginMax, 1],
  ]) {
    const value = Number(patch[key]);
    if (!Number.isFinite(value)) continue;
    const clamped = Math.min(max, Math.max(min, value));
    merged[key] = round === 1 ? Math.round(clamped) : Math.round(clamped * round) / round;
  }
  if (patch.columns !== undefined) merged.columns = Number(patch.columns) === 2 ? 2 : 1;
  if (typeof patch.accent === "string" && HEX_COLOR.test(patch.accent.trim())) {
    merged.accent = patch.accent.trim().toLowerCase();
  }
  return merged;
}

/**
 * 以内置模板为底，叠加用户改动，得到一个完整的覆盖项。
 *
 * 直接 normalizeTemplate(patch) 会把没传的字段重置成默认值——例如标题会从
 * 「通用讲义」变成「未命名模板」。所以覆盖必须先把内置值铺底。
 * @param {string} id 内置模板 id
 * @param {unknown} patch 用户提交的表单
 */
export function mergeBuiltinOverride(id, patch) {
  const base = TEMPLATES[id];
  if (!base) return normalizeTemplate(patch, { id, builtIn: false });
  const raw = isRecord(patch) ? patch : {};
  const merged = { ...base };
  for (const [key, value] of Object.entries(raw)) {
    if (value !== undefined && value !== null && value !== "") merged[key] = value;
  }
  const result = normalizeTemplate(merged, { id, builtIn: true });
  // 标题被显式清空时应保留内置标题，而不是变成「未命名模板」
  if (!sanitizeText(raw.title, TEMPLATE_LIMITS.titleChars)) result.title = base.title;
  return result;
}

/**
 * 合并内置与自定义模板后按 id 取用；未知 id 回落到内置通用讲义。
 * @param {unknown} id
 * @param {Array<ReturnType<typeof normalizeTemplate>>} [custom]
 */
export function resolveTemplate(id, custom = [], overrides = {}) {
  const key = String(id ?? "").trim();
  const override = overrides && isRecord(overrides) ? overrides[key] : undefined;
  if (override) return /** @type {any} */ (mergeBuiltinOverride(key, override));
  if (TEMPLATES[key]) return TEMPLATES[key];
  const found = Array.isArray(custom) ? custom.find((item) => item && item.id === key) : undefined;
  return /** @type {any} */ (found ?? TEMPLATES.generic);
}

/**
 * 解析 templates.json 的内容。容忍损坏文件、脏条目、重复 id 与超量列表。
 * @param {unknown} raw 已 JSON.parse 的值（或任意未知值）
 * @returns {Array<ReturnType<typeof normalizeTemplate>>}
 */
export function parseTemplatesFile(raw) {
  const list = isRecord(raw) && Array.isArray(raw.templates)
    ? raw.templates
    : Array.isArray(raw)
      ? raw
      : [];
  // 内置模板的覆盖项单独存，键是内置 id（如 generic）
  const overrides = {};
  if (isRecord(raw) && isRecord(raw.builtinOverrides)) {
    for (const [id, value] of Object.entries(raw.builtinOverrides)) {
      if (Object.prototype.hasOwnProperty.call(TEMPLATES, id) && isRecord(value)) {
        overrides[id] = normalizeTemplate(value, { id, builtIn: true });
      }
    }
  }
  var __overrides = overrides;
  const seen = new Set();
  /** @type {Array<ReturnType<typeof normalizeTemplate>>} */
  const out = [];
  for (const item of list) {
    if (!isRecord(item) || typeof item.id !== "string") continue;
    if (!/^tpl-[0-9a-f]{8}$/i.test(item.id)) continue;
    const id = item.id.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(normalizeTemplate(item, { id, builtIn: false }));
    if (out.length >= TEMPLATE_LIMITS.max) break;
  }
  Object.defineProperty(out, "builtinOverrides", { value: __overrides, enumerable: false });
  return out;
}

/**
 * 序列化自定义模板列表。
 * @param {Array<ReturnType<typeof normalizeTemplate>>} list
 * @returns {string}
 */
export function serializeTemplates(list, overrides = {}) {
  const safe = Array.isArray(list) ? list.filter((item) => item && item.id && !item.builtIn) : [];
  const cleaned = {};
  if (isRecord(overrides)) {
    for (const [id, value] of Object.entries(overrides)) {
      if (Object.prototype.hasOwnProperty.call(TEMPLATES, id) && isRecord(value)) {
        cleaned[id] = { ...value, id: undefined, builtIn: undefined };
      }
    }
  }
  return JSON.stringify({ version: 2, templates: safe, builtinOverrides: cleaned }, null, 2);
}

/**
 * 列出全部模板：内置在前，自定义按创建顺序。
 * @param {Array<ReturnType<typeof normalizeTemplate>>} [custom]
 */
export function listTemplates(custom = [], overrides = {}) {
  const effectiveBuiltin = (id) => {
    const base = TEMPLATES[id];
    const override = overrides && isRecord(overrides) ? overrides[id] : undefined;
    return override ? { ...mergeBuiltinOverride(id, override), edited: true } : base;
  };
  const list = Object.keys(TEMPLATES).map(effectiveBuiltin);
  if (Array.isArray(custom)) {
    for (const item of custom) if (item && item.id && !TEMPLATES[item.id] && !item.builtIn) list.push(item);
  }
  return list;
}

/* ------------------------------------------------------------------ */
/* 打印任务状态                                                        */
/* ------------------------------------------------------------------ */

/**
 * 根据 `lpstat -o` 与 `lpstat -W completed -o` 的输出判断任务状态。
 * @param {{active: string, completed: string, jobId: string}} input
 * @returns {"processing"|"completed"|"unknown"}
 */
export function resolveJobState(input) {
  const jobId = String(input.jobId ?? "");
  if (!jobId) return "unknown";
  if (String(input.active ?? "").includes(jobId)) return "processing";
  if (String(input.completed ?? "").includes(jobId)) return "completed";
  return "unknown";
}

/**
 * 把「打印参数 + 回执」压成一句话，供 UI 与日志共用。
 * @param {{pages: number, sheets: number, duplex: string, printer: string}} input
 * @returns {string}
 */
export function describeJob(input) {
  const duplexText = normalizeDuplex(input.duplex) === "none" ? "单面" : "双面";
  return `${input.printer} · ${duplexText} · ${input.pages} 页 / ${input.sheets} 张`;
}
