import type { Logger } from "./log.js";
import type { ModelAvailabilityCache } from "./modelAvailability.js";
import type { ModelPolicy } from "./modelPolicy.js";
import type { RuntimeManager } from "./runtimeManager.js";
import type { SessionRegistry } from "./sessionRegistry.js";

export interface DelegateContext {
	runtimeManager: RuntimeManager;
	registry: SessionRegistry;
	modelPolicy: ModelPolicy;
	logger: Logger;
	/** Cached OpenCode provider.list() snapshot for fail-fast model checks. */
	modelAvailability: ModelAvailabilityCache;
	/** MCP server package version, surfaced via ode_diagnostics. */
	version: string;
}
