import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import { Key, KeybindingsManager, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerConfigCommand } from "../../src/commands/config.js";
import { emptyConfig, parsePiCrewConfig } from "../../src/config/schema.js";
import { runConfigTui } from "../../src/config/tui.js";

const ENTER = "\r";

let tmp: string;

beforeEach(() => {
	tmp = mkdtempSync(path.join(tmpdir(), "pi-crew-config-tui-"));
});

afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
});

describe("runConfigTui", () => {
	it.each([
		{ name: "a scoped pin", scopedThinkingLevel: "high" as const, expectedThinking: "high" },
		{ name: "the unrestricted agent fallback", scopedThinkingLevel: undefined, expectedThinking: "low" },
	])(
		"runs empty persisted config through the registered command and saves $name",
		async ({ scopedThinkingLevel, expectedThinking }) => {
			const configPath = path.join(tmp, "pi-crew.json");
			const selectedScreens: string[][] = [];
			let calls = 0;
			const custom = vi.fn(async (factory: CustomFactory) => {
				calls += 1;
				if (calls === 1) return "session";
				if (calls === 2 || calls === 3) return selectCurrent(factory, selectedScreens);
				return "__skip__";
			});
			let handler: ((args: string, ctx: unknown) => Promise<void>) | undefined;
			const pi = {
				registerCommand: vi.fn((_name: string, command: { handler: typeof handler }) => {
					handler = command.handler;
				}),
			};
			registerConfigCommand(pi as never, { agentDir: tmp } as never);
			const selected = model("example", "reasoner", true, { low: "low", high: "high" });
			const ctx = {
				ui: { custom, notify: vi.fn() },
				modelRegistry: { getAvailable: () => [selected] },
				scopedModels: scopedThinkingLevel ? [{ model: selected, thinkingLevel: scopedThinkingLevel }] : [],
			};

			await handler?.("", ctx);

			expect(selectedLine(selectedScreens[0] ?? [])).toContain("example/reasoner");
			expect(selectedLine(selectedScreens[1] ?? [])).toContain(expectedThinking);
			expect(parseSavedConfig(configPath).agents.explore).toEqual({
				provider: "example",
				modelId: "reasoner",
				thinking: expectedThinking,
			});
		},
	);

	it("shows inherit for every slot and recognizes inherited slots when reopened", async () => {
		const configPath = path.join(tmp, "pi-crew.json");
		const currentConfig = emptyConfig();
		currentConfig.agents.explore = { mode: "inherit" };
		const screens: string[][] = [];
		let calls = 0;
		const custom = vi.fn(async (factory: CustomFactory) => {
			calls += 1;
			if (calls === 1) return "session";
			if (calls === 2) return selectCurrent(factory, screens);
			renderScreen(factory, screens);
			return "__skip__";
		});

		const result = await runConfigTui(mockContext(custom), {
			configPath,
			currentConfig,
			availableModels: [model("anthropic", "claude-haiku-4-5", false)],
		});

		expect(result.saved).toBe(true);
		expect(custom).toHaveBeenCalledTimes(3);
		expect(screens).toHaveLength(2);
		expect(screens.every((screen) => screen.some((line) => line.includes("(inherit parent model/thinking)")))).toBe(
			true,
		);
		expect(selectedLine(screens[0] ?? [])).toContain("(inherit parent model/thinking)");
		expect(parseSavedConfig(configPath).agents.explore).toEqual({ mode: "inherit" });
	});

	it("prompts for thinking when a concrete model is selected", async () => {
		const configPath = path.join(tmp, "pi-crew.json");
		const choices = ["session", "example::reasoner", "minimal", "__skip__"];
		let choiceIndex = 0;
		const custom = vi.fn(async () => choices[choiceIndex++] ?? null);

		const result = await runConfigTui(mockContext(custom), {
			configPath,
			currentConfig: emptyConfig(),
			availableModels: [model("example", "reasoner", true, { minimal: "m" })],
		});

		expect(result.saved).toBe(true);
		expect(custom).toHaveBeenCalledTimes(4);
		expect(parseSavedConfig(configPath).agents.explore).toMatchObject({
			provider: "example",
			modelId: "reasoner",
			thinking: "minimal",
		});
	});

	it("uses the selected scoped-model thinking pin as the picker default", async () => {
		const configPath = path.join(tmp, "pi-crew.json");
		const screens: string[][] = [];
		let calls = 0;
		const custom = vi.fn(async (factory: CustomFactory) => {
			calls += 1;
			if (calls === 1) return "session";
			if (calls === 2) return "example::reasoner";
			if (calls === 3) return selectCurrent(factory, screens);
			return "__skip__";
		});
		const result = await runConfigTui(mockContext(custom), {
			configPath,
			currentConfig: emptyConfig(),
			availableModels: [model("example", "reasoner", true, { high: "high" })],
			scopedThinkingLevels: [{ provider: "example", modelId: "reasoner", thinkingLevel: "high" }],
		});
		expect(result.saved).toBe(true);
		expect(selectedLine(screens[0] ?? [])).toContain("high");
		expect(parseSavedConfig(configPath).agents.explore).toMatchObject({ thinking: "high" });
	});

	it("filters standard and extended holes and preselects stale max's effective lower level", async () => {
		const configPath = path.join(tmp, "pi-crew.json");
		const currentConfig = emptyConfig();
		currentConfig.agents.explore = { provider: "example", modelId: "reasoner", thinking: "max" };
		const screens: string[][] = [];
		let calls = 0;
		const custom = vi.fn(async (factory: CustomFactory) => {
			calls += 1;
			if (calls === 1) return "session";
			if (calls === 2) return "example::reasoner";
			if (calls === 3) return selectCurrent(factory, screens);
			return "__skip__";
		});

		const result = await runConfigTui(mockContext(custom), {
			configPath,
			currentConfig,
			availableModels: [
				model("example", "reasoner", true, {
					off: "off",
					minimal: null,
					low: null,
					medium: null,
					high: "high",
					xhigh: null,
					max: null,
				}),
			],
		});

		expect(result.saved).toBe(true);
		expect(selectedLine(screens[0] ?? [])).toContain("high");
		const thinkingScreen = (screens[0] ?? []).join("\n");
		expect(thinkingScreen).toContain("off");
		expect(thinkingScreen).not.toMatch(/→?\s+minimal\s/);
		expect(thinkingScreen).not.toMatch(/→?\s+xhigh\s/);
		expect(parseSavedConfig(configPath).agents.explore).toMatchObject({ thinking: "high" });
	});

	it.each([
		{ protocol: "legacy Enter", input: ENTER },
		{ protocol: "Kitty Enter", input: "\x1b[13u" },
		{ protocol: "modifyOtherKeys Backspace", input: "\x1b[27;1;127~" },
	])("zero-level $protocol Back returns to model selection without mutating the original slot", async ({ input }) => {
		const configPath = path.join(tmp, "pi-crew.json");
		const currentConfig = emptyConfig();
		currentConfig.agents.explore = { provider: "example", modelId: "zero", thinking: "max" };
		const original = JSON.parse(JSON.stringify(currentConfig));
		const screens: string[][] = [];
		let calls = 0;
		const custom = vi.fn(async (factory: CustomFactory) => {
			calls += 1;
			if (calls === 1) return "session";
			if (calls === 2) return "example::zero";
			if (calls === 3) return interact(factory, screens, input);
			return "__skip__";
		});

		const result = await runConfigTui(mockContext(custom), {
			configPath,
			currentConfig,
			availableModels: [model("example", "zero", true, noLevelsMap())],
		});

		expect(result).toEqual({ saved: true });
		expect((screens[0] ?? []).join("\n")).toContain("advertises no supported thinking levels");
		expect((screens[0] ?? []).join("\n")).toContain("Back");
		expect(selectedLine(screens[0] ?? [])).toBe("");
		expect(currentConfig).toEqual(original);
		expect(parseSavedConfig(configPath).agents.explore).toEqual(original.agents.explore);
	});

	it.each([
		{ cancellation: "legacy Escape", input: "\x1b", configured: false },
		{ cancellation: "configured Ctrl+X", input: "\x18", configured: true },
	])("zero-level $cancellation exits unsaved without a file write or slot mutation", async ({ input, configured }) => {
		const configPath = path.join(tmp, "pi-crew.json");
		const currentConfig = emptyConfig();
		currentConfig.agents.explore = { provider: "example", modelId: "original", thinking: "max" };
		const original = JSON.parse(JSON.stringify(currentConfig));
		const screens: string[][] = [];
		const keybindings = configured
			? new KeybindingsManager(TUI_KEYBINDINGS, { "tui.select.cancel": Key.ctrl("x") })
			: defaultKeybindings;
		let calls = 0;
		const custom = vi.fn(async (factory: CustomFactory) => {
			calls += 1;
			if (calls === 1) return "session";
			if (calls === 2) return "example::zero";
			return interact(factory, screens, input, keybindings);
		});

		const result = await runConfigTui(mockContext(custom), {
			configPath,
			currentConfig,
			availableModels: [model("example", "zero", true, noLevelsMap())],
		});

		expect(result).toEqual({ saved: false });
		expect((screens[0] ?? []).join("\n")).toContain(configured ? "ctrl+x cancel" : "escape/ctrl+c cancel");
		expect(existsSync(configPath)).toBe(false);
		expect(currentConfig).toEqual(original);
	});
});

interface CustomWidget {
	render(width: number): string[];
	invalidate(): void;
	handleInput(data: string): void;
}

interface FakeTheme {
	fg(_name: string, text: string): string;
	bold(text: string): string;
}

interface FakeTui {
	requestRender(): void;
}

type TestKeybindings = Pick<KeybindingsManager, "getKeys" | "matches">;

type CustomFactory = (
	tui: FakeTui,
	theme: FakeTheme,
	keyboard: TestKeybindings,
	done: (value: string | null) => void,
) => CustomWidget;

function mockContext(custom: unknown) {
	return {
		ui: {
			custom,
			notify: vi.fn(),
		},
	} as never;
}

function selectCurrent(factory: CustomFactory, screens: string[][]): string | null {
	let selected: string | null = null;
	const widget = createWidget(factory, (value) => {
		selected = value;
	});
	screens.push(widget.render(120));
	widget.handleInput(ENTER);
	return selected;
}

function renderScreen(factory: CustomFactory, screens: string[][]): void {
	const widget = createWidget(factory, () => undefined);
	screens.push(widget.render(120));
}

function interact(
	factory: CustomFactory,
	screens: string[][],
	input: string,
	keybindings: TestKeybindings = defaultKeybindings,
): string | null {
	let selected: string | null = null;
	const widget = createWidget(
		factory,
		(value) => {
			selected = value;
		},
		keybindings,
	);
	screens.push(widget.render(120));
	widget.handleInput(input);
	return selected;
}

function createWidget(
	factory: CustomFactory,
	done: (value: string | null) => void,
	keybindings: TestKeybindings = defaultKeybindings,
): CustomWidget {
	return factory({ requestRender: () => undefined }, fakeTheme, keybindings, done);
}

const defaultKeybindings = new KeybindingsManager(TUI_KEYBINDINGS);

const fakeTheme: FakeTheme = {
	fg: (_name, text) => text,
	bold: (text) => text,
};

function selectedLine(lines: string[]): string {
	return lines.find((line) => line.includes("→")) ?? "";
}

function parseSavedConfig(configPath: string) {
	const raw = JSON.parse(readFileSync(configPath, "utf-8")) as unknown;
	const result = parsePiCrewConfig(raw);
	if (!result.ok) throw new Error(result.errors.join("\n"));
	return result.value;
}

function model(provider: string, id: string, reasoning: boolean, thinkingLevelMap?: unknown): Model<Api> {
	return {
		provider,
		id,
		reasoning,
		cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
		...(thinkingLevelMap !== undefined ? { thinkingLevelMap } : {}),
	} as Model<Api>;
}

function noLevelsMap(): Record<string, null> {
	return Object.fromEntries(["off", "minimal", "low", "medium", "high", "xhigh", "max"].map((level) => [level, null]));
}
