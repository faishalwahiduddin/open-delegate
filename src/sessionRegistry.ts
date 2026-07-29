import type { ConfigOverride } from "./configSpec.js";
import type { ErrorCode } from "./mcpResult.js";

export type SessionStatus = "starting" | "running" | "done" | "error" | "cancelled";

export interface SessionEntry {
	/** Stable public id, returned by ode_delegate and used by every other tool. Never changes for a session's lifetime. */
	id: string;
	/** OpenCode's own session id, used for every HTTP call to opencode. Undefined only while status is "starting". */
	opencodeSessionId: string | undefined;
	/** Runtime pool key this session lives on. Undefined only while status is "starting". */
	runtimeKey: string | undefined;
	config: ConfigOverride | undefined;
	previewUrl: string | undefined;
	status: SessionStatus;
	createdAt: number;
	updatedAt: number;
	terminalAt: number | undefined;
	errorMessage: string | undefined;
	/** Set alongside errorMessage when a "starting" session fails setup, so the failure can be re-surfaced with its original code. */
	errorCode: ErrorCode | undefined;
	/** True when the terminal assistant message had non-empty text parts; false when known empty; unset while running/unknown. */
	hasFinalText: boolean | undefined;
}

export type FinalizePatch = Partial<Pick<SessionEntry, "hasFinalText" | "errorCode">>;

const TERMINAL_STATUSES: ReadonlySet<SessionStatus> = new Set(["done", "error", "cancelled"]);

export interface SessionRegistryOptions {
	/** How long a terminal session stays visible to ode_status/ode_transcript before being pruned. */
	pruneAfterMs?: number;
	now?: () => number;
}

const DEFAULT_PRUNE_AFTER_MS = 30 * 60_000;

/**
 * In-memory bookkeeping for delegated sessions. OpenCode's own server remains
 * the source of truth for message content; this registry only tracks which
 * runtime a session lives on and the last status we observed, so we can route
 * follow-up calls and detect "runtime died mid-session" without polling.
 */
export class SessionRegistry {
	private readonly entries = new Map<string, SessionEntry>();
	private readonly pruneAfterMs: number;
	private readonly now: () => number;

	constructor(options: SessionRegistryOptions = {}) {
		this.pruneAfterMs = options.pruneAfterMs ?? DEFAULT_PRUNE_AFTER_MS;
		this.now = options.now ?? Date.now;
	}

	/** Everything known upfront (runtime already acquired, opencode session already created). Status starts "running". */
	create(params: {
		id: string;
		runtimeKey: string;
		config: ConfigOverride | undefined;
		previewUrl: string;
		opencodeSessionId?: string;
	}): SessionEntry {
		this.pruneNow();
		const timestamp = this.now();
		const entry: SessionEntry = {
			id: params.id,
			opencodeSessionId: params.opencodeSessionId ?? params.id,
			runtimeKey: params.runtimeKey,
			config: params.config,
			previewUrl: params.previewUrl,
			status: "running",
			createdAt: timestamp,
			updatedAt: timestamp,
			terminalAt: undefined,
			errorMessage: undefined,
			errorCode: undefined,
			hasFinalText: undefined,
		};
		this.entries.set(params.id, entry);
		return entry;
	}

	/**
	 * Registers a public id immediately, before its runtime/opencode session
	 * exist yet, so ode_delegate can return a stable sessionId without
	 * blocking on a cold `opencode serve` spawn. Call attachRuntime() once
	 * setup succeeds, or failStarting() if it doesn't.
	 */
	createPending(params: { id: string; config: ConfigOverride | undefined }): SessionEntry {
		this.pruneNow();
		const timestamp = this.now();
		const entry: SessionEntry = {
			id: params.id,
			opencodeSessionId: undefined,
			runtimeKey: undefined,
			config: params.config,
			previewUrl: undefined,
			status: "starting",
			createdAt: timestamp,
			updatedAt: timestamp,
			terminalAt: undefined,
			errorMessage: undefined,
			errorCode: undefined,
			hasFinalText: undefined,
		};
		this.entries.set(params.id, entry);
		return entry;
	}

	/**
	 * Flips a "starting" entry to "running" once its runtime/opencode session
	 * exist. Returns false (no-op) if the entry was cancelled, failed, or
	 * pruned in the meantime — the caller must then discard what it just set
	 * up (abort the opencode session, release the runtime) instead of leaving
	 * an orphaned session running server-side.
	 */
	attachRuntime(id: string, params: { runtimeKey: string; opencodeSessionId: string; previewUrl: string }): boolean {
		const entry = this.entries.get(id);
		if (!entry || entry.status !== "starting") return false;
		entry.runtimeKey = params.runtimeKey;
		entry.opencodeSessionId = params.opencodeSessionId;
		entry.previewUrl = params.previewUrl;
		entry.status = "running";
		entry.updatedAt = this.now();
		return true;
	}

	/**
	 * Fails a still-"starting" entry (acquire/create/promptAsync threw, or the
	 * setup deadline elapsed). No-op if it already resolved another way
	 * (cancelled, pruned) — returns false so the caller knows not to double-log.
	 */
	failStarting(id: string, message: string, code?: ErrorCode): boolean {
		const entry = this.entries.get(id);
		if (!entry || entry.status !== "starting") return false;
		entry.status = "error";
		entry.errorMessage = message;
		entry.errorCode = code;
		entry.hasFinalText = false;
		entry.updatedAt = this.now();
		entry.terminalAt = entry.updatedAt;
		return true;
	}

	get(id: string): SessionEntry | undefined {
		return this.entries.get(id);
	}

	setStatus(id: string, status: SessionStatus, errorMessage?: string): SessionEntry | undefined {
		const entry = this.entries.get(id);
		if (!entry) return undefined;
		entry.status = status;
		entry.updatedAt = this.now();
		entry.errorMessage = errorMessage;
		entry.terminalAt = TERMINAL_STATUSES.has(status) ? entry.updatedAt : undefined;
		// Resume clears the previous terminal text signal / error classification until the new turn finishes.
		if (!TERMINAL_STATUSES.has(status)) {
			entry.hasFinalText = undefined;
			entry.errorCode = undefined;
		}
		return entry;
	}

	/**
	 * Synchronous compare-and-set: only transitions to a terminal status if the
	 * entry is still "running". Safe to call from multiple concurrent pollers
	 * (ode_status/ode_await) without double-finalizing, since there is no
	 * `await` between the check and the mutation.
	 */
	finalizeIfRunning(id: string, status: SessionStatus, errorMessage?: string, patch?: FinalizePatch): boolean {
		const entry = this.entries.get(id);
		if (!entry || entry.status !== "running") return false;
		entry.status = status;
		entry.errorMessage = errorMessage;
		entry.updatedAt = this.now();
		entry.terminalAt = entry.updatedAt;
		if (patch?.hasFinalText !== undefined) entry.hasFinalText = patch.hasFinalText;
		if (patch?.errorCode !== undefined) entry.errorCode = patch.errorCode;
		return true;
	}

	/** Called when a runtime crashes: every non-terminal session pinned to it becomes an error. */
	markRuntimeDead(runtimeKey: string, message: string): SessionEntry[] {
		const affected: SessionEntry[] = [];
		for (const entry of this.entries.values()) {
			if (entry.runtimeKey === runtimeKey && !TERMINAL_STATUSES.has(entry.status)) {
				entry.status = "error";
				entry.errorMessage = message;
				entry.hasFinalText = false;
				entry.updatedAt = this.now();
				entry.terminalAt = entry.updatedAt;
				affected.push(entry);
			}
		}
		return affected;
	}

	isTerminal(status: SessionStatus): boolean {
		return TERMINAL_STATUSES.has(status);
	}

	/** Drops terminal entries older than pruneAfterMs. Cheap enough to call opportunistically. */
	pruneNow(): number {
		const cutoff = this.now() - this.pruneAfterMs;
		let removed = 0;
		for (const [id, entry] of this.entries) {
			if (entry.terminalAt !== undefined && entry.terminalAt < cutoff) {
				this.entries.delete(id);
				removed += 1;
			}
		}
		return removed;
	}

	size(): number {
		return this.entries.size;
	}

	/** Live session count per status, for ode_diagnostics. */
	countsByStatus(): Record<SessionStatus, number> {
		const counts: Record<SessionStatus, number> = { starting: 0, running: 0, done: 0, error: 0, cancelled: 0 };
		for (const entry of this.entries.values()) {
			counts[entry.status] += 1;
		}
		return counts;
	}
}
