import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DelegateContext } from "../context.js";
import { failError, ok } from "../mcpResult.js";
import { refreshSessionStatus } from "../opencodeHelpers.js";

const TOOL_NAME = "ode_status";

export const statusInputShape = {
	sessionId: z.string().min(1).describe("Session id returned by ode_delegate."),
};

const statusInputSchema = z.object(statusInputShape);
type StatusInput = z.infer<typeof statusInputSchema>;

export function registerOdeStatus(server: McpServer, ctx: DelegateContext): void {
	server.registerTool(
		"ode_status",
		{
			title: "Check a delegated OpenCode session",
			description:
				"Single non-blocking status check for a session started by ode_delegate. Use ode_await instead if you " +
				"want to block until it finishes.",
			inputSchema: statusInputShape,
		},
		async (args: StatusInput) => {
			const entry = ctx.registry.get(args.sessionId);
			if (!entry) {
				return failError("SESSION_NOT_FOUND", `Unknown sessionId "${args.sessionId}". It may have already been pruned, or was never created by ode_delegate.`, {
					fix: "Double-check the sessionId from ode_delegate's response, or re-delegate if it was pruned (>30min past finishing).",
					logger: ctx.logger,
					tool: TOOL_NAME,
				});
			}

			const current = await refreshSessionStatus(ctx, entry);
			ctx.logger.debug("session_status", { sessionId: current.id, status: current.status });
			return ok({
				sessionId: current.id,
				status: current.status,
				previewUrl: current.previewUrl,
				errorMessage: current.errorMessage,
				errorCode: current.errorCode,
				hasFinalText: current.hasFinalText,
			});
		},
	);
}
