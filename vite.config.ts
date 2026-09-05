/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * The promise this app makes is that nothing leaves the browser. A Content
 * Security Policy that forbids outbound connections is what makes that
 * checkable rather than merely stated: with `connect-src 'self'` a mistake in
 * the code cannot send a document anywhere, and a reader can confirm it from
 * the response headers.
 *
 * It is injected at build time only, because the dev server needs a websocket
 * for hot reload.
 */
const CSP = [
  "default-src 'self'",
  "connect-src 'self'",
  // Tailwind injects styles at runtime; pdf.js needs blob workers.
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'inject-csp',
      transformIndexHtml(html: string) {
        if (command !== 'build') return html;
        return html.replace(
          '<!--csp-->',
          `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
        );
      },
    },
  ],
  build: { target: 'es2022' },
  // pdf.js runs off the main thread, so the worker must be a real ES module.
  worker: { format: 'es' },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
}));
