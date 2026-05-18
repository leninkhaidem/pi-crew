import { isContextOverflow } from "@mariozechner/pi-ai";

export const OVERFLOW_RECOVERY_FAILED_STOP_REASON = "context_overflow_recovery_failed";
export const OVERFLOW_RECOVERY_TIMEOUT_MS = 30 * 60 * 1000;

const CONTEXT_OVERFLOW_RECOVERY_FAILED = "Context overflow recovery failed";

type RecoveryState = "idle" | "pending" | "recovered" | "unrecovered" | "externally_terminal";
type RecoveryPhase = "none" | "overflow_detected" | "compacting" | "retrying";

export class OverflowRecoveryTracker {
	private state: RecoveryState = "idle";
	private phase: RecoveryPhase = "none";
	private failureMessage: string | null = null;
	private waiters = new Set<() => void>();

	observeEvent(event: unknown): void {
		const ev = asRecord(event);
		if (!ev) return;
		const type = stringField(ev, "type");

		if (type === "compaction_start" && stringField(ev, "reason") === "overflow") {
			this.markPending("compacting");
			return;
		}

		if (type === "compaction_end" && stringField(ev, "reason") === "overflow") {
			this.observeOverflowCompactionEnd(ev);
			return;
		}

		if (type === "message_end") {
			this.observeAssistantMessage(ev.message);
			return;
		}

		if (type === "agent_end" && this.isPending()) {
			const text = extractLastAssistantText(arrayField(ev, "messages"));
			if (text) this.markRecovered();
		}
	}

	observePromptError(errorMessage: string | null): void {
		if (!errorMessage) return;
		if (isContextOverflowMessage(errorMessage) && !this.isPending()) {
			this.markUnrecovered("Context overflow recovery did not start before the session ended.");
		}
	}

	markDisposed(): void {
		if (this.isPending()) {
			this.markUnrecovered("Context overflow recovery interrupted by lifecycle disposal.");
		}
	}

	markExternallyTerminal(): void {
		if (this.isPending()) {
			this.state = "externally_terminal";
			this.phase = "none";
			this.resolveWaiters();
		}
	}

	isPending(): boolean {
		return this.state === "pending";
	}

	getFailureMessage(): string | null {
		return this.state === "unrecovered" ? this.failureMessage : null;
	}

	isRecovered(): boolean {
		return this.state === "recovered";
	}

	async waitForRecoveryCompletion(timeoutMs = OVERFLOW_RECOVERY_TIMEOUT_MS): Promise<void> {
		if (!this.isPending()) return;
		await new Promise<void>((resolve) => {
			let timer: NodeJS.Timeout | null = setTimeout(() => {
				timer = null;
				this.markUnrecovered(this.timeoutMessage());
				resolve();
			}, timeoutMs);
			const waiter = () => {
				if (timer) clearTimeout(timer);
				timer = null;
				this.waiters.delete(waiter);
				resolve();
			};
			this.waiters.add(waiter);
		});
	}

	private observeOverflowCompactionEnd(event: Record<string, unknown>): void {
		if (booleanField(event, "aborted")) {
			this.markUnrecovered("Context overflow recovery compaction was aborted.");
			return;
		}

		if (!booleanField(event, "willRetry")) {
			const detail = stringField(event, "errorMessage") || "compaction completed without scheduling a retry.";
			this.markUnrecovered(`Context overflow recovery did not retry: ${detail}`);
			return;
		}

		this.markPending("retrying");
	}

	private observeAssistantMessage(message: unknown): void {
		const msg = asRecord(message);
		if (!msg || stringField(msg, "role") !== "assistant") return;

		if (isContextOverflowAssistantMessage(msg)) {
			this.markPending("overflow_detected");
			return;
		}

		if (!this.isPending()) return;

		const stopReason = stringField(msg, "stopReason");
		if (stopReason === "stop" && extractFirstText(msg.content)) {
			this.markRecovered();
		} else if (stopReason === "aborted") {
			this.markUnrecovered("Context overflow recovery retry was aborted.");
		} else if (stopReason === "error") {
			const errorMessage = stringField(msg, "errorMessage") || "retry failed.";
			this.markUnrecovered(`Context overflow recovery retry failed: ${errorMessage}`);
		}
	}

	private markPending(phase: Exclude<RecoveryPhase, "none">): void {
		if (this.state === "unrecovered" || this.state === "externally_terminal") return;
		this.state = "pending";
		this.phase = phase;
		this.failureMessage = null;
	}

	private markRecovered(): void {
		if (!this.isPending()) return;
		this.state = "recovered";
		this.phase = "none";
		this.failureMessage = null;
		this.resolveWaiters();
	}

	private markUnrecovered(message: string): void {
		if (this.state === "externally_terminal") return;
		this.state = "unrecovered";
		this.phase = "none";
		this.failureMessage = formatOverflowRecoveryFailure(message);
		this.resolveWaiters();
	}

	private timeoutMessage(): string {
		if (this.phase === "retrying") {
			return "Context overflow recovery retry did not produce output before the idle timeout.";
		}
		if (this.phase === "compacting") {
			return "Context overflow recovery compaction did not complete before the idle timeout.";
		}
		return "Context overflow recovery did not complete before the idle timeout.";
	}

	private resolveWaiters(): void {
		const waiters = [...this.waiters];
		this.waiters.clear();
		for (const waiter of waiters) waiter();
	}
}

export function isOverflowRecoveryEvent(event: unknown): boolean {
	const ev = asRecord(event);
	return Boolean(ev && (ev.type === "compaction_start" || ev.type === "compaction_end") && ev.reason === "overflow");
}

export function overflowRecoveryActivity(event: unknown): string | null {
	const ev = asRecord(event);
	if (!ev || !isOverflowRecoveryEvent(ev)) return null;
	if (ev.type === "compaction_start") return "recovering context overflow…";
	if (booleanField(ev, "aborted")) return "context overflow recovery aborted";
	if (!booleanField(ev, "willRetry")) return "context overflow recovery failed";
	return "retrying after context compaction…";
}

export function formatOverflowRecoveryFailure(message: string): string {
	return message.startsWith(CONTEXT_OVERFLOW_RECOVERY_FAILED)
		? message
		: `${CONTEXT_OVERFLOW_RECOVERY_FAILED}: ${message}`;
}

export function normalizeRecoveredOverflowStopReason(stopReason: string | null | undefined): string | null {
	if (stopReason === "error" || stopReason === OVERFLOW_RECOVERY_FAILED_STOP_REASON) return null;
	return stopReason ?? null;
}

function isContextOverflowAssistantMessage(message: Record<string, unknown>): boolean {
	const errorMessage = stringField(message, "errorMessage");
	return isContextOverflowMessage(errorMessage, message);
}

function isContextOverflowMessage(
	errorMessage: string | undefined | null,
	base: Record<string, unknown> = {},
): boolean {
	if (!errorMessage) return false;
	return isContextOverflow({ ...base, role: "assistant", stopReason: "error", errorMessage } as never);
}

function extractFirstText(content: unknown): string | null {
	if (!Array.isArray(content)) return null;
	for (const part of content) {
		const record = asRecord(part);
		if (record?.type === "text" && typeof record.text === "string" && record.text.trim()) return record.text;
	}
	return null;
}

function extractLastAssistantText(messages: unknown[]): string | null {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = asRecord(messages[i]);
		if (msg?.role === "assistant") {
			const text = extractFirstText(msg.content);
			if (text) return text;
		}
	}
	return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === "string" ? value : undefined;
}

function booleanField(record: Record<string, unknown>, key: string): boolean {
	return record[key] === true;
}

function arrayField(record: Record<string, unknown>, key: string): unknown[] {
	const value = record[key];
	return Array.isArray(value) ? value : [];
}
