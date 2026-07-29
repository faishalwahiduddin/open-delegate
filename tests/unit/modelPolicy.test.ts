import { describe, expect, it } from "vitest";
import { InvalidModelSpecError } from "../../src/modelSpec.js";
import {
	BUILTIN_ODE_MODELS,
	formatPolicyForToolDescription,
	loadModelPolicy,
	matchesList,
	ModelDeniedError,
	ModelNotAllowedError,
	parseModelList,
	resolveDelegateModel,
	suggestModels,
} from "../../src/modelPolicy.js";

describe("parseModelList", () => {
	it("returns empty for undefined", () => {
		expect(parseModelList(undefined)).toEqual([]);
	});

	it("splits CSV and trims", () => {
		expect(parseModelList(" a/b , c/d , ")).toEqual(["a/b", "c/d"]);
	});

	it("returns empty for empty string", () => {
		expect(parseModelList("")).toEqual([]);
		expect(parseModelList("  ,  ")).toEqual([]);
	});
});

describe("matchesList", () => {
	it("matches exact ids", () => {
		expect(matchesList("opencode/foo", ["opencode/foo"])).toBe(true);
		expect(matchesList("opencode/bar", ["opencode/foo"])).toBe(false);
	});

	it("matches provider/* prefixes", () => {
		expect(matchesList("openrouter/qwen/qwen3.7-flash", ["openrouter/*"])).toBe(true);
		expect(matchesList("opencode/deepseek-v4-flash-free", ["openrouter/*"])).toBe(false);
		expect(matchesList("opencode/x", ["opencode/*"])).toBe(true);
	});
});

describe("loadModelPolicy", () => {
	it("uses built-in cheap ODE_MODELS when env unset", () => {
		const p = loadModelPolicy({});
		expect(p.odeModels).toEqual([...BUILTIN_ODE_MODELS]);
		expect(p.defaultModel).toBeUndefined();
		expect(p.allowExplicit).toBe(false);
		expect(p.denyModels).toEqual([]);
	});

	it("built-in force set excludes Anthropic/OpenAI AAA ids", () => {
		const aaa = [
			"openrouter/anthropic/claude-opus-5",
			"openrouter/anthropic/claude-sonnet-5",
			"openrouter/anthropic/claude-fable-5",
			"openrouter/openai/gpt-5.6-sol",
			"openrouter/openai/gpt-5.6-terra",
		];
		for (const id of aaa) {
			expect(BUILTIN_ODE_MODELS).not.toContain(id);
		}
		expect(BUILTIN_ODE_MODELS).toContain("opencode/deepseek-v4-flash-free");
		expect(BUILTIN_ODE_MODELS).toContain("openrouter/openai/gpt-5.6-luna");
	});

	it("empty OPEN_DELEGATE_ODE_MODELS clears the force list", () => {
		expect(loadModelPolicy({ OPEN_DELEGATE_ODE_MODELS: "" }).odeModels).toEqual([]);
	});

	it("parses DEFAULT_MODEL and lists from env", () => {
		const p = loadModelPolicy({
			OPEN_DELEGATE_DEFAULT_MODEL: "opencode/deepseek-v4-flash-free",
			OPEN_DELEGATE_ODE_MODELS: "opencode/a, openrouter/b/c",
			OPEN_DELEGATE_ALLOW_MODELS: "opencode/*",
			OPEN_DELEGATE_DENY_MODELS: "opencode/bad",
		});
		expect(p.defaultModel).toBe("opencode/deepseek-v4-flash-free");
		expect(p.odeModels).toEqual(["opencode/a", "openrouter/b/c"]);
		expect(p.allowExplicit).toBe(true);
		expect(p.allowModels).toEqual(["opencode/*"]);
		expect(p.denyModels).toEqual(["opencode/bad"]);
	});
});

describe("resolveDelegateModel", () => {
	const base = loadModelPolicy({});

	it("returns undefined when arg and default are both unset", () => {
		expect(resolveDelegateModel(undefined, base)).toBeUndefined();
	});

	it("fills from DEFAULT_MODEL when arg omitted", () => {
		const policy = loadModelPolicy({
			OPEN_DELEGATE_DEFAULT_MODEL: "opencode/deepseek-v4-flash-free",
		});
		expect(resolveDelegateModel(undefined, policy)).toEqual({
			providerID: "opencode",
			modelID: "deepseek-v4-flash-free",
		});
	});

	it("per-call arg wins over DEFAULT_MODEL", () => {
		const policy = loadModelPolicy({
			OPEN_DELEGATE_DEFAULT_MODEL: "opencode/deepseek-v4-flash-free",
		});
		expect(resolveDelegateModel("openrouter/z-ai/glm-5.2", policy)).toEqual({
			providerID: "openrouter",
			modelID: "z-ai/glm-5.2",
		});
	});

	it("rejects non-openrouter/opencode providers by default", () => {
		expect(() => resolveDelegateModel("anthropic/claude-sonnet-4-5", base)).toThrow(ModelNotAllowedError);
	});

	it("rejects when explicit allow list does not match", () => {
		const policy = loadModelPolicy({ OPEN_DELEGATE_ALLOW_MODELS: "opencode/*" });
		expect(() => resolveDelegateModel("openrouter/qwen/qwen3.7-flash", policy)).toThrow(ModelNotAllowedError);
	});

	it("empty explicit allow list rejects everything", () => {
		const policy = loadModelPolicy({ OPEN_DELEGATE_ALLOW_MODELS: "" });
		expect(() => resolveDelegateModel("opencode/deepseek-v4-flash-free", policy)).toThrow(ModelNotAllowedError);
	});

	it("deny wins after allow", () => {
		const policy = loadModelPolicy({
			OPEN_DELEGATE_DENY_MODELS: "openrouter/openai/gpt-5.6-sol",
		});
		expect(() => resolveDelegateModel("openrouter/openai/gpt-5.6-sol", policy)).toThrow(ModelDeniedError);
	});

	it("deny prefix works", () => {
		const policy = loadModelPolicy({
			OPEN_DELEGATE_DENY_MODELS: "openrouter/anthropic/*",
		});
		expect(() => resolveDelegateModel("openrouter/anthropic/claude-opus-5", policy)).toThrow(ModelDeniedError);
	});

	it("gates DEFAULT_MODEL through allow/deny", () => {
		const policy = loadModelPolicy({
			OPEN_DELEGATE_DEFAULT_MODEL: "anthropic/claude-sonnet-4-5",
		});
		expect(() => resolveDelegateModel(undefined, policy)).toThrow(ModelNotAllowedError);
	});

	it("rejects invalid shape", () => {
		expect(() => resolveDelegateModel("noslash", base)).toThrow(InvalidModelSpecError);
	});

	it("allows nested openrouter model ids", () => {
		expect(resolveDelegateModel("openrouter/moonshotai/kimi-k3", base)).toEqual({
			providerID: "openrouter",
			modelID: "moonshotai/kimi-k3",
		});
	});
});

describe("suggestModels", () => {
	const base = loadModelPolicy({});

	it("returns the first `max` pool entries when no raw input is given", () => {
		expect(suggestModels(undefined, base, 3)).toEqual(BUILTIN_ODE_MODELS.slice(0, 3));
	});

	it("ranks a near-match (missing provider prefix) to the front", () => {
		const suggestions = suggestModels("deepseek-v4-pro", base, 5);
		expect(suggestions[0]).toBe("openrouter/deepseek/deepseek-v4-pro");
	});

	it("ranks an exact-substring typo close to its match", () => {
		const suggestions = suggestModels("qwen3.7-flash", base, 5);
		expect(suggestions).toContain("openrouter/qwen/qwen3.7-flash");
	});

	it("falls back to the raw pool order when nothing scores above zero", () => {
		const suggestions = suggestModels("totally-unrelated-xyz", base, 4);
		expect(suggestions).toEqual(BUILTIN_ODE_MODELS.slice(0, 4));
	});

	it("respects the max count", () => {
		expect(suggestModels(undefined, base, 2)).toHaveLength(2);
	});

	it("uses the policy's own odeModels instead of BUILTIN when set", () => {
		const policy = loadModelPolicy({ OPEN_DELEGATE_ODE_MODELS: "opencode/only-one" });
		expect(suggestModels(undefined, policy, 5)).toEqual(["opencode/only-one"]);
	});
});

describe("formatPolicyForToolDescription", () => {
	it("mentions default and ODE_MODELS", () => {
		const text = formatPolicyForToolDescription(loadModelPolicy({}));
		expect(text).toContain("ODE_MODELS");
		expect(text).toContain("openrouter/*");
		expect(text).toContain("OpenCode server default");
	});

	it("includes explicit default model", () => {
		const text = formatPolicyForToolDescription(
			loadModelPolicy({ OPEN_DELEGATE_DEFAULT_MODEL: "opencode/deepseek-v4-flash-free" }),
		);
		expect(text).toContain("opencode/deepseek-v4-flash-free");
	});
});
