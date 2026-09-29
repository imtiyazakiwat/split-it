import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Unit tests for pure logic: money arithmetic, ledgers, allocation, statements,
 * the notification decision logic and the service worker handlers.
 *
 * Deliberately `environment: "node"` — nothing under test touches the DOM, and a
 * DOM shim would only hide accidental browser dependencies in modules that are
 * supposed to be pure.
 *
 * `.mts` so Vite loads this as ESM; the package itself is CommonJS (no
 * "type": "module"), and a `.ts` config would be loaded as CJS.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    // Tests live under src/ only. Anything placed in public/ is served to the
    // world as a static file, so the service worker's tests read public/sw.js
    // from src/ rather than sitting next to it.
    include: ["src/**/*.test.ts"],
  },
});
