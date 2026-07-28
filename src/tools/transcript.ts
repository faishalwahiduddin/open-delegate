import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DelegateContext } from "../context.js";
import { describeError, fail, ok } from "../mcpResult.js";
import { fetchTranscript } from "../opencodeHelpers.js";

export const transcriptInputShape = {
	sessionId: z.string().min(1).describe("Session id returned by ode_delegate."),
	tail: z.number().int().positive().optional().describe("Only return the last N messages (default 20; 0 for all)."),
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
				return fail(`Unknown sessionId "${args.sessionId}". It may have already been pruned, or was never created by ode_delegate.`);
			}

			const runtime = ctx.runtimeManager.getRuntime(entry.runtimeKey);
			if (!runtime) {
				return fail(
					`The opencode server for session "${args.sessionId}" is no longer running, so its transcript can't be fetched. ` +
						`Last known status: ${entry.status}${entry.errorMessage ? ` (${entry.errorMessage})` : ""}.`,
				);
			}

			try {
				const { lines, totalMessages } = await fetchTranscript(runtime.client, args.sessionId, args.tail ?? DEFAULT_TAIL);
				return ok({ sessionId: args.sessionId, status: entry.status, totalMessages, transcript: lines });
			} catch (err) {
				return fail(`Failed to fetch transcript: ${describeError(err)}`);
			}
		},
	);
}
