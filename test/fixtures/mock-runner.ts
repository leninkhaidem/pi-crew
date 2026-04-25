// test/fixtures/mock-runner.ts
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export interface MockScript {
	events: unknown[];
	exitCode: number;
	stderr?: string;
	delayMs?: number;
}

export interface MockSpawnResult {
	binary: string; // path to wrapper executable
	scriptPath: string;
	dir: string;
	cleanup: () => void;
}

const MOCK_PI_PATH = path.resolve("test/fixtures/mock-pi.ts");

export function prepareMockPi(script: MockScript): MockSpawnResult {
	const dir = mkdtempSync(path.join(tmpdir(), "pi-crew-mockpi-"));
	const scriptPath = path.join(dir, "script.json");
	writeFileSync(scriptPath, JSON.stringify(script));

	const wrapperPath = path.join(dir, "pi");
	const wrapperBody = `#!/usr/bin/env bash
exec "${process.execPath}" --import tsx "${MOCK_PI_PATH}" "$@"
`;
	writeFileSync(wrapperPath, wrapperBody);
	chmodSync(wrapperPath, 0o755);
	process.env.MOCK_PI_SCRIPT = scriptPath;

	return {
		binary: wrapperPath,
		scriptPath,
		dir,
		cleanup: () => {
			// biome-ignore lint/performance/noDelete: env var must actually be removed
			delete process.env.MOCK_PI_SCRIPT;
			try {
				rmSync(dir, { recursive: true, force: true });
			} catch {
				// ignore
			}
		},
	};
}
