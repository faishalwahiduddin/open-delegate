import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DelegateContext } from "../context.js";
import { describeError, failError, ok } from "../mcpResult.js";
import { fetchTranscript } from "../opencodeHelpers.js";

const TOOL_NAME = "ode_transcript";

export const transcriptInputShape = {
	sessionId: z.string().min(1).describe("Session id returned by ode_delegate."),
	tail: z
		.number()
		.int()
		.nonnegative()
		.optional()
		.describe("Only return the last N messages (default 20; 0 for all)."),
	includeToolCalls: z
		.boolean()
		.optional()
		.default(false)
		.describe(
			"When true, append a truncated one-liner per tool call under each assistant message. Default false (text-only).",
		),
};

const transcriptInputSchema = z.object(transcriptInputShape);
type TranscriptInput = z.infer<typeof transcriptInputSchema>;

const DEFAULT_TAIL = 20;

export function registerOdeTranscript(server: McpServer, ctx: DelegateContext): void {
	server.registerTool(
		"ode_transcript",
		{
			title: "Read a delegated OpenCode session's transcript",
			description: "Fetches the conversation so far for a session started by ode_delegate, without waiting for it to finish.",
			inputSchema: transcriptInputShape,
		},
		async (args: TranscriptInput) => {
			const entry = ctx.registry.get(args.sessionId);
			if (!entry) {
				return failError("SESSION_NOT_FOUND", `Unknown sessionId "${args.sessionId}". It may have already been pruned, or was never created by ode_delegate.`, {
					fix: "Double-check the sessionId from ode_delegate's response, or re-delegate if it was pruned (>30min past finishing).",
					logger: ctx.logger,
					tool: TOOL_NAME,
				});
			}

			if (entry.status === "starting") {
				return ok({ sessionId: entry.id, status: entry.status, totalMessages: 0, transcript: [] });
			}

			const runtime = ctx.runtimeManager.getRuntime(entry.runtimeKey);
			if (!runtime) {
				return failError(
					"RUNTIME_UNAVAILABLE",
					`The opencode server for session "${args.sessionId}" is no longer running, so its transcript can't be fetched. ` +
						`Last known status: ${entry.status}${entry.errorMessage ? ` (${entry.errorMessage})` : ""}.`,
					{
						fix: "Check ode_diagnostics for live runtimes; ode_delegate({ sessionId }) will respawn one if needed.",
						logger: ctx.logger,
						tool: TOOL_NAME,
					},
				);
			}

			try {
				const { lines, totalMessages } = await fetchTranscript(
					runtime.client,
					entry.opencodeSessionId ?? entry.id,
					args.tail ?? DEFAULT_TAIL,
					args.includeToolCalls ?? false,
				);
				return ok({ sessionId: args.sessionId, status: entry.status, totalMessages, transcript: lines });
			} catch (err) {
				return failError("TRANSCRIPT_FETCH_FAILED", `Failed to fetch transcript: ${describeError(err)}`, {
					logger: ctx.logger,
					tool: TOOL_NAME,
				});
			}
		},
	);
}
