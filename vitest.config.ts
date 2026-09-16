import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(path.dirname(fileURLToPath(import.meta.url)), "src") },
  },
  test: {
    environment: "node",
    exclude: ["e2e/**", "node_modules/**"],
    // Integration tests share one PostgreSQL database: files MUST NOT run
    // in parallel, otherwise one file's cleanup deletes another's evidence
    // mid-pipeline ("record to update not found").
    pool: "forks",
    maxWorkers: 1,
    sequence: { shuffle: false },
    testTimeout: 240000,
    hookTimeout: 60000,
  },
});