import type { ConfigOverride } from "./configSpec.js";

export type SessionStatus = "running" | "done" | "error" | "cancelled";

export interface SessionEntry {
	id: string;
	runtimeKey: string;
	config: ConfigOverride | undefined;
	previewUrl: string;
	status: SessionStatus;
	createdAt: number;
	updatedAt: number;
	terminalAt: number | undefined;
	errorMessage: string | undefined;
}

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

	create(params: { id: string; runtimeKey: string; config: ConfigOverride | undefined; previewUrl: string }): SessionEntry {
		this.pruneNow();
		const timestamp = this.now();
		const entry: SessionEntry = {
			id: params.id,
			runtimeKey: params.runtimeKey,
			config: params.config,
			previewUrl: params.previewUrl,
			status: "running",
			createdAt: timestamp,
			updatedAt: timestamp,
			terminalAt: undefined,
			errorMessage: undefined,
		};
		this.entries.set(params.id, entry);
		return entry;
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
		return entry;
	}

	/**
	 * Synchronous compare-and-set: only transitions to a terminal status if the
	 * entry is still "running". Safe to call from multiple concurrent pollers
	 * (ode_status/ode_await) without double-finalizing, since there is no
	 * `await` between the check and the mutation.
	 */
	finalizeIfRunning(id: string, status: SessionStatus, errorMessage?: string): boolean {
		const entry = this.entries.get(id);
		if (!entry || entry.status !== "running") return false;
		entry.status = status;
		entry.errorMessage = errorMessage;
		entry.updatedAt = this.now();
		entry.terminalAt = entry.updatedAt;
		return true;
	}

	/** Called when a runtime crashes: every non-terminal session pinned to it becomes an error. */
	markRuntimeDead(runtimeKey: string, message: string): SessionEntry[] {
		const affected: SessionEntry[] = [];
		for (const entry of this.entries.values()) {
			if (entry.runtimeKey === runtimeKey && !TERMINAL_STATUSES.has(entry.status)) {
				entry.status = "error";
				entry.errorMessage = message;
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
}
