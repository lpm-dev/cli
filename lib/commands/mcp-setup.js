import { spawnSync } from 'node:child_process'
import path from 'node:path'
import * as p from '@clack/prompts'
import chalk from 'chalk'
import { getToken } from '../config.js'
import {
	EDITORS,
	addMcpServer,
	removeMcpServerEntry,
	hasMcpServer,
	shortPath,
} from '../editors.js'

const SERVER_NAME = 'lpm-registry'
const SERVER_CONFIG = {
	command: 'npx',
	args: ['@lpm-registry/mcp-server'],
}

// ============================================================================
// Setup command
// ============================================================================

export async function mcpSetup(options = {}) {
	p.intro(chalk.bgCyan(chalk.black(' lpm mcp setup ')))

	// Check authentication and offer login
	let token = await getToken()
	if (!token) {
		const shouldLogin = await p.confirm({
			message:
				'Not logged in. Login now for full MCP functionality? (recommended)',
			initialValue: true,
		})

		if (p.isCancel(shouldLogin)) {
			p.cancel('Setup cancelled.')
			process.exit(0)
		}

		if (shouldLogin) {
			p.log.info('Opening browser for login...\n')
			const result = spawnSync('lpm', ['login'], {
				stdio: 'inherit',
			})

			if (result.status === 0) {
				token = await getToken()
			} else {
				p.log.warn(
					'Login did not complete. Continuing without authentication.',
				)
			}
		}
	}

	const isProject = !!options.project

	// Detect installed editors
	const detected = EDITORS.filter((e) => e.detect())

	if (detected.length === 0) {
		p.log.warn('No supported editors detected on this machine.')
		p.note(
			'Supported: Claude Code, Cursor, VS Code, Claude Desktop, Windsurf',
			'Supported editors',
		)
		p.outro('Install a supported editor and try again.')
		return
	}

	// Filter to editors that support project config when --project is used
	const eligible = isProject
		? detected.filter((e) => e.projectPath)
		: detected

	if (eligible.length === 0) {
		p.log.warn('No detected editors support project-level MCP config.')
		p.outro(
			`Try ${chalk.cyan('lpm mcp setup')} without --project for global setup.`,
		)
		return
	}

	// Build multiselect options
	const selectOptions = eligible.map((editor) => {
		const configPath =
			isProject && editor.projectPath
				? path.resolve(process.cwd(), editor.projectPath)
				: editor.globalPath

		const installed = hasMcpServer(configPath, editor.serverKey, SERVER_NAME)

		return {
			value: editor.id,
			label: installed
				? `${editor.name} ${chalk.dim('(already configured)')}`
				: editor.name,
			hint: shortPath(configPath),
		}
	})

	const selected = await p.multiselect({
		message: isProject
			? 'Add LPM MCP server to (project-level):'
			: 'Add LPM MCP server to:',
		options: selectOptions,
		initialValues: selectOptions.map((o) => o.value),
		required: true,
	})

	if (p.isCancel(selected)) {
		p.cancel('Setup cancelled.')
		process.exit(0)
	}

	// Write configs
	let count = 0
	for (const editorId of selected) {
		const editor = EDITORS.find((e) => e.id === editorId)
		const configPath =
			isProject && editor.projectPath
				? path.resolve(process.cwd(), editor.projectPath)
				: editor.globalPath

		try {
			addMcpServer(configPath, editor.serverKey, SERVER_NAME, { ...SERVER_CONFIG })
			p.log.success(
				`${editor.name} ${chalk.dim(shortPath(configPath))}`,
			)
			count++
		} catch (err) {
			p.log.error(`${editor.name}: ${err.message}`)
		}
	}

	if (count > 0) {
		const authLine = token
			? `Auth: Using keychain token from ${chalk.cyan('lpm login')}`
			: `Auth: Run ${chalk.cyan('lpm login')} to enable authenticated tools`

		p.note(authLine, `Added to ${count} editor${count > 1 ? 's' : ''}`)
	}

	p.outro('Restart your editors to activate the MCP server.')
}

// ============================================================================
// Remove command
// ============================================================================

export async function mcpRemove(options = {}) {
	p.intro(chalk.bgCyan(chalk.black(' lpm mcp remove ')))

	const isProject = !!options.project
	let count = 0

	for (const editor of EDITORS) {
		if (isProject && !editor.projectPath) continue

		const configPath =
			isProject && editor.projectPath
				? path.resolve(process.cwd(), editor.projectPath)
				: editor.globalPath

		if (removeMcpServerEntry(configPath, editor.serverKey, SERVER_NAME)) {
			p.log.success(
				`Removed from ${editor.name} ${chalk.dim(shortPath(configPath))}`,
			)
			count++
		}
	}

	if (count === 0) {
		p.log.info('LPM MCP server was not configured in any editor.')
	}

	p.outro(
		count > 0
			? 'Done. Restart your editors to apply.'
			: 'Nothing to remove.',
	)
}

// ============================================================================
// Status command
// ============================================================================

export async function mcpStatus() {
	p.intro(chalk.bgCyan(chalk.black(' lpm mcp status ')))

	const token = await getToken()
	let found = 0

	for (const editor of EDITORS) {
		const globalInstalled = hasMcpServer(editor.globalPath, editor.serverKey, SERVER_NAME)

		if (globalInstalled) {
			p.log.success(
				`${editor.name} ${chalk.dim(shortPath(editor.globalPath))}`,
			)
			found++
		}
	}

	if (found === 0) {
		p.log.info('LPM MCP server is not configured in any editor.')
		p.note(
			`Run ${chalk.cyan('lpm mcp setup')} to configure it.`,
			'Get started',
		)
	}

	const authStatus = token
		? chalk.green('Authenticated')
		: chalk.yellow(`Not logged in — run ${chalk.cyan('lpm login')}`)

	p.log.info(`Auth: ${authStatus}`)

	p.outro('')
}
