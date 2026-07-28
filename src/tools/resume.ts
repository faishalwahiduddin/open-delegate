import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DelegateContext } from "../context.js";
import { describeError, fail, ok } from "../mcpResult.js";

export const resumeInputShape = {
	sessionId: z.string().min(1).describe("Session id to continue (returned by ode_delegate)."),
	prompt: z.string().min(1).describe("Follow-up instructions for the same session."),
};

const resumeInputSchema = z.object(resumeInputShape);
type ResumeInput = z.infer<typeof resumeInputSchema>;

export function registerOdeResume(server: McpServer, ctx: DelegateContext): void {
	server.registerTool(
		"ode_resume",
		{
			title: "Resume a finished delegated OpenCode session",
			description:
				"Sends a follow-up prompt to a session started by ode_delegate that has already reached a terminal " +
				"state (done/error/cancelled), continuing its history. Always reuses that session's original config; " +
				"respawns its opencode server if it had been disposed. Call ode_await first if the session is still running.",
			inputSchema: resumeInputShape,
		},
		async (args: ResumeInput) => {
			const entry = ctx.registry.get(args.sessionId);
			if (!entry) {
				return fail(`Unknown sessionId "${args.sessionId}". It may have already been pruned, or was never created by ode_delegate.`);
			}
			if (entry.status === "running") {
				return fail(`Session "${args.sessionId}" is still running. Use ode_await or ode_status first, then resume once it finishes.`);
			}

			let acquired: Awaited<ReturnType<DelegateContext["runtimeManager"]["acquire"]>>;
			try {
				acquired = await ctx.runtimeManager.acquire(entry.config);
			} catch (err) {
				return fail(describeError(err));
			}
			const { key, runtime } = acquired;

			try {
				await runtime.client.session.promptAsync({
					path: { id: entry.id },
					body: { parts: [{ type: "text", text: args.prompt }] },
					throwOnError: true,
				});
			} catch (err) {
				ctx.runtimeManager.release(key);
				return fail(
					`Failed to resume session "${args.sessionId}": ${describeError(err)}. If its opencode server had been ` +
						`disposed and was just respawned, that fresh server may no longer have this session's history.`,
				);
			}

			entry.runtimeKey = key;
			ctx.registry.setStatus(entry.id, "running");
			return ok({ sessionId: entry.id, status: "running", previewUrl: runtime.url });
		},
	);
}
