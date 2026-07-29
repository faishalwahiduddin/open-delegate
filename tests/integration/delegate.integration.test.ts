import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DelegateContext } from "../../src/context.js";
import { Logger } from "../../src/log.js";
import { loadModelPolicy } from "../../src/modelPolicy.js";
import { fetchTranscript, refreshSessionStatus } from "../../src/opencodeHelpers.js";
import { RuntimeManager } from "../../src/runtimeManager.js";
import { SessionRegistry } from "../../src/sessionRegistry.js";
import { registerOdeDelegate } from "../../src/tools/delegate.js";

type ToolHandler = (args: Record<string, unknown>) => Promise<CallToolResult>;

function fakeServer(): { server: McpServer; handlers: Map<string, ToolHandler> } {
	const handlers = new Map<string, ToolHandler>();
	const server = {
		registerTool: (name: string, _config: unknown, handler: ToolHandler) => {
			handlers.set(name, handler);
		},
	} as unknown as McpServer;
	return { server, handlers };
}

/**
 * Terminates the given pid (and its process tree on Windows) as if it had crashed on
 * its own. Best-effort: `taskkill /T` can report a non-zero exit if some grandchild
 * is unkillable, but the tracked child itself (what fires our own "exit" listener)
 * still dies - so we don't throw on a non-zero status here, mirroring runtime.ts's
 * own killProcessTree.
 */
function forceKill(pid: number): void {
	if (process.platform === "win32") {
		spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
	} else {
		process.kill(pid, "SIGKILL");
	}
}

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
			// Mirrors src/index.ts's own wiring so this test proves the real crash-recovery message shape.
			onCrash: (key, info) => {
				const message = `opencode server process exited unexpectedly (code=${info.code ?? "null"}, signal=${info.signal ?? "null"}).`;
				registry.markRuntimeDead(key, message);
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

	it(
		"marks a running session as terminal error when its opencode server process is killed out-of-band",
		async () => {
			const { key, runtime } = await runtimeManager.acquire();
			expect(runtime.pid).toBeDefined();

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

			// Simulate a real crash (OOM-kill, user taskkill, ...) rather than our own clean dispose() path.
			forceKill(runtime.pid as number);

			const finalEntry = await waitForTerminal({ runtimeManager, registry }, sessionId, 15_000);
			expect(finalEntry?.status).toBe("error");
			expect(finalEntry?.errorMessage).toMatch(/process exited unexpectedly/);
		},
		30_000,
	);
});

describe.runIf(await isOpencodeAvailable())("ode_delegate tool: oversized prompt rejection (no wasted spawn)", () => {
	let dir: string;
	let ctx: DelegateContext;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "ode-delegate-oversized-"));
		ctx = {
			runtimeManager: new RuntimeManager(),
			registry: new SessionRegistry(),
			modelPolicy: loadModelPolicy({}),
			logger: new Logger({ logDir: dir, write: () => {} }),
			version: "0.0.0-test",
		};
	});

	afterEach(async () => {
		await ctx.runtimeManager.shutdownAll();
		rmSync(dir, { recursive: true, force: true });
	});

	it(
		"rejects an oversized inline prompt through the real registered tool handler before ever touching opencode",
		async () => {
			const { server, handlers } = fakeServer();
			registerOdeDelegate(server, ctx);

			const huge = "x".repeat(512 * 1024 + 1);
			const result = await handlers.get("ode_delegate")!({ prompt: huge, model: FREE_MODEL.providerID + "/" + FREE_MODEL.modelID });

			expect(result.isError).toBe(true);
			const envelope = JSON.parse(result.content[0]!.text as string);
			expect(envelope.code).toBe("PROMPT_TOO_LARGE");

			// The whole point of the local size check: no opencode server should ever have been spawned for this call.
			expect(ctx.runtimeManager.snapshot()).toHaveLength(0);
		},
		15_000,
	);
});
