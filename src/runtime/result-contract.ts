const FINAL_RESULT_CONTRACT = [
	"",
	"# Sub-agent final answer contract",
	"Your final assistant message is returned to the parent agent as a compact result summary.",
	"Do not include command logs, raw tool output, full file contents, exhaustive traces, or step-by-step execution history.",
	"Return only the outcome: key findings or changes, important file paths/line references, and caveats/next steps.",
	"Keep the final answer concise (target under 300 words unless the task explicitly asks for a longer artifact).",
	"The full execution trace is stored separately; the parent can inspect it if troubleshooting is needed.",
].join("\n");

export function appendFinalResultContract(systemPrompt: string): string {
	if (systemPrompt.includes("# Sub-agent final answer contract")) return systemPrompt;
	return `${systemPrompt.trimEnd()}\n${FINAL_RESULT_CONTRACT}\n`;
}
