import { DEFAULT_RUNTIME_KEY, serverDefaultConfigEnv } from "./configSpec.js";
import type { Logger } from "./log.js";
import { OpencodeRuntime } from "./runtime.js";

interface ManagedEntry {
	key: string;
	runtime: OpencodeRuntime | undefined;
	starting: Promise<OpencodeRuntime> | undefined;
	refCount: number;
}

export interface RuntimeManagerOptions {
	/** Fired once when a runtime dies unexpectedly (crash or externally killed), after it was ready. */
	onCrash?: (key: string, info: { code: number | null; signal: string | null; pid: number | undefined }) => void;
	/** Injectable for tests; defaults to OpencodeRuntime.start. */
	startRuntime?: typeof OpencodeRuntime.start;
	/** Optional event sink, threaded down to every spawned OpencodeRuntime. */
	logger?: Logger;
}

/**
 * Owns the single shared `opencode serve` process the MCP server spawns.
 * Kept alive for the process lifetime; respawns on the next acquire() if it
 * crashed. Per-call config overrides (and the capped ephemeral pool they
 * needed) were removed — configure via OPEN_DELEGATE_OPENCODE_CONFIG* only.
 */
export class RuntimeManager {
	private entry: ManagedEntry | undefined;
	private readonly onCrash?: RuntimeManagerOptions["onCrash"];
	private readonly startRuntime: typeof OpencodeRuntime.start;
	private readonly logger?: Logger;

	constructor(options: RuntimeManagerOptions = {}) {
		this.onCrash = options.onCrash;
		this.startRuntime = options.startRuntime ?? OpencodeRuntime.start.bind(OpencodeRuntime);
		this.logger = options.logger;
	}

	/**
	 * Returns the ready default runtime, spawning (or respawning, if the
	 * previous process died) one if needed. Increments the runtime's ref count;
	 * callers MUST call `release()` exactly once when they're done with it.
	 */
	async acquire(): Promise<{ key: string; runtime: OpencodeRuntime }> {
		const key = DEFAULT_RUNTIME_KEY;
		let entry = this.entry;

		if (entry?.starting) {
			const runtime = await entry.starting;
			entry.refCount += 1;
			return { key, runtime };
		}

		if (entry?.runtime && entry.runtime.state === "ready") {
			entry.refCount += 1;
			return { key, runtime: entry.runtime };
		}

		if (!entry) {
			entry = { key, runtime: undefined, starting: undefined, refCount: 0 };
			this.entry = entry;
		}

		const startingPromise = this.spawn(entry);
		entry.starting = startingPromise;
		try {
			const runtime = await startingPromise;
			entry.runtime = runtime;
			entry.refCount += 1;
			return { key, runtime };
		} finally {
			entry.starting = undefined;
		}
	}

	private spawn(entry: ManagedEntry): Promise<OpencodeRuntime> {
		return this.startRuntime({
			env: serverDefaultConfigEnv(),
			key: entry.key,
			logger: this.logger,
			onCrash: (info) => {
				const pid = entry.runtime?.pid;
				entry.runtime = undefined;
				this.logger?.warn("runtime_exit", { key: entry.key, pid, code: info.code, signal: info.signal });
				this.onCrash?.(entry.key, { ...info, pid });
			},
		});
	}

	/** Returns the runtime only if it's currently ready; never triggers a spawn. Accepts undefined so callers with a not-yet-attached session entry don't need a guard. */
	getRuntime(key: string | undefined): OpencodeRuntime | undefined {
		if (!key || key !== DEFAULT_RUNTIME_KEY) return undefined;
		const entry = this.entry;
		return entry?.runtime?.state === "ready" ? entry.runtime : undefined;
	}

	/** Must be called exactly once per successful `acquire()`. Accepts undefined as a no-op for symmetry with getRuntime(). */
	release(key: string | undefined): void {
		if (!key || key !== DEFAULT_RUNTIME_KEY) return;
		const entry = this.entry;
		if (!entry) return;
		entry.refCount = Math.max(0, entry.refCount - 1);
		// Default runtime stays warm for the process lifetime; never auto-dispose.
	}

	/** Disposes the default runtime. Call on process shutdown. */
	async shutdownAll(): Promise<void> {
		const entry = this.entry;
		this.entry = undefined;
		if (entry?.runtime) await entry.runtime.dispose();
	}

	/** Test/debug helper; also backs ode_diagnostics. */
	snapshot(): Array<{ key: string; state: string; refCount: number; opencodePid?: number; url?: string }> {
		if (!this.entry) return [];
		const e = this.entry;
		return [
			{
				key: e.key,
				state: e.runtime?.state ?? (e.starting ? "starting" : "dead"),
				refCount: e.refCount,
				opencodePid: e.runtime?.pid,
				url: e.runtime?.url,
			},
		];
	}
}
