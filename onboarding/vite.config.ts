import { defineConfig } from "vite";

const NODE = "https://cn-api.sg.testnet.t3n.terminal3.io";

/** The page talks only to itself; T3N calls go through the same-origin /t3 relay. */
export const securityHeaders: Record<string, string> = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "connect-src 'self'",
    "img-src 'self' data:",
    "style-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; "),
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
};

export default defineConfig({
  server: {
    headers: securityHeaders,
    proxy: { "/t3": { target: NODE, changeOrigin: true, rewrite: (p) => p.replace(/^\/t3/, "") } },
  },
  preview: {
    headers: securityHeaders,
    proxy: { "/t3": { target: NODE, changeOrigin: true, rewrite: (p) => p.replace(/^\/t3/, "") } },
  },
  build: { target: "es2022", sourcemap: true, chunkSizeWarningLimit: 4096 },
  optimizeDeps: { exclude: ["@terminal3/t3n-sdk"] },
});
