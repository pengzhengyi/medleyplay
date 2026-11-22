import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The build lands in the Python package, which serves it; during development, Vite
// serves the client and forwards the API to a server on port 8000.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../src/medleyplay/web/client",
    emptyOutDir: true,
  },
  server: {
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/vitest-setup.ts"],
    // A test that renders the whole page and waits for it, as `find` queries may for five
    // seconds, needs longer than the default five seconds on a busy machine.
    testTimeout: 20_000,
  },
});
