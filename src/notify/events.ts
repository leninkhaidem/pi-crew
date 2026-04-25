import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type {
	PiCrewConfigChangedEvent,
	PiCrewDetachedEvent,
	PiCrewDispatchEvent,
	PiCrewEndEvent,
	PiCrewKilledEvent,
	PiCrewOrphanedEvent,
	PiCrewStartEvent,
} from "../types.js";

export const EV = {
	dispatch: "pi-crew:dispatch",
	start: "pi-crew:start",
	end: "pi-crew:end",
	killed: "pi-crew:killed",
	orphaned: "pi-crew:orphaned",
	detached: "pi-crew:detached",
	configChanged: "pi-crew:config-changed",
} as const;

export interface EventEmitter {
	dispatch(payload: PiCrewDispatchEvent): void;
	start(payload: PiCrewStartEvent): void;
	end(payload: PiCrewEndEvent): void;
	killed(payload: PiCrewKilledEvent): void;
	orphaned(payload: PiCrewOrphanedEvent): void;
	detached(payload: PiCrewDetachedEvent): void;
	configChanged(payload: PiCrewConfigChangedEvent): void;
}

export function createEmitter(pi: ExtensionAPI): EventEmitter {
	return {
		dispatch: (p) => pi.events.emit(EV.dispatch, p),
		start: (p) => pi.events.emit(EV.start, p),
		end: (p) => pi.events.emit(EV.end, p),
		killed: (p) => pi.events.emit(EV.killed, p),
		orphaned: (p) => pi.events.emit(EV.orphaned, p),
		detached: (p) => pi.events.emit(EV.detached, p),
		configChanged: (p) => pi.events.emit(EV.configChanged, p),
	};
}
