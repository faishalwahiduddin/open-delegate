import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Logger, resolveLogLevel } from "../../src/log.js";

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "ode-log-test-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("resolveLogLevel", () => {
	it("defaults to info when unset", () => {
		expect(resolveLogLevel({})).toBe("info");
	});

	it("accepts a recognized level, case-insensitively", () => {
		expect(resolveLogLevel({ OPEN_DELEGATE_LOG_LEVEL: "DEBUG" })).toBe("debug");
	});

	it("falls back to info for an unrecognized value", () => {
		expect(resolveLogLevel({ OPEN_DELEGATE_LOG_LEVEL: "verbose" })).toBe("info");
	});
});

describe("Logger", () => {
	it("writes a JSON line to both the injected sink and the mcp log file", () => {
		const lines: string[] = [];
		const logger = new Logger({ logDir: dir, write: (line) => lines.push(line), pid: 4242 });

		logger.info("mcp_start", { version: "1.2.3" });

		expect(lines).toHaveLength(1);
		const parsed = JSON.parse(lines[0]!);
		expect(parsed).toMatchObject({ level: "info", event: "mcp_start", pid: 4242, version: "1.2.3" });
		expect(typeof parsed.ts).toBe("string");

		const fileContents = readFileSync(logger.mcpLogPath, "utf8").trim();
		expect(JSON.parse(fileContents)).toMatchObject({ event: "mcp_start" });
	});

	it("filters events below the configured level", () => {
		const lines: string[] = [];
		const logger = new Logger({ logDir: dir, write: (line) => lines.push(line), level: "warn" });

		logger.debug("session_status", { sessionId: "s1" });
		logger.info("delegate_accepted", { sessionId: "s1" });
		logger.warn("runtime_exit", { key: "default" });

		expect(lines).toHaveLength(1);
		expect(JSON.parse(lines[0]!).event).toBe("runtime_exit");
	});

	it("keeps only the last ringSize events, oldest dropped first", () => {
		const logger = new Logger({ logDir: dir, write: () => {}, ringSize: 3 });

		for (let i = 0; i < 5; i += 1) logger.info("session_status", { i });

		const recent = logger.recentEvents();
		expect(recent).toHaveLength(3);
		expect(recent.map((e) => e.i)).toEqual([2, 3, 4]);
	});

	it("sanitizes runtimeKey when building an opencode log path", () => {
		const logger = new Logger({ logDir: dir, write: () => {} });
		const path = logger.opencodeLogPath(555, "override:ab/cd:ef");
		expect(path).toBe(join(dir, "opencode-555-override_ab_cd_ef.log"));
	});

	it("degrades to stderr-only (no throw) when the log directory is unwritable", () => {
		// Point logDir at a path that is itself an existing *file*, so mkdirSync/appendFileSync both fail.
		const blockerFile = join(dir, "blocker");
		writeFileSync(blockerFile, "x");
		const lines: string[] = [];
		const logger = new Logger({ logDir: join(blockerFile, "nested"), write: (line) => lines.push(line) });

		expect(() => logger.info("mcp_start", {})).not.toThrow();
		expect(lines).toHaveLength(1);
	});

	it("does not throw when the write sink throws (e.g. EPIPE)", () => {
		const logger = new Logger({
			logDir: dir,
			write: () => {
				const err = new Error("write EPIPE");
				(err as NodeJS.ErrnoException).code = "EPIPE";
				throw err;
			},
		});

		expect(() => logger.error("uncaught_exception", { message: "write EPIPE" })).not.toThrow();
		expect(logger.recentEvents()).toHaveLength(1);
	});

	it("skips nested log calls while already inside log (re-entrancy)", () => {
		const events: string[] = [];
		const logger = new Logger({
			logDir: dir,
			write: () => {
				events.push("outer");
				logger.error("nested_from_write", {});
				events.push("after_nested");
			},
		});

		logger.info("mcp_start", {});
		expect(events).toEqual(["outer", "after_nested"]);
		expect(logger.recentEvents().map((e) => e.event)).toEqual(["mcp_start"]);
	});

	it("stops appending once maxLogBytes is reached", () => {
		const logger = new Logger({
			logDir: dir,
			write: () => {},
			pid: 99,
			maxLogBytes: 80,
		});

		logger.info("a", { n: 1 });
		logger.info("b", { n: 2 });
		logger.info("c", { n: 3 });

		const contents = readFileSync(logger.mcpLogPath, "utf8");
		const lines = contents.trim().split("\n");
		expect(lines.length).toBeLessThan(3);
		expect(lines.length).toBeGreaterThanOrEqual(1);
	});
});
