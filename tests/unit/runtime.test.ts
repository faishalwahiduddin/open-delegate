import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Logger } from "../../src/log.js";

vi.mock("../../src/binaryResolve.js", () => ({
	resolveOpencodeBinary: () => ({ path: "C:\\npm\\opencode.cmd", source: "path", requiresShell: true }),
}));

const spawnMock = vi.fn();
vi.mock("cross-spawn", () => ({ default: (...args: unknown[]) => spawnMock(...args) }));

const { OpencodeRuntime } = await import("../../src/runtime.js");

type FakeStream = EventEmitter & { pipe: (dest: unknown) => unknown };

function makeFakeStream(): FakeStream {
	const stream = new EventEmitter() as FakeStream;
	stream.pipe = vi.fn();
	return stream;
}

function makeFakeProc() {
	const proc = new EventEmitter() as EventEmitter & {
		stdout: FakeStream;
		stderr: FakeStream;
		pid: number;
		kill: (sig?: string) => void;
	};
	proc.stdout = makeFakeStream();
	proc.stderr = makeFakeStream();
	proc.pid = 1234;
	proc.kill = vi.fn();
	return proc;
}

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "ode-runtime-test-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("OpencodeRuntime.start", () => {
	// cross-spawn already resolves Windows .cmd/.bat shims, PATHEXT, and quoting
	// on its own (see its README's "options.shell" caveat: passing shell
	// explicitly *disables* all of that). This was verified against a real
	// Windows opencode.cmd install: passing shell:true here reintroduces the
	// exact ENOENT cross-spawn exists to prevent, so it must never be passed.
	it("never passes a shell option to cross-spawn, even for a binary resolution that flags requiresShell", async () => {
		const proc = makeFakeProc();
		spawnMock.mockReturnValue(proc);

		const startPromise = OpencodeRuntime.start({});
		queueMicrotask(() => proc.stdout.emit("data", Buffer.from("opencode server listening on http://127.0.0.1:1234\n")));

		const runtime = await startPromise;

		expect(runtime.url).toBe("http://127.0.0.1:1234");
		expect(runtime.pid).toBe(1234);
		expect(spawnMock).toHaveBeenCalledTimes(1);
		const [command, args, spawnOptions] = spawnMock.mock.calls[0] as [string, string[], Record<string, unknown>];
		expect(command).toBe("C:\\npm\\opencode.cmd");
		expect(args).toEqual(["serve", "--hostname=127.0.0.1", "--port=0"]);
		expect(spawnOptions.shell).toBeUndefined();
	});

	it("still surfaces requiresShell as diagnostic metadata on the runtime_spawn log event", async () => {
		const proc = makeFakeProc();
		spawnMock.mockReturnValue(proc);
		const lines: string[] = [];
		const logger = new Logger({ logDir: dir, write: (line) => lines.push(line) });

		const startPromise = OpencodeRuntime.start({ logger, key: "default" });
		queueMicrotask(() => proc.stdout.emit("data", Buffer.from("opencode server listening on http://127.0.0.1:1234\n")));
		await startPromise;
		proc.emit("exit", 0, null); // closes the tee WriteStream so afterEach's rmSync doesn't race an open handle

		const spawnEvent = lines.map((l) => JSON.parse(l)).find((e) => e.event === "runtime_spawn");
		expect(spawnEvent).toMatchObject({ isShimBinary: true, key: "default" });
	});
});
