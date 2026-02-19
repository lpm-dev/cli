import { describe, expect, it } from "vitest"
import {
	resolveImportToFilePath,
	rewriteImports,
} from "../import-rewriter.js"

// ============================================================================
// resolveImportToFilePath
// ============================================================================

describe("resolveImportToFilePath", () => {
	const fileSet = new Set([
		"components/dialog/Dialog.jsx",
		"components/dialog/Dialog.style.jsx",
		"components/dialog/index.js",
		"components/button/Button.jsx",
		"lib/utils.js",
		"lib/hooks/useDialog.ts",
		"styles/global.css",
	])

	it("resolves relative import to sibling file", () => {
		const result = resolveImportToFilePath(
			"./Dialog.style",
			"components/dialog",
			fileSet,
		)
		expect(result).toBe("components/dialog/Dialog.style.jsx")
	})

	it("resolves relative import with ../ to another directory", () => {
		const result = resolveImportToFilePath(
			"../button/Button",
			"components/dialog",
			fileSet,
		)
		expect(result).toBe("components/button/Button.jsx")
	})

	it("resolves relative import to directory index", () => {
		const result = resolveImportToFilePath(
			"./dialog",
			"components",
			fileSet,
		)
		expect(result).toBe("components/dialog/index.js")
	})

	it("resolves relative import with exact path including extension", () => {
		const result = resolveImportToFilePath(
			"./Dialog.jsx",
			"components/dialog",
			fileSet,
		)
		expect(result).toBe("components/dialog/Dialog.jsx")
	})

	it("resolves .ts extension", () => {
		const result = resolveImportToFilePath(
			"../../lib/hooks/useDialog",
			"components/dialog",
			fileSet,
		)
		expect(result).toBe("lib/hooks/useDialog.ts")
	})

	it("resolves author alias import", () => {
		const result = resolveImportToFilePath(
			"@/lib/utils",
			"components/dialog",
			fileSet,
			"@/",
		)
		expect(result).toBe("lib/utils.js")
	})

	it("resolves author alias import to directory index", () => {
		const result = resolveImportToFilePath(
			"@/components/dialog",
			"lib",
			fileSet,
			"@/",
		)
		expect(result).toBe("components/dialog/index.js")
	})

	it("resolves tilde alias import", () => {
		const result = resolveImportToFilePath(
			"~/lib/utils",
			"components/dialog",
			fileSet,
			"~/",
		)
		expect(result).toBe("lib/utils.js")
	})

	it("returns null for bare specifiers (npm packages)", () => {
		expect(
			resolveImportToFilePath("react", "components/dialog", fileSet),
		).toBeNull()
		expect(
			resolveImportToFilePath("next/link", "components/dialog", fileSet),
		).toBeNull()
		expect(
			resolveImportToFilePath(
				"@radix-ui/react-dialog",
				"components/dialog",
				fileSet,
			),
		).toBeNull()
		expect(
			resolveImportToFilePath("lucide-react", "components/dialog", fileSet),
		).toBeNull()
	})

	it("returns null for unresolvable relative import", () => {
		const result = resolveImportToFilePath(
			"./NonExistent",
			"components/dialog",
			fileSet,
		)
		expect(result).toBeNull()
	})

	it("returns null for alias import not matching any file", () => {
		const result = resolveImportToFilePath(
			"@/nonexistent/file",
			"components/dialog",
			fileSet,
			"@/",
		)
		expect(result).toBeNull()
	})

	it("resolves CSS file with exact extension", () => {
		const result = resolveImportToFilePath(
			"../../styles/global.css",
			"components/dialog",
			fileSet,
		)
		expect(result).toBe("styles/global.css")
	})
})

// ============================================================================
// rewriteImports
// ============================================================================

describe("rewriteImports", () => {
	const destFileSet = new Set([
		"components/dialog/Dialog.jsx",
		"components/dialog/Dialog.style.jsx",
		"components/dialog/index.js",
		"components/button/Button.jsx",
		"lib/utils.js",
		"lib/hooks/useDialog.ts",
	])

	it("rewrites relative imports to buyer alias", () => {
		const content = [
			'import { cn } from "../../lib/utils"',
			'import { DialogStyle } from "./Dialog.style"',
		].join("\n")

		const result = rewriteImports(content, {
			fileDestPath: "components/dialog/Dialog.jsx",
			destFileSet,
			buyerAlias: "@/components/design-system",
		})

		expect(result).toContain(
			'from "@/components/design-system/lib/utils"',
		)
		expect(result).toContain(
			'from "@/components/design-system/components/dialog/Dialog.style"',
		)
	})

	it("rewrites author alias imports to buyer alias", () => {
		const content = 'import { cn } from "@/lib/utils"'
		const srcToDestMap = new Map([
			["lib/utils.js", "lib/utils.js"],
			["components/dialog/Dialog.jsx", "components/dialog/Dialog.jsx"],
		])

		const result = rewriteImports(content, {
			fileDestPath: "components/dialog/Dialog.jsx",
			fileSrcPath: "components/dialog/Dialog.jsx",
			destFileSet,
			srcToDestMap,
			authorAlias: "@/",
			buyerAlias: "~/src/ui",
		})

		expect(result).toContain('"~/src/ui/lib/utils"')
	})

	it("leaves external packages untouched", () => {
		const content = [
			'import React from "react"',
			'import Link from "next/link"',
			'import { Dialog } from "@radix-ui/react-dialog"',
		].join("\n")

		const result = rewriteImports(content, {
			fileDestPath: "components/dialog/Dialog.jsx",
			destFileSet,
			authorAlias: "@/",
			buyerAlias: "@/ui",
		})

		expect(result).toBe(content)
	})

	it("handles mixed imports (some internal, some external)", () => {
		const content = [
			'import React from "react"',
			'import { cn } from "../../lib/utils"',
			'import { Dialog } from "@radix-ui/react-dialog"',
			'import useDialog from "../../lib/hooks/useDialog"',
		].join("\n")

		const result = rewriteImports(content, {
			fileDestPath: "components/dialog/Dialog.jsx",
			destFileSet,
			buyerAlias: "@/ui",
		})

		expect(result).toContain('from "react"')
		expect(result).toContain('"@/ui/lib/utils"')
		expect(result).toContain('from "@radix-ui/react-dialog"')
		expect(result).toContain('"@/ui/lib/hooks/useDialog"')
	})

	it("leaves relative imports unchanged when no buyer alias", () => {
		const content = 'import { cn } from "../../lib/utils"'
		const result = rewriteImports(content, {
			fileDestPath: "components/dialog/Dialog.jsx",
			destFileSet,
		})
		expect(result).toBe(content)
	})

	it("returns content unchanged when no aliases configured", () => {
		const content = 'import { cn } from "../../lib/utils"'
		const result = rewriteImports(content, {
			fileDestPath: "components/dialog/Dialog.jsx",
			destFileSet,
		})
		expect(result).toBe(content)
	})

	it("skips imports inside single-line comments", () => {
		const content = [
			'// import { old } from "../../lib/utils"',
			'import { cn } from "../../lib/utils"',
		].join("\n")

		const result = rewriteImports(content, {
			fileDestPath: "components/dialog/Dialog.jsx",
			destFileSet,
			buyerAlias: "@/ui",
		})

		const lines = result.split("\n")
		expect(lines[0]).toContain("../../lib/utils") // Comment unchanged
		expect(lines[1]).toContain("@/ui/lib/utils") // Active import rewritten
	})

	it("skips imports inside block comments", () => {
		const content = [
			'/* import { old } from "../../lib/utils" */',
			'import { cn } from "../../lib/utils"',
		].join("\n")

		const result = rewriteImports(content, {
			fileDestPath: "components/dialog/Dialog.jsx",
			destFileSet,
			buyerAlias: "@/ui",
		})

		const lines = result.split("\n")
		expect(lines[0]).toContain("../../lib/utils") // Block comment unchanged
		expect(lines[1]).toContain("@/ui/lib/utils") // Active import rewritten
	})

	it("handles dynamic imports", () => {
		const content = 'const Dialog = await import("../../components/dialog")'
		const result = rewriteImports(content, {
			fileDestPath: "lib/utils.js",
			destFileSet,
			buyerAlias: "@/ui",
		})
		expect(result).toContain("@/ui/components/dialog")
	})

	it("handles side-effect imports", () => {
		const content = 'import "./Dialog.style"'
		const result = rewriteImports(content, {
			fileDestPath: "components/dialog/Dialog.jsx",
			destFileSet,
			buyerAlias: "@/ui",
		})
		expect(result).toContain(
			"@/ui/components/dialog/Dialog.style",
		)
	})

	it("handles export from statements", () => {
		const content = 'export { cn } from "../../lib/utils"'
		const result = rewriteImports(content, {
			fileDestPath: "components/dialog/Dialog.jsx",
			destFileSet,
			buyerAlias: "@/ui",
		})
		expect(result).toContain("@/ui/lib/utils")
	})

	it("handles index file resolution and strips /index suffix", () => {
		const content = 'import Dialog from "../dialog"'
		const result = rewriteImports(content, {
			fileDestPath: "components/button/Button.jsx",
			destFileSet,
			buyerAlias: "@/ui",
		})
		expect(result).toContain("@/ui/components/dialog")
		// Should NOT contain /index.js
		expect(result).not.toContain("index")
	})

	it("strips file extension from rewritten imports", () => {
		const content = 'import { cn } from "../../lib/utils.js"'
		const result = rewriteImports(content, {
			fileDestPath: "components/dialog/Dialog.jsx",
			destFileSet,
			buyerAlias: "@/ui",
		})
		// Should strip .js extension
		expect(result).toContain('"@/ui/lib/utils"')
		expect(result).not.toContain("utils.js")
	})

	it("handles dest remapping with author alias via srcToDestMap", () => {
		// Author has primitives/ → consumer gets components/
		const remappedDestFileSet = new Set([
			"components/DataGrid/DataGrid.jsx",
			"components/DataGrid/index.js",
			"components/Panel/Panel.jsx",
			"helpers/format.js",
		])
		const srcToDestMap = new Map([
			["primitives/DataGrid/DataGrid.jsx", "components/DataGrid/DataGrid.jsx"],
			["primitives/DataGrid/index.js", "components/DataGrid/index.js"],
			["composites/Panel/Panel.jsx", "components/Panel/Panel.jsx"],
			["core/utils/format.js", "helpers/format.js"],
		])

		const content = [
			'import DataGrid from "@/primitives/DataGrid"',
			'import { formatNumber } from "@/core/utils/format"',
		].join("\n")

		const result = rewriteImports(content, {
			fileDestPath: "components/Panel/Panel.jsx",
			fileSrcPath: "composites/Panel/Panel.jsx",
			destFileSet: remappedDestFileSet,
			srcToDestMap,
			authorAlias: "@/",
			buyerAlias: "@/lib/dashboard",
		})

		expect(result).toContain('"@/lib/dashboard/components/DataGrid"')
		expect(result).toContain('"@/lib/dashboard/helpers/format"')
	})

	it("handles single quotes and double quotes", () => {
		const content = [
			"import { cn } from '../../lib/utils'",
			'import Button from "../../components/button/Button"',
		].join("\n")

		const result = rewriteImports(content, {
			fileDestPath: "components/dialog/Dialog.jsx",
			destFileSet,
			buyerAlias: "@/ui",
		})

		expect(result).toContain("'@/ui/lib/utils'")
		expect(result).toContain('"@/ui/components/button/Button"')
	})

	it("does not rewrite imports in multi-line block comments", () => {
		const content = [
			"/*",
			' * import { old } from "../../lib/utils"',
			" */",
			'import { cn } from "../../lib/utils"',
		].join("\n")

		const result = rewriteImports(content, {
			fileDestPath: "components/dialog/Dialog.jsx",
			destFileSet,
			buyerAlias: "@/ui",
		})

		const lines = result.split("\n")
		// Lines inside block comment should be unchanged
		expect(lines[1]).toContain("../../lib/utils")
		// Active import should be rewritten
		expect(lines[3]).toContain("@/ui/lib/utils")
	})

	it("preserves non-import lines unchanged", () => {
		const content = [
			'import { cn } from "../../lib/utils"',
			"",
			"const x = 42",
			"export default function Dialog() {",
			"  return <div />",
			"}",
		].join("\n")

		const result = rewriteImports(content, {
			fileDestPath: "components/dialog/Dialog.jsx",
			destFileSet,
			buyerAlias: "@/ui",
		})

		expect(result).toContain("const x = 42")
		expect(result).toContain("export default function Dialog()")
		expect(result).toContain("  return <div />")
	})

	it("handles buyer alias with trailing slash", () => {
		const content = 'import { cn } from "../../lib/utils"'
		const result = rewriteImports(content, {
			fileDestPath: "components/dialog/Dialog.jsx",
			destFileSet,
			buyerAlias: "@/ui/",
		})
		// Should not double the slash
		expect(result).toContain("@/ui/lib/utils")
		expect(result).not.toContain("@/ui//")
	})
})
