import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { DelegateContext } from "../context.js";
import { codeForError, describeError, failError, ok } from "../mcpResult.js";
import {
	checkModelAvailable,
	ModelNotAvailableError,
} from "../modelAvailability.js";
import { formatPolicyForToolDescription, resolveDelegateModel, suggestModels } from "../modelPolicy.js";
import type { ModelSpec } from "../modelSpec.js";
import { awaitSession, sessionResultPayload } from "./await.js";

const TOOL_NAME = "ode_delegate";
const MAX_PROMPT_BYTES = 512 * 1024;
const DEFAULT_SETUP_TIMEOUT_MS = 25_000;
/** How long the handler itself waits before returning "starting" instead of the actual outcome. */
const RETURN_GRACE_MS = 2_500;
const MAX_WAIT_MS = 60_000;

export const delegateInputShape = {
	prompt: z
		.string()
		.optional()
		.describe(
			`The task/instructions to hand off (inline). Mutually exclusive with promptPath; one is required. Hard cap ~${MAX_PROMPT_BYTES / 1024}KiB — use promptPath for anything larger. When sessionId is set, this is the follow-up prompt.`,
		),
	promptPath: z
		.string()
		.optional()
		.describe(
			`Absolute path to a UTF-8 text file containing the prompt, for anything too large to inline safely (~${MAX_PROMPT_BYTES / 1024}KiB cap applies to the file too). Mutually exclusive with prompt.`,
		),
	sessionId: z
		.string()
		.optional()
		.describe(
			"Resume an existing terminal session with a follow-up prompt instead of creating a new one. Session must not be running/starting.",
		),
	model: z
		.string()
		.optional()
		.describe(
			'Model as "provider/model", e.g. "opencode/deepseek-v4-flash-free". Omit to use OPEN_DELEGATE_DEFAULT_MODEL or the OpenCode server default. Ignored when resuming via sessionId.',
		),
	agent: z.string().optional().describe("OpenCode agent/mode name to run as. Omit for opencode's own default. Ignored when resuming."),
	cwd: z.string().optional().describe("Working directory for the delegated session. Omit to use the server's own cwd."),
	title: z.string().optional().describe("Optional short title for the session (shown in opencode's own session list). Ignored when resuming."),
	waitMs: z
		.number()
		.int()
		.optional()
		.describe(
			`After setup succeeds, block up to this many ms for the session to finish (clamped 0-${MAX_WAIT_MS}). Omitting skips the wait (same as waitMs: 0). Useful for short tasks that can finish in one tool call.`,
		),
};

const delegateInputSchema = z.object(delegateInputShape);
type DelegateInput = z.infer<typeof delegateInputSchema>;

const MODEL_FORMAT_FIX =
	'Pass model as "provider/model" (e.g. "opencode/deepseek-v4-flash-free"), or omit it to use OPEN_DELEGATE_DEFAULT_MODEL.';

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

function setupTimeoutMs(): number {
	const raw = Number(process.env.OPEN_DELEGATE_SETUP_TIMEOUT_MS);
	return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_SETUP_TIMEOUT_MS;
}

function clampWaitMs(raw: number | undefined): number {
	if (raw === undefined) return 0;
	return Math.min(MAX_WAIT_MS, Math.max(0, raw));
}

type PromptResolution = { ok: true; text: string } | { ok: false; result: CallToolResult };

/** Validates prompt/promptPath (mutually exclusive, one required, ~512KiB cap either way) and reads the file if used. */
export async function resolvePromptText(args: DelegateInput, ctx: DelegateContext): Promise<PromptResolution> {
	const hasPrompt = typeof args.prompt === "string" && args.prompt.length > 0;
	const hasPath = typeof args.promptPath === "string" && args.promptPath.length > 0;

	if (hasPrompt && hasPath) {
		return {
			ok: false,
			result: failError("PROMPT_PATH_INVALID", "Both prompt and promptPath were provided; pass exactly one.", {
				fix: "Use prompt for inline text, or promptPath for a file - not both.",
				logger: ctx.logger,
				tool: TOOL_NAME,
			}),
		};
	}

	if (hasPath) {
		const absolute = resolve(args.promptPath as string);
		let size: number;
		try {
			size = (await stat(absolute)).size;
		} catch (err) {
			return {
				ok: false,
				result: failError("PROMPT_PATH_INVALID", `promptPath "${args.promptPath}" could not be read: ${describeError(err)}`, {
					fix: "Pass an absolute path to a readable UTF-8 text file, or use prompt instead.",
					logger: ctx.logger,
					tool: TOOL_NAME,
				}),
			};
		}
		if (size > MAX_PROMPT_BYTES) {
			return {
				ok: false,
				result: failError(
					"PROMPT_TOO_LARGE",
					`promptPath "${args.promptPath}" is ${size} bytes, over the ${MAX_PROMPT_BYTES}-byte (~${MAX_PROMPT_BYTES / 1024}KiB) limit.`,
					{ fix: "Shrink the file, or point the agent at a summary instead of the full document.", logger: ctx.logger, tool: TOOL_NAME },
				),
			};
		}
		return { ok: true, text: await readFile(absolute, "utf8") };
	}

	if (!hasPrompt) {
		return {
			ok: false,
			result: failError("PROMPT_PATH_INVALID", "Neither prompt nor promptPath was provided.", {
				fix: "Pass prompt (inline text) or promptPath (absolute path to a UTF-8 text file).",
				logger: ctx.logger,
				tool: TOOL_NAME,
			}),
		};
	}

	const bytes = Buffer.byteLength(args.prompt as string, "utf8");
	if (bytes > MAX_PROMPT_BYTES) {
		return {
			ok: false,
			result: failError("PROMPT_TOO_LARGE", `prompt is ${bytes} bytes, over the ${MAX_PROMPT_BYTES}-byte (~${MAX_PROMPT_BYTES / 1024}KiB) limit.`, {
				fix: "Write the prompt to a file and pass it via promptPath instead of inlining it.",
				logger: ctx.logger,
				tool: TOOL_NAME,
			}),
		};
	}
	return { ok: true, text: args.prompt as string };
}

interface SetupParams {
	sessionId: string;
	args: DelegateInput;
	modelSpec: ModelSpec | undefined;
	promptText: string;
	setupTimeoutMs: number;
}

/**
 * Runs the actual acquire -> (model check) -> create session -> promptAsync chain
 * in the background. Never throws - every failure path finalizes the registry entry.
 */
async function runDelegateSetup(ctx: DelegateContext, params: SetupParams): Promise<void> {
	const { sessionId, args, modelSpec, promptText } = params;

	let acquired: Awaited<ReturnType<DelegateContext["runtimeManager"]["acquire"]>>;
	try {
		acquired = await ctx.runtimeManager.acquire();
	} catch (err) {
		ctx.registry.failStarting(sessionId, describeError(err), codeForError(err));
		return;
	}
	const { key, runtime } = acquired;

	// Fail-fast on unknown / unauthenticated models before creating a session.
	if (modelSpec) {
		const snapshot = await ctx.modelAvailability.tryGetSnapshot(runtime.client);
		if (snapshot) {
			const check = checkModelAvailable(modelSpec, snapshot);
			if (!check.ok) {
				ctx.runtimeManager.release(key);
				const err = new ModelNotAvailableError(`${modelSpec.providerID}/${modelSpec.modelID}`, check.reason);
				ctx.registry.failStarting(sessionId, err.message, "MODEL_NOT_AVAILABLE");
				return;
			}
		}
	}

	let opencodeSessionId: string;
	try {
		const created = await runtime.client.session.create({
			body: args.title ? { title: args.title } : undefined,
			query: args.cwd ? { directory: args.cwd } : undefined,
			throwOnError: true,
		});
		opencodeSessionId = created.data.id;
	} catch (err) {
		ctx.runtimeManager.release(key);
		ctx.registry.failStarting(sessionId, `Failed to create an opencode session: ${describeError(err)}`, "SESSION_CREATE_FAILED");
		return;
	}

	ctx.logger.info("delegate_accepted", {
		sessionId,
		opencodeSessionId,
		runtimeKey: key,
		model: modelSpec ? `${modelSpec.providerID}/${modelSpec.modelID}` : undefined,
	});

	try {
		await runtime.client.session.promptAsync({
			path: { id: opencodeSessionId },
			query: args.cwd ? { directory: args.cwd } : undefined,
			body: { model: modelSpec, agent: args.agent, parts: [{ type: "text", text: promptText }] },
			throwOnError: true,
		});
	} catch (err) {
		ctx.runtimeManager.release(key);
		ctx.registry.failStarting(sessionId, `Failed to start the delegated prompt: ${describeError(err)}`, "PROMPT_START_FAILED");
		return;
	}

	const attached = ctx.registry.attachRuntime(sessionId, { runtimeKey: key, opencodeSessionId, previewUrl: runtime.url });
	if (!attached) {
		try {
			await runtime.client.session.abort({ path: { id: opencodeSessionId }, throwOnError: true });
		} catch {
			// best-effort
		}
		ctx.runtimeManager.release(key);
		ctx.logger.info("delegate_setup_discarded", { sessionId, opencodeSessionId, runtimeKey: key });
	}
}

function runDelegateSetupWithDeadline(ctx: DelegateContext, params: SetupParams): Promise<void> {
	const timer = setTimeout(() => {
		const failed = ctx.registry.failStarting(
			params.sessionId,
			`Delegated session setup did not finish within ${params.setupTimeoutMs}ms (opencode may be slow to start, or unreachable).`,
			"RUNTIME_STARTUP_FAILED",
		);
		if (failed) ctx.logger.warn("delegate_setup_timeout", { sessionId: params.sessionId, timeoutMs: params.setupTimeoutMs });
	}, params.setupTimeoutMs);
	timer.unref?.();
	return runDelegateSetup(ctx, params).finally(() => clearTimeout(timer));
}

async function resumeExistingSession(
	ctx: DelegateContext,
	args: DelegateInput,
	promptText: string,
): Promise<CallToolResult> {
	const sessionId = args.sessionId as string;
	const entry = ctx.registry.get(sessionId);
	if (!entry) {
		return failError("SESSION_NOT_FOUND", `Unknown sessionId "${sessionId}". It may have already been pruned, or was never created by ode_delegate.`, {
			fix: "Double-check the sessionId from ode_delegate's response, or re-delegate if it was pruned (>30min past finishing).",
			logger: ctx.logger,
			tool: TOOL_NAME,
		});
	}
	if (entry.status === "running" || entry.status === "starting") {
		return failError("SESSION_NOT_TERMINAL", `Session "${sessionId}" is still ${entry.status}.`, {
			fix: `Call ode_await first, then resume (ode_delegate with sessionId) once status is no longer "${entry.status}".`,
			logger: ctx.logger,
			tool: TOOL_NAME,
		});
	}

	let acquired: Awaited<ReturnType<DelegateContext["runtimeManager"]["acquire"]>>;
	try {
		acquired = await ctx.runtimeManager.acquire();
	} catch (err) {
		return failError(codeForError(err), describeError(err), {
			logger: ctx.logger,
			tool: TOOL_NAME,
		});
	}
	const { key, runtime } = acquired;

	try {
		await runtime.client.session.promptAsync({
			path: { id: entry.opencodeSessionId ?? entry.id },
			body: { parts: [{ type: "text", text: promptText }] },
			throwOnError: true,
		});
	} catch (err) {
		ctx.runtimeManager.release(key);
		return failError("SESSION_RESUME_FAILED", `Failed to resume session "${sessionId}": ${describeError(err)}`, {
			hint: "If its opencode server had been disposed and was just respawned, that fresh server may no longer have this session's history.",
			logger: ctx.logger,
			tool: TOOL_NAME,
		});
	}

	entry.runtimeKey = key;
	ctx.registry.setStatus(entry.id, "running");

	const waitMs = clampWaitMs(args.waitMs);
	if (waitMs > 0) {
		const current = await awaitSession(ctx, entry.id, waitMs);
		return ok({
			...sessionResultPayload(current),
			previewUrl: current.previewUrl ?? runtime.url,
			note: ctx.registry.isTerminal(current.status)
				? undefined
				: "Still running after waitMs — call ode_await with this sessionId to continue.",
		});
	}

	return ok({
		sessionId: entry.id,
		status: "running",
		previewUrl: runtime.url,
		note: "Use ode_await (blocking, with timeout; timeoutMs: 0 for a single check) with this sessionId next.",
	});
}

async function maybeWaitAndReturn(
	ctx: DelegateContext,
	sessionId: string,
	waitMs: number,
	base: Record<string, unknown>,
): Promise<CallToolResult> {
	if (waitMs <= 0) return ok(base);
	const current = await awaitSession(ctx, sessionId, waitMs);
	return ok({
		...sessionResultPayload(current),
		runtimeKey: base.runtimeKey,
		opencodePid: base.opencodePid,
		note: ctx.registry.isTerminal(current.status)
			? undefined
			: "Still running after waitMs — call ode_await with this sessionId to continue.",
	});
}

export interface RegisterOdeDelegateOptions {
	/** How long the handler waits before returning "starting" instead of the actual outcome. Test seam. */
	returnGraceMs?: number;
	/** Overrides OPEN_DELEGATE_SETUP_TIMEOUT_MS. Test seam. */
	setupTimeoutMs?: number;
}

export function registerOdeDelegate(server: McpServer, ctx: DelegateContext, options: RegisterOdeDelegateOptions = {}): void {
	const returnGraceMs = options.returnGraceMs ?? RETURN_GRACE_MS;
	const setupDeadlineMs = options.setupTimeoutMs ?? setupTimeoutMs();
	const policyNote = formatPolicyForToolDescription(ctx.modelPolicy);
	server.registerTool(
		"ode_delegate",
		{
			title: "Delegate to OpenCode",
			description:
				"Starts a new OpenCode agent session to work on `prompt` (or `promptPath`) in the background and " +
				'returns a sessionId - typically with status "running" once the underlying opencode server is warm, or ' +
				'"starting" if it just had to cold-spawn (never blocks past a few seconds either way, unless waitMs is set). ' +
				"Pass sessionId to resume a finished session with a follow-up prompt. " +
				"Follow up with ode_await (block until done or timeout; timeoutMs: 0 = single check).\n\n" +
				policyNote,
			inputSchema: delegateInputShape,
		},
		async (args: DelegateInput) => {
			const promptResolution = await resolvePromptText(args, ctx);
			if (!promptResolution.ok) return promptResolution.result;

			// Resume path: existing sessionId + follow-up prompt.
			if (typeof args.sessionId === "string" && args.sessionId.length > 0) {
				return resumeExistingSession(ctx, args, promptResolution.text);
			}

			let modelSpec: ModelSpec | undefined;
			let liveConnectedIds: string[] | undefined;
			try {
				modelSpec = resolveDelegateModel(args.model, ctx.modelPolicy);
			} catch (err) {
				const code = codeForError(err);
				const cached = ctx.modelAvailability.getCached();
				liveConnectedIds = cached?.connectedIds;
				const hint =
					code === "INVALID_MODEL" || code === "MODEL_NOT_ALLOWED"
						? `Known-good pins: ${suggestModels(args.model, ctx.modelPolicy, 5, liveConnectedIds).join(", ")}`
						: undefined;
				return failError(code, describeError(err), {
					hint,
					fix: MODEL_FORMAT_FIX,
					details: { raw: args.model },
					logger: ctx.logger,
					tool: TOOL_NAME,
				});
			}

			const sessionId = randomUUID();
			ctx.registry.createPending({ id: sessionId });

			const setupPromise = runDelegateSetupWithDeadline(ctx, {
				sessionId,
				args,
				modelSpec,
				promptText: promptResolution.text,
				setupTimeoutMs: setupDeadlineMs,
			});
			setupPromise.catch((err) => {
				ctx.logger.error("delegate_setup_unexpected_error", { sessionId, message: describeError(err) });
			});

			await Promise.race([setupPromise, sleep(returnGraceMs)]);
			const entry = ctx.registry.get(sessionId);
			if (!entry) {
				return failError("UNKNOWN", "Session vanished immediately after being created.", { details: { sessionId }, logger: ctx.logger, tool: TOOL_NAME });
			}

			if (entry.status === "starting") {
				return ok({
					sessionId,
					status: "starting",
					note: "Still starting (cold opencode spawn, or a busy runtime) - call ode_await with this sessionId to continue.",
				});
			}

			if (entry.status === "error") {
				const code = entry.errorCode ?? "UNKNOWN";
				const cached = ctx.modelAvailability.getCached();
				const hint =
					code === "MODEL_NOT_AVAILABLE"
						? `Known-good pins: ${suggestModels(args.model, ctx.modelPolicy, 5, cached?.connectedIds).join(", ")}`
						: undefined;
				return failError(code, entry.errorMessage ?? "Delegated session failed during setup.", {
					hint,
					details: { sessionId },
					logger: ctx.logger,
					tool: TOOL_NAME,
				});
			}

			const runtime = ctx.runtimeManager.getRuntime(entry.runtimeKey);
			const waitMs = clampWaitMs(args.waitMs);
			return maybeWaitAndReturn(ctx, sessionId, waitMs, {
				sessionId,
				status: "running",
				previewUrl: entry.previewUrl,
				runtimeKey: entry.runtimeKey,
				opencodePid: runtime?.pid,
				note: "Use ode_await (blocking, with timeout; timeoutMs: 0 for a single check) with this sessionId next.",
			});
		},
	);
}
