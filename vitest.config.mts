import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Repo root, matching tsconfig's `"@/*": ["./*"]`. path.resolve strips the
// trailing separator so the alias produces a single slash when a specifier such
// as "@/lib/prisma" is substituted.
const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)));

export default defineConfig({
  resolve: {
    alias: {
      "@": repoRoot,
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.test.ts"],
    // Never let a stray slow/connecting test hang a run silently.
    testTimeout: 10_000,
  },
});
