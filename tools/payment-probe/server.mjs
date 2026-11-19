// Standalone server for hosting the probe on a VPS (no Vercel needed).
// Serves public/ and routes /api/<name> to the same handlers Vercel runs.
// Run behind a TLS proxy (see deploy/Caddyfile): Muse needs a public https URL.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC = join(ROOT, "public");
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const MAX_BODY = 64 * 1024;

const API = {
  config: (await import("./api/config.js")).default,
  "create-intent": (await import("./api/create-intent.js")).default,
  checkout: (await import("./api/checkout.js")).default,
  log: (await import("./api/log.js")).default,
};

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// The subset of Vercel's response helpers the handlers use.
function withHelpers(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); return res; };
  res.send = (body) => { if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", "text/plain; charset=utf-8"); res.end(String(body)); return res; };
  res.redirect = (code, url) => { res.statusCode = code; res.setHeader("Location", url); res.end(); return res; };
  return res;
}

async function serveStatic(pathname, res) {
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const file = normalize(join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) { res.statusCode = 403; res.end(); return; }
  try {
    const data = await readFile(file);
    res.setHeader("Content-Type", TYPES[extname(file)] || "application/octet-stream");
    res.setHeader("X-Robots-Tag", "noindex");
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end("Not found");
  }
}

createServer(async (req, rawRes) => {
  const res = withHelpers(rawRes);
  const url = new URL(req.url, "http://localhost");
  const m = url.pathname.match(/^\/api\/([a-z-]+)$/);
  try {
    if (!m) { await serveStatic(url.pathname, res); return; }
    const handler = API[m[1]];
    if (!handler) { res.status(404).json({ error: "no such endpoint" }); return; }
    const raw = req.method === "POST" ? await readBody(req) : "";
    const ctype = req.headers["content-type"] || "";
    req.body = !raw ? undefined
      : ctype.includes("application/json") ? JSON.parse(raw)
      : ctype.includes("application/x-www-form-urlencoded") ? Object.fromEntries(new URLSearchParams(raw))
      : raw;
    await handler(req, res);
  } catch (e) {
    console.error(JSON.stringify({ probe: "server_error", message: e.message }));
    if (!res.headersSent) res.status(400).json({ error: "bad request" });
  }
}).listen(PORT, HOST, () => console.log(`payment probe listening on http://${HOST}:${PORT}`));
