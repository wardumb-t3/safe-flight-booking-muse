// Serves dist/ and relays /t3/* to the testnet node, like the Vercel rewrite.
// For local testing: node test/serve-dist.mjs [port]
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
const DIST = fileURLToPath(new URL("../dist", import.meta.url));
const NODE = "https://cn-api.sg.testnet.t3n.terminal3.io";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json", ".map": "application/json" };
const { securityHeaders } = await import("../vite.config.ts").catch(() => ({ securityHeaders: {} }));
createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname.startsWith("/t3/")) {
    if (process.env.RELAY_LOG) console.log("relay", req.method, url.pathname);
    const chunks = []; for await (const c of req) chunks.push(c);
    const headers = { ...req.headers };
    for (const h of ["host", "content-length", "origin", "referer", "connection", "keep-alive", "upgrade", "proxy-connection", "transfer-encoding", "te", "trailer"]) delete headers[h];
    let r;
    try { r = await fetch(NODE + url.pathname.slice(3) + url.search, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined }); }
    catch (e) { console.error("relay error", e.cause?.message ?? e.message); res.statusCode = 502; return res.end("relay error"); }
    res.statusCode = r.status;
    r.headers.forEach((v, k) => { if (!["content-encoding", "content-length", "transfer-encoding"].includes(k)) res.setHeader(k, v); });
    for (const c of r.headers.getSetCookie?.() ?? []) res.appendHeader("set-cookie", c);
    res.end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  const file = normalize(join(DIST, url.pathname === "/" ? "index.html" : url.pathname));
  if (!file.startsWith(DIST)) { res.statusCode = 403; return res.end(); }
  try { const data = await readFile(file); for (const [k, v] of Object.entries(securityHeaders)) res.setHeader(k, v); res.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream"); res.end(data); }
  catch { res.statusCode = 404; res.end("not found"); }
}).listen(Number(process.argv[2] ?? 4175), "127.0.0.1", () => console.log("serving dist on", process.argv[2] ?? 4175));
