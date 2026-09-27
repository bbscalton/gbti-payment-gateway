import path from "node:path";
import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig(async () => {
  // Real (local, in-memory) D1 for integration tests, with the repo's migrations applied.
  const migrations = await readD1Migrations(path.join(__dirname, "migrations"));
  return {
    test: {
      setupFiles: ["./src/__tests__/apply-migrations.ts"],
      poolOptions: {
        workers: {
          wrangler: { configPath: "./wrangler.jsonc" },
          miniflare: {
            bindings: {
              TEST_MIGRATIONS: migrations,
              MERCHANT_MASTER_KEY: "test-master-key-for-vitest-only",
              WEBHOOK_SECRET: "whsec_test_for_vitest_only",
            },
          },
        },
      },
    },
  };
});
