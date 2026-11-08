#!/usr/bin/env node
/*
 * gen.mjs — 生成同一首诗的四个 A4 版式标本（HTML）。
 * 只做渲染与测量，不发明设计：CSS 数值逐条照规格写死；可用环境变量做调参。
 *
 * 结构事实（决定了标本怎么排）：
 *   - lib/core.js detectPoem() 逐行取诗行，不在逗号处拆句；
 *   - 本诗的规范内容就是 18 行 × 16 字（design/workspace-mockup.html 同）；
 *   - 18 行 = 36 句；「四句一节」= 2 行一节 = 9 节 / 8 个节距。
 *
 * 可调参数（仅 V2 的节距/行高、V3 的字号/行高，符合规格的调参范围）：
 *   V2_LH=2.5 V2_GAP=8mm V3_FS=11pt V3_LH=1.9 node gen.mjs
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const TITLE = "春江花月夜";
const AUTHOR = "唐 · 张若虚";

const RAW_LINES = [
  "春江潮水连海平，海上明月共潮生。",
  "滟滟随波千万里，何处春江无月明？",
  "江流宛转绕芳甸，月照花林皆似霰。",
  "空里流霜不觉飞，汀上白沙看不见。",
  "江天一色无纤尘，皎皎空中孤月轮。",
  "江畔何人初见月，江月何年初照人？",
  "人生代代无穷已，江月年年望相似。",
  "不知江月待何人？但见长江送流水。",
  "白云一片去悠悠，青枫浦上不胜愁。",
  "谁家今夜扁舟子，何处相思明月楼？",
  "可怜楼上月徘徊，应照离人妆镜台。",
  "玉户帘中卷不去，捣衣砧上拂还来。",
  "此时相望不相闻，愿逐月华流照君。",
  "鸿雁长飞光不度，鱼龙潜跃水成文。",
  "昨夜闲潭梦落花，可怜春半不还家。",
  "江水流春去欲尽，江潭落月复西斜。",
  "斜月沉沉藏海雾，碣石潇湘无限路。",
  "不知乘月几人归，落月摇情满江树。",
];

/** 规范化：去掉 ，。？！；： 之后的 ASCII 空格，折叠连续空格。 */
const normalise = (s) =>
  s.replace(/[，。？！；：][ \t]+/g, (m) => m[0]).replace(/[ \t]{2,}/g, " ").trim();

const LINES = RAW_LINES.map(normalise);
if (LINES.length !== RAW_LINES.length) throw new Error("line count changed");

const hex = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const span = (text) => `<span class="pl">${hex(text)}</span>`;

/* ── 可调参数（默认值即最终定稿值） ───────────────────────── */
const V2_LINE_HEIGHT = Number(process.env.V2_LH || 2.5);
const V2_STANZA_GAP = process.env.V2_GAP || "8mm";
// 2 行 = 4 句 = 一节（18 行 => 9 节，8 个节距）
const STANZA_SIZE = 2;
const V3_FONT_SIZE = process.env.V3_FS || "11pt";
const V3_LINE_HEIGHT = Number(process.env.V3_LH || 1.9);

/* ── 共用基座 ─────────────────────────────────────────────── */
const BASE = `
@page { size: A4; margin: 15mm 18mm 16mm; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body {
  margin: 0;
  font-family: "LXGW WenKai", "Songti SC", serif;
  font-size: 10.5pt;
  line-height: 1.55;
  color: #1D211C;
}
.poem { margin: 0; }
`.trim();

const page = (title, css, body) => `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
${BASE}

${css}
</style>
</head>
<body>
<div class="poem">
  <div class="poem-title">${TITLE}</div>
  <div class="poem-author">${AUTHOR}</div>
${body}
</div>
</body>
</html>
`;

/* ── V0 · 现状：整首逐行居中 ─────────────────────────────── */
const V0_CSS = `
/* V0 —— 现行实现（lib/core.js）：.poem 居中 → 每行独立居中 */
.poem { text-align: center; }
.poem-title {
  font-size: 15pt; font-weight: 600; color: #1F5C3F;
  letter-spacing: .05em; margin: 0 0 2mm;
}
.poem-author {
  font-size: 9.5pt; color: #6B7269;
  letter-spacing: .06em; margin: 0 0 5mm;
}
.poem-body .pl {
  display: block;
  line-height: 2.05;      /* = 1.55 * 1.32 */
  letter-spacing: .06em;
}
`.trim();

/* ── V1 · 版心对齐 ──────────────────────────────────────── */
const V1_CSS = `
/* V1 —— 版心对齐：块居中，行内左对齐 */
.poem-title {
  font-size: 16.5pt; font-weight: 600; color: #1F5C3F;
  letter-spacing: .2em; text-indent: .2em;
  margin: 0 0 2mm; text-align: center;
}
.poem-author {
  font-size: 9pt; color: #6B7269;
  letter-spacing: .24em; text-indent: .24em;
  margin: 0 0 9mm; text-align: center;
}
.poem-body {
  width: max-content;
  margin: 0 auto;
  text-align: left;
}
.pl { display: block; line-height: 1.72; letter-spacing: .05em; }
`.trim();

/* ── V2 · 分节 + 铺满版心 ────────────────────────────────── */
const V2_CSS = `
/* V2 —— 分节 + 铺满版心：同一版心，四句一节，节距/行高开页 */
.poem-title {
  font-size: 16.5pt; font-weight: 600; color: #1F5C3F;
  letter-spacing: .2em; text-indent: .2em;
  margin: 0 0 2mm; text-align: center;
}
.poem-author {
  font-size: 9pt; color: #6B7269;
  letter-spacing: .24em; text-indent: .24em;
  margin: 0 0 9mm; text-align: center;
}
.poem-body {
  width: max-content;
  margin: 0 auto;
  text-align: left;
}
.stanza { display: block; margin: 0 0 ${V2_STANZA_GAP}; }
.stanza:last-child { margin-bottom: 0; }
.pl { display: block; line-height: ${V2_LINE_HEIGHT}; letter-spacing: .05em; }
`.trim();

/* ── V3 · 竖排 ──────────────────────────────────────────── */
const V3_CSS = `
/* V3 —— 竖排：标题/作者横排居中，正文右起一行一列 */
.poem-title {
  font-size: 15pt; font-weight: 600; color: #1F5C3F;
  letter-spacing: .2em; text-indent: .2em;
  margin: 0 0 2mm; text-align: center;
}
.poem-author {
  font-size: 9pt; color: #6B7269;
  letter-spacing: .24em; text-indent: .24em;
  margin: 0 0 8mm; text-align: center;
}
.poem-body {
  writing-mode: vertical-rl;
  text-orientation: upright;
  height: max-content;
  max-height: 210mm;
  width: max-content;
  margin: 0 auto;
  padding-top: 2mm;
  font-size: ${V3_FONT_SIZE};
  line-height: ${V3_LINE_HEIGHT};
}
.pl { display: block; letter-spacing: .02em; }
`.trim();

/* ── 组装 ──────────────────────────────────────────────── */
const v0Body = `  <div class="poem-body">${LINES.map(span).join("")}</div>`;
const v1Body = v0Body;

const stanzas = [];
for (let i = 0; i < LINES.length; i += STANZA_SIZE) stanzas.push(LINES.slice(i, i + STANZA_SIZE));
const v2Body =
  `  <div class="poem-body">` +
  stanzas.map((g) => `<div class="stanza">${g.map(span).join("")}</div>`).join("") +
  `</div>`;

const v3Body = v0Body;

const files = {
  "v0-current.html": page("V0 现状 · 春江花月夜", V0_CSS, v0Body),
  "v1-align.html": page("V1 版心对齐 · 春江花月夜", V1_CSS, v1Body),
  "v2-stanza.html": page("V2 分节铺满 · 春江花月夜", V2_CSS, v2Body),
  "v3-vertical.html": page("V3 竖排 · 春江花月夜", V3_CSS, v3Body),
};

for (const [name, html] of Object.entries(files)) writeFileSync(join(HERE, name), html, "utf8");

console.log(
  JSON.stringify({
    lines: LINES.length,
    ju: LINES.length * 2,
    stanzaSize: STANZA_SIZE,
    stanzas: stanzas.length,
    gaps: stanzas.length - 1,
    v0: { "line-height": 2.05, "letter-spacing": ".06em" },
    v1: { "line-height": 1.72, "letter-spacing": ".05em" },
    v2: { "line-height": V2_LINE_HEIGHT, "stanza-gap": V2_STANZA_GAP },
    v3: { "font-size": V3_FONT_SIZE, "line-height": V3_LINE_HEIGHT },
  })
);
