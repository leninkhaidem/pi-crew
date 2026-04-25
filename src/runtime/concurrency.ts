// src/runtime/concurrency.ts
/**
 * Session-scoped concurrency primitives:
 *   - PoolLimiter caps simultaneous in-flight async tasks (used by parallel-mode runs).
 *   - ActiveCounter tracks total non-terminal sub-agents (backstop ceiling).
 */

export interface PoolLimiter {
	run<T>(fn: () => Promise<T>): Promise<T>;
	setMax(n: number): void;
	getMax(): number;
}

export function createPoolLimiter(initialMax: number): PoolLimiter {
	let max = Math.max(1, initialMax);
	let active = 0;
	const queue: Array<() => void> = [];

	const drain = () => {
		while (active < max && queue.length > 0) {
			const next = queue.shift();
			if (next) next();
		}
	};

	const acquire = async (): Promise<void> => {
		if (active < max) {
			active++;
			return;
		}
		await new Promise<void>((resolve) => queue.push(resolve));
		active++;
	};

	const release = (): void => {
		active = Math.max(0, active - 1);
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
		setMax(n: number) {
			max = Math.max(1, n);
			drain();
		},
		getMax() {
			return max;
		},
	};
}

export interface ActiveCounter {
	tryAcquire(): boolean;
	release(): void;
	current(): number;
	setMax(n: number): void;
	getMax(): number;
}

export function createActiveCounter(initialMax: number): ActiveCounter {
	let max = Math.max(1, initialMax);
	let active = 0;
	return {
		tryAcquire(): boolean {
			if (active >= max) return false;
			active++;
			return true;
		},
		release(): void {
			active = Math.max(0, active - 1);
		},
		current(): number {
			return active;
		},
		setMax(n: number) {
			max = Math.max(1, n);
		},
		getMax() {
			return max;
		},
	};
}
