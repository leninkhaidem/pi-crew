// test/fixtures/mock-pi.ts
/**
 * Mock pi for integration tests.
 *
 * Reads MOCK_PI_SCRIPT env var (path to a JSON file containing { events, exitCode, stderr? }).
 * Emits events on stdout one per line, then exits with exitCode.
 */
import { readFileSync } from "node:fs";

interface Script {
	events: unknown[];
	exitCode: number;
	stderr?: string;
	delayMs?: number;
}

function main() {
	const scriptPath = process.env.MOCK_PI_SCRIPT;
	if (!scriptPath) {
		process.stderr.write("MOCK_PI_SCRIPT env not set\n");
		process.exit(2);
	}
	const script = JSON.parse(readFileSync(scriptPath, "utf-8")) as Script;
	if (script.stderr) process.stderr.write(script.stderr);
	let i = 0;
	const tick = () => {
		if (i >= script.events.length) {
			process.exit(script.exitCode);
			return;
		}
		const ev = script.events[i++];
		process.stdout.write(`${JSON.stringify(ev)}\n`);
		setTimeout(tick, script.delayMs ?? 5);
	};
	tick();
}

main();
