import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { DelegateContext } from "../../src/context.js";
import { Logger } from "../../src/log.js";
import { loadModelPolicy } from "../../src/modelPolicy.js";
import { RuntimeManager } from "../../src/runtimeManager.js";
import { SessionRegistry } from "../../src/sessionRegistry.js";
import { registerOdeDelegate } from "../../src/tools/delegate.js";

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

function fakeRuntime(overrides: { createFails?: boolean; promptFails?: boolean } = {}) {
	return {
		pid: 4321,
		url: "http://127.0.0.1:1",
		client: {
			session: {
				create: vi.fn(async () => {
					if (overrides.createFails) throw new Error("create boom");
					return { data: { id: "oc-session-1" } };
				}),
				promptAsync: vi.fn(async () => {
					if (overrides.promptFails) throw new Error("prompt boom");
					return {};
				}),
				abort: vi.fn(async () => ({})),
			},
		},
	};
}

let dir: string;
let ctx: DelegateContext;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "ode-delegate-async-test-"));
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

describe("ode_delegate async setup (returns before acquire resolves)", () => {
	it('returns status "starting" once the return-grace window elapses, then the registry flips to "running" when setup finishes', async () => {
		let resolveAcquire!: (v: { key: string; runtime: ReturnType<typeof fakeRuntime> }) => void;
		const runtime = fakeRuntime();
		ctx.runtimeManager = {
			acquire: vi.fn(() => new Promise((resolve) => { resolveAcquire = resolve; })),
			release: vi.fn(),
			getRuntime: vi.fn(() => runtime),
		} as unknown as RuntimeManager;

		const { server, handlers } = fakeServer();
		registerOdeDelegate(server, ctx, { returnGraceMs: 10, setupTimeoutMs: 5000 });

		const result = await handlers.get("ode_delegate")!({ prompt: "hi", model: "opencode/deepseek-v4-flash-free" });
		expect(result.isError).toBeFalsy();
		const envelope = parse(result);
		expect(envelope.status).toBe("starting");
		const sessionId = envelope.sessionId as string;

		expect(ctx.registry.get(sessionId)?.status).toBe("starting");

		resolveAcquire({ key: "default", runtime });
		await vi.waitFor(() => expect(ctx.registry.get(sessionId)?.status).toBe("running"));

		const entry = ctx.registry.get(sessionId);
		expect(entry?.opencodeSessionId).toBe("oc-session-1");
		expect(entry?.runtimeKey).toBe("default");
	});

	it("returns running synchronously on the warm path (acquire resolves well within the grace window)", async () => {
		const runtime = fakeRuntime();
		ctx.runtimeManager = {
			acquire: vi.fn(async () => ({ key: "default", runtime })),
			release: vi.fn(),
			getRuntime: vi.fn(() => runtime),
		} as unknown as RuntimeManager;

		const { server, handlers } = fakeServer();
		registerOdeDelegate(server, ctx, { returnGraceMs: 2500, setupTimeoutMs: 5000 });

		const result = await handlers.get("ode_delegate")!({ prompt: "hi" });
		const envelope = parse(result);
		expect(envelope.status).toBe("running");
		expect(envelope.runtimeKey).toBe("default");
		expect(envelope.opencodePid).toBe(4321);
	});

	it("surfaces a session.create failure with its original code once setup finishes within the grace window", async () => {
		const runtime = fakeRuntime({ createFails: true });
		ctx.runtimeManager = {
			acquire: vi.fn(async () => ({ key: "default", runtime })),
			release: vi.fn(),
			getRuntime: vi.fn(() => runtime),
		} as unknown as RuntimeManager;

		const { server, handlers } = fakeServer();
		registerOdeDelegate(server, ctx, { returnGraceMs: 2500, setupTimeoutMs: 5000 });

		const result = await handlers.get("ode_delegate")!({ prompt: "hi" });
		expect(result.isError).toBe(true);
		expect(parse(result)).toMatchObject({ code: "SESSION_CREATE_FAILED" });
	});

	it("discards (aborts + releases) a session that finishes setup after being cancelled while starting", async () => {
		let resolveAcquire!: (v: { key: string; runtime: ReturnType<typeof fakeRuntime> }) => void;
		const runtime = fakeRuntime();
		const release = vi.fn();
		ctx.runtimeManager = {
			acquire: vi.fn(() => new Promise((resolve) => { resolveAcquire = resolve; })),
			release,
			getRuntime: vi.fn(() => runtime),
		} as unknown as RuntimeManager;

		const { server, handlers } = fakeServer();
		registerOdeDelegate(server, ctx, { returnGraceMs: 10, setupTimeoutMs: 5000 });

		const result = await handlers.get("ode_delegate")!({ prompt: "hi" });
		const sessionId = parse(result).sessionId as string;

		// Simulate ode_cancel racing the still-in-flight background setup.
		ctx.registry.setStatus(sessionId, "cancelled");
		resolveAcquire({ key: "default", runtime });

		await vi.waitFor(() => expect(runtime.client.session.abort).toHaveBeenCalled());
		expect(release).toHaveBeenCalledWith("default");
		expect(ctx.registry.get(sessionId)?.status).toBe("cancelled");
	});

	it("fails a stuck session once the setup deadline elapses, independent of the grace window", async () => {
		ctx.runtimeManager = {
			acquire: vi.fn(() => new Promise(() => {})), // never resolves
			release: vi.fn(),
			getRuntime: vi.fn(() => undefined),
		} as unknown as RuntimeManager;

		const { server, handlers } = fakeServer();
		registerOdeDelegate(server, ctx, { returnGraceMs: 5, setupTimeoutMs: 30 });

		const result = await handlers.get("ode_delegate")!({ prompt: "hi" });
		const sessionId = parse(result).sessionId as string;
		expect(parse(result).status).toBe("starting");

		await vi.waitFor(() => expect(ctx.registry.get(sessionId)?.status).toBe("error"));
		expect(ctx.registry.get(sessionId)?.errorCode).toBe("RUNTIME_STARTUP_FAILED");
	});
});
