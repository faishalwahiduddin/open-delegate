import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Logger } from "../../src/log.js";
import { codeForError, describeError, fail, failError, ok } from "../../src/mcpResult.js";

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "ode-mcpresult-test-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("ok/fail", () => {
	it("ok() wraps data as pretty JSON text with no isError", () => {
		const result = ok({ sessionId: "s1", status: "running" });
		expect(result.isError).toBeUndefined();
		expect(JSON.parse(result.content[0]!.text as string)).toEqual({ sessionId: "s1", status: "running" });
	});

	it("fail() returns isError with the raw message", () => {
		const result = fail("boom");
		expect(result.isError).toBe(true);
		expect(result.content[0]!.text).toBe("boom");
	});
});

describe("failError", () => {
	it("produces a parseable envelope with the given code/message/hint/fix", () => {
		const result = failError("SESSION_NOT_FOUND", 'Unknown sessionId "x".', {
			hint: "did you mean y?",
			fix: "check the id",
			details: { raw: "x" },
		});
		expect(result.isError).toBe(true);
		const envelope = JSON.parse(result.content[0]!.text as string);
		expect(envelope).toEqual({
			ok: false,
			code: "SESSION_NOT_FOUND",
			message: 'Unknown sessionId "x".',
			hint: "did you mean y?",
			fix: "check the id",
			details: { raw: "x" },
		});
	});

	it("omits hint/fix/details when not provided", () => {
		const result = failError("UNKNOWN", "something broke");
		const envelope = JSON.parse(result.content[0]!.text as string);
		expect(envelope.hint).toBeUndefined();
		expect(envelope.fix).toBeUndefined();
		expect(envelope.details).toBeUndefined();
	});

	it("logs a tool_error event when a logger is supplied", () => {
		const lines: string[] = [];
		const logger = new Logger({ logDir: dir, write: (line) => lines.push(line) });

		failError("PROMPT_START_FAILED", "nope", { logger, tool: "ode_delegate", hint: "retry" });

		expect(lines).toHaveLength(1);
		const parsed = JSON.parse(lines[0]!);
		expect(parsed).toMatchObject({ event: "tool_error", tool: "ode_delegate", code: "PROMPT_START_FAILED", message: "nope", hint: "retry" });
	});

	it("does not log anything when no logger is supplied", () => {
		expect(() => failError("UNKNOWN", "nope")).not.toThrow();
	});
});

describe("describeError", () => {
	it("returns the message for Error instances", () => {
		expect(describeError(new Error("boom"))).toBe("boom");
	});

	it("stringifies non-Error values", () => {
		expect(describeError("plain string")).toBe("plain string");
		expect(describeError(42)).toBe("42");
	});
});

describe("codeForError", () => {
	it.each([
		["InvalidModelSpecError", "INVALID_MODEL"],
		["ModelNotAllowedError", "MODEL_NOT_ALLOWED"],
		["ModelDeniedError", "MODEL_DENIED"],
		["ModelNotAvailableError", "MODEL_NOT_AVAILABLE"],
		["OpencodeBinaryNotFoundError", "BINARY_NOT_FOUND"],
		["RuntimeStartupError", "RUNTIME_STARTUP_FAILED"],
	] as const)("maps %s -> %s", (name, expected) => {
		const err = new Error("x");
		err.name = name;
		expect(codeForError(err)).toBe(expected);
	});

	it("falls back to UNKNOWN for an unrecognized Error name", () => {
		expect(codeForError(new Error("plain"))).toBe("UNKNOWN");
	});

	it("falls back to UNKNOWN for a non-Error thrown value", () => {
		expect(codeForError("boom")).toBe("UNKNOWN");
	});
});
