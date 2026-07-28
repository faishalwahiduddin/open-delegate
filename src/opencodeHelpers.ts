import type { AssistantMessage, Message, OpencodeClient, Part } from "@opencode-ai/sdk";
import { describeError } from "./mcpResult.js";
import type { RuntimeManager } from "./runtimeManager.js";
import type { SessionEntry, SessionRegistry } from "./sessionRegistry.js";

export function extractText(parts: Part[]): string {
	return parts
		.filter((part): part is Part & { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n")
		.trim();
}

export function summarizeAssistantError(error: AssistantMessage["error"]): string {
	if (!error) return "unknown error";
	const data = "data" in error ? error.data : undefined;
	const detail = data && typeof data === "object" ? Object.values(data).filter(Boolean).join(" ") : undefined;
	return detail ? `${error.name}: ${detail}` : error.name;
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

/**
 * Polls OpenCode's own session status + last message to decide whether a
 * "running" registry entry has actually finished, then finalizes it exactly
 * once. Idempotent and safe to call from both ode_status and ode_await.
 *
 * Guards against the promptAsync startup race (status can briefly still read
 * "idle"/undefined the instant after the 204 response, before OpenCode flips
 * the session to "busy") by requiring an assistant reply to exist (or the
 * STUCK_STARTUP_MS timeout to elapse) before ever concluding "done"/"error".
 */
export async function refreshSessionStatus(
	deps: { runtimeManager: RuntimeManager; registry: SessionRegistry },
	entry: SessionEntry,
	now: () => number = Date.now,
): Promise<SessionEntry> {
	if (deps.registry.isTerminal(entry.status)) return entry;

	const runtime = deps.runtimeManager.getRuntime(entry.runtimeKey);
	if (!runtime) {
		deps.registry.finalizeIfRunning(
			entry.id,
			"error",
			"The opencode server for this session is no longer running (it may have crashed or been disposed).",
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

	const sessionStatus = statusMap?.[entry.id];
	if (sessionStatus?.type === "busy" || sessionStatus?.type === "retry") {
		return entry;
	}

	let lastMessage: { info: Message; parts: Part[] } | undefined;
	try {
		const res = await runtime.client.session.messages({ path: { id: entry.id }, throwOnError: true });
		const list = res.data as Array<{ info: Message; parts: Part[] }>;
		lastMessage = list.at(-1);
	} catch (err) {
		const finalized = deps.registry.finalizeIfRunning(
			entry.id,
			"error",
			`Could not read the session's final message: ${describeError(err)}`,
		);
		if (finalized) deps.runtimeManager.release(entry.runtimeKey);
		return deps.registry.get(entry.id) ?? entry;
	}

	if (!lastMessage || lastMessage.info.role !== "assistant") {
		// opencode reports idle/unknown but hasn't produced an assistant reply
		// yet. Normally still starting - unless it's been stuck this long,
		// which means it likely failed before ever going "busy" (e.g. an
		// invalid model/agent id or a provider auth failure).
		if (now() - entry.updatedAt < STUCK_STARTUP_MS) return entry;
		const finalized = deps.registry.finalizeIfRunning(
			entry.id,
			"error",
			"The delegated session never started producing a reply (invalid model/agent id, or a provider auth failure). " +
				"Check the opencode server logs for details.",
		);
		if (finalized) deps.runtimeManager.release(entry.runtimeKey);
		return deps.registry.get(entry.id) ?? entry;
	}

	const assistant = lastMessage.info as AssistantMessage;
	const finalStatus = assistant.error ? "error" : "done";
	const errorMessage = assistant.error ? summarizeAssistantError(assistant.error) : undefined;
	const finalized = deps.registry.finalizeIfRunning(entry.id, finalStatus, errorMessage);
	if (finalized) deps.runtimeManager.release(entry.runtimeKey);
	return deps.registry.get(entry.id) ?? entry;
}

export async function fetchTranscript(
	client: OpencodeClient,
	sessionId: string,
	tail: number,
): Promise<{ lines: string[]; totalMessages: number }> {
	const res = await client.session.messages({ path: { id: sessionId }, throwOnError: true });
	const list = res.data as Array<{ info: Message; parts: Part[] }>;
	const slice = tail > 0 ? list.slice(-tail) : list;
	const lines = slice.map(({ info, parts }) => {
		const text = extractText(parts);
		const role = info.role === "assistant" ? "assistant" : "user";
		const errorSuffix = info.role === "assistant" && info.error ? ` [ERROR: ${summarizeAssistantError(info.error)}]` : "";
		return `${role}: ${text}${errorSuffix}`;
	});
	return { lines, totalMessages: list.length };
}
