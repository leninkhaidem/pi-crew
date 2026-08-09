// src/config/tui.ts
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, Key, type SelectItem, SelectList, Text, matchesKey } from "@earendil-works/pi-tui";
import { resolveThinkingLevel, supportsThinkingLevel } from "../thinking.js";
import {
	type AgentSlot,
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
const BACK_CHOICE = "__back__";

export interface ConfigTuiArgs {
	configPath: string;
	currentConfig: PiCrewConfig;
	availableModels: Model<Api>[];
	scopedThinkingLevels?: ReadonlyArray<{ provider: string; modelId: string; thinkingLevel: ThinkingLevel }>;
}

export async function runConfigTui(ctx: ExtensionCommandContext, args: ConfigTuiArgs): Promise<{ saved: boolean }> {
	const cfg: PiCrewConfig = JSON.parse(JSON.stringify(args.currentConfig));

	const executionMode = await selectExecutionMode(ctx, cfg.global.executionMode);
	if (executionMode === null) return { saved: false };
	cfg.global.executionMode = executionMode;

	for (const slot of AGENT_SLOT_NAMES) {
		const original = cfg.agents[slot];
		for (;;) {
			const choice = await selectModel(ctx, slot, args.availableModels, original);
			if (choice === null) return { saved: false };
			if (choice === SKIP_MODEL_CHOICE) break;
			if (choice === INHERIT_MODEL_CHOICE) {
				cfg.agents[slot] = { mode: "inherit" };
				break;
			}

			const selectedModel = args.availableModels.find((model) => modelChoice(model) === choice);
			if (!selectedModel) continue;
			const originalConcrete = isInheritedAgentSlot(original) ? undefined : original;
			const scopedPin = args.scopedThinkingLevels?.find(
				(entry) => entry.provider === selectedModel.provider && entry.modelId === selectedModel.id,
			)?.thinkingLevel;
			const tentative: AgentSlot = {
				provider: selectedModel.provider,
				modelId: selectedModel.id,
				thinking: originalConcrete?.thinking ?? scopedPin ?? defaultThinkingForAgent(slot),
			};
			const thinking = await selectThinking(
				ctx,
				slot,
				selectedModel,
				tentative.thinking ?? defaultThinkingForAgent(slot),
			);
			if (thinking === null) return { saved: false };
			if (thinking === BACK_CHOICE) continue;
			cfg.agents[slot] = { ...tentative, thinking };
			break;
		}
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
	return ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
		const c = new Container();
		c.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		c.addChild(new Text(theme.fg("accent", theme.bold(`pi-crew · ${slot}`)), 1, 0));
		c.addChild(new Text(theme.fg("dim", "Pick a model from your authenticated providers."), 1, 0));
		const list = createSelectList(items, Math.min(items.length, 10), theme);
		list.setSelectedIndex(initialIndex);
		list.onSelect = (item) => done(item.value);
		list.onCancel = () => done(null);
		c.addChild(list);
		c.addChild(new Text(theme.fg("dim", "↑↓ navigate · enter select · esc cancel"), 1, 0));
		c.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		return widget(c, list, tui);
	});
}

function modelSelectionItems(models: Model<Api>[]): SelectItem[] {
	const modelItems = models.map((model) => ({
		value: modelChoice(model),
		label: `${model.provider}/${model.id}`,
		description: model.reasoning ? "reasoning" : "non-reasoning",
	}));
	return [
		{ value: SKIP_MODEL_CHOICE, label: "(skip — leave unchanged/unset)", description: "" },
		{ value: INHERIT_MODEL_CHOICE, label: "(inherit parent model/thinking)", description: "" },
		...modelItems,
	];
}

function modelChoice(model: Pick<Model<Api>, "provider" | "id">): string {
	return `${model.provider}::${model.id}`;
}

function initialModelIndex(items: SelectItem[], current: AgentSlotConfig | undefined): number {
	const currentValue = modelChoiceFor(current);
	return Math.max(
		0,
		items.findIndex((item) => item.value === currentValue),
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
		items.findIndex((item) => item.value === current),
	);
	const choice = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
		const c = new Container();
		c.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		c.addChild(new Text(theme.fg("accent", theme.bold("pi-crew · execution mode")), 1, 0));
		c.addChild(new Text(theme.fg("dim", "Global backend for all sub-agents."), 1, 0));
		c.addChild(new Text(theme.fg("dim", "session = smoother live UI; subprocess = stronger process isolation."), 1, 0));
		const list = createSelectList(items, items.length, theme);
		list.setSelectedIndex(initialIndex);
		list.onSelect = (item) => done(item.value);
		list.onCancel = () => done(null);
		c.addChild(list);
		c.addChild(new Text(theme.fg("dim", "↑↓ navigate · enter select · esc cancel"), 1, 0));
		c.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		return widget(c, list, tui);
	});
	return isExecutionMode(choice) ? choice : null;
}

async function selectThinking(
	ctx: ExtensionCommandContext,
	slot: string,
	model: Model<Api>,
	current: ThinkingLevel,
): Promise<ThinkingLevel | typeof BACK_CHOICE | null> {
	const supported = THINKING_LEVELS.filter((level) => supportsThinkingLevel(model, level));
	if (supported.length === 0) return selectNoThinkingLevel(ctx, slot, model);

	const items: SelectItem[] = supported.map((level) => ({
		value: level,
		label: level,
		description: level === "off" ? "disable reasoning" : "reasoning budget",
	}));
	const effectiveCurrent = pickerCurrentThinking(model, current);
	const initialIndex = Math.max(
		0,
		items.findIndex((item) => item.value === effectiveCurrent),
	);
	const choice = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
		const c = new Container();
		c.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		c.addChild(new Text(theme.fg("accent", theme.bold(`pi-crew · ${slot} thinking`)), 1, 0));
		c.addChild(new Text(theme.fg("dim", `Supported by ${model.provider}/${model.id}.`), 1, 0));
		const list = createSelectList(items, items.length, theme);
		list.setSelectedIndex(initialIndex);
		list.onSelect = (item) => done(item.value);
		list.onCancel = () => done(null);
		c.addChild(list);
		c.addChild(new Text(theme.fg("dim", "↑↓ navigate · enter select · esc cancel"), 1, 0));
		c.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		return widget(c, list, tui);
	});
	return isThinkingLevel(choice) && supported.includes(choice) ? choice : null;
}

function pickerCurrentThinking(model: Model<Api>, current: ThinkingLevel): ThinkingLevel {
	if (supportsThinkingLevel(model, current)) return current;
	if (current === "max") {
		const resolved = resolveThinkingLevel(model, current);
		if (resolved.ok) return resolved.effective;
	}
	return current;
}

async function selectNoThinkingLevel(
	ctx: ExtensionCommandContext,
	slot: string,
	model: Model<Api>,
): Promise<typeof BACK_CHOICE | null> {
	return ctx.ui.custom<typeof BACK_CHOICE | null>((tui, theme, keybindings, done) => {
		const c = new Container();
		c.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		c.addChild(new Text(theme.fg("accent", theme.bold(`pi-crew · ${slot} thinking`)), 1, 0));
		c.addChild(
			new Text(theme.fg("warning", `${model.provider}/${model.id} advertises no supported thinking levels.`), 1, 0),
		);
		c.addChild(
			new Text(theme.fg("dim", "Choose Back to select another model, or Cancel to exit without saving."), 1, 0),
		);
		const backKeys = [...keybindings.getKeys("tui.select.confirm"), Key.left, Key.backspace].join("/");
		const cancelKeys = keybindings.getKeys("tui.select.cancel").join("/");
		c.addChild(new Text(theme.fg("dim", `${backKeys} back · ${cancelKeys} cancel`), 1, 0));
		c.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		return {
			render: (width) => c.render(width),
			invalidate: () => c.invalidate(),
			handleInput: (data) => {
				if (keybindings.matches(data, "tui.select.cancel")) done(null);
				else if (
					keybindings.matches(data, "tui.select.confirm") ||
					matchesKey(data, Key.left) ||
					matchesKey(data, Key.backspace)
				) {
					done(BACK_CHOICE);
				}
				tui.requestRender();
			},
		};
	});
}

function createSelectList(items: SelectItem[], height: number, theme: Theme) {
	return new SelectList(items, height, {
		selectedPrefix: (text) => theme.fg("accent", text),
		selectedText: (text) => theme.fg("accent", text),
		description: (text) => theme.fg("muted", text),
		scrollInfo: (text) => theme.fg("dim", text),
		noMatch: (text) => theme.fg("warning", text),
	});
}

function widget(c: Container, list: SelectList, tui: { requestRender(): void }) {
	return {
		render: (width: number) => c.render(width),
		invalidate: () => c.invalidate(),
		handleInput: (data: string) => {
			list.handleInput(data);
			tui.requestRender();
		},
	};
}

function isThinkingLevel(value: string | null): value is ThinkingLevel {
	return value !== null && (THINKING_LEVELS as readonly string[]).includes(value);
}

function isExecutionMode(value: string | null): value is ExecutionMode {
	return value !== null && (EXECUTION_MODES as readonly string[]).includes(value);
}
