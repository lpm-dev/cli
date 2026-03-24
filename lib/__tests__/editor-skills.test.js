import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// We use real fs for these tests (temp directories)

vi.mock("chalk", () => {
	const passthrough = str => str
	passthrough.red = passthrough
	passthrough.green = passthrough
	passthrough.cyan = passthrough
	passthrough.dim = passthrough
	passthrough.yellow = passthrough
	passthrough.bold = passthrough
	return { default: passthrough }
})

vi.mock("../ui.js", () => ({
	log: {
		error: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		success: vi.fn(),
		dim: vi.fn(),
	},
	printHeader: vi.fn(),
}))

import {
	appendSkillsReference,
	autoIntegrateSkills,
	collectSkillFiles,
	createClaudeMdWithReference,
	detectAIEditors,
	hasSkillsReference,
	symlinkForCursor,
} from "../editor-skills.js"

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "lpm-editor-skills-"))
	vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(() => {
	vi.restoreAllMocks()
	if (tmpDir) {
		rmSync(tmpDir, { recursive: true, force: true })
		tmpDir = null
	}
})

// ---------------------------------------------------------------------------
// detectAIEditors
// ---------------------------------------------------------------------------

describe("detectAIEditors", () => {
	it("returns empty array when no AI editor configs exist", () => {
		const editors = detectAIEditors(tmpDir)
		expect(editors).toHaveLength(0)
	})

	it("detects CLAUDE.md", () => {
		writeFileSync(join(tmpDir, "CLAUDE.md"), "# Guidelines")
		const editors = detectAIEditors(tmpDir)
		expect(editors.some(e => e.id === "claude-code")).toBe(true)
	})

	it("detects .cursor/rules/ directory", () => {
		mkdirSync(join(tmpDir, ".cursor", "rules"), { recursive: true })
		const editors = detectAIEditors(tmpDir)
		expect(editors.some(e => e.id === "cursor")).toBe(true)
	})

	it("detects .cursorrules file", () => {
		writeFileSync(join(tmpDir, ".cursorrules"), "# Rules")
		const editors = detectAIEditors(tmpDir)
		expect(editors.some(e => e.id === "cursor-legacy")).toBe(true)
	})

	it("detects .windsurfrules file", () => {
		writeFileSync(join(tmpDir, ".windsurfrules"), "# Rules")
		const editors = detectAIEditors(tmpDir)
		expect(editors.some(e => e.id === "windsurf")).toBe(true)
	})

	it("detects .github/copilot-instructions.md", () => {
		mkdirSync(join(tmpDir, ".github"), { recursive: true })
		writeFileSync(
			join(tmpDir, ".github", "copilot-instructions.md"),
			"# Instructions",
		)
		const editors = detectAIEditors(tmpDir)
		expect(editors.some(e => e.id === "github-copilot")).toBe(true)
	})

	it("detects .augment/instructions.md", () => {
		mkdirSync(join(tmpDir, ".augment"), { recursive: true })
		writeFileSync(join(tmpDir, ".augment", "instructions.md"), "# Instructions")
		const editors = detectAIEditors(tmpDir)
		expect(editors.some(e => e.id === "augment")).toBe(true)
	})

	it("detects .clinerules file", () => {
		writeFileSync(join(tmpDir, ".clinerules"), "# Rules")
		const editors = detectAIEditors(tmpDir)
		expect(editors.some(e => e.id === "cline")).toBe(true)
	})

	it("detects multiple editors simultaneously", () => {
		writeFileSync(join(tmpDir, "CLAUDE.md"), "# Guidelines")
		writeFileSync(join(tmpDir, ".cursorrules"), "# Rules")
		writeFileSync(join(tmpDir, ".windsurfrules"), "# Rules")

		const editors = detectAIEditors(tmpDir)
		expect(editors).toHaveLength(3)
	})
})

// ---------------------------------------------------------------------------
// hasSkillsReference
// ---------------------------------------------------------------------------

describe("hasSkillsReference", () => {
	it("returns false for non-existent file", () => {
		expect(hasSkillsReference(join(tmpDir, "nonexistent.md"))).toBe(false)
	})

	it("returns false when file has no reference", () => {
		const filePath = join(tmpDir, "test.md")
		writeFileSync(filePath, "# Some content\n\nNo skills here.")
		expect(hasSkillsReference(filePath)).toBe(false)
	})

	it("returns true when file contains .lpm/skills reference", () => {
		const filePath = join(tmpDir, "test.md")
		writeFileSync(filePath, "# Guidelines\n\nSee .lpm/skills/ for guidelines.")
		expect(hasSkillsReference(filePath)).toBe(true)
	})

	it("returns true when file contains LPM marker", () => {
		const filePath = join(tmpDir, "test.md")
		writeFileSync(filePath, "# Guidelines\n\n<!-- lpm:skills -->\n")
		expect(hasSkillsReference(filePath)).toBe(true)
	})
})

// ---------------------------------------------------------------------------
// appendSkillsReference
// ---------------------------------------------------------------------------

describe("appendSkillsReference", () => {
	it("appends reference block to file", () => {
		const filePath = join(tmpDir, "CLAUDE.md")
		writeFileSync(filePath, "# Guidelines\n\nExisting content.")

		const result = appendSkillsReference(filePath)

		expect(result).toBe(true)
		const content = readFileSync(filePath, "utf-8")
		expect(content).toContain("<!-- lpm:skills -->")
		expect(content).toContain(".lpm/skills/")
		expect(content).toContain("Existing content.")
	})

	it("does not append if reference already present", () => {
		const filePath = join(tmpDir, "CLAUDE.md")
		writeFileSync(filePath, "# Guidelines\n\nSee .lpm/skills/ for info.")

		const result = appendSkillsReference(filePath)

		expect(result).toBe(false)
	})

	it("does not append if marker already present", () => {
		const filePath = join(tmpDir, "CLAUDE.md")
		writeFileSync(filePath, "# Guidelines\n\n<!-- lpm:skills -->\n")

		const result = appendSkillsReference(filePath)

		expect(result).toBe(false)
	})
})

// ---------------------------------------------------------------------------
// createClaudeMdWithReference
// ---------------------------------------------------------------------------

describe("createClaudeMdWithReference", () => {
	it("creates CLAUDE.md when it does not exist", () => {
		const result = createClaudeMdWithReference(tmpDir)

		expect(result).toBe(true)
		const content = readFileSync(join(tmpDir, "CLAUDE.md"), "utf-8")
		expect(content).toContain("<!-- lpm:skills -->")
		expect(content).toContain(".lpm/skills/")
	})

	it("does not overwrite existing CLAUDE.md", () => {
		writeFileSync(join(tmpDir, "CLAUDE.md"), "# Existing content")

		const result = createClaudeMdWithReference(tmpDir)

		expect(result).toBe(false)
		const content = readFileSync(join(tmpDir, "CLAUDE.md"), "utf-8")
		expect(content).toBe("# Existing content")
	})
})

// ---------------------------------------------------------------------------
// collectSkillFiles
// ---------------------------------------------------------------------------

describe("collectSkillFiles", () => {
	it("returns empty array when .lpm/skills/ does not exist", () => {
		const files = collectSkillFiles(tmpDir)
		expect(files).toHaveLength(0)
	})

	it("collects skill files from package subdirectories", () => {
		const pkgDir = join(tmpDir, ".lpm", "skills", "neo.colors")
		mkdirSync(pkgDir, { recursive: true })
		writeFileSync(join(pkgDir, "getting-started.md"), "# Getting Started")
		writeFileSync(join(pkgDir, "api-reference.md"), "# API Reference")

		const files = collectSkillFiles(tmpDir)

		expect(files).toHaveLength(2)
		expect(files[0].packageName).toBe("neo.colors")
		expect(files.map(f => f.fileName)).toContain("getting-started.md")
		expect(files.map(f => f.fileName)).toContain("api-reference.md")
	})

	it("collects top-level skill files", () => {
		const skillsDir = join(tmpDir, ".lpm", "skills")
		mkdirSync(skillsDir, { recursive: true })
		writeFileSync(join(skillsDir, "general.md"), "# General")

		const files = collectSkillFiles(tmpDir)

		expect(files).toHaveLength(1)
		expect(files[0].packageName).toBeNull()
		expect(files[0].fileName).toBe("general.md")
	})

	it("ignores non-.md files", () => {
		const pkgDir = join(tmpDir, ".lpm", "skills", "neo.colors")
		mkdirSync(pkgDir, { recursive: true })
		writeFileSync(join(pkgDir, "skill.md"), "# Skill")
		writeFileSync(join(pkgDir, "config.json"), "{}")
		writeFileSync(join(pkgDir, "readme.txt"), "text")

		const files = collectSkillFiles(tmpDir)

		expect(files).toHaveLength(1)
		expect(files[0].fileName).toBe("skill.md")
	})
})

// ---------------------------------------------------------------------------
// symlinkForCursor
// ---------------------------------------------------------------------------

describe("symlinkForCursor", () => {
	it("creates symlinks in .cursor/rules/ for skill files", () => {
		// Set up skills
		const pkgDir = join(tmpDir, ".lpm", "skills", "neo.colors")
		mkdirSync(pkgDir, { recursive: true })
		writeFileSync(join(pkgDir, "getting-started.md"), "# Getting Started")

		// Set up Cursor rules dir
		const rulesDir = join(tmpDir, ".cursor", "rules")
		mkdirSync(rulesDir, { recursive: true })

		const { created, skipped } = symlinkForCursor(tmpDir)

		expect(created).toHaveLength(1)
		expect(created[0]).toBe("neo.colors-getting-started.md")
		expect(skipped).toHaveLength(0)

		// Verify the symlink exists and points to the right place
		const linkPath = join(rulesDir, "neo.colors-getting-started.md")
		expect(existsSync(linkPath)).toBe(true)
		const stat = lstatSync(linkPath)
		expect(stat.isSymbolicLink()).toBe(true)

		// Verify content is accessible through the symlink
		const content = readFileSync(linkPath, "utf-8")
		expect(content).toBe("# Getting Started")
	})

	it("skips files that already exist in .cursor/rules/", () => {
		const pkgDir = join(tmpDir, ".lpm", "skills", "neo.colors")
		mkdirSync(pkgDir, { recursive: true })
		writeFileSync(join(pkgDir, "existing.md"), "# Skill")

		const rulesDir = join(tmpDir, ".cursor", "rules")
		mkdirSync(rulesDir, { recursive: true })
		writeFileSync(join(rulesDir, "neo.colors-existing.md"), "# Already here")

		const { created, skipped } = symlinkForCursor(tmpDir)

		expect(created).toHaveLength(0)
		expect(skipped).toHaveLength(1)
		expect(skipped[0]).toBe("neo.colors-existing.md")
	})

	it("handles multiple packages", () => {
		// Package 1
		const pkg1Dir = join(tmpDir, ".lpm", "skills", "neo.colors")
		mkdirSync(pkg1Dir, { recursive: true })
		writeFileSync(join(pkg1Dir, "usage.md"), "# Usage")

		// Package 2
		const pkg2Dir = join(tmpDir, ".lpm", "skills", "neo.validate")
		mkdirSync(pkg2Dir, { recursive: true })
		writeFileSync(join(pkg2Dir, "patterns.md"), "# Patterns")

		const rulesDir = join(tmpDir, ".cursor", "rules")
		mkdirSync(rulesDir, { recursive: true })

		const { created } = symlinkForCursor(tmpDir)

		expect(created).toHaveLength(2)
		expect(created).toContain("neo.colors-usage.md")
		expect(created).toContain("neo.validate-patterns.md")
	})

	it("returns empty results when no skills exist", () => {
		const rulesDir = join(tmpDir, ".cursor", "rules")
		mkdirSync(rulesDir, { recursive: true })

		const { created, skipped } = symlinkForCursor(tmpDir)

		expect(created).toHaveLength(0)
		expect(skipped).toHaveLength(0)
	})
})

// ---------------------------------------------------------------------------
// autoIntegrateSkills
// ---------------------------------------------------------------------------

describe("autoIntegrateSkills", () => {
	it("prints hint when no editors detected (does not create files)", () => {
		const pkgDir = join(tmpDir, ".lpm", "skills", "neo.colors")
		mkdirSync(pkgDir, { recursive: true })
		writeFileSync(join(pkgDir, "usage.md"), "# Usage")

		const result = autoIntegrateSkills({ projectRoot: tmpDir, json: true })

		expect(result.fallback).toBe(true)
		expect(result.configured).toHaveLength(0)
		expect(existsSync(join(tmpDir, "CLAUDE.md"))).toBe(false)
	})

	it("appends to existing CLAUDE.md", () => {
		writeFileSync(join(tmpDir, "CLAUDE.md"), "# My Project\n\nSome guidelines.")

		const result = autoIntegrateSkills({ projectRoot: tmpDir, json: true })

		expect(result.fallback).toBe(false)
		expect(result.configured).toHaveLength(1)
		expect(result.configured[0].id).toBe("claude-code")
		expect(result.configured[0].action).toBe("appended")

		const content = readFileSync(join(tmpDir, "CLAUDE.md"), "utf-8")
		expect(content).toContain("My Project")
		expect(content).toContain(".lpm/skills/")
	})

	it("does not duplicate when CLAUDE.md already has reference", () => {
		writeFileSync(
			join(tmpDir, "CLAUDE.md"),
			"# My Project\n\nSee .lpm/skills/ for info.",
		)

		const result = autoIntegrateSkills({ projectRoot: tmpDir, json: true })

		expect(result.configured).toHaveLength(0)
	})

	it("symlinks for Cursor when .cursor/rules/ exists", () => {
		mkdirSync(join(tmpDir, ".cursor", "rules"), { recursive: true })
		const pkgDir = join(tmpDir, ".lpm", "skills", "neo.colors")
		mkdirSync(pkgDir, { recursive: true })
		writeFileSync(join(pkgDir, "usage.md"), "# Usage")

		const result = autoIntegrateSkills({ projectRoot: tmpDir, json: true })

		expect(result.configured.some(c => c.id === "cursor")).toBe(true)
		const cursorConfig = result.configured.find(c => c.id === "cursor")
		expect(cursorConfig.action).toBe("symlinked")
		expect(cursorConfig.files).toContain("neo.colors-usage.md")
	})

	it("handles multiple editors at once", () => {
		// CLAUDE.md
		writeFileSync(join(tmpDir, "CLAUDE.md"), "# Guidelines")
		// .cursorrules
		writeFileSync(join(tmpDir, ".cursorrules"), "# Cursor rules")
		// .windsurfrules
		writeFileSync(join(tmpDir, ".windsurfrules"), "# Windsurf rules")

		const result = autoIntegrateSkills({ projectRoot: tmpDir, json: true })

		expect(result.configured).toHaveLength(3)
		const ids = result.configured.map(c => c.id)
		expect(ids).toContain("claude-code")
		expect(ids).toContain("cursor-legacy")
		expect(ids).toContain("windsurf")
	})

	it("appends to GitHub Copilot instructions", () => {
		mkdirSync(join(tmpDir, ".github"), { recursive: true })
		writeFileSync(
			join(tmpDir, ".github", "copilot-instructions.md"),
			"# Copilot Instructions",
		)

		const result = autoIntegrateSkills({ projectRoot: tmpDir, json: true })

		expect(result.configured).toHaveLength(1)
		expect(result.configured[0].id).toBe("github-copilot")

		const content = readFileSync(
			join(tmpDir, ".github", "copilot-instructions.md"),
			"utf-8",
		)
		expect(content).toContain(".lpm/skills/")
	})

	it("appends to Cline rules", () => {
		writeFileSync(join(tmpDir, ".clinerules"), "# Cline rules")

		const result = autoIntegrateSkills({ projectRoot: tmpDir, json: true })

		expect(result.configured).toHaveLength(1)
		expect(result.configured[0].id).toBe("cline")

		const content = readFileSync(join(tmpDir, ".clinerules"), "utf-8")
		expect(content).toContain(".lpm/skills/")
	})

	it("appends to Augment instructions", () => {
		mkdirSync(join(tmpDir, ".augment"), { recursive: true })
		writeFileSync(
			join(tmpDir, ".augment", "instructions.md"),
			"# Augment Instructions",
		)

		const result = autoIntegrateSkills({ projectRoot: tmpDir, json: true })

		expect(result.configured).toHaveLength(1)
		expect(result.configured[0].id).toBe("augment")

		const content = readFileSync(
			join(tmpDir, ".augment", "instructions.md"),
			"utf-8",
		)
		expect(content).toContain(".lpm/skills/")
	})

	it("does not create CLAUDE.md fallback when editors are detected", () => {
		writeFileSync(join(tmpDir, ".cursorrules"), "# Cursor rules")

		autoIntegrateSkills({ projectRoot: tmpDir, json: true })

		expect(existsSync(join(tmpDir, "CLAUDE.md"))).toBe(false)
	})

	it("uses cwd when projectRoot not specified", () => {
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)
		writeFileSync(join(tmpDir, "CLAUDE.md"), "# Guidelines")

		const result = autoIntegrateSkills({ json: true })

		expect(result.configured).toHaveLength(1)
		expect(result.configured[0].id).toBe("claude-code")
	})
})
