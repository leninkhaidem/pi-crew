import { describe, expect, it } from "vitest";
import { createActiveCounter, createPoolLimiter } from "../../src/runtime/concurrency.js";

describe("PoolLimiter", () => {
	it("limits simultaneous in-flight tasks", async () => {
		const limit = 2;
		const pool = createPoolLimiter(limit);
		let inflight = 0;
		let peak = 0;
		const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

		const tasks = Array.from({ length: 6 }, (_, i) =>
			pool.run(async () => {
				inflight++;
				peak = Math.max(peak, inflight);
				await sleep(20);
				inflight--;
				return i;
			}),
		);

		const results = await Promise.all(tasks);
		expect(results.sort()).toEqual([0, 1, 2, 3, 4, 5]);
		expect(peak).toBeLessThanOrEqual(limit);
	});

	it("releases on rejection", async () => {
		const pool = createPoolLimiter(1);
		await expect(
			pool.run(async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		// next task should still run
		const r = await pool.run(async () => 42);
		expect(r).toBe(42);
	});

	it("PoolLimiter.setMax raises capacity and drains queue", async () => {
		const pool = createPoolLimiter(1);
		let inflight = 0;
		let peak = 0;
		const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
		const tasks = Array.from({ length: 4 }, () =>
			pool.run(async () => {
				inflight++;
				peak = Math.max(peak, inflight);
				await sleep(20);
				inflight--;
			}),
		);
		pool.setMax(4);
		await Promise.all(tasks);
		expect(peak).toBeGreaterThanOrEqual(2); // confirms drain unblocked queued tasks
	});
});

describe("ActiveCounter", () => {
	it("tracks current and refuses past max", () => {
		const c = createActiveCounter(2);
		expect(c.tryAcquire()).toBe(true);
		expect(c.tryAcquire()).toBe(true);
		expect(c.current()).toBe(2);
		expect(c.tryAcquire()).toBe(false);
		c.release();
		expect(c.tryAcquire()).toBe(true);
	});

	it("release floors at zero", () => {
		const c = createActiveCounter(2);
		c.release();
		c.release();
		expect(c.current()).toBe(0);
	});

	it("ActiveCounter.setMax adjusts cap", () => {
		const c = createActiveCounter(2);
		expect(c.tryAcquire()).toBe(true);
		expect(c.tryAcquire()).toBe(true);
		expect(c.tryAcquire()).toBe(false);
		c.setMax(4);
		expect(c.tryAcquire()).toBe(true);
		expect(c.tryAcquire()).toBe(true);
		expect(c.tryAcquire()).toBe(false);
	});
});
