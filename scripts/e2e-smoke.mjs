#!/usr/bin/env node
// Standalone stdio smoke test: spawns the built MCP server exactly the way
// Cursor would for a local build (node dist/index.cjs) and drives it through a
// real delegate -> await -> transcript -> cancel round trip using the MCP
// client SDK. Marketplace installs use `npx -y @verbalize/open-delegate` instead.
// No test framework, no source-tree imports - this is meant to catch
// "works in unit tests but the shipped server is actually broken" regressions.
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Optional override so this can also smoke-test an installed binary
// (e.g. a global npm link path) instead of this repo's own build output.
const serverEntry = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, "..", "dist", "index.cjs");
const FREE_MODEL = "opencode/deepseek-v4-flash-free";

const EXPECTED_TOOLS = ["ode_delegate", "ode_await", "ode_transcript", "ode_cancel", "ode_diagnostics"];

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

	const stderrLines = [];
	transport.stderr?.on("data", (chunk) => {
		process.stderr.write(`[server] ${chunk}`);
		stderrLines.push(chunk.toString());
	});
	function stderrEvents(eventName) {
		return stderrLines
			.join("")
			.split("\n")
			.filter((line) => line.includes(`"event":"${eventName}"`))
			.map((line) => {
				try {
					return JSON.parse(line);
				} catch {
					return undefined;
				}
			})
			.filter(Boolean);
	}

	log("connecting to", serverEntry);
	await client.connect(transport);
	log("connected");

	log("checking stderr for mcp_start event...");
	const startEvents = stderrEvents("mcp_start");
	if (startEvents.length === 0) fail(`expected an "mcp_start" JSON event on stderr, got:\n${stderrLines.join("")}`);
	const serverPid = startEvents[0].pid;
	if (typeof serverPid !== "number") fail(`mcp_start event missing numeric pid: ${JSON.stringify(startEvents[0])}`);
	log("mcp_start present with pid", String(serverPid));

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

	log("calling ode_await(timeoutMs:0) on the same finished session (should stay done)...");
	const statusResult = await callTool("ode_await", { sessionId, timeoutMs: 0 });
	if (statusResult.status !== "done") fail(`expected cached status "done", got: ${JSON.stringify(statusResult)}`);
	if (typeof statusResult.answer === "string" && statusResult.answer.toUpperCase().includes("PONG")) {
		log("inline answer field contains expected reply");
	} else {
		log("inline answer field present:", JSON.stringify(statusResult.answer));
	}

	log("calling ode_cancel on an unknown sessionId (should fail cleanly, not crash)...");
	const bogusResult = await client.callTool({ name: "ode_cancel", arguments: { sessionId: "does-not-exist" } });
	if (!bogusResult.isError) fail("expected ode_cancel on an unknown sessionId to report an error");
	const bogusText = bogusResult.content?.map((c) => (c.type === "text" ? c.text : "")).join("\n") ?? "";
	let bogusEnvelope;
	try {
		bogusEnvelope = JSON.parse(bogusText);
	} catch {
		fail(`expected a JSON error envelope from ode_cancel, got: ${bogusText}`);
	}
	if (bogusEnvelope.ok !== false || bogusEnvelope.code !== "SESSION_NOT_FOUND") {
		fail(`expected coded error envelope { ok: false, code: "SESSION_NOT_FOUND" }, got: ${JSON.stringify(bogusEnvelope)}`);
	}
	log("unknown-session error handled cleanly with code", bogusEnvelope.code);

	log("calling ode_diagnostics...");
	const diagnostics = await callTool("ode_diagnostics", {});
	if (diagnostics.mcpPid !== serverPid) {
		fail(`expected ode_diagnostics mcpPid (${diagnostics.mcpPid}) to match the mcp_start event pid (${serverPid})`);
	}
	const defaultRuntime = diagnostics.runtimes?.find((r) => r.key === "default");
	if (!defaultRuntime || typeof defaultRuntime.opencodePid !== "number") {
		fail(`expected ode_diagnostics to list a "default" runtime with an opencodePid, got: ${JSON.stringify(diagnostics.runtimes)}`);
	}
	log(`ode_diagnostics reports mcpPid ${diagnostics.mcpPid} and default runtime opencodePid ${defaultRuntime.opencodePid}`);

	await client.close();
	log("ALL CHECKS PASSED");
	process.exit(0);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
