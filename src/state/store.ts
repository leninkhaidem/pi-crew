import fs from "node:fs/promises";
import path from "node:path";
import { type SubagentState, defaultThinkingForAgent } from "../types.js";

const READ_RETRIES = 3;
const READ_RETRY_DELAY_MS = 50;

export async function writeState(state: SubagentState): Promise<void> {
	const dir = path.dirname(state.paths.state);
	await fs.mkdir(dir, { recursive: true });
	const tmp = `${state.paths.state}.tmp`;
	await fs.writeFile(tmp, JSON.stringify(state, null, 2), { encoding: "utf-8", mode: 0o600 });
	await fs.rename(tmp, state.paths.state);
}

export async function readState(p: string): Promise<SubagentState | null> {
	for (let attempt = 0; attempt < READ_RETRIES; attempt++) {
		try {
			const raw = await fs.readFile(p, "utf-8");
			return normalizeState(JSON.parse(raw));
		} catch (err) {
			const e = err as NodeJS.ErrnoException;
			if (e.code === "ENOENT") {
				if (attempt === READ_RETRIES - 1) return null;
			} else if (err instanceof SyntaxError) {
				// torn read; rename window
				if (attempt === READ_RETRIES - 1) throw err;
			} else {
				throw err;
			}
			await new Promise((r) => setTimeout(r, READ_RETRY_DELAY_MS));
		}
	}
	return null;
}

function normalizeState(input: unknown): SubagentState {
	const state = input as SubagentState & { thinking?: SubagentState["thinking"] };
	return {
		...state,
		thinking: state.thinking ?? defaultThinkingForAgent(state.agent),
	};
}

export interface ListOptions {
	includeDetached?: boolean;
}

export async function listStates(sessionDir: string, opts: ListOptions = {}): Promise<SubagentState[]> {
	let entries: string[];
	try {
		entries = await fs.readdir(sessionDir);
	} catch (err) {
		const e = err as NodeJS.ErrnoException;
		if (e.code === "ENOENT") return [];
		throw err;
	}
	const out: SubagentState[] = [];
	for (const entry of entries) {
		const stateFile = path.join(sessionDir, entry, "state.json");
		const s = await readState(stateFile);
		if (!s) continue;
		if (s.status === "detached" && !opts.includeDetached) continue;
		out.push(s);
	}
	return out;
}
