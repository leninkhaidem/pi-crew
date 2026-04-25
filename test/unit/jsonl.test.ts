import { describe, expect, it } from "vitest";
import { createJsonlParser } from "../../src/runtime/jsonl.js";

describe("createJsonlParser", () => {
	it("emits one event per complete line", () => {
		const events: unknown[] = [];
		const p = createJsonlParser((e) => events.push(e));
		p.write(`{"a":1}\n{"a":2}\n`);
		expect(events).toEqual([{ a: 1 }, { a: 2 }]);
	});

	it("buffers partial lines across writes", () => {
		const events: unknown[] = [];
		const p = createJsonlParser((e) => events.push(e));
		p.write(`{"a":`);
		p.write(`1}\n{"b":2}\n`);
		expect(events).toEqual([{ a: 1 }, { b: 2 }]);
	});

	it("ignores blank lines", () => {
		const events: unknown[] = [];
		const p = createJsonlParser((e) => events.push(e));
		p.write(`\n{"x":1}\n\n\n{"y":2}\n`);
		expect(events).toEqual([{ x: 1 }, { y: 2 }]);
	});

	it("skips malformed lines without throwing", () => {
		const events: unknown[] = [];
		const errors: string[] = [];
		const p = createJsonlParser(
			(e) => events.push(e),
			(line, err) => errors.push(`${line}::${(err as Error).message}`),
		);
		p.write(`bogus\n{"x":1}\n`);
		expect(events).toEqual([{ x: 1 }]);
		expect(errors.length).toBe(1);
	});

	it("flush emits trailing line if no newline", () => {
		const events: unknown[] = [];
		const p = createJsonlParser((e) => events.push(e));
		p.write(`{"a":1}`);
		p.flush();
		expect(events).toEqual([{ a: 1 }]);
	});

	it("handles unicode multibyte split across chunks", () => {
		const events: unknown[] = [];
		const p = createJsonlParser((e) => events.push(e));
		const buf = Buffer.from(`{"x":"héllo"}\n`, "utf-8");
		const split = Math.floor(buf.length / 2);
		p.write(buf.subarray(0, split));
		p.write(buf.subarray(split));
		expect(events).toEqual([{ x: "héllo" }]);
	});
});
