import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchTranscript, refreshSessionStatus } from "../../src/opencodeHelpers.js";
import { RuntimeManager } from "../../src/runtimeManager.js";
import { SessionRegistry } from "../../src/sessionRegistry.js";

// Exercises the real `opencode serve` process end to end (spawn, prompt, poll,
// cancel, crash-recovery) using a free hosted model, no API key required.
// Skipped automatically if the `opencode` CLI isn't on PATH.
const FREE_MODEL = { providerID: "opencode", modelID: "deepseek-v4-flash-free" };

async function isOpencodeAvailable(): Promise<boolean> {
	try {
		const { resolveOpencodeBinary } = await import("../../src/binaryResolve.js");
		resolveOpencodeBinary();
		return true;
	} catch {
		return false;
	}
}

async function waitForTerminal(
	deps: { runtimeManager: RuntimeManager; registry: SessionRegistry },
	sessionId: string,
	timeoutMs: number,
) {
	const deadline = Date.now() + timeoutMs;
	let entry = deps.registry.get(sessionId);
	if (!entry) throw new Error("session not found in registry");
	while (!deps.registry.isTerminal(entry.status) && Date.now() < deadline) {
		entry = await refreshSessionStatus(deps, entry);
		if (deps.registry.isTerminal(entry.status)) break;
		await new Promise((r) => setTimeout(r, 750));
	}
	return entry;
}

describe.runIf(await isOpencodeAvailable())("opencode integration", () => {
	let runtimeManager: RuntimeManager;
	let registry: SessionRegistry;

	beforeAll(() => {
		registry = new SessionRegistry();
		runtimeManager = new RuntimeManager({
			onCrash: (key, info) => {
				registry.markRuntimeDead(key, `process exited (code=${info.code}, signal=${info.signal})`);
			},
		});
	});

	afterAll(async () => {
		await runtimeManager.shutdownAll();
	});

	it(
		"delegates a trivial prompt to a free model and observes it complete",
		async () => {
			const { key, runtime } = await runtimeManager.acquire();

			const created = await runtime.client.session.create({ throwOnError: true });
			const sessionId = created.data.id;
			registry.create({ id: sessionId, runtimeKey: key, config: undefined, previewUrl: runtime.url });

			await runtime.client.session.promptAsync({
				path: { id: sessionId },
				body: {
					model: FREE_MODEL,
					parts: [{ type: "text", text: "Reply with exactly the single word PONG and nothing else." }],
				},
				throwOnError: true,
			});

			const finalEntry = await waitForTerminal({ runtimeManager, registry }, sessionId, 60_000);
			expect(finalEntry?.status).toBe("done");

			const { lines } = await fetchTranscript(runtime.client, sessionId, 0);
			expect(lines.join("\n").toUpperCase()).toContain("PONG");
		},
		75_000,
	);

	it(
		"cancels a running session and reflects that in the registry",
		async () => {
			const { key, runtime } = await runtimeManager.acquire();

			const created = await runtime.client.session.create({ throwOnError: true });
			const sessionId = created.data.id;
			registry.create({ id: sessionId, runtimeKey: key, config: undefined, previewUrl: runtime.url });

			await runtime.client.session.promptAsync({
				path: { id: sessionId },
				body: {
					model: FREE_MODEL,
					parts: [{ type: "text", text: "Write a very long, detailed 2000 word essay about the history of type systems." }],
				},
				throwOnError: true,
			});

			await runtime.client.session.abort({ path: { id: sessionId }, throwOnError: true });
			const finalized = registry.finalizeIfRunning(sessionId, "cancelled");
			expect(finalized).toBe(true);
			runtimeManager.release(key);

			expect(registry.get(sessionId)?.status).toBe("cancelled");
		},
		30_000,
	);

	it(
		"resumes a finished session with a follow-up prompt on the same history",
		async () => {
			const { key, runtime } = await runtimeManager.acquire();

			const created = await runtime.client.session.create({ throwOnError: true });
			const sessionId = created.data.id;
			registry.create({ id: sessionId, runtimeKey: key, config: undefined, previewUrl: runtime.url });

			await runtime.client.session.promptAsync({
				path: { id: sessionId },
				body: {
					model: FREE_MODEL,
					parts: [{ type: "text", text: 'Remember the secret code "banana77". Reply with only "OK".' }],
				},
				throwOnError: true,
			});
			const first = await waitForTerminal({ runtimeManager, registry }, sessionId, 30_000);
			expect(first?.status).toBe("done");

			// ode_resume's own logic: re-acquire the session's original runtime, then prompt again.
			const reacquired = await runtimeManager.acquire(registry.get(sessionId)?.config);
			await reacquired.runtime.client.session.promptAsync({
				path: { id: sessionId },
				body: { parts: [{ type: "text", text: "What was the secret code? Reply with just the code." }] },
				throwOnError: true,
			});
			registry.setStatus(sessionId, "running");

			const second = await waitForTerminal({ runtimeManager, registry }, sessionId, 30_000);
			expect(second?.status).toBe("done");

			const { lines } = await fetchTranscript(reacquired.runtime.client, sessionId, 0);
			expect(lines.join("\n")).toContain("banana77");
		},
		75_000,
	);

	it(
		"surfaces a bad model id as an error status rather than hanging",
		async () => {
			const { key, runtime } = await runtimeManager.acquire();

			const created = await runtime.client.session.create({ throwOnError: true });
			const sessionId = created.data.id;
			registry.create({ id: sessionId, runtimeKey: key, config: undefined, previewUrl: runtime.url });

			await runtime.client.session.promptAsync({
				path: { id: sessionId },
				body: {
					model: { providerID: "opencode", modelID: "this-model-does-not-exist" },
					parts: [{ type: "text", text: "hello" }],
				},
				throwOnError: true,
			});

			const finalEntry = await waitForTerminal({ runtimeManager, registry }, sessionId, 30_000);
			expect(finalEntry?.status).toBe("error");
			expect(finalEntry?.errorMessage).toBeTruthy();
		},
		45_000,
	);
});
