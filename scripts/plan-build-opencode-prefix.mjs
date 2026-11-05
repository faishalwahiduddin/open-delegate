#!/usr/bin/env node
/**
 * beforeSubmitPrompt: when Cursor Plan "Build" template is detected, append
 * mandatory open-delegate execution policy (overrides todo-first local edits).
 *
 * Disable: OPEN_DELEGATE_PLAN_HOOK=0
 * Escape: include "Cursor only" or "do not use OpenCode" in the prompt.
 */
const MAX_STDIN = 1024 * 1024;
const MARKER = "[MANDATORY: Plan Build → OpenCode via ode_delegate]";

const PREFIX = `

${MARKER}
This overrides "mark todos in_progress" / local implementation instructions above.

Execution policy (required):
1. First tool call MUST be open-delegate \`ode_delegate\` with the full attached plan, \`cwd\` = workspace root, \`agent\`: "sisyphus", omit \`model\`.
2. Loop \`ode_await\` (\`timeoutMs: 600000\`) until terminal; if \`done\` with \`hasFinalText: false\`, use \`ode_transcript\` and keep awaiting — do NOT implement the plan in Cursor because \`answer\` was empty.
3. Do NOT use Write/StrReplace/TodoWrite as the primary executor before OpenCode finishes.
4. After OpenCode: git diff, acceptance commands from the plan, plan verification table. Ask before commit/push.

Exception: user explicitly said Cursor only / do not use OpenCode.
`;

function readStdin() {
	return new Promise((resolve) => {
		let data = "";
		process.stdin.setEncoding("utf8");
		process.stdin.on("data", (chunk) => {
			if (data.length < MAX_STDIN) data += chunk.slice(0, MAX_STDIN - data.length);
		});
		process.stdin.on("end", () => resolve(data));
	});
}

function hookDisabled() {
	const v = (process.env.OPEN_DELEGATE_PLAN_HOOK ?? "1").trim().toLowerCase();
	return v === "0" || v === "false" || v === "off" || v === "no";
}

function isCursorOnlyEscape(text) {
	return /\b(cursor only|do not use opencode|don't use opencode|without opencode)\b/i.test(text);
}

/** Cursor Plan Build default user message shape */
function isPlanBuildPrompt(text) {
	if (!text || text.includes(MARKER)) return false;
	const hasImplement = /implement the plan as specified/i.test(text);
	const hasPlanFileGuard = /do not edit the plan file/i.test(text);
	const hasTodoProgress = /mark them as in_progress/i.test(text);
	const hasDontStop = /don't stop until you have completed all the to-dos/i.test(text);
	return hasImplement && hasPlanFileGuard && (hasTodoProgress || hasDontStop);
}

function extractPrompt(input) {
	if (typeof input === "string") return input;
	if (input && typeof input.prompt === "string") return input.prompt;
	if (input && typeof input.content === "string") return input.content;
	if (input && typeof input.message === "string") return input.message;
	if (input && typeof input.text === "string") return input.text;
	return "";
}

function setPromptOnInput(input, newPrompt) {
	if (typeof input === "string") return newPrompt;
	const out = input && typeof input === "object" ? { ...input } : {};
	if (typeof out.prompt === "string") out.prompt = newPrompt;
	else if (typeof out.content === "string") out.content = newPrompt;
	else if (typeof out.message === "string") out.message = newPrompt;
	else out.prompt = newPrompt;
	return out;
}

readStdin()
	.then((raw) => {
		if (!raw.trim()) {
			process.stdout.write(raw);
			return;
		}

		let input;
		try {
			input = JSON.parse(raw);
		} catch {
			process.stdout.write(raw);
			return;
		}

		if (hookDisabled()) {
			process.stdout.write(JSON.stringify(input));
			return;
		}

		const prompt = extractPrompt(input);
		if (!prompt || isCursorOnlyEscape(prompt) || !isPlanBuildPrompt(prompt)) {
			process.stdout.write(JSON.stringify(input));
			return;
		}

		const updated = `${prompt}${PREFIX}`;
		const output = setPromptOnInput(input, updated);
		process.stderr.write("[open-delegate] plan-build hook: appended OpenCode execution policy\n");
		process.stdout.write(JSON.stringify(output));
	})
	.catch(() => {
		process.exit(0);
	});
