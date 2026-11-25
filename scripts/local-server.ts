// Run the site locally without Netlify: `npm run dev`, then open http://localhost:8888
// Uses a local SQLite file (local.db) and a local photo folder (.local-photos).
process.env.CLOSET_DEV = "1";

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

const { handle } = await import("../src/app.js");
const PORT = Number(process.env.PORT || 8888);
const PUBLIC = path.resolve("public");
const TYPES: Record<string, string> = { ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" };

createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const file = path.join(PUBLIC, path.normalize(url.pathname));
  if (file.startsWith(PUBLIC + path.sep)) {
    try {
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
      return res.end(body);
    } catch { /* not a static file */ }
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const request = new Request(url, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
    // @ts-expect-error Node needs this for streamed request bodies
    duplex: "half",
  });
  const response = await handle(request);
  const headers: Record<string, string | string[]> = {};
  response.headers.forEach((v, k) => { if (k !== "set-cookie") headers[k] = v; });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) headers["set-cookie"] = cookies;
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(PORT, () => console.log(`AO Community Closet running at http://localhost:${PORT}`));
