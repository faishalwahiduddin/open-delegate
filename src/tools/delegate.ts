import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DelegateContext } from "../context.js";
import { describeError, fail, ok } from "../mcpResult.js";
import { parseModelSpec } from "../modelSpec.js";

const configShape = z
	.object({
		path: z.string().optional().describe("Path to a custom opencode.json/.jsonc file for this call only."),
		content: z.string().optional().describe("Inline JSON opencode config for this call only."),
	})
	.describe(
		"One-off opencode config override. Spawns a separate, capped, ephemeral opencode server " +
			"instead of using the shared default one; omit unless this call truly needs different config.",
	);

export const delegateInputShape = {
	prompt: z.string().min(1).describe("The task/instructions to hand off to the delegated OpenCode agent."),
	model: z
		.string()
		.optional()
		.describe('Model as "provider/model", e.g. "opencode/grok-code-fast-1". Omit to use the configured default.'),
	agent: z.string().optional().describe("OpenCode agent/mode name to run as. Omit for opencode's own default."),
	cwd: z.string().optional().describe("Working directory for the delegated session. Omit to use the server's own cwd."),
	title: z.string().optional().describe("Optional short title for the session (shown in opencode's own session list)."),
	config: configShape.optional(),
};

const delegateInputSchema = z.object(delegateInputShape);
type DelegateInput = z.infer<typeof delegateInputSchema>;

export function registerOdeDelegate(server: McpServer, ctx: DelegateContext): void {
	server.registerTool(
		"ode_delegate",
		{
			title: "Delegate to OpenCode",
			description:
				"Starts a new OpenCode agent session to work on `prompt` in the background and returns immediately " +
				"with a sessionId. This never blocks on the agent finishing — follow up with ode_await (block until " +
				"done or timeout) or ode_status (single non-blocking check).",
			inputSchema: delegateInputShape,
		},
		async (args: DelegateInput) => {
			let modelSpec;
			try {
				modelSpec = parseModelSpec(args.model);
			} catch (err) {
				return fail(describeError(err));
			}

			let acquired: Awaited<ReturnType<DelegateContext["runtimeManager"]["acquire"]>>;
			try {
				acquired = await ctx.runtimeManager.acquire(args.config);
			} catch (err) {
				return fail(describeError(err));
			}
			const { key, runtime } = acquired;

			let sessionId: string;
			try {
				const created = await runtime.client.session.create({
					body: args.title ? { title: args.title } : undefined,
					query: args.cwd ? { directory: args.cwd } : undefined,
					throwOnError: true,
				});
				sessionId = created.data.id;
			} catch (err) {
				ctx.runtimeManager.release(key);
				return fail(`Failed to create an opencode session: ${describeError(err)}`);
			}

			ctx.registry.create({ id: sessionId, runtimeKey: key, config: args.config, previewUrl: runtime.url });

			try {
				await runtime.client.session.promptAsync({
					path: { id: sessionId },
					query: args.cwd ? { directory: args.cwd } : undefined,
					body: {
						model: modelSpec,
						agent: args.agent,
						parts: [{ type: "text", text: args.prompt }],
					},
					throwOnError: true,
				});
			} catch (err) {
				ctx.registry.setStatus(sessionId, "error", describeError(err));
				ctx.runtimeManager.release(key);
				return fail(`Failed to start the delegated prompt: ${describeError(err)}`);
			}

			return ok({
				sessionId,
				status: "running",
				previewUrl: runtime.url,
				note: "Use ode_await (blocking, with timeout) or ode_status (single check) with this sessionId next.",
			});
		},
	);
}
