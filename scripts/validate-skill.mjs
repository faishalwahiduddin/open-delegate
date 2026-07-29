#!/usr/bin/env node
/**
 * Validates the open-delegate plugin layout, the ode-delegate skill's
 * frontmatter/DoD/size budget, that it actually documents all six real MCP
 * tools, and that every relative markdown link inside it resolves.
 *
 * Exit 0 = green. Exit 1 = errors printed to stderr.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const warnings = [];

const MAX_SKILL_LINES = 150;
const REQUIRED_TOOLS = ["ode_delegate", "ode_await", "ode_status", "ode_transcript", "ode_cancel", "ode_resume"];

function read(p) {
	return readFileSync(p, "utf8");
}

function walk(dir, acc = []) {
	if (!existsSync(dir)) return acc;
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		const st = statSync(p);
		if (st.isDirectory()) walk(p, acc);
		else acc.push(p);
	}
	return acc;
}

function parseFrontmatter(text) {
	const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!m) return null;
	const fm = {};
	for (const line of m[1].split(/\r?\n/)) {
		const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
		if (!kv) continue;
		let v = kv[2].trim();
		if (v === ">" || v === ">-") {
			fm[kv[1]] = v;
			continue;
		}
		if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
		fm[kv[1]] = v;
	}
	if (fm.description === ">" || fm.description === ">-") {
		const body = m[1];
		const idx = body.indexOf("description:");
		const after = body.slice(idx).split(/\r?\n/).slice(1);
		const lines = [];
		for (const l of after) {
			if (/^[A-Za-z0-9_-]+:/.test(l)) break;
			if (l.trim() === "") continue;
			lines.push(l.replace(/^\s+/, ""));
		}
		fm.description = lines.join(" ").trim();
	}
	return fm;
}

// --- plugin.json ---
const pluginManifestPath = join(ROOT, ".cursor-plugin", "plugin.json");
if (!existsSync(pluginManifestPath)) {
	errors.push("missing .cursor-plugin/plugin.json");
} else {
	try {
		const m = JSON.parse(read(pluginManifestPath));
		if (m.name !== "open-delegate") errors.push(`plugin.json name must be "open-delegate", got ${JSON.stringify(m.name)}`);
		if (!m.skills) errors.push("plugin.json missing skills field");
		if (!m.rules) errors.push('plugin.json missing rules field (expected "./rules/")');
	} catch (e) {
		errors.push(`plugin.json parse: ${e.message}`);
	}
}

const routingRulePath = join(ROOT, "rules", "open-delegate-routing.mdc");
if (!existsSync(routingRulePath)) {
	errors.push("missing rules/open-delegate-routing.mdc");
} else {
	const ruleText = read(routingRulePath);
	if (!/alwaysApply:\s*true/.test(ruleText)) {
		errors.push("rules/open-delegate-routing.mdc: expected alwaysApply: true");
	}
	if (!/ode_delegate/.test(ruleText)) {
		errors.push("rules/open-delegate-routing.mdc: should mention ode_delegate");
	}
}

// --- mcp.json ---
const mcpManifestPath = join(ROOT, "mcp.json");
if (!existsSync(mcpManifestPath)) {
	errors.push("missing mcp.json");
} else {
	try {
		const m = JSON.parse(read(mcpManifestPath));
		const server = m.mcpServers?.["open-delegate"];
		if (!server) errors.push('mcp.json missing mcpServers["open-delegate"]');
		else if (!server.command || !Array.isArray(server.args)) errors.push('mcp.json mcpServers["open-delegate"] missing command/args');
	} catch (e) {
		errors.push(`mcp.json parse: ${e.message}`);
	}
}

for (const p of ["README.md", "skills/ode-delegate/SKILL.md"]) {
	if (!existsSync(join(ROOT, p))) errors.push(`missing ${p}`);
}

// --- skill ---
const skillDir = join(ROOT, "skills", "ode-delegate");
const skillMdPath = join(skillDir, "SKILL.md");
if (existsSync(skillMdPath)) {
	const text = read(skillMdPath);
	const lines = text.split(/\r?\n/).length;
	if (lines > MAX_SKILL_LINES) errors.push(`skills/ode-delegate/SKILL.md is ${lines} lines (max ${MAX_SKILL_LINES})`);

	const fm = parseFrontmatter(text);
	if (!fm) {
		errors.push("skills/ode-delegate/SKILL.md: missing frontmatter");
	} else {
		if (fm.name !== "ode-delegate") errors.push(`skills/ode-delegate/SKILL.md: frontmatter name ${fm.name} != "ode-delegate"`);
		if (!fm.description) errors.push("skills/ode-delegate/SKILL.md: missing description");
		else if (!/\bUse when\b/i.test(fm.description)) warnings.push('skills/ode-delegate/SKILL.md: description should include "Use when"');
	}

	if (!/^## DoD\b/m.test(text)) errors.push("skills/ode-delegate/SKILL.md: missing ## DoD section");

	for (const toolName of REQUIRED_TOOLS) {
		if (!text.includes(toolName)) errors.push(`skills/ode-delegate/SKILL.md: does not mention tool "${toolName}"`);
	}

	// relative links across the whole skill tree resolve to real files
	const files = walk(skillDir).filter((p) => p.endsWith(".md"));
	for (const fp of files) {
		const body = read(fp);
		const rel = relative(ROOT, fp).replace(/\\/g, "/");
		for (const toolName of REQUIRED_TOOLS) {
			// no-op: presence already checked on SKILL.md; reference files are free to omit any subset.
			void toolName;
		}
		for (const m of body.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
			const href = m[1].split("#")[0];
			if (!href || href.startsWith("http") || href.startsWith("mailto:")) continue;
			const target = resolve(dirname(fp), href);
			if (!existsSync(target)) errors.push(`${rel}: dead link -> ${href}`);
		}
	}
} else {
	errors.push("skills/ode-delegate/SKILL.md not found; skipped content checks");
}

// --- reference index referenced from SKILL.md matches files on disk ---
const referenceDir = join(skillDir, "reference");
const referenceFiles = existsSync(referenceDir) ? readdirSync(referenceDir).filter((f) => f.endsWith(".md")) : [];
if (existsSync(skillMdPath)) {
	const text = read(skillMdPath);
	for (const f of referenceFiles) {
		if (!text.includes(f)) warnings.push(`reference/${f} exists but isn't linked from SKILL.md`);
	}
}

// --- report ---
for (const w of warnings) console.warn(`WARN: ${w}`);
if (errors.length) {
	for (const e of errors) console.error(`ERROR: ${e}`);
	console.error(`\nvalidate-skill: ${errors.length} error(s)`);
	process.exit(1);
}
console.log(`validate-skill: OK (${referenceFiles.length} reference doc(s), ${REQUIRED_TOOLS.length} tools documented)`);
process.exit(0);
