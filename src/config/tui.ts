// src/config/tui.ts
import type { Api, Model } from "@mariozechner/pi-ai";
import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Container, type SelectItem, SelectList, Text } from "@mariozechner/pi-tui";
import {
	type AgentSlotConfig,
	EXECUTION_MODES,
	type ExecutionMode,
	type PiCrewConfig,
	THINKING_LEVELS,
	type ThinkingLevel,
	defaultThinkingForAgent,
	isInheritedAgentSlot,
} from "../types.js";
import { AGENT_SLOT_NAMES } from "./auto.js";
import { saveConfig } from "./store.js";

const SKIP_MODEL_CHOICE = "__skip__";
const INHERIT_MODEL_CHOICE = "__inherit__";

export interface ConfigTuiArgs {
	configPath: string;
	currentConfig: PiCrewConfig;
	availableModels: Model<Api>[];
}

export async function runConfigTui(ctx: ExtensionCommandContext, args: ConfigTuiArgs): Promise<{ saved: boolean }> {
	const cfg: PiCrewConfig = JSON.parse(JSON.stringify(args.currentConfig));

	const executionMode = await selectExecutionMode(ctx, cfg.global.executionMode);
	if (executionMode === null) return { saved: false };
	cfg.global.executionMode = executionMode;

	for (const slot of AGENT_SLOT_NAMES) {
		const current = cfg.agents[slot];
		const currentConcrete = isInheritedAgentSlot(current) ? undefined : current;
		const choice = await selectModel(ctx, slot, args.availableModels, current);

		if (choice === null) return { saved: false };
		if (choice === SKIP_MODEL_CHOICE) continue;
		if (choice === INHERIT_MODEL_CHOICE) {
			cfg.agents[slot] = { mode: "inherit" };
			continue;
		}
		const [provider, modelId] = choice.split("::");
		if (provider && modelId) {
			cfg.agents[slot] = {
				provider,
				modelId,
				thinking: currentConcrete?.thinking ?? defaultThinkingForAgent(slot),
			};
		}

		const configured = cfg.agents[slot];
		if (!configured || isInheritedAgentSlot(configured)) continue;
		const thinking = await selectThinking(ctx, slot, configured.thinking ?? defaultThinkingForAgent(slot));
		if (thinking === null) return { saved: false };
		configured.thinking = thinking;
	}

	await saveConfig(args.configPath, cfg);
	ctx.ui.notify("pi-crew config saved.", "info");
	return { saved: true };
}

async function selectModel(
	ctx: ExtensionCommandContext,
	slot: string,
	models: Model<Api>[],
	current: AgentSlotConfig | undefined,
): Promise<string | null> {
	const items = modelSelectionItems(models);
	const initialIndex = initialModelIndex(items, current);
	const choice = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
		const c = new Container();
		c.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		c.addChild(new Text(theme.fg("accent", theme.bold(`pi-crew · ${slot}`)), 1, 0));
		c.addChild(new Text(theme.fg("dim", "Pick a model from your authenticated providers."), 1, 0));
		const list = new SelectList(items, Math.min(items.length, 10), {
			selectedPrefix: (t) => theme.fg("accent", t),
			selectedText: (t) => theme.fg("accent", t),
			description: (t) => theme.fg("muted", t),
			scrollInfo: (t) => theme.fg("dim", t),
			noMatch: (t) => theme.fg("dim", t),
		});
		list.setSelectedIndex(initialIndex);
		list.onSelect = (item) => done(item.value);
		list.onCancel = () => done(null);
		c.addChild(list);
		c.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		return {
			render: (w) => c.render(w),
			invalidate: () => c.invalidate(),
			handleInput: (data) => {
				list.handleInput(data);
				tui.requestRender();
			},
		};
	});
	return choice;
}

function modelSelectionItems(models: Model<Api>[]): SelectItem[] {
	const modelItems = models.map((m) => ({
		value: `${m.provider}::${m.id}`,
		label: `${m.provider}/${m.id}`,
		description: m.reasoning ? "reasoning" : "non-reasoning",
	}));
	return [
		{ value: SKIP_MODEL_CHOICE, label: "(skip — leave unchanged/unset)", description: "" },
		{ value: INHERIT_MODEL_CHOICE, label: "(inherit parent model/thinking)", description: "" },
		...modelItems,
	];
}

function initialModelIndex(items: SelectItem[], current: AgentSlotConfig | undefined): number {
	const currentValue = modelChoiceFor(current);
	return Math.max(
		0,
		items.findIndex((i) => i.value === currentValue),
	);
}

function modelChoiceFor(current: AgentSlotConfig | undefined): string {
	if (isInheritedAgentSlot(current)) return INHERIT_MODEL_CHOICE;
	return current ? `${current.provider}::${current.modelId}` : SKIP_MODEL_CHOICE;
}

async function selectExecutionMode(
	ctx: ExtensionCommandContext,
	current: ExecutionMode,
): Promise<ExecutionMode | null> {
	const items: SelectItem[] = EXECUTION_MODES.map((mode) => ({
		value: mode,
		label: mode,
		description:
			mode === "session"
				? "recommended — best live UX via createAgentSession"
				: "compatibility — child process isolation and tmux transcript viewer",
	}));
	const initialIndex = Math.max(
		0,
		items.findIndex((i) => i.value === current),
	);
	const choice = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
		const c = new Container();
		c.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		c.addChild(new Text(theme.fg("accent", theme.bold("pi-crew · execution mode")), 1, 0));
		c.addChild(new Text(theme.fg("dim", "Global backend for all sub-agents."), 1, 0));
		c.addChild(new Text(theme.fg("dim", "session = smoother live UI; subprocess = stronger process isolation."), 1, 0));
		const list = new SelectList(items, items.length, {
			selectedPrefix: (t) => theme.fg("accent", t),
			selectedText: (t) => theme.fg("accent", t),
			description: (t) => theme.fg("muted", t),
			scrollInfo: (t) => theme.fg("dim", t),
			noMatch: (t) => theme.fg("dim", t),
		});
		list.setSelectedIndex(initialIndex);
		list.onSelect = (item) => done(item.value);
		list.onCancel = () => done(null);
		c.addChild(list);
		c.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		return {
			render: (w) => c.render(w),
			invalidate: () => c.invalidate(),
			handleInput: (data) => {
				list.handleInput(data);
				tui.requestRender();
			},
		};
	});
	return isExecutionMode(choice) ? choice : null;
}

async function selectThinking(
	ctx: ExtensionCommandContext,
	slot: string,
	current: ThinkingLevel,
): Promise<ThinkingLevel | null> {
	const items: SelectItem[] = THINKING_LEVELS.map((level) => ({
		value: level,
		label: level,
		description: level === "off" ? "disable reasoning" : "reasoning budget",
	}));
	const initialIndex = Math.max(
		0,
		items.findIndex((i) => i.value === current),
	);
	const choice = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
		const c = new Container();
		c.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		c.addChild(new Text(theme.fg("accent", theme.bold(`pi-crew · ${slot} thinking`)), 1, 0));
		c.addChild(new Text(theme.fg("dim", "Pick the reasoning budget for this sub-agent slot."), 1, 0));
		const list = new SelectList(items, items.length, {
			selectedPrefix: (t) => theme.fg("accent", t),
			selectedText: (t) => theme.fg("accent", t),
			description: (t) => theme.fg("muted", t),
			scrollInfo: (t) => theme.fg("dim", t),
			noMatch: (t) => theme.fg("dim", t),
		});
		list.setSelectedIndex(initialIndex);
		list.onSelect = (item) => done(item.value);
		list.onCancel = () => done(null);
		c.addChild(list);
		c.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		return {
			render: (w) => c.render(w),
			invalidate: () => c.invalidate(),
			handleInput: (data) => {
				list.handleInput(data);
				tui.requestRender();
			},
		};
	});
	return isThinkingLevel(choice) ? choice : null;
}

function isThinkingLevel(value: string | null): value is ThinkingLevel {
	return value !== null && (THINKING_LEVELS as readonly string[]).includes(value);
}

function isExecutionMode(value: string | null): value is ExecutionMode {
	return value !== null && (EXECUTION_MODES as readonly string[]).includes(value);
}
