import test from "node:test";
import assert from "node:assert/strict";
import { detectFontAliases } from "../lib/font-aliases.js";

test("detectFontAliases：本机能读出中英文字体别名", async () => {
  const map = await detectFontAliases();
  assert.ok(map && typeof map === "object");

  if (process.platform !== "darwin") {
    // 其他平台的字体路径未纳入测试容器，这里只验证形状
    for (const [key, value] of Object.entries(map)) {
      assert.ok(typeof key === "string" && key.length > 0);
      assert.ok(Array.isArray(value));
    }
    return;
  }

  // macOS：中文字体应当同时有中文名与英文名两条路径
  const all = Object.entries(map);
  const withCjk = all.filter(([, v]) => v.some((x) => /[\u4e00-\u9fff]/.test(x)));
  assert.ok(withCjk.length > 0, "至少应有中文字体别名（如宋体、苹方）");

  // 别名表里不应出现私有字体名
  for (const key of Object.keys(map)) {
    assert.ok(!key.startsWith("."), `私有字体不应出现在别名表: ${key}`);
  }

  // 霞鹜文楷这类中英名并存的自装字体：英文名能查到中文名
  const wenkai = map["LXGW WenKai"];
  if (wenkai) {
    assert.ok(wenkai.some((name) => name.includes("文楷")), "LXGW WenKai 应能映射到霞鹜文楷");
    assert.ok(map["霞鹜文楷"]?.includes("LXGW WenKai"), "中文名也要能反查英文家族名");
  }
});

test("detectFontAliases：未知平台返回空表而不抛错", async () => {
  const map = await detectFontAliases("unknown-os");
  assert.deepEqual(map, {});
});
