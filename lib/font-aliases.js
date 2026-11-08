/**
 * 字体本地名解析：从字体文件的 `name` 表里读出中文等本地化家族名。
 *
 * 为什么需要：macOS 的 NSFontManager 只给出英文家族名（`LXGW WenKai`），
 * 而用户在搜索框里敲的是「霞鹜文楷」或「文楷」，字面匹配永远落空。
 * 字体文件本身同时存有多语言名，直接读比调用系统 API 更可控。
 *
 * 只读表目录和 name 表，不整文件读入——中文字体动辄 20MB，全读会拖慢首次探测。
 */
import { open, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** 各平台字体文件所在目录（只用于取本地化名，不做字体枚举） */
export const FONT_DIRS = Object.freeze({
  darwin: [
    "/System/Library/Fonts",
    "/System/Library/Fonts/Supplemental",
    "/System/Library/AssetsV2",
    "/Library/Fonts",
    join(homedir(), "Library/Fonts"),
  ],
  linux: ["/usr/share/fonts", "/usr/local/share/fonts", join(homedir(), ".local/share/fonts"), join(homedir(), ".fonts")],
  win32: [
    join(process.env.WINDIR ?? "C:\\Windows", "Fonts"),
    join(process.env.LOCALAPPDATA ?? "", "Microsoft", "Windows", "Fonts"),
  ],
});

const FONT_FILE = /\.(ttf|otf|ttc|otc)$/i;
/** name 表理论上很小；设上限防止读到畸形文件把内存吃满 */
const MAX_NAME_TABLE = 512 * 1024;
const MAX_FILES = 2000;

/** UTF-16BE → JS 字符串（字体 name 表用大端） */
function decodeUtf16be(buf) {
  const len = buf.length - (buf.length % 2);
  const copy = Buffer.from(buf.subarray(0, len));
  copy.swap16();
  return copy.toString("utf16le").replace(/\u0000/g, "");
}

/**
 * 解析一段 name 表，返回全部家族名（nameID 1 / 16）。
 * @param {Buffer} table
 * @param {number} base name 表在 table 中的起点
 * @returns {string[]}
 */
function parseNameTable(table, base = 0) {
  if (table.length < base + 6) return [];
  const count = table.readUInt16BE(base + 2);
  const stringOffset = table.readUInt16BE(base + 4);
  const storage = base + stringOffset;
  const names = [];

  for (let i = 0; i < count; i++) {
    const rec = base + 6 + i * 12;
    if (rec + 12 > table.length) break;
    const platformID = table.readUInt16BE(rec);
    const nameID = table.readUInt16BE(rec + 6);
    const length = table.readUInt16BE(rec + 8);
    const offset = table.readUInt16BE(rec + 10);
    if (nameID !== 1 && nameID !== 16) continue;
    const start = storage + offset;
    if (start + length > table.length) continue;
    const raw = table.subarray(start, start + length);
    let value = "";
    if (platformID === 0 || platformID === 3) {
      value = decodeUtf16be(raw);
    } else if (platformID === 1) {
      value = raw.toString("latin1");
    }
    value = value.replace(/[\u0000-\u001f]/g, "").trim();
    if (value) names.push(value);
  }
  return names;
}

/** 读出字体的所有家族名；TTC/OTC 集合文件逐个 face 展开 */
async function readFontNames(file) {
  let handle;
  try {
    handle = await open(file, "r");
  } catch {
    return [];
  }
  try {
    const head = Buffer.alloc(12);
    const { bytesRead } = await handle.read(head, 0, 12, 0);
    if (bytesRead < 12) return [];
    const tag = head.toString("latin1", 0, 4);

    /** name 表在文件中的位置 */
    const tableOffsets = [];
    if (tag === "ttcf") {
      const numFonts = Math.min(head.readUInt32BE(8), 32);
      const dir = Buffer.alloc(4 * numFonts);
      await handle.read(dir, 0, dir.length, 12);
      for (let i = 0; i < numFonts; i++) tableOffsets.push(dir.readUInt32BE(i * 4));
    } else {
      tableOffsets.push(0);
    }

    const faces = [];
    for (const base of tableOffsets) {
      const dirHead = Buffer.alloc(12);
      const read = await handle.read(dirHead, 0, 12, base);
      if (read.bytesRead < 12) continue;
      const numTables = dirHead.readUInt16BE(4);
      if (numTables === 0 || numTables > 256) continue;
      const records = Buffer.alloc(numTables * 16);
      await handle.read(records, 0, records.length, base + 12);
      for (let i = 0; i < numTables; i++) {
        const rec = i * 16;
        if (records.toString("latin1", rec, rec + 4) !== "name") continue;
        const offset = records.readUInt32BE(rec + 8);
        const length = Math.min(records.readUInt32BE(rec + 12), MAX_NAME_TABLE);
        const table = Buffer.alloc(length);
        const got = await handle.read(table, 0, length, offset);
        faces.push(parseNameTable(table.subarray(0, got.bytesRead)));
      }
    }
    return faces;
  } catch {
    return [];
  } finally {
    await handle.close().catch(() => {});
  }
}

/** 递归收集字体文件路径（带数量上限，避免遍历整个字体库） */
async function collectFontFiles(dir, out = [], depth = 0) {
  if (out.length >= MAX_FILES || depth > 4) return out;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (out.length >= MAX_FILES) break;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectFontFiles(full, out, depth + 1);
    } else if (entry.isFile() && FONT_FILE.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * 扫描字体目录，建立「英文家族名 → 本地化别名」映射。
 *
 * 同一字体文件里同时存着 `LXGW WenKai` 与 `霞鹜文楷`，
 * 把纯 ASCII 名当主名、含中日韩字符的名当别名，两边互相指向。
 * @param {string} [platform]
 * @returns {Promise<Record<string, string[]>>}
 */
export async function detectFontAliases(platform = process.platform) {
  const dirs = FONT_DIRS[platform] ?? [];
  const files = [];
  for (const dir of dirs) {
    await collectFontFiles(dir, files);
  }

  /** @type {Record<string, Set<string>>} */
  const aliasMap = {};
  const addAlias = (key, alias) => {
    const k = key.trim();
    const v = alias.trim();
    if (!k || !v || k === v) return;
    (aliasMap[k] ??= new Set()).add(v);
  };

  for (const file of files) {
    const faces = await readFontNames(file);
    for (const names of faces) {
      if (names.length === 0) continue;
      // 私有字体（.SF NS 之类）不参与别名，它们也不会出现在家族列表里
      const usable = names.filter((n) => !n.startsWith("."));
      const latin = usable.filter((n) => /^[\x20-\x7e]+$/.test(n));
      const cjk = usable.filter((n) => /[\u3400-\u9fff\uf900-\ufaff]/.test(n));
      // 同一个 face 里的多语言名互为别名：英文名能搜到中文名，反之亦然
      for (const en of latin) {
        for (const zh of cjk) {
          addAlias(en, zh);
          addAlias(zh, en);
        }
      }
    }
  }

  /** @type {Record<string, string[]>} */
  const result = {};
  for (const [key, set] of Object.entries(aliasMap)) {
    result[key] = [...set].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  }
  return result;
}
