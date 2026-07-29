import { describe, expect, it, vi } from "vitest";
import {
	checkModelAvailable,
	ModelAvailabilityCache,
	parseProviderListResponse,
} from "../../src/modelAvailability.js";

describe("parseProviderListResponse", () => {
	it("builds allIds and connectedIds from the SDK shape", () => {
		const snapshot = parseProviderListResponse({
			all: [
				{
					id: "opencode",
					models: {
						"deepseek-v4-flash-free": { id: "deepseek-v4-flash-free", tool_call: true, cost: { input: 0, output: 0 } },
					},
				},
				{
					id: "openrouter",
					models: {
						"z-ai/glm-5.2": { id: "z-ai/glm-5.2", tool_call: true },
					},
				},
			],
			connected: ["opencode"],
		});

		expect(snapshot.allIds.has("opencode/deepseek-v4-flash-free")).toBe(true);
		expect(snapshot.allIds.has("openrouter/z-ai/glm-5.2")).toBe(true);
		expect(snapshot.connectedProviders.has("opencode")).toBe(true);
		expect(snapshot.connectedProviders.has("openrouter")).toBe(false);
		expect(snapshot.connectedIds).toEqual(["opencode/deepseek-v4-flash-free"]);
	});
});

describe("checkModelAvailable", () => {
	const snapshot = parseProviderListResponse({
		all: [
			{ id: "opencode", models: { "deepseek-v4-flash-free": { id: "deepseek-v4-flash-free" } } },
			{ id: "openrouter", models: { "z-ai/glm-5.2": { id: "z-ai/glm-5.2" } } },
		],
		connected: ["opencode"],
	});

	it("accepts a connected known model", () => {
		expect(checkModelAvailable({ providerID: "opencode", modelID: "deepseek-v4-flash-free" }, snapshot)).toEqual({
			ok: true,
		});
	});

	it("rejects an unknown model", () => {
		expect(checkModelAvailable({ providerID: "opencode", modelID: "nope" }, snapshot)).toEqual({
			ok: false,
			reason: "unknown_model",
		});
	});

	it("rejects a known model whose provider is not connected", () => {
		expect(checkModelAvailable({ providerID: "openrouter", modelID: "z-ai/glm-5.2" }, snapshot)).toEqual({
			ok: false,
			reason: "provider_not_connected",
		});
	});
});

describe("ModelAvailabilityCache", () => {
	it("caches provider.list within the TTL", async () => {
		let now = 1_000;
		const list = vi.fn(async () => ({
			data: {
				all: [{ id: "opencode", models: { a: { id: "a" } } }],
				connected: ["opencode"],
			},
		}));
		const cache = new ModelAvailabilityCache({ ttlMs: 60_000, now: () => now });
		const client = { provider: { list } } as never;

		const a = await cache.getSnapshot(client);
		const b = await cache.getSnapshot(client);
		expect(list).toHaveBeenCalledTimes(1);
		expect(a).toBe(b);

		now += 61_000;
		await cache.getSnapshot(client);
		expect(list).toHaveBeenCalledTimes(2);
	});

	it("tryGetSnapshot returns undefined on failure", async () => {
		const cache = new ModelAvailabilityCache();
		const client = {
			provider: {
				list: async () => {
					throw new Error("boom");
				},
			},
		} as never;
		expect(await cache.tryGetSnapshot(client)).toBeUndefined();
	});
});
