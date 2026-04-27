import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Api, Model } from "@mariozechner/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
		const choices = ["session", "anthropic::claude-haiku-4-5", "minimal", "__skip__"];
		let choiceIndex = 0;
		const custom = vi.fn(async () => choices[choiceIndex++] ?? null);

		const result = await runConfigTui(mockContext(custom), {
			configPath,
			currentConfig: emptyConfig(),
			availableModels: [model("anthropic", "claude-haiku-4-5", false)],
		});

		expect(result.saved).toBe(true);
		expect(custom).toHaveBeenCalledTimes(4);
		expect(parseSavedConfig(configPath).agents.explore).toMatchObject({
			provider: "anthropic",
			modelId: "claude-haiku-4-5",
			thinking: "minimal",
		});
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

type CustomFactory = (
	tui: FakeTui,
	theme: FakeTheme,
	keyboard: unknown,
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

function createWidget(factory: CustomFactory, done: (value: string | null) => void): CustomWidget {
	return factory({ requestRender: () => undefined }, fakeTheme, undefined, done);
}

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

function model(provider: string, id: string, reasoning: boolean): Model<Api> {
	return {
		provider,
		id,
		reasoning,
		cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
	} as Model<Api>;
}
