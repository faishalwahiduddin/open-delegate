#!/usr/bin/env node
/**
 * Bundle src/index.ts → single dist/index.cjs (no runtime node_modules).
 * CJS output so deps like cross-spawn that use require("child_process") work.
 * Typecheck first via tsc --noEmit; esbuild does the emit.
 * Also copies src/data/ → dist/data/ so runtime JSON catalogs are adjacent to the bundle.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const OUT = join(DIST, "index.cjs");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

const tsc = spawnSync(
	process.execPath,
	[join(ROOT, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json", "--noEmit"],
	{ cwd: ROOT, stdio: "inherit" },
);
if (tsc.status !== 0) {
	process.exit(tsc.status ?? 1);
}

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

await esbuild.build({
	entryPoints: [join(ROOT, "src", "index.ts")],
	bundle: true,
	platform: "node",
	format: "cjs",
	target: "node18.17",
	outfile: OUT,
	define: {
		"process.env.OPEN_DELEGATE_PKG_VERSION": JSON.stringify(pkg.version ?? "0.0.0"),
	},
	logLevel: "info",
});

// Ensure a Unix-friendly shebang for npm bin installs on macOS/Linux.
const body = readFileSync(OUT, "utf8");
if (!body.startsWith("#!")) {
	writeFileSync(OUT, `#!/usr/bin/env node\n${body}`);
}

// Copy data catalogs next to the bundle. esbuild rewrites import.meta.url in CJS
// to a fileURL for the outfile, so `./data/...` resolves relative to dist/.
cpSync(join(ROOT, "src", "data"), join(DIST, "data"), { recursive: true });

console.log(`built dist/index.cjs (@verbalize/open-delegate@${pkg.version})`);
