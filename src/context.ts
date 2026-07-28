import type { RuntimeManager } from "./runtimeManager.js";
import type { SessionRegistry } from "./sessionRegistry.js";

export interface DelegateContext {
	runtimeManager: RuntimeManager;
	registry: SessionRegistry;
}
