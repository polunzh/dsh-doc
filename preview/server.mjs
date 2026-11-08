import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

export function startServer(port = 0) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      let filePath = join(root, url.pathname.replace(/^\//, ""));
      if (url.pathname === "/" || url.pathname === "/preview" || url.pathname === "/preview/") {
        filePath = join(root, "preview", "index.html");
      }
      if (existsSync(filePath)) {
        const ext = extname(filePath).toLowerCase();
        res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream" });
        res.end(readFileSync(filePath));
        return;
      }
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not Found");
    });
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: addr.port });
    });
    server.on("error", reject);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { port } = await startServer(3890);
  console.log(`Preview server running at http://127.0.0.1:${port}`);
}
