import { describe, expect, it } from "vitest";
import { OpencodeBinaryNotFoundError, resolveOpencodeBinary } from "../../src/binaryResolve.js";

describe("resolveOpencodeBinary", () => {
	it("trusts an explicit override that exists", () => {
		const result = resolveOpencodeBinary({
			env: { OPEN_DELEGATE_OPENCODE_BIN: "/opt/custom/opencode" },
			platform: "linux",
			fileExists: (p) => p === "/opt/custom/opencode",
		});
		expect(result).toEqual({ path: "/opt/custom/opencode", source: "env", requiresShell: false });
	});

	it("throws a clear error when the override does not exist", () => {
		expect(() =>
			resolveOpencodeBinary({
				env: { OPEN_DELEGATE_OPENCODE_BIN: "/nope/opencode" },
				platform: "linux",
				fileExists: () => false,
			}),
		).toThrow(OpencodeBinaryNotFoundError);
	});

	it("finds opencode on POSIX PATH", () => {
		const result = resolveOpencodeBinary({
			env: { PATH: "/usr/local/bin:/usr/bin" },
			platform: "linux",
			fileExists: (p) => p === "/usr/bin/opencode",
		});
		expect(result).toEqual({ path: "/usr/bin/opencode", source: "path", requiresShell: false });
	});

	it("finds opencode.cmd on Windows PATH and flags it as needing a shell", () => {
		const result = resolveOpencodeBinary({
			env: { PATH: "C:\\tools;C:\\npm" },
			platform: "win32",
			fileExists: (p) => p === "C:\\npm\\opencode.cmd",
		});
		expect(result).toEqual({ path: "C:\\npm\\opencode.cmd", source: "path", requiresShell: true });
	});

	it("checks opencode.cmd before opencode.exe when both exist", () => {
		const result = resolveOpencodeBinary({
			env: { PATH: "C:\\npm" },
			platform: "win32",
			fileExists: (p) => p === "C:\\npm\\opencode.cmd" || p === "C:\\npm\\opencode.exe",
		});
		expect(result).toEqual({ path: "C:\\npm\\opencode.cmd", source: "path", requiresShell: true });
	});

	it("throws when nothing is found on PATH", () => {
		expect(() =>
			resolveOpencodeBinary({
				env: { PATH: "/usr/local/bin:/usr/bin" },
				platform: "linux",
				fileExists: () => false,
			}),
		).toThrow(OpencodeBinaryNotFoundError);
	});

	it("supports Windows PATH using the capitalized Path variable", () => {
		const result = resolveOpencodeBinary({
			env: { Path: "C:\\npm" },
			platform: "win32",
			fileExists: (p) => p === "C:\\npm\\opencode.cmd",
		});
		expect(result.path).toBe("C:\\npm\\opencode.cmd");
	});
});
