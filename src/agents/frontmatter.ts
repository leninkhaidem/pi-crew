import { parseFrontmatter } from "@mariozechner/pi-coding-agent";

export interface ParsedAgent {
	name: string;
	description: string;
	tools: string[] | null;
	systemPrompt: string;
}

export function parseAgentMarkdown(content: string, _filePath: string): ParsedAgent | null {
	try {
		const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(content);
		if (!frontmatter.name || !frontmatter.description) return null;
		const toolsRaw = frontmatter.tools;
		let tools: string[] | null = null;
		if (Array.isArray(toolsRaw)) {
			tools = toolsRaw.map((t) => String(t).trim()).filter(Boolean);
		} else if (typeof toolsRaw === "string" && toolsRaw.trim().length > 0) {
			tools = toolsRaw
				.split(",")
				.map((t) => t.trim())
				.filter(Boolean);
		}
		if (tools && tools.length === 0) tools = null;
		return {
			name: String(frontmatter.name),
			description: String(frontmatter.description),
			tools,
			systemPrompt: body,
		};
	} catch {
		return null;
	}
}
