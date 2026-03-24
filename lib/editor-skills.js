/**
 * Auto-integrate Agent Skills with AI editor config files.
 *
 * After `lpm skills install` writes skill files to `.lpm/skills/`,
 * this module detects which AI editors are configured in the project
 * and wires the skills in automatically (append reference, symlink, etc.).
 *
 * @module cli/lib/editor-skills
 */

import fs from "node:fs"
import path from "node:path"
import chalk from "chalk"
import { log } from "./ui.js"

// ============================================================================
// Constants
// ============================================================================

const SKILLS_DIR = ".lpm/skills"

const SKILLS_REFERENCE_LINE =
	"See .lpm/skills/ for package-specific Agent Skills and guidelines."

/** Marker comment so we can detect our own additions and avoid duplicates. */
const LPM_MARKER = "<!-- lpm:skills -->"

/**
 * The block we append to markdown/text config files.
 * Contains both a human-readable reference and a machine-detectable marker.
 */
function makeReferenceBlock() {
	return `\n\n${LPM_MARKER}\n## LPM Agent Skills\n\n${SKILLS_REFERENCE_LINE}\n`
}

// ============================================================================
// AI Editor definitions (for skills wiring — separate from MCP editors)
// ============================================================================

/**
 * @typedef {object} AIEditor
 * @property {string} id - Unique identifier
 * @property {string} name - Display name
 * @property {string} configPath - Relative path to the config file from project root
 * @property {"append" | "symlink"} action - How to integrate skills
 * @property {(projectRoot: string) => boolean} detect - Whether this editor is configured in the project
 */

/** @type {AIEditor[]} */
const AI_EDITORS = [
	{
		id: "claude-code",
		name: "Claude Code",
		configPath: "CLAUDE.md",
		action: "append",
		detect: projectRoot => fs.existsSync(path.join(projectRoot, "CLAUDE.md")),
	},
	{
		id: "cursor",
		name: "Cursor",
		configPath: ".cursor/rules/",
		action: "symlink",
		detect: projectRoot =>
			fs.existsSync(path.join(projectRoot, ".cursor", "rules")),
	},
	{
		id: "cursor-legacy",
		name: "Cursor (legacy)",
		configPath: ".cursorrules",
		action: "append",
		detect: projectRoot =>
			fs.existsSync(path.join(projectRoot, ".cursorrules")),
	},
	{
		id: "windsurf",
		name: "Windsurf",
		configPath: ".windsurfrules",
		action: "append",
		detect: projectRoot =>
			fs.existsSync(path.join(projectRoot, ".windsurfrules")),
	},
	{
		id: "github-copilot",
		name: "GitHub Copilot",
		configPath: ".github/copilot-instructions.md",
		action: "append",
		detect: projectRoot =>
			fs.existsSync(
				path.join(projectRoot, ".github", "copilot-instructions.md"),
			),
	},
	{
		id: "augment",
		name: "Augment",
		configPath: ".augment/instructions.md",
		action: "append",
		detect: projectRoot =>
			fs.existsSync(path.join(projectRoot, ".augment", "instructions.md")),
	},
	{
		id: "cline",
		name: "Cline",
		configPath: ".clinerules",
		action: "append",
		detect: projectRoot => fs.existsSync(path.join(projectRoot, ".clinerules")),
	},
]

// ============================================================================
// Core logic
// ============================================================================

/**
 * Detect which AI editors are configured in the project.
 *
 * @param {string} projectRoot
 * @returns {AIEditor[]}
 */
export function detectAIEditors(projectRoot) {
	return AI_EDITORS.filter(editor => editor.detect(projectRoot))
}

/**
 * Check if a file already references .lpm/skills/.
 *
 * @param {string} filePath
 * @returns {boolean}
 */
export function hasSkillsReference(filePath) {
	if (!fs.existsSync(filePath)) return false
	const content = fs.readFileSync(filePath, "utf-8")
	return content.includes(".lpm/skills") || content.includes(LPM_MARKER)
}

/**
 * Append a skills reference block to a markdown/text config file.
 *
 * @param {string} filePath - Absolute path to the config file
 * @returns {boolean} Whether the reference was added (false if already present)
 */
export function appendSkillsReference(filePath) {
	if (hasSkillsReference(filePath)) return false
	fs.appendFileSync(filePath, makeReferenceBlock())
	return true
}

/**
 * Create a new CLAUDE.md with skills reference (fallback when no editor detected).
 *
 * @param {string} projectRoot
 * @returns {boolean} Whether the file was created
 */
export function createClaudeMdWithReference(projectRoot) {
	const claudeMdPath = path.join(projectRoot, "CLAUDE.md")
	if (fs.existsSync(claudeMdPath)) return false

	const content = `# Project Guidelines\n\n${LPM_MARKER}\n## LPM Agent Skills\n\n${SKILLS_REFERENCE_LINE}\n`
	fs.writeFileSync(claudeMdPath, content, "utf-8")
	return true
}

/**
 * Collect all .md skill files from .lpm/skills/ (recursively through package subdirs).
 *
 * @param {string} projectRoot
 * @returns {{ packageName: string, fileName: string, filePath: string }[]}
 */
export function collectSkillFiles(projectRoot) {
	const skillsDir = path.join(projectRoot, SKILLS_DIR)
	if (!fs.existsSync(skillsDir)) return []

	const results = []
	const entries = fs.readdirSync(skillsDir, { withFileTypes: true })

	for (const entry of entries) {
		if (entry.isDirectory()) {
			// Package subdirectory (e.g., "neo.colors")
			const pkgDir = path.join(skillsDir, entry.name)
			const files = fs.readdirSync(pkgDir).filter(f => f.endsWith(".md"))
			for (const file of files) {
				results.push({
					packageName: entry.name,
					fileName: file,
					filePath: path.join(pkgDir, file),
				})
			}
		} else if (entry.name.endsWith(".md")) {
			// Top-level skill file
			results.push({
				packageName: null,
				fileName: entry.name,
				filePath: path.join(skillsDir, entry.name),
			})
		}
	}

	return results
}

/**
 * Create symlinks for Cursor's .cursor/rules/ directory.
 * Uses relative symlinks so they work across machines.
 *
 * @param {string} projectRoot
 * @returns {{ created: string[], skipped: string[] }}
 */
export function symlinkForCursor(projectRoot) {
	const rulesDir = path.join(projectRoot, ".cursor", "rules")
	const skillFiles = collectSkillFiles(projectRoot)

	const created = []
	const skipped = []

	for (const { packageName, fileName, filePath } of skillFiles) {
		// Build symlink name: "neo.colors-getting-started.md"
		const linkName = packageName
			? `${packageName}-${fileName}`
			: `lpm-${fileName}`

		const linkPath = path.join(rulesDir, linkName)

		if (fs.existsSync(linkPath)) {
			skipped.push(linkName)
			continue
		}

		// Compute relative path from .cursor/rules/ to the skill file
		const relativePath = path.relative(rulesDir, filePath)

		try {
			fs.symlinkSync(relativePath, linkPath)
			created.push(linkName)
		} catch {
			// Fallback: copy if symlink fails (e.g., Windows without developer mode)
			try {
				fs.copyFileSync(filePath, linkPath)
				created.push(linkName)
			} catch {
				skipped.push(linkName)
			}
		}
	}

	return { created, skipped }
}

// ============================================================================
// Main entry point
// ============================================================================

/**
 * Auto-integrate installed skills with detected AI editors.
 *
 * @param {object} options
 * @param {string} [options.projectRoot] - Project root (defaults to cwd)
 * @param {boolean} [options.json] - Output JSON instead of human-readable
 * @param {string[]} [options.installedPackages] - Names of packages that had skills installed
 * @returns {{ configured: { id: string, name: string, configPath: string }[], fallback: boolean }}
 */
export function autoIntegrateSkills(options = {}) {
	const projectRoot = options.projectRoot || process.cwd()
	const isJson = options.json
	const configured = []
	let fallback = false

	const detectedEditors = detectAIEditors(projectRoot)

	if (detectedEditors.length === 0) {
		// No editor detected — print a helpful hint, don't auto-create files
		fallback = true
		if (!isJson) {
			console.log("")
			log.info(
				"To use these skills with your AI coding tool, point your agent to the .lpm/skills/ folder.",
			)
		}
	} else {
		for (const editor of detectedEditors) {
			if (editor.action === "symlink" && editor.id === "cursor") {
				const { created } = symlinkForCursor(projectRoot)
				if (created.length > 0) {
					configured.push({
						id: editor.id,
						name: editor.name,
						configPath: editor.configPath,
						action: "symlinked",
						files: created,
					})
				}
			} else if (editor.action === "append") {
				const filePath = path.join(projectRoot, editor.configPath)
				const added = appendSkillsReference(filePath)
				if (added) {
					configured.push({
						id: editor.id,
						name: editor.name,
						configPath: editor.configPath,
						action: "appended",
					})
				}
			}
		}
	}

	// Output
	if (!isJson && configured.length > 0) {
		console.log("")
		console.log(chalk.dim("  Auto-configured for:"))
		for (const c of configured) {
			if (c.action === "symlinked") {
				log.success(
					`${c.name} (${c.configPath}) — ${c.files.length} file${c.files.length !== 1 ? "s" : ""} linked`,
				)
			} else {
				log.success(`${c.name} (${c.configPath})`)
			}
		}
	}

	return { configured, fallback }
}
