import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function ok(data: unknown): CallToolResult {
	return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export function fail(message: string): CallToolResult {
	return { content: [{ type: "text", text: message }], isError: true };
}

/** Renders any thrown value into a stable, human-readable error message. */
export function describeError(err: unknown): string {
	if (err instanceof Error) return err.message;
	return String(err);
}
