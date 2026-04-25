import { parseFrontmatter } from "@mariozechner/pi-coding-agent";

export interface ParsedAgent {
	name: string;
	description: string;
	tools: string[] | null;
	systemPrompt: string;
}

export function parseAgentMarkdown(content: string, _filePath: string): ParsedAgent | null {
	const { frontmatter, body } = parseFrontmatter<Record<string, string>>(content);
	if (!frontmatter.name || !frontmatter.description) return null;
	const toolsRaw = frontmatter.tools;
	const tools =
		toolsRaw && toolsRaw.trim().length > 0
			? toolsRaw
					.split(",")
					.map((t) => t.trim())
					.filter(Boolean)
			: null;
	return {
		name: frontmatter.name,
		description: frontmatter.description,
		tools,
		systemPrompt: body,
	};
}
