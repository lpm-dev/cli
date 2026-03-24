/**
 * `lpm skills` - Manage Agent Skills for LPM packages.
 *
 * Subcommands:
 *   validate   - Validate .lpm/skills/ files in current directory
 *   install    - Fetch and install skills from registry
 *   list       - List available skills for installed packages
 *   clean      - Remove locally installed skills
 */

import fs from "node:fs"
import path from "node:path"
import chalk from "chalk"
import { get } from "../api.js"
import { autoIntegrateSkills } from "../editor-skills.js"
import { createSpinner, log, printHeader } from "../ui.js"

// ============================================================================
// Shared constants and utilities
// ============================================================================

const SKILLS_DIR = ".lpm/skills"
const SKILLS_PATTERN = /\.md$/

// Same limits as server-side validation
const MAX_SKILL_SIZE = 15 * 1024
const MAX_TOTAL_SIZE = 100 * 1024
const MAX_SKILLS_COUNT = 10
const MIN_CONTENT_LENGTH = 100

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/

const BLOCKED_PATTERNS = [
	{ pattern: /curl\s+.*\|\s*(ba)?sh/i, category: "shell-injection" },
	{ pattern: /wget\s+.*\|\s*(ba)?sh/i, category: "shell-injection" },
	{ pattern: /\beval\s*\(/i, category: "shell-injection" },
	{ pattern: /child_process/i, category: "shell-injection" },
	{
		pattern: /process\.env\.[A-Z_]*(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)/i,
		category: "env-exfiltration",
	},
	{
		pattern: /ignore\s+(?:all\s+)?previous\s+instructions/i,
		category: "prompt-injection",
	},
	{ pattern: /you\s+are\s+now\s+/i, category: "prompt-injection" },
	{ pattern: /\[INST\]/i, category: "prompt-injection" },
	{ pattern: /<<SYS>>/i, category: "prompt-injection" },
	{
		pattern: /forget\s+(?:all\s+)?(?:your\s+)?(?:previous\s+)?instructions/i,
		category: "prompt-injection",
	},
	{ pattern: /fs\.(unlink|rmdir|rm)Sync?\s*\(/i, category: "fs-attack" },
	{ pattern: /\brimraf\b/i, category: "fs-attack" },
	{ pattern: /rm\s+-rf\s+\//i, category: "fs-attack" },
]

/**
 * Parse simple YAML frontmatter (no external dependency).
 */
function parseSimpleYaml(yamlStr) {
	const result = {}
	const lines = yamlStr.split("\n")
	let currentKey = null
	let inArray = false

	for (const line of lines) {
		const trimmed = line.trim()
		if (!trimmed || trimmed.startsWith("#")) continue

		if (inArray && trimmed.startsWith("- ")) {
			const value = trimmed
				.slice(2)
				.trim()
				.replace(/^["']|["']$/g, "")
			if (currentKey && Array.isArray(result[currentKey])) {
				result[currentKey].push(value)
			}
			continue
		}

		const colonIndex = trimmed.indexOf(":")
		if (colonIndex > 0) {
			const key = trimmed.slice(0, colonIndex).trim()
			const value = trimmed.slice(colonIndex + 1).trim()

			currentKey = key
			inArray = false

			if (!value) {
				result[key] = []
				inArray = true
			} else if (value.startsWith("[") && value.endsWith("]")) {
				result[key] = value
					.slice(1, -1)
					.split(",")
					.map(s => s.trim().replace(/^["']|["']$/g, ""))
					.filter(Boolean)
			} else {
				result[key] = value.replace(/^["']|["']$/g, "")
				inArray = false
			}
		}
	}

	return result
}

/**
 * Parse a skill file into structured data.
 */
function parseSkill(rawContent, filePath) {
	const sizeBytes = Buffer.byteLength(rawContent, "utf-8")

	const match = rawContent.match(FRONTMATTER_REGEX)
	if (!match) {
		return {
			skill: null,
			error: `${filePath}: Missing or invalid YAML frontmatter (must start with --- and end with ---)`,
		}
	}

	const [, yamlStr, markdownBody] = match

	let frontmatter
	try {
		frontmatter = parseSimpleYaml(yamlStr)
	} catch {
		return {
			skill: null,
			error: `${filePath}: Failed to parse YAML frontmatter`,
		}
	}

	if (!frontmatter.name || typeof frontmatter.name !== "string") {
		return {
			skill: null,
			error: `${filePath}: Missing required "name" field in frontmatter`,
		}
	}

	if (!frontmatter.description || typeof frontmatter.description !== "string") {
		return {
			skill: null,
			error: `${filePath}: Missing required "description" field in frontmatter`,
		}
	}

	if (!NAME_PATTERN.test(frontmatter.name)) {
		return {
			skill: null,
			error: `${filePath}: Skill name "${frontmatter.name}" must be lowercase letters, numbers, and hyphens only`,
		}
	}

	const globs = frontmatter.globs
	if (globs && !Array.isArray(globs)) {
		return {
			skill: null,
			error: `${filePath}: "globs" field must be an array of strings`,
		}
	}

	// Optional version field (package version when skill was authored)
	const version = frontmatter.version
	if (version && typeof version !== "string") {
		return {
			skill: null,
			error: `${filePath}: "version" field must be a string`,
		}
	}

	const content = markdownBody.trim()

	return {
		skill: {
			name: frontmatter.name,
			description: frontmatter.description,
			globs: globs && globs.length > 0 ? globs : null,
			version: version || null,
			content,
			rawContent,
			sizeBytes,
		},
		error: null,
	}
}

/**
 * Validate a parsed skill against size and security constraints.
 */
function validateSkill(skill, filePath) {
	const errors = []

	if (skill.sizeBytes > MAX_SKILL_SIZE) {
		errors.push(
			`${filePath}: File size ${(skill.sizeBytes / 1024).toFixed(1)}KB exceeds maximum ${MAX_SKILL_SIZE / 1024}KB`,
		)
	}

	if (skill.content.length < MIN_CONTENT_LENGTH) {
		errors.push(
			`${filePath}: Content is too short (${skill.content.length} chars, minimum ${MIN_CONTENT_LENGTH})`,
		)
	}

	if (skill.description.length < 10) {
		errors.push(`${filePath}: Description is too short (minimum 10 characters)`)
	}

	if (skill.description.length > 500) {
		errors.push(`${filePath}: Description is too long (maximum 500 characters)`)
	}

	for (const { pattern, category } of BLOCKED_PATTERNS) {
		if (pattern.test(skill.rawContent)) {
			errors.push(
				`${filePath}: Blocked pattern detected (${category}): ${pattern.source}`,
			)
		}
	}

	return { valid: errors.length === 0, errors }
}

/**
 * Validate a batch of skills (count, total size, duplicates).
 */
function validateBatch(skills) {
	const errors = []

	if (skills.length > MAX_SKILLS_COUNT) {
		errors.push(
			`Too many skills (${skills.length}), maximum is ${MAX_SKILLS_COUNT}`,
		)
	}

	const totalSize = skills.reduce((sum, s) => sum + s.sizeBytes, 0)
	if (totalSize > MAX_TOTAL_SIZE) {
		errors.push(
			`Total skills size ${(totalSize / 1024).toFixed(1)}KB exceeds maximum ${MAX_TOTAL_SIZE / 1024}KB`,
		)
	}

	const names = new Set()
	for (const skill of skills) {
		if (names.has(skill.name)) {
			errors.push(`Duplicate skill name: "${skill.name}"`)
		}
		names.add(skill.name)
	}

	return { valid: errors.length === 0, errors }
}

/**
 * Read and find all .md files in the .lpm/skills/ directory.
 */
function findSkillFiles(baseDir) {
	const skillsDir = path.join(baseDir, SKILLS_DIR)
	if (!fs.existsSync(skillsDir)) {
		return { dir: skillsDir, files: [] }
	}

	const entries = fs.readdirSync(skillsDir)
	const files = entries
		.filter(f => SKILLS_PATTERN.test(f))
		.map(f => path.join(skillsDir, f))

	return { dir: skillsDir, files }
}

/**
 * Ensure ".lpm" is in package.json "files" array.
 * Returns "added" if it was added, "already-present" if it was already there,
 * "missing-files-field" if there's no "files" field (npm includes everything).
 */
function ensureLpmInFiles() {
	const packageJsonPath = path.resolve(process.cwd(), "package.json")
	if (!fs.existsSync(packageJsonPath)) return "missing-files-field"

	const raw = fs.readFileSync(packageJsonPath, "utf-8")
	let pkg
	try {
		pkg = JSON.parse(raw)
	} catch {
		return "missing-files-field"
	}

	// No "files" field means npm includes everything by default
	if (!Array.isArray(pkg.files)) return "missing-files-field"

	// Check if .lpm is already included (exact or glob)
	const hasLpm = pkg.files.some(
		f => f === ".lpm" || f === ".lpm/" || f === ".lpm/**",
	)
	if (hasLpm) return "already-present"

	// Add ".lpm" to the files array
	pkg.files.push(".lpm")

	// Preserve formatting: detect indent from the original file
	const indentMatch = raw.match(/^(\s+)"/)
	const indent = indentMatch ? indentMatch[1] : "\t"
	fs.writeFileSync(
		packageJsonPath,
		`${JSON.stringify(pkg, null, indent)}\n`,
		"utf-8",
	)

	return "added"
}

/**
 * Read LPM packages from the nearest package.json.
 */
function getLpmDependencies() {
	const packageJsonPath = path.resolve(process.cwd(), "package.json")
	if (!fs.existsSync(packageJsonPath)) return []

	const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"))
	const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }

	return Object.entries(allDeps)
		.filter(([name, version]) => {
			if (!name.startsWith("@lpm.dev/")) return false
			// Skip local file/link references — they have their own .lpm/skills/
			if (
				version.startsWith("file:") ||
				version.startsWith("link:") ||
				version.startsWith("workspace:")
			) {
				return false
			}
			return true
		})
		.map(([name, version]) => ({
			fullName: name,
			shortName: name.replace("@lpm.dev/", ""),
			version: version.replace(/^[\^~>=<]+/, ""),
		}))
}

/**
 * Parse a package name input (accepts "owner.pkg" or "@lpm.dev/owner.pkg").
 */
function parsePkgName(input) {
	let cleaned = input
	if (cleaned.startsWith("@lpm.dev/")) {
		cleaned = cleaned.replace("@lpm.dev/", "")
	}
	const dotIndex = cleaned.indexOf(".")
	if (dotIndex === -1 || dotIndex === 0 || dotIndex === cleaned.length - 1) {
		return null
	}
	return cleaned
}

// ============================================================================
// Subcommand: validate
// ============================================================================

/**
 * lpm skills validate
 * Validates .lpm/skills/ files in the current directory.
 */
export async function skillsValidate(options = {}) {
	const isJson = options.json

	if (!isJson) printHeader()

	const { dir, files } = findSkillFiles(process.cwd())

	if (files.length === 0) {
		if (isJson) {
			console.log(
				JSON.stringify({
					valid: false,
					skills: [],
					errors: [`No skill files found in ${SKILLS_DIR}/`],
				}),
			)
		} else {
			log.warn(`No skill files found in ${SKILLS_DIR}/`)
			console.log(
				chalk.dim(
					`  Create .lpm/skills/*.md files to add Agent Skills to your package.`,
				),
			)
			console.log(chalk.dim(`  See: https://lpm.dev/docs/packages/skills`))
		}
		return
	}

	if (!isJson) {
		console.log(
			`  Validating ${files.length} skill file${files.length !== 1 ? "s" : ""} in ${dir}\n`,
		)
	}

	const parsed = []
	const allErrors = []

	for (const filePath of files) {
		const rawContent = fs.readFileSync(filePath, "utf-8")
		const relativePath = path.relative(process.cwd(), filePath)
		const { skill, error } = parseSkill(rawContent, relativePath)

		if (error) {
			allErrors.push(error)
			if (!isJson) {
				console.log(`  ${chalk.red("✗")} ${relativePath}`)
				console.log(`    ${chalk.red(error)}`)
			}
			continue
		}

		const validation = validateSkill(skill, relativePath)
		if (!validation.valid) {
			allErrors.push(...validation.errors)
			if (!isJson) {
				console.log(`  ${chalk.red("✗")} ${relativePath}`)
				for (const err of validation.errors) {
					console.log(`    ${chalk.red(err)}`)
				}
			}
		} else {
			parsed.push(skill)
			if (!isJson) {
				const globInfo = skill.globs
					? chalk.dim(
							` (${skill.globs.length} glob${skill.globs.length !== 1 ? "s" : ""})`,
						)
					: ""
				console.log(`  ${chalk.green("✓")} ${relativePath}${globInfo}`)
				console.log(`    ${chalk.dim(skill.description)}`)
			}
		}
	}

	// Batch validation
	if (parsed.length > 0) {
		const batchResult = validateBatch(parsed)
		if (!batchResult.valid) {
			allErrors.push(...batchResult.errors)
			if (!isJson) {
				console.log("")
				for (const err of batchResult.errors) {
					console.log(`  ${chalk.red("✗")} ${err}`)
				}
			}
		}
	}

	const isValid = allErrors.length === 0 && parsed.length > 0

	if (isJson) {
		console.log(
			JSON.stringify(
				{
					valid: isValid,
					skills: parsed.map(s => ({
						name: s.name,
						description: s.description,
						globs: s.globs,
						sizeBytes: s.sizeBytes,
					})),
					errors: allErrors,
				},
				null,
				2,
			),
		)
		return
	}

	console.log("")
	if (isValid) {
		const totalSize = parsed.reduce((sum, s) => sum + s.sizeBytes, 0)
		log.success(
			`${parsed.length} skill${parsed.length !== 1 ? "s" : ""} valid (${(totalSize / 1024).toFixed(1)}KB total)`,
		)
		console.log(
			chalk.dim(
				`  Quality impact: +7 pts (has-skills)${parsed.length >= 3 ? " +3 pts (comprehensive)" : ""}`,
			),
		)

		// Check if .lpm is in package.json files field
		const fixed = ensureLpmInFiles()
		if (fixed === "added") {
			console.log("")
			log.success(
				`Added ".lpm" to package.json "files" field so skills are included in the tarball.`,
			)
		} else if (fixed === "missing-files-field") {
			// No "files" field means npm includes everything - skills are included
		} else if (fixed === "already-present") {
			// Already configured correctly
		}
	} else {
		log.error(
			`Validation failed with ${allErrors.length} error${allErrors.length !== 1 ? "s" : ""}.`,
		)
	}
	console.log("")
}

// ============================================================================
// Subcommand: install
// ============================================================================

/**
 * lpm skills install [package]
 * Fetches and installs skills from the registry.
 */
export async function skillsInstall(packageInput, options = {}) {
	const isJson = options.json

	if (!isJson) printHeader()

	let packages = []

	if (packageInput) {
		const cleaned = parsePkgName(packageInput)
		if (!cleaned) {
			if (isJson) {
				console.log(
					JSON.stringify({
						error: "Invalid package name format. Use: owner.package-name",
					}),
				)
			} else {
				log.error("Invalid package name format. Use: owner.package-name")
			}
			process.exit(1)
		}
		packages = [{ shortName: cleaned, fullName: `@lpm.dev/${cleaned}` }]
	} else {
		// Read from package.json
		packages = getLpmDependencies()
		if (packages.length === 0) {
			if (isJson) {
				console.log(
					JSON.stringify({
						installed: 0,
						packages: [],
						errors: ["No @lpm.dev/* packages found in package.json."],
					}),
				)
			} else {
				log.info("No @lpm.dev/* packages found in package.json.")
			}
			return
		}
	}

	const spinner = isJson
		? null
		: createSpinner(
				`Fetching skills for ${packages.length} package${packages.length !== 1 ? "s" : ""}...`,
			).start()

	const results = []
	const errors = []

	for (const pkg of packages) {
		try {
			const response = await get(
				`/skills?name=${encodeURIComponent(pkg.shortName)}${pkg.version ? `&version=${encodeURIComponent(pkg.version)}` : ""}`,
			)

			if (!response.ok) {
				if (response.status === 404) {
					results.push({ name: pkg.fullName, skills: [], status: "not-found" })
					continue
				}
				const data = await response.json().catch(() => ({}))
				errors.push(
					`${pkg.fullName}: ${data.error || `HTTP ${response.status}`}`,
				)
				continue
			}

			const data = await response.json()

			if (!data.skills || data.skills.length === 0) {
				results.push({ name: pkg.fullName, skills: [], status: "no-skills" })
				continue
			}

			// Write skills to .lpm/skills/{owner}.{package-name}/
			const targetDir = path.join(process.cwd(), SKILLS_DIR, pkg.shortName)
			fs.mkdirSync(targetDir, { recursive: true })

			for (const skill of data.skills) {
				const fileName = `${skill.name}.md`
				const content = skill.rawContent || skill.content
				fs.writeFileSync(path.join(targetDir, fileName), content, "utf-8")
			}

			results.push({
				name: pkg.fullName,
				skills: data.skills.map(s => s.name),
				status: "installed",
				path: targetDir,
			})
		} catch (err) {
			errors.push(`${pkg.fullName}: ${err.message}`)
		}
	}

	// Ensure .lpm/skills/ is in .gitignore
	ensureGitignore()

	if (spinner) spinner.stop()

	if (isJson) {
		const hasInstalled = results.some(r => r.status === "installed")
		let editorSetup = null
		if (hasInstalled && options.editorSetup !== false) {
			const result = autoIntegrateSkills({ json: true })
			editorSetup = result
		}
		console.log(
			JSON.stringify(
				{
					installed: results.filter(r => r.status === "installed").length,
					packages: results,
					errors,
					...(editorSetup ? { editorSetup } : {}),
				},
				null,
				2,
			),
		)
		return
	}

	// Print results
	const installed = results.filter(r => r.status === "installed")
	const noSkills = results.filter(
		r => r.status === "no-skills" || r.status === "not-found",
	)

	if (installed.length > 0) {
		console.log("")
		for (const r of installed) {
			log.success(
				`${r.name}: ${r.skills.length} skill${r.skills.length !== 1 ? "s" : ""} installed`,
			)
			for (const name of r.skills) {
				console.log(chalk.dim(`    ${name}.md`))
			}
		}
	}

	if (noSkills.length > 0) {
		console.log("")
		for (const r of noSkills) {
			log.dim(`  ${r.name}: no skills available`)
		}
	}

	if (errors.length > 0) {
		console.log("")
		for (const err of errors) {
			log.error(err)
		}
	}

	if (installed.length > 0) {
		console.log("")
		console.log(chalk.dim(`  Skills saved to ${SKILLS_DIR}/`))

		// Auto-integrate with detected AI editors (unless --no-editor-setup)
		if (options.editorSetup !== false) {
			autoIntegrateSkills({ json: false })
		} else {
			printWiringInstructions()
		}
	}

	console.log("")
}

/**
 * Print instructions for wiring skills into AI tools.
 */
function printWiringInstructions() {
	const skillsPath = path.join(process.cwd(), SKILLS_DIR)
	if (!fs.existsSync(skillsPath)) return

	console.log("")
	console.log(chalk.dim("  To use these skills with your AI coding tool:"))
	console.log("")
	console.log(chalk.dim("  Claude Code:"))
	console.log(
		chalk.dim(
			`    Add to CLAUDE.md: "See ${SKILLS_DIR}/ for package-specific guidelines"`,
		),
	)
	console.log("")
	console.log(chalk.dim("  Cursor:"))
	console.log(
		chalk.dim(`    Copy files to .cursor/rules/ or reference in .cursorrules`),
	)
}

/**
 * Ensure .lpm/skills/ is listed in .gitignore.
 */
function ensureGitignore() {
	const gitignorePath = path.join(process.cwd(), ".gitignore")

	if (!fs.existsSync(gitignorePath)) return

	const content = fs.readFileSync(gitignorePath, "utf-8")
	if (content.includes(".lpm/skills")) return

	fs.appendFileSync(
		gitignorePath,
		"\n# LPM Agent Skills (fetched from registry)\n.lpm/skills/\n",
	)
}

// ============================================================================
// Subcommand: list
// ============================================================================

/**
 * lpm skills list
 * Lists available skills for installed @lpm.dev/* packages.
 */
export async function skillsList(options = {}) {
	const isJson = options.json

	if (!isJson) printHeader()

	const packages = getLpmDependencies()

	if (packages.length === 0) {
		if (isJson) {
			console.log(JSON.stringify({ packages: [] }))
		} else {
			log.info("No @lpm.dev/* packages found in package.json.")
		}
		return
	}

	const spinner = isJson
		? null
		: createSpinner(
				`Checking skills for ${packages.length} package${packages.length !== 1 ? "s" : ""}...`,
			).start()

	const results = []

	for (const pkg of packages) {
		try {
			const response = await get(
				`/skills?name=${encodeURIComponent(pkg.shortName)}${pkg.version ? `&version=${encodeURIComponent(pkg.version)}` : ""}`,
			)

			if (!response.ok) {
				results.push({
					name: pkg.fullName,
					version: pkg.version,
					skillsCount: 0,
					installed: false,
				})
				continue
			}

			const data = await response.json()

			// Check if installed locally
			const localDir = path.join(process.cwd(), SKILLS_DIR, pkg.shortName)
			const installed = fs.existsSync(localDir)

			results.push({
				name: pkg.fullName,
				version: data.version || pkg.version,
				skillsCount: data.skillsCount || 0,
				skills: (data.skills || []).map(s => s.name),
				installed,
			})
		} catch {
			results.push({
				name: pkg.fullName,
				version: pkg.version,
				skillsCount: 0,
				installed: false,
			})
		}
	}

	if (spinner) spinner.stop()

	if (isJson) {
		console.log(JSON.stringify({ packages: results }, null, 2))
		return
	}

	console.log("")

	const withSkills = results.filter(r => r.skillsCount > 0)
	const withoutSkills = results.filter(r => r.skillsCount === 0)

	if (withSkills.length > 0) {
		console.log(chalk.bold("  Packages with Agent Skills:\n"))
		for (const r of withSkills) {
			const installedBadge = r.installed
				? chalk.green(" [installed]")
				: chalk.dim(" [not installed]")
			console.log(
				`  ${r.name}@${r.version}  ${chalk.cyan(`${r.skillsCount} skill${r.skillsCount !== 1 ? "s" : ""}`)}${installedBadge}`,
			)
		}
	}

	if (withoutSkills.length > 0) {
		if (withSkills.length > 0) console.log("")
		console.log(chalk.dim("  No skills available:"))
		for (const r of withoutSkills) {
			console.log(chalk.dim(`    ${r.name}@${r.version}`))
		}
	}

	if (withSkills.length > 0) {
		const notInstalled = withSkills.filter(r => !r.installed)
		if (notInstalled.length > 0) {
			console.log("")
			console.log(
				chalk.dim(
					`  Run ${chalk.cyan("lpm skills install")} to download all available skills.`,
				),
			)
		}
	}

	console.log("")
}

// ============================================================================
// Subcommand: clean
// ============================================================================

/**
 * lpm skills clean
 * Removes locally installed skills (.lpm/skills/ directory).
 */
export async function skillsClean(options = {}) {
	const isJson = options.json

	if (!isJson) printHeader()

	const skillsPath = path.join(process.cwd(), SKILLS_DIR)

	if (!fs.existsSync(skillsPath)) {
		if (isJson) {
			console.log(
				JSON.stringify({
					cleaned: false,
					message: "No .lpm/skills/ directory found.",
				}),
			)
		} else {
			log.info("No .lpm/skills/ directory found. Nothing to clean.")
		}
		return
	}

	// Count files before removing
	let fileCount = 0
	const countFiles = dir => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			if (entry.isDirectory()) {
				countFiles(path.join(dir, entry.name))
			} else {
				fileCount++
			}
		}
	}
	countFiles(skillsPath)

	fs.rmSync(skillsPath, { recursive: true, force: true })

	if (isJson) {
		console.log(JSON.stringify({ cleaned: true, filesRemoved: fileCount }))
	} else {
		log.success(
			`Removed ${SKILLS_DIR}/ (${fileCount} file${fileCount !== 1 ? "s" : ""})`,
		)
		console.log("")
	}
}
