import { fileURLToPath } from "node:url";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Two projects, because the two halves of the app cannot share a runtime:
// the Worker tests need the Workers pool, the component tests need plain Node
// (they render to a string with `react-dom/server`, no DOM required).
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [
          cloudflareTest({
            wrangler: {
              configPath: "./wrangler.jsonc",
            },
          }),
        ],
        test: {
          name: "worker",
          include: ["worker/**/*.test.ts"],
        },
      },
      {
        // The `@/…` alias the app is written against. Without it a test cannot
        // import anything under src/lib, which is how the two client-side upload
        // guards ended up with no coverage at all.
        resolve: {
          alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
        },
        test: {
          name: "src",
          environment: "node",
          include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
        },
      },
    ],
  },
});
