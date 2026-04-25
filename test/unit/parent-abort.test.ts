import { describe, expect, it, vi } from "vitest";
import type { DispatchHandle } from "../../src/runtime/lifecycle.js";
import { createParentAbortTracker } from "../../src/runtime/parent-abort.js";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

function handleOf(agentId: string, donePromise: Promise<unknown>): DispatchHandle {
	return {
		agentId,
		state: { paths: { state: `/tmp/${agentId}/state.json` } },
		donePromise,
	} as DispatchHandle;
}

describe("createParentAbortTracker", () => {
	it("aborts tracked sub-agents when the parent turn signal aborts", async () => {
		const done = deferred<unknown>();
		const abortHandle = vi.fn(async () => undefined);
		const tracker = createParentAbortTracker({ abortHandle, reason: "test interrupt" });
		const controller = new AbortController();
		const handle = handleOf("abc12345", done.promise);

		tracker.track(controller.signal, handle);
		controller.abort();

		await vi.waitFor(() => expect(abortHandle).toHaveBeenCalledTimes(1));
		expect(abortHandle).toHaveBeenCalledWith(handle, "test interrupt");
	});

	it("does not abort a sub-agent that completed before the parent signal aborts", async () => {
		const done = deferred<unknown>();
		const abortHandle = vi.fn(async () => undefined);
		const tracker = createParentAbortTracker({ abortHandle });
		const controller = new AbortController();

		tracker.track(controller.signal, handleOf("abc12345", done.promise));
		done.resolve({});
		await new Promise((resolve) => setTimeout(resolve, 0));
		controller.abort();

		expect(abortHandle).not.toHaveBeenCalled();
	});

	it("aborts immediately when tracking against an already-aborted signal", async () => {
		const abortHandle = vi.fn(async () => undefined);
		const tracker = createParentAbortTracker({ abortHandle });
		const controller = new AbortController();
		const handle = handleOf("abc12345", Promise.resolve({}));
		controller.abort();

		tracker.track(controller.signal, handle);

		await vi.waitFor(() => expect(abortHandle).toHaveBeenCalledTimes(1));
		expect(abortHandle).toHaveBeenCalledWith(handle, "parent ask interrupted");
	});
});
