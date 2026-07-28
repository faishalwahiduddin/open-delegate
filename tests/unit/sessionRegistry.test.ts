import { describe, expect, it } from "vitest";
import { SessionRegistry } from "../../src/sessionRegistry.js";

function makeClock(start = 0) {
	let current = start;
	return { now: () => current, advance: (ms: number) => (current += ms) };
}

describe("SessionRegistry", () => {
	it("creates a running entry and can look it up", () => {
		const registry = new SessionRegistry();
		registry.create({ id: "s1", runtimeKey: "default", config: undefined, previewUrl: "http://127.0.0.1:1234" });
		const entry = registry.get("s1");
		expect(entry?.status).toBe("running");
		expect(entry?.runtimeKey).toBe("default");
	});

	it("setStatus transitions to a terminal state and stamps terminalAt", () => {
		const clock = makeClock();
		const registry = new SessionRegistry({ now: clock.now });
		registry.create({ id: "s1", runtimeKey: "default", config: undefined, previewUrl: "u" });
		clock.advance(100);
		registry.setStatus("s1", "done");
		const entry = registry.get("s1");
		expect(entry?.status).toBe("done");
		expect(entry?.terminalAt).toBe(100);
	});

	it("markRuntimeDead errors every non-terminal session on that runtime, leaves others alone", () => {
		const registry = new SessionRegistry();
		registry.create({ id: "s1", runtimeKey: "override:abc", config: undefined, previewUrl: "u" });
		registry.create({ id: "s2", runtimeKey: "override:abc", config: undefined, previewUrl: "u" });
		registry.create({ id: "s3", runtimeKey: "default", config: undefined, previewUrl: "u" });
		registry.setStatus("s2", "done");

		const affected = registry.markRuntimeDead("override:abc", "process exited unexpectedly (code 1)");

		expect(affected.map((e) => e.id)).toEqual(["s1"]);
		expect(registry.get("s1")?.status).toBe("error");
		expect(registry.get("s1")?.errorMessage).toMatch(/exited unexpectedly/);
		expect(registry.get("s2")?.status).toBe("done");
		expect(registry.get("s3")?.status).toBe("running");
	});

	it("prunes terminal entries older than pruneAfterMs but keeps running ones", () => {
		const clock = makeClock();
		const registry = new SessionRegistry({ now: clock.now, pruneAfterMs: 1000 });
		registry.create({ id: "old-done", runtimeKey: "default", config: undefined, previewUrl: "u" });
		registry.setStatus("old-done", "done");
		registry.create({ id: "still-running", runtimeKey: "default", config: undefined, previewUrl: "u" });

		clock.advance(2000);
		const removed = registry.pruneNow();

		expect(removed).toBe(1);
		expect(registry.get("old-done")).toBeUndefined();
		expect(registry.get("still-running")).toBeDefined();
	});

	it("setStatus clears terminalAt when transitioning back to running (resume), so it isn't pruned", () => {
		const clock = makeClock();
		const registry = new SessionRegistry({ now: clock.now, pruneAfterMs: 1000 });
		registry.create({ id: "s1", runtimeKey: "default", config: undefined, previewUrl: "u" });
		registry.setStatus("s1", "done");

		clock.advance(100);
		registry.setStatus("s1", "running"); // ode_resume

		clock.advance(2000); // well past pruneAfterMs from the original "done"
		registry.pruneNow();

		expect(registry.get("s1")?.status).toBe("running");
	});

	it("finalizeIfRunning only transitions once, guarding against double release", () => {
		const registry = new SessionRegistry();
		registry.create({ id: "s1", runtimeKey: "default", config: undefined, previewUrl: "u" });

		const first = registry.finalizeIfRunning("s1", "done");
		const second = registry.finalizeIfRunning("s1", "error", "should not apply");

		expect(first).toBe(true);
		expect(second).toBe(false);
		expect(registry.get("s1")?.status).toBe("done");
		expect(registry.get("s1")?.errorMessage).toBeUndefined();
	});

	it("does not prune a terminal entry before its grace period elapses", () => {
		const clock = makeClock();
		const registry = new SessionRegistry({ now: clock.now, pruneAfterMs: 1000 });
		registry.create({ id: "s1", runtimeKey: "default", config: undefined, previewUrl: "u" });
		registry.setStatus("s1", "error", "boom");

		clock.advance(500);
		registry.pruneNow();

		expect(registry.get("s1")).toBeDefined();
	});
});
