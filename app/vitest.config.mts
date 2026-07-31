import { defineConfig } from "vitest/config";

// include is pinned to app/test: the tests import daemon source directly, and a
// default glob would sweep up daemon/test/** and run the daemon suite twice.
export default defineConfig({ test: { environment: "node", include: ["test/**/*.test.ts"] } });
