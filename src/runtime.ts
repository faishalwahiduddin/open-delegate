import { spawnSync, type ChildProcess } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";
import crossSpawn from "cross-spawn";
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk";
import { resolveOpencodeBinary } from "./binaryResolve.js";
import { describeError } from "./mcpResult.js";
import type { Logger } from "./log.js";

export type RuntimeState = "starting" | "ready" | "dead";

export interface RuntimeOptions {
	/** Extra env vars layered on top of process.env (e.g. OPENCODE_CONFIG). */
	env?: Record<string, string>;
	/** Working directory for the opencode server process. */
	cwd?: string;
	/** Milliseconds to wait for the "listening on" line before giving up. */
	startupTimeoutMs?: number;
	/** Called exactly once if the process dies (crash or clean exit) after having started. */
	onCrash?: (info: { code: number | null; signal: string | null }) => void;
	/** Optional event sink; when set, emits runtime_spawn/runtime_ready/runtime_startup_failed. */
	logger?: Logger;
	/** Runtime pool key (e.g. "default", "override:ab12cd"), included in log events for correlation. */
	key?: string;
}

const DEFAULT_STARTUP_TIMEOUT_MS = 20_000;

export class RuntimeStartupError extends Error {}

/**
 * Kills the child (and its tree on Windows, where a plain SIGTERM to `opencode.cmd`
 * would leave the underlying node process running). Mirrors the pattern OpenCode's
 * own SDK uses internally, but that helper isn't part of its public exports, so we
 * keep a small local copy instead of reaching into internals.
 */
function killProcessTree(proc: ChildProcess): void {
	if (proc.exitCode !== null || proc.signalCode !== null) return;
	if (process.platform === "win32" && proc.pid) {
		const result = spawnSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { windowsHide: true });
		if (!result.error && result.status === 0) return;
	}
	proc.kill("SIGTERM");
}

function waitForListening(proc: ChildProcess, timeoutMs: number): Promise<string> {
	return new Promise((resolve, reject) => {
		let output = "";
		let settled = false;

		const cleanup = () => {
			proc.stdout?.off("data", onStdout);
			proc.stderr?.off("data", onStderr);
			proc.off("exit", onExit);
			proc.off("error", onError);
		};

		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			cleanup();
			killProcessTree(proc);
			reject(
				new RuntimeStartupError(
					`opencode serve did not report a listening URL within ${timeoutMs}ms.` +
						(output.trim() ? ` Output so far:\n${output}` : ""),
				),
			);
		}, timeoutMs);

		const onStdout = (chunk: Buffer) => {
			if (settled) return;
			output += chunk.toString();
			const match = output.match(/opencode server listening on\s+(https?:\/\/\S+)/);
			if (match?.[1]) {
				settled = true;
				clearTimeout(timer);
				cleanup();
				resolve(match[1]);
			}
		};
		const onStderr = (chunk: Buffer) => {
			output += chunk.toString();
		};
		const onExit = (code: number | null) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			cleanup();
			reject(
				new RuntimeStartupError(
					`opencode serve exited with code ${code} before it started listening.` +
						(output.trim() ? ` Output:\n${output}` : ""),
				),
			);
		};
		const onError = (err: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			cleanup();
			reject(err);
		};

		proc.stdout?.on("data", onStdout);
		proc.stderr?.on("data", onStderr);
		proc.on("exit", onExit);
		proc.on("error", onError);
	});
}

/** Best-effort raw stdout+stderr tee to a PID-named file for the process lifetime; never throws. */
function openTeeStream(logger: Logger | undefined, key: string | undefined, pid: number | undefined): WriteStream | undefined {
	if (!logger || !key || pid === undefined) return undefined;
	try {
		return createWriteStream(logger.opencodeLogPath(pid, key), { flags: "a" });
	} catch {
		return undefined;
	}
}

/**
 * One live `opencode serve` child process plus a connected client. Follows the
 * same stdout "opencode server listening on <url>" contract as
 * `@opencode-ai/sdk`'s own `createOpencodeServer`, but adds:
 * - OPEN_DELEGATE_OPENCODE_BIN override support (via binaryResolve)
 * - additive env var layering (never clobbers unrelated config)
 * - a post-startup crash callback so callers can react to a mid-session death
 */
export class OpencodeRuntime {
	readonly client: OpencodeClient;
	readonly url: string;
	readonly pid: number | undefined;
	private readonly proc: ChildProcess;
	private _state: RuntimeState = "ready";

	private constructor(proc: ChildProcess, url: string, onCrash?: RuntimeOptions["onCrash"]) {
		this.proc = proc;
		this.url = url;
		this.pid = proc.pid;
		this.client = createOpencodeClient({ baseUrl: url });
		this.proc.on("exit", (code, signal) => {
			this._state = "dead";
			onCrash?.({ code, signal });
		});
	}

	get state(): RuntimeState {
		return this._state;
	}

	static async start(options: RuntimeOptions = {}): Promise<OpencodeRuntime> {
		const resolution = resolveOpencodeBinary();
		const args = ["serve", "--hostname=127.0.0.1", "--port=0"];
		const startedAt = Date.now();
		// NOTE: deliberately NOT passing `shell: resolution.requiresShell` here.
		// cross-spawn already resolves Windows .cmd/.bat shims, PATHEXT, and
		// quoting correctly on its own - explicitly passing `shell` disables
		// all of that built-in handling (see cross-spawn's own README) and
		// reintroduces the exact ENOENT it exists to prevent. requiresShell
		// is still surfaced below purely as diagnostic metadata.
		const proc = crossSpawn(resolution.path, args, {
			cwd: options.cwd,
			env: { ...process.env, ...options.env },
		});
		options.logger?.info("runtime_spawn", { key: options.key, pid: proc.pid, binaryPath: resolution.path, isShimBinary: resolution.requiresShell });

		const teeStream = openTeeStream(options.logger, options.key, proc.pid);
		if (teeStream) {
			// The underlying fs.open is async; if the log dir vanishes before it
			// resolves (or any other write failure occurs), don't let it crash the
			// process as an unhandled 'error' event.
			teeStream.on("error", () => {});
			proc.stdout?.pipe(teeStream, { end: false });
			proc.stderr?.pipe(teeStream, { end: false });
			proc.once("exit", () => teeStream.end());
		}

		let url: string;
		try {
			url = await waitForListening(proc, options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS);
		} catch (err) {
			options.logger?.error("runtime_startup_failed", { key: options.key, pid: proc.pid, message: describeError(err) });
			throw err;
		}
		options.logger?.info("runtime_ready", { key: options.key, pid: proc.pid, url, elapsedMs: Date.now() - startedAt });
		return new OpencodeRuntime(proc, url, options.onCrash);
	}

	/** Idempotent. Safe to call multiple times or after the process already died. */
	async dispose(): Promise<void> {
		if (this._state === "dead") return;
		this._state = "dead";
		killProcessTree(this.proc);
	}
}
