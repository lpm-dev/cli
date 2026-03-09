import { spawn } from "node:child_process"
import { log } from "../ui.js"

export async function run(script, _options, command) {
	const args = ["run", script, ...command.args]

	const child = spawn("npm", args, { stdio: "inherit" })

	child.on("close", code => process.exit(code))
	child.on("error", err => {
		log.error(`Failed to start npm: ${err.message}`)
		process.exit(1)
	})
}
