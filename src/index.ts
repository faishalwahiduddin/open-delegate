#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { DelegateContext } from "./context.js";
import { Logger, resolveLogLevel } from "./log.js";
import { describeError } from "./mcpResult.js";
import { loadModelPolicy } from "./modelPolicy.js";
import { RuntimeManager } from "./runtimeManager.js";
import { SessionRegistry } from "./sessionRegistry.js";
import { registerAllTools } from "./tools/index.js";

function readVersion(): string {
	const injected = process.env.OPEN_DELEGATE_PKG_VERSION;
	if (injected && injected.length > 0) return injected;
	try {
		const url = new URL("../package.json", import.meta.url);
		const pkg = JSON.parse(readFileSync(url, "utf8")) as { version?: string };
		return pkg.version ?? "0.0.0";
	} catch {
		return "0.0.0";
	}
}

async function main(): Promise<void> {
	const logger = new Logger({ level: resolveLogLevel() });
	const version = readVersion();
	logger.info("mcp_start", { pid: process.pid, version, logDir: logger.logDir, logLevel: logger.level });

	const registry = new SessionRegistry();
	const runtimeManager = new RuntimeManager({
		logger,
		onCrash: (key, info) => {
			const message = `opencode server process exited unexpectedly (code=${info.code ?? "null"}, signal=${info.signal ?? "null"}).`;
			logger.warn("runtime_crash", { key, pid: info.pid, code: info.code, signal: info.signal });
			registry.markRuntimeDead(key, message);
		},
	});

	// Never let a bug here take down the whole bridge silently - every other
	// in-flight ode_* call and any warm opencode runtime should keep working.
	process.on("uncaughtException", (err) => {
		logger.error("uncaught_exception", { message: describeError(err), stack: err instanceof Error ? err.stack : undefined });
	});
	process.on("unhandledRejection", (reason) => {
		logger.error("unhandled_rejection", { message: describeError(reason) });
	});
	const ctx: DelegateContext = {
		runtimeManager,
		registry,
		modelPolicy: loadModelPolicy(),
		logger,
		version,
	};

	const server = new McpServer({ name: "open-delegate", version });
	registerAllTools(server, ctx);

	let shuttingDown = false;
	const shutdown = async (exitCode: number, reason: string): Promise<void> => {
		if (shuttingDown) return;
		shuttingDown = true;
		logger.info("mcp_shutdown", { exitCode, reason });
		try {
			await runtimeManager.shutdownAll();
		} finally {
			process.exit(exitCode);
		}
	};
	process.on("SIGINT", () => void shutdown(130, "sigint"));
	process.on("SIGTERM", () => void shutdown(143, "sigterm"));
	server.server.onclose = () => void shutdown(0, "mcp_onclose");
	// StdioServerTransport only wires up stdin "data"/"error" listeners, not
	// "end"/"close" - the client (Cursor) closing the pipe when a chat session
	// ends would otherwise leak the opencode server process forever (confirmed
	// via a real orphaned-process check before this hook was added). Logged as
	// "warn" (not "info") because from the outside this looks identical to a
	// host-side MCP connection drop — see errors.md's Cursor host-error section.
	process.stdin.on("end", () => {
		logger.warn("stdin_close", { via: "end" });
		void shutdown(0, "stdin_end");
	});
	process.stdin.on("close", () => {
		logger.warn("stdin_close", { via: "close" });
		void shutdown(0, "stdin_close");
	});

	const transport = new StdioServerTransport();
	await server.connect(transport);

	// Best-effort: get the default opencode server ready ahead of the first
	// ode_delegate call instead of paying the ~cold-spawn cost inline. Never
	// blocks server startup, and a failure here (e.g. opencode not installed)
	// is just logged - the real error still surfaces from ode_delegate itself.
	void runtimeManager.acquire().then(
		({ key }) => runtimeManager.release(key),
		(err) => logger.warn("prewarm_failed", { message: describeError(err) }),
	);
}

main().catch((err) => {
	console.error("open-delegate MCP server failed to start:", err);
	process.exit(1);
});
