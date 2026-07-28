export interface ModelSpec {
	providerID: string;
	modelID: string;
}

export class InvalidModelSpecError extends Error {
	constructor(raw: string) {
		super(
			`Invalid model "${raw}": expected "provider/model" ` +
				`(e.g. "opencode/grok-code-fast-1" or "anthropic/claude-sonnet-4-5").`,
		);
		this.name = "InvalidModelSpecError";
	}
}

/** Parses a "provider/model" string. Returns undefined when input is undefined (caller falls back to opencode's own default). */
export function parseModelSpec(raw: string | undefined): ModelSpec | undefined {
	if (raw === undefined) return undefined;
	const trimmed = raw.trim();
	const idx = trimmed.indexOf("/");
	if (trimmed.length === 0 || idx <= 0 || idx === trimmed.length - 1) {
		throw new InvalidModelSpecError(raw);
	}
	return {
		providerID: trimmed.slice(0, idx),
		modelID: trimmed.slice(idx + 1),
	};
}
