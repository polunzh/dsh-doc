/**
 * 宿主路由的集成测试。
 *
 * 不启动 HTTP 服务：直接构造一个最小的 Cordis 上下文，抓住 `webServer.register`
 * 的 handler，再用假的 req/res 驱动它。这样持久化、CRUD、错误分支都能被覆盖，
 * 也正是这类测试能拦住「漏 import renameSync」那种运行时错误。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Readable } from "node:stream";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(HERE, "..", "lib", "index.js");

let generation = 0;

/** 用独立的 DSH_HOME 启动一份插件实例，返回它的 HTTP handler。 */
async function boot() {
  const home = mkdtempSync(join(tmpdir(), "dsh-doc-test-"));
  process.env.DSH_HOME = home;
  generation += 1;
  const url = `${pathToFileURL(ENTRY).href}?g=${generation}`;
  const mod = await import(url);

  const routes = [];
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    effect: (fn) => fn(),
    webServer: { register: (route) => (routes.push(route), () => {}) },
    connection: { requestRejection: () => undefined },
  };
  mod.apply(ctx, {});
  assert.equal(routes.length, 1, "应该只注册一条前缀路由");
  return {
    handler: routes[0].handler,
    home,
    cleanup: () => {
      try {
        rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } catch {}
    },
  };
}

function makeRequest({ method = "GET", url, body }) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const stream = Readable.from(chunks);
  stream.method = method;
  stream.url = url;
  stream.headers = { "content-type": "application/json" };
  return stream;
}

function makeResponse() {
  const res = {
    statusCode: 0,
    headers: null,
    payload: null,
    writeHead(code, headers) {
      res.statusCode = code;
      res.headers = headers;
    },
    end(buffer) {
      res.payload = buffer && buffer.length ? JSON.parse(buffer.toString("utf8")) : null;
    },
  };
  return res;
}

async function call(handler, method, url, body) {
  const res = makeResponse();
  await handler(makeRequest({ method, url, body }), res);
  return res;
}

test("POST /templates：内置模板可以编辑并持久化覆盖", async () => {
  const app = await boot();
  try {
    const saved = await call(app.handler, "POST", "/dsh-doc/api/templates", {
      action: "update",
      id: "generic",
      template: { fontSize: 13, lineHeight: 2, margin: 26, font: "kaiti" },
    });
    assert.equal(saved.statusCode, 200, JSON.stringify(saved.payload));
    assert.equal(saved.payload.template.title, "通用讲义", "改字号不应把内置标题冲掉");
    assert.equal(saved.payload.template.fontSize, 13);
    assert.equal(saved.payload.template.lineHeight, 2);
    assert.equal(saved.payload.template.margin, 26);

    const status = await call(app.handler, "GET", "/dsh-doc/api/status");
    const generic = status.payload.templates.find((t) => t.id === "generic");
    assert.equal(generic.fontSize, 13);
    assert.equal(generic.edited, true, "改过的内置模板要标记出来");

    // 重启式重读：新建实例读同一份文件
    const file = join(app.home, "storages", "dsh-doc", "templates.json");
    assert.ok(existsSync(file));
    const raw = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(raw.version, 2);
    assert.equal(raw.builtinOverrides.generic.lineHeight, 2);

    // 恢复默认
    const reset = await call(app.handler, "POST", "/dsh-doc/api/templates", { action: "reset", id: "generic" });
    assert.equal(reset.statusCode, 200);
    const after = reset.payload.templates.find((t) => t.id === "generic");
    assert.equal(after.fontSize, 10.5, "恢复后回到内置默认字号");
    assert.ok(!after.edited);
  } finally {
    app.cleanup();
  }
});

test("POST /templates：reset 只接受内置模板", async () => {
  const app = await boot();
  try {
    const created = await call(app.handler, "POST", "/dsh-doc/api/templates", {
      action: "create",
      template: { title: "自定义" },
    });
    const id = created.payload.template.id;
    const bad = await call(app.handler, "POST", "/dsh-doc/api/templates", { action: "reset", id });
    assert.equal(bad.statusCode, 400);
  } finally {
    app.cleanup();
  }
});

test("GET /status：返回打印机、默认值、内置模板与系统字体", async () => {
  const app = await boot();
  try {
    const res = await call(app.handler, "GET", "/dsh-doc/api/status");
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.ok, true);
    assert.ok(Array.isArray(res.payload.printers));
    assert.equal(res.payload.templates.length, 1);
    assert.equal(res.payload.templates[0].id, "generic");
    assert.equal(res.payload.defaults.duplex, "long");
    assert.ok(Array.isArray(res.payload.systemFonts), "status 返回系统字体列表");
    assert.ok(res.payload.systemFonts.length > 0);
    assert.equal(typeof res.payload.fontAliases, "object", "status 同时返回中英文字体别名");
  } finally {
    app.cleanup();
  }
});

test("GET /fonts：独立返回系统字体列表", async () => {
  const app = await boot();
  try {
    const res = await call(app.handler, "GET", "/dsh-doc/api/fonts");
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.ok, true);
    assert.ok(Array.isArray(res.payload.fonts));
    assert.ok(res.payload.fonts.length > 0);
    assert.equal(typeof res.payload.aliases, "object", "字体接口一并返回别名表");
  } finally {
    app.cleanup();
  }
});

test("POST /templates：创建后落盘，并在 /status 里出现", async () => {
  const app = await boot();
  try {
    const created = await call(app.handler, "POST", "/dsh-doc/api/templates", {
      action: "create",
      template: { title: "古诗", subtitle: "唐诗选读", accent: "#2B4C7E", fontSize: 12, columns: 2 },
    });
    assert.equal(created.statusCode, 200, JSON.stringify(created.payload));
    const tpl = created.payload.template;
    assert.match(tpl.id, /^tpl-[0-9a-f]{8}$/);
    assert.equal(tpl.title, "古诗");
    assert.equal(tpl.columns, 2);

    const file = join(app.home, "storages", "dsh-doc", "templates.json");
    assert.ok(existsSync(file), "templates.json 应该被创建");
    const saved = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(saved.templates.length, 1);
    assert.equal(saved.templates[0].title, "古诗");

    const status = await call(app.handler, "GET", "/dsh-doc/api/status");
    assert.equal(status.payload.templates.length, 2);
    assert.equal(status.payload.templates[1].id, tpl.id);
  } finally {
    app.cleanup();
  }
});

test("POST /templates：update 改字段但保留 id", async () => {
  const app = await boot();
  try {
    const created = await call(app.handler, "POST", "/dsh-doc/api/templates", {
      action: "create",
      template: { title: "初稿", fontSize: 10.5 },
    });
    const id = created.payload.template.id;

    const updated = await call(app.handler, "POST", "/dsh-doc/api/templates", {
      action: "update",
      id,
      template: { title: "终稿", fontSize: 13.5, columns: 2 },
    });
    assert.equal(updated.statusCode, 200, JSON.stringify(updated.payload));
    assert.equal(updated.payload.template.id, id);
    assert.equal(updated.payload.template.title, "终稿");
    assert.equal(updated.payload.template.fontSize, 13.5);
    assert.equal(updated.payload.templates.length, 2);

    const saved = JSON.parse(readFileSync(join(app.home, "storages", "dsh-doc", "templates.json"), "utf8"));
    assert.equal(saved.templates[0].title, "终稿");
  } finally {
    app.cleanup();
  }
});

test("POST /templates：delete 之后回到只剩内置", async () => {
  const app = await boot();
  try {
    const created = await call(app.handler, "POST", "/dsh-doc/api/templates", {
      action: "create",
      template: { title: "临时" },
    });
    const id = created.payload.template.id;

    const removed = await call(app.handler, "POST", "/dsh-doc/api/templates", { action: "delete", id });
    assert.equal(removed.statusCode, 200);
    assert.equal(removed.payload.templates.length, 1);

    const again = await call(app.handler, "POST", "/dsh-doc/api/templates", { action: "delete", id });
    assert.equal(again.statusCode, 404, "重复删除应报 404");
  } finally {
    app.cleanup();
  }
});

test("POST /templates：未知动作与非 JSON 请求被拒绝", async () => {
  const app = await boot();
  try {
    const bad = await call(app.handler, "POST", "/dsh-doc/api/templates", { action: "whatever" });
    assert.equal(bad.statusCode, 400);

    const res = makeResponse();
    const stream = Readable.from([]);
    stream.method = "POST";
    stream.url = "/dsh-doc/api/templates";
    stream.headers = { "content-type": "text/plain" };
    await app.handler(stream, res);
    assert.equal(res.statusCode, 415, "非 JSON 写请求应在准入层被拒");
  } finally {
    app.cleanup();
  }
});

test("POST /draft：草稿落盘，重启式重读仍在", async () => {
  const app = await boot();
  try {
    const before = await call(app.handler, "GET", "/dsh-doc/api/status");
    assert.equal(before.payload.draft, null, "首次应没有草稿");

    const saved = await call(app.handler, "POST", "/dsh-doc/api/draft", { markdown: "春江潮水连海平" });
    assert.equal(saved.statusCode, 200, JSON.stringify(saved.payload));
    assert.ok(existsSync(join(app.home, "storages", "dsh-doc", "draft.json")));

    const after = await call(app.handler, "GET", "/dsh-doc/api/status");
    assert.equal(after.payload.draft.markdown, "春江潮水连海平");

    await call(app.handler, "POST", "/dsh-doc/api/draft", { markdown: "第二版内容" });
    const again = await call(app.handler, "GET", "/dsh-doc/api/status");
    assert.equal(again.payload.draft.markdown, "第二版内容", "覆盖保存应生效");

    const cleared = await call(app.handler, "POST", "/dsh-doc/api/draft", { markdown: "" });
    assert.equal(cleared.statusCode, 200, "清空也是合法状态");
    const empty = await call(app.handler, "GET", "/dsh-doc/api/status");
    assert.equal(empty.payload.draft.markdown, "");
  } finally {
    app.cleanup();
  }
});

test("POST /render：style 覆盖即时生效但不写进模板文件", async (t) => {
  const app = await boot();
  try {
    // 先把字调大预览
    const res = await call(app.handler, "POST", "/dsh-doc/api/render", {
      markdown: "春江潮水连海平，海上明月共潮生。",
      template: "generic",
      style: { fontSize: 16, lineHeight: 2.2, margin: 30, font: "kaiti" },
    });

    if (res.payload?.error && /Chrome/i.test(String(res.payload.error))) {
      t.skip("本机没有可用的 Chrome");
      return;
    }
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));

    // 模板文件不应被创建（预览不等于保存）
    const file = join(app.home, "storages", "dsh-doc", "templates.json");
    assert.equal(existsSync(file), false, "临时预览不应写模板文件");

    // /status 里的模板仍是原值
    const status = await call(app.handler, "GET", "/dsh-doc/api/status");
    const generic = status.payload.templates.find((x) => x.id === "generic");
    assert.equal(generic.fontSize, 10.5, "临时覆盖不能污染模板");
    assert.equal(generic.margin, 18);
  } finally {
    app.cleanup();
  }
});

test("POST /render：越界的 style 被夹到合法范围", async (t) => {
  const app = await boot();
  try {
    const res = await call(app.handler, "POST", "/dsh-doc/api/render", {
      markdown: "测试越界",
      template: "generic",
      style: { fontSize: 999, lineHeight: 99, margin: 999 },
    });
    if (res.payload?.error && /Chrome/i.test(String(res.payload.error))) {
      t.skip("本机没有可用的 Chrome");
      return;
    }
    assert.equal(res.statusCode, 200);
    assert.ok(res.payload.pages >= 1, "越界值不应导致渲染失败");
  } finally {
    app.cleanup();
  }
});

test("POST /render：支持系统字体（如 PingFang SC）渲染", async (t) => {
  const app = await boot();
  try {
    const res = await call(app.handler, "POST", "/dsh-doc/api/render", {
      markdown: "## 系统字体排版测试\n测试内容使用系统字体渲染。",
      template: "generic",
      style: { font: "PingFang SC" },
    });
    if (res.payload?.error && /Chrome/i.test(String(res.payload.error))) {
      t.skip("本机没有可用的 Chrome");
      return;
    }
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(res.payload.ok, true);
    assert.ok(res.payload.pages >= 1);
  } finally {
    app.cleanup();
  }
});

test("POST /render：真能渲染出 PDF；纯诗不带模板标题", async (t) => {
  const app = await boot();
  try {
    const poem = ["春江花月夜", "唐 · 张若虚", "春江潮水连海平，海上明月共潮生。", "滟滟随波千万里，何处春江无月明。"].join("\n");
    const res = await call(app.handler, "POST", "/dsh-doc/api/render", { markdown: poem, template: "generic" });

    if (res.payload?.error && /Chrome/i.test(String(res.payload.error))) {
      t.skip("本机没有可用的 Chrome");
      return;
    }

    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.ok(res.payload.pages >= 1, "至少一页");
    assert.ok(res.payload.previews.length >= 1, "应该带预览图");
    assert.ok(res.payload.previews[0].dataUrl.startsWith("data:image/png;base64,"));
    assert.equal(res.payload.title, "", "纯诗不应补模板标题");
    assert.equal(res.payload.pageNumbers, true, "应该走 CDP 拿到页码");
    assert.ok(res.payload.guards.some((g) => g.code === "guard.pageNumbers"), "校验里应回报页码");
    assert.ok(res.payload.guardCodes.length > 0, "应同时返回语义码供界面翻译");
    assert.equal(res.payload.pdfPath, undefined, "不应把磁盘路径回传前端");
  } finally {
    app.cleanup();
  }
});

test("未知路由返回 404，越权请求返回 401", async () => {
  const app = await boot();
  try {
    const missing = await call(app.handler, "GET", "/dsh-doc/api/nope");
    assert.equal(missing.statusCode, 404);

    const home = mkdtempSync(join(tmpdir(), "dsh-doc-test-"));
    process.env.DSH_HOME = home;
    generation += 1;
    const mod = await import(`${pathToFileURL(ENTRY).href}?g=${generation}`);
    const routes = [];
    mod.apply(
      {
        logger: { info() {}, warn() {}, error() {} },
        effect: (fn) => fn(),
        webServer: { register: (route) => (routes.push(route), () => {}) },
        connection: { requestRejection: () => 403 },
      },
      {},
    );
    const denied = await call(routes[0].handler, "GET", "/dsh-doc/api/status");
    assert.equal(denied.statusCode, 403);
    rmSync(home, { recursive: true, force: true });
  } finally {
    app.cleanup();
  }
});
