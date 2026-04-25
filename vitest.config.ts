import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["test/unit/**/*.test.ts", "test/integration/**/*.test.ts"],
		exclude: ["test/smoke/**/*.test.ts", "node_modules", "dist"],
		environment: "node",
		testTimeout: 10000,
		hookTimeout: 10000,
	},
});
