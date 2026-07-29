/**
 * Server-level opencode config, sourced from the MCP server's own process env
 * (mcp.json). Maps 1:1 onto the env vars OpenCode itself already understands
 * (see opencode.ai/docs/config — "Custom config" / "Inline config").
 */

export const DEFAULT_RUNTIME_KEY = "default";

/** Env vars for the shared default runtime. */
export function serverDefaultConfigEnv(env: Record<string, string | undefined> = process.env): Record<string, string> {
	const out: Record<string, string> = {};
	if (env.OPEN_DELEGATE_OPENCODE_CONFIG) out.OPENCODE_CONFIG = env.OPEN_DELEGATE_OPENCODE_CONFIG;
	if (env.OPEN_DELEGATE_OPENCODE_CONFIG_DIR) out.OPENCODE_CONFIG_DIR = env.OPEN_DELEGATE_OPENCODE_CONFIG_DIR;
	if (env.OPEN_DELEGATE_OPENCODE_CONFIG_CONTENT) out.OPENCODE_CONFIG_CONTENT = env.OPEN_DELEGATE_OPENCODE_CONFIG_CONTENT;
	return out;
}
