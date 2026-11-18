# 字体 / 字号控件显示当前值 · 设计

## 背景

上一版按「一个功能只留一处入口」把整篇样式和选中文字的两套字体/字号合并成一组。合并方向对，但控件是占位下拉（`value=""` 且选完即重置），收起时永远显示「字体」「字号」，看不到当前用的字体和字号。

## 目标

单组控件下，字体、字号各一个入口，且收起时直接显示当前值：

- **字体**：自定义下拉。按钮显示当前字体名（文楷 / 宋体 / 楷体 / 黑体，或系统字体家族名）；展开后「推荐字体」每项用它本身的字体栈渲染，系统字体每项也用它自己的家族渲染，能直接看出字形差异。
- **字号**：下拉，收起时显示当前 pt（如 `10.5pt`）。当前值不在常用档里时动态补进选项。
- 语义保持：有选区时改选中文字；无选区时改整篇默认。
- 显示跟随：有选区时读选区起始处的 `font-family` / `font-size`；无选区时显示整篇默认（`styleDraft.font` / `styleDraft.fontSize`）。

## 实现要点

1. `paperFontStack` 同层新增 `normalizeFamilyList` / `matchPresetFont`：把 `getComputedStyle().fontFamily` 映射回预设键（wenkai/song/kaiti/system），否则取首个家族名。
2. `StudioPage` 新增 `currentFont` / `currentSize` 状态，在 `selectionchange`（非折叠、在编辑区内）里读取并更新。
3. 字体控件复用并扩展 `FontPicker`：新增 `presets`，渲染「推荐字体」分节（每项 `data-font-key`、用 `paperFontStack` 渲染），系统字体项用自身家族渲染；`commit` 不再把预设键写进「最近使用」。
4. 字号 `<select>` 的 `value` 绑定当前字号（字符串），选项 = 常用档 ∪ 当前值。
5. 交互：字体 `onChange` → 有选区 `applySelectionStyle({fontFamily})`，否则 `styleDraft.font`；字号同理。

## 验收

- 收起状态下字体控件显示当前字体名、字号控件显示当前 pt。
- 展开字体列表，各项以自身字体渲染。
- 选中文字改字体/字号只改选区；无选区改整篇默认。
- `node --test` 全绿；`scripts/verify-selection-format.mjs` 通过（字体步骤改为点选自定义下拉）。
- 更新中/英截图。
