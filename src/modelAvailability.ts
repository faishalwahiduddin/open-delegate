import type { OpencodeClient } from "@opencode-ai/sdk";
import type { ModelSpec } from "./modelSpec.js";

const DEFAULT_CACHE_TTL_MS = 60_000;

export interface ProviderModelInfo {
	id: string;
	providerID: string;
	modelID: string;
	toolCall?: boolean;
	costInput?: number;
	costOutput?: number;
	status?: string;
	experimental?: boolean;
}

export interface ProviderSnapshot {
	/** All known provider/model ids from the runtime catalog. */
	allIds: Set<string>;
	/** Provider ids that currently have live auth (`connected`). */
	connectedProviders: Set<string>;
	/** Flat list of connected provider/model ids (model's provider is connected). */
	connectedIds: string[];
	/** Richer model info for refresh tooling. */
	models: ProviderModelInfo[];
	fetchedAt: number;
}

export class ModelNotAvailableError extends Error {
	readonly reason: "unknown_model" | "provider_not_connected";

	constructor(id: string, reason: "unknown_model" | "provider_not_connected") {
		const message =
			reason === "unknown_model"
				? `Model "${id}" is not in the OpenCode runtime catalog (unknown or misspelled provider/model id).`
				: `Model "${id}" exists in the catalog but its provider is not connected (missing/invalid API key or auth).`;
		super(message);
		this.name = "ModelNotAvailableError";
		this.reason = reason;
	}
}

export type AvailabilityResult =
	| { ok: true }
	| { ok: false; reason: "unknown_model" | "provider_not_connected" };

/** Check a resolved model against a provider snapshot. */
export function checkModelAvailable(spec: ModelSpec, snapshot: ProviderSnapshot): AvailabilityResult {
	const id = `${spec.providerID}/${spec.modelID}`;
	if (!snapshot.allIds.has(id)) {
		return { ok: false, reason: "unknown_model" };
	}
	if (!snapshot.connectedProviders.has(spec.providerID)) {
		return { ok: false, reason: "provider_not_connected" };
	}
	return { ok: true };
}

function modelIdFromProvider(providerID: string, modelKey: string, model: { id?: string }): string {
	// OpenCode keys models under short keys; full id for openrouter is often "org/model".
	const rawId = typeof model.id === "string" && model.id.length > 0 ? model.id : modelKey;
	return `${providerID}/${rawId}`;
}

/** Parse a raw provider.list() response into a ProviderSnapshot. */
export function parseProviderListResponse(data: {
	all?: Array<{
		id: string;
		models?: Record<
			string,
			{
				id?: string;
				tool_call?: boolean;
				cost?: { input?: number; output?: number };
				status?: string;
				experimental?: boolean;
			}
		>;
	}>;
	connected?: string[];
}): ProviderSnapshot {
	const allIds = new Set<string>();
	const models: ProviderModelInfo[] = [];
	const connectedProviders = new Set(data.connected ?? []);

	for (const provider of data.all ?? []) {
		const providerID = provider.id;
		for (const [modelKey, model] of Object.entries(provider.models ?? {})) {
			const id = modelIdFromProvider(providerID, modelKey, model);
			allIds.add(id);
			const slash = id.indexOf("/");
			models.push({
				id,
				providerID: id.slice(0, slash),
				modelID: id.slice(slash + 1),
				toolCall: model.tool_call,
				costInput: model.cost?.input,
				costOutput: model.cost?.output,
				status: model.status,
				experimental: model.experimental,
			});
		}
	}

	const connectedIds = models.filter((m) => connectedProviders.has(m.providerID)).map((m) => m.id);

	return {
		allIds,
		connectedProviders,
		connectedIds,
		models,
		fetchedAt: Date.now(),
	};
}

export interface ModelAvailabilityCacheOptions {
	ttlMs?: number;
	now?: () => number;
}

/**
 * Cached wrapper around `client.provider.list()`. The default runtime is
 * long-lived and pre-warmed, so a ~60s TTL keeps availability checks nearly free.
 */
export class ModelAvailabilityCache {
	private snapshot: ProviderSnapshot | undefined;
	private readonly ttlMs: number;
	private readonly now: () => number;

	constructor(options: ModelAvailabilityCacheOptions = {}) {
		this.ttlMs = options.ttlMs ?? DEFAULT_CACHE_TTL_MS;
		this.now = options.now ?? Date.now;
	}

	invalidate(): void {
		this.snapshot = undefined;
	}

	getCached(): ProviderSnapshot | undefined {
		if (!this.snapshot) return undefined;
		if (this.now() - this.snapshot.fetchedAt > this.ttlMs) return undefined;
		return this.snapshot;
	}

	async getSnapshot(client: OpencodeClient): Promise<ProviderSnapshot> {
		const cached = this.getCached();
		if (cached) return cached;

		const res = await client.provider.list({ throwOnError: true });
		const data = res.data as {
			all?: Array<{
				id: string;
				models?: Record<
					string,
					{
						id?: string;
						tool_call?: boolean;
						cost?: { input?: number; output?: number };
						status?: string;
						experimental?: boolean;
					}
				>;
			}>;
			connected?: string[];
		};
		const snapshot = parseProviderListResponse(data);
		snapshot.fetchedAt = this.now();
		this.snapshot = snapshot;
		return this.snapshot;
	}

	/** Best-effort; returns undefined if the call fails (caller should proceed without the fast-fail). */
	async tryGetSnapshot(client: OpencodeClient): Promise<ProviderSnapshot | undefined> {
		try {
			return await this.getSnapshot(client);
		} catch {
			return undefined;
		}
	}
}
