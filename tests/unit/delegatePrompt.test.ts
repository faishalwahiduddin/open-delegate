import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DelegateContext } from "../../src/context.js";
import { Logger } from "../../src/log.js";
import { loadModelPolicy } from "../../src/modelPolicy.js";
import { RuntimeManager } from "../../src/runtimeManager.js";
import { SessionRegistry } from "../../src/sessionRegistry.js";
import { resolvePromptText } from "../../src/tools/delegate.js";

let dir: string;
let ctx: DelegateContext;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "ode-prompt-test-"));
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

function envelopeOf(result: Awaited<ReturnType<typeof resolvePromptText>>) {
	if (result.ok) throw new Error("expected a failure result");
	return JSON.parse(result.result.content[0]!.text as string);
}

describe("resolvePromptText", () => {
	it("accepts an inline prompt under the size cap", async () => {
		const result = await resolvePromptText({ prompt: "do the thing" } as never, ctx);
		expect(result).toEqual({ ok: true, text: "do the thing" });
	});

	it("rejects when neither prompt nor promptPath is given", async () => {
		const result = await resolvePromptText({} as never, ctx);
		expect(envelopeOf(result)).toMatchObject({ code: "PROMPT_PATH_INVALID" });
	});

	it("rejects when both prompt and promptPath are given", async () => {
		const result = await resolvePromptText({ prompt: "x", promptPath: join(dir, "p.txt") } as never, ctx);
		expect(envelopeOf(result)).toMatchObject({ code: "PROMPT_PATH_INVALID" });
	});

	it("rejects an inline prompt over the ~512KiB cap", async () => {
		const huge = "x".repeat(512 * 1024 + 1);
		const result = await resolvePromptText({ prompt: huge } as never, ctx);
		const envelope = envelopeOf(result);
		expect(envelope.code).toBe("PROMPT_TOO_LARGE");
		expect(envelope.fix).toMatch(/promptPath/);
	});

	it("reads promptPath from disk when under the cap", async () => {
		const file = join(dir, "prompt.txt");
		writeFileSync(file, "from a file");
		const result = await resolvePromptText({ promptPath: file } as never, ctx);
		expect(result).toEqual({ ok: true, text: "from a file" });
	});

	it("rejects a promptPath file over the ~512KiB cap", async () => {
		const file = join(dir, "big.txt");
		writeFileSync(file, "x".repeat(512 * 1024 + 1));
		const result = await resolvePromptText({ promptPath: file } as never, ctx);
		expect(envelopeOf(result)).toMatchObject({ code: "PROMPT_TOO_LARGE" });
	});

	it("rejects a promptPath that doesn't exist", async () => {
		const result = await resolvePromptText({ promptPath: join(dir, "nope.txt") } as never, ctx);
		expect(envelopeOf(result)).toMatchObject({ code: "PROMPT_PATH_INVALID" });
	});
});
