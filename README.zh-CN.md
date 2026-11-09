**中文** | [English](./README.md)

# 打印工坊 · dsh-doc

[![npm](https://img.shields.io/npm/v/@polunzh/dsh-doc)](https://www.npmjs.com/package/@polunzh/dsh-doc)
[![开放插件市场](https://img.shields.io/endpoint?url=https%3A%2F%2Fdshopen.org%2Fbadge%2F%2540polunzh%2Fdsh-doc.json)](https://dshopen.org/zh/plugins/@polunzh/dsh-doc/)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

在 DeepSeek Harness 里用 Word 式 A4 纸面排版，并把讲义直接双面打印到局域网打印机。

![打印工坊工作台](https://raw.githubusercontent.com/polunzh/dsh-doc/main/preview/screenshots/workspace-zh.png)

## 能力

- **Word 式 A4 编辑台**：直接在真实纸张视窗里书写或粘贴，页边距、字体、行距、分栏实时可见。
- **Ribbon 工具栏**：段落样式、加粗斜体下划线、对齐、列表，以及字体字号行距边距分栏一步到位。
- **渲染即校验**：编号问题与答案被锁进同一个不断开的区块，分页撕不开。
- **打印机能力探测**：读真实 PPD / IPP 参数（双面、纸张、灰度）后精确映射，映射不了的明确报告。
- **按需校样**：点「打印预览」看 Chromium CDP 渲染的真实分页与规则校验，确认后再出纸。
- **Agent 可用**：注册 `print_handout` 工具，模型无需打开面板即可排版打印。

## 安装

```bash
dsh plugin --profile desktop add @polunzh/dsh-doc
```

本机需要 Chrome / Chromium 渲染 PDF；预览缩略图需要 `poppler`（macOS `brew install poppler`，Linux `apt install poppler-utils`）。

## 许可证

MIT
