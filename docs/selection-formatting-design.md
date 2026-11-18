# 选中文字格式（字符级格式化）设计与实施计划

> 后续更新（2026-11）：字体 / 字号已合并为单一控件，并直接显示当前值——有选区时改选区、无选区时改整篇默认（不再要求必须先选中）。详见 [font-size-display-design.md](./font-size-display-design.md)。本文 §3.2 / §3.5 中「无选区时禁用」的描述以新文档为准。

## 1. 目标
在 Word 式纸面编辑区里，选中一段文字后可以只改这一段：加粗 / 斜体 / 下划线 / 删除线、字体、字号、文字颜色、背景高亮。屏幕所见即打印所得。

## 2. 现状问题（已在 Chromium 实测确认）
1. **下划线坏掉**：`document.execCommand("underline")` 产出 `<u>`，`domToMarkdown` 把它序列化成字面 `<u>…</u>`，`markdownToHtml` 的 `inlineMd` 先 `escapeHtml` 再替换，于是下划线变成屏幕上可见的 `<u>` 标签文字。
2. **点按钮丢选区**：`execCmd` 执行后 `setMarkdown(...)` 触发 `WordPaperEditor` 的 `value` 变更 effect，`el.innerHTML` 重灌，“刚刚选中的文字”被清空，无法对同一段文字连续套多种格式。
3. **字体/字号是整篇级**：字号、字体 stepper 改的是 `styleDraft`，作用于整张纸；没有“只改选中文字”的字符级控件。
4. **没有颜色 / 高亮**。
5. **打印链路会丢内联样式**：后端 `core.sanitizeBodyHtml` 只保留 `text-align`，其他 inline style 一律丢弃；即便编辑区有样式，PDF 也没有。
6. **编辑区 CSS 强制字体继承**：`.ddoc-word-canvas *:not(code):not(pre){ font-family:inherit !important }` 会覆盖字符级 `font-family`。

## 3. 方案

### 3.1 编辑器以富文本 DOM 为唯一真相
编辑区内容不再由 `markdown` 反向重灌。`WordPaperEditor` 只在挂载/草稿载入时从 `initialHtml`（或旧草稿的 markdown）种子化一次；之后所有输入与格式化都直接改 DOM，`onChange` 只把 markdown 回传给父组件做草稿/字符数/工具兜底。`editorRef.current.innerHTML` 始终是最新富文本，打印/预览直接用它（现逻辑已如此）。这样选区在多步格式操作间保持，DOM-only 样式不会被下一次按键吃掉。

`execCmd` 走同一条“只改 DOM、不回灌”的路径。

### 3.2 字符格式引擎
- 语义格式（B/I/U/S）继续用 `document.execCommand`（配合 `styleWithCSS=false`，Chromium 产出 `<b>/<i>/<u>/<strike>`），执行后不再重灌 DOM。
- 字体 / 字号 / 颜色 / 高亮用**自绘 span 包裹**，不依赖 `execCommand fontName/fontSize/foreColor`（后者字号只有 1–7 档、产出废弃 `<font>`）：
  - 遍历与当前 Range 相交的文本节点，在区间边界处 `splitText`；
  - 每段文本包一层 `<span data-ddoc-fmt style="…">`，已有同类 span 则合并 style；
  - 应用后重新选中这些 span，支持连续套用；
  - 选区跨多个段落时逐文本节点处理，避免把块级节点塞进 span 造成非法 HTML。
  - 无选区时字体/字号/颜色/高亮控件禁用并提示“请先选中文字”。
- `selectionchange` 监听：刷新 B/I/U/S 的按下态（`queryCommandState`），以及是否有选区。

### 3.3 样式白名单（前后端同一套规则）
新增一个纯函数 `sanitizeInlineStyle(styleText)`（core 导出，client 复用同逻辑或内联实现）：
- 允许属性：`font-family`、`font-size`、`color`、`background-color`、`font-weight`、`font-style`、`text-decoration`、`text-decoration-line`。
- 逐属性严格校验：字号 `\d+(\.\d+)?(pt|px|em|%)` 且数值在合理范围；颜色只认 `#hex` / `rgb(a)()`；字体族过滤引号括号与 `url()`；weight/style/decoration 只认关键字。不做原样透传，全部重建。
- `core.sanitizeBodyHtml`：在保留 `text-align` 之外，对**行内标签**（span/b/strong/i/em/u/s/strike/del/code）保留上面过滤后的 style；标签与文字仍重建+转义，其余属性（含事件、class、id）全部丢弃。
- `client.sanitizeEditableHtml(html, { keepInlineStyles })`：草稿还原时 `keepInlineStyles:true` 并保留 `data-ddoc-fmt`；粘贴时保持 false（外部字体/颜色不污染纸面）。

### 3.4 编辑区 CSS
把强制继承规则改成放行自绘 span：`.ddoc-word-canvas *:not(code):not(pre):not(span[data-ddoc-fmt]) { font-family: inherit !important; }`。粘贴进来但没有 `data-ddoc-fmt` 的外来 font-family 仍被强制继承，纸面字体不被污染。

### 3.5 UI（Ribbon）
在“文字修饰”组后新增“选中文字”组，控件只作用于选区：
- 字体下拉（预置文楷/宋体/楷体/黑体 + 系统字体）
- 字号下拉（9–36pt 常用档）
- 颜色按钮（色板 + 自定义 `<input type=color>`）
- 高亮按钮（色板 + 清除）
现有“字体/字号/行距/边距/栏数”保留为整篇默认，组标题明确为“整篇样式”，避免两块看起来重复。

### 3.6 打印
`Page.printToPDF` 已 `printBackground:true`，高亮背景能出纸。字符级字号用绝对 pt，与编辑区一致（两者都是基准字号的绝对 pt）。`printStyles` 不需要 `!important`，内联 style 自然覆盖。

### 3.7 Markdown 兜底
`domToMarkdown` 的下划线从“字面标签”改成可识别的内联片段；`markdownToHtml/inlineMd` 对 `<u>` 与 `span[style]` 做受控放行（占位符保护后再转义），保证没有 html 的旧草稿从 markdown 还原时不至于露标签。主链路仍以 html 为准。

## 4. 兼容
- 旧草稿只有 markdown：按 markdown 种子，行为不变。
- 旧草稿有 html：走 `keepInlineStyles` 还原，新增样式能保留。
- `print_handout` 工具只吃 markdown，不受影响。
- 后端 `sanitizeBodyHtml` 是安全边界，所有样式按白名单重建，不放宽脚本/事件/外链。

## 5. 风险
- 跨段落选区包裹需要逐文本节点处理，逻辑较繁；用现有 live harness 做 DOM 断言验证。
- 保留 inline style 后，粘贴富文本可能带颜色；粘贴路径默认仍剥离，只草稿还原保留。
- 前端无单元测试框架（client.js 依赖 React/宿主全局），用 `preview/live.html` + CDP 驱动做端到端断言。

## 6. 验证
1. `node --test test/*.test.js`：新增 core 清洗白名单用例（保留合法 style、丢弃 `url()`/`expression`/事件/未知属性）。
2. 新增/扩展 CDP 驱动脚本：在真实 `preview/live.html` 里选中文字，依次点 B/I/U/S、字体、字号、颜色、高亮，断言 DOM 标签/内联样式正确、选区在操作后仍非折叠；再走一次 render，确认无报错且有分页。
3. 截图（中英各一）验证界面，更新 README 能力说明与截图。
4. 完成后 commit 并 push 到 origin。
