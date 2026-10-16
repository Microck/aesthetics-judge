import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Multithreaded ONNX Runtime needs SharedArrayBuffer, which needs cross-origin
// isolation. Production sets the same headers in public/_headers.
const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { headers: isolation, proxy: { "/api": "http://127.0.0.1:8787" } },
  preview: { headers: isolation },
  // ORT locates its .wasm next to its own module; pre-bundling breaks that path.
  optimizeDeps: { exclude: ["onnxruntime-web", "rusty-chromaprint-wasm"] },
  worker: { format: "es" },
});
