import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DelegateContext } from "../context.js";
import { fail, ok } from "../mcpResult.js";
import { refreshSessionStatus } from "../opencodeHelpers.js";

const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 750;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export const awaitInputShape = {
	sessionId: z.string().min(1).describe("Session id returned by ode_delegate."),
	timeoutMs: z
		.number()
		.int()
		.optional()
		.describe(`How long to wait before returning "running" (clamped to ${MIN_TIMEOUT_MS}-${MAX_TIMEOUT_MS}ms; default ${DEFAULT_TIMEOUT_MS}ms).`),
};

const awaitInputSchema = z.object(awaitInputShape);
type AwaitInput = z.infer<typeof awaitInputSchema>;

export function registerOdeAwait(server: McpServer, ctx: DelegateContext): void {
	server.registerTool(
		"ode_await",
		{
			title: "Await a delegated OpenCode session",
			description:
				"Blocks (up to a clamped timeout) until the session started by ode_delegate finishes, then returns its " +
				"final status. Returns status:\"running\" instead of blocking forever if the timeout elapses first — " +
				"call again to keep waiting.",
			inputSchema: awaitInputShape,
		},
		async (args: AwaitInput) => {
			const entry = ctx.registry.get(args.sessionId);
			if (!entry) {
				return fail(`Unknown sessionId "${args.sessionId}". It may have already been pruned, or was never created by ode_delegate.`);
			}

			const requested = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
			const timeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, requested));
			const deadline = Date.now() + timeoutMs;

			let current = entry;
			while (true) {
				current = await refreshSessionStatus(ctx, current);
				if (ctx.registry.isTerminal(current.status) || Date.now() >= deadline) break;
				await sleep(Math.min(POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())));
			}

			return ok({
				sessionId: current.id,
				status: current.status,
				previewUrl: current.previewUrl,
				errorMessage: current.errorMessage,
			});
		},
	);
}
