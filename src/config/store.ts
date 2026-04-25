import fs from "node:fs/promises";
import path from "node:path";
import type { PiCrewConfig } from "../types.js";
import { emptyConfig, parsePiCrewConfig } from "./schema.js";

export interface LoadResult {
	config: PiCrewConfig;
	path: string;
	fromDisk: boolean;
	errors: string[];
}

export async function loadConfig(filePath: string): Promise<LoadResult> {
	let raw: string;
	try {
		raw = await fs.readFile(filePath, "utf-8");
	} catch (err) {
		const e = err as NodeJS.ErrnoException;
		if (e.code === "ENOENT") {
			return { config: emptyConfig(), path: filePath, fromDisk: false, errors: [] };
		}
		throw err;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		return {
			config: emptyConfig(),
			path: filePath,
			fromDisk: true,
			errors: [`JSON parse: ${(err as Error).message}`],
		};
	}
	const r = parsePiCrewConfig(parsed);
	if (!r.ok) {
		return { config: emptyConfig(), path: filePath, fromDisk: true, errors: r.errors };
	}
	return { config: r.value, path: filePath, fromDisk: true, errors: [] };
}

export async function saveConfig(filePath: string, config: PiCrewConfig): Promise<void> {
	const dir = path.dirname(filePath);
	await fs.mkdir(dir, { recursive: true });
	const tmp = `${filePath}.tmp`;
	await fs.writeFile(tmp, JSON.stringify(config, null, 2), { encoding: "utf-8", mode: 0o644 });
	await fs.rename(tmp, filePath);
}

export function getGlobalConfigPath(agentDir: string): string {
	return path.join(agentDir, "pi-crew.json");
}

export function getProjectConfigPath(cwd: string): string {
	return path.join(cwd, ".pi", "pi-crew.json");
}
