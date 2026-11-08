[中文](./README.zh-CN.md) | **English**

# Print Studio · dsh-doc

Typeset Markdown into a print-ready A4 handout, probe the LAN printer's real capabilities, and send it to paper — then report whether the queue actually finished.

![Print Studio workspace](https://raw.githubusercontent.com/polunzh/dsh-doc/main/preview/screenshots/workspace-en.png)

## The problem

Making a handout by hand takes three steps: lay it out, check that pagination doesn't split a question from its answer, then print it. The last step looks trivial and is the one that bites — every printer names duplex differently (PPD drivers use `Duplex=DuplexNoTumble`, IPP Everywhere uses `sides=two-sided-long-edge`), and "job submitted" is not "paper came out".

This plugin collapses the chain:

```
Markdown/text ──► print-style HTML ──► Chrome headless ──► A4 PDF
                                                          │
                                          map options from real lpoptions output
                                                          ▼
                                             lp submit ──► lpstat poll ──► receipt
```

## What it does

- **Capability probing**: parses `lpstat -p -d`, `lpstat -v` and `lpoptions -l` into a structured table of the duplex / paper / colour values this machine actually accepts, instead of pattern-matching keywords.
- **Option mapping**: duplex intent (long edge / short edge / single) is rendered as the machine's own option names. Anything that can't be mapped comes back as `skipped` rather than pretending it took effect.
- **Rendering as validation**: numbered questions followed by A/B answers are wrapped into one `.qa` block with `break-inside: avoid`, so pagination can't tear them apart.
- **Sheet accounting**: page count plus duplex mode yields the real sheet count, and odd page counts are flagged up front ("the last sheet's back side stays blank").
- **Delivery receipt**: after `lp`, polls `lpstat -W completed` and distinguishes `processing` / `completed` / `unknown`. `unknown` says it doesn't know instead of claiming success.
- **Real page numbers**: the footer is drawn through CDP (`Page.printToPDF` with a `footerTemplate`), because Chromium's `@page` margin boxes don't support `counter(page)`. If CDP is unavailable it falls back to `--print-to-pdf`, drops the page numbers, and says so in the layout guards.

## Install

From npm:

```bash
dsh plugin --profile desktop add @polunzh/dsh-doc
```

From a local checkout (development), through the Plugin Manager:

```text
plugin_manager(install_bundle, target="<path to this repository>")
```

Requires Chrome or Chromium on the same machine. Preview thumbnails use `pdftoppm` / `pdfinfo` from poppler (macOS: `brew install poppler`, Debian/Ubuntu: `apt install poppler-utils`); without them rendering still works but no thumbnails appear.

## Use

1. Click the Print Studio icon in the sidebar to open the panel.
2. Compose directly on the Word-style A4 sheet with WYSIWYG formatting.
3. The top ribbon controls block formatting (Headings/Body/Quote), text styles (Bold/Italic/Underline/Strikethrough), alignments, lists, fonts, font size, leading, margin, and columns.
4. Click "Print preview" to review full-size A4 pagination and layout guards; or click "Print" — it renders fresh, opens review, and prints with one click after verification.
5. The status bar reports the job: processing → completed · N pages / M sheets.

The typing control strip stays open above the editor. Any change re-renders the preview after 250 ms:

| Control | Range |
| --- | --- |
| Font | four presets plus a search over every font installed on the machine |
| Size | 8.5 – 18 pt, in 0.5 pt steps |
| Leading | 1.2 – 2.4, in 0.05 steps |
| Margin | 8 – 35 mm, in 2 mm steps |
| Columns | single / two |

Changes preview live but are not saved automatically — the strip shows "unsaved" with Save / Undo buttons. Saving writes back into the current template; built-in templates store as an override rather than a copy, and can be reset to factory values at any time.

## Fonts

Four presets: `wenkai` (LXGW WenKai, the default), `song` (Songti SC), `kaiti` (Kaiti SC), `system` (PingFang SC). Beyond the presets, the font button opens a search over every font installed locally — the host enumerates families per platform (AppKit on macOS, fontconfig on Linux, the registry on Windows), and matches both the family name and its localized aliases, so `wenkai`, `霞鹜` and `文楷` all find the same `LXGW WenKai`. Every stack carries fallbacks, so a missing WeNkai falls through to Songti instead of tofu.

Installing WeNkai (SIL OFL 1.1):

```bash
curl -L -o ~/Library/Fonts/LXGWWenKai-Regular.ttf \
  https://github.com/lxgw/LxgwWenKai/releases/download/v1.530/LXGWWenKai-Regular.ttf
```

## Templates

A template is a stored set of layout parameters, not hardcoded styling:

| Field | Meaning | Range |
| --- | --- | --- |
| `title` | template name, shown on the chip | ≤ 40 chars |
| `subtitle` | one line printed under the document title | ≤ 120 chars |
| `accent` | title / numbering / rule colour | `#rrggbb` |
| `font` | body font | preset id, or any installed family |
| `fontSize` | body size, scales the whole document | 8.5 – 18 pt |
| `lineHeight` | leading | 1.2 – 2.4 |
| `margin` | page margin | 8 – 32 mm |
| `columns` | single / two | 1 or 2 |

Custom templates persist to `~/.dsh/storages/dsh-doc/templates.json` and survive restarts. `render` also accepts a `style` override that affects one render only and never touches saved templates: `{markdown, template, style: {font, fontSize, lineHeight, margin, columns}}`.

## Host routes

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/dsh-doc/api/status` | queues, capabilities, defaults, Chrome availability, system fonts, saved draft |
| GET | `/dsh-doc/api/fonts` | `{fonts, aliases}` — installed families and their localized aliases |
| POST | `/dsh-doc/api/render` | `{markdown, template, title}` → pages, sheets, guards, preview images |
| POST | `/dsh-doc/api/print` | `{id, printer?, duplex?, copies?, media?, color?}` → job id |
| GET | `/dsh-doc/api/job?queue=&id=` | job state: processing / completed / unknown |
| POST | `/dsh-doc/api/templates` | `create` / `update` / `reset` / `delete` |
| POST | `/dsh-doc/api/draft` | persist the draft; read it back from `/status` |

All routes go through the host's `connection.requestRejection` guard and fail closed when that guard is absent. Write routes require `application/json`, so a cross-site form can't trigger them.

## Agent tool

The host registers `print_handout` so a model can drive the same pipeline without the panel:

| Action | Behaviour |
| --- | --- |
| `printers` | list queues, default printer, duplex / colour capability (read-only) |
| `render` | render the PDF, return page count, sheet count, layout guards — prints nothing |
| `print` | actually prints; irreversible; reuse a render via `id` or pass `markdown` to render inline |
| `status` | query a submitted job |

The usual flow is `render`, inspect pages and guards, then `print`. Tool output is English; the panel's guard text is rendered per locale from semantic codes.

## Configuration

Optional, in the `config` block of the plugin row in `cordis.patch.yml`:

```yaml
duplex: long      # long | short | none
color: gray       # gray | color
media: A4
copies: 1
chromePath: null  # auto-detected when null
```

## Drafts

Editor content autosaves to `~/.dsh/storages/dsh-doc/draft.json` (800 ms debounce, atomic write). It lives host-side rather than in `localStorage` because the Web GUI binds a different port on every launch and `localStorage` is partitioned by origin — change the port and the draft would vanish.

## Interface language

The panel ships Chinese, English and Japanese, following the host language (`navigator.language`), defaulting to English. Layout guards are returned as semantic codes plus parameters (e.g. `guard.duplexOdd` + `{pages, sheets}`) and rendered by the UI, so the Agent tool can receive English text while the panel stays localized. Host-side error messages are English.

## Known limits

- Needs Chrome or Chromium for rendering; without it, rendering reports a clear error instead of degrading to a low-fidelity conversion.
- Page numbers depend on CDP. When CDP is unavailable, the PDF is produced without them and `guard.pageNumbersMissing` says so.
- Chrome auto-detection covers macOS and Linux paths; on Windows set `chromePath` explicitly.
- Only probes local CUPS queues — network printers must be added to the system first.
- A `completed` receipt is queue-level confirmation, not proof that paper physically came out.
- docx input is out of scope: this plugin takes Markdown and plain text.

## Development

```bash
npm test        # 61 tests: parsing, mapping, pagination guards, routes, tool schema
npm run screenshot   # regenerate preview/screenshots from the real lib/client.js
```

## License

MIT
