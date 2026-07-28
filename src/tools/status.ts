import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DelegateContext } from "../context.js";
import { fail, ok } from "../mcpResult.js";
import { refreshSessionStatus } from "../opencodeHelpers.js";

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
				return fail(`Unknown sessionId "${args.sessionId}". It may have already been pruned, or was never created by ode_delegate.`);
			}

			const current = await refreshSessionStatus(ctx, entry);
			return ok({
				sessionId: current.id,
				status: current.status,
				previewUrl: current.previewUrl,
				errorMessage: current.errorMessage,
			});
		},
	);
}
