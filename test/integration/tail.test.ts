import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tailJsonl } from "../../src/runtime/tail.js";

let tmp: string;
beforeEach(() => {
	tmp = mkdtempSync(path.join(tmpdir(), "pi-crew-tail-"));
});
afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
});

describe("tailJsonl", () => {
	it("captures lines written after start", async () => {
		const target = path.join(tmp, "out.jsonl");
		writeFileSync(target, "");
		const events: unknown[] = [];
		const handle = tailJsonl({
			path: target,
			onEvent: (e) => events.push(e),
			pollIntervalMs: 30,
		});
		await new Promise((r) => setTimeout(r, 50));
		const fd = openSync(target, "a");
		writeSync(fd, `{"a":1}\n{"b":2}\n`);
		closeSync(fd);
		await new Promise((r) => setTimeout(r, 200));
		await handle.stop();
		expect(events).toEqual([{ a: 1 }, { b: 2 }]);
	});

	it("survives missing file at startup", async () => {
		const target = path.join(tmp, "later.jsonl");
		const events: unknown[] = [];
		const handle = tailJsonl({
			path: target,
			onEvent: (e) => events.push(e),
			pollIntervalMs: 30,
		});
		await new Promise((r) => setTimeout(r, 80));
		writeFileSync(target, `{"x":1}\n`);
		await new Promise((r) => setTimeout(r, 200));
		await handle.stop();
		expect(events).toEqual([{ x: 1 }]);
	});
});
