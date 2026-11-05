#!/usr/bin/env node
/**
 * Installs plan-build-opencode-prefix.mjs into ~/.cursor/hooks and registers
 * it on beforeSubmitPrompt (idempotent). SSOT for the script lives in this repo.
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "scripts", "plan-build-opencode-prefix.mjs");
const CURSOR_DIR = join(homedir(), ".cursor");
const HOOKS_DIR = join(CURSOR_DIR, "hooks");
const DEST = join(HOOKS_DIR, "plan-build-opencode-prefix.mjs");
const HOOKS_JSON = join(CURSOR_DIR, "hooks.json");
const MARKER = "plan-build-opencode-prefix";
const hookCommand = `node ${DEST.replace(/\\/g, "/")}`;

if (!existsSync(SOURCE)) {
	console.error(`Missing ${SOURCE}`);
	process.exit(1);
}

mkdirSync(HOOKS_DIR, { recursive: true });
copyFileSync(SOURCE, DEST);
chmodSync(DEST, 0o755);

let hooks = { version: 1, hooks: {} };
if (existsSync(HOOKS_JSON)) {
	try {
		hooks = JSON.parse(readFileSync(HOOKS_JSON, "utf8"));
	} catch (e) {
		console.error(`Failed to parse ${HOOKS_JSON}: ${e.message}`);
		process.exit(1);
	}
}
if (!hooks.hooks || typeof hooks.hooks !== "object") hooks.hooks = {};
if (!Array.isArray(hooks.hooks.beforeSubmitPrompt)) hooks.hooks.beforeSubmitPrompt = [];

const entries = hooks.hooks.beforeSubmitPrompt;
const idx = entries.findIndex(
	(e) => typeof e === "object" && e && typeof e.command === "string" && e.command.includes(MARKER),
);
const entry = { command: hookCommand, timeout: 5 };
if (idx >= 0) entries[idx] = entry;
else entries.unshift(entry);

if (!hooks.version) hooks.version = 1;
writeFileSync(HOOKS_JSON, `${JSON.stringify(hooks, null, 2)}\n`, "utf8");

console.log(`Installed ${DEST}`);
console.log(`Registered beforeSubmitPrompt -> ${HOOKS_JSON}`);
console.log("Disable per session: OPEN_DELEGATE_PLAN_HOOK=0");
console.log("Reload Cursor window if hooks do not fire immediately.");
