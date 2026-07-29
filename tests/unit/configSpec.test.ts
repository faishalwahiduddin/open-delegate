import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { serverDefaultConfigEnv } from "../../src/configSpec.js";

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

	it("does not invent paths", () => {
		expect(resolve("/etc/opencode.json")).toBe("/etc/opencode.json");
	});
});
