import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { configKey, overrideConfigEnv, serverDefaultConfigEnv } from "../../src/configSpec.js";

describe("configKey", () => {
	it("returns 'default' for no override", () => {
		expect(configKey(undefined)).toBe("default");
		expect(configKey({})).toBe("default");
	});

	it("is stable for the same path override", () => {
		const a = configKey({ path: "./fixtures/opencode.json" });
		const b = configKey({ path: "./fixtures/opencode.json" });
		expect(a).toBe(b);
		expect(a).toMatch(/^override:/);
	});

	it("differs for different content overrides", () => {
		const a = configKey({ content: '{"model":"a/a"}' });
		const b = configKey({ content: '{"model":"b/b"}' });
		expect(a).not.toBe(b);
	});

	it("differs between path and content overrides even with similar text", () => {
		const a = configKey({ path: "x" });
		const b = configKey({ content: "x" });
		expect(a).not.toBe(b);
	});
});

describe("serverDefaultConfigEnv", () => {
	it("maps OPEN_DELEGATE_* vars onto their OPENCODE_* equivalents", () => {
		const env = serverDefaultConfigEnv({
			OPEN_DELEGATE_OPENCODE_CONFIG: "/etc/opencode.json",
			OPEN_DELEGATE_OPENCODE_CONFIG_DIR: "/etc/opencode.d",
			OPEN_DELEGATE_OPENCODE_CONFIG_CONTENT: '{"model":"opencode/grok-code-fast-1"}',
		});
		expect(env).toEqual({
			OPENCODE_CONFIG: "/etc/opencode.json",
			OPENCODE_CONFIG_DIR: "/etc/opencode.d",
			OPENCODE_CONFIG_CONTENT: '{"model":"opencode/grok-code-fast-1"}',
		});
	});

	it("is empty when none of the vars are set", () => {
		expect(serverDefaultConfigEnv({})).toEqual({});
	});
});

describe("overrideConfigEnv", () => {
	it("resolves a relative path override to an absolute OPENCODE_CONFIG", () => {
		const env = overrideConfigEnv({ path: "./my-config.json" });
		expect(env.OPENCODE_CONFIG).toBe(resolve("./my-config.json"));
		expect(env.OPENCODE_CONFIG_CONTENT).toBeUndefined();
	});

	it("passes inline content through untouched", () => {
		const env = overrideConfigEnv({ content: '{"model":"opencode/grok-code-fast-1"}' });
		expect(env).toEqual({ OPENCODE_CONFIG_CONTENT: '{"model":"opencode/grok-code-fast-1"}' });
	});
});
