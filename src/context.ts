import type { Logger } from "./log.js";
import type { ModelPolicy } from "./modelPolicy.js";
import type { RuntimeManager } from "./runtimeManager.js";
import type { SessionRegistry } from "./sessionRegistry.js";

export interface DelegateContext {
	runtimeManager: RuntimeManager;
	registry: SessionRegistry;
	modelPolicy: ModelPolicy;
	logger: Logger;
	/** MCP server package version, surfaced via ode_diagnostics. */
	version: string;
}
