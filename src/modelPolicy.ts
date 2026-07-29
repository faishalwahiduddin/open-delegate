import { InvalidModelSpecError, type ModelSpec, parseModelSpec } from "./modelSpec.js";

/** Built-in cheap-first force-routing catalog (conceptual ODE_MODELS). */
export const BUILTIN_ODE_MODELS: readonly string[] = [
	"opencode/deepseek-v4-flash-free",
	"opencode/nemotron-3-ultra-free",
	"opencode/mimo-v2.5-free",
	"opencode/laguna-s-2.1-free",
	"openrouter/openai/gpt-5.6-luna",
	"openrouter/qwen/qwen3.7-flash",
	"openrouter/qwen/qwen3.7-plus",
	"openrouter/deepseek/deepseek-v4-pro",
	"openrouter/z-ai/glm-5.2",
	"openrouter/moonshotai/kimi-k3",
	"openrouter/nex-agi/nex-n2-pro",
	"openrouter/google/gemini-3.6-flash",
	"openrouter/x-ai/grok-4.5",
];

/** Implicit allow universe when OPEN_DELEGATE_ALLOW_MODELS is unset. */
const DEFAULT_ALLOW_PREFIXES = ["openrouter/*", "opencode/*"] as const;

export interface ModelPolicy {
	/** Raw OPEN_DELEGATE_DEFAULT_MODEL string, if set. */
	defaultModel?: string;
	/** Force-routing catalog (ODE_MODELS). */
	odeModels: string[];
	/**
	 * Explicit allow list. Empty means use the implicit openrouter/* + opencode/*
	 * default universe (see matchesList with DEFAULT_ALLOW_PREFIXES).
	 */
	allowModels: string[];
	/** Blacklist applied after allow. */
	denyModels: string[];
	/** True when allowModels came from env (even if empty string → empty list). */
	allowExplicit: boolean;
}

export class ModelNotAllowedError extends Error {
	constructor(id: string) {
		super(
			`Model "${id}" is not on the allow list (OPEN_DELEGATE_ALLOW_MODELS, or default openrouter/* + opencode/*).`,
		);
		this.name = "ModelNotAllowedError";
	}
}

export class ModelDeniedError extends Error {
	constructor(id: string) {
		super(`Model "${id}" is denied by OPEN_DELEGATE_DENY_MODELS.`);
		this.name = "ModelDeniedError";
	}
}

/** Parse a comma-separated model list env value into trimmed non-empty entries. */
export function parseModelList(envValue: string | undefined): string[] {
	if (envValue === undefined) return [];
	return envValue
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

function matchesEntry(id: string, entry: string): boolean {
	if (entry.endsWith("/*")) {
		const prefix = entry.slice(0, -1); // keep trailing slash: "openrouter/"
		return id === entry.slice(0, -2) || id.startsWith(prefix);
	}
	return id === entry;
}

/** True if `id` matches any exact or provider/* entry in `list`. */
export function matchesList(id: string, list: readonly string[]): boolean {
	return list.some((entry) => matchesEntry(id, entry));
}

export function loadModelPolicy(env: Record<string, string | undefined> = process.env): ModelPolicy {
	const defaultRaw = env.OPEN_DELEGATE_DEFAULT_MODEL?.trim();
	const defaultModel = defaultRaw && defaultRaw.length > 0 ? defaultRaw : undefined;

	const odeEnv = env.OPEN_DELEGATE_ODE_MODELS;
	const odeModels = odeEnv === undefined ? [...BUILTIN_ODE_MODELS] : parseModelList(odeEnv);

	const allowEnv = env.OPEN_DELEGATE_ALLOW_MODELS;
	const allowExplicit = allowEnv !== undefined;
	const allowModels = allowExplicit ? parseModelList(allowEnv) : [];

	const denyModels = parseModelList(env.OPEN_DELEGATE_DENY_MODELS);

	return { defaultModel, odeModels, allowModels, denyModels, allowExplicit };
}

function assertAllowed(id: string, policy: ModelPolicy): void {
	const allowList = policy.allowExplicit ? policy.allowModels : [...DEFAULT_ALLOW_PREFIXES];
	if (!matchesList(id, allowList)) {
		throw new ModelNotAllowedError(id);
	}
	if (matchesList(id, policy.denyModels)) {
		throw new ModelDeniedError(id);
	}
}

/**
 * Resolve the model for ode_delegate: per-call arg → DEFAULT_MODEL → undefined (OpenCode default).
 * Returns a parsed ModelSpec, or undefined when the caller should omit model from promptAsync.
 */
export function resolveDelegateModel(
	raw: string | undefined,
	policy: ModelPolicy,
): ModelSpec | undefined {
	const chosen = raw !== undefined && raw.trim().length > 0 ? raw.trim() : policy.defaultModel;
	if (chosen === undefined) return undefined;

	const spec = parseModelSpec(chosen);
	if (spec === undefined) throw new InvalidModelSpecError(chosen);
	const id = `${spec.providerID}/${spec.modelID}`;
	assertAllowed(id, policy);
	return spec;
}

/** Crude token-overlap score so suggestModels can rank without a fuzzy-match dependency. */
function similarityScore(needle: string, hay: string): number {
	if (hay.includes(needle) || needle.includes(hay)) return 2;
	let score = 0;
	for (const part of needle.split(/[/\-_.]+/).filter((p) => p.length >= 3)) {
		if (hay.includes(part)) score += 1;
	}
	return score;
}

/**
 * Short, ranked list of known-good model ids to surface as an error `hint`
 * when a caller's model was invalid/disallowed — e.g. a typo like
 * "deepseek-v4-pro" should surface "openrouter/deepseek/deepseek-v4-pro" first.
 */
export function suggestModels(rawOrId: string | undefined, policy: ModelPolicy, max = 5): string[] {
	const pool = policy.odeModels.length > 0 ? policy.odeModels : [...BUILTIN_ODE_MODELS];
	if (!rawOrId) return pool.slice(0, max);
	const needle = rawOrId.trim().toLowerCase();
	const scored = pool.map((id) => ({ id, score: similarityScore(needle, id.toLowerCase()) })).sort((a, b) => b.score - a.score);
	const matched = scored.filter((s) => s.score > 0);
	return (matched.length > 0 ? matched : scored).slice(0, max).map((s) => s.id);
}

/** Short summary appended to the ode_delegate tool description. */
export function formatPolicyForToolDescription(policy: ModelPolicy): string {
	const lines: string[] = [];
	lines.push("Model policy (cost-first):");
	if (policy.defaultModel) {
		lines.push(`- default (when model omitted): ${policy.defaultModel}`);
	} else {
		lines.push("- default (when model omitted): OpenCode server default");
	}
	const odePreview =
		policy.odeModels.length === 0
			? "(none)"
			: policy.odeModels.length <= 4
				? policy.odeModels.join(", ")
				: `${policy.odeModels.slice(0, 4).join(", ")}, … (${policy.odeModels.length} total)`;
	lines.push(`- ODE_MODELS force-routing catalog: ${odePreview}`);
	if (policy.allowExplicit) {
		lines.push(
			policy.allowModels.length === 0
				? "- allow list: (empty — all models rejected unless you fix OPEN_DELEGATE_ALLOW_MODELS)"
				: `- allow list: ${policy.allowModels.join(", ")}`,
		);
	} else {
		lines.push("- allow list: openrouter/*, opencode/* (default)");
	}
	if (policy.denyModels.length > 0) {
		lines.push(`- deny list: ${policy.denyModels.join(", ")}`);
	}
	return lines.join("\n");
}
