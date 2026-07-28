import { describe, expect, it } from "vitest";
import { InvalidModelSpecError, parseModelSpec } from "../../src/modelSpec.js";

describe("parseModelSpec", () => {
	it("returns undefined for undefined input", () => {
		expect(parseModelSpec(undefined)).toBeUndefined();
	});

	it("splits provider/model on the first slash", () => {
		expect(parseModelSpec("opencode/grok-code-fast-1")).toEqual({
			providerID: "opencode",
			modelID: "grok-code-fast-1",
		});
	});

	it("keeps the rest of the string intact when the model id itself contains slashes", () => {
		expect(parseModelSpec("openrouter/meta-llama/llama-3.1-70b")).toEqual({
			providerID: "openrouter",
			modelID: "meta-llama/llama-3.1-70b",
		});
	});

	it.each(["", "noslash", "/missing-provider", "missing-model/"])("rejects invalid input %j", (raw) => {
		expect(() => parseModelSpec(raw)).toThrow(InvalidModelSpecError);
	});
});
