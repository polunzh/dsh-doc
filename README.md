[中文](./README.zh-CN.md) | **English**

# 打印工坊 · dsh-doc

Typeset text into a print-ready A4 PDF and print it duplex on a LAN printer with capability-aware options.

![Workspace](design/workspace.png)

## What It Solves

Printing handouts manually involves three steps: typesetting (Word/PDF), checking pagination (to ensure questions/answers aren't split), and printing. The printing step is notoriously fragile—duplex naming conventions vary (e.g., `DuplexNoTumble` vs `two-sided-long-edge`), and "task submitted" does not guarantee physical output.

This plugin unifies the pipeline:

```
Markdown/Text ──► Print Styles HTML ──► Chrome headless ──► A4 PDF
                                                        │
                                         Capability-mapped printer options
                                                        ▼
                                           lp submit ──► lpstat polling ──► Receipt
```

## Features

- **Capability Detection**: Reads `lpstat` and `lpoptions` to parse printer PPDs into structured capability tables instead of guessing keywords.
- **Param Mapping**: Maps intent (long/short-edge) to machine-specific options; explicitly reports `skipped` for unsupported features.
- **Rendering-as-Verification**: Automatically groups "numbered questions + A/B answers" into a `.qa` container with `break-inside: avoid` to prevent pagination breaks.
- **Paper Estimation**: Calculates required paper based on page count and duplex mode, alerting for "blank back sides" on odd-page jobs.
- **Output Receipt**: Polls `lpstat` to distinguish between `processing`, `completed`, and `unknown` states.

## Installation

Install as a local bundle via the Plugin Manager:

```text
plugin_manager(install_bundle, target="/Users/zhenqiang/Documents/project/dsh-plugins/dsh-doc")
```

## Usage

1. Open the "Print Studio" panel from the sidebar.
2. Select a template and paste content into the editor.
3. Press `⌘↵` or "Render" to view page thumbnails and pagination checks.
4. "Print N Pages" → confirm card → execute.
5. Bottom status bar reports progress: `Processing` → `Completed · N pages / M sheets`.

## Agent Tools

The plugin registers `print_handout` in the Host API for direct model control:

| Action | Description |
| --- | --- |
| `printers` | List queues, default printer, and capabilities (read-only). |
| `render` | Render PDF, returning page count, paper usage, and pagination warnings. |
| `print` | Execute print (irreversible). |
| `status` | Query job status. |

## Known Limitations

- **Chrome/Chromium dependency**: Required for `--headless=new --print-to-pdf`.
- **Page Numbers**: Currently not in footer due to Chromium limitations; pagination issues are explicitly flagged in the UI.
- **LAN Only**: Only detects local CUPS queues; network printers must be pre-configured in the OS.
- **Receipts**: "Completed" indicates queue-level success, not physical output proof.
