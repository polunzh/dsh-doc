/**
 * 系统字体探测：跨平台枚举系统已安装的字体家族名称。
 *
 * 优先使用系统原生 API / 工具，探测结果会在内存中缓存，避免每次渲染或打开界面重复执行子进程。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { detectFontAliases } from "./font-aliases.js";

const execFileAsync = promisify(execFile);

/** 当所有系统探测手段均不可用时的兜底常用跨平台字体 */
export const FALLBACK_FONTS = Object.freeze([
  "Arial",
  "Baskerville",
  "Courier New",
  "Georgia",
  "Helvetica Neue",
  "Hiragino Sans GB",
  "Kaiti SC",
  "Microsoft YaHei",
  "PingFang SC",
  "SimHei",
  "SimSun",
  "Songti SC",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
]);

/** 内存缓存 */
let cachedFonts = null;
/** 本地化别名缓存：{ "LXGW WenKai": ["霞鹜文楷", ...] } */
let cachedAliases = null;

/**
 * 探测 macOS 系统的字体家族列表。
 * 使用 JXA (JavaScript for Automation) 调用 AppKit 的 NSFontManager，无额外环境依赖且速度极快 (~0.15s)。
 * @returns {Promise<string[]>}
 */
async function detectDarwinFonts() {
  const script =
    'ObjC.import("AppKit"); JSON.stringify(ObjC.deepUnwrap($.NSFontManager.sharedFontManager.availableFontFamilies));';
  const { stdout } = await execFileAsync("/usr/bin/osascript", ["-l", "JavaScript", "-e", script], {
    timeout: 5000,
  });
  const parsed = JSON.parse(stdout.trim());
  if (!Array.isArray(parsed) || parsed.length === 0) return [];
  return parsed.map((item) => String(item).trim()).filter(Boolean);
}

/**
 * 探测 Linux 系统的字体家族列表。
 * 使用 fontconfig 的 fc-list 命令。
 * @returns {Promise<string[]>}
 */
async function detectLinuxFonts() {
  const { stdout } = await execFileAsync("fc-list", [":", "family"], { timeout: 5000 });
  const set = new Set();
  for (const line of stdout.split("\n")) {
    for (const fam of line.split(",")) {
      const trimmed = fam.trim();
      if (trimmed && !trimmed.startsWith(".")) {
        set.add(trimmed);
      }
    }
  }
  return [...set];
}

/**
 * 探测 Windows 系统的字体家族列表。
 * 通过 PowerShell 读取注册表字体列表。
 * @returns {Promise<string[]>}
 */
async function detectWindowsFonts() {
  const ps =
    "Get-ItemProperty 'HKLM:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts' | Get-Member -MemberType NoteProperty | ForEach-Object { $_.Name -replace ' \\(.*\\)$','' }";
  const { stdout } = await execFileAsync("powershell", ["-NoProfile", "-Command", ps], { timeout: 6000 });
  const set = new Set();
  for (const line of stdout.split(/[\r\n]+/)) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("PS") && !trimmed.includes("Property")) {
      set.add(trimmed);
    }
  }
  return [...set];
}

/**
 * 执行跨平台系统字体探测（不读取缓存）。
 * @param {string} [platform] 供测试覆盖的平台名，默认使用 process.platform
 * @returns {Promise<string[]>}
 */
export async function detectSystemFonts(platform = process.platform) {
  let list = [];
  try {
    if (platform === "darwin") {
      list = await detectDarwinFonts();
    } else if (platform === "linux") {
      list = await detectLinuxFonts();
    } else if (platform === "win32") {
      list = await detectWindowsFonts();
    }
  } catch {
    list = [];
  }

  // 若平台探测为空，采用内置保底字体
  if (!Array.isArray(list) || list.length === 0) {
    list = [...FALLBACK_FONTS];
  }

  // 清洗、去重并按字典顺序排序（兼容中英文排版）
  const unique = Array.from(
    new Set(
      list
        .map((name) => String(name).replace(/[;{}<>"'\\\r\n]/g, "").trim())
        .filter((name) => name.length > 0 && name.length <= 80),
    ),
  );

  return unique.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

/**
 * 获取系统字体列表，带进程级内存缓存。
 * @param {boolean} [forceRefresh] 是否强制重新探测
 * @returns {Promise<string[]>}
 */
export async function getSystemFonts(forceRefresh = false) {
  if (!forceRefresh && cachedFonts !== null) {
    return cachedFonts;
  }
  const fonts = await detectSystemFonts();
  cachedFonts = fonts;
  return fonts;
}

/**
 * 获取「字体家族名 → 本地化别名」映射，带进程级缓存。
 *
 * macOS 的家族名是英文（`LXGW WenKai`），用户却按中文（`霞鹜文楷`）搜；
 * 别名表让搜索框两边都能命中。探测失败时退化成空表，不影响字体列表本身。
 * @param {boolean} [forceRefresh]
 * @returns {Promise<Record<string, string[]>>}
 */
export async function getFontAliases(forceRefresh = false) {
  if (!forceRefresh && cachedAliases !== null) {
    return cachedAliases;
  }
  try {
    cachedAliases = await detectFontAliases();
  } catch {
    cachedAliases = {};
  }
  return cachedAliases;
}

/**
 * 重置内存缓存（主要用于测试）。
 */
export function resetFontCache() {
  cachedFonts = null;
  cachedAliases = null;
}
