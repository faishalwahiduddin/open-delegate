#!/usr/bin/env node
// Standalone stdio smoke test: spawns the built MCP server exactly the way
// Cursor would (via mcp.json: node dist/index.js) and drives it through a
// real delegate -> await -> transcript -> cancel round trip using the MCP
// client SDK. No test framework, no source-tree imports - this is meant to
// catch "works in unit tests but the shipped server is actually broken"
// regressions (bad bin path, ESM resolution issues, etc).
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Optional override so this can also smoke-test an already-installed plugin
// copy (e.g. ~/.cursor/plugins/local/open-delegate/dist/index.js) instead of
// this repo's own build output.
const serverEntry = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, "..", "dist", "index.js");
const FREE_MODEL = "opencode/deepseek-v4-flash-free";

const EXPECTED_TOOLS = ["ode_delegate", "ode_await", "ode_status", "ode_transcript", "ode_cancel", "ode_resume"];

function log(step, detail = "") {
	console.log(`[e2e] ${step}${detail ? ` ${detail}` : ""}`);
}

function fail(message) {
	console.error(`[e2e] FAILED: ${message}`);
	process.exit(1);
}

async function main() {
	const transport = new StdioClientTransport({
		command: process.execPath,
		args: [serverEntry],
		stderr: "pipe",
	});
	const client = new Client({ name: "open-delegate-e2e-smoke", version: "0.0.0" });

	transport.stderr?.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));

	log("connecting to", serverEntry);
	await client.connect(transport);
	log("connected");

	const { tools } = await client.listTools();
	const names = tools.map((t) => t.name).sort();
	for (const expected of EXPECTED_TOOLS) {
		if (!names.includes(expected)) fail(`missing expected tool "${expected}". Got: ${names.join(", ")}`);
	}
	log("all expected tools present:", names.join(", "));

	async function callTool(name, args) {
		const result = await client.callTool({ name, arguments: args });
		const text = result.content?.map((c) => (c.type === "text" ? c.text : "")).join("\n") ?? "";
		if (result.isError) fail(`${name} returned an error: ${text}`);
		try {
			return JSON.parse(text);
		} catch {
			return text;
		}
	}

	log("calling ode_delegate...");
	const delegateResult = await callTool("ode_delegate", {
		prompt: "Reply with exactly the single word PONG and nothing else.",
		model: FREE_MODEL,
	});
	if (!delegateResult.sessionId || delegateResult.status !== "running") {
		fail(`unexpected ode_delegate result: ${JSON.stringify(delegateResult)}`);
	}
	const sessionId = delegateResult.sessionId;
	log("delegated session", sessionId);

	log("calling ode_await...");
	const awaitResult = await callTool("ode_await", { sessionId, timeoutMs: 45_000 });
	if (awaitResult.status !== "done") {
		fail(`expected session to finish with status "done", got: ${JSON.stringify(awaitResult)}`);
	}
	log("session finished with status", awaitResult.status);

	log("calling ode_transcript...");
	const transcriptResult = await callTool("ode_transcript", { sessionId });
	const transcriptText = JSON.stringify(transcriptResult.transcript ?? []).toUpperCase();
	if (!transcriptText.includes("PONG")) {
		fail(`transcript did not contain the expected reply: ${JSON.stringify(transcriptResult)}`);
	}
	log("transcript contains expected reply");

	log("calling ode_status on the same finished session (should stay done)...");
	const statusResult = await callTool("ode_status", { sessionId });
	if (statusResult.status !== "done") fail(`expected cached status "done", got: ${JSON.stringify(statusResult)}`);

	log("calling ode_cancel on an unknown sessionId (should fail cleanly, not crash)...");
	const bogusResult = await client.callTool({ name: "ode_cancel", arguments: { sessionId: "does-not-exist" } });
	if (!bogusResult.isError) fail("expected ode_cancel on an unknown sessionId to report an error");
	log("unknown-session error handled cleanly");

	await client.close();
	log("ALL CHECKS PASSED");
	process.exit(0);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
