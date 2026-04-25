// src/runtime/concurrency.ts
/**
 * Session-scoped concurrency primitives:
 *   - PoolLimiter caps simultaneous in-flight async tasks (used by parallel-mode runs).
 *   - ActiveCounter tracks total non-terminal sub-agents (backstop ceiling).
 */

export interface PoolLimiter {
	run<T>(fn: () => Promise<T>): Promise<T>;
}

export function createPoolLimiter(maxConcurrent: number): PoolLimiter {
	let active = 0;
	const queue: Array<() => void> = [];

	const acquire = async (): Promise<void> => {
		if (active < maxConcurrent) {
			active++;
			return;
		}
		await new Promise<void>((resolve) => queue.push(resolve));
		active++;
	};

	const release = (): void => {
		active--;
		const next = queue.shift();
		if (next) next();
	};

	return {
		async run<T>(fn: () => Promise<T>): Promise<T> {
			await acquire();
			try {
				return await fn();
			} finally {
				release();
			}
		},
	};
}

export interface ActiveCounter {
	tryAcquire(): boolean;
	release(): void;
	current(): number;
}

export function createActiveCounter(maxActive: number): ActiveCounter {
	let active = 0;
	return {
		tryAcquire(): boolean {
			if (active >= maxActive) return false;
			active++;
			return true;
		},
		release(): void {
			active = Math.max(0, active - 1);
		},
		current(): number {
			return active;
		},
	};
}
