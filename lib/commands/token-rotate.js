import { request } from "../api.js"
import { setToken } from "../config.js"
import { createSpinner, printHeader } from "../ui.js"

export async function rotateToken() {
	printHeader()
	const spinner = createSpinner("Rotating token...").start()
	try {
		const response = await request("/-/token/rotate", {
			method: "POST",
		})

		if (!response.ok) {
			throw new Error(`Request failed with status ${response.status}`)
		}

		const data = await response.json()
		const newToken = data.token

		await setToken(newToken)
		spinner.succeed("Token rotated successfully! Local config updated.")
	} catch (error) {
		spinner.fail(`Error: ${error.message}`)
	}
}
