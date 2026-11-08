import { startServer } from "../preview/server.mjs";
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function launchDevtools(port) {
  const userDataDir = join(tmpdir(), "cap-doc-" + Date.now());
  mkdirSync(userDataDir, { recursive: true });
  return new Promise((res, rej) => {
    const child = spawn(
      CHROME,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--no-first-run",
        "--remote-debugging-port=0",
        `--user-data-dir=${userDataDir}`,
        "--window-size=1440,900",
        "about:blank",
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    let settled = false;
    let buffer = "";
    child.stderr.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(buffer);
      if (match && !settled) {
        settled = true;
        res({ child, url: match[1] });
      }
    });
    child.on("error", rej);
  });
}

function createChannel(socket) {
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve } = pending.get(message.id);
      pending.delete(message.id);
      resolve(message.result);
    }
  });

  return {
    call(method, params = {}, sessionId) {
      const id = nextId++;
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      return new Promise((resolve) => {
        pending.set(id, { resolve });
        socket.send(JSON.stringify(payload));
      });
    }
  };
}

async function captureShot(wsUrl, pageUrl, outFile) {
  const socket = new WebSocket(wsUrl);
  await new Promise((r) => socket.addEventListener("open", r));
  const channel = createChannel(socket);

  const target = await channel.call("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await channel.call("Target.attachToTarget", { targetId: target.targetId, flatten: true });

  await channel.call("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 2,
    mobile: false
  }, sessionId);

  await channel.call("Page.enable", {}, sessionId);
  await channel.call("Page.navigate", { url: pageUrl }, sessionId);

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const evalRes = await channel.call("Runtime.evaluate", {
      expression: "Boolean(window.__previewReady)",
      returnByValue: true
    }, sessionId);
    if (evalRes?.result?.value === true) break;
  }

  await new Promise((r) => setTimeout(r, 800));

  const screenshot = await channel.call("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    clip: { x: 0, y: 0, width: 1440, height: 900, scale: 1 }
  }, sessionId);

  writeFileSync(outFile, Buffer.from(screenshot.data, "base64"));
  socket.close();
}

async function main() {
  const { server, port } = await startServer();
  console.log(`Server started on :${port}`);
  const { child, url: wsUrl } = await launchDevtools(port);

  console.log("Capturing zh screenshot...");
  await captureShot(wsUrl, `http://127.0.0.1:${port}/preview/?locale=zh`, join(root, "preview", "screenshots", "workspace-zh.png"));

  console.log("Capturing en screenshot...");
  await captureShot(wsUrl, `http://127.0.0.1:${port}/preview/?locale=en`, join(root, "preview", "screenshots", "workspace-en.png"));

  child.kill("SIGKILL");
  server.close();
  console.log("All screenshots captured successfully.");
}

main().catch(console.error);
