import test from "node:test";
import assert from "node:assert/strict";
import { detectSystemFonts, getSystemFonts, resetFontCache, FALLBACK_FONTS } from "../lib/fonts.js";

test("detectSystemFonts：在当前平台上能探测到字体家族", async () => {
  resetFontCache();
  const fonts = await detectSystemFonts();
  assert.ok(Array.isArray(fonts));
  assert.ok(fonts.length > 0, "系统字体列表不应为空");
  // 验证无空串、无包含非法分号字符
  for (const font of fonts) {
    assert.ok(font.trim().length > 0);
    assert.ok(!/[;{}<>]/.test(font), `字体名不应含非法字符: ${font}`);
  }
  // 验证按字母/拼音自然排序
  const sorted = [...fonts].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  assert.deepEqual(fonts, sorted, "字体列表应保持自然排序");
});

test("detectSystemFonts：未知平台安全回退到保底字体", async () => {
  const fallback = await detectSystemFonts("unknown-os");
  assert.ok(Array.isArray(fallback));
  assert.ok(fallback.length >= FALLBACK_FONTS.length);
  assert.ok(fallback.includes("Arial"));
  assert.ok(fallback.includes("PingFang SC"));
});

test("getSystemFonts：内存缓存机制生效", async () => {
  resetFontCache();
  const first = await getSystemFonts();
  const second = await getSystemFonts();
  assert.equal(first, second, "多次调用应复用内存引用");

  const forced = await getSystemFonts(true);
  assert.ok(Array.isArray(forced));
});
