import { describe, expect, it } from "vitest";
import { resolvePiInvocation } from "../../src/runtime/invocation.js";

describe("resolvePiInvocation", () => {
	it("uses provided binary when set", () => {
		const r = resolvePiInvocation({ binary: "/usr/bin/pi", args: ["-p"] });
		expect(r.command).toBe("/usr/bin/pi");
		expect(r.args).toEqual(["-p"]);
	});

	it("defaults to PATH lookup of 'pi' when no binary given", () => {
		const r = resolvePiInvocation({ args: ["-p"] });
		expect(r.command).toBe("pi");
		expect(r.args).toEqual(["-p"]);
	});

	it("respects PI_CREW_PI_BINARY env var", () => {
		const prev = process.env.PI_CREW_PI_BINARY;
		process.env.PI_CREW_PI_BINARY = "/custom/pi";
		try {
			const r = resolvePiInvocation({ args: ["-p"] });
			expect(r.command).toBe("/custom/pi");
		} finally {
			if (prev) process.env.PI_CREW_PI_BINARY = prev;
			// biome-ignore lint/performance/noDelete: env var must actually be removed
			else delete process.env.PI_CREW_PI_BINARY;
		}
	});
});
