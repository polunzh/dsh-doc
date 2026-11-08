/**
 * Agent 工具的契约测试：确认 `print_handout` 以正确的 shape 注册，并且
 * 各 action 的行为符合声明（只读动作不打印、缺参时明确报错）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(HERE, "..", "lib", "index.js");
let generation = 0;

/** 启动插件并抓住它注册的工具定义。 */
async function bootWithTool() {
  const home = mkdtempSync(join(tmpdir(), "dsh-doc-tool-"));
  process.env.DSH_HOME = home;
  generation += 1;
  const mod = await import(`${pathToFileURL(ENTRY).href}?t=${generation}`);

  const registered = [];
  const tools = {
    register(definition) {
      registered.push(definition);
      return () => {};
    },
  };

  mod.apply(
    {
      logger: { info() {}, warn() {}, error() {} },
      effect: (fn) => fn(),
      get: (name) => (name === "tools" ? tools : undefined),
      webServer: { register: () => () => {} },
      connection: { requestRejection: () => undefined },
    },
    {},
  );

  assert.equal(registered.length, 1, "应该注册一个工具");
  return { tool: registered[0], cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

test("print_handout：schema 符合 ToolDefinition 约定", async () => {
  const { tool, cleanup } = await bootWithTool();
  try {
    assert.equal(tool.name, "print_handout");
    assert.match(tool.description, /print/i, "描述要说清楚会出纸");
    assert.match(tool.description, /irreversible/i, "必须警告不可撤回");
    assert.equal(tool.parameters.type, "object");
    assert.deepEqual(tool.parameters.required, ["action"]);
    assert.deepEqual(tool.parameters.properties.action.enum, ["printers", "render", "print", "status"]);
    assert.equal(typeof tool.execute, "function");
    assert.equal(typeof tool.output.render, "function");
    assert.equal(typeof tool.output.schema, "object");

    const blocks = tool.output.render({}, { ok: true, action: "render", pages: 2, sheets: 1, summary: "已渲染 2 页" });
    assert.deepEqual(blocks, [{ type: "text", text: "已渲染 2 页" }]);
  } finally {
    cleanup();
  }
});

test("print_handout：printers 只读，返回队列与默认打印机", async () => {
  const { tool, cleanup } = await bootWithTool();
  try {
    const value = await tool.execute({ action: "printers" }, {});
    assert.equal(value.ok, true);
    assert.equal(value.action, "printers");
    assert.ok(Array.isArray(value.printers));
    for (const printer of value.printers) {
      assert.equal(typeof printer.queue, "string");
      assert.equal(typeof printer.duplex, "boolean");
    }
    assert.ok(typeof value.summary === "string" && value.summary.length > 0);
  } finally {
    cleanup();
  }
});

test("print_handout：print 缺参时明确报错，而不是悄悄打印", async () => {
  const { tool, cleanup } = await bootWithTool();
  try {
    await assert.rejects(
      () => tool.execute({ action: "print" }, {}),
      /requires either id|requires markdown/,
      "没有 id 也没有 markdown 时必须拒绝",
    );
    await assert.rejects(() => tool.execute({ action: "render" }, {}), /requires markdown/);
    await assert.rejects(() => tool.execute({ action: "status" }, {}), /queue and jobId/);
    await assert.rejects(() => tool.execute({ action: "爆炸" }, {}), /Unknown action/);
  } finally {
    cleanup();
  }
});

test("print_handout：render 真的产出 PDF 并回报页数与校验", async (t) => {
  const { tool, cleanup } = await bootWithTool();
  try {
    const poem = ["春江花月夜", "唐 · 张若虚", "春江潮水连海平，海上明月共潮生。", "滟滟随波千万里，何处春江无月明？"].join("\n");
    const value = await tool.execute({ action: "render", markdown: poem, template: "generic" }, {});
    assert.equal(value.ok, true);
    assert.ok(value.pages >= 1);
    assert.ok(value.sheets >= 1);
    assert.ok(Array.isArray(value.guards));
    assert.ok(value.guards.some((guard) => guard.code === "guard.pageNumbers"), "应报告页码状态");
    assert.equal(typeof value.id, "string");
    assert.ok(!("previews" in value), "工具结果不应携带图片数据");
  } finally {
    cleanup();
  }
});
