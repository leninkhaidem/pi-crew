import { describe, expect, it } from "vitest";
import { createApprovalGate } from "../../src/runtime/approval.js";

const mkConfirm = (answer: boolean) => async () => answer;

describe("project-agent approval gate", () => {
	it("auto-approves bundled and user agents", async () => {
		const gate = createApprovalGate({ isConfirmEnabled: () => true });
		expect(await gate({ agentName: "x", agentSource: "bundled", hasUI: true, confirm: mkConfirm(false) })).toBe(true);
		expect(await gate({ agentName: "x", agentSource: "user", hasUI: true, confirm: mkConfirm(false) })).toBe(true);
	});

	it("auto-approves project agents when confirmProjectAgents is false", async () => {
		const gate = createApprovalGate({ isConfirmEnabled: () => false });
		expect(await gate({ agentName: "x", agentSource: "project", hasUI: true, confirm: mkConfirm(false) })).toBe(true);
	});

	it("prompts for project agents and remembers approval", async () => {
		let prompts = 0;
		const gate = createApprovalGate({ isConfirmEnabled: () => true });
		const confirm = async () => {
			prompts++;
			return true;
		};
		expect(await gate({ agentName: "x", agentSource: "project", hasUI: true, confirm })).toBe(true);
		expect(await gate({ agentName: "x", agentSource: "project", hasUI: true, confirm })).toBe(true);
		expect(prompts).toBe(1);
	});

	it("returns false when user declines", async () => {
		const gate = createApprovalGate({ isConfirmEnabled: () => true });
		expect(await gate({ agentName: "x", agentSource: "project", hasUI: true, confirm: mkConfirm(false) })).toBe(false);
	});

	it("refuses without UI", async () => {
		const gate = createApprovalGate({ isConfirmEnabled: () => true });
		expect(await gate({ agentName: "x", agentSource: "project", hasUI: false, confirm: mkConfirm(true) })).toBe(false);
	});

	it("reset clears approvals", async () => {
		let prompts = 0;
		const gate = createApprovalGate({ isConfirmEnabled: () => true });
		const confirm = async () => {
			prompts++;
			return true;
		};
		await gate({ agentName: "x", agentSource: "project", hasUI: true, confirm });
		gate.reset();
		await gate({ agentName: "x", agentSource: "project", hasUI: true, confirm });
		expect(prompts).toBe(2);
	});

	it("dedupes concurrent prompts for the same agent", async () => {
		let prompts = 0;
		let resolveFirst: ((v: boolean) => void) | null = null;
		const gate = createApprovalGate({ isConfirmEnabled: () => true });
		const confirm = () =>
			new Promise<boolean>((resolve) => {
				prompts++;
				resolveFirst = resolve;
			});
		const a = gate({ agentName: "x", agentSource: "project", hasUI: true, confirm });
		// Yield so gate(a) can advance past isConfirmEnabled and register in inflight
		await Promise.resolve();
		const b = gate({ agentName: "x", agentSource: "project", hasUI: true, confirm });
		// Yield again so gate(a) can advance to confirm() and gate(b) can attach to in-flight promise
		await Promise.resolve();
		// Both should be waiting on the same prompt
		expect(prompts).toBe(1);
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		resolveFirst!(true);
		expect(await a).toBe(true);
		expect(await b).toBe(true);
	});
});
