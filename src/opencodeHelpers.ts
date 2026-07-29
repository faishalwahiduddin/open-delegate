import { openSync, readSync, closeSync, fstatSync } from "node:fs";
import type { AssistantMessage, Message, OpencodeClient, Part } from "@opencode-ai/sdk";
import type { Logger } from "./log.js";
import { describeError, type ErrorCode } from "./mcpResult.js";
import type { RuntimeManager } from "./runtimeManager.js";
import type { SessionEntry, SessionRegistry } from "./sessionRegistry.js";

const TOOL_INPUT_PREVIEW_CHARS = 200;
const TOOL_OUTPUT_PREVIEW_CHARS = 300;
const STUCK_LOG_TAIL_BYTES = 8 * 1024;
const AUTH_BUDGET_LOG_RE = /auth|401|403|402|budget|credit|quota|billing|api.?key|unauthorized/i;
const AUTH_NAME_RE = /^ProviderAuthError$/i;
const AUTH_TEXT_RE = /auth|401|403|unauthorized|api.?key|invalid.?key|forbidden/i;
const BUDGET_TEXT_RE = /budget|credit|billing|402|quota|insufficient|out of (credits?|budget|funds)|payment.?required/i;

export function extractText(parts: Part[]): string {
	return parts
		.filter((part): part is Part & { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n")
		.trim();
}

function countToolParts(parts: Part[]): number {
	return parts.filter((part) => part.type === "tool").length;
}

function truncate(value: string, max: number): string {
	if (value.length <= max) return value;
	return `${value.slice(0, max)}…`;
}

function previewJson(value: unknown, max: number): string {
	if (value === undefined) return "";
	try {
		return truncate(typeof value === "string" ? value : JSON.stringify(value), max);
	} catch {
		return truncate(String(value), max);
	}
}

/** Compact one-liner for a single OpenCode tool part (truncated for token budget). */
export function formatToolCallLine(part: Part): string | undefined {
	if (part.type !== "tool") return undefined;
	const toolPart = part as Part & {
		type: "tool";
		tool?: string;
		state?: { status?: string; input?: unknown; output?: unknown };
	};
	const name = toolPart.tool ?? "unknown";
	const status = toolPart.state?.status ?? "?";
	const inputPreview = previewJson(toolPart.state?.input, TOOL_INPUT_PREVIEW_CHARS);
	const outputPreview = previewJson(toolPart.state?.output, TOOL_OUTPUT_PREVIEW_CHARS);
	const inSuffix = inputPreview ? ` in=${inputPreview}` : "";
	const outSuffix = outputPreview ? ` out=${outputPreview}` : "";
	return `  - tool:${name} [${status}]${inSuffix}${outSuffix}`;
}

function pickStructuredDetail(value: unknown, depth = 0): string | undefined {
	if (value === undefined || value === null || depth > 3) return undefined;
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed.length > 0 ? trimmed : undefined;
	}
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (typeof value !== "object") return undefined;
	const obj = value as Record<string, unknown>;
	for (const key of ["message", "msg", "error", "responseBody", "body", "detail", "description"]) {
		if (!(key in obj)) continue;
		const nested = obj[key];
		if (typeof nested === "string" && nested.trim()) return nested.trim();
		if (nested && typeof nested === "object") {
			const deeper = pickStructuredDetail(nested, depth + 1);
			if (deeper) return deeper;
		}
	}
	const values = Object.values(obj)
		.map((v) => (typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : undefined))
		.filter((v): v is string => Boolean(v && v.trim()));
	return values.length > 0 ? values.join(" ") : undefined;
}

export function summarizeAssistantError(error: AssistantMessage["error"]): string {
	if (!error) return "unknown error";
	const data = "data" in error ? error.data : undefined;
	const detail = pickStructuredDetail(data);
	return detail ? `${error.name}: ${detail}` : error.name;
}

export interface ClassifiedAssistantError {
	code: Extract<ErrorCode, "PROVIDER_AUTH" | "PROVIDER_ERROR">;
	message: string;
	hint?: string;
	fix?: string;
}

/** Classifies an OpenCode AssistantMessage.error into a stable code + actionable text. */
export function classifyAssistantError(error: AssistantMessage["error"]): ClassifiedAssistantError {
	const message = summarizeAssistantError(error);
	const name = error && "name" in error ? String(error.name) : "";
	const haystack = `${name} ${message}`;
	const isAuth = AUTH_NAME_RE.test(name) || AUTH_TEXT_RE.test(haystack) || BUDGET_TEXT_RE.test(haystack);
	if (isAuth) {
		const isBudget = BUDGET_TEXT_RE.test(haystack);
		return {
			code: "PROVIDER_AUTH",
			message,
			hint: isBudget
				? "The provider rejected the request due to billing/credits (or an auth failure that looks like it)."
				: "The provider rejected the request (missing/invalid API key, unauthorized, or similar).",
			fix: isBudget
				? "Top up or fix provider credits/billing for this API key, then retry ode_delegate."
				: "Check the provider API key / auth config used by opencode, then retry ode_delegate.",
		};
	}
	return {
		code: "PROVIDER_ERROR",
		message,
		hint: "The model/provider failed mid-run after the prompt was accepted.",
		fix: "Inspect errorMessage; fix the provider/model issue, or try a different model.",
	};
}

/**
 * Best-effort: read the last ~8KiB of an opencode tee log and return the last line
 * that looks like auth/budget failure. Never throws.
 */
export function findAuthBudgetLogLine(logPath: string): string | undefined {
	let fd: number | undefined;
	try {
		fd = openSync(logPath, "r");
		const size = fstatSync(fd).size;
		if (size <= 0) return undefined;
		const readLen = Math.min(size, STUCK_LOG_TAIL_BYTES);
		const buf = Buffer.alloc(readLen);
		readSync(fd, buf, 0, readLen, size - readLen);
		const text = buf.toString("utf8");
		const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
		for (let i = lines.length - 1; i >= 0; i--) {
			if (AUTH_BUDGET_LOG_RE.test(lines[i]!)) return truncate(lines[i]!, 400);
		}
		return undefined;
	} catch {
		return undefined;
	} finally {
		if (fd !== undefined) {
			try {
				closeSync(fd);
			} catch {
				// ignore
			}
		}
	}
}

/**
 * How long a session may sit with no assistant message yet and no observed
 * "busy"/"retry" status before we give up waiting for it to even start.
 * Empirically, a real model flips a session to "busy" within ~0.5s of
 * promptAsync returning; an invalid model/agent/provider instead fails
 * silently and the session's status key never appears at all, so without
 * this timeout such a session would read as "running" forever.
 */
const STUCK_STARTUP_MS = 20_000;

export interface RefreshSessionDeps {
	runtimeManager: RuntimeManager;
	registry: SessionRegistry;
	/** Optional; when set, stuck-startup and provider errors emit structured log events + tee-log evidence. */
	logger?: Logger;
}

/**
 * Polls OpenCode's own session status + last message to decide whether a
 * "running" registry entry has actually finished, then finalizes it exactly
 * once. Idempotent and safe to call from both ode_status and ode_await.
 *
 * Guards against the promptAsync startup race (status can briefly still read
 * "idle"/undefined the instant after the 204 response, before OpenCode flips
 * the session to "busy") by requiring an assistant reply to exist (or the
 * STUCK_STARTUP_MS timeout to elapse) before ever concluding "done"/"error".
 *
 * Provider auth/budget failures are detected even while status is still
 * "busy"/"retry", as long as the last assistant message carries `.error`.
 */
export async function refreshSessionStatus(
	deps: RefreshSessionDeps,
	entry: SessionEntry,
	now: () => number = Date.now,
): Promise<SessionEntry> {
	if (deps.registry.isTerminal(entry.status)) return entry;
	// Still being set up in the background by ode_delegate (see tools/delegate.ts) -
	// no runtime/opencode session exists yet, nothing to poll. It owns this transition.
	if (entry.status === "starting") return entry;

	const opencodeSessionId = entry.opencodeSessionId ?? entry.id;
	const runtime = deps.runtimeManager.getRuntime(entry.runtimeKey);
	if (!runtime) {
		deps.registry.finalizeIfRunning(
			entry.id,
			"error",
			"The opencode server for this session is no longer running (it may have crashed or been disposed).",
			{ hasFinalText: false },
		);
		return deps.registry.get(entry.id) ?? entry;
	}

	let statusMap: Record<string, { type: string }> | undefined;
	try {
		const res = await runtime.client.session.status({ throwOnError: true });
		statusMap = res.data as Record<string, { type: string }>;
	} catch {
		return entry; // Transient read failure; leave status as-is, caller may retry.
	}

	const sessionStatus = statusMap?.[opencodeSessionId];
	const inFlight = sessionStatus?.type === "busy" || sessionStatus?.type === "retry";

	let lastMessage: { info: Message; parts: Part[] } | undefined;
	try {
		const res = await runtime.client.session.messages({ path: { id: opencodeSessionId }, throwOnError: true });
		const list = res.data as Array<{ info: Message; parts: Part[] }>;
		lastMessage = list.at(-1);
	} catch (err) {
		// Unknown whether text was produced — leave hasFinalText unset.
		const finalized = deps.registry.finalizeIfRunning(
			entry.id,
			"error",
			`Could not read the session's final message: ${describeError(err)}`,
		);
		if (finalized) deps.runtimeManager.release(entry.runtimeKey);
		return deps.registry.get(entry.id) ?? entry;
	}

	if (lastMessage && lastMessage.info.role === "assistant") {
		const assistant = lastMessage.info as AssistantMessage;
		const hasFinalText = extractText(lastMessage.parts).length > 0;

		if (assistant.error) {
			const classified = classifyAssistantError(assistant.error);
			deps.logger?.warn("provider_error_detected", {
				sessionId: entry.id,
				opencodeSessionId,
				code: classified.code,
				message: classified.message,
				sessionStatus: sessionStatus?.type,
			});
			const finalized = deps.registry.finalizeIfRunning(entry.id, "error", classified.message, {
				hasFinalText,
				errorCode: classified.code,
			});
			if (finalized) deps.runtimeManager.release(entry.runtimeKey);
			return deps.registry.get(entry.id) ?? entry;
		}

		// Still generating (or provider retrying) without a terminal error yet.
		if (inFlight) return entry;

		const finalized = deps.registry.finalizeIfRunning(entry.id, "done", undefined, { hasFinalText });
		if (finalized) deps.runtimeManager.release(entry.runtimeKey);
		return deps.registry.get(entry.id) ?? entry;
	}

	// No assistant reply yet.
	if (inFlight) return entry;

	// opencode reports idle/unknown but hasn't produced an assistant reply
	// yet. Normally still starting - unless it's been stuck this long,
	// which means it likely failed before ever going "busy" (e.g. an
	// invalid model/agent id or a provider auth failure).
	if (now() - entry.updatedAt < STUCK_STARTUP_MS) return entry;

	const logPath =
		deps.logger && runtime.pid !== undefined && entry.runtimeKey
			? deps.logger.opencodeLogPath(runtime.pid, entry.runtimeKey)
			: undefined;
	const logHit = logPath ? findAuthBudgetLogLine(logPath) : undefined;

	let message =
		"The delegated session never started producing a reply (invalid model/agent id, or a provider auth failure).";
	if (logPath) message += ` Check the opencode server log: ${logPath}`;
	else message += " Check the opencode server logs for details.";
	if (logHit) message += ` Last matching log line: ${logHit}`;

	deps.logger?.warn("stuck_startup_with_log", {
		sessionId: entry.id,
		opencodeSessionId,
		logPath,
		logHit: logHit ?? null,
	});

	const finalized = deps.registry.finalizeIfRunning(entry.id, "error", message, {
		hasFinalText: false,
		errorCode: logHit ? "PROVIDER_AUTH" : undefined,
	});
	if (finalized) deps.runtimeManager.release(entry.runtimeKey);
	return deps.registry.get(entry.id) ?? entry;
}

export async function fetchTranscript(
	client: OpencodeClient,
	sessionId: string,
	tail: number,
	includeToolCalls = false,
): Promise<{ lines: string[]; totalMessages: number }> {
	const res = await client.session.messages({ path: { id: sessionId }, throwOnError: true });
	const list = res.data as Array<{ info: Message; parts: Part[] }>;
	const slice = tail > 0 ? list.slice(-tail) : list;
	const lines: string[] = [];
	for (const { info, parts } of slice) {
		const text = extractText(parts);
		const role = info.role === "assistant" ? "assistant" : "user";
		const errorSuffix =
			info.role === "assistant" && (info as AssistantMessage).error
				? ` [ERROR: ${summarizeAssistantError((info as AssistantMessage).error)}]`
				: "";

		let body = text;
		if (!body && role === "assistant") {
			const toolCount = countToolParts(parts);
			if (toolCount > 0) {
				body =
					`(no final text — ${toolCount} tool call(s); see ode_transcript with includeToolCalls, ` +
					`or ode_resume to ask for a written summary)`;
			}
		}

		lines.push(`${role}: ${body}${errorSuffix}`);

		if (includeToolCalls && role === "assistant") {
			for (const part of parts) {
				const toolLine = formatToolCallLine(part);
				if (toolLine) lines.push(toolLine);
			}
		}
	}
	return { lines, totalMessages: list.length };
}
