import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeManager } from "../../src/runtimeManager.js";
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

	it("dedupes concurrent acquisitions while starting", async () => {
		let resolveStart!: (r: ReturnType<typeof makeFakeRuntime>) => void;
		const startRuntime = vi.fn(
			(options: RuntimeOptions) =>
				new Promise<ReturnType<typeof makeFakeRuntime>>((resolve) => {
					resolveStart = () => resolve(makeFakeRuntime(options.onCrash));
				}),
		);
		const manager = new RuntimeManager({ startRuntime: startRuntime as never });

		const p1 = manager.acquire();
		const p2 = manager.acquire();
		resolveStart();
		const [r1, r2] = await Promise.all([p1, p2]);

		expect(startRuntime).toHaveBeenCalledTimes(1);
		expect(r1.key).toBe(r2.key);
		expect(r1.key).toBe("default");
	});

	it("never schedules disposal for the default runtime", async () => {
		const startRuntime = vi.fn(async (options: RuntimeOptions) => makeFakeRuntime(options.onCrash));
		const manager = new RuntimeManager({ startRuntime });

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

		expect(onCrash).toHaveBeenCalledWith("default", { code: 1, signal: null, pid: 4242 });
		expect(manager.getRuntime(key)).toBeUndefined();

		const second = await manager.acquire();
		expect(startRuntime).toHaveBeenCalledTimes(2);
		expect(second.runtime).not.toBe(runtime);
	});

	it("shutdownAll disposes the runtime and clears state", async () => {
		const startRuntime = vi.fn(async (options: RuntimeOptions) => makeFakeRuntime(options.onCrash));
		const manager = new RuntimeManager({ startRuntime });

		const a = await manager.acquire();

		await manager.shutdownAll();

		expect(a.runtime.dispose).toHaveBeenCalledTimes(1);
		expect(manager.getRuntime("default")).toBeUndefined();
	});

	it("getRuntime ignores unknown keys", async () => {
		const startRuntime = vi.fn(async (options: RuntimeOptions) => makeFakeRuntime(options.onCrash));
		const manager = new RuntimeManager({ startRuntime });
		await manager.acquire();
		expect(manager.getRuntime("override:abc")).toBeUndefined();
		expect(manager.getRuntime(undefined)).toBeUndefined();
	});
});
