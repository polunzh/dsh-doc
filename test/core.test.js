import test from "node:test";
import assert from "node:assert/strict";

import {
  TEMPLATES,
  buildOptionArgs,
  listTemplates,
  detectPoem,
  normalizeTemplate,
  localizeGuards,
  normalizeFont,
  normalizeLocale,
  parseTemplatesFile,
  serializeTemplates,
  countPdfPagesFallback,
  normalizeDuplex,
  parseLpJobId,
  parseLpoptions,
  parseLpstatDevices,
  parseLpstatPrinters,
  parsePdfInfo,
  parsePrinterState,
  planOptionMapping,
  printStyles,
  renderMarkdown,
  requestAdmission,
  resolveDocumentTitle,
  resolveJobState,
  resolveTemplate,
  routeOf,
  sanitizeText,
  sheetPlan,
  wrapPrintHtml,
} from "../lib/core.js";
import { marginMmFrom } from "../lib/cdp.js";

/* ------------------------------ 路由 ------------------------------ */

test("routeOf：只认本插件前缀", () => {
  assert.equal(routeOf("/dsh-doc/api/status"), "status");
  assert.equal(routeOf("/dsh-doc/api/render?x=1"), "render");
  assert.equal(routeOf("/dsh-doc/api/"), "");
  assert.equal(routeOf("/dsh-doc/api//job"), "job");
  assert.equal(routeOf("/other/api/status"), null);
  assert.equal(routeOf("/dsh-doc/apix"), null);
  assert.equal(routeOf("::not a url"), null);
});

test("requestAdmission：守卫缺失时 fail-closed，写操作要求 JSON", () => {
  assert.equal(requestAdmission(null, { method: "GET" }).ok, false);

  const guard = { requestRejection: () => undefined };
  assert.equal(requestAdmission(guard, { method: "GET", headers: {} }).ok, true);

  const post = requestAdmission(guard, { method: "POST", headers: { "content-type": "text/plain" } });
  assert.equal(post.ok, false);
  assert.equal(post.status, 415);

  const jsonPost = requestAdmission(guard, { method: "POST", headers: { "content-type": "application/json; charset=utf-8" } });
  assert.equal(jsonPost.ok, true);

  const rejected = requestAdmission({ requestRejection: () => 403 }, { method: "GET" });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.status, 403);
});

/* ---------------------------- 打印机解析 ---------------------------- */

const LPOPTIONS_HP = `ColorModel/Color Mode: *Gray
cupsPrintQuality/Quality: Draft *Normal
Duplex/2-Sided Printing: None *DuplexNoTumble DuplexTumble
PageSize/Media Size: 100x150mm A4 A5 *A4 Letter
InputSlot/Media Source: auto manual tray-1`;

test("parseLpoptions：解析关键字、标签、默认值", () => {
  const options = parseLpoptions(LPOPTIONS_HP);
  assert.equal(options.length, 5);

  const duplex = options.find((o) => o.key === "Duplex");
  assert.ok(duplex);
  assert.equal(duplex.label, "2-Sided Printing");
  assert.deepEqual(
    duplex.values.map((v) => [v.value, v.isDefault]),
    [
      ["None", false],
      ["DuplexNoTumble", true],
      ["DuplexTumble", false],
    ],
  );
});

test("planOptionMapping：PPD 的 Duplex 与 IPP 的 sides 两种叫法都能映射", () => {
  const ppd = planOptionMapping(parseLpoptions(LPOPTIONS_HP));
  assert.equal(ppd.duplex.key, "Duplex");
  assert.equal(ppd.duplex.values.long, "DuplexNoTumble");
  assert.equal(ppd.duplex.values.short, "DuplexTumble");
  assert.equal(ppd.duplex.values.none, "None");
  assert.equal(ppd.media.key, "PageSize");
  assert.equal(ppd.media.values.A4, "A4");
  assert.equal(ppd.color.key, "ColorModel");
  assert.equal(ppd.color.values.gray, "Gray");

  const ipp = planOptionMapping(
    parseLpoptions("sides/2-Sided: one-sided *two-sided-long-edge two-sided-short-edge\nmedia/Media: iso_a4_210x297mm na_letter_8.5x11in"),
  );
  assert.equal(ipp.duplex.key, "sides");
  assert.equal(ipp.duplex.values.long, "two-sided-long-edge");
  assert.equal(ipp.media.values.A4, "iso_a4_210x297mm");
});

test("buildOptionArgs：映射不了的意图被跳过而不是假装生效", () => {
  const mapping = planOptionMapping(parseLpoptions(LPOPTIONS_HP));
  const { args, applied, skipped } = buildOptionArgs(mapping, { duplex: "long", media: "A4", color: "gray" });
  assert.deepEqual(args, ["-o", "Duplex=DuplexNoTumble", "-o", "PageSize=A4", "-o", "ColorModel=Gray"]);
  assert.deepEqual(applied, { duplex: "DuplexNoTumble", media: "A4", color: "Gray" });
  assert.deepEqual(skipped, []);

  const noCaps = buildOptionArgs({}, { duplex: "long", media: "A4", color: "gray" });
  assert.deepEqual(noCaps.args, []);
  assert.deepEqual(noCaps.skipped, ["duplex", "media", "color"]);
});

test("normalizeDuplex：常见写法归一", () => {
  assert.equal(normalizeDuplex("short"), "short");
  assert.equal(normalizeDuplex("two-sided-short-edge"), "short");
  assert.equal(normalizeDuplex("none"), "none");
  assert.equal(normalizeDuplex("single"), "none");
  assert.equal(normalizeDuplex("whatever"), "long");
  assert.equal(normalizeDuplex(undefined), "long");
});

test("parseLpstatPrinters / parseLpstatDevices / parsePrinterState", () => {
  const printers = parseLpstatPrinters(
    "printer _192_168_0_97 is idle.  enabled since Mon Oct 26\n" +
      "printer HP_M232 is idle.  enabled since Sat Nov 7\n" +
      "system default destination: HP_M232",
  );
  assert.deepEqual(printers.queues, ["_192_168_0_97", "HP_M232"]);
  assert.equal(printers.defaultQueue, "HP_M232");

  const devices = parseLpstatDevices(
    "device for _192_168_0_97: ipps://192.168.0.97/ipp/print\ndevice for HP_M232: ipps://NPI.local.:631/ipp/print",
  );
  assert.equal(devices._192_168_0_97, "ipps://192.168.0.97/ipp/print");
  assert.equal(devices.HP_M232, "ipps://NPI.local.:631/ipp/print");

  assert.equal(parsePrinterState("printer X is idle.  enabled since ...").state, "idle");
  assert.equal(parsePrinterState("printer X now printing X-12.").state, "processing");
  const disabled = parsePrinterState("printer X disabled since ... reason: Media jam.");
  assert.equal(disabled.state, "disabled");
  assert.equal(disabled.detail, "Media jam");
});

test("parseLpJobId：从 lp 回执里取任务 id", () => {
  assert.deepEqual(parseLpJobId("request id is HP_M232-406 (1 file(s))"), {
    jobId: "HP_M232-406",
    queue: "HP_M232",
  });
  assert.deepEqual(parseLpJobId("nothing here"), { jobId: null, queue: null });
});

test("resolveJobState：先看活动队列，再看已完成", () => {
  assert.equal(resolveJobState({ active: "HP-7 zhenqiang 1", completed: "", jobId: "HP-7" }), "processing");
  assert.equal(resolveJobState({ active: "", completed: "HP-7 zhenqiang ...", jobId: "HP-7" }), "completed");
  assert.equal(resolveJobState({ active: "", completed: "", jobId: "HP-7" }), "unknown");
  assert.equal(resolveJobState({ active: "", completed: "", jobId: "" }), "unknown");
});

/* ------------------------------ PDF ------------------------------ */

test("parsePdfInfo：页数与 A4 判定", () => {
  const info = parsePdfInfo("Title: x\nPages:           2\nPage size:       594.96 x 841.92 pts (A4)\n");
  assert.equal(info.pages, 2);
  assert.equal(info.isA4, true);

  const letter = parsePdfInfo("Pages: 3\nPage size: 612 x 792 pts (letter)\n");
  assert.equal(letter.pages, 3);
  assert.equal(letter.isA4, false);
});

test("countPdfPagesFallback：不把 /Pages 数进去", () => {
  const buffer = Buffer.from("%PDF-1.4 /Type /Catalog /Type /Pages /Kids[1 0 R] /Type /Page /Type /Page", "latin1");
  assert.equal(countPdfPagesFallback(buffer), 2);
});

test("sheetPlan：双面成对、奇数页告警、A4 判定", () => {
  const even = sheetPlan({ pages: 4, duplex: "long", isA4: true });
  assert.equal(even.sheets, 2);
  assert.equal(even.guards.filter((g) => g.level === "ok").length, 3);

  const odd = sheetPlan({ pages: 3, duplex: "long", isA4: true });
  assert.equal(odd.sheets, 2);
  assert.ok(odd.guards.some((g) => g.level === "warn" && g.code === "guard.duplexOdd"));

  const single = sheetPlan({ pages: 3, duplex: "none", isA4: true });
  assert.equal(single.sheets, 3);

  const noPages = sheetPlan({ pages: 0, duplex: "long", isA4: true });
  assert.ok(noPages.guards.some((g) => g.level === "bad"));
});

/* --------------------------- Markdown --------------------------- */

test("renderMarkdown：编号问题与 A/B 答法被包进同一个 qa 容器", () => {
  const html = renderMarkdown(
    ["## Part 1", "", "**1. What music do you like?**", "", "A：I like pop music.", "", "B：Classical music."].join("\n"),
  );
  assert.match(html, /<h2>Part 1<\/h2>/);
  assert.match(html, /<div class="qa">/);
  assert.match(html, /<p class="q"><span class="qn">1<\/span>What music do you like\?<\/p>/);
  assert.match(html, /<p class="a"><span class="an">A<\/span>I like pop music\.<\/p>/);
  assert.match(html, /<p class="a"><span class="an">B<\/span>Classical music\.<\/p>/);
  assert.equal((html.match(/class="qa"/g) ?? []).length, 1);
});

test("renderMarkdown：转义 HTML，不执行注入", () => {
  const html = renderMarkdown('<img src=x onerror="alert(1)">');
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&lt;img"));
});

test("renderMarkdown：列表、引用、标题层级", () => {
  const html = renderMarkdown("# 标题\n\n- 一\n- 二\n\n> 引用");
  assert.match(html, /<h1>标题<\/h1>/);
  assert.match(html, /<ul><li>一<\/li><li>二<\/li><\/ul>/);
  assert.match(html, /<blockquote>引用<\/blockquote>/);
});

test("renderMarkdown：古典诗按行排、居中，不被压成一段", () => {
  const html = renderMarkdown("# 静夜思\n\n床前明月光\n疑是地上霜\n举头望明月\n低头思故乡");
  assert.match(html, /class="poem poem--classic"/);
  assert.equal((html.match(/class="pl"/g) ?? []).length, 4);
  assert.ok(html.includes("床前明月光"));
  assert.ok(!html.includes("床前明月光 疑是地上霜"), "单换行不应被拼成一段");
});

test("detectPoem：长诗里夹注文也不该降级，并抽出题目与作者", () => {
  const poem = detectPoem([
    "春江花月夜",
    "唐 · 张若虚",
    "春江潮水连海平，海上明月共潮生。",
    "滟滟随波千万里，何处春江无月明。",
    "人生代代无穷已，江月年年望相似。（望相似 一作：只相似）",
    "不知江月待何人，但见长江送流水。",
  ]);
  assert.equal(poem.kind, "classical");
  assert.equal(poem.title, "春江花月夜");
  assert.equal(poem.author, "唐 · 张若虚");
  assert.equal(poem.lines.length, 4);
  assert.ok(poem.lines[2].includes("一作"), "注文应原样保留在诗行里");
});

test("detectPoem：普通段落 / 英文 / 单行都不算诗", () => {
  assert.equal(
    detectPoem([
      "这是一段相当长的普通正文，用来确认它不会被误判成诗，因为它有完整的句子结构和标点。",
      "第二句同样很长，也带有完整标点符号，正常情况下不应该被当作分行文本处理。",
    ]),
    null,
  );
  assert.equal(detectPoem(["line one", "line two", "line three"]), null);
  assert.equal(detectPoem(["只有一行"]), null);
  assert.equal(detectPoem([]), null);
});

test("detectPoem：中文多行但不带句读且较长 → free 模式", () => {
  const poem = detectPoem([
    "这是第一行比较长的中文内容但没有句号",
    "这是第二行同样很长的中文内容也没有标点",
    "第三行依然保持这个长度用来触发分行模式",
  ]);
  assert.equal(poem.kind, "free");
  assert.equal(poem.title, null);
  assert.equal(poem.lines.length, 3);
});

test("renderMarkdown：分隔线渲染成 hr", () => {
  const html = renderMarkdown("上文\n\n---\n\n下文");
  assert.match(html, /<hr>/);
});

test("resolveDocumentTitle：显式标题优先，纯诗留空，其余用模板标题", () => {
  const poemBody =
    '<div class="poem poem--classic"><div class="poem-title">静夜思</div><div class="poem-body"><span class="pl">床前明月光</span></div></div>';
  assert.equal(resolveDocumentTitle({ bodyHtml: poemBody, templateTitle: "通用讲义" }), "");
  assert.equal(
    resolveDocumentTitle({ explicitTitle: "我的讲义", bodyHtml: poemBody, templateTitle: "通用讲义" }),
    "我的讲义",
  );
  assert.equal(resolveDocumentTitle({ bodyHtml: "<p>正文</p>", templateTitle: "通用讲义" }), "通用讲义");
  assert.equal(resolveDocumentTitle({ bodyHtml: "", templateTitle: "" }), "");
});

test("printStyles / wrapPrintHtml：A4 与防撕裂规则都在", () => {
  const css = printStyles();
  assert.match(css, /@page \{ size: A4/);
  assert.match(css, /break-inside: avoid/);
  assert.match(css, /orphans: 2/);

  const html = wrapPrintHtml({ title: "标题", subtitle: "副标题", bodyHtml: "<p>x</p>" });
  assert.match(html, /<!doctype html>/);
  assert.match(html, /<h1>标题<\/h1>/);
  assert.match(html, /<p>副标题<\/p>/);
});

/* ----------------------------- 杂项 ----------------------------- */

test("sanitizeText：去控制字符并截断", () => {
  assert.equal(sanitizeText("  a\u0000b  "), "ab");
  assert.equal(sanitizeText("x".repeat(200), 10).length, 10);
  assert.equal(sanitizeText(undefined), "");
});

test("normalizeTemplate：脏字段回落，字号夹到范围内", () => {
  const tpl = normalizeTemplate(
    { title: "  口语问答卡  ", subtitle: "x".repeat(400), accent: "red", fontSize: 99, columns: 2 },
    { id: "tpl-12345678" },
  );
  assert.equal(tpl.title, "口语问答卡");
  assert.equal(tpl.subtitle.length, 120);
  assert.equal(tpl.accent, TEMPLATES.generic.accent);
  assert.equal(tpl.fontSize, 18, "超上限要夹到 18pt");
  assert.equal(tpl.columns, 2);
  assert.equal(tpl.builtIn, false);

  const tiny = normalizeTemplate({ title: "小字", fontSize: 1 }, { id: "tpl-00000000" });
  assert.equal(tiny.fontSize, 8.5);

  const fallback = normalizeTemplate({}, { id: "tpl-87654321" });
  assert.equal(fallback.title, "未命名模板");
  assert.equal(fallback.columns, 1);
});

test("listTemplates / resolveTemplate：内置在前，自定义可按 id 选中", () => {
  const custom = [normalizeTemplate({ title: "问答卡", accent: "#2B4C7E" }, { id: "tpl-aaaaaaaa" })];
  const list = listTemplates(custom);
  assert.equal(list.length, 2);
  assert.equal(list[0].id, "generic");
  assert.equal(list[1].title, "问答卡");

  assert.equal(resolveTemplate("tpl-aaaaaaaa", custom).title, "问答卡");
  assert.equal(resolveTemplate("tpl-missing", custom).id, "generic");
  assert.equal(resolveTemplate("generic", custom).id, "generic");
});

test("localizeGuards：中英日三语文案，默认英文", () => {
  const guards = [
    { level: "warn", code: "guard.duplexOdd", params: { pages: 3, sheets: 2 } },
    { level: "ok", code: "guard.paperOk" },
  ];
  assert.match(localizeGuards(guards, "en")[0].text, /Odd page count/);
  assert.match(localizeGuards(guards, "zh")[0].text, /奇数页/);
  assert.match(localizeGuards(guards, "ja")[0].text, /奇数ページ/);
  assert.match(localizeGuards(guards)[0].text, /Odd page count/, "不传语言默认英文");
  assert.match(localizeGuards(guards, "fr")[0].text, /Odd page count/, "不支持的语言回落英文");
  assert.equal(localizeGuards(guards, "ja")[1].text.includes("{pages}"), false, "占位符应被替换");
});

test("normalizeLocale：语言标签归一", () => {
  assert.equal(normalizeLocale("zh-CN"), "zh");
  assert.equal(normalizeLocale("ja-JP"), "ja");
  assert.equal(normalizeLocale("en-US"), "en");
  assert.equal(normalizeLocale("de"), "en");
  assert.equal(normalizeLocale(undefined), "en");
});

test("normalizeTemplate：行距与页边距夹到范围内", () => {
  const big = normalizeTemplate({ lineHeight: 5, margin: 200 }, { id: "tpl-aaaaaaaa" });
  assert.equal(big.lineHeight, 2.4, "行距上限 2.4");
  assert.equal(big.margin, 35, "页边距上限 35mm");

  const small = normalizeTemplate({ lineHeight: 0.1, margin: 0 }, { id: "tpl-bbbbbbbb" });
  assert.equal(small.lineHeight, 1.2, "行距下限 1.2");
  assert.equal(small.margin, 8, "页边距下限 8mm");

  const fallback = normalizeTemplate({}, { id: "tpl-cccccccc" });
  assert.equal(fallback.lineHeight, 1.55, "缺省行距");
  assert.equal(fallback.margin, 18, "缺省页边距");

  // 半档对齐：1.63 → 1.65
  assert.equal(normalizeTemplate({ lineHeight: 1.63 }, { id: "tpl-dddddddd" }).lineHeight, 1.65);
});

test("printStyles：行距与页边距写进 CSS", () => {
  const css = printStyles({ lineHeight: 2, margin: 30 });
  assert.match(css, /line-height: 2\.00/);
  assert.match(css, /@page \{ size: A4; margin: 27mm 30mm 28mm; \}/, "上下比左右各窄 3/2mm");

  const tight = printStyles({ margin: 10 });
  assert.match(tight, /margin: 8mm 10mm 8mm/, "上下不能低于 8mm");
});

test("marginMmFrom：与 printStyles 用同一套边距规则", () => {
  assert.deepEqual(marginMmFrom(18), { top: 15, bottom: 16, left: 18, right: 18 });
  assert.deepEqual(marginMmFrom(30), { top: 27, bottom: 28, left: 30, right: 30 });
  assert.deepEqual(marginMmFrom(5), { top: 8, bottom: 8, left: 8, right: 8 });
  assert.deepEqual(marginMmFrom(undefined), { top: 15, bottom: 16, left: 18, right: 18 });
});

test("printStyles：楷体也有字体栈", () => {
  const css = printStyles({ font: "kaiti" });
  assert.match(css, /"Kaiti SC"/);
  assert.match(css, /"STKaiti"/);
});

test("printStyles：字体按模板生效并带回退", () => {
  const wenkai = printStyles({ font: "wenkai" });
  assert.match(wenkai, /"LXGW WenKai"/);
  assert.match(wenkai, /"Songti SC"/, "第一个装不上时要回退宋体");

  const song = printStyles({ font: "song" });
  assert.match(song, /"Songti SC"/);
  assert.ok(!song.includes("LXGW WenKai"));

  const system = printStyles({ font: "system" });
  assert.match(system, /PingFang SC/);

  // 支持系统字体
  const custom = printStyles({ font: "PingFang SC" });
  assert.match(custom, /"PingFang SC"/);

  assert.equal(normalizeFont("wenkai"), "wenkai");
  assert.equal(normalizeFont("PingFang SC"), "PingFang SC", "系统字体原样保留");
  assert.equal(normalizeFont("  Times New Roman  "), "Times New Roman");
  assert.equal(normalizeFont(";;;;;"), "wenkai", "全非法字符回退文楷");
  assert.equal(normalizeFont(undefined), "wenkai");
});

test("normalizeTemplate：字体字段被校验且支持系统字体", () => {
  assert.equal(normalizeTemplate({ font: "song" }, { id: "tpl-11111111" }).font, "song");
  assert.equal(normalizeTemplate({ font: "PingFang SC" }, { id: "tpl-22222222" }).font, "PingFang SC");
  assert.equal(normalizeTemplate({ font: "comic-sans" }, { id: "tpl-33333333" }).font, "comic-sans");
  assert.equal(normalizeTemplate({ font: ";;;;;;" }, { id: "tpl-44444444" }).font, "wenkai");
  assert.equal(normalizeTemplate({}, { id: "tpl-55555555" }).font, "wenkai");
});

test("printStyles：字号与栏数参数化", () => {
  const one = printStyles({ fontSize: 10.5, columns: 1 });
  assert.match(one, /column-count: 1/);
  assert.match(one, /font-size: 10\.50pt/);

  const two = printStyles({ fontSize: 12, columns: 2, accent: "#2B4C7E" });
  assert.match(two, /column-count: 2/);
  assert.match(two, /#2B4C7E/);
  assert.match(two, /font-size: 12\.00pt/);
  assert.ok(two.includes("12.00pt"), "标题也要跟着基准字号等比放大");
});

test("parseTemplatesFile：容忍脏数据，只留合法条目", () => {
  const list = parseTemplatesFile({
    version: 1,
    templates: [
      { id: "tpl-aaaaaaaa", title: "问答卡", accent: "#2B4C7E", fontSize: 11, columns: 2 },
      { id: "bad-id", title: "坏 id" },
      { id: "tpl-aaaaaaaa", title: "重复 id 应被忽略" },
      { id: "tpl-bbbbbbbb", title: "   ", fontSize: 99 },
      null,
      "string",
    ],
  });
  assert.equal(list.length, 2);
  assert.equal(list[0].title, "问答卡");
  assert.equal(list[0].columns, 2);
  assert.equal(list[0].builtIn, false);
  assert.equal(list[1].title, "未命名模板");
  assert.equal(list[1].fontSize, 18);
});

test("parseTemplatesFile：非法输入得到空列表而不是抛错", () => {
  assert.deepEqual(parseTemplatesFile(null), []);
  assert.deepEqual(parseTemplatesFile("nope"), []);
  assert.deepEqual(parseTemplatesFile({}), []);
  assert.deepEqual(parseTemplatesFile({ templates: "x" }), []);
});

test("serializeTemplates：只写自定义，且能解析回来", () => {
  const custom = [normalizeTemplate({ title: "A" }, { id: "tpl-cccccccc" })];
  const text = serializeTemplates(custom);
  assert.ok(!text.includes('"generic"'), "内置模板不应落盘");
  const parsed = parseTemplatesFile(JSON.parse(text));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].title, "A");
  assert.equal(parsed[0].id, "tpl-cccccccc");
});

test("resolveTemplate：只剩通用讲义，未知模板一律落回它", () => {
  assert.equal(resolveTemplate("generic").title, "通用讲义");
  assert.equal(resolveTemplate("pet").id, "generic", "已移除的模板必须回落，而不是报错");
  assert.equal(resolveTemplate("nope").id, "generic");
  assert.equal(resolveTemplate(undefined).id, "generic");
  assert.equal(TEMPLATES.pet, undefined);
});
