import { appendFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEvent {
	ts: string;
	level: LogLevel;
	event: string;
	pid: number;
	[key: string]: unknown;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const DEFAULT_RING_SIZE = 50;

export interface LoggerOptions {
	level?: LogLevel;
	/** Directory both the MCP bridge's own log file and per-runtime opencode logs live in. */
	logDir?: string;
	pid?: number;
	ringSize?: number;
	now?: () => Date;
	/** Injectable sink for the human-facing line (defaults to stderr — never stdout, which carries MCP JSON-RPC). */
	write?: (line: string) => void;
}

function defaultLogDir(): string {
	return process.env.OPEN_DELEGATE_LOG_DIR?.trim() || join(tmpdir(), "open-delegate", "logs");
}

/** Reads OPEN_DELEGATE_LOG_LEVEL, defaulting to "info" for anything unset/unrecognized. */
export function resolveLogLevel(env: Record<string, string | undefined> = process.env): LogLevel {
	const raw = env.OPEN_DELEGATE_LOG_LEVEL?.trim().toLowerCase();
	if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") return raw;
	return "info";
}

/**
 * One-line JSON event log, always mirrored to stderr (safe for stdio MCP — stdout
 * is reserved for JSON-RPC) and best-effort appended to a PID-named file so a
 * finished/crashed session's history survives after the terminal scrolls away.
 * Also keeps a small in-memory ring for ode_diagnostics.
 */
export class Logger {
	readonly level: LogLevel;
	readonly logDir: string;
	readonly pid: number;
	readonly mcpLogPath: string;
	private readonly ring: LogEvent[] = [];
	private readonly ringSize: number;
	private readonly now: () => Date;
	private readonly writeLine: (line: string) => void;
	private fileWriteFailed = false;

	constructor(options: LoggerOptions = {}) {
		this.level = options.level ?? "info";
		this.pid = options.pid ?? process.pid;
		this.logDir = options.logDir ?? defaultLogDir();
		this.ringSize = options.ringSize ?? DEFAULT_RING_SIZE;
		this.now = options.now ?? (() => new Date());
		this.writeLine = options.write ?? ((line) => process.stderr.write(`${line}\n`));
		this.mcpLogPath = join(this.logDir, `mcp-${this.pid}.jsonl`);
		try {
			mkdirSync(this.logDir, { recursive: true });
		} catch {
			// Best-effort: file logging degrades to stderr + in-memory ring only.
		}
	}

	private shouldLog(level: LogLevel): boolean {
		return LEVEL_ORDER[level] >= LEVEL_ORDER[this.level];
	}

	log(level: LogLevel, event: string, data: Record<string, unknown> = {}): void {
		if (!this.shouldLog(level)) return;
		const entry: LogEvent = { ts: this.now().toISOString(), level, event, pid: this.pid, ...data };
		this.ring.push(entry);
		if (this.ring.length > this.ringSize) this.ring.shift();
		const line = JSON.stringify(entry);
		this.writeLine(line);
		this.appendToFile(line);
	}

	debug(event: string, data?: Record<string, unknown>): void {
		this.log("debug", event, data);
	}
	info(event: string, data?: Record<string, unknown>): void {
		this.log("info", event, data);
	}
	warn(event: string, data?: Record<string, unknown>): void {
		this.log("warn", event, data);
	}
	error(event: string, data?: Record<string, unknown>): void {
		this.log("error", event, data);
	}

	private appendToFile(line: string): void {
		if (this.fileWriteFailed) return;
		try {
			appendFileSync(this.mcpLogPath, `${line}\n`);
		} catch {
			// Directory may be unwritable (permissions, read-only FS); stop retrying a failing syscall every event.
			this.fileWriteFailed = true;
		}
	}

	/** Snapshot of the last `ringSize` events, oldest first. For ode_diagnostics. */
	recentEvents(): LogEvent[] {
		return [...this.ring];
	}

	/** Absolute path for a per-runtime opencode child log file (see runtime.ts). */
	opencodeLogPath(opencodePid: number, runtimeKey: string): string {
		const safeKey = runtimeKey.replace(/[^a-zA-Z0-9_-]/g, "_");
		return join(this.logDir, `opencode-${opencodePid}-${safeKey}.log`);
	}
}
