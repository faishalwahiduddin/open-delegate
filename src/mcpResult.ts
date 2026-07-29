import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Logger } from "./log.js";

/**
 * Stable machine-readable failure codes. Add new members here (and to
 * skills/ode-delegate/reference/errors.md's code table) whenever a new
 * failure path is introduced — never reuse "UNKNOWN" for a known cause.
 */
export type ErrorCode =
	| "INVALID_MODEL"
	| "MODEL_NOT_ALLOWED"
	| "MODEL_DENIED"
	| "MODEL_NOT_AVAILABLE"
	| "BINARY_NOT_FOUND"
	| "RUNTIME_STARTUP_FAILED"
	| "SESSION_CREATE_FAILED"
	| "PROMPT_START_FAILED"
	| "PROMPT_TOO_LARGE"
	| "PROMPT_PATH_INVALID"
	| "SESSION_NOT_FOUND"
	| "SESSION_NOT_TERMINAL"
	| "SESSION_ABORT_FAILED"
	| "SESSION_RESUME_FAILED"
	| "TRANSCRIPT_FETCH_FAILED"
	| "RUNTIME_UNAVAILABLE"
	| "PROVIDER_AUTH"
	| "PROVIDER_ERROR"
	| "UNKNOWN";

export interface ErrorEnvelope {
	ok: false;
	code: ErrorCode;
	message: string;
	/** Short, specific pointer at the likely cause (e.g. nearest valid model ids). Omit rather than pad. */
	hint?: string;
	/** One concrete next action. Omit rather than restate the message. */
	fix?: string;
	details?: Record<string, unknown>;
}

export function ok(data: unknown): CallToolResult {
	return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

/** Plain-string failure. Prefer failError() for new call sites — kept for the rare non-tool caller. */
export function fail(message: string): CallToolResult {
	return { content: [{ type: "text", text: message }], isError: true };
}

export interface FailErrorExtra {
	hint?: string;
	fix?: string;
	details?: Record<string, unknown>;
	/** When provided, emits a "tool_error" log event before returning (keeps Cursor MCP logs traceable without call-site boilerplate). */
	logger?: Logger;
	tool?: string;
}

/** Structured failure: every field an agent needs to self-correct, nothing it has to guess. */
export function failError(code: ErrorCode, message: string, extra: FailErrorExtra = {}): CallToolResult {
	const { hint, fix, details, logger, tool } = extra;
	logger?.warn("tool_error", { tool, code, message, hint, fix, details });
	const envelope: ErrorEnvelope = { ok: false, code, message, hint, fix, details };
	return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }], isError: true };
}

/** Renders any thrown value into a stable, human-readable error message. */
export function describeError(err: unknown): string {
	if (err instanceof Error) return err.message;
	return String(err);
}

/**
 * Maps a known thrown Error's `.name` to a stable ErrorCode. Matches by name
 * (not `instanceof`) so this stays decoupled from where each error class is
 * defined and avoids import cycles back into modelPolicy/runtime/etc.
 */
export function codeForError(err: unknown): ErrorCode {
	if (err instanceof Error) {
		switch (err.name) {
			case "InvalidModelSpecError":
				return "INVALID_MODEL";
			case "ModelNotAllowedError":
				return "MODEL_NOT_ALLOWED";
			case "ModelDeniedError":
				return "MODEL_DENIED";
			case "ModelNotAvailableError":
				return "MODEL_NOT_AVAILABLE";
			case "OpencodeBinaryNotFoundError":
				return "BINARY_NOT_FOUND";
			case "RuntimeStartupError":
				return "RUNTIME_STARTUP_FAILED";
			default:
				return "UNKNOWN";
		}
	}
	return "UNKNOWN";
}
