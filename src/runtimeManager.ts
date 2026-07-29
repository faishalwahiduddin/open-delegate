import { type ConfigOverride, DEFAULT_RUNTIME_KEY, configKey, overrideConfigEnv, serverDefaultConfigEnv } from "./configSpec.js";
import type { Logger } from "./log.js";
import { OpencodeRuntime } from "./runtime.js";

export class RuntimeCapacityError extends Error {
	constructor(max: number) {
		super(
			`open-delegate is already running the maximum of ${max} opencode server(s) ` +
				`(1 shared default + overrides). Wait for an active delegated session to finish, ` +
				`or reuse the default config instead of passing a one-off "config" override.`,
		);
		this.name = "RuntimeCapacityError";
	}
}

interface ManagedEntry {
	key: string;
	config: ConfigOverride | undefined;
	runtime: OpencodeRuntime | undefined;
	starting: Promise<OpencodeRuntime> | undefined;
	refCount: number;
	disposeTimer: ReturnType<typeof setTimeout> | undefined;
}

export interface RuntimeManagerOptions {
	/** Total concurrent opencode server processes, including the shared default one. */
	maxRuntimes?: number;
	/** How long an idle (refCount 0) ephemeral override runtime stays warm before being disposed. */
	graceMs?: number;
	/** Fired once when a runtime dies unexpectedly (crash or externally killed), after it was ready. */
	onCrash?: (key: string, info: { code: number | null; signal: string | null; pid: number | undefined }) => void;
	/** Injectable for tests; defaults to OpencodeRuntime.start. */
	startRuntime?: typeof OpencodeRuntime.start;
	/** Optional event sink, threaded down to every spawned OpencodeRuntime. */
	logger?: Logger;
}

const DEFAULT_MAX_RUNTIMES = 4;
const DEFAULT_GRACE_MS = 5 * 60_000;

/**
 * Owns every `opencode serve` process the MCP server spawns. There is always
 * at most one "default" runtime (server-level config from mcp.json env vars),
 * kept alive for the process lifetime, plus a bounded number of ephemeral
 * runtimes for calls that pass a one-off `config` override.
 */
export class RuntimeManager {
	private readonly entries = new Map<string, ManagedEntry>();
	private readonly maxRuntimes: number;
	private readonly graceMs: number;
	private readonly onCrash?: RuntimeManagerOptions["onCrash"];
	private readonly startRuntime: typeof OpencodeRuntime.start;
	private readonly logger?: Logger;

	constructor(options: RuntimeManagerOptions = {}) {
		this.maxRuntimes = options.maxRuntimes ?? DEFAULT_MAX_RUNTIMES;
		this.graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
		this.onCrash = options.onCrash;
		this.startRuntime = options.startRuntime ?? OpencodeRuntime.start.bind(OpencodeRuntime);
		this.logger = options.logger;
	}

	/**
	 * Returns a ready runtime for this config, spawning (or respawning, if the
	 * previous process died) one if needed. Increments the runtime's ref count;
	 * callers MUST call `release(key)` exactly once when they're done with it.
	 */
	async acquire(config?: ConfigOverride): Promise<{ key: string; runtime: OpencodeRuntime }> {
		const key = configKey(config);
		let entry = this.entries.get(key);

		if (entry?.starting) {
			const runtime = await entry.starting;
			entry.refCount += 1;
			this.cancelDisposeTimer(entry);
			return { key, runtime };
		}

		if (entry?.runtime && entry.runtime.state === "ready") {
			entry.refCount += 1;
			this.cancelDisposeTimer(entry);
			return { key, runtime: entry.runtime };
		}

		if (!entry) {
			if (key !== DEFAULT_RUNTIME_KEY && this.entries.size >= this.maxRuntimes) {
				throw new RuntimeCapacityError(this.maxRuntimes);
			}
			entry = { key, config, runtime: undefined, starting: undefined, refCount: 0, disposeTimer: undefined };
			this.entries.set(key, entry);
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
		const env =
			entry.key === DEFAULT_RUNTIME_KEY
				? serverDefaultConfigEnv()
				: { ...serverDefaultConfigEnv(), ...overrideConfigEnv(entry.config ?? {}) };
		return this.startRuntime({
			env,
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

	/** Returns the runtime for this key only if it's currently ready; never triggers a spawn. Accepts undefined so callers with a not-yet-attached session entry don't need a guard. */
	getRuntime(key: string | undefined): OpencodeRuntime | undefined {
		if (!key) return undefined;
		const entry = this.entries.get(key);
		return entry?.runtime?.state === "ready" ? entry.runtime : undefined;
	}

	/** Must be called exactly once per successful `acquire()`. Accepts undefined as a no-op for symmetry with getRuntime(). */
	release(key: string | undefined): void {
		if (!key) return;
		const entry = this.entries.get(key);
		if (!entry) return;
		entry.refCount = Math.max(0, entry.refCount - 1);
		if (entry.refCount === 0 && key !== DEFAULT_RUNTIME_KEY) {
			this.scheduleDispose(entry);
		}
	}

	private cancelDisposeTimer(entry: ManagedEntry): void {
		if (entry.disposeTimer) {
			clearTimeout(entry.disposeTimer);
			entry.disposeTimer = undefined;
		}
	}

	private scheduleDispose(entry: ManagedEntry): void {
		this.cancelDisposeTimer(entry);
		entry.disposeTimer = setTimeout(() => {
			entry.disposeTimer = undefined;
			if (entry.refCount > 0) return;
			void entry.runtime?.dispose();
			this.entries.delete(entry.key);
		}, this.graceMs);
		entry.disposeTimer.unref?.();
	}

	/** Disposes every runtime (default + overrides). Call on process shutdown. */
	async shutdownAll(): Promise<void> {
		const disposals: Promise<void>[] = [];
		for (const entry of this.entries.values()) {
			this.cancelDisposeTimer(entry);
			if (entry.runtime) disposals.push(entry.runtime.dispose());
		}
		this.entries.clear();
		await Promise.all(disposals);
	}

	/** Test/debug helper; also backs ode_diagnostics. */
	snapshot(): Array<{ key: string; state: string; refCount: number; opencodePid?: number; url?: string }> {
		return [...this.entries.values()].map((e) => ({
			key: e.key,
			state: e.runtime?.state ?? (e.starting ? "starting" : "dead"),
			refCount: e.refCount,
			opencodePid: e.runtime?.pid,
			url: e.runtime?.url,
		}));
	}
}
