// src/config/tui.ts
import type { Api, Model } from "@mariozechner/pi-ai";
import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Container, type SelectItem, SelectList, Text } from "@mariozechner/pi-tui";
import { type PiCrewConfig, THINKING_LEVELS, type ThinkingLevel, defaultThinkingForAgent } from "../types.js";
import { AGENT_SLOT_NAMES } from "./auto.js";
import { saveConfig } from "./store.js";

export interface ConfigTuiArgs {
	configPath: string;
	currentConfig: PiCrewConfig;
	availableModels: Model<Api>[];
}

export async function runConfigTui(ctx: ExtensionCommandContext, args: ConfigTuiArgs): Promise<{ saved: boolean }> {
	const cfg: PiCrewConfig = JSON.parse(JSON.stringify(args.currentConfig));

	for (const slot of AGENT_SLOT_NAMES) {
		const items: SelectItem[] = args.availableModels.map((m) => ({
			value: `${m.provider}::${m.id}`,
			label: `${m.provider}/${m.id}`,
			description: m.reasoning ? "reasoning" : "non-reasoning",
		}));
		items.unshift({ value: "__skip__", label: "(skip — leave unchanged/unset)", description: "" });

		const current = cfg.agents[slot];
		const initialIndex = current
			? Math.max(
					0,
					items.findIndex((i) => i.value === `${current.provider}::${current.modelId}`),
				)
			: 0;

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

		if (choice === null) return { saved: false };
		if (choice === "__skip__") continue;
		const [provider, modelId] = choice.split("::");
		if (provider && modelId) {
			cfg.agents[slot] = {
				provider,
				modelId,
				thinking: cfg.agents[slot]?.thinking ?? defaultThinkingForAgent(slot),
			};
		}

		const configured = cfg.agents[slot];
		if (!configured) continue;
		const thinking = await selectThinking(ctx, slot, configured.thinking ?? defaultThinkingForAgent(slot));
		if (thinking === null) return { saved: false };
		configured.thinking = thinking;
	}

	await saveConfig(args.configPath, cfg);
	ctx.ui.notify("pi-crew config saved.", "info");
	return { saved: true };
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
