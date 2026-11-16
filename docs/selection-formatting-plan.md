# 选中文字格式 · 实施计划

## 阶段一：后端清洗白名单（core）
1. `lib/core.js` 新增并导出 `sanitizeInlineStyle(styleText)`：按属性白名单逐条校验重建。
2. 改 `sanitizeBodyHtml`：行内标签保留 `sanitizeInlineStyle` 后的 style，块级仍保留 `text-align`；其余属性丢弃。
3. `test/core.test.js` 增加用例：合法 font-size/color/background/font-family 保留；`url(...)`、`expression(...)`、`onclick`、`color:red;background:url()` 被剥离；未知标签/脚本仍被清洗。

## 阶段二：编辑器真相源与格式引擎（client）
4. `lib/client.js` `WordPaperEditor`：去掉 `value` 变更重灌分支，改为仅在 `initialHtml` 变化 / 首次挂载时种子化；`execCmd` 不再触发 DOM 重灌。
5. 新增字符格式工具函数：`splitRangeTextNodes`、`applyInlineStyleToSelection(styleObj)`、`queryFormatState()`。
6. `execCmd` 对 B/I/U/S 保持 execCommand；新增字体/字号/颜色/高亮处理函数。
7. `selectionchange` 监听：`selActive` 与 B/I/U/S 按下态。
8. `sanitizeEditableHtml(html, { keepInlineStyles })`：草稿还原保留行内 style 与 `data-ddoc-fmt`，粘贴剥离。
9. `domToMarkdown` / `markdownToHtml` / `inlineMd`：下划线与受控 `span[style]` 往返不露标签。
10. CSS：放行 `span[data-ddoc-fmt]` 的 font-family。

## 阶段三：Ribbon UI
11. 在文字修饰组后新增“选中文字”组：字体下拉、字号下拉、颜色、高亮；无选区时禁用。
12. 现有整篇样式组标题标注“整篇样式”，与“选中文字”区分。
13. 补充中/英/日词条。

## 阶段四：验证与交付
14. `node --test test/*.test.js` 全绿。
15. 扩展 `scripts/verify-preview.mjs`（或新增 `scripts/verify-format.mjs`）：真实 live.html + CDP 断言选区格式与选区保持，跑一次 render 无报错。
16. 生成中文/英文截图，更新 README（能力项 + 截图）。
17. commit（英文信息）+ push 到 origin。

## 影响文件
- `lib/core.js`
- `lib/client.js`
- `test/core.test.js`
- `scripts/verify-preview.mjs`（或新增脚本）
- `README.md` / `README.zh-CN.md` / `preview/screenshots/*`
- `docs/selection-formatting-design.md`（本设计）

## 验收标准
- 选中文字后点 B/I/U/S/字体/字号/颜色/高亮，文字立即按预期变化，选区不丢，可连续套用。
- 打印预览 PDF 与屏幕一致（含高亮背景、每段字号）。
- 旧草稿可正常打开；`print_handout` 工具不受影响。
- 测试全绿，README 双语更新，已推送。
