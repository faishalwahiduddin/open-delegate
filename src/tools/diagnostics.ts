import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DelegateContext } from "../context.js";
import { ok } from "../mcpResult.js";

export const diagnosticsInputShape = {};

export function registerOdeDiagnostics(server: McpServer, ctx: DelegateContext): void {
	server.registerTool(
		"ode_diagnostics",
		{
			title: "open-delegate bridge diagnostics",
			description:
				"Read-only snapshot of the open-delegate MCP bridge itself (not a specific session): its own pid/" +
				"version/log paths, every live opencode runtime with its own pid/url/log path, recent internal " +
				'events, and session counts by status. Use this to diagnose host-side "Connection stopped" / ' +
				'"Timed out waiting for connection" errors, or to find which opencode process/log backs a given ' +
				"runtimeKey.",
			inputSchema: diagnosticsInputShape,
		},
		async () => {
			const cached = ctx.modelAvailability.getCached();
			const runtimes = ctx.runtimeManager.snapshot().map((r) => ({
				...r,
				logPath: r.opencodePid !== undefined ? ctx.logger.opencodeLogPath(r.opencodePid, r.key) : undefined,
				connectedModelCount: cached?.connectedIds.length,
				connectedProviders: cached ? [...cached.connectedProviders] : undefined,
			}));
			return ok({
				mcpPid: process.pid,
				version: ctx.version,
				logDir: ctx.logger.logDir,
				mcpLogPath: ctx.logger.mcpLogPath,
				logLevel: ctx.logger.level,
				runtimes,
				sessionCounts: ctx.registry.countsByStatus(),
				recentEvents: ctx.logger.recentEvents(),
				modelPolicy: {
					defaultModel: ctx.modelPolicy.defaultModel,
					odeModelsCount: ctx.modelPolicy.odeModels.length,
					allowExplicit: ctx.modelPolicy.allowExplicit,
				},
			});
		},
	);
}
