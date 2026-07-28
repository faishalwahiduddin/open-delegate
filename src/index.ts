#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { DelegateContext } from "./context.js";
import { RuntimeManager } from "./runtimeManager.js";
import { SessionRegistry } from "./sessionRegistry.js";
import { registerAllTools } from "./tools/index.js";

function readVersion(): string {
	try {
		const url = new URL("../package.json", import.meta.url);
		const pkg = JSON.parse(readFileSync(url, "utf8")) as { version?: string };
		return pkg.version ?? "0.0.0";
	} catch {
		return "0.0.0";
	}
}

async function main(): Promise<void> {
	const registry = new SessionRegistry();
	const runtimeManager = new RuntimeManager({
		onCrash: (key, info) => {
			const message = `opencode server process exited unexpectedly (code=${info.code ?? "null"}, signal=${info.signal ?? "null"}).`;
			registry.markRuntimeDead(key, message);
		},
	});
	const ctx: DelegateContext = { runtimeManager, registry };

	const server = new McpServer({ name: "open-delegate", version: readVersion() });
	registerAllTools(server, ctx);

	let shuttingDown = false;
	const shutdown = async (exitCode: number): Promise<void> => {
		if (shuttingDown) return;
		shuttingDown = true;
		try {
			await runtimeManager.shutdownAll();
		} finally {
			process.exit(exitCode);
		}
	};
	process.on("SIGINT", () => void shutdown(130));
	process.on("SIGTERM", () => void shutdown(143));
	server.server.onclose = () => void shutdown(0);
	// StdioServerTransport only wires up stdin "data"/"error" listeners, not
	// "end"/"close" - the client (Cursor) closing the pipe when a chat session
	// ends would otherwise leak the opencode server process forever (confirmed
	// via a real orphaned-process check before this hook was added).
	process.stdin.on("end", () => void shutdown(0));
	process.stdin.on("close", () => void shutdown(0));

	const transport = new StdioServerTransport();
	await server.connect(transport);
}

main().catch((err) => {
	console.error("open-delegate MCP server failed to start:", err);
	process.exit(1);
});
