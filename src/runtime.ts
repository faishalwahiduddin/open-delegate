import { spawnSync, type ChildProcess } from "node:child_process";
import crossSpawn from "cross-spawn";
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk";
import { resolveOpencodeBinary } from "./binaryResolve.js";

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
		const proc = crossSpawn(resolution.path, args, {
			cwd: options.cwd,
			env: { ...process.env, ...options.env },
		});

		const url = await waitForListening(proc, options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS);
		return new OpencodeRuntime(proc, url, options.onCrash);
	}

	/** Idempotent. Safe to call multiple times or after the process already died. */
	async dispose(): Promise<void> {
		if (this._state === "dead") return;
		this._state = "dead";
		killProcessTree(this.proc);
	}
}
