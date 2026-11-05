import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "../../scripts/plan-build-opencode-prefix.mjs");

const BUILD_PROMPT = `Payment terms UI

Implement the plan as specified, it is attached for your reference. Do NOT edit the plan file itself.

To-do's from the plan have already been created. Do not create them again. Mark them as in_progress as you work, starting with the first one. Don't stop until you have completed all the to-dos.`;

function runHook(input, env = {}) {
	const res = spawnSync(process.execPath, [HOOK], {
		input: JSON.stringify(input),
		encoding: "utf8",
		env: { ...process.env, ...env },
	});
	expect(res.status).toBe(0);
	return JSON.parse(res.stdout);
}

describe("plan-build-opencode-prefix hook", () => {
	it("appends policy for Cursor Plan Build template", () => {
		const out = runHook({ prompt: BUILD_PROMPT });
		expect(out.prompt).toContain("[MANDATORY: Plan Build → OpenCode via ode_delegate]");
		expect(out.prompt).toContain("ode_delegate");
		expect(out.prompt.startsWith(BUILD_PROMPT)).toBe(true);
	});

	it("leaves unrelated prompts unchanged", () => {
		const out = runHook({ prompt: "hello world" });
		expect(out.prompt).toBe("hello world");
	});

	it("respects OPEN_DELEGATE_PLAN_HOOK=0", () => {
		const out = runHook({ prompt: BUILD_PROMPT }, { OPEN_DELEGATE_PLAN_HOOK: "0" });
		expect(out.prompt).toBe(BUILD_PROMPT);
	});

	it("respects Cursor only escape", () => {
		const out = runHook({ prompt: `${BUILD_PROMPT}\n\nCursor only please.` });
		expect(out.prompt).toBe(`${BUILD_PROMPT}\n\nCursor only please.`);
	});

	it("does not double-append", () => {
		const first = runHook({ prompt: BUILD_PROMPT });
		const second = runHook({ prompt: first.prompt });
		expect(second.prompt).toBe(first.prompt);
	});
});
