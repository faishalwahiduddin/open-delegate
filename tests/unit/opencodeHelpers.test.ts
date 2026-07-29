import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Message, OpencodeClient, Part } from "@opencode-ai/sdk";
import { Logger } from "../../src/log.js";
import {
	classifyAssistantError,
	describeCurrentActivity,
	extractText,
	fetchTranscript,
	findAuthBudgetLogLine,
	formatToolCallLine,
	refreshSessionStatus,
	summarizeAssistantError,
} from "../../src/opencodeHelpers.js";
import type { RuntimeManager } from "../../src/runtimeManager.js";
import { SessionRegistry } from "../../src/sessionRegistry.js";

type Msg = { info: Message; parts: Part[] };

function textPart(text: string): Part {
	return { type: "text", text } as Part;
}

function toolPart(tool: string, status: string, input?: unknown, output?: unknown): Part {
	return {
		type: "tool",
		tool,
		state: { status, input, output },
	} as Part;
}

function userMsg(text: string): Msg {
	return { info: { role: "user" } as Message, parts: [textPart(text)] };
}

function assistantMsg(parts: Part[], error?: { name: string; data?: unknown }): Msg {
	return {
		info: { role: "assistant", error } as Message,
		parts,
	};
}

function fakeClient(messages: Msg[], statusType: string | undefined = undefined): OpencodeClient {
	return {
		session: {
			status: vi.fn(async () => ({
				data: statusType ? { ses1: { type: statusType } } : {},
			})),
			messages: vi.fn(async () => ({ data: messages })),
		},
	} as unknown as OpencodeClient;
}

function makeDeps(
	client: OpencodeClient | undefined,
	registry: SessionRegistry,
	released: string[] = [],
	extras: { pid?: number; logger?: Logger } = {},
) {
	const runtimeManager = {
		getRuntime: (key: string) =>
			client
				? { client, state: "ready", url: "http://127.0.0.1:1", pid: extras.pid }
				: undefined,
		release: (key: string) => {
			released.push(key);
		},
	} as unknown as RuntimeManager;
	return { runtimeManager, registry, released, logger: extras.logger };
}

describe("extractText", () => {
	it("joins text parts and ignores tools", () => {
		expect(extractText([toolPart("read", "completed"), textPart(" hello "), textPart("world ")])).toBe(
			"hello \nworld",
		);
	});

	it("returns empty string when there are no text parts", () => {
		expect(extractText([toolPart("glob", "completed")])).toBe("");
	});
});

describe("formatToolCallLine", () => {
	it("formats a truncated tool one-liner", () => {
		const line = formatToolCallLine(toolPart("read", "completed", { filePath: "/a" }, "file contents here"));
		expect(line).toBe('  - tool:read [completed] in={"filePath":"/a"} out=file contents here');
	});

	it("returns undefined for non-tool parts", () => {
		expect(formatToolCallLine(textPart("hi"))).toBeUndefined();
	});
});

describe("describeCurrentActivity", () => {
	function reasoningPart(ended: boolean): Part {
		return {
			type: "reasoning",
			text: "hmm",
			time: ended ? { start: 1, end: 2 } : { start: 1 },
		} as Part;
	}

	it("prefers the newest running tool", () => {
		expect(
			describeCurrentActivity([
				toolPart("read", "completed", { path: "a" }),
				toolPart("bash", "running", { command: "npm test" }),
			]),
		).toBe('tool:bash {"command":"npm test"}');
	});

	it("treats pending tools as in-progress", () => {
		expect(describeCurrentActivity([toolPart("glob", "pending", { pattern: "*.ts" })])).toBe(
			'tool:glob {"pattern":"*.ts"}',
		);
	});

	it("falls back to thinking for an unfinished reasoning part", () => {
		expect(describeCurrentActivity([reasoningPart(false), textPart("partial")])).toBe("thinking");
	});

	it("returns undefined when nothing is in flight", () => {
		expect(
			describeCurrentActivity([toolPart("read", "completed", { path: "a" }), reasoningPart(true), textPart("done")]),
		).toBeUndefined();
	});

	it("returns undefined for an empty parts list", () => {
		expect(describeCurrentActivity([])).toBeUndefined();
	});
});

describe("summarizeAssistantError / classifyAssistantError", () => {
	it("prefers nested message fields over Object.values join", () => {
		const error = {
			name: "ProviderAuthError",
			data: { message: "Insufficient credits / out of budget", code: 402 },
		} as NonNullable<Parameters<typeof summarizeAssistantError>[0]>;
		expect(summarizeAssistantError(error)).toBe("ProviderAuthError: Insufficient credits / out of budget");
	});

	it("classifies ProviderAuthError and budget wording as PROVIDER_AUTH", () => {
		const error = {
			name: "ProviderAuthError",
			data: { message: "out of credits for this API key" },
		} as NonNullable<Parameters<typeof classifyAssistantError>[0]>;
		const classified = classifyAssistantError(error);
		expect(classified.code).toBe("PROVIDER_AUTH");
		expect(classified.message).toContain("out of credits");
		expect(classified.fix).toMatch(/credits|billing/i);
	});

	it("classifies other assistant errors as PROVIDER_ERROR", () => {
		const error = {
			name: "MessageOutputLengthError",
			data: { message: "output truncated" },
		} as NonNullable<Parameters<typeof classifyAssistantError>[0]>;
		expect(classifyAssistantError(error).code).toBe("PROVIDER_ERROR");
	});
});

describe("findAuthBudgetLogLine", () => {
	it("returns the last matching auth/budget line from a tee log", () => {
		const dir = mkdtempSync(join(tmpdir(), "ode-log-"));
		const path = join(dir, "opencode.log");
		writeFileSync(path, "listening\nok\nError: 402 out of budget for api key\nmore noise\n", "utf8");
		expect(findAuthBudgetLogLine(path)).toBe("Error: 402 out of budget for api key");
	});

	it("returns undefined when nothing matches", () => {
		const dir = mkdtempSync(join(tmpdir(), "ode-log-"));
		const path = join(dir, "opencode.log");
		writeFileSync(path, "listening\nok\n", "utf8");
		expect(findAuthBudgetLogLine(path)).toBeUndefined();
	});
});

describe("fetchTranscript", () => {
	it("with tail: 0 returns all messages", async () => {
		const client = fakeClient([
			userMsg("one"),
			assistantMsg([textPart("A")]),
			userMsg("two"),
			assistantMsg([textPart("B")]),
		]);
		const { lines, totalMessages } = await fetchTranscript(client, "ses1", 0);
		expect(totalMessages).toBe(4);
		expect(lines).toEqual(["user: one", "assistant: A", "user: two", "assistant: B"]);
	});

	it("with positive tail returns only the last N", async () => {
		const client = fakeClient([userMsg("one"), assistantMsg([textPart("A")]), userMsg("two")]);
		const { lines } = await fetchTranscript(client, "ses1", 2);
		expect(lines).toEqual(["assistant: A", "user: two"]);
	});

	it("renders a distinct line for tool-only assistant turns", async () => {
		const client = fakeClient([
			userMsg("search"),
			assistantMsg([toolPart("glob", "completed"), toolPart("read", "completed")]),
		]);
		const { lines } = await fetchTranscript(client, "ses1", 0);
		expect(lines[1]).toContain("no final text — 2 tool call(s)");
		expect(lines[1]).toContain("includeToolCalls");
		expect(lines).toHaveLength(2);
	});

	it("appends truncated tool lines when includeToolCalls is true", async () => {
		const client = fakeClient([
			userMsg("search"),
			assistantMsg([toolPart("read", "completed", { path: "x" }, "ok")]),
		]);
		const { lines } = await fetchTranscript(client, "ses1", 0, true);
		expect(lines[0]).toBe("user: search");
		expect(lines[1]).toContain("no final text — 1 tool call(s)");
		expect(lines[2]).toBe('  - tool:read [completed] in={"path":"x"} out=ok');
	});

	it("keeps normal text replies unchanged when includeToolCalls is false", async () => {
		const client = fakeClient([userMsg("hi"), assistantMsg([textPart("PONG")])]);
		const { lines } = await fetchTranscript(client, "ses1", 0, false);
		expect(lines).toEqual(["user: hi", "assistant: PONG"]);
	});
});

describe("refreshSessionStatus", () => {
	it("sets hasFinalText true for a normal text reply", async () => {
		const registry = new SessionRegistry();
		registry.create({ id: "ses1", runtimeKey: "default", previewUrl: "u" });
		const client = fakeClient([userMsg("hi"), assistantMsg([textPart("PONG")])], undefined);
		const deps = makeDeps(client, registry);

		const entry = await refreshSessionStatus(deps, registry.get("ses1")!);
		expect(entry.status).toBe("done");
		expect(entry.hasFinalText).toBe(true);
		expect(deps.released).toEqual(["default"]);
	});

	it("sets hasFinalText false for a tool-only terminal turn", async () => {
		const registry = new SessionRegistry();
		registry.create({ id: "ses1", runtimeKey: "default", previewUrl: "u" });
		const client = fakeClient([userMsg("hi"), assistantMsg([toolPart("glob", "completed")])], undefined);
		const deps = makeDeps(client, registry);

		const entry = await refreshSessionStatus(deps, registry.get("ses1")!);
		expect(entry.status).toBe("done");
		expect(entry.hasFinalText).toBe(false);
	});

	it("sets hasFinalText false when the runtime is gone", async () => {
		const registry = new SessionRegistry();
		registry.create({ id: "ses1", runtimeKey: "default", previewUrl: "u" });
		const deps = makeDeps(undefined, registry);

		const entry = await refreshSessionStatus(deps, registry.get("ses1")!);
		expect(entry.status).toBe("error");
		expect(entry.hasFinalText).toBe(false);
		expect(entry.errorMessage).toMatch(/no longer running/);
	});

	it("sets hasFinalText false on stuck startup (no assistant reply)", async () => {
		const clock = { t: 0, now: () => clock.t };
		const registry = new SessionRegistry({ now: clock.now });
		registry.create({ id: "ses1", runtimeKey: "default", previewUrl: "u" });
		clock.t = 25_000; // past STUCK_STARTUP_MS
		const client = fakeClient([userMsg("hi")], undefined);
		const deps = makeDeps(client, registry);

		const entry = await refreshSessionStatus(deps, registry.get("ses1")!, clock.now);
		expect(entry.status).toBe("error");
		expect(entry.hasFinalText).toBe(false);
		expect(entry.errorMessage).toMatch(/never started producing a reply/);
	});

	it("appends matching tee-log evidence on stuck startup when logger+pid are provided", async () => {
		const clock = { t: 0, now: () => clock.t };
		const logDir = mkdtempSync(join(tmpdir(), "ode-stuck-"));
		const logger = new Logger({ logDir, write: () => {} });
		const pid = 4242;
		const teePath = logger.opencodeLogPath(pid, "default");
		writeFileSync(teePath, "boot\nProviderAuthError: api key out of budget\n", "utf8");

		const registry = new SessionRegistry({ now: clock.now });
		registry.create({ id: "ses1", runtimeKey: "default", previewUrl: "u" });
		clock.t = 25_000;
		const client = fakeClient([userMsg("hi")], undefined);
		const deps = makeDeps(client, registry, [], { pid, logger });

		const entry = await refreshSessionStatus(deps, registry.get("ses1")!, clock.now);
		expect(entry.status).toBe("error");
		expect(entry.errorCode).toBe("PROVIDER_AUTH");
		expect(entry.errorMessage).toContain(teePath);
		expect(entry.errorMessage).toMatch(/out of budget/i);
	});

	it("leaves hasFinalText unset when messages cannot be read", async () => {
		const registry = new SessionRegistry();
		registry.create({ id: "ses1", runtimeKey: "default", previewUrl: "u" });
		const client = {
			session: {
				status: vi.fn(async () => ({ data: {} })),
				messages: vi.fn(async () => {
					throw new Error("boom");
				}),
			},
		} as unknown as OpencodeClient;
		const deps = makeDeps(client, registry);

		const entry = await refreshSessionStatus(deps, registry.get("ses1")!);
		expect(entry.status).toBe("error");
		expect(entry.hasFinalText).toBeUndefined();
		expect(entry.errorMessage).toMatch(/Could not read the session's final message/);
	});

	it("stays running while session status is busy and there is no assistant error", async () => {
		const registry = new SessionRegistry();
		registry.create({ id: "ses1", runtimeKey: "default", previewUrl: "u" });
		const client = fakeClient([userMsg("hi")], "busy");
		const deps = makeDeps(client, registry);

		const entry = await refreshSessionStatus(deps, registry.get("ses1")!);
		expect(entry.status).toBe("running");
		expect(entry.hasFinalText).toBeUndefined();
		expect(entry.currentActivity).toBe("thinking");
		expect(deps.released).toEqual([]);
	});

	it("finalizes PROVIDER_AUTH while status is still retry when assistant.error is set", async () => {
		const registry = new SessionRegistry();
		registry.create({ id: "ses1", runtimeKey: "default", previewUrl: "u" });
		const client = fakeClient(
			[
				userMsg("hi"),
				assistantMsg([], {
					name: "ProviderAuthError",
					data: { message: "Insufficient credits / out of budget" },
				}),
			],
			"retry",
		);
		const deps = makeDeps(client, registry);

		const entry = await refreshSessionStatus(deps, registry.get("ses1")!);
		expect(entry.status).toBe("error");
		expect(entry.errorCode).toBe("PROVIDER_AUTH");
		expect(entry.errorMessage).toMatch(/out of budget/i);
		expect(entry.hasFinalText).toBe(false);
		expect(entry.currentActivity).toBeUndefined();
		expect(deps.released).toEqual(["default"]);
	});

	it("stays running while busy with a partial assistant reply and no error", async () => {
		const registry = new SessionRegistry();
		registry.create({ id: "ses1", runtimeKey: "default", previewUrl: "u" });
		const client = fakeClient(
			[userMsg("hi"), assistantMsg([toolPart("bash", "running", { command: "ls" }), textPart("partial…")])],
			"busy",
		);
		const deps = makeDeps(client, registry);

		const entry = await refreshSessionStatus(deps, registry.get("ses1")!);
		expect(entry.status).toBe("running");
		expect(entry.currentActivity).toBe('tool:bash {"command":"ls"}');
		expect(deps.released).toEqual([]);
	});

	it("clears currentActivity when finalizing a normal text reply", async () => {
		const registry = new SessionRegistry();
		registry.create({ id: "ses1", runtimeKey: "default", previewUrl: "u" });
		registry.setCurrentActivity("ses1", "thinking");
		const client = fakeClient([userMsg("hi"), assistantMsg([textPart("PONG")])], undefined);
		const deps = makeDeps(client, registry);

		const entry = await refreshSessionStatus(deps, registry.get("ses1")!);
		expect(entry.status).toBe("done");
		expect(entry.currentActivity).toBeUndefined();
	});
});
