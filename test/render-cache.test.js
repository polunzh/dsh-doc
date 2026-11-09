/**
 * 渲染性能相关的集成测试：常驻 Chrome、内容寻址缓存、预览图瘦身。
 *
 * 和 routes.test.js 一样用假的 req/res 直接驱动 handler；区别是一个文件只
 * boot 一次插件实例，这样第二次渲染走的就是同一个常驻 Chrome / 同一份缓存。
 * 测试会真的起 headless Chrome，比较慢属于正常。
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Readable } from "node:stream";
import { shutdownCdp } from "../lib/cdp.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(HERE, "..", "lib", "index.js");

const home = mkdtempSync(join(tmpdir(), "dsh-doc-render-test-"));
process.env.DSH_HOME = home;

const mod = await import(`${pathToFileURL(ENTRY).href}?render-test=${Date.now()}`);
const routes = [];
mod.apply(
  {
    logger: { info() {}, warn() {}, error() {} },
    effect: (fn) => fn(),
    webServer: { register: (route) => (routes.push(route), () => {}) },
    connection: { requestRejection: () => undefined },
  },
  {},
);
assert.equal(routes.length, 1, "应该只注册一条前缀路由");
const handler = routes[0].handler;

const workDir = join(home, "storages", "dsh-doc", "work");

after(async () => {
  // 先把常驻 Chrome 收掉，再删临时 HOME，避免删到一半的 profile 文件
  await shutdownCdp();
  try {
    rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch {
    /* 临时目录清不掉不影响测试结论 */
  }
});

function call(method, url, body) {
  return new Promise((resolve, reject) => {
    const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
    const stream = Readable.from(chunks);
    stream.method = method;
    stream.url = url;
    stream.headers = { "content-type": "application/json" };
    const res = {
      statusCode: 0,
      headers: null,
      writeHead(code, headers) {
        res.statusCode = code;
        res.headers = headers || null;
      },
      end(buffer) {
        resolve({ status: res.statusCode, payload: buffer && buffer.length ? JSON.parse(buffer.toString("utf8")) : null });
      },
    };
    handler(stream, res).catch(reject);
  });
}

/** 渲染一次，顺便记下耗时。 */
async function render(body) {
  const startedAt = performance.now();
  const res = await call("POST", "/dsh-doc/api/render", { template: "generic", ...body });
  return { ...res, ms: performance.now() - startedAt };
}

/** 本机没有 Chrome 时跳过，和 routes.test.js 的处理一致。 */
function chromeMissing(res) {
  return Boolean(res.payload?.error) && /Chrome/i.test(String(res.payload.error));
}

function pdfPages(pdfPath) {
  return new Promise((resolve) => {
    execFile("pdfinfo", [pdfPath], (error, stdout) => {
      const match = /^Pages:\s+(\d+)/m.exec(String(stdout ?? ""));
      resolve(error ? null : Number(match?.[1] ?? 0));
    });
  });
}

/** 从 data URL 里读出 PNG 尺寸与字节数（PNG 的 IHDR 固定在偏移 16/20）。 */
function pngInfo(dataUrl) {
  const comma = dataUrl.indexOf(",");
  const buffer = Buffer.from(dataUrl.slice(comma + 1), "base64");
  assert.equal(buffer.toString("latin1", 1, 4), "PNG", "预览图应该是 PNG");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), bytes: buffer.length };
}

/** 一次渲染返回的 PDF 应该真实存在且是合法 PDF。 */
function assertPdfUsable(id) {
  const pdfPath = join(workDir, `${id}.pdf`);
  assert.equal(existsSync(pdfPath), true, `渲染结果应落盘：${pdfPath}`);
  const bytes = readFileSync(pdfPath);
  assert.equal(bytes.subarray(0, 5).toString("latin1"), "%PDF-");
  assert.ok(bytes.length > 800, "PDF 不应是空壳");
  return { pdfPath, bytes };
}

test("同一内容第二次渲染命中缓存：页数/预览数一致、id 不同、PDF 都可用", async (t) => {
  const markdown = "## 缓存命中测试\n同一段内容连续渲染两次，第二次应复用缓存产物。";
  const first = await render({ markdown });
  if (chromeMissing(first)) {
    t.skip("本机没有可用的 Chrome");
    return;
  }
  assert.equal(first.status, 200, JSON.stringify(first.payload));

  const second = await render({ markdown });
  assert.equal(second.status, 200, JSON.stringify(second.payload));

  assert.equal(second.payload.pages, first.payload.pages, "缓存命中不应改变页数");
  assert.equal(second.payload.previews.length, first.payload.previews.length, "缓存命中应复用同样的预览图数量");
  assert.deepEqual(
    second.payload.previews.map((preview) => preview.page),
    first.payload.previews.map((preview) => preview.page),
  );
  assert.equal(second.payload.pageNumbers, first.payload.pageNumbers, "页码状态应一致");
  assert.notEqual(second.payload.id, first.payload.id, "每次渲染都要给新 id，前端才能引用");
  assert.equal(second.payload.pdfPath, undefined, "不应把磁盘路径回传前端");

  // 返回结构不能因为走缓存而缺字段
  assert.deepEqual(Object.keys(second.payload).sort(), Object.keys(first.payload).sort());

  const firstPdf = assertPdfUsable(first.payload.id);
  const secondPdf = assertPdfUsable(second.payload.id);
  assert.equal(secondPdf.bytes.length, firstPdf.bytes.length, "缓存复用的 PDF 应与首次产物一致");

  // 命中不走 Chrome + poppler：本机冷路径 1.2–1.6s，命中只有复制文件 + 读图
  assert.ok(second.ms < 500, `缓存命中应明显低于 500ms，实测 ${second.ms.toFixed(0)}ms`);
  assert.ok(second.ms < first.ms, "第二次渲染应快于第一次");
});

test("常驻 Chrome 复用不会串内容：两份文档互不影响", async (t) => {
  const short = "## 甲文档\n这里只有一小段内容。";
  const long = Array.from({ length: 120 }, (_, index) => `第 ${index + 1} 段：常驻 Chrome 复用测试，内容要足够长才能排出多页。`).join("\n\n");

  const first = await render({ markdown: short });
  if (chromeMissing(first)) {
    t.skip("本机没有可用的 Chrome");
    return;
  }
  assert.equal(first.status, 200, JSON.stringify(first.payload));

  // 第二次渲染换了内容，只能靠常驻 Chrome 复用（缓存必然不命中）
  const second = await render({ markdown: long });
  assert.equal(second.status, 200, JSON.stringify(second.payload));

  assert.ok(second.payload.pages > first.payload.pages, "长文档应该排出更多页，说明两次是独立渲染的");
  assert.equal(await pdfPages(assertPdfUsable(second.payload.id).pdfPath), second.payload.pages, "页数应与 PDF 实际页数一致");
  assert.notEqual(
    second.payload.previews[0].dataUrl,
    first.payload.previews[0].dataUrl,
    "第二份文档的预览图不能是上一份的内容",
  );

  // 再渲染第一份：命中缓存，产物必须与它自己第一次的结果一致，而不是被第二份污染
  const again = await render({ markdown: short });
  assert.equal(again.status, 200, JSON.stringify(again.payload));
  assert.equal(again.payload.pages, first.payload.pages, "缓存按内容区分，不能被别的文档覆盖");
  assert.equal(again.payload.previews.length, first.payload.previews.length);
  assert.equal(again.payload.previews[0].dataUrl, first.payload.previews[0].dataUrl);
});

test("并发渲染不同内容：串行化后各自写自己的 PDF，不交错", async (t) => {
  const left = "## 并发甲\n左边这份内容只属于左请求。";
  const right = "## 并发乙\n右边这份内容只属于右请求。";

  const [first, second] = await Promise.all([render({ markdown: left }), render({ markdown: right })]);
  if (chromeMissing(first) || chromeMissing(second)) {
    t.skip("本机没有可用的 Chrome");
    return;
  }
  assert.equal(first.status, 200, JSON.stringify(first.payload));
  assert.equal(second.status, 200, JSON.stringify(second.payload));
  assert.notEqual(first.payload.id, second.payload.id);

  const firstPdf = assertPdfUsable(first.payload.id);
  const secondPdf = assertPdfUsable(second.payload.id);
  assert.notEqual(firstPdf.bytes.toString("latin1"), secondPdf.bytes.toString("latin1"), "两份 PDF 不应是同一份内容");
  assert.equal(await pdfPages(firstPdf.pdfPath), first.payload.pages);
  assert.equal(await pdfPages(secondPdf.pdfPath), second.payload.pages);
});

test("预览图缩到 144dpi 并限最长边 1400px，单页体积明显变小", async (t) => {
  const result = await render({ markdown: "## 预览图体积\n这一页用来检查预览图的分辨率与体积。" });
  if (chromeMissing(result)) {
    t.skip("本机没有可用的 Chrome");
    return;
  }
  assert.equal(result.status, 200, JSON.stringify(result.payload));
  assert.ok(result.payload.previews.length >= 1);

  const info = pngInfo(result.payload.previews[0].dataUrl);
  assert.ok(info.height <= 1400, `最长边应不超过 1400px，实测 ${info.height}`);
  assert.ok(info.width >= 900 && info.width <= 1100, `A4 宽度约 992px（144dpi 限高后），实测 ${info.width}`);
  // 180dpi 时代单页 PNG 约 380KB / data URL 517KB；现在应明显更小
  assert.ok(info.bytes < 320 * 1024, `单页 PNG 应明显变小，实测 ${(info.bytes / 1024).toFixed(0)}KB`);
  assert.ok(info.width / info.height > 0.7 && info.width / info.height < 0.72, "比例仍应是 A4 竖版");
});

test("CDP 不可用时回落到 CLI：仍出 PDF，只是没有页码", async (t) => {
  const nativeWebSocket = globalThis.WebSocket;
  const markdown = "## 回退路径\n这一份内容只在 CLI 路径下渲染。";
  let result;
  try {
    // cdp.js 在调用时检查 WebSocket，模拟不支持 WebSocket 的运行环境
    globalThis.WebSocket = undefined;
    result = await render({ markdown });
  } finally {
    globalThis.WebSocket = nativeWebSocket;
  }

  if (chromeMissing(result)) {
    t.skip("本机没有可用的 Chrome");
    return;
  }
  assert.equal(result.status, 200, JSON.stringify(result.payload));
  assert.ok(result.payload.pages >= 1, "回退路径也要能出 PDF");
  assert.equal(result.payload.pageNumbers, false, "CLI 路径没有真实页码");
  assert.ok(
    result.payload.guardCodes.some((guard) => guard.code === "guard.pageNumbersMissing"),
    "应回报「没有页码」的校验结果，而不是假装有页码",
  );
  assert.ok(result.payload.previews.length >= 1, "回退路径也要有预览图");
  assertPdfUsable(result.payload.id);
});
