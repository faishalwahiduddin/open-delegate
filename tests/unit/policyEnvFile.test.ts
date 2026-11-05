import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyPolicyEnvFile } from "../../src/policyEnvFile.js";

describe("applyPolicyEnvFile", () => {
	it("merges keys from env.json without clobbering existing env", () => {
		const dir = mkdtempSync(join(tmpdir(), "ode-env-"));
		const file = join(dir, "env.json");
		writeFileSync(
			file,
			JSON.stringify({
				OPEN_DELEGATE_DEFAULT_MODEL: "opencode-go/deepseek-v4.1-flash",
				OPEN_DELEGATE_ALLOW_MODELS: "opencode-go/*",
			}),
		);
		const env: Record<string, string | undefined> = {
			OPEN_DELEGATE_ENV_FILE: file,
			OPEN_DELEGATE_DEFAULT_MODEL: "opencode/existing",
		};
		applyPolicyEnvFile(env);
		expect(env.OPEN_DELEGATE_DEFAULT_MODEL).toBe("opencode/existing");
		expect(env.OPEN_DELEGATE_ALLOW_MODELS).toBe("opencode-go/*");
	});
});
