import { createHash } from "node:crypto";
import { resolve } from "node:path";

/**
 * A per-call opencode config override. Maps 1:1 onto the two env vars
 * OpenCode itself already understands (see opencode.ai/docs/config —
 * "Custom config" / "Inline config"), so no config-parsing logic lives here.
 */
export interface ConfigOverride {
	/** Path to a custom opencode.json/.jsonc file -> OPENCODE_CONFIG. */
	path?: string;
	/** Raw inline JSON config content -> OPENCODE_CONFIG_CONTENT. */
	content?: string;
}

export const DEFAULT_RUNTIME_KEY = "default";

/** Env vars for the shared default runtime, sourced from the MCP server's own process env (mcp.json). */
export function serverDefaultConfigEnv(env: Record<string, string | undefined> = process.env): Record<string, string> {
	const out: Record<string, string> = {};
	if (env.OPEN_DELEGATE_OPENCODE_CONFIG) out.OPENCODE_CONFIG = env.OPEN_DELEGATE_OPENCODE_CONFIG;
	if (env.OPEN_DELEGATE_OPENCODE_CONFIG_DIR) out.OPENCODE_CONFIG_DIR = env.OPEN_DELEGATE_OPENCODE_CONFIG_DIR;
	if (env.OPEN_DELEGATE_OPENCODE_CONFIG_CONTENT) out.OPENCODE_CONFIG_CONTENT = env.OPEN_DELEGATE_OPENCODE_CONFIG_CONTENT;
	return out;
}

/** Env vars for a per-call override runtime, layered on top of the server defaults. */
export function overrideConfigEnv(config: ConfigOverride): Record<string, string> {
	const out: Record<string, string> = {};
	if (config.path) out.OPENCODE_CONFIG = resolve(config.path);
	if (config.content) out.OPENCODE_CONFIG_CONTENT = config.content;
	return out;
}

/** Stable identity for a config override, used to key/reuse ephemeral runtimes. Absent config -> the shared default runtime. */
export function configKey(config?: ConfigOverride): string {
	if (!config || (!config.path && !config.content)) return DEFAULT_RUNTIME_KEY;
	const hash = createHash("sha256");
	if (config.path) hash.update(`path:${resolve(config.path)}`);
	if (config.content) hash.update(`content:${config.content}`);
	return `override:${hash.digest("hex").slice(0, 12)}`;
}
