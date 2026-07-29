import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DelegateContext } from "../context.js";
import { describeError, failError, ok } from "../mcpResult.js";

const TOOL_NAME = "ode_cancel";

export const cancelInputShape = {
	sessionId: z.string().min(1).describe("Session id returned by ode_delegate."),
};

const cancelInputSchema = z.object(cancelInputShape);
type CancelInput = z.infer<typeof cancelInputSchema>;

export function registerOdeCancel(server: McpServer, ctx: DelegateContext): void {
	server.registerTool(
		"ode_cancel",
		{
			title: "Cancel a delegated OpenCode session",
			description: "Aborts an in-progress session started by ode_delegate. A no-op (still returns ok) if it already finished.",
			inputSchema: cancelInputShape,
		},
		async (args: CancelInput) => {
			const entry = ctx.registry.get(args.sessionId);
			if (!entry) {
				return failError("SESSION_NOT_FOUND", `Unknown sessionId "${args.sessionId}". It may have already been pruned, or was never created by ode_delegate.`, {
					fix: "Double-check the sessionId from ode_delegate's response, or re-delegate if it was pruned (>30min past finishing).",
					logger: ctx.logger,
					tool: TOOL_NAME,
				});
			}

			if (ctx.registry.isTerminal(entry.status)) {
				return ok({ sessionId: entry.id, status: entry.status, note: "Session had already finished; nothing to cancel." });
			}

			if (entry.status === "starting") {
				ctx.registry.setStatus(entry.id, "cancelled");
				return ok({
					sessionId: entry.id,
					status: "cancelled",
					note: "Cancelled before its opencode session finished starting; the in-flight setup will be discarded once it completes.",
				});
			}

			const runtime = ctx.runtimeManager.getRuntime(entry.runtimeKey);
			if (!runtime) {
				const finalized = ctx.registry.finalizeIfRunning(entry.id, "error", "The opencode server for this session is no longer running.");
				if (finalized) ctx.runtimeManager.release(entry.runtimeKey);
				return ok({ sessionId: entry.id, status: "error", note: "Its opencode server had already exited." });
			}

			try {
				await runtime.client.session.abort({ path: { id: entry.opencodeSessionId ?? entry.id }, throwOnError: true });
			} catch (err) {
				return failError("SESSION_ABORT_FAILED", `Failed to abort session "${args.sessionId}": ${describeError(err)}`, {
					fix: "Check runtime health with ode_diagnostics before retrying.",
					logger: ctx.logger,
					tool: TOOL_NAME,
				});
			}

			const finalized = ctx.registry.finalizeIfRunning(entry.id, "cancelled");
			if (finalized) ctx.runtimeManager.release(entry.runtimeKey);
			return ok({ sessionId: entry.id, status: "cancelled" });
		},
	);
}
