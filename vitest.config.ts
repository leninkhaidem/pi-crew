import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["test/unit/**/*.test.ts", "test/integration/**/*.test.ts", "test/smoke/**/*.test.ts"],
		exclude: ["node_modules", "dist"],
		environment: "node",
		testTimeout: 60000,
		hookTimeout: 60000,
	},
});
