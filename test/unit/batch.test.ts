import { describe, expect, it } from "vitest";
import { createBatchTracker } from "../../src/runtime/batch.js";

describe("createBatchTracker", () => {
	it("keeps dispatches after the same user message in one current batch", () => {
		let seq = 0;
		const tracker = createBatchTracker({ idFactory: () => `batch-${++seq}` });
		tracker.noteUserMessage("sess");

		const first = tracker.beginDispatch("sess");
		const second = tracker.beginDispatch("sess");

		expect(second).toBe(first);
		expect(tracker.currentBatchId("sess")).toBe(first);
	});

	it("keeps dispatches in one batch across multiple assistant turns for the same user request", () => {
		let seq = 0;
		const tracker = createBatchTracker({ idFactory: () => `batch-${++seq}` });
		tracker.noteUserMessage("sess");
		tracker.noteTurn("sess", 1);
		const first = tracker.beginDispatch("sess");

		tracker.noteTurn("sess", 2);
		const second = tracker.beginDispatch("sess");

		expect(second).toBe(first);
		expect(tracker.currentBatchId("sess")).toBe(first);
	});

	it("starts a new current batch on the first dispatch after a later user message", () => {
		let seq = 0;
		const tracker = createBatchTracker({ idFactory: () => `batch-${++seq}` });
		tracker.noteUserMessage("sess");
		const first = tracker.beginDispatch("sess");

		tracker.noteUserMessage("sess");
		expect(tracker.currentBatchId("sess")).toBe(first);
		const second = tracker.beginDispatch("sess");

		expect(second).not.toBe(first);
		expect(tracker.currentBatchId("sess")).toBe(second);
	});
});
