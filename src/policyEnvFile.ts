import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const POLICY_KEYS = [
	"OPEN_DELEGATE_DEFAULT_MODEL",
	"OPEN_DELEGATE_ODE_MODELS",
	"OPEN_DELEGATE_ODE_MODELS_FILE",
	"OPEN_DELEGATE_ALLOW_MODELS",
	"OPEN_DELEGATE_DENY_MODELS",
	"OPEN_DELEGATE_OPENCODE_CONFIG",
	"OPEN_DELEGATE_OPENCODE_CONFIG_DIR",
	"OPEN_DELEGATE_OPENCODE_CONFIG_CONTENT",
	"OPEN_DELEGATE_OPENCODE_BIN",
	"OPEN_DELEGATE_LOG_DIR",
	"OPEN_DELEGATE_LOG_LEVEL",
	"OPEN_DELEGATE_SETUP_TIMEOUT_MS",
] as const;

function resolveEnvFilePath(env: NodeJS.ProcessEnv): string {
	const override = env.OPEN_DELEGATE_ENV_FILE?.trim();
	if (override) return override;
	return join(homedir(), ".config", "open-delegate", "env.json");
}

/**
 * Cursor plugin MCP often spawns `node dist/index.cjs` without mcp.json `env`.
 * Merge optional ~/.config/open-delegate/env.json into process.env (existing env wins).
 */
export function applyPolicyEnvFile(env: NodeJS.ProcessEnv = process.env): void {
	const path = resolveEnvFilePath(env);
	if (!existsSync(path)) return;

	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch (err) {
		throw new Error(
			`Invalid OPEN_DELEGATE env file "${path}": ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`OPEN_DELEGATE env file "${path}" must be a JSON object.`);
	}

	const record = parsed as Record<string, unknown>;
	for (const key of POLICY_KEYS) {
		if (env[key] !== undefined && String(env[key]).length > 0) continue;
		const raw = record[key];
		if (raw === undefined || raw === null) continue;
		if (typeof raw !== "string") {
			throw new Error(`OPEN_DELEGATE env file "${path}": "${key}" must be a string.`);
		}
		const value = raw.trim();
		if (value.length > 0) env[key] = value;
	}
}
