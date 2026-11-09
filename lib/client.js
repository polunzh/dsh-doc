/**
 * 打印工坊（dsh-doc）：浏览器侧。
 *
 * 注册两处：
 *   - `sidebar.panellist`：左侧栏的入口图标（一张带折角的纸）。
 *   - `main`：全局面板页（左输入 / 右预览 / 底部动作栏 + 打印确认卡）。
 *
 * 所有样式走宿主主题 token；墨绿只作为「工坊」识别色用在填充、标记与纸带这类
 * 图形上，文字色用 color-mix 往 label-primary 混合，深浅主题都可读。
 */
window.__ModuleLoader__.load({
  id: "@polunzh/dsh-doc",
  factory(require) {
    const React = require("react");
    const h = React.createElement;
    const { useState, useEffect, useMemo, useRef, useCallback } = React;

    const NS = "dsh-doc";
    const PANEL_ID = "dsh-doc";
    const API = "/dsh-doc/api";
    const ACCENT = "#2E7050";
    const SEAL = "#B3472F";
    const ACCENTS = ["#1F5C3F", "#2B4C7E", "#8A5A2B", "#B3472F", "#1D211C"];

    /* ================================ 文案 ================================ */

    const DICT = {
      zh: {
        "panel.title": "打印工坊",
        "panel.brand": "LECTURE WORKSHOP",
        "panel.subtitle": "把一段文字排成讲义并直接打印。左边调版式、右边实时看分页，确认后再出纸。",
        "label.template": "模板",
        "label.content": "内容",
        "label.preview": "预览",
        "label.guards": "分页校验",
        "label.sheet": "纸张分摊",
        "label.paper": "纸张",
        "label.pages": "页数",
        "label.duplex": "双面",
        "label.sheets": "用纸",
        "chip.new": "+ 新模板",
        "template.generic": "通用讲义",
        "template.new": "新建版式模板",
        "template.stamp": "新",
        "template.name": "名称",
        "template.namePh": "例如：口语问答卡",
        "template.subtitleLabel": "副标题（可选）",
        "template.subtitlePh": "印在标题下方的一行说明",
        "template.accent": "主色",
        "template.lineHeight": "行间距",
        "template.margin": "页边距",
        "template.size": "正文字号",
        "template.font": "字体",
        "font.wenkai": "文楷",
        "font.song": "宋体",
        "font.kaiti": "楷体",
        "font.system": "黑体",
        "font.systemFonts": "系统字体",
        "font.presetGroup": "推荐字体",
        "font.customPrompt": "选择系统字体…",
        "font.search": "搜索字体…",
        "font.noMatch": "没有匹配的字体",
        "font.recent": "最近使用",
        "template.columns": "栏数",
        "template.one": "单栏",
        "template.two": "双栏",
        "template.create": "创建并选中",
        "template.created": "已创建模板「{title}」",
        "template.edit": "编辑",
        "template.reset": "恢复默认",
        "template.resetDone": "已恢复内置模板",
        "template.edited": "已修改",
        "template.editTitle": "编辑版式模板",
        "template.save": "保存修改",
        "template.updated": "已更新模板「{title}」",
                "template.deleted": "已删除模板「{title}」",
        "format.p": "正文",
        "format.h1": "标题 1",
        "format.h2": "标题 2",
        "format.h3": "标题 3",
        "format.quote": "引用",
        "btn.bold": "加粗 (⌘B)",
        "btn.italic": "斜体 (⌘I)",
        "btn.underline": "下划线 (⌘U)",
        "btn.strike": "删除线",
        "btn.alignLeft": "左对齐",
        "btn.alignCenter": "居中",
        "btn.alignRight": "右对齐",
        "btn.bulletList": "无序列表",
        "btn.numberList": "编号列表",
        "btn.undo": "撤销 (⌘Z)",
        "btn.redo": "重做 (⌘⇧Z)",
        "btn.preview": "打印预览",
        "btn.close": "关闭",
        "editor.placeholder": "在这里写正文：可直接排版，⌘↵ 看分页，写完点打印。",
        "btn.render": "渲染预览",
        "btn.rerender": "重新渲染",
        "btn.print": "打印 {pages} 页",
        "btn.printOne": "打印 1 页",
        "btn.printBlocked": "打印",
        "btn.cancel": "取消",
        "btn.confirmPrint": "正式打印",
        "state.idle": "尚未渲染",
        "state.rendering": "渲染中…",
        "state.ready": "已渲染",
        "state.dirty": "待更新",
        "state.printing": "提交中…",
        "state.done": "已出纸",
        "empty.title": "渲染后在此查看分页",
        "empty.hint": "A4 · 双面 · 灰色打印",
        "printer.none": "没有检测到打印机",
        "printer.disabled": "已禁用",
        "printer.idle": "就绪",
        "printer.processing": "打印中",
        "confirm.title": "确认打印",
        "confirm.stamp": "校",
        "confirm.warning": "出纸后无法撤回。请确认没有选错文档。",
        "confirm.printer": "打印机",
        "confirm.paper": "纸张",
        "confirm.pages": "页数",
        "confirm.duplex": "双面",
        "confirm.sheets": "用纸",
        "duplex.long": "长边翻页",
        "duplex.short": "短边翻页",
        "duplex.none": "单面",
        "color.gray": "灰度",
        "color.color": "彩色",
        "msg.rendered": "已渲染 {pages} 页",
        "msg.renderedOne": "已渲染 1 页",
        "msg.printed": "已提交打印任务 {job}",
        "msg.printing": "打印中 · {queue}",
        "msg.completed": "已完成 · {pages} 页 / {sheets} 张",
        "msg.printUnknown": "任务已提交，但没有拿到状态回执",
        "zoom.hint": "第 {page} / {total} 页 · A4 · 点击任意处关闭",
        "hint.cmdEnter": "⌘↵ 渲染",
        "hint.chars": "{n} 字",
        "hint.template": "内置模板 v1",
        "hint.saved": "草稿已自动保存",
        "ticket.backBlank": "背面空白",
        "guard.summaryOk": "{n} 项全部通过",
        "guard.summaryMixed": "{ok} 项通过 · {warn} 项提示",
        "guard.summaryBad": "{bad} 项不通过",
        "error.prefix": "出错了",
                "guard.noPages": "没有生成任何页面",
        "guard.paperOk": "纸张 A4 · 与预览一致",
        "guard.paperMismatch": "纸张尺寸与 A4 不符",
        "guard.singleSided": "单面打印：{pages} 页 = {sheets} 张",
        "guard.duplexEven": "双面适配：{pages} 页 = {sheets} 张，正反面成对",
        "guard.duplexOdd": "奇数页：最后一张背面会空白",
        "guard.keepTogether": "题目与答法锁定（keep-together）",
        "guard.pageNumbers": "页脚页码 · 共 {pages} 页",
        "guard.pageNumbersMissing": "未生成页码（CDP 不可用，已退回命令行打印）",
        "style.title": "排版",
        "style.font": "字体",
        "style.size": "字号",
        "style.line": "行距",
        "style.margin": "边距",
        "style.columns": "栏数",
        "style.dirty": "未保存",
        "style.saved": "已保存到「{title}」",
        "style.revert": "撤销",
        "style.save": "保存",
        "style.saveAs": "另存为…",
"action.refresh": "刷新打印机",
        "unit.pages": "{n} 页",
        "unit.sheets": "{n} 张",
        "sheet.front": "正面 · 第 1 页",
        "sheet.back": "背面 · 第 2 页",
        "sheet.meta": "{sheets} 张 · {duplex}",
        "zoom.open": "放大第 {page} 页",
        "template.delete": "删除模板 {title}",
      },
      en: {
        "panel.title": "Print Studio",
        "panel.brand": "LECTURE WORKSHOP",
        "panel.subtitle": "Lay out text as a handout and print it. Tune the layout on the left, see pagination live on the right, then confirm the paper.",
        "label.template": "Template",
        "label.content": "Content",
        "label.preview": "Preview",
        "label.guards": "Layout guards",
        "label.sheet": "Sheet plan",
        "label.paper": "Paper",
        "label.pages": "Pages",
        "label.duplex": "Duplex",
        "label.sheets": "Sheets",
        "chip.new": "+ New template",
        "template.generic": "General handout",
        "template.new": "New layout template",
        "template.stamp": "NEW",
        "template.name": "Name",
        "template.namePh": "e.g. Speaking Q&A card",
        "template.subtitleLabel": "Subtitle (optional)",
        "template.subtitlePh": "One line printed under the title",
        "template.accent": "Accent",
        "template.lineHeight": "Line spacing",
        "template.margin": "Page margin",
        "template.size": "Body size",
        "template.font": "Font",
        "font.wenkai": "Wenkai",
        "font.song": "Serif",
        "font.kaiti": "Kai",
        "font.system": "Sans",
        "font.systemFonts": "System Fonts",
        "font.presetGroup": "Presets",
        "font.customPrompt": "Select system font…",
        "font.search": "Search fonts…",
        "font.noMatch": "No matching fonts",
        "font.recent": "Recent",
        "template.columns": "Columns",
        "template.one": "One",
        "template.two": "Two",
        "template.create": "Create and select",
        "template.created": "Created template \"{title}\"",
        "template.edit": "Edit",
        "template.reset": "Reset",
        "template.resetDone": "Restored the built-in template",
        "template.edited": "modified",
        "template.editTitle": "Edit layout template",
        "template.save": "Save changes",
        "template.updated": "Updated template \"{title}\"",
                "template.deleted": "Deleted template \"{title}\"",
        "format.p": "Normal",
        "format.h1": "Heading 1",
        "format.h2": "Heading 2",
        "format.h3": "Heading 3",
        "format.quote": "Quote",
        "btn.bold": "Bold (⌘B)",
        "btn.italic": "Italic (⌘I)",
        "btn.underline": "Underline (⌘U)",
        "btn.strike": "Strikethrough",
        "btn.alignLeft": "Align Left",
        "btn.alignCenter": "Align Center",
        "btn.alignRight": "Align Right",
        "btn.bulletList": "Bulleted List",
        "btn.numberList": "Numbered List",
        "btn.undo": "Undo (⌘Z)",
        "btn.redo": "Redo (⌘⇧Z)",
        "btn.preview": "Print preview",
        "btn.close": "Close",
        "editor.placeholder": "Write here. ⌘↵ shows page breaks; print when ready.",
        "btn.render": "Render preview",
        "btn.rerender": "Render again",
        "btn.print": "Print {pages} pages",
        "btn.printOne": "Print 1 page",
        "btn.printBlocked": "Print",
        "btn.cancel": "Cancel",
        "btn.confirmPrint": "Print now",
        "state.idle": "Not rendered",
        "state.rendering": "Rendering…",
        "state.ready": "Rendered",
        "state.dirty": "Pending",
        "state.printing": "Sending…",
        "state.done": "Printed",
        "empty.title": "Page breaks appear here after rendering",
        "empty.hint": "A4 · duplex · grayscale",
        "printer.none": "No printer found",
        "printer.disabled": "Disabled",
        "printer.idle": "Ready",
        "printer.processing": "Printing",
        "confirm.title": "Confirm print",
        "confirm.stamp": "PROOF",
        "confirm.warning": "Paper cannot be unsent. Check the document before printing.",
        "confirm.printer": "Printer",
        "confirm.paper": "Paper",
        "confirm.pages": "Pages",
        "confirm.duplex": "Duplex",
        "confirm.sheets": "Sheets",
        "duplex.long": "Long edge",
        "duplex.short": "Short edge",
        "duplex.none": "Single sided",
        "color.gray": "Grayscale",
        "color.color": "Color",
        "msg.rendered": "Rendered {pages} pages",
        "msg.renderedOne": "Rendered 1 page",
        "msg.printed": "Print job submitted: {job}",
        "msg.printing": "Printing · {queue}",
        "msg.completed": "Done · {pages} pages / {sheets} sheets",
        "msg.printUnknown": "Job submitted, but the queue returned no status",
        "zoom.hint": "Page {page} of {total} · A4 · click anywhere to close",
        "hint.cmdEnter": "⌘↵ render",
        "hint.saved": "Draft autosaved",
        "ticket.backBlank": "back blank",
        "guard.summaryOk": "All {n} checks passed",
        "guard.summaryMixed": "{ok} passed · {warn} warning",
        "guard.summaryBad": "{bad} failed",
        "hint.chars": "{n} chars",
        "hint.template": "Built-in template v1",
        "error.prefix": "Something went wrong",
                "guard.noPages": "No pages were produced",
        "guard.paperOk": "A4 · matches the preview",
        "guard.paperMismatch": "Page size is not A4",
        "guard.singleSided": "Single sided: {pages} pages = {sheets} sheet(s)",
        "guard.duplexEven": "Duplex fit: {pages} pages = {sheets} sheet(s), fronts and backs paired",
        "guard.duplexOdd": "Odd page count: the last sheet's back side stays blank",
        "guard.keepTogether": "Questions and answers locked together (keep-together)",
        "guard.pageNumbers": "Footer page numbers · {pages} page(s)",
        "guard.pageNumbersMissing": "Page numbers unavailable (CDP unavailable, fell back to CLI printing)",
        "style.title": "Layout",
        "style.font": "Font",
        "style.size": "Size",
        "style.line": "Line",
        "style.margin": "Margin",
        "style.columns": "Columns",
        "style.dirty": "unsaved",
        "style.saved": "Saved to \"{title}\"",
        "style.revert": "Revert",
        "style.save": "Save",
        "style.saveAs": "Save as…",
"action.refresh": "Refresh printers",
        "unit.pages": "{n} page(s)",
        "unit.sheets": "{n} sheet(s)",
        "sheet.front": "Front · page 1",
        "sheet.back": "Back · page 2",
        "sheet.meta": "{sheets} sheet(s) · {duplex}",
        "zoom.open": "Enlarge page {page}",
        "template.delete": "Delete template {title}",
      },
      ja: {
        "panel.title": "プリント工房",
        "panel.brand": "LECTURE WORKSHOP",
        "panel.subtitle": "テキストを配布資料として組版し、そのまま印刷します。テンプレートがレイアウトを、レンダラーがページ分割を担当し、最後に印刷を確認します。",
        "label.template": "テンプレート",
        "label.content": "内容",
        "label.preview": "プレビュー",
        "label.guards": "レイアウト検証",
        "label.sheet": "用紙配分",
        "label.paper": "用紙",
        "label.pages": "ページ数",
        "label.duplex": "両面",
        "label.sheets": "枚数",
        "chip.new": "+ 新規テンプレート",
        "btn.preview": "印刷プレビュー",
        "btn.close": "閉じる",
        "editor.placeholder": "ここに本文を書きます。⌘↵ で改ページを確認。",
        "btn.render": "プレビューを生成",
        "btn.rerender": "再生成",
        "btn.print": "{pages} ページを印刷",
        "btn.printOne": "1 ページを印刷",
        "btn.printBlocked": "印刷",
        "btn.cancel": "キャンセル",
        "btn.confirmPrint": "印刷する",
        "state.idle": "未生成",
        "state.rendering": "生成中…",
        "state.ready": "生成済み",
        "state.dirty": "更新待ち",
        "state.printing": "送信中…",
        "state.done": "印刷済み",
        "empty.title": "生成するとここにページ分割が表示されます",
        "empty.hint": "A4 · 両面 · グレースケール",
        "printer.none": "プリンターが見つかりません",
        "printer.disabled": "無効",
        "printer.idle": "待機中",
        "printer.processing": "印刷中",
        "confirm.title": "印刷の確認",
        "confirm.stamp": "校",
        "confirm.warning": "一度出紙すると取り消せません。用紙と内容を確認してください。",
        "confirm.printer": "プリンター",
        "confirm.paper": "用紙",
        "confirm.pages": "ページ",
        "confirm.duplex": "両面",
        "duplex.long": "長辺とじ",
        "duplex.short": "短辺とじ",
        "duplex.none": "片面",
        "color.gray": "グレースケール",
        "color.color": "カラー",
        "msg.rendered": "{pages} ページを生成しました",
        "msg.renderedOne": "1 ページを生成しました",
        "msg.printed": "印刷ジョブ {job} を送信しました",
        "msg.printing": "印刷中 · {queue}",
        "msg.completed": "完了 · {pages} ページ / {sheets} 枚",
        "msg.printUnknown": "ジョブは送信されましたが、状態を取得できませんでした",
        "hint.cmdEnter": "⌘↵ で生成",
        "hint.saved": "下書きは自動保存済み",
        "ticket.backBlank": "裏面は空白",
        "guard.summaryOk": "{n} 項目すべて合格",
        "guard.summaryMixed": "{ok} 項目合格 · {warn} 件の注意",
        "guard.summaryBad": "{bad} 項目が不合格",
        "hint.chars": "{n} 文字",
        "hint.template": "組み込みテンプレート v1",
        "error.prefix": "エラー",
                "guard.noPages": "ページが生成されませんでした",
        "guard.paperOk": "A4 · プレビューと一致",
        "guard.paperMismatch": "用紙サイズが A4 と異なります",
        "guard.singleSided": "片面印刷：{pages} ページ = {sheets} 枚",
        "guard.duplexEven": "両面対応：{pages} ページ = {sheets} 枚、表裏が揃っています",
        "guard.duplexOdd": "奇数ページ：最後の用紙の裏面は空白になります",
        "guard.keepTogether": "設問と解答を分断しない（keep-together）",
        "guard.pageNumbers": "フッターのページ番号 · 全 {pages} ページ",
        "guard.pageNumbersMissing": "ページ番号なし（CDP 利用不可のためコマンドライン印刷に切替）",
        "style.title": "レイアウト",
        "style.font": "フォント",
        "style.size": "サイズ",
        "style.line": "行間",
        "style.margin": "余白",
        "style.columns": "段",
        "style.dirty": "未保存",
        "style.saved": "「{title}」に保存しました",
        "style.revert": "元に戻す",
        "style.save": "保存",
        "style.saveAs": "別名で保存…",
"action.refresh": "プリンターを更新",
        "unit.pages": "{n} ページ",
        "unit.sheets": "{n} 枚",
        "sheet.front": "表 · 1 ページ",
        "sheet.back": "裏 · 2 ページ",
        "sheet.meta": "{sheets} 枚 · {duplex}",
        "zoom.open": "{page} ページを拡大",
        "template.delete": "テンプレート {title} を削除",
        "template.generic": "汎用資料",
        "template.new": "新しいレイアウトテンプレート",
        "template.stamp": "新",
        "template.name": "名前",
        "template.namePh": "例：スピーキング Q&A カード",
        "template.subtitleLabel": "サブタイトル（任意）",
        "template.subtitlePh": "タイトルの下に印刷される一行",
        "template.accent": "アクセント色",
        "template.lineHeight": "行間",
        "template.margin": "ページ余白",
        "template.size": "本文サイズ",
        "template.columns": "段組み",
        "template.font": "フォント",
        "font.wenkai": "文楷",
        "font.song": "明朝",
        "font.kaiti": "楷書",
        "font.system": "ゴシック",
        "font.systemFonts": "システムフォント",
        "font.presetGroup": "推奨フォント",
        "font.customPrompt": "システムフォントを選択…",
        "font.search": "フォントを検索…",
        "font.noMatch": "該当するフォントがありません",
        "font.recent": "最近使用したフォント",
        "template.one": "1 段",
        "template.two": "2 段",
        "template.create": "作成して選択",
        "template.created": "テンプレート「{title}」を作成しました",
                "template.deleted": "テンプレート「{title}」を削除しました",
        "format.p": "標準",
        "format.h1": "見出し 1",
        "format.h2": "見出し 2",
        "format.h3": "見出し 3",
        "format.quote": "引用",
        "btn.bold": "太字 (⌘B)",
        "btn.italic": "斜体 (⌘I)",
        "btn.underline": "下線 (⌘U)",
        "btn.strike": "取り消し線",
        "btn.alignLeft": "左揃え",
        "btn.alignCenter": "中央揃え",
        "btn.alignRight": "右揃え",
        "btn.bulletList": "箇条書き",
        "btn.numberList": "段落番号",
        "btn.undo": "元に戻す (⌘Z)",
        "btn.redo": "やり直し (⌘⇧Z)",
        "template.edit": "編集",
        "template.reset": "初期化",
        "template.resetDone": "組み込みテンプレートに戻しました",
        "template.edited": "変更済み",
        "template.editTitle": "レイアウトテンプレートを編集",
        "template.save": "変更を保存",
        "template.updated": "テンプレート「{title}」を更新しました",
        "zoom.loading": "高解像度を読み込み中…",
        "zoom.failed": "高解像度を取得できませんでした（サムネイルを表示）",
        "zoom.hint": "{page} / {total} ページ · A4 · クリックで閉じる",
      },
    };

    let localeApi = null;
    let boundTranslate = null;

    function preferredLang() {
      try {
        const lang = String(navigator.language || "en").toLowerCase();
        if (lang.startsWith("zh")) return "zh";
        if (lang.startsWith("ja")) return "ja";
        return "en";
      } catch {
        return "en";
      }
    }

    let activeLang = preferredLang();

    /** 取文案；参数用 {name} 占位。宿主 locale 可用时优先用它。 */
    function t(key, params) {
      let text;
      if (boundTranslate) {
        try {
          text = boundTranslate(key, params);
        } catch {
          text = undefined;
        }
      }
      // 宿主翻译服务查不到时会原样返回键名；那种情况要落到本地词典，
      // 否则界面会直接显示 guard.paperOk 这类内部标识。
      if (!text || text === key) text = DICT[activeLang]?.[key] ?? DICT.zh[key] ?? key;
      if (params) {
        for (const [k, v] of Object.entries(params)) text = text.replaceAll(`{${k}}`, String(v));
      }
      return text;
    }

    /**
     * 纸张上正文用的字体栈。与 lib/core.js 的 FONTS 保持一致：
     * 内置字体给多级兜底，自定义家族名则优先匹配它本身。
     * @param {string} font
     */
    function paperFontStack(font) {
      const value = String(font ?? "wenkai").trim();
      switch (value) {
        case "song":
          return '"Songti SC", "STSong", "Source Han Serif SC", "Hiragino Mincho ProN", serif';
        case "kaiti":
          return '"Kaiti SC", "STKaiti", "KaiTi", "LXGW WenKai", serif';
        case "system":
          return '-apple-system, "PingFang SC", "Helvetica Neue", "Segoe UI", sans-serif';
        case "wenkai":
          return '"LXGW WenKai", "Songti SC", "STSong", "Times New Roman", serif';
        default:
          return `"${value.replace(/["'\\]/g, "")}", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`;
      }
    }

    /* ============================== 富文本转义引擎 ============================== */

    /**
     * Markdown 转为可编辑的富文本 HTML，供 Word 编辑区初始化与模板载入。
     * @param {string} md
     * @returns {string}
     */

    function escapeHtml(text) {
      return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }

    /**
     * 行内标记转 HTML：转义之后再把 **粗体** / *斜体* / `代码` / ~~删除~~ 换回标签。
     * 为什么必须有：编辑区是唯一的真相，Markdown 里的强调如果在这里丢掉，
     * 屏幕上和 PDF 里就会留下字面的星号。
     */
    function inlineMd(text) {
      return escapeHtml(text)
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
        .replace(/~~([^~]+)~~/g, "<s>$1</s>");
    }

    /** 编辑区允许存在、且 PDF 侧也认的标签：段落、标题、列表、引用、行内强调、代码。 */
    const EDITABLE_TAGS = new Set([
      "P", "DIV", "H1", "H2", "H3", "H4", "UL", "OL", "LI", "BLOCKQUOTE",
      "STRONG", "B", "EM", "I", "U", "S", "STRIKE", "DEL", "CODE", "PRE", "BR", "HR", "SPAN",
    ]);

    /**
     * 把任意外部 HTML 洗成「编辑区和 PDF 都按同一套规则理解」的富文本。
     *
     * 为什么必须洗：屏幕上的纸面会老老实实认内联 font-family / font-size / color，
     * 而后端 core.sanitizeBodyHtml() 只保留 text-align。不洗就会出现「编辑区一个样、
     * 预览和 PDF 另一个样」，也正是用户眼里「字体改了没反应」。
     * 顺带挡掉脚本、事件属性、外链样式。
     * @param {string} html
     * @returns {string}
     */
    function sanitizeEditableHtml(html) {
      const source = String(html ?? "");
      if (!source.trim()) return "";
      const parsed = new DOMParser().parseFromString(source, "text/html");
      if (!parsed.body) return "";
      const BLOCK = new Set(["P", "DIV", "H1", "H2", "H3", "H4", "BLOCKQUOTE", "LI"]);
      const clean = (node) => {
        if (node.nodeType === 3) return escapeHtml(node.textContent);
        if (node.nodeType !== 1) return "";
        const tag = node.tagName;
        if (tag === "BR") return "<br>";
        if (tag === "HR") return "<hr>";
        const inner = Array.from(node.childNodes).map(clean).join("");
        if (!EDITABLE_TAGS.has(tag)) return inner; // 不认识的标签拆掉，只留文字
        // 只保留对齐信息，其余内联样式一律丢弃
        const align = (node.getAttribute("align") || "").toLowerCase();
        const styleAlign = /text-align\s*:\s*(left|center|right|justify)/i.exec(node.getAttribute("style") || "")?.[1];
        const textAlign = ["left", "center", "right", "justify"].includes(align) ? align : styleAlign ? styleAlign.toLowerCase() : "";
        const attr = BLOCK.has(tag) && textAlign ? ` style="text-align:${textAlign}"` : "";
        return `<${tag.toLowerCase()}${attr}>${inner}</${tag.toLowerCase()}>`;
      };
      return Array.from(parsed.body.childNodes).map(clean).join("").trim();
    }

    function markdownToHtml(md) {
      if (!md || !md.trim()) return "<p><br></p>";
      const lines = md.replace(/\r\n?/g, "\n").split("\n");
      const html = [];
      let inUl = false;
      let inOl = false;
      let inQuote = false;

      const closeLists = () => {
        if (inUl) { html.push("</ul>"); inUl = false; }
        if (inOl) { html.push("</ol>"); inOl = false; }
        if (inQuote) { html.push("</blockquote>"); inQuote = false; }
      };

      for (let i = 0; i < lines.length; i += 1) {
        const raw = lines[i];
        const s = raw.trim();
        if (!s) {
          closeLists();
          html.push("<p><br></p>");
          continue;
        }
        if (s.startsWith("# ")) {
          closeLists();
          html.push(`<h1>${inlineMd(s.slice(2))}</h1>`);
          continue;
        }
        if (s.startsWith("## ")) {
          closeLists();
          html.push(`<h2>${inlineMd(s.slice(3))}</h2>`);
          continue;
        }
        if (s.startsWith("### ")) {
          closeLists();
          html.push(`<h3>${inlineMd(s.slice(4))}</h3>`);
          continue;
        }
        if (s.startsWith("> ")) {
          if (!inQuote) {
            closeLists();
            html.push("<blockquote>");
            inQuote = true;
          }
          html.push(`<p>${inlineMd(s.slice(2))}</p>`);
          continue;
        }
        if (s.startsWith("- ") || s.startsWith("* ")) {
          if (!inUl) {
            closeLists();
            html.push("<ul>");
            inUl = true;
          }
          html.push(`<li>${inlineMd(s.slice(2))}</li>`);
          continue;
        }
        const olMatch = /^(\d+)\.\s+(.*)$/.exec(s);
        if (olMatch) {
          if (!inOl) {
            closeLists();
            html.push("<ol>");
            inOl = true;
          }
          html.push(`<li>${inlineMd(olMatch[2])}</li>`);
          continue;
        }
        closeLists();
        html.push(`<p>${inlineMd(raw)}</p>`);
      }
      closeLists();
      return html.join("");
    }

    /**
     * 将可编辑 DOM 节点的内容序列化为干净的标准 Markdown，供后端 Chrome 生成 PDF 打印。
     * @param {HTMLElement} root
     * @returns {string}
     */
    function domToMarkdown(root) {
      if (!root) return "";
      function walk(node) {
        if (node.nodeType === 3) return node.textContent; // TEXT_NODE
        if (node.nodeType !== 1) return ""; // ELEMENT_NODE
        const tag = node.tagName.toLowerCase();
        if (tag === "br") return "\n";
        if (tag === "h1") return `\n# ${inner(node).trim()}\n\n`;
        if (tag === "h2") return `\n## ${inner(node).trim()}\n\n`;
        if (tag === "h3") return `\n### ${inner(node).trim()}\n\n`;
        if (tag === "p") {
          const t = inner(node).trim();
          return t ? `${t}\n\n` : "\n";
        }
        if (tag === "blockquote") {
          const t = inner(node).trim();
          return `\n> ${t.replace(/\n/g, "\n> ")}\n\n`;
        }
        if (tag === "ul") {
          let out = "\n";
          for (let i = 0; i < node.children.length; i += 1) {
            out += `- ${inner(node.children[i]).trim()}\n`;
          }
          return `${out}\n`;
        }
        if (tag === "ol") {
          let out = "\n";
          for (let i = 0; i < node.children.length; i += 1) {
            out += `${i + 1}. ${inner(node.children[i]).trim()}\n`;
          }
          return `${out}\n`;
        }
        if (tag === "li") return inner(node);
        if (tag === "strong" || tag === "b") return `**${inner(node)}**`;
        if (tag === "em" || tag === "i") return `*${inner(node)}*`;
        if (tag === "u") return `<u>${inner(node)}</u>`;
        if (tag === "s" || tag === "strike" || tag === "del") return `~~${inner(node)}~~`;
        return inner(node);
      }
      function inner(el) {
        let out = "";
        for (let i = 0; i < el.childNodes.length; i += 1) {
          out += walk(el.childNodes[i]);
        }
        return out;
      }
      let result = "";
      for (let i = 0; i < root.childNodes.length; i += 1) {
        result += walk(root.childNodes[i]);
      }
      return result.replace(/\n{3,}/g, "\n\n").trim();
    }

    /* ================================ 样式 ================================ */

    const CSS = `
.ddoc-page {
  position: relative;
  height: 100%;
  max-height: 100vh;
  min-height: 0;
  overflow: hidden;
  padding: 18px 30px 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-family, inherit);
}
.ddoc-wrap {
  width: 100%; max-width: 1100px; margin: 0 auto;
  flex: 1 1 auto; min-height: 0;
  display: flex; flex-direction: column; gap: 14px;
}
.ddoc-head {
  display: flex; align-items: center; justify-content: space-between; gap: 16px; flex: none;
  position: sticky; top: 0; z-index: 5;
  height: 40px; padding: 0;
  background: color-mix(in srgb, var(--dsw-alias-bg-base, var(--dsw-alias-bg-layer-1)) 94%, transparent);
  backdrop-filter: blur(8px) saturate(1.2);
}
.ddoc-brand { display: flex; align-items: center; gap: 11px; }
.ddoc-mark {
  width: 9px; height: 9px; flex: none; transform: rotate(45deg);
  background: ${ACCENT};
}
.ddoc-title {
  margin: 0; font-size: 22px; line-height: 1; font-weight: 600; letter-spacing: .03em;
  font-family: "Songti SC", "STSong", var(--dsw-font-family, serif);
}
.ddoc-title em {
  font-style: normal; font-size: 9px; font-weight: 400; letter-spacing: .18em;
  color: var(--dsw-alias-label-tertiary); margin-left: 10px; text-transform: uppercase;
  font-family: var(--dsw-font-family-code, ui-monospace, monospace);
  vertical-align: 2px;
}
.ddoc-status {
  display: flex; align-items: center; gap: 8px; flex: none; height: 30px;
  font-size: 11px; color: var(--dsw-alias-label-secondary);
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px;
  padding: 0 12px 0 10px; background: var(--dsw-alias-bg-layer-1);
  font-family: var(--dsw-font-family-code, ui-monospace, monospace);
}
.ddoc-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-success-primary); flex: none; }
.ddoc-dot--warn { background: var(--dsw-alias-state-warn-primary); }
.ddoc-dot--bad { background: var(--dsw-alias-state-error-primary); }

/* ── 单栏书写台：工具栏在上，A4 纸居中在下 ──────────────── */
.ddoc-workspace { display: flex; flex-direction: column; gap: 14px; flex: 1 1 auto; min-height: 0; }
.ddoc-tools {
  border: 1px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-lg, 12px);
  background: var(--dsw-alias-bg-layer-1); padding: 12px 16px 10px;
  display: flex; flex-direction: column; gap: 8px; flex: none;
}
.ddoc-tools-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.ddoc-desk {
  flex: 1 1 auto; min-height: 0; overflow: auto; overscroll-behavior: contain;
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 2px 4px 6px;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--dsw-alias-label-tertiary) 55%, transparent) transparent;
}
.ddoc-desk::-webkit-scrollbar { width: 10px; }
.ddoc-desk::-webkit-scrollbar-track { background: transparent; }
.ddoc-desk::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--dsw-alias-label-tertiary) 45%, transparent);
  border-radius: 999px; border: 3px solid transparent; background-clip: content-box;
}
.ddoc-desk::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--dsw-alias-label-tertiary) 70%, transparent);
  background-clip: content-box;
}
.ddoc-paper {
  box-sizing: border-box;
  background: #fffdf7; color: #1c211d;
  border: 1px solid #e0dbcd; border-radius: 2px;
  box-shadow: 0 1px 2px rgba(0,0,0,.06), 0 26px 52px -30px rgba(0,0,0,.38);
  display: flex; flex-direction: column; flex: none;
}
.ddoc-paper-input {
  flex: 1 1 auto; width: 100%; box-sizing: border-box; min-height: 100%;
  border: 0; outline: none; resize: none; background: transparent;
  color: inherit; padding: 0; display: block;
  letter-spacing: .01em;
}
.ddoc-paper-input::placeholder { color: #a9a598; }
.ddoc-ribbon {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 8px 0; border-top: 1px solid var(--dsw-alias-border-l1);
}
.ddoc-ribbon-grp {
  display: inline-flex; align-items: center; gap: 2px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px;
  background: var(--dsw-alias-bg-layer-2); overflow: hidden; padding: 2px;
}
.ddoc-ribbon-btn {
  appearance: none; border: 0; background: none; cursor: pointer; user-select: none;
  padding: 4px 7px; border-radius: 5px; font-size: 11.5px; line-height: 1.2;
  color: var(--dsw-alias-label-secondary); display: inline-flex; align-items: center; justify-content: center;
  min-width: 24px; height: 24px; box-sizing: border-box; font-family: inherit;
}
.ddoc-ribbon-btn:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06));
  color: var(--dsw-alias-label-primary);
}
.ddoc-ribbon-btn:active {
  background: var(--dsw-alias-interactive-bg-active, rgba(0,0,0,.12));
}
.ddoc-ribbon-select {
  appearance: none; border: 0; background: none; cursor: pointer;
  padding: 4px 8px; font-size: 11.5px; color: var(--dsw-alias-label-secondary);
  outline: none; font-family: inherit;
}
.ddoc-ribbon-select:hover { color: var(--dsw-alias-label-primary); }

.ddoc-word-canvas {
  width: 100%; box-sizing: border-box; min-height: calc(297mm - 36mm);
  outline: none; word-break: break-word; color: inherit;
}
.ddoc-word-canvas:focus { outline: none; }
/* 强制所有非代码块子元素继承纸面字体：无论用户粘贴了带内联 font-family 的富文本，
   还是 DSH 外壳全局 CSS 污染了 h1/h2/p，编辑区字形都能与顶部字体选择实时同步。
   注意别把 inherit !important 加到 .ddoc-word-canvas 自己身上——那会盖掉外层
   写进来的内联 font-family，字体反而永远变不了。 */
.ddoc-word-canvas *:not(code):not(pre) {
  font-family: inherit !important;
}
.ddoc-word-canvas code,
.ddoc-word-canvas pre {
  font-family: var(--dsw-font-family-code, ui-monospace, monospace) !important;
}
.ddoc-word-canvas h1 { font-size: 1.85em; font-weight: 700; margin: 0.6em 0 0.3em; line-height: 1.25; }
.ddoc-word-canvas h2 { font-size: 1.4em; font-weight: 600; margin: 0.55em 0 0.28em; line-height: 1.3; }
.ddoc-word-canvas h3 { font-size: 1.15em; font-weight: 600; margin: 0.5em 0 0.25em; line-height: 1.35; }
.ddoc-word-canvas p { margin: 0 0 0.65em; }
.ddoc-word-canvas blockquote {
  margin: 0.6em 0; padding: 4px 12px; border-left: 3px solid var(--dsw-alias-border-l3, #999);
  color: var(--dsw-alias-label-secondary); background: rgba(0,0,0,0.02); border-radius: 0 4px 4px 0;
}
.ddoc-word-canvas ul, .ddoc-word-canvas ol { margin: 0 0 0.65em; padding-left: 22px; }
.ddoc-word-canvas li { margin-bottom: 0.2em; }

.ddoc-paper-foot {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  font-size: 10px; letter-spacing: .04em; color: var(--dsw-alias-label-tertiary);
  font-family: var(--dsw-font-family-code, ui-monospace, monospace);
  white-space: nowrap;
}
.ddoc-paper-foot b { font-weight: 500; color: var(--dsw-alias-label-secondary); }
.ddoc-modal.ddoc-modal--preview {
  width: min(1420px, 95vw); height: min(94vh, 1180px);
  display: flex; flex-direction: column; overflow: hidden;
}
.ddoc-modal--preview .ddoc-modal-head { flex: none; }
.ddoc-modal-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.ddoc-pv-warn {
  margin-top: auto; padding-top: 12px; border-top: 1px solid var(--dsw-alias-border-l1);
  font-size: 10.5px; line-height: 1.5; color: var(--dsw-alias-label-tertiary);
}
.ddoc-pv-body {
  flex: 1 1 auto; min-height: 0; display: grid;
  grid-template-columns: minmax(0, 1fr) 268px;
}
.ddoc-pv-canvas {
  min-height: 0; min-width: 0; overflow: auto; overscroll-behavior: contain;
  /* 这里必须是普通块容器：一旦用 flex 居中，内容比可视区高时第一页的页首会被
     居中算法推到滚动区上方，用户永远看不到标题——「第一页显示不完整」就是这个。 */
  display: block;
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-2) 90%, #efece2);
}
/* 页面列表自己撑高、自己居中：内容不溢出时垂直居中，溢出时从顶部开始排。 */
.ddoc-pv-pages {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 20px; width: 100%; min-height: 100%; box-sizing: border-box;
  padding: 22px;
}
.ddoc-pv-sheet {
  display: block; flex: none; margin: 0 auto;
  height: var(--pv-sheet-h, 72vh); aspect-ratio: 210 / 297;
  background: none; border: 0; padding: 0; cursor: zoom-in;
}
.ddoc-pv-sheet img {
  width: 100%; height: 100%; object-fit: contain; display: block;
  background: #fff; border: 1px solid #ddd8cb; border-radius: 2px;
  box-shadow: 0 2px 4px rgba(0,0,0,.08), 0 28px 56px -26px rgba(0,0,0,.45);
  transition: box-shadow 140ms ease, transform 140ms ease;
}
.ddoc-pv-sheet:hover img {
  transform: translateY(-1px);
  box-shadow: 0 3px 6px rgba(0,0,0,.10), 0 32px 62px -26px rgba(0,0,0,.5);
}
.ddoc-pv-facts {
  display: grid; grid-template-columns: auto 1fr; gap: 6px 10px; margin-top: 14px;
  padding-top: 12px; border-top: 1px solid var(--dsw-alias-border-l1);
  font-size: 11px; color: var(--dsw-alias-label-secondary);
}
.ddoc-pv-facts span {
  font-size: 9px; letter-spacing: .12em; text-transform: uppercase;
  color: var(--dsw-alias-label-tertiary);
  font-family: var(--dsw-font-family-code, ui-monospace, monospace);
}
.ddoc-pv-facts b { font-weight: 500; color: var(--dsw-alias-label-primary); text-align: right; }
.ddoc-pv-note {
  font-size: 10.5px; color: var(--dsw-alias-label-tertiary);
  font-family: var(--dsw-font-family-code, ui-monospace, monospace);
}
@media (max-width: 1100px) {
  .ddoc-modal.ddoc-modal--preview { height: min(96vh, 1180px); }
  .ddoc-pv-body { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto; }
  .ddoc-pv-side {
    border-left: 0; border-top: 1px solid var(--dsw-alias-border-l1);
    max-height: 26vh; padding: 10px 16px 12px; gap: 6px;
  }
  .ddoc-pv-facts { display: none; }
  .ddoc-pv-pages { padding: 14px; }
  .ddoc-pv-sheet { height: var(--pv-sheet-h, 56vh); }
}
.ddoc-pv-side {
  min-height: 0; overflow: auto; border-left: 1px solid var(--dsw-alias-border-l1);
  padding: 14px 16px 18px; display: flex; flex-direction: column; gap: 10px;
  background: var(--dsw-alias-bg-layer-1);
}
.ddoc-pv-empty {
  height: 100%; display: flex; align-items: center; justify-content: center;
  padding: 22px; box-sizing: border-box;
}

@media (max-width: 980px) {
  .ddoc-page { overflow: auto; height: auto; max-height: none; padding-bottom: 22px; }
  .ddoc-actions { position: static; display: flex; gap: 8px; justify-content: flex-end; }
  .ddoc-head { position: static; }
  .ddoc-wrap { flex: none; min-height: 0; }
  .ddoc-desk { min-height: 260px; overflow: visible; }
}

.ddoc-lab {
  display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
  font-size: 9.5px; letter-spacing: .18em; text-transform: uppercase;
  color: var(--dsw-alias-label-tertiary);
}
.ddoc-lab b {
  font-size: 10.5px; font-weight: 500; letter-spacing: .01em; text-transform: none;
  color: var(--dsw-alias-label-secondary);
  font-family: var(--dsw-font-family-code, ui-monospace, monospace);
}
.ddoc-chips { display: flex; flex-wrap: wrap; gap: 7px; }
.ddoc-chip {
  appearance: none; font: inherit; font-size: 11.5px; cursor: pointer;
  padding: 6px 11px; border-radius: 8px; letter-spacing: .01em;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary);
}
.ddoc-chip[aria-pressed="true"] {
  border-color: color-mix(in srgb, ${ACCENT} 62%, transparent);
  background: color-mix(in srgb, ${ACCENT} 12%, var(--dsw-alias-bg-layer-1));
  color: color-mix(in srgb, ${ACCENT} 82%, var(--dsw-alias-label-primary));
  font-weight: 600;
}
.ddoc-link {
  appearance: none; border: 0; background: none; padding: 0; margin: 0;
  font: inherit; font-size: 10.5px; letter-spacing: .02em; cursor: pointer;
  color: color-mix(in srgb, ${ACCENT} 78%, var(--dsw-alias-label-primary));
  text-transform: none;
}
.ddoc-link:hover { text-decoration: underline; }
.ddoc-chip--ghost { border-style: dashed; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.ddoc-chip--ghost:hover { border-color: color-mix(in srgb, ${ACCENT} 40%, var(--dsw-alias-border-l2)); color: color-mix(in srgb, ${ACCENT} 70%, var(--dsw-alias-label-primary)); }
.ddoc-chip[role="button"] { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; }
.ddoc-chip[role="button"]:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, currentColor); outline-offset: 2px; }
.ddoc-chip-x {
  appearance: none; border: 0; background: none; padding: 0 2px; margin-right: -3px;
  font: inherit; font-size: 13px; line-height: 1; color: var(--dsw-alias-label-tertiary); cursor: pointer;
}
.ddoc-chip-x:hover { color: var(--dsw-alias-state-error-primary); }

.ddoc-modal--form { width: 380px; }
.ddoc-fields { padding: 6px 16px 4px; display: flex; flex-direction: column; gap: 12px; }
.ddoc-field { display: flex; flex-direction: column; gap: 5px; }
.ddoc-field > label {
  font-size: 9px; letter-spacing: .12em; text-transform: uppercase;
  color: var(--dsw-alias-label-tertiary);
  font-family: var(--dsw-font-family-code, ui-monospace, monospace);
}
.ddoc-input {
  appearance: none; font: inherit; font-size: 12px; width: 100%; box-sizing: border-box;
  padding: 7px 9px; border-radius: 7px; outline: none;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
}
.ddoc-input:focus { border-color: var(--dsw-focus-ring-color, var(--dsw-alias-border-l3)); }
.ddoc-swatches { display: flex; gap: 8px; }
.ddoc-swatch {
  appearance: none; width: 26px; height: 26px; border-radius: 7px; cursor: pointer;
  border: 2px solid transparent; box-shadow: inset 0 0 0 1px rgba(0,0,0,.10);
}
.ddoc-swatch[aria-pressed="true"] { border-color: var(--dsw-alias-label-primary); }
.ddoc-seg { display: inline-flex; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; overflow: hidden; width: fit-content; }
.ddoc-seg button {
  appearance: none; font: inherit; font-size: 11.5px; padding: 6px 16px; cursor: pointer;
  border: 0; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary);
}
.ddoc-seg button + button { border-left: 1px solid var(--dsw-alias-border-l2); }
.ddoc-seg button[aria-pressed="true"] {
  background: color-mix(in srgb, ${ACCENT} 12%, var(--dsw-alias-bg-layer-1));
  color: color-mix(in srgb, ${ACCENT} 82%, var(--dsw-alias-label-primary)); font-weight: 600;
}

/* ── 排版控制条（排版尺） ─────────────────────────────────── */
.ddoc-ruler {
  display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
  padding: 8px 0; border-top: 1px solid var(--dsw-alias-border-l1); border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.ddoc-ruler-grp { display: flex; align-items: center; gap: 8px; padding: 0; }
.ddoc-ruler-grp:first-child { padding-left: 0; }
.ddoc-ruler-grp > label {
  font: 9px/1 var(--dsw-font-family-code, ui-monospace, monospace);
  letter-spacing: .14em; text-transform: uppercase;
  color: var(--dsw-alias-label-tertiary);
}
.ddoc-ruler-sep { display: none; }
.ddoc-seg2 {
  display: inline-flex; border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 7px; overflow: hidden; background: var(--dsw-alias-bg-layer-2);
}
.ddoc-seg2 button {
  appearance: none; border: 0; cursor: pointer; font: inherit; font-size: 11px;
  padding: 5px 9px; background: transparent;
  color: var(--dsw-alias-label-secondary);
}
.ddoc-seg2 button + button { border-left: 1px solid var(--dsw-alias-border-l2); }
.ddoc-seg2 button[aria-pressed="true"] {
  background: color-mix(in srgb, ${ACCENT} 14%, var(--dsw-alias-bg-layer-1));
  color: color-mix(in srgb, ${ACCENT} 82%, var(--dsw-alias-label-primary));
  font-weight: 600;
}
.ddoc-font-select {
  appearance: none; font: inherit; font-size: 11px;
  height: 25px; line-height: 23px; box-sizing: border-box;
  padding: 0 20px 0 8px; border-radius: 7px;
  border: 1px solid var(--dsw-alias-border-l2);
  background-color: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  cursor: pointer; outline: none;
  max-width: 135px;
  text-overflow: ellipsis; white-space: nowrap;
  background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="8" height="5" viewBox="0 0 8 5"><path fill="%238A8F84" d="M0 0l4 4 4-4z"/></svg>');
  background-repeat: no-repeat;
  background-position: right 7px center;
  transition: border-color .15s ease, background-color .15s ease, color .15s ease;
}
.ddoc-font-select:hover {
  border-color: var(--dsw-alias-border-l3, var(--dsw-alias-label-tertiary));
  color: var(--dsw-alias-label-primary);
}
.ddoc-font-select:focus {
  border-color: var(--dsw-focus-ring-color, color-mix(in srgb, ${ACCENT} 60%, transparent));
}
.ddoc-font-select.ddoc-font-select--active {
  border-color: color-mix(in srgb, ${ACCENT} 62%, transparent);
  background-color: color-mix(in srgb, ${ACCENT} 14%, var(--dsw-alias-bg-layer-1));
  color: color-mix(in srgb, ${ACCENT} 85%, var(--dsw-alias-label-primary));
  font-weight: 600;
  background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="8" height="5" viewBox="0 0 8 5"><path fill="%231F5C3F" d="M0 0l4 4 4-4z"/></svg>');
}
.ddoc-font-select optgroup {
  font-weight: 700;
  color: var(--dsw-alias-label-tertiary);
  background: var(--dsw-alias-bg-layer-1);
}
.ddoc-font-select option {
  font-weight: 400;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-1);
}

.ddoc-font-picker { position: relative; display: inline-block; }
.ddoc-font-popover {
  position: absolute; z-index: 100; top: calc(100% + 4px); right: 0;
  width: 236px; padding: 6px; border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l2);
  box-shadow: 0 6px 18px rgba(0,0,0,.18);
}
.ddoc-font-popover .ddoc-input { margin-bottom: 6px; }
.ddoc-font-list {
  list-style: none; padding: 0; margin: 0; max-height: 260px; overflow-y: auto;
}
.ddoc-font-list li {
  display: flex; align-items: baseline; gap: 6px;
  padding: 6px 8px; border-radius: 4px; cursor: pointer; font-size: 11px;
  color: var(--dsw-alias-label-secondary);
}
.ddoc-font-list li.active { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.ddoc-font-list li.on { background: color-mix(in srgb, ${ACCENT} 12%, var(--dsw-alias-bg-layer-1)); color: ${ACCENT}; font-weight: 600; }
.ddoc-font-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ddoc-font-hint {
  font-size: 9.5px; color: var(--dsw-alias-label-tertiary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ddoc-font-list li.on .ddoc-font-hint { color: color-mix(in srgb, ${ACCENT} 60%, var(--dsw-alias-label-tertiary)); }
.ddoc-font-header {
  font-size: 9.5px; font-weight: 700; color: var(--dsw-alias-label-tertiary);
  padding: 4px 8px; cursor: default; pointer-events: none;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  margin-top: 4px;
}
.ddoc-font-list li:first-child.ddoc-font-header { margin-top: 0; }
.ddoc-font-empty {

  padding: 10px 8px; font-size: 10.5px; color: var(--dsw-alias-label-tertiary); text-align: center;
}

.ddoc-stepper {
  display: inline-flex; align-items: center; gap: 0;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px;
  background: var(--dsw-alias-bg-layer-2); overflow: hidden;
}
.ddoc-stepper button {
  appearance: none; border: 0; background: none; cursor: pointer;
  font: inherit; font-size: 14px; line-height: 1; padding: 5px 9px;
  color: var(--dsw-alias-label-secondary);
}
.ddoc-stepper button:hover:not(:disabled) { background: rgba(0,0,0,0.06); color: var(--dsw-alias-label-primary); }
.ddoc-stepper button:disabled { opacity: .3; cursor: default; }
.ddoc-stepper b {
  min-width: 38px; text-align: center; font-size: 11px; font-weight: 600;
  color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-family-code, ui-monospace, monospace);
  font-variant-numeric: tabular-nums;
}
.ddoc-ruler-dirty {
  display: inline-flex; align-items: center; gap: 7px; margin-left: auto;
}
.ddoc-badge {
  font: 9px/1 var(--dsw-font-family-code, ui-monospace, monospace);
  letter-spacing: .1em; text-transform: uppercase;
  padding: 3px 6px; border-radius: 4px;
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 18%, transparent);
  color: var(--dsw-alias-state-warn-primary);
}
.ddoc-mini {
  appearance: none; cursor: pointer; font: inherit; font-size: 11px; font-weight: 600;
  padding: 5px 10px; border-radius: 7px;
  border: 1px solid color-mix(in srgb, ${ACCENT} 50%, transparent);
  background: color-mix(in srgb, ${ACCENT} 12%, var(--dsw-alias-bg-layer-1));
  color: color-mix(in srgb, ${ACCENT} 85%, var(--dsw-alias-label-primary));
}
.ddoc-mini--ghost {
  border-color: var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
}

/* ── 加载态：一张还没显影的纸 ─────────────────────────────── */
/* 还没有样张时，直接用一张按 A4 比例的幽灵页占位：
   与真实缩略图同尺寸、同纸色、同投影，渲染完成后是「同一张纸显影」，不是换了个面板。 */
.ddoc-ghost {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 11px; padding: 4px 0; max-width: 100%;
}
.ddoc-sheet {
  position: relative; overflow: hidden; box-sizing: border-box;
  width: clamp(150px, 52%, 210px); aspect-ratio: 210 / 297;
  padding: 13% 12%;
  display: flex; flex-direction: column;
  background: #fffdf7; border: 1px solid #ddd8cb; border-radius: 2px;
  box-shadow: 0 1px 2px rgba(0,0,0,.07), 0 18px 34px -18px rgba(0,0,0,.34);
}
.ddoc-sheet-flow { display: flex; flex-direction: column; gap: 4.4%; flex: 1; }
.ddoc-sheet-flow i {
  display: block; height: 2.4%; border-radius: 1px;
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 12%, transparent);
}
.ddoc-sheet-flow i.ddoc-flow-title { height: 5.2%; background: color-mix(in srgb, ${ACCENT} 32%, transparent); }
.ddoc-sheet-flow i.ddoc-flow-meta { height: 2%; width: 36%; }
.ddoc-sheet-flow i.ddoc-flow-gap { height: 0; background: none; }
.ddoc-ghost:not(.is-working) .ddoc-sheet-flow i { opacity: .5; }
.ddoc-ghost.is-working .ddoc-sheet-flow i { animation: ddoc-flow 1.7s ease-in-out infinite; }
.ddoc-ghost.is-working .ddoc-sheet-flow i:nth-child(2n) { animation-delay: .28s; }
.ddoc-ghost.is-working .ddoc-sheet-flow i:nth-child(3n) { animation-delay: .52s; }
.ddoc-sheet-scan {
  position: absolute; inset: 0 0 auto; height: 38%; pointer-events: none; opacity: 0;
  background: linear-gradient(
    to bottom,
    transparent,
    color-mix(in srgb, ${ACCENT} 12%, transparent) 58%,
    transparent
  );
}
.ddoc-ghost.is-working .ddoc-sheet-scan { opacity: 1; animation: ddoc-scan 2.3s cubic-bezier(.45,0,.55,1) infinite; }
@keyframes ddoc-flow { 0%, 100% { opacity: .5; } 50% { opacity: 1; } }
@keyframes ddoc-scan { from { transform: translateY(-46%); } to { transform: translateY(286%); } }
.ddoc-ghost-cap { display: flex; align-items: center; gap: 7px; font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.ddoc-ghost-cap strong { font-weight: 500; }
.ddoc-ghost-hint {
  font-size: 9.5px; letter-spacing: .1em; text-transform: uppercase;
  color: var(--dsw-alias-label-tertiary);
  font-family: var(--dsw-font-family-code, ui-monospace, monospace);
}

/* ── 校验 ─────────────────────────────────────────────────── */
.ddoc-guards { display: flex; flex-direction: column; margin-top: 4px; }
.ddoc-rules { display: flex; flex-direction: column; }
.ddoc-rule {
  display: flex; align-items: center; gap: 8px; padding: 6px 0;
  font-size: 11px; color: var(--dsw-alias-label-secondary);
  border-bottom: 1px dotted var(--dsw-alias-border-l1);
}
.ddoc-rule:last-child { border-bottom: 0; }
.ddoc-grow {
  display: flex; align-items: center; gap: 8px; padding: 6px 0;
  font-size: 11px; color: var(--dsw-alias-label-secondary);
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.ddoc-grow:last-child { border-bottom: 0; }
.ddoc-gl {
  width: 14px; flex: none; font-size: 11px; font-weight: 700; line-height: 1; text-align: center;
}
.ddoc-gl--ok { color: ${ACCENT}; }
.ddoc-gl--warn { color: var(--dsw-alias-state-warn-primary); }
.ddoc-gl--bad { color: var(--dsw-alias-state-error-primary); }
/* ── 印张条（底栏） ───────────────────────────────────────── */
.ddoc-actions {
  display: flex; align-items: center; gap: 14px; flex: none;
  position: sticky; bottom: 0; z-index: 6;
  padding: 12px 0 14px;
  border-top: 1px solid var(--dsw-alias-border-l1);
  background: color-mix(in srgb, var(--dsw-alias-bg-base, var(--dsw-alias-bg-layer-1)) 94%, transparent);
  backdrop-filter: blur(8px) saturate(1.2);
}
.ddoc-ticket { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; }
.ddoc-faces { display: flex; gap: 3px; flex: none; }
.ddoc-faces i {
  width: 12px; height: 16px; border-radius: 1.5px; display: block;
  border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1);
}
.ddoc-faces i.f { background: color-mix(in srgb, ${ACCENT} 16%, var(--dsw-alias-bg-layer-1)); border-color: color-mix(in srgb, ${ACCENT} 50%, var(--dsw-alias-border-l2)); }
.ddoc-faces i.b { border-style: dashed; }
.ddoc-facts {
  font-family: var(--dsw-font-family-code, ui-monospace, monospace);
  font-size: 11px; color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ddoc-facts b { color: var(--dsw-alias-label-primary); font-weight: 600; }
.ddoc-facts .sep { color: var(--dsw-alias-border-l2); margin: 0 6px; }
.ddoc-state-pill {
  font-family: var(--dsw-font-family-code, ui-monospace, monospace);
  font-size: 9.5px; letter-spacing: .06em; padding: 3px 8px; border-radius: 5px;
  background: color-mix(in srgb, ${ACCENT} 14%, transparent);
  color: color-mix(in srgb, ${ACCENT} 82%, var(--dsw-alias-label-primary));
  font-weight: 500; white-space: nowrap;
}
.ddoc-btns { display: flex; gap: 9px; margin-left: auto; flex: none; }
.ddoc-btn {
  appearance: none; font: inherit; font-size: 12px; font-weight: 600; letter-spacing: .02em;
  height: 36px; padding: 0 16px; border-radius: 8px; cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
}
.ddoc-btn:disabled { opacity: .45; cursor: not-allowed; }
.ddoc-btn--primary {
  border-color: transparent; color: #fff; background: ${ACCENT};
  box-shadow: 0 5px 12px -7px rgba(31,92,63,.85);
}
.ddoc-btn--primary:disabled { background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-tertiary); box-shadow: none; }
.ddoc-btn--ghost {
  border-color: var(--dsw-alias-border-l2); background: transparent; color: var(--dsw-alias-label-secondary);
}
.ddoc-note {
  flex: none;
  font-size: 11px; line-height: 1.55; color: var(--dsw-alias-label-secondary);
  border-left: 2px solid var(--dsw-alias-state-warn-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 9%, transparent);
  padding: 8px 10px; border-radius: 0 7px 7px 0;
  word-break: break-word; overflow-wrap: anywhere;
}
.ddoc-note b { font-weight: 600; }
.ddoc-note--bad { border-color: var(--dsw-alias-state-error-primary); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 9%, transparent); }
.ddoc-mono { font-family: var(--dsw-font-family-code, ui-monospace, monospace); font-size: 10px; letter-spacing: .02em; }

.ddoc-scrim {
  position: fixed; inset: 0; z-index: 40;
  background: rgba(20, 24, 20, .32);
  display: grid; place-items: center; padding: 20px;
  backdrop-filter: blur(2px);
}
.ddoc-modal {
  width: 340px; border-radius: 14px; overflow: hidden;
  background: var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1));
  border: 1px solid var(--dsw-alias-border-l1);
  box-shadow: 0 2px 4px rgba(0,0,0,.10), 0 30px 60px -24px rgba(0,0,0,.55);
}
.ddoc-modal-head { display: flex; align-items: center; gap: 9px; padding: 14px 16px 11px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.ddoc-modal-head h3 { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: .04em; font-family: "Songti SC", "STSong", var(--dsw-font-family, serif); }
.ddoc-stamp {
  margin-left: auto; font-size: 9.5px; letter-spacing: .16em; padding: 1px 5px; border-radius: 3px;
  border: 1px solid ${SEAL}; color: ${SEAL}; transform: rotate(-4deg);
}
.ddoc-modal-warn {
  margin: 0 16px 13px; padding: 7px 9px; border-radius: 7px; font-size: 10.5px; line-height: 1.55;
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, transparent);
  color: var(--dsw-alias-label-secondary);
}
.ddoc-modal-foot { display: flex; gap: 8px; padding: 0 16px 15px; }
.ddoc-modal-foot .ddoc-btn { flex: 1; height: 34px; font-size: 12px; justify-content: center; }

.ddoc-lightbox {
  position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 28px;
  background: rgba(12, 16, 14, .58); backdrop-filter: blur(3px); cursor: zoom-out;
}
.ddoc-lightbox figure { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 10px; }
.ddoc-lightbox img {
  max-width: min(920px, 92vw); max-height: 82vh; width: auto; height: auto;
  background: #fff; border-radius: 3px;
  box-shadow: 0 2px 6px rgba(0,0,0,.2), 0 40px 90px -34px rgba(0,0,0,.7);
}
.ddoc-lightbox figcaption {
  font-size: 10px; letter-spacing: .1em; text-transform: uppercase;
  color: rgba(255,255,255,.72); font-family: var(--dsw-font-family-code, ui-monospace, monospace);
}
.ddoc-spin { width: 12px; height: 12px; border-radius: 50%; border: 2px solid currentColor; border-right-color: transparent; animation: ddoc-spin .7s linear infinite; }
@keyframes ddoc-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .ddoc-spin { animation-duration: 2s; }
  .ddoc-ghost.is-working .ddoc-sheet-flow i { animation: none; opacity: .85; }
  .ddoc-ghost.is-working .ddoc-sheet-scan { animation: none; opacity: .55; }
}
`;

    /* ============================== 数据访问 ============================== */

    /**
     * 调宿主路由，统一把失败转成可读错误。
     * @param {string} path
     * @param {{method?: string, body?: unknown}} [options]
     */
    async function api(path, options = {}) {
      const method = options.method ?? "GET";
      const response = await fetch(`${API}/${path}`, {
        method,
        credentials: "same-origin",
        headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      let data = {};
      try {
        data = await response.json();
      } catch {
        data = {};
      }
      if (!response.ok || data.ok === false) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      return data;
    }

    /** 示例内容：一首居中排的古典诗，直接给出富文本 HTML，与纸面排版一致。 */
    const SAMPLE_HTML = `<p style="text-align:center"><b>春江花月夜</b></p>
<p style="text-align:center">唐 · 张若虚</p>
<p style="text-align:center">春江潮水连海平，海上明月共潮生。</p>
<p style="text-align:center">滟滟随波千万里，何处春江无月明？</p>
<p style="text-align:center">江流宛转绕芳甸，月照花林皆似霰。</p>
<p style="text-align:center">空里流霜不觉飞，汀上白沙看不见。</p>
<p style="text-align:center">江天一色无纤尘，皎皎空中孤月轮。</p>
<p style="text-align:center">江畔何人初见月，江月何年初照人？</p>
<p style="text-align:center">人生代代无穷已，江月年年望相似。</p>
<p style="text-align:center">不知江月待何人？但见长江送流水。</p>
<p style="text-align:center">白云一片去悠悠，青枫浦上不胜愁。</p>
<p style="text-align:center">谁家今夜扁舟子，何处相思明月楼？</p>
<p style="text-align:center">可怜楼上月徘徊，应照离人妆镜台。</p>
<p style="text-align:center">玉户帘中卷不去，捣衣砧上拂还来。</p>
<p style="text-align:center">此时相望不相闻，愿逐月华流照君。</p>
<p style="text-align:center">鸿雁长飞光不度，鱼龙潜跃水成文。</p>
<p style="text-align:center">昨夜闲潭梦落花，可怜春半不还家。</p>
<p style="text-align:center">江水流春去欲尽，江潭落月复西斜。</p>
<p style="text-align:center">斜月沉沉藏海雾，碣石潇湘无限路。</p>
<p style="text-align:center">不知乘月几人归，落月摇情满江树。</p>`;

    /* ================================ 图标 ================================ */

    function PanelIcon(props) {
      const size = props && Number.isFinite(props.size) ? props.size : 18;
      const canvas = size + 4;
      return h(
        "svg",
        {
          width: canvas,
          height: canvas,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.6,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          role: "img",
          "aria-label": t("panel.title"),
          style: { flex: "none" },
        },
        // 顶部进纸
        h("path", { d: "M6.5 9V3.5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1V9" }),
        // 机身
        h("rect", { x: 2.5, y: 8.5, width: 19, height: 8.5, rx: 2.2 }),
        // 状态灯
        h("circle", { cx: 17.5, cy: 11.8, r: 0.8, fill: "currentColor", stroke: "none" }),
        // 出纸托盘
        h("path", { d: "M6 14v6.5a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V14" }),
        // 已排好的两行
        h("path", { d: "M8.5 17.5h7M8.5 19.5h4.5" }),
      );
    }

    /** 表单行：标签 + 控件。 */
    function fieldRow(label, control) {
      return h("div", { className: "ddoc-field" }, h("label", null, label), control);
    }

    /* ============================== 错误边界 ============================== */

    /**
     * 面板级错误边界。slot 条目抛异常会整块空白，这里至少把原因留在页面上。
     */
    class PanelBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }
      static getDerivedStateFromError(error) {
        return { error: String(error?.message ?? error) };
      }
      render() {
        if (this.state.error) {
          return h(
            "div",
            { className: "ddoc-page" },
            h(
              "div",
              { className: "ddoc-note ddoc-note--bad", style: { margin: "24px auto", maxWidth: 720 } },
              h("b", null, `${t("error.prefix")}：`),
              this.state.error,
            ),
          );
        }
        return this.props.children;
      }
    }

    /* ================================ 页面 ================================ */

      /**
       * 字体检索：家族名与本地化别名（如 LXGW WenKai ↔ 霞鹜文楷）都能命中。
       * 匹配时忽略大小写与空白，`pingfang`、`霞鹜`、`文楷` 都能搜到。
       */
      function normalizeQuery(text) {
        return String(text ?? "")
          .toLowerCase()
          .replace(/[\s\-_·]+/g, "");
      }

      function FontPicker({ value, onChange, options, aliases }) {
        const [open, setOpen] = useState(false);
        const [filter, setFilter] = useState("");
        const [active, setActive] = useState(0);
        const [recent, setRecent] = useState([]);
        const containerRef = useRef(null);
        const inputRef = useRef(null);
        const listRef = useRef(null);

        useEffect(() => {
          const raw = localStorage.getItem("dsh-doc:recent-fonts");
          if (raw) {
            try {
              setRecent(JSON.parse(raw));
            } catch {}
          }
        }, []);

        const saveRecent = (font) => {
          setRecent((prev) => {
            const next = [font, ...prev.filter((f) => f !== font)].slice(0, 8);
            localStorage.setItem("dsh-doc:recent-fonts", JSON.stringify(next));
            return next;
          });
        };


        const matches = useCallback(
          (name) => {
            const q = normalizeQuery(filter);
            if (!q) return true;
            if (normalizeQuery(name).includes(q)) return true;
            const list = aliases?.[name];
            return Array.isArray(list) && list.some((alias) => normalizeQuery(alias).includes(q));
          },
          [filter, aliases],
        );

        const filtered = useMemo(() => options.filter((name) => matches(name)), [options, matches]);

        // 键盘选中项越界时回到首行
        useEffect(() => {
          setActive((current) => (current < filtered.length ? current : 0));
        }, [filtered.length]);

        useEffect(() => {
          if (!open) return undefined;
          const onPointerDown = (event) => {
            if (containerRef.current && !containerRef.current.contains(event.target)) setOpen(false);
          };
          document.addEventListener("mousedown", onPointerDown);
          return () => document.removeEventListener("mousedown", onPointerDown);
        }, [open]);

        const close = () => {
          setOpen(false);
          setFilter("");
          setActive(0);
        };

        const commit = (name) => {
          if (!name) return;
          onChange(name);
          saveRecent(name);
          close();
        };


        const onKeyDown = (event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            close();
            return;
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (filtered.length === 0) return;
            const step = event.key === "ArrowDown" ? 1 : -1;
            setActive((current) => (current + step + filtered.length) % filtered.length);
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            commit(filtered[active]);
          }
        };

        // 别名只用于搜索和提示，选中后存的仍是家族名（Chromium 认的是它）
        const hintOf = (name) => {
          const list = aliases?.[name];
          if (!Array.isArray(list) || list.length === 0) return "";
          return list.slice().sort((a, b) => a.length - b.length)[0] ?? "";
        };

        const isPreset = ["wenkai", "song", "kaiti", "system"].includes(value);

        return h(
          "div",
          { className: "ddoc-font-picker", ref: containerRef },
          h(
            "button",
            {
              type: "button",
              className: `ddoc-font-select${open || !isPreset ? " ddoc-font-select--active" : ""}`,
              "aria-label": t("font.systemFonts"),
              "aria-expanded": open ? "true" : "false",
              title: isPreset ? t("font.customPrompt") : value,
              onClick: () => {
                if (open) {
                  close();
                  return;
                }
                setOpen(true);
                setTimeout(() => inputRef.current?.focus(), 30);
              },
            },
            isPreset ? t(`font.${value}`) : value,
          ),
          open
            ? h(
                "div",
                { className: "ddoc-font-popover", role: "dialog", "aria-label": t("font.systemFonts") },
                h("input", {
                  ref: inputRef,
                  className: "ddoc-input",
                  placeholder: t("font.search"),
                  value: filter,
                  onChange: (event) => {
                    setFilter(event.target.value);
                    setActive(0);
                  },
                  onKeyDown,
                }),
                filtered.length === 0
                  ? h("div", { className: "ddoc-font-empty" }, t("font.noMatch"))
                  : h(
                      "ul",
                      { className: "ddoc-font-list", ref: listRef },
                      !filter && recent.length > 0
                        ? [
                            h("li", { key: "header-recent", className: "ddoc-font-header" }, t("font.recent")),
                            ...recent.map((name, i) => {
                              const hint = hintOf(name);
                              const idx = i;
                              return h(
                                "li",
                                {
                                  key: name,
                                  className: [name === value ? "on" : "", idx === active ? "active" : ""]
                                    .filter(Boolean)
                                    .join(" "),
                                  title: hint ? `${name} · ${hint}` : name,
                                  onMouseEnter: () => setActive(idx),
                                  onClick: () => commit(name),
                                },
                                h("span", { className: "ddoc-font-name" }, name),
                                hint ? h("span", { className: "ddoc-font-hint" }, hint) : null,
                              );
                            }),
                            h("li", { key: "header-all", className: "ddoc-font-header" }, t("font.systemFonts")),
                          ]
                        : null,
                      filtered.map((name, index) => {
                        const hint = hintOf(name);
                        const actualIndex = !filter && recent.length > 0 ? index + recent.length + 2 : index;
                        return h(
                          "li",
                          {
                            key: name,
                            className: [name === value ? "on" : "", actualIndex === active ? "active" : ""]
                              .filter(Boolean)
                              .join(" "),
                            title: hint ? `${name} · ${hint}` : name,
                            onMouseEnter: () => setActive(actualIndex),
                            onClick: () => commit(name),
                          },
                          h("span", { className: "ddoc-font-name" }, name),
                          hint ? h("span", { className: "ddoc-font-hint" }, hint) : null,
                        );
                      }),
                    ),

              )
            : null,
        );
      }

  
    /**
     * Word 风格 A4 纸张富文本编辑器。
     * 直接在纸面上输入，所见即所得，支持标准 Word 快捷键与 Markdown 智能输入扩展。
     */
    function WordPaperEditor(props) {
      const { value, initialHtml, onChange, onCmdEnter, style, editorRef } = props;
      const internalRef = useRef(null);
      const lastValue = useRef(value);
      /** 首次挂载：有草稿 HTML 就用它还原原有格式，否则从 markdown 生成。 */
      const seeded = useRef(false);
      const seededHtml = useRef("");

      useEffect(() => {
        const el = internalRef.current;
        if (!el) return;
        if (editorRef) editorRef.current = el;
        // 草稿/示例的富文本到位时，用它还原格式（只认一次，之后纸面就是唯一真相）
        if (initialHtml && initialHtml.trim() && initialHtml !== seededHtml.current) {
          seededHtml.current = initialHtml;
          seeded.current = true;
          // 旧草稿里可能带着内联 font-family/font-size：先洗成纸面认的样式再上屏
          el.innerHTML = sanitizeEditableHtml(initialHtml) || markdownToHtml(value);
          lastValue.current = domToMarkdown(el);
          onChange?.(lastValue.current);
          return;
        }
        if (!seeded.current) {
          seeded.current = true;
          el.innerHTML = markdownToHtml(value);
          lastValue.current = value;
          return;
        }
        // 只在内容真被外部替换时重灌 DOM；自己发出的改动不再回灌，否则光标会跳回行首
        if (value === lastValue.current && el.innerHTML !== "") return;
        el.innerHTML = markdownToHtml(value);
        lastValue.current = value;
      }, [value, initialHtml, editorRef, onChange]);

      const handleInput = useCallback(() => {
        const el = internalRef.current;
        if (!el) return;
        const md = domToMarkdown(el);
        lastValue.current = md;
        onChange?.(md);
      }, [onChange]);

      const handleKeyDown = useCallback((event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.preventDefault();
          onCmdEnter?.();
          return;
        }
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
          event.preventDefault();
          document.execCommand(event.shiftKey ? "redo" : "undo");
          handleInput();
          return;
        }
        if ((event.metaKey || event.ctrlKey) && event.key === "b") {
          event.preventDefault();
          document.execCommand("bold");
          handleInput();
          return;
        }
        if ((event.metaKey || event.ctrlKey) && event.key === "i") {
          event.preventDefault();
          document.execCommand("italic");
          handleInput();
          return;
        }
        if ((event.metaKey || event.ctrlKey) && event.key === "u") {
          event.preventDefault();
          document.execCommand("underline");
          handleInput();
          return;
        }
        // 空格键触发 Markdown 行首语法转义
        if (event.key === " ") {
          const sel = window.getSelection();
          if (sel && sel.isCollapsed && sel.anchorNode) {
            const textNode = sel.anchorNode;
            if (textNode.nodeType === 3) {
              const text = textNode.textContent.slice(0, sel.anchorOffset);
              if (text === "#") {
                event.preventDefault();
                textNode.textContent = textNode.textContent.slice(sel.anchorOffset);
                document.execCommand("formatBlock", false, "<h1>");
                handleInput();
                return;
              }
              if (text === "##") {
                event.preventDefault();
                textNode.textContent = textNode.textContent.slice(sel.anchorOffset);
                document.execCommand("formatBlock", false, "<h2>");
                handleInput();
                return;
              }
              if (text === "###") {
                event.preventDefault();
                textNode.textContent = textNode.textContent.slice(sel.anchorOffset);
                document.execCommand("formatBlock", false, "<h3>");
                handleInput();
                return;
              }
              if (text === "-" || text === "*") {
                event.preventDefault();
                textNode.textContent = textNode.textContent.slice(sel.anchorOffset);
                document.execCommand("insertUnorderedList");
                handleInput();
                return;
              }
              if (/^\d+\.$/.test(text)) {
                event.preventDefault();
                textNode.textContent = textNode.textContent.slice(sel.anchorOffset);
                document.execCommand("insertOrderedList");
                handleInput();
                return;
              }
              if (text === ">") {
                event.preventDefault();
                textNode.textContent = textNode.textContent.slice(sel.anchorOffset);
                document.execCommand("formatBlock", false, "<blockquote>");
                handleInput();
                return;
              }
            }
          }
        }
      }, [handleInput, onCmdEnter]);

      /**
       * 粘贴：浏览器给的富文本先过一遍 sanitizeEditableHtml，再插进纸面。
       * 这样外部样式（font-family/font-size/color）不会把纸面排版锁死。
       */
      const handlePaste = useCallback((event) => {
        const html = event.clipboardData?.getData("text/html");
        if (!html) return;
        const body = sanitizeEditableHtml(html);
        if (!body.trim()) return; // 没有可用结构就走浏览器默认粘贴
        event.preventDefault();
        document.execCommand("insertHTML", false, body);
        handleInput();
      }, [handleInput]);

      return h("div", {
        ref: internalRef,
        className: "ddoc-word-canvas",
        contentEditable: true,
        suppressContentEditableWarning: true,
        spellCheck: false,
        onInput: handleInput,
        onKeyDown: handleKeyDown,
        onPaste: handlePaste,
        style,
      });
    }

    function StudioPage(props) {
      const [status, setStatus] = useState(null);
      const [statusError, setStatusError] = useState(null);
      const [template, setTemplate] = useState("generic");
      const [markdown, setMarkdown] = useState("");
      const [result, setResult] = useState(null);
      const [rendering, setRendering] = useState(false);
      const [printing, setPrinting] = useState(false);
      const [job, setJob] = useState(null);
      const [jobState, setJobState] = useState(null);
      const [error, setError] = useState(null);
      const [notice, setNotice] = useState(null);
      const [zoom, setZoom] = useState(null);
      const [draft, setDraft] = useState(null);
      /** 界面上正在预览的排版参数；与已保存模板不同时才算「未保存」。 */
      const [styleDraft, setStyleDraft] = useState(null);
      const [templateBusy, setTemplateBusy] = useState(false);
      const [templateError, setTemplateError] = useState(null);
      const [renderedInput, setRenderedInput] = useState(null);
      const [systemFonts, setSystemFonts] = useState([]);
      const [fontAliases, setFontAliases] = useState({});
      const [booted, setBooted] = useState(false);
      const [previewOpen, setPreviewOpen] = useState(false);
      /** 草稿里存的富文本 HTML；编辑器首次挂载时用它还原格式。 */
      const [initialHtml, setInitialHtml] = useState("");
      /** 纸张按容器宽度等比缩放，保证 1mm 就是 1mm。 */
      const [paperZoom, setPaperZoom] = useState(1);
      const bootedRef = useRef(false);
      const pollRef = useRef(null);
      const editorRef = useRef(null);
      const deskRef = useRef(null);
      const pvCanvasRef = useRef(null);
      /** 预览页高度按容器实测，保证 A4 比例且不溢出。 */
      const [pvSheetH, setPvSheetH] = useState(0);

      /** 工具栏命令：只作用在当前选区上，执行后把纸面同步回 markdown。 */
      const execCmd = useCallback((cmd, arg = null) => {
        const el = editorRef.current;
        if (!el) return;
        el.focus();
        document.execCommand(cmd, false, arg);
        setMarkdown(domToMarkdown(el));
      }, []);

      /** 工具栏按钮：mousedown 阻止默认，选区才不会在点击时被收掉。 */
      const cmdButton = (label, cmd, extraStyle, title) =>
        h(
          "button",
          {
            type: "button",
            className: "ddoc-ribbon-btn",
            style: extraStyle || undefined,
            title,
            "aria-label": title,
            onMouseDown: (event) => event.preventDefault(),
            onClick: () => execCmd(cmd),
          },
          label,
        );

      const loadStatus = useCallback(async () => {
        try {
          const data = await api("status");
          setStatus(data);
          if (Array.isArray(data.systemFonts) && data.systemFonts.length > 0) {
            setSystemFonts(data.systemFonts);
          }
          if (data.fontAliases && typeof data.fontAliases === "object") {
            setFontAliases(data.fontAliases);
          }
          setStatusError(null);
          if (!bootedRef.current) {
            bootedRef.current = true;
            const saved = data.draft && typeof data.draft.markdown === "string" ? data.draft.markdown : "";
            const savedHtml = data.draft && typeof data.draft.html === "string" ? data.draft.html : "";
            if (saved.trim()) {
              setInitialHtml(savedHtml);
              setMarkdown(saved);
            } else {
              setInitialHtml(SAMPLE_HTML);
              setMarkdown("");
            }
            setBooted(true);
          }
        } catch (err) {
          setStatusError(String(err?.message ?? err));
          if (!bootedRef.current) {
            bootedRef.current = true;
            if (!bootedRef.current) return;
            setInitialHtml((current) => current || SAMPLE_HTML);
            setBooted(true);
          }
        }
      }, []);

      useEffect(() => {
        loadStatus();
      }, [loadStatus]);

      // 确保系统字体列表就绪；若浏览器支持 Local Font Access API 也尝试增量补充
      useEffect(() => {
        let cancelled = false;
        if (systemFonts.length === 0) {
          api("fonts")
            .then((data) => {
              if (cancelled) return;
              if (Array.isArray(data?.fonts) && data.fonts.length > 0) {
                setSystemFonts(data.fonts);
              }
              if (data?.aliases && typeof data.aliases === "object") {
                setFontAliases(data.aliases);
              }
            })
            .catch(() => {});
        }
        if (typeof window !== "undefined" && typeof window.queryLocalFonts === "function") {
          window
            .queryLocalFonts()
            .then((localFonts) => {
              if (cancelled || !Array.isArray(localFonts) || localFonts.length === 0) return;
              setSystemFonts((prev) => {
                const set = new Set(prev);
                for (const f of localFonts) {
                  if (f.family) set.add(f.family);
                }
                return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
              });
            })
            .catch(() => {});
        }
        return () => {
          cancelled = true;
        };
      }, [systemFonts.length]);

      // 草稿存宿主侧：换端口、换浏览器、重启 App 都还在
      useEffect(() => {
        if (!booted) return undefined;
        const timer = setTimeout(() => {
          api("draft", {
            method: "POST",
            body: { markdown, html: editorRef.current?.innerHTML ?? "" },
          }).catch(() => {});
        }, 800);
        return () => clearTimeout(timer);
      }, [markdown, booted]);

      useEffect(() => {
        if (!notice) return undefined;
        const timer = setTimeout(() => setNotice(null), 6000);
        return () => clearTimeout(timer);
      }, [notice]);

      // 打印任务轮询：只在「处理中」时才跑
      useEffect(() => {
        if (!job || jobState === "completed" || jobState === "unknown") return undefined;
        let cancelled = false;
        const tick = async () => {
          try {
            const data = await api(`job?queue=${encodeURIComponent(job.queue)}&id=${encodeURIComponent(job.id)}`);
            if (cancelled) return;
            if (data.state === "completed" || data.state === "unknown") {
              setJobState(data.state);
            }
          } catch {
            /* 轮询失败不打断 UI，下一次再试 */
          }
        };
        pollRef.current = setInterval(tick, 2000);
        return () => {
          cancelled = true;
          if (pollRef.current) clearInterval(pollRef.current);
        };
      }, [job, jobState]);

      const printer = useMemo(() => {
        if (!status) return null;
        const list = status.printers ?? [];
        return list.find((item) => item.queue === status.defaultQueue) ?? list[0] ?? null;
      }, [status]);

      const templates = useMemo(() => {
        const list = status?.templates;
        if (Array.isArray(list) && list.length) return list;
        return [{ id: "generic", title: "通用讲义", subtitle: "", accent: "#1F5C3F", fontSize: 10.5, columns: 1, builtIn: true }];
      }, [status]);

      const styleOf = useCallback(
        (tpl) =>
          tpl
            ? {
                font: tpl.font ?? "wenkai",
                fontSize: tpl.fontSize ?? 10.5,
                lineHeight: tpl.lineHeight ?? 1.55,
                margin: tpl.margin ?? 18,
                columns: tpl.columns ?? 1,
              }
            : null,
        [],
      );

      const activeTemplate = useMemo(
        () => templates.find((item) => item.id === template) ?? templates[0],
        [templates, template],
      );

      // 换模板时把样式草稿重置为该模板的已保存值
      useEffect(() => {
        const next = styleOf(activeTemplate);
        if (!next) return;
        setStyleDraft((prev) => (prev && prev.__for === activeTemplate?.id ? prev : { ...next, __for: activeTemplate?.id }));
      }, [activeTemplate, styleOf]);

      /** 样式草稿与模板已保存值是否有差异。 */
      const styleDirty = useMemo(() => {
        if (!styleDraft || !activeTemplate) return false;
        const saved = styleOf(activeTemplate);
        return ["font", "fontSize", "lineHeight", "margin", "columns"].some(
          (key) => String(styleDraft[key]) !== String(saved[key]),
        );
      }, [styleDraft, activeTemplate, styleOf]);

      /** 版式指纹：改动字号/行距/边距/栏数后，旧样张就作废。 */
      const styleSig = styleDraft
        ? `${styleDraft.font}|${styleDraft.fontSize}|${styleDraft.lineHeight}|${styleDraft.margin}|${styleDraft.columns}`
        : "";

      const chars = useMemo(() => markdown.replace(/\s/g, "").length, [markdown]);

      /** 渲染一次并返回结果；失败返回 null，让调用方（预览/打印）自己决定后续。 */
      const doRender = useCallback(async () => {
        if (rendering) return null;
        setRendering(true);
        setError(null);
        setJob(null);
        setJobState(null);
        try {
          const html = editorRef.current?.innerHTML ?? "";
          const data = await api("render", {
            method: "POST",
            body: { markdown, html, template, style: styleDraft },
          });
          setResult(data);
          // 记下这一版「渲染出去的纸面 HTML」：判断样张是否过期时要连它一起比，
          // 否则像居中这类不进 markdown 的格式改动会被当成「没变」。
          setRenderedInput({ markdown, html, template, style: styleDraft, styleSig });
          setNotice(data.pages === 1 ? t("msg.renderedOne") : t("msg.rendered", { pages: data.pages }));
          return data;
        } catch (err) {
          setError(String(err?.message ?? err));
          return null;
        } finally {
          setRendering(false);
        }
      }, [markdown, rendering, template, styleDraft]);

      // 预览弹窗：量出画布高度，让整页正好铺满且保持 A4 比例；
      // 同时把滚动位置拉回顶部——打开预览就该从页首开始看（多页时尤其重要）。
      useEffect(() => {
        if (!previewOpen) return undefined;
        const canvas = pvCanvasRef.current;
        if (!canvas) return undefined;
        const fit = () => {
          // 上下各 22px 内边距，一页刚好完整落在可视区内
          const h = canvas.clientHeight - 44;
          if (h > 0) setPvSheetH((prev) => (Math.abs(prev - h) < 1 ? prev : h));
        };
        canvas.scrollTop = 0;
        const timer = setTimeout(fit, 30);
        fit();
        if (typeof ResizeObserver !== "function") {
          window.addEventListener("resize", fit);
          return () => {
            clearTimeout(timer);
            window.removeEventListener("resize", fit);
          };
        }
        const observer = new ResizeObserver(fit);
        observer.observe(canvas);
        return () => {
          clearTimeout(timer);
          observer.disconnect();
        };
      }, [previewOpen, result]);

      // 纸张等比缩放到容器宽度：缩的是显示尺寸，排版尺寸仍是真实 A4
      useEffect(() => {
        const desk = deskRef.current;
        if (!desk) return undefined;
        const fit = () => {
          const avail = desk.clientWidth - 4;
          if (!avail) return;
          const next = Math.min(1, Math.max(0.45, avail / 800));
          setPaperZoom((prev) => (Math.abs(prev - next) < 0.005 ? prev : next));
        };
        fit();
        if (typeof ResizeObserver !== "function") {
          window.addEventListener("resize", fit);
          return () => window.removeEventListener("resize", fit);
        }
        const observer = new ResizeObserver(fit);
        observer.observe(desk);
        return () => observer.disconnect();
      }, [booted]);

      useEffect(() => {
        if (!zoom && !previewOpen) return undefined;
        const onKey = (event) => {
          if (event.key !== "Escape") return;
          if (zoom) setZoom(null);
          else setPreviewOpen(false);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
      }, [zoom, previewOpen]);

      /** 把当前样式草稿写回选中的模板（内置写覆盖项）。 */
      const saveStyle = useCallback(async () => {
        if (!activeTemplate || !styleDraft || templateBusy) return;
        setTemplateBusy(true);
        setError(null);
        try {
          const body = {
            action: "update",
            id: activeTemplate.id,
            template: {
              ...activeTemplate,
              font: styleDraft.font,
              fontSize: styleDraft.fontSize,
              lineHeight: styleDraft.lineHeight,
              margin: styleDraft.margin,
              columns: styleDraft.columns,
            },
          };
          const data = await api("templates", { method: "POST", body });
          setStatus((prev) => (prev ? { ...prev, templates: data.templates } : prev));
          setNotice(t("style.saved", { title: data.template.title }));
        } catch (err) {
          setError(String(err?.message ?? err));
        } finally {
          setTemplateBusy(false);
        }
      }, [activeTemplate, styleDraft, templateBusy]);

      /** 丢弃未保存的调整，回到模板已保存的版式。 */
      const revertStyle = useCallback(() => {
        const next = styleOf(activeTemplate);
        if (next) setStyleDraft({ ...next, __for: activeTemplate?.id });
      }, [activeTemplate, styleOf]);

      /** 单个排版字段改一个增量。 */
      const bumpStyle = useCallback((key, delta, min, max, step) => {
        setStyleDraft((prev) => {
          if (!prev) return prev;
          const raw = Number(prev[key]) + delta;
          const clamped = Math.min(max, Math.max(min, raw));
          const value = Math.round(clamped / step) * step;
          return { ...prev, [key]: Math.round(value * 100) / 100 };
        });
      }, []);

      const saveTemplate = useCallback(async () => {
        if (!draft || !draft.title.trim() || templateBusy) return;
        setTemplateBusy(true);
        setTemplateError(null);
        const editing = Boolean(draft.id);
        try {
          const data = await api("templates", {
            method: "POST",
            body: editing
              ? { action: "update", id: draft.id, template: draft }
              : { action: "create", template: draft },
          });
          setStatus((prev) => (prev ? { ...prev, templates: data.templates } : prev));
          setTemplate(data.template.id);
          setDraft(null);
          setNotice(
            editing
              ? t("template.updated", { title: data.template.title })
              : t("template.created", { title: data.template.title }),
          );
        } catch (err) {
          setTemplateError(String(err?.message ?? err));
        } finally {
          setTemplateBusy(false);
        }
      }, [draft, templateBusy]);

      const resetTemplate = useCallback(async (tpl) => {
        try {
          const data = await api("templates", {
            method: "POST",
            body: { action: "reset", id: tpl.id },
          });
          setStatus((prev) => (prev ? { ...prev, templates: data.templates } : prev));
          setNotice(t("template.resetDone"));
        } catch (err) {
          setError(String(err?.message ?? err));
        }
      }, []);

      const deleteTemplate = useCallback(
        async (tpl) => {
          try {
            const data = await api("templates", {
              method: "POST",
              body: { action: "delete", id: tpl.id },
            });
            setStatus((prev) => (prev ? { ...prev, templates: data.templates } : prev));
            setTemplate((current) => (current === tpl.id ? "generic" : current));
            setNotice(t("template.deleted", { title: tpl.title }));
          } catch (err) {
            setError(String(err?.message ?? err));
          }
        },
        [],
      );

      // 改了字或换了模板就不再自动跑 Chrome：预览与打印各自按需渲染

      // 比较当前纸面与上次渲染出去的那一版：markdown、模板、版式、以及纸面 HTML
      // （对齐、行内格式这类不进 markdown 的改动靠它兜住）
      const dirty =
        Boolean(result && renderedInput) &&
        (markdown !== renderedInput.markdown ||
          template !== renderedInput.template ||
          styleSig !== renderedInput.styleSig ||
          (editorRef.current?.innerHTML ?? "") !== (renderedInput.html ?? ""));

      /** 纸张上的排版参数：没改过就用模板存的值。 */
      const marginMm = styleDraft?.margin ?? activeTemplate?.margin ?? 18;
      const fontSize = styleDraft?.fontSize ?? activeTemplate?.fontSize ?? 10.5;
      const lineHeight = styleDraft?.lineHeight ?? activeTemplate?.lineHeight ?? 1.55;
      const columns = styleDraft?.columns ?? activeTemplate?.columns ?? 1;

      const openZoom = useCallback((preview) => {
        setZoom({ page: preview.page, dataUrl: preview.dataUrl });
      }, []);

      /**
       * 预览：纸面/版式没变就复用上一次的样张，变了才重渲。
       * 用户点一次预览要等一次 Chrome 出图，能不重跑就不重跑。
       */
      const openPreview = useCallback(async () => {
        if (rendering) return;
        setPreviewOpen(true);
        if (!markdown.trim()) return;
        if (result && !dirty) return;
        await doRender();
      }, [dirty, doRender, markdown, rendering, result]);

      /** 打印流程的第一步：按当前纸面渲一版，然后打开预览让用户核对后再出纸。 */
      const requestPrint = useCallback(async () => {
        if (printing) return;
        setPreviewOpen(true);
        if (!markdown.trim()) return;
        if (result && !dirty) return;
        await doRender();
      }, [dirty, doRender, markdown, printing, result]);

      const doPrint = useCallback(async () => {
        if (!result || printing) return;
        setPrinting(true);
        setError(null);
        try {
          const data = await api("print", {
            method: "POST",
            body: {
              id: result.id,
              printer: printer?.queue,
              duplex: status?.defaults?.duplex,
              color: status?.defaults?.color,
              media: status?.defaults?.media,
              title: result.title,
            },
          });
          setJob({ id: data.jobId, queue: data.queue, pages: data.pages, sheets: data.sheets });
          setJobState("processing");
          setNotice(t("msg.printed", { job: data.jobId ?? "—" }));
          // 任务已经交给打印机，预览弹窗的使命结束了：关掉它，回到主界面看回执。
          // 出错时保持打开，让用户在原来的位置看到错误。
          setPreviewOpen(false);
        } catch (err) {
          setError(String(err?.message ?? err));
        } finally {
          setPrinting(false);
        }
      }, [printing, printer, result, status]);

      const duplexText = useMemo(() => {
        const value = status?.defaults?.duplex ?? "long";
        return t(`duplex.${value}`);
      }, [status]);

      const pages = result?.pages ?? 0;
      const sheets = result?.sheets ?? 0;

      const stateChip = (() => {
        if (printing) return { text: t("state.printing"), dot: "ddoc-dot ddoc-dot--warn" };
        if (rendering) return { text: t("state.rendering"), dot: "ddoc-dot ddoc-dot--warn" };
        if (jobState === "completed") return { text: t("state.done"), dot: "ddoc-dot" };
        if (jobState === "processing") return { text: t("state.printing"), dot: "ddoc-dot ddoc-dot--warn" };
        if (result) return { text: t("state.ready"), dot: "ddoc-dot" };
        return { text: t("state.idle"), dot: "ddoc-dot ddoc-dot--warn" };
      })();

      const guardSummary = (() => {
        if (!result || !Array.isArray(result.guards) || result.guards.length === 0) return "";
        const ok = result.guards.filter((g) => g.level === "ok").length;
        const warn = result.guards.filter((g) => g.level === "warn").length;
        const bad = result.guards.length - ok - warn;
        if (bad > 0) return t("guard.summaryBad", { bad });
        if (warn === 0) return t("guard.summaryOk", { n: ok });
        return t("guard.summaryMixed", { ok, warn });
      })();

      const printerLabel = (() => {
        if (statusError) return t("printer.none");
        if (!printer) return t("printer.none");
        return printer.queue;
      })();

      const printerDot = (() => {
        if (statusError || !printer) return "ddoc-dot ddoc-dot--bad";
        if (printer.state === "disabled") return "ddoc-dot ddoc-dot--bad";
        if (printer.state === "processing") return "ddoc-dot ddoc-dot--warn";
        return "ddoc-dot";
      })();

      return h(
        "div",
        { className: "ddoc-page" },
        h(
          "div",
          { className: "ddoc-wrap" },
          // ── 头部 ──────────────────────────────────────────────
          h(
            "header",
            { className: "ddoc-head" },
            h(
              "div",
              { className: "ddoc-brand" },
              h("span", { className: "ddoc-mark", "aria-hidden": "true" }),
              h(
                "h1",
                { className: "ddoc-title" },
                t("panel.title"),
                h("em", null, t("panel.brand")),
              ),
            ),
            h(
              "button",
              {
                type: "button",
                className: "ddoc-status",
                onClick: loadStatus,
                title: t("action.refresh"),
                style: { cursor: "pointer", font: "inherit" },
              },
              h("span", { className: printerDot, "aria-hidden": "true" }),
              printerLabel,
            ),
          ),

          // ── 工作台 ────────────────────────────────────────────
          h(
            "div",
            { className: "ddoc-workspace" },
            h(
              "section",
              { className: "ddoc-tools" },
              h(
                "div",
                { className: "ddoc-lab" },
                h("span", null, t("label.template")),
                activeTemplate && activeTemplate.edited
                  ? h(
                      "button",
                      {
                        type: "button",
                        className: "ddoc-link",
                        onClick: () => resetTemplate(activeTemplate),
                      },
                      t("template.reset"),
                    )
                  : null,
              ),
              h(
                "div",
                { className: "ddoc-chips" },
                ...templates.map((tpl) => {
                  const active = template === tpl.id;
                  const base = tpl.builtIn && tpl.id === "generic" ? t("template.generic") : tpl.title;
                  const label = tpl.edited ? `${base} · ${t("template.edited")}` : base;
                  return h(
                    "div",
                    {
                      key: tpl.id,
                      className: "ddoc-chip",
                      role: "button",
                      tabIndex: 0,
                      "aria-pressed": active ? "true" : "false",
                      onClick: () => setTemplate(tpl.id),
                      onKeyDown: (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setTemplate(tpl.id);
                        }
                      },
                    },
                    label,
                    tpl.builtIn
                      ? null
                      : h(
                          "button",
                          {
                            type: "button",
                            className: "ddoc-chip-x",
                            title: t("template.delete", { title: tpl.title }),
                            "aria-label": t("template.delete", { title: tpl.title }),
                            onClick: (event) => {
                              event.stopPropagation();
                              deleteTemplate(tpl);
                            },
                          },
                          "×",
                        ),
                  );
                }),
                h(
                  "button",
                  {
                    type: "button",
                    className: "ddoc-chip ddoc-chip--ghost",
                    onClick: () =>
                      setDraft({
                        title: "",
                        subtitle: "",
                        accent: activeTemplate?.accent ?? ACCENT,
                        fontSize: styleDraft?.fontSize ?? 10.5,
                        lineHeight: styleDraft?.lineHeight ?? 1.55,
                        margin: styleDraft?.margin ?? 18,
                        columns: styleDraft?.columns ?? 1,
                        font: styleDraft?.font ?? "wenkai",
                      }),
                  },
                  t("chip.new"),
                ),
              ),
              styleDraft
                ? h(
                    "div",
                    { className: "ddoc-ribbon" },

                    // 1. 段落格式（正文、标题、引用）
                    h(
                      "div",
                      { className: "ddoc-ribbon-grp" },
                      h(
                        "select",
                        {
                          className: "ddoc-ribbon-select",
                          defaultValue: "p",
                          onMouseDown: (event) => event.preventDefault(),
                          onChange: (event) => execCmd("formatBlock", `<${event.target.value}>`),
                        },
                        h("option", { value: "p" }, t("format.p")),
                        h("option", { value: "h1" }, t("format.h1")),
                        h("option", { value: "h2" }, t("format.h2")),
                        h("option", { value: "h3" }, t("format.h3")),
                        h("option", { value: "blockquote" }, t("format.quote")),
                      ),
                    ),

                    // 2. 文字修饰：只作用在选中文字上
                    h(
                      "div",
                      { className: "ddoc-ribbon-grp" },
                      cmdButton("B", "bold", { fontWeight: "bold" }, t("btn.bold")),
                      cmdButton("I", "italic", { fontStyle: "italic" }, t("btn.italic")),
                      cmdButton("U", "underline", { textDecoration: "underline" }, t("btn.underline")),
                      cmdButton("S", "strikeThrough", { textDecoration: "line-through" }, t("btn.strike")),
                    ),

                    // 3. 对齐：左对齐、居中、右对齐
                    h(
                      "div",
                      { className: "ddoc-ribbon-grp" },
                      cmdButton("⇤", "justifyLeft", null, t("btn.alignLeft")),
                      cmdButton("≡", "justifyCenter", null, t("btn.alignCenter")),
                      cmdButton("⇥", "justifyRight", null, t("btn.alignRight")),
                    ),

                    // 4. 列表：无序列表、编号列表
                    h(
                      "div",
                      { className: "ddoc-ribbon-grp" },
                      cmdButton("• ≡", "insertUnorderedList", null, t("btn.bulletList")),
                      cmdButton("1. ≡", "insertOrderedList", null, t("btn.numberList")),
                    ),

                    // 5. 撤销 / 重做
                    h(
                      "div",
                      { className: "ddoc-ribbon-grp" },
                      cmdButton("↶", "undo", null, t("btn.undo")),
                      cmdButton("↷", "redo", null, t("btn.redo")),
                    ),
                  )
                : null,
              styleDraft
                ? h(
                    "div",
                    { className: "ddoc-ruler" },

                    // 字体
                    h(
                      "div",
                      { className: "ddoc-ruler-grp" },
                      h("label", null, t("style.font")),
                      h(
                        "div",
                        { className: "ddoc-seg2" },
                        ...["wenkai", "song", "kaiti", "system"].map((font) =>
                          h(
                            "button",
                            {
                              key: font,
                              type: "button",
                              "aria-pressed": styleDraft.font === font ? "true" : "false",
                              onClick: () => setStyleDraft({ ...styleDraft, font }),
                            },
                            t(`font.${font}`),
                          ),
                        ),
                      ),
                      h(FontPicker, {
                        value: styleDraft.font,
                        onChange: (font) => setStyleDraft({ ...styleDraft, font }),
                        options: systemFonts,
                        aliases: fontAliases,
                      }),
                    ),
                    h("span", { className: "ddoc-ruler-sep" }),

                    // 字号
                    h(
                      "div",
                      { className: "ddoc-ruler-grp" },
                      h("label", null, t("style.size")),
                      h(
                        "div",
                        { className: "ddoc-stepper" },
                        h(
                          "button",
                          {
                            type: "button",
                            "aria-label": `${t("style.size")} −`,
                            disabled: styleDraft.fontSize <= 8.5,
                            onClick: () => bumpStyle("fontSize", -0.5, 8.5, 18, 0.5),
                          },
                          "−",
                        ),
                        h("b", null, `${styleDraft.fontSize}pt`),
                        h(
                          "button",
                          {
                            type: "button",
                            "aria-label": `${t("style.size")} +`,
                            disabled: styleDraft.fontSize >= 18,
                            onClick: () => bumpStyle("fontSize", 0.5, 8.5, 18, 0.5),
                          },
                          "+",
                        ),
                      ),
                    ),
                    h("span", { className: "ddoc-ruler-sep" }),

                    // 行距
                    h(
                      "div",
                      { className: "ddoc-ruler-grp" },
                      h("label", null, t("style.line")),
                      h(
                        "div",
                        { className: "ddoc-stepper" },
                        h(
                          "button",
                          {
                            type: "button",
                            "aria-label": `${t("style.line")} −`,
                            disabled: styleDraft.lineHeight <= 1.2,
                            onClick: () => bumpStyle("lineHeight", -0.05, 1.2, 2.4, 0.05),
                          },
                          "−",
                        ),
                        h("b", null, `${styleDraft.lineHeight.toFixed(2)}×`),
                        h(
                          "button",
                          {
                            type: "button",
                            "aria-label": `${t("style.line")} +`,
                            disabled: styleDraft.lineHeight >= 2.4,
                            onClick: () => bumpStyle("lineHeight", 0.05, 1.2, 2.4, 0.05),
                          },
                          "+",
                        ),
                      ),
                    ),
                    h("span", { className: "ddoc-ruler-sep" }),

                    // 页边距
                    h(
                      "div",
                      { className: "ddoc-ruler-grp" },
                      h("label", null, t("style.margin")),
                      h(
                        "div",
                        { className: "ddoc-stepper" },
                        h(
                          "button",
                          {
                            type: "button",
                            "aria-label": `${t("style.margin")} −`,
                            disabled: styleDraft.margin <= 8,
                            onClick: () => bumpStyle("margin", -2, 8, 35, 1),
                          },
                          "−",
                        ),
                        h("b", null, `${styleDraft.margin}mm`),
                        h(
                          "button",
                          {
                            type: "button",
                            "aria-label": `${t("style.margin")} +`,
                            disabled: styleDraft.margin >= 35,
                            onClick: () => bumpStyle("margin", 2, 8, 35, 1),
                          },
                          "+",
                        ),
                      ),
                    ),
                    h("span", { className: "ddoc-ruler-sep" }),

                    // 栏数
                    h(
                      "div",
                      { className: "ddoc-ruler-grp" },
                      h("label", null, t("style.columns")),
                      h(
                        "div",
                        { className: "ddoc-seg2" },
                        ...[1, 2].map((count) =>
                          h(
                            "button",
                            {
                              key: count,
                              type: "button",
                              "aria-pressed": Number(styleDraft.columns) === count ? "true" : "false",
                              onClick: () => setStyleDraft({ ...styleDraft, columns: count }),
                            },
                            count === 1 ? t("template.one") : t("template.two"),
                          ),
                        ),
                      ),
                    ),

                    // 未保存提示与操作
                    h(
                      "div",
                      { className: "ddoc-ruler-dirty" },
                      styleDirty ? h("span", { className: "ddoc-badge" }, t("style.dirty")) : null,
                      styleDirty
                        ? h(
                            "button",
                            { type: "button", className: "ddoc-mini ddoc-mini--ghost", onClick: revertStyle },
                            t("style.revert"),
                          )
                        : null,
                      styleDirty
                        ? h(
                            "button",
                            {
                              type: "button",
                              className: "ddoc-mini",
                              disabled: templateBusy,
                              onClick: saveStyle,
                            },
                            t("style.save"),
                          )
                        : null,
                    ),
                  )
                : null,
            ),

              h(
                "div",
                { className: "ddoc-desk", ref: deskRef },
                h(
                  "div",
                  {
                    className: "ddoc-paper",
                    style: {
                      width: "210mm",
                      minHeight: "297mm",
                      padding: `${marginMm}mm`,
                      zoom: String(paperZoom),
                    },
                  },
                  h(WordPaperEditor, {
                value: markdown,
                initialHtml,
                editorRef,
                onChange: (v) => setMarkdown(v),
                onCmdEnter: openPreview,
                style: {
                  fontFamily: paperFontStack(styleDraft?.font ?? activeTemplate?.font),
                  fontSize: `${styleDraft?.fontSize ?? fontSize}pt`,
                  lineHeight: String(styleDraft?.lineHeight ?? lineHeight),
                  columnCount: columns === 2 ? 2 : 1,
                  columnGap: "8mm",
                },
              }),
                ),
                h(
                  "div",
                  { className: "ddoc-paper-foot" },
                  h("span", null, t("hint.chars", { n: chars })),
                  h(
                    "b",
                    null,
                    !result
                      ? t("state.idle")
                      : rendering
                        ? t("state.rendering")
                        : dirty
                          ? t("state.dirty")
                          : `${t("unit.pages", { n: pages })} · A4`,
                  ),
                  h("span", null, t("hint.cmdEnter")),
                ),
              ),
          ),

          // ── 错误 / 通知 ───────────────────────────────────────
          error
            ? h(
                "div",
                { className: "ddoc-note ddoc-note--bad" },
                h("b", null, `${t("error.prefix")}：`),
                error,
              )
            : null,
          statusError && !error
            ? h(
                "div",
                { className: "ddoc-note ddoc-note--bad" },
                h("b", null, `${t("error.prefix")}：`),
                statusError,
              )
            : null,
          jobState === "completed" && job
            ? h(
                "div",
                { className: "ddoc-note", style: { borderLeftColor: ACCENT } },
                h("b", null, "✓ "),
                t("msg.completed", { pages: job.pages, sheets: job.sheets }),
                h("span", { className: "ddoc-mono", style: { marginLeft: 8, opacity: 0.7 } }, `${job.queue} · ${job.id}`),
              )
            : null,
          jobState === "unknown" && job
            ? h("div", { className: "ddoc-note" }, t("msg.printUnknown"), h("span", { className: "ddoc-mono", style: { marginLeft: 8, opacity: 0.7 } }, job.id))
            : null,
          jobState === "processing" && job
            ? h(
                "div",
                { className: "ddoc-note" },
                h("span", { className: "ddoc-spin", style: { display: "inline-block", verticalAlign: "-2px", marginRight: 6 } }),
                t("msg.printing", { queue: job.queue }),
                h("span", { className: "ddoc-mono", style: { marginLeft: 8, opacity: 0.7 } }, job.id),
              )
            : null,
          notice && !job
            ? h("div", { className: "ddoc-hint" }, h("span", null, notice))
            : null,

          // ── 印张条 ────────────────────────────────────────────
          h(
            "div",
            { className: "ddoc-actions" },
            h(
              "div",
              { className: "ddoc-ticket" },
              h("span", { className: "ddoc-faces", "aria-hidden": "true" }, h("i", { className: "f" }), h("i", { className: "b" })),
              h(
                "span",
                { className: "ddoc-facts" },
                h("b", null, status?.defaults?.media ?? "A4"),
                h("span", { className: "sep" }, "·"),
                duplexText,
                h("span", { className: "sep" }, "·"),
                result ? t("unit.pages", { n: pages }) : "—",
                h("span", { className: "sep" }, "/"),
                result ? h("b", null, t("unit.sheets", { n: sheets })) : "—",
                result && pages % 2 === 1 && sheets > 0
                  ? h("span", { className: "sep" }, "·")
                  : null,
                result && pages % 2 === 1 && sheets > 0
                  ? h("span", null, t("ticket.backBlank"))
                  : null,
              ),
              h("span", { className: "ddoc-state-pill" }, stateChip.text),
            ),
            h(
              "div",
              { className: "ddoc-btns" },
              h(
                "button",
                {
                  type: "button",
                  className: "ddoc-btn ddoc-btn--ghost",
                  disabled: rendering || !markdown.trim(),
                  onClick: () => openPreview(),
                },
                rendering ? h("span", { className: "ddoc-spin" }) : null,
                t("btn.preview"),
              ),
              h(
                "button",
                {
                  type: "button",
                  className: "ddoc-btn ddoc-btn--primary",
                  disabled: printing || !markdown.trim() || !printer || printer.state === "disabled",
                  onClick: requestPrint,
                },
                printing ? h("span", { className: "ddoc-spin" }) : null,
                t("btn.printBlocked"),
              ),
            ),
          ),
        ),

        // ── 预览：按需弹出，不再常驻右栏 ───────────────────────
        previewOpen
          ? h(
              "div",
              {
                className: "ddoc-scrim",
                role: "presentation",
                onClick: (event) => {
                  if (event.target === event.currentTarget) setPreviewOpen(false);
                },
              },
              h(
                "div",
                {
                  className: "ddoc-modal ddoc-modal--preview",
                  role: "dialog",
                  "aria-modal": "true",
                  "aria-label": t("label.preview"),
                },
                h(
                  "div",
                  { className: "ddoc-modal-head" },
                  h("h3", null, t("label.preview")),
                  h(
                    "b",
                    { className: "ddoc-mono", style: { fontSize: 10, color: "var(--dsw-alias-label-tertiary)" } },
                    !result
                      ? t("state.idle")
                      : rendering
                        ? t("state.rendering")
                        : dirty
                          ? t("state.dirty")
                          : `${t("unit.pages", { n: pages })} · A4`,
                  ),
                  h(
                    "div",
                    { className: "ddoc-modal-actions" },
                    h(
                      "button",
                      {
                        type: "button",
                        className: "ddoc-btn ddoc-btn--ghost",
                        onClick: () => setPreviewOpen(false),
                        disabled: printing,
                      },
                      t("btn.close"),
                    ),
                    h(
                      "button",
                      {
                        type: "button",
                        className: "ddoc-btn ddoc-btn--primary",
                        disabled:
                          printing || !result || pages === 0 || !printer || printer.state === "disabled",
                        onClick: doPrint,
                      },
                      printing ? h("span", { className: "ddoc-spin" }) : null,
                      pages > 0 ? (pages === 1 ? t("btn.printOne") : t("btn.print", { pages })) : t("btn.printBlocked"),
                    ),
                  ),
                ),
                h(
                  "div",
                  { className: "ddoc-pv-body" },
                  // 左：整页校样，尽量占满
                  h(
                    "div",
                    { className: "ddoc-pv-canvas", ref: pvCanvasRef },
                    result && result.previews?.length
                      ? h(
                          "div",
                          { className: "ddoc-pv-pages" },
                          ...result.previews.map((preview) =>
                            h(
                              "button",
                              {
                                type: "button",
                                className: "ddoc-pv-sheet",
                                key: preview.page,
                                style: pvSheetH ? { height: `${pvSheetH}px` } : undefined,
                                onClick: () => openZoom(preview),
                                "aria-label": t("zoom.open", { page: preview.page }),
                                title: t("zoom.hint", { page: preview.page, total: result.pages }),
                              },
                              h("img", { src: preview.dataUrl, alt: t("zoom.open", { page: preview.page }) }),
                            ),
                          ),
                        )
                      : h(
                          "div",
                          { className: "ddoc-pv-empty" },
                          h(
                            "div",
                            { className: rendering ? "ddoc-ghost is-working" : "ddoc-ghost" },
                            h(
                              "div",
                              { className: "ddoc-sheet", "aria-hidden": "true" },
                              h(
                                "div",
                                { className: "ddoc-sheet-flow" },
                                h("i", { className: "ddoc-flow-title" }),
                                h("i", { className: "ddoc-flow-meta" }),
                                h("i", { className: "ddoc-flow-gap" }),
                                h("i", null),
                                h("i", { style: { width: "94%" } }),
                                h("i", { style: { width: "86%" } }),
                                h("i", { style: { width: "97%" } }),
                                h("i", { style: { width: "58%" } }),
                              ),
                              h("span", { className: "ddoc-sheet-scan" }),
                            ),
                            h(
                              "div",
                              { className: "ddoc-ghost-cap" },
                              rendering ? h("span", { className: "ddoc-spin", "aria-hidden": "true" }) : null,
                              h("strong", null, rendering ? t("state.rendering") : t("empty.title")),
                            ),
                            h("span", { className: "ddoc-ghost-hint" }, t("empty.hint")),
                          ),
                        ),
                  ),
                  // 右：分页校验与用纸信息
                  h(
                    "aside",
                    { className: "ddoc-pv-side" },
                    h(
                      "div",
                      { className: "ddoc-lab" },
                      h("span", null, t("label.guards")),
                      h("b", null, guardSummary || t("state.idle")),
                    ),
                    result
                      ? h(
                          "div",
                          null,
                          h(
                            "div",
                            { className: "ddoc-rules" },
                            ...result.guards.map((guard, index) =>
                              h(
                                "div",
                                { className: "ddoc-grow", key: index },
                                h(
                                  "span",
                                  {
                                    className: `ddoc-gl ddoc-gl--${guard.level === "ok" ? "ok" : guard.level === "warn" ? "warn" : "bad"}`,
                                    "aria-hidden": "true",
                                  },
                                  guard.level === "ok" ? "✓" : guard.level === "warn" ? "!" : "×",
                                ),
                                h("span", null, guard.code ? t(guard.code, guard.params) : guard.text),
                              ),
                            ),
                          ),
                          h(
                            "div",
                            { className: "ddoc-pv-facts" },
                            h("span", null, t("confirm.printer")),
                            h("b", { style: { wordBreak: "break-all" } }, printer?.queue ?? "—"),
                            h("span", null, t("label.paper")),
                            h("b", null, status?.defaults?.media ?? "A4"),
                            h("span", null, t("label.duplex")),
                            h("b", null, duplexText),
                            h("span", null, t("label.pages")),
                            h("b", null, result ? String(pages) : "—"),
                            h("span", null, t("label.sheets")),
                            h("b", null, result ? String(sheets) : "—"),
                          ),
                        )
                      : h("span", { className: "ddoc-pv-note" }, t("hint.cmdEnter")),
                    result && pages > 0 ? h("div", { className: "ddoc-pv-warn" }, t("confirm.warning")) : null,
                  ),
                ),
              ),
            )
          : null,

        // ── 新建版式模板 ────────────────────────────────────────
        draft
          ? h(
              "div",
              {
                className: "ddoc-scrim",
                role: "presentation",
                onClick: (event) => {
                  if (event.target === event.currentTarget) setDraft(null);
                },
              },
              h(
                "div",
                {
                  className: "ddoc-modal ddoc-modal--form",
                  role: "dialog",
                  "aria-modal": "true",
                  "aria-label": t("template.new"),
                },
                h(
                  "div",
                  { className: "ddoc-modal-head" },
                  h("h3", null, t("style.saveAs")),
                  h("span", { className: "ddoc-stamp", "aria-hidden": "true" }, draft.id ? t("template.edit") : t("template.stamp")),
                ),
                h(
                  "div",
                  { className: "ddoc-fields" },
                  fieldRow(
                    t("template.name"),
                    h("input", {
                      className: "ddoc-input",
                      value: draft.title,
                      maxLength: 40,
                      placeholder: t("template.namePh"),
                      onChange: (event) => setDraft({ ...draft, title: event.target.value }),
                    }),
                  ),
                  fieldRow(
                    t("template.subtitleLabel"),
                    h("input", {
                      className: "ddoc-input",
                      value: draft.subtitle,
                      maxLength: 120,
                      placeholder: t("template.subtitlePh"),
                      onChange: (event) => setDraft({ ...draft, subtitle: event.target.value }),
                    }),
                  ),
                  h(
                    "div",
                    { className: "ddoc-field" },
                    h("label", null, t("template.accent")),
                    h(
                      "div",
                      { className: "ddoc-swatches" },
                      ...ACCENTS.map((color) =>
                        h("button", {
                          key: color,
                          type: "button",
                          className: "ddoc-swatch",
                          style: { background: color },
                          "aria-pressed": draft.accent === color ? "true" : "false",
                          "aria-label": color,
                          onClick: () => setDraft({ ...draft, accent: color }),
                        }),
                      ),
                    ),
                  ),
                ),
                templateError ? h("div", { className: "ddoc-modal-warn" }, templateError) : null,
                h(
                  "div",
                  { className: "ddoc-modal-foot" },
                  h(
                    "button",
                    { type: "button", className: "ddoc-btn", disabled: templateBusy, onClick: () => setDraft(null) },
                    t("btn.cancel"),
                  ),
                  h(
                    "button",
                    {
                      type: "button",
                      className: "ddoc-btn ddoc-btn--primary",
                      disabled: templateBusy || !draft.title.trim(),
                      onClick: saveTemplate,
                    },
                    templateBusy ? h("span", { className: "ddoc-spin" }) : null,
                    draft.id ? t("template.save") : t("template.create"),
                  ),
                ),
              ),
            )
          : null,

        // ── 预览放大 ────────────────────────────────────────────
        zoom
          ? h(
              "div",
              {
                className: "ddoc-lightbox",
                role: "dialog",
                "aria-modal": "true",
                "aria-label": `第 ${zoom.page} 页预览`,
                onClick: () => setZoom(null),
                onKeyDown: (event) => {
                  if (event.key === "Escape") setZoom(null);
                },
              },
              h(
                "figure",
                null,
                h("img", { src: zoom.dataUrl, alt: t("zoom.open", { page: zoom.page }) }),
                h("figcaption", null, t("zoom.hint", { page: zoom.page, total: result?.pages ?? "?" })),
              ),
            )
          : null,

      );
    }

    /* ================================ 注册 ================================ */

    function stylesInsert(css) {
      const tag = document.createElement("style");
      tag.id = "dsh-doc-style";
      tag.textContent = css;
      document.head.append(tag);
      return () => tag.remove();
    }

    return {
      inject: ["slots", "locale"],
      apply(ctx) {
        ctx.effect(() => stylesInsert(CSS), "dsh-doc: stylesheet");

        localeApi = ctx.locale ?? null;
        if (localeApi) {
          ctx.effect(() => localeApi.register(NS, DICT), "dsh-doc: dictionaries");
          if (typeof localeApi.bind === "function") {
            try {
              boundTranslate = localeApi.bind(NS);
            } catch {
              boundTranslate = null;
            }
          }
        }

        ctx.slots.inject("sidebar.panellist", () =>
          ctx.slots.register(
            { name: "sidebar.panellist", id: PANEL_ID, order: 30, label: t("panel.title") },
            PanelIcon,
          ),
        );
        ctx.slots.inject("main", () =>
          ctx.slots.register({ name: "main", key: PANEL_ID }, () =>
            h(PanelBoundary, null, h(StudioPage, null)),
          ),
        );
      },
    };
  },
});
