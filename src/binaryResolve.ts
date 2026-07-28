import { existsSync } from "node:fs";

export class OpencodeBinaryNotFoundError extends Error {
	constructor(searched: string) {
		super(
			`Could not find the "opencode" CLI (${searched}). Install it ` +
				`(npm i -g opencode-ai@latest, or see https://opencode.ai/docs) or set ` +
				`OPEN_DELEGATE_OPENCODE_BIN to its full path.`,
		);
		this.name = "OpencodeBinaryNotFoundError";
	}
}

export interface BinaryResolution {
	/** Absolute (or override-provided) path to the opencode executable. */
	path: string;
	/** Whether it was found via the override env var or a PATH scan. */
	source: "env" | "path";
	/** Whether spawn() must be called with `shell: true` to run this path. */
	requiresShell: boolean;
}

export interface ResolveOptions {
	env?: Record<string, string | undefined>;
	platform?: NodeJS.Platform;
	fileExists?: (path: string) => boolean;
}

const WIN32_EXTENSIONS = [".cmd", ".exe", ".bat", ""];
const POSIX_EXTENSIONS = [""];

/**
 * Locates the opencode CLI without shelling out (so it stays unit-testable
 * and doesn't depend on `where`/`command -v` being present). Search order:
 * 1. OPEN_DELEGATE_OPENCODE_BIN override (trusted as-is if it exists).
 * 2. Each directory on PATH, trying platform-appropriate extensions.
 */
export function resolveOpencodeBinary(options: ResolveOptions = {}): BinaryResolution {
	const env = options.env ?? process.env;
	const platform = options.platform ?? process.platform;
	const fileExists = options.fileExists ?? existsSync;
	const isWin32 = platform === "win32";

	const override = env.OPEN_DELEGATE_OPENCODE_BIN;
	if (override) {
		if (!fileExists(override)) {
			throw new OpencodeBinaryNotFoundError(`OPEN_DELEGATE_OPENCODE_BIN=${override} does not exist`);
		}
		return {
			path: override,
			source: "env",
			requiresShell: isWin32 && !override.toLowerCase().endsWith(".exe"),
		};
	}

	const pathEnv = env.PATH ?? env.Path ?? "";
	const dirs = pathEnv.split(isWin32 ? ";" : ":").filter(Boolean);
	const extensions = isWin32 ? WIN32_EXTENSIONS : POSIX_EXTENSIONS;
	const sep = isWin32 ? "\\" : "/";

	for (const dir of dirs) {
		for (const ext of extensions) {
			const trimmedDir = dir.endsWith(sep) ? dir.slice(0, -1) : dir;
			const candidate = `${trimmedDir}${sep}opencode${ext}`;
			if (fileExists(candidate)) {
				return {
					path: candidate,
					source: "path",
					requiresShell: isWin32 && ext !== ".exe",
				};
			}
		}
	}

	throw new OpencodeBinaryNotFoundError("not on PATH");
}
