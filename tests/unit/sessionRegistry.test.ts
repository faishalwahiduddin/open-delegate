import { describe, expect, it } from "vitest";
import { SessionRegistry } from "../../src/sessionRegistry.js";

function makeClock(start = 0) {
	let current = start;
	return { now: () => current, advance: (ms: number) => (current += ms) };
}

describe("SessionRegistry", () => {
	it("creates a running entry and can look it up", () => {
		const registry = new SessionRegistry();
		registry.create({ id: "s1", runtimeKey: "default", previewUrl: "http://127.0.0.1:1234" });
		const entry = registry.get("s1");
		expect(entry?.status).toBe("running");
		expect(entry?.runtimeKey).toBe("default");
	});

	it("setStatus transitions to a terminal state and stamps terminalAt", () => {
		const clock = makeClock();
		const registry = new SessionRegistry({ now: clock.now });
		registry.create({ id: "s1", runtimeKey: "default", previewUrl: "u" });
		clock.advance(100);
		registry.setStatus("s1", "done");
		const entry = registry.get("s1");
		expect(entry?.status).toBe("done");
		expect(entry?.terminalAt).toBe(100);
	});

	it("markRuntimeDead errors every non-terminal session on that runtime, leaves others alone", () => {
		const registry = new SessionRegistry();
		registry.create({ id: "s1", runtimeKey: "default", previewUrl: "u" });
		registry.create({ id: "s2", runtimeKey: "default", previewUrl: "u" });
		registry.create({ id: "s3", runtimeKey: "other", previewUrl: "u" });
		registry.setStatus("s2", "done");

		const affected = registry.markRuntimeDead("default", "process exited unexpectedly (code 1)");

		expect(affected.map((e) => e.id)).toEqual(["s1"]);
		expect(registry.get("s1")?.status).toBe("error");
		expect(registry.get("s1")?.errorMessage).toMatch(/exited unexpectedly/);
		expect(registry.get("s2")?.status).toBe("done");
		expect(registry.get("s3")?.status).toBe("running");
	});

	it("prunes terminal entries older than pruneAfterMs but keeps running ones", () => {
		const clock = makeClock();
		const registry = new SessionRegistry({ now: clock.now, pruneAfterMs: 1000 });
		registry.create({ id: "old-done", runtimeKey: "default", previewUrl: "u" });
		registry.setStatus("old-done", "done");
		registry.create({ id: "still-running", runtimeKey: "default", previewUrl: "u" });

		clock.advance(2000);
		const removed = registry.pruneNow();

		expect(removed).toBe(1);
		expect(registry.get("old-done")).toBeUndefined();
		expect(registry.get("still-running")).toBeDefined();
	});

	it("setStatus clears terminalAt when transitioning back to running (resume), so it isn't pruned", () => {
		const clock = makeClock();
		const registry = new SessionRegistry({ now: clock.now, pruneAfterMs: 1000 });
		registry.create({ id: "s1", runtimeKey: "default", previewUrl: "u" });
		registry.setStatus("s1", "done");

		clock.advance(100);
		registry.setStatus("s1", "running");

		clock.advance(2000);
		registry.pruneNow();

		expect(registry.get("s1")?.status).toBe("running");
	});

	it("finalizeIfRunning only transitions once, guarding against double release", () => {
		const registry = new SessionRegistry();
		registry.create({ id: "s1", runtimeKey: "default", previewUrl: "u" });

		const first = registry.finalizeIfRunning("s1", "done");
		const second = registry.finalizeIfRunning("s1", "error", "should not apply");

		expect(first).toBe(true);
		expect(second).toBe(false);
		expect(registry.get("s1")?.status).toBe("done");
		expect(registry.get("s1")?.errorMessage).toBeUndefined();
	});

	it("finalizeIfRunning merges hasFinalText and answer patches", () => {
		const registry = new SessionRegistry();
		registry.create({ id: "s1", runtimeKey: "default", previewUrl: "u" });

		const ok = registry.finalizeIfRunning("s1", "done", undefined, {
			hasFinalText: true,
			answer: "hello",
		});

		expect(ok).toBe(true);
		expect(registry.get("s1")?.hasFinalText).toBe(true);
		expect(registry.get("s1")?.answer).toBe("hello");
	});

	it("finalizeIfRunning stores errorCode from the patch", () => {
		const registry = new SessionRegistry();
		registry.create({ id: "s1", runtimeKey: "default", previewUrl: "u" });

		const ok = registry.finalizeIfRunning("s1", "error", "ProviderAuthError: out of credits", {
			hasFinalText: false,
			errorCode: "PROVIDER_AUTH",
		});

		expect(ok).toBe(true);
		expect(registry.get("s1")?.errorCode).toBe("PROVIDER_AUTH");
	});

	it("setStatus clears hasFinalText and answer when transitioning back to running", () => {
		const registry = new SessionRegistry();
		registry.create({ id: "s1", runtimeKey: "default", previewUrl: "u" });
		registry.finalizeIfRunning("s1", "done", undefined, { hasFinalText: true, answer: "x" });

		registry.setStatus("s1", "running");

		expect(registry.get("s1")?.hasFinalText).toBeUndefined();
		expect(registry.get("s1")?.answer).toBeUndefined();
	});

	it("markRuntimeDead sets hasFinalText false on affected sessions", () => {
		const registry = new SessionRegistry();
		registry.create({ id: "s1", runtimeKey: "default", previewUrl: "u" });

		registry.markRuntimeDead("default", "process exited unexpectedly (code 1)");

		expect(registry.get("s1")?.hasFinalText).toBe(false);
	});

	it("createPending starts in status starting with no runtime/opencode id yet", () => {
		const registry = new SessionRegistry();
		const entry = registry.createPending({ id: "pending-1" });

		expect(entry.status).toBe("starting");
		expect(entry.runtimeKey).toBeUndefined();
		expect(entry.opencodeSessionId).toBeUndefined();
	});

	it("attachRuntime flips starting -> running and fills in runtime/opencode id", () => {
		const registry = new SessionRegistry();
		registry.createPending({ id: "s1" });

		const attached = registry.attachRuntime("s1", {
			runtimeKey: "default",
			opencodeSessionId: "oc-1",
			previewUrl: "http://x",
		});

		expect(attached).toBe(true);
		const entry = registry.get("s1");
		expect(entry?.status).toBe("running");
		expect(entry?.opencodeSessionId).toBe("oc-1");
	});

	it("attachRuntime is a no-op once the entry is no longer starting", () => {
		const registry = new SessionRegistry();
		registry.createPending({ id: "s1" });
		registry.setStatus("s1", "cancelled");

		const attached = registry.attachRuntime("s1", {
			runtimeKey: "default",
			opencodeSessionId: "oc-1",
			previewUrl: "http://x",
		});

		expect(attached).toBe(false);
		expect(registry.get("s1")?.status).toBe("cancelled");
	});

	it("failStarting flips starting -> error with message and code", () => {
		const registry = new SessionRegistry();
		registry.createPending({ id: "s1" });

		const failed = registry.failStarting("s1", "boom", "RUNTIME_STARTUP_FAILED");

		expect(failed).toBe(true);
		expect(registry.get("s1")?.errorCode).toBe("RUNTIME_STARTUP_FAILED");
		expect(registry.get("s1")?.hasFinalText).toBe(false);
	});

	it("countsByStatus includes a starting bucket", () => {
		const registry = new SessionRegistry();
		registry.createPending({ id: "s1" });
		registry.create({ id: "s2", runtimeKey: "default", previewUrl: "u" });

		expect(registry.countsByStatus()).toEqual({ starting: 1, running: 1, done: 0, error: 0, cancelled: 0 });
	});

	it("setCurrentActivity updates a live session", () => {
		const registry = new SessionRegistry();
		registry.create({ id: "s1", runtimeKey: "default", previewUrl: "u" });

		registry.setCurrentActivity("s1", "tool:bash ls");

		expect(registry.get("s1")?.currentActivity).toBe("tool:bash ls");
	});

	it("setCurrentActivity is a no-op on terminal sessions", () => {
		const registry = new SessionRegistry();
		registry.create({ id: "s1", runtimeKey: "default", previewUrl: "u" });
		registry.finalizeIfRunning("s1", "done");

		registry.setCurrentActivity("s1", "tool:bash ls");

		expect(registry.get("s1")?.currentActivity).toBeUndefined();
	});

	it("finalizeIfRunning clears currentActivity", () => {
		const registry = new SessionRegistry();
		registry.create({ id: "s1", runtimeKey: "default", previewUrl: "u" });
		registry.setCurrentActivity("s1", "thinking");

		registry.finalizeIfRunning("s1", "done");

		expect(registry.get("s1")?.currentActivity).toBeUndefined();
	});

	it("failStarting clears currentActivity", () => {
		const registry = new SessionRegistry();
		registry.createPending({ id: "s1" });
		registry.setCurrentActivity("s1", "thinking");

		registry.failStarting("s1", "boom", "RUNTIME_STARTUP_FAILED");

		expect(registry.get("s1")?.currentActivity).toBeUndefined();
	});

	it("markRuntimeDead clears currentActivity on affected sessions", () => {
		const registry = new SessionRegistry();
		registry.create({ id: "s1", runtimeKey: "default", previewUrl: "u" });
		registry.setCurrentActivity("s1", "tool:read");

		registry.markRuntimeDead("default", "process exited unexpectedly (code 1)");

		expect(registry.get("s1")?.currentActivity).toBeUndefined();
	});
});
