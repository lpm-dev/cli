import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		globals: true,
		include: ["lib/__tests__/**/*.test.{js,jsx}"],
		coverage: {
			provider: "v8",
			include: ["lib/**/*.js"],
			exclude: ["lib/__tests__/**"],
			thresholds: {
				statements: 60,
				branches: 50,
				functions: 60,
				lines: 60,
			},
		},
	},
})
