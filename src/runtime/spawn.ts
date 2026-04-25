import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import { resolvePiInvocation } from "./invocation.js";

export interface SpawnArgs {
	binary?: string;
	model: string; // "<provider>/<modelId>" or "<modelId>" depending on caller
	tools: string[] | null;
	systemPromptPath: string;
	task: string;
	cwd: string;
	outputPath: string; // sub-agent stdout file (output.jsonl)
	stderrPath: string; // sub-agent stderr file
	parentAgentId: string;
	sessionId: string;
}

export interface SpawnedSubagent {
	proc: ChildProcess;
	pid: number;
	command: string;
	args: string[];
	openFds: { stdout: number; stderr: number };
}

export function spawnSubagent(args: SpawnArgs): SpawnedSubagent {
	const cliArgs: string[] = [
		"-p",
		"--mode",
		"json",
		"--no-session",
		"--model",
		args.model,
		...(args.tools && args.tools.length > 0 ? ["--tools", args.tools.join(",")] : []),
		"--append-system-prompt",
		args.systemPromptPath,
		`Task: ${args.task}`,
	];
	const inv = resolvePiInvocation({ binary: args.binary, args: cliArgs });

	const stdoutFd = fs.openSync(args.outputPath, "a");
	const stderrFd = fs.openSync(args.stderrPath, "a");

	const proc = spawn(inv.command, inv.args, {
		cwd: args.cwd,
		shell: false,
		stdio: ["ignore", stdoutFd, stderrFd],
		env: {
			...process.env,
			PI_SUBAGENT_PARENT_ID: args.parentAgentId,
			PI_SUBAGENT_SESSION_ID: args.sessionId,
		},
		detached: false,
	});

	const pid = proc.pid;
	if (typeof pid !== "number") {
		fs.closeSync(stdoutFd);
		fs.closeSync(stderrFd);
		throw new Error("spawn produced no pid");
	}
	return {
		proc,
		pid,
		command: inv.command,
		args: inv.args,
		openFds: { stdout: stdoutFd, stderr: stderrFd },
	};
}

/**
 * Close the file descriptors handed off to spawn. Safe to call after the
 * process exits — fd has already been duplicated into the child so closing
 * the parent fd does not affect the child's writes.
 */
export function closeSpawnFds(s: SpawnedSubagent): void {
	for (const fd of [s.openFds.stdout, s.openFds.stderr]) {
		try {
			fs.closeSync(fd);
		} catch {
			// ignore EBADF if already closed
		}
	}
}
