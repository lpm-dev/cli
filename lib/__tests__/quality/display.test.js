import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("chalk", () => {
	const p = str => str
	p.bold = p
	p.green = p
	p.red = p
	p.cyan = p
	p.gray = p
	p.dim = p
	p.blue = p
	p.yellow = p
	p.white = p
	return { default: p }
})

import { displayQualityReport } from "../../quality/display.js"

let consoleLogs = []

describe("quality/display.js – displayQualityReport()", () => {
	beforeEach(() => {
		consoleLogs = []
		vi.spyOn(console, "log").mockImplementation((...args) =>
			consoleLogs.push(args.join(" ")),
		)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("displays score, tier, and category bars", () => {
		displayQualityReport({
			score: 72,
			checks: [
				{
					id: "has-readme",
					category: "documentation",
					label: "Has README",
					passed: true,
					points: 8,
					maxPoints: 8,
				},
				{
					id: "has-types",
					category: "code",
					label: "Has TypeScript types",
					passed: false,
					points: 0,
					maxPoints: 6,
				},
			],
			meta: {
				tier: "good",
				score: 72,
				maxScore: 100,
				categories: {
					documentation: { score: 18, max: 25 },
					code: { score: 20, max: 30 },
					testing: { score: 11, max: 15 },
					health: { score: 23, max: 30 },
				},
			},
		})

		const output = consoleLogs.join("\n")
		expect(output).toContain("72/100")
		expect(output).toContain("Good")
		expect(output).toContain("Documentation")
		expect(output).toContain("Code Quality")
		expect(output).toContain("Testing")
		expect(output).toContain("Package Health")
	})

	it("shows pass/fail icons for checks", () => {
		displayQualityReport({
			score: 50,
			checks: [
				{
					id: "has-readme",
					category: "documentation",
					label: "Has README",
					passed: true,
					points: 8,
					maxPoints: 8,
				},
				{
					id: "has-types",
					category: "code",
					label: "Has types",
					passed: false,
					points: 0,
					maxPoints: 6,
				},
			],
			meta: {
				tier: "fair",
				score: 50,
				maxScore: 100,
				categories: {
					documentation: { score: 8, max: 25 },
					code: { score: 0, max: 30 },
					testing: { score: 0, max: 15 },
					health: { score: 0, max: 30 },
				},
			},
		})

		const output = consoleLogs.join("\n")
		expect(output).toContain("Has README")
		expect(output).toContain("Has types")
	})

	it("shows tips for failed checks", () => {
		displayQualityReport({
			score: 30,
			checks: [
				{
					id: "has-readme",
					category: "documentation",
					label: "Has README",
					passed: false,
					points: 0,
					maxPoints: 8,
				},
				{
					id: "has-types",
					category: "code",
					label: "Has types",
					passed: false,
					points: 0,
					maxPoints: 6,
				},
			],
			meta: {
				tier: "needs-work",
				score: 30,
				maxScore: 100,
				categories: {
					documentation: { score: 0, max: 25 },
					code: { score: 0, max: 30 },
					testing: { score: 0, max: 15 },
					health: { score: 0, max: 30 },
				},
			},
		})

		const output = consoleLogs.join("\n")
		expect(output).toContain("Tip:")
		expect(output).toContain("README")
	})

	it("shows server-only checks dimmed", () => {
		displayQualityReport({
			score: 60,
			checks: [
				{
					id: "no-eval",
					category: "code",
					label: "No eval",
					passed: true,
					points: 3,
					maxPoints: 3,
					serverOnly: true,
				},
			],
			meta: {
				tier: "fair",
				score: 60,
				maxScore: 100,
				categories: {
					documentation: { score: 0, max: 25 },
					code: { score: 3, max: 30 },
					testing: { score: 0, max: 15 },
					health: { score: 0, max: 30 },
				},
			},
		})

		const output = consoleLogs.join("\n")
		expect(output).toContain("No eval")
		expect(output).toContain("verified after publish")
		expect(output).toContain("estimated")
	})

	it("handles all tier labels", () => {
		for (const tier of ["excellent", "good", "fair", "needs-work"]) {
			consoleLogs = []
			displayQualityReport({
				score: 50,
				checks: [],
				meta: {
					tier,
					score: 50,
					maxScore: 100,
					categories: {
						documentation: { score: 0, max: 25 },
						code: { score: 0, max: 30 },
						testing: { score: 0, max: 15 },
						health: { score: 0, max: 30 },
					},
				},
			})
		}
	})
})
