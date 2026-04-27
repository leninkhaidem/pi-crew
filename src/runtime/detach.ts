// src/runtime/detach.ts
/**
 * Detach controller — coordinates the signal path from TUI keyboard input
 * to blocking tool executions. Each blocking tool call creates a scope;
 * pressing Ctrl+B calls detachAll() which resolves all scope promises,
 * releasing the tools' awaits without stopping the sub-agent processes.
 */

export interface DetachScope {
	/** Resolves when the user triggers a detach (Ctrl+B). */
	detached: Promise<void>;
	/** Manually resolves the scope's promise and removes it from the controller. */
	resolve(): void;
	/** Removes the scope from the controller without resolving its promise. */
	dispose(): void;
}

export interface DetachController {
	/** Creates a new scope that will be resolved by the next detachAll() call. */
	createScope(): DetachScope;
	/** Resolves all active scopes' promises and clears them. No-op when empty. */
	detachAll(): void;
	/** Returns true when at least one scope is registered. */
	hasActiveScopes(): boolean;
}

export function createDetachController(): DetachController {
	const activeScopes = new Map<DetachScope, () => void>();

	return {
		createScope(): DetachScope {
			let resolveDetached!: () => void;
			const detached = new Promise<void>((res) => {
				resolveDetached = res;
			});

			const scope: DetachScope = {
				detached,
				resolve() {
					activeScopes.delete(scope);
					resolveDetached();
				},
				dispose() {
					activeScopes.delete(scope);
				},
			};

			activeScopes.set(scope, resolveDetached);
			return scope;
		},

		detachAll() {
			if (activeScopes.size === 0) return;
			const resolvers = [...activeScopes.values()];
			activeScopes.clear();
			for (const resolve of resolvers) {
				resolve();
			}
		},

		hasActiveScopes() {
			return activeScopes.size > 0;
		},
	};
}
