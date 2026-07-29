#!/usr/bin/env node
/**
 * Maintainer tool: spawn a temporary `opencode serve`, call provider.list(), and
 * diff against the curated ODE_MODELS catalog + docs pins.
 *
 * Does NOT auto-write files — cost/quality curation stays a human call.
 *
 * Usage: npm run refresh:models
 * Requires: opencode on PATH (or OPEN_DELEGATE_OPENCODE_BIN).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import crossSpawn from "cross-spawn";
import { createOpencodeClient } from "@opencode-ai/sdk";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHEAP_INPUT_MAX = 5;
const STARTUP_TIMEOUT_MS = 30_000;

function resolveOpencodeBin() {
	const override = process.env.OPEN_DELEGATE_OPENCODE_BIN;
	if (override) {
		if (!existsSync(override)) throw new Error(`OPEN_DELEGATE_OPENCODE_BIN=${override} does not exist`);
		return override;
	}
	const isWin = process.platform === "win32";
	const dirs = (process.env.PATH ?? "").split(isWin ? ";" : ":").filter(Boolean);
	const exts = isWin ? [".cmd", ".exe", ".bat", ""] : [""];
	const sep = isWin ? "\\" : "/";
	for (const dir of dirs) {
		for (const ext of exts) {
			const candidate = `${dir.endsWith(sep) ? dir.slice(0, -1) : dir}${sep}opencode${ext}`;
			if (existsSync(candidate)) return candidate;
		}
	}
	throw new Error('opencode CLI not on PATH; install it or set OPEN_DELEGATE_OPENCODE_BIN');
}

function killTree(proc) {
	if (proc.exitCode !== null || proc.signalCode !== null) return;
	if (process.platform === "win32" && proc.pid) {
		spawnSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { windowsHide: true });
		return;
	}
	proc.kill("SIGTERM");
}

function waitForListening(proc, timeoutMs) {
	return new Promise((resolve, reject) => {
		let output = "";
		let settled = false;
		const cleanup = () => {
			proc.stdout?.off("data", onStdout);
			proc.stderr?.off("data", onStderr);
			proc.off("exit", onExit);
			proc.off("error", onError);
		};
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			cleanup();
			killTree(proc);
			reject(new Error(`opencode serve did not listen within ${timeoutMs}ms.\n${output}`));
		}, timeoutMs);
		const onStdout = (chunk) => {
			if (settled) return;
			output += chunk.toString();
			const match = output.match(/opencode server listening on\s+(https?:\/\/\S+)/);
			if (match?.[1]) {
				settled = true;
				clearTimeout(timer);
				cleanup();
				resolve(match[1]);
			}
		};
		const onStderr = (chunk) => {
			output += chunk.toString();
		};
		const onExit = (code) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			cleanup();
			reject(new Error(`opencode serve exited with code ${code} before listening.\n${output}`));
		};
		const onError = (err) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			cleanup();
			reject(err);
		};
		proc.stdout?.on("data", onStdout);
		proc.stderr?.on("data", onStderr);
		proc.on("exit", onExit);
		proc.on("error", onError);
	});
}

function parseSnapshot(data) {
	const allIds = new Set();
	const models = [];
	const connectedProviders = new Set(data.connected ?? []);
	for (const provider of data.all ?? []) {
		for (const [modelKey, model] of Object.entries(provider.models ?? {})) {
			const rawId = typeof model.id === "string" && model.id.length > 0 ? model.id : modelKey;
			const id = `${provider.id}/${rawId}`;
			allIds.add(id);
			models.push({
				id,
				providerID: provider.id,
				toolCall: model.tool_call,
				costInput: model.cost?.input,
				costOutput: model.cost?.output,
				status: model.status,
				experimental: model.experimental,
			});
		}
	}
	const connectedIds = models.filter((m) => connectedProviders.has(m.providerID)).map((m) => m.id);
	return { allIds, connectedProviders, connectedIds, models };
}

function loadCurated() {
	const path = join(ROOT, "src", "data", "ode-models.default.json");
	return JSON.parse(readFileSync(path, "utf8"));
}

function extractPinsFromGroundTruth(md) {
	const pins = [];
	for (const m of md.matchAll(/`((?:opencode|openrouter)\/[^`]+)`/g)) pins.push(m[1]);
	return [...new Set(pins)];
}

async function main() {
	const bin = resolveOpencodeBin();
	console.log(`Starting temporary opencode serve (${bin})…`);
	const proc = crossSpawn(bin, ["serve", "--hostname=127.0.0.1", "--port=0"], {
		env: { ...process.env },
	});
	let url;
	try {
		url = await waitForListening(proc, STARTUP_TIMEOUT_MS);
	} catch (err) {
		killTree(proc);
		throw err;
	}

	const client = createOpencodeClient({ baseUrl: url });
	try {
		const res = await client.provider.list({ throwOnError: true });
		const snapshot = parseSnapshot(res.data);
		const curated = loadCurated();

		let groundTruthPins = [];
		try {
			groundTruthPins = extractPinsFromGroundTruth(readFileSync(join(ROOT, "docs", "MODELS_GROUND_TRUTH.md"), "utf8"));
		} catch {
			console.warn("(could not read docs/MODELS_GROUND_TRUTH.md)");
		}

		const missingFromCatalog = curated.filter((id) => !snapshot.allIds.has(id));
		const notConnected = curated.filter((id) => snapshot.allIds.has(id) && !snapshot.connectedIds.includes(id));
		const curatedSet = new Set(curated);

		const candidates = snapshot.models
			.filter((m) => {
				if (curatedSet.has(m.id)) return false;
				if (m.toolCall === false) return false;
				if (m.experimental) return false;
				if (m.status === "deprecated") return false;
				const input = m.costInput ?? Infinity;
				const output = m.costOutput ?? Infinity;
				return (input === 0 && output === 0) || input <= CHEAP_INPUT_MAX;
			})
			.sort((a, b) => (a.costInput ?? 0) - (b.costInput ?? 0) || (a.costOutput ?? 0) - (b.costOutput ?? 0))
			.slice(0, 40);

		const gtMissing = groundTruthPins.filter((id) => !snapshot.allIds.has(id));

		console.log("\n=== Curated ODE_MODELS vs live runtime ===\n");
		console.log(`Connected providers: ${[...snapshot.connectedProviders].sort().join(", ") || "(none)"}`);
		console.log(`Catalog models: ${snapshot.allIds.size}; connected model ids: ${snapshot.connectedIds.length}`);
		console.log(`Curated pins: ${curated.length}`);

		if (missingFromCatalog.length) {
			console.log("\nCurated pins NOT in runtime catalog:");
			for (const id of missingFromCatalog) console.log(`  - ${id}`);
		} else {
			console.log("\nAll curated pins are present in the runtime catalog.");
		}

		if (notConnected.length) {
			console.log("\nCurated pins present but provider NOT connected:");
			for (const id of notConnected) console.log(`  - ${id}`);
		} else {
			console.log("All present curated pins have a connected provider.");
		}

		if (gtMissing.length) {
			console.log("\nMODELS_GROUND_TRUTH pins missing from catalog:");
			for (const id of gtMissing.slice(0, 30)) console.log(`  - ${id}`);
			if (gtMissing.length > 30) console.log(`  … and ${gtMissing.length - 30} more`);
		}

		console.log("\nCandidate cheap/free tool-call models not yet curated (top 40):");
		if (candidates.length === 0) console.log("  (none)");
		else {
			for (const m of candidates) {
				console.log(`  - ${m.id}  ($${m.costInput ?? "?"}/${m.costOutput ?? "?"} in/out per 1M)`);
			}
		}

		console.log("\n(No files were modified. Edit src/data/ode-models.default.json manually after review.)");
	} finally {
		killTree(proc);
	}
}

main().catch((err) => {
	console.error("refresh-models failed:", err);
	process.exit(1);
});
