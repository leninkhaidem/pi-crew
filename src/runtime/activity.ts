const TOOL_DISPLAY: Record<string, string> = {
	read: "reading",
	bash: "running command",
	edit: "editing",
	write: "writing",
	grep: "searching",
	find: "finding files",
	ls: "listing files",
};

export function describeActivity(activeTools: Map<string, string>, responseText?: string | null): string {
	if (activeTools.size > 0) {
		const groups = new Map<string, number>();
		for (const toolName of activeTools.values()) {
			const action = TOOL_DISPLAY[toolName] ?? toolName;
			groups.set(action, (groups.get(action) ?? 0) + 1);
		}
		return [...groups.entries()].map(([action, count]) => (count > 1 ? `${action} ${count}` : action)).join(", ");
	}
	const firstLine = responseText
		?.split("\n")
		.find((line) => line.trim())
		?.trim();
	return firstLine ? firstLine.slice(0, 160) : "thinking…";
}
