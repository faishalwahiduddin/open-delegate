import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeCapacityError, RuntimeManager } from "../../src/runtimeManager.js";
import type { OpencodeRuntime, RuntimeOptions } from "../../src/runtime.js";

function makeFakeRuntime(onCrash?: RuntimeOptions["onCrash"]) {
	const runtime = {
		state: "ready" as "ready" | "dead",
		url: "http://127.0.0.1:9999",
		pid: 4242,
		client: {} as unknown,
		dispose: vi.fn(async () => {
			runtime.state = "dead";
		}),
	};
	// Allow tests to simulate a crash by calling the captured onCrash callback.
	(runtime as unknown as { __triggerCrash: () => void }).__triggerCrash = () => {
		runtime.state = "dead";
		onCrash?.({ code: 1, signal: null });
	};
	return runtime as unknown as OpencodeRuntime & { __triggerCrash: () => void };
}

describe("RuntimeManager", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("spawns exactly one runtime for repeated default acquisitions", async () => {
		const startRuntime = vi.fn(async (options: RuntimeOptions) => makeFakeRuntime(options.onCrash));
		const manager = new RuntimeManager({ startRuntime });

		const first = await manager.acquire();
		const second = await manager.acquire();

		expect(startRuntime).toHaveBeenCalledTimes(1);
		expect(first.key).toBe("default");
		expect(second.runtime).toBe(first.runtime);
	});

	it("dedupes concurrent acquisitions for the same override config while starting", async () => {
		let resolveStart!: (r: ReturnType<typeof makeFakeRuntime>) => void;
		const startRuntime = vi.fn(
			(options: RuntimeOptions) =>
				new Promise<ReturnType<typeof makeFakeRuntime>>((resolve) => {
					resolveStart = () => resolve(makeFakeRuntime(options.onCrash));
				}),
		);
		const manager = new RuntimeManager({ startRuntime: startRuntime as never });

		const config = { content: '{"model":"opencode/grok-code-fast-1"}' };
		const p1 = manager.acquire(config);
		const p2 = manager.acquire(config);
		resolveStart();
		const [r1, r2] = await Promise.all([p1, p2]);

		expect(startRuntime).toHaveBeenCalledTimes(1);
		expect(r1.key).toBe(r2.key);
		expect(r1.key).not.toBe("default");
	});

	it("enforces the runtime cap for override configs", async () => {
		const startRuntime = vi.fn(async (options: RuntimeOptions) => makeFakeRuntime(options.onCrash));
		const manager = new RuntimeManager({ startRuntime, maxRuntimes: 2 });

		await manager.acquire(); // default -> 1 runtime
		await manager.acquire({ content: "a" }); // override #1 -> 2 runtimes, at cap

		await expect(manager.acquire({ content: "b" })).rejects.toThrow(RuntimeCapacityError);
	});

	it("disposes an idle override runtime after the grace period, but not before", async () => {
		const startRuntime = vi.fn(async (options: RuntimeOptions) => makeFakeRuntime(options.onCrash));
		const manager = new RuntimeManager({ startRuntime, graceMs: 1000 });

		const { key, runtime } = await manager.acquire({ content: "a" });
		manager.release(key);

		vi.advanceTimersByTime(500);
		expect(manager.getRuntime(key)).toBe(runtime);

		vi.advanceTimersByTime(600);
		expect(runtime.dispose).toHaveBeenCalledTimes(1);
	});

	it("cancels a pending dispose if the runtime is re-acquired within the grace period", async () => {
		const startRuntime = vi.fn(async (options: RuntimeOptions) => makeFakeRuntime(options.onCrash));
		const manager = new RuntimeManager({ startRuntime, graceMs: 1000 });

		const { key, runtime } = await manager.acquire({ content: "a" });
		manager.release(key);
		vi.advanceTimersByTime(500);

		await manager.acquire({ content: "a" });
		vi.advanceTimersByTime(600);

		expect(runtime.dispose).not.toHaveBeenCalled();
	});

	it("never schedules disposal for the default runtime", async () => {
		const startRuntime = vi.fn(async (options: RuntimeOptions) => makeFakeRuntime(options.onCrash));
		const manager = new RuntimeManager({ startRuntime, graceMs: 10 });

		const { key, runtime } = await manager.acquire();
		manager.release(key);
		vi.advanceTimersByTime(10_000);

		expect(runtime.dispose).not.toHaveBeenCalled();
		expect(manager.getRuntime("default")).toBe(runtime);
	});

	it("reports a crash via onCrash and clears the runtime so the next acquire respawns", async () => {
		const startRuntime = vi.fn(async (options: RuntimeOptions) => makeFakeRuntime(options.onCrash));
		const onCrash = vi.fn();
		const manager = new RuntimeManager({ startRuntime, onCrash });

		const { key, runtime } = (await manager.acquire()) as { key: string; runtime: ReturnType<typeof makeFakeRuntime> };
		expect(manager.getRuntime(key)).toBe(runtime);

		runtime.__triggerCrash();

		expect(onCrash).toHaveBeenCalledWith("default", { code: 1, signal: null });
		expect(manager.getRuntime(key)).toBeUndefined();

		const second = await manager.acquire();
		expect(startRuntime).toHaveBeenCalledTimes(2);
		expect(second.runtime).not.toBe(runtime);
	});

	it("shutdownAll disposes every runtime and clears state", async () => {
		const startRuntime = vi.fn(async (options: RuntimeOptions) => makeFakeRuntime(options.onCrash));
		const manager = new RuntimeManager({ startRuntime });

		const a = await manager.acquire();
		const b = await manager.acquire({ content: "a" });

		await manager.shutdownAll();

		expect(a.runtime.dispose).toHaveBeenCalledTimes(1);
		expect(b.runtime.dispose).toHaveBeenCalledTimes(1);
		expect(manager.getRuntime("default")).toBeUndefined();
	});
});
