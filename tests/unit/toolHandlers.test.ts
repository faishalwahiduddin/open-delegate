import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { DelegateContext } from "../../src/context.js";
import { Logger } from "../../src/log.js";
import { loadModelPolicy } from "../../src/modelPolicy.js";
import { RuntimeManager } from "../../src/runtimeManager.js";
import { SessionRegistry } from "../../src/sessionRegistry.js";
import { registerOdeAwait } from "../../src/tools/await.js";
import { registerOdeCancel } from "../../src/tools/cancel.js";
import { registerOdeDelegate } from "../../src/tools/delegate.js";
import { registerOdeDiagnostics } from "../../src/tools/diagnostics.js";
import { registerOdeResume } from "../../src/tools/resume.js";
import { registerOdeStatus } from "../../src/tools/status.js";
import { registerOdeTranscript } from "../../src/tools/transcript.js";

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>;

function fakeServer(): { server: McpServer; handlers: Map<string, Handler> } {
	const handlers = new Map<string, Handler>();
	const server = {
		registerTool: (name: string, _config: unknown, handler: Handler) => {
			handlers.set(name, handler);
		},
	} as unknown as McpServer;
	return { server, handlers };
}

function parse(result: CallToolResult): Record<string, unknown> {
	return JSON.parse(result.content[0]!.text as string) as Record<string, unknown>;
}

let dir: string;
let ctx: DelegateContext;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "ode-tools-test-"));
	ctx = {
		runtimeManager: new RuntimeManager(),
		registry: new SessionRegistry(),
		modelPolicy: loadModelPolicy({}),
		logger: new Logger({ logDir: dir, write: () => {} }),
		version: "0.0.0-test",
	};
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("unknown sessionId -> SESSION_NOT_FOUND envelope", () => {
	const cases: Array<[string, (server: McpServer, ctx: DelegateContext) => void, Record<string, unknown>]> = [
		["ode_status", registerOdeStatus, { sessionId: "nope" }],
		["ode_await", registerOdeAwait, { sessionId: "nope", timeoutMs: 1000 }],
		["ode_cancel", registerOdeCancel, { sessionId: "nope" }],
		["ode_transcript", registerOdeTranscript, { sessionId: "nope" }],
		["ode_resume", registerOdeResume, { sessionId: "nope", prompt: "hi" }],
	];

	for (const [name, register, args] of cases) {
		it(`${name} returns a coded, fixable error for an unknown session`, async () => {
			const { server, handlers } = fakeServer();
			register(server, ctx);
			const result = await handlers.get(name)!(args);
			expect(result.isError).toBe(true);
			const envelope = parse(result);
			expect(envelope).toMatchObject({ ok: false, code: "SESSION_NOT_FOUND" });
			expect(typeof envelope.fix).toBe("string");
		});
	}
});

describe("ode_resume", () => {
	it("returns SESSION_NOT_TERMINAL when the session is still running", async () => {
		ctx.registry.create({ id: "s1", runtimeKey: "default", config: undefined, previewUrl: "http://x" });
		const { server, handlers } = fakeServer();
		registerOdeResume(server, ctx);

		const result = await handlers.get("ode_resume")!({ sessionId: "s1", prompt: "follow up" });

		expect(result.isError).toBe(true);
		expect(parse(result)).toMatchObject({ code: "SESSION_NOT_TERMINAL" });
	});
});

describe("ode_delegate", () => {
	it("rejects a malformed model before ever touching the runtime manager", async () => {
		const acquireCalls: unknown[] = [];
		ctx.runtimeManager = {
			acquire: async (config?: unknown) => {
				acquireCalls.push(config);
				throw new Error("should not be called");
			},
		} as unknown as RuntimeManager;

		const { server, handlers } = fakeServer();
		registerOdeDelegate(server, ctx);

		const result = await handlers.get("ode_delegate")!({ prompt: "hi", model: "noslash" });

		expect(result.isError).toBe(true);
		expect(parse(result)).toMatchObject({ code: "INVALID_MODEL" });
		expect(acquireCalls).toHaveLength(0);
	});

	it("suggests known-good models when the id is disallowed", async () => {
		const { server, handlers } = fakeServer();
		registerOdeDelegate(server, ctx);

		const result = await handlers.get("ode_delegate")!({ prompt: "hi", model: "anthropic/claude-opus-5" });

		const envelope = parse(result);
		expect(envelope.code).toBe("MODEL_NOT_ALLOWED");
		expect(envelope.hint).toMatch(/opencode\/|openrouter\//);
	});
});

describe("ode_await", () => {
	it('returns status "running" once timeoutMs elapses without the session reaching a terminal state', async () => {
		ctx.registry.create({ id: "s1", runtimeKey: "default", config: undefined, previewUrl: "http://x" });
		const busyClient = {
			session: {
				status: async () => ({ data: { s1: { type: "busy" } } }),
				messages: async () => ({ data: [] }),
			},
		};
		ctx.runtimeManager = {
			getRuntime: () => ({ client: busyClient, state: "ready", url: "http://x" }),
			release: () => {},
		} as unknown as RuntimeManager;

		const { server, handlers } = fakeServer();
		registerOdeAwait(server, ctx);

		const result = await handlers.get("ode_await")!({ sessionId: "s1", timeoutMs: 1000 });

		expect(result.isError).toBeFalsy();
		expect(parse(result)).toMatchObject({ sessionId: "s1", status: "running" });
	});
});

describe("ode_diagnostics", () => {
	it("reports pid, version, log paths, empty runtimes, and zeroed session counts", async () => {
		const { server, handlers } = fakeServer();
		registerOdeDiagnostics(server, ctx);

		const result = await handlers.get("ode_diagnostics")!({});
		const snapshot = parse(result);

		expect(snapshot.mcpPid).toBe(process.pid);
		expect(snapshot.version).toBe("0.0.0-test");
		expect(snapshot.logDir).toBe(dir);
		expect(snapshot.runtimes).toEqual([]);
		expect(snapshot.sessionCounts).toEqual({ starting: 0, running: 0, done: 0, error: 0, cancelled: 0 });
		expect(Array.isArray(snapshot.recentEvents)).toBe(true);
	});
});
