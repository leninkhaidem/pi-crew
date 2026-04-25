import { describe, expect, it } from "vitest";
import { parseAgentMarkdown } from "../../src/agents/frontmatter.js";

describe("parseAgentMarkdown", () => {
	it("extracts frontmatter and body", () => {
		const md = "---\nname: explore\ndescription: do recon\ntools: read, grep\n---\n\nbody text here";
		const r = parseAgentMarkdown(md, "/fake/path.md");
		expect(r).not.toBeNull();
		expect(r?.name).toBe("explore");
		expect(r?.description).toBe("do recon");
		expect(r?.tools).toEqual(["read", "grep"]);
		expect(r?.systemPrompt).toContain("body text here");
	});

	it("returns null when name or description missing", () => {
		expect(parseAgentMarkdown("---\ndescription: x\n---\nbody", "/x")).toBeNull();
		expect(parseAgentMarkdown("---\nname: x\n---\nbody", "/x")).toBeNull();
	});

	it("tools field is null when omitted", () => {
		const r = parseAgentMarkdown("---\nname: a\ndescription: b\n---\nbody", "/x");
		expect(r?.tools).toBeNull();
	});

	it("trims whitespace from each tool", () => {
		const r = parseAgentMarkdown("---\nname: a\ndescription: b\ntools:  read , grep,find ,\n---\nbody", "/x");
		expect(r?.tools).toEqual(["read", "grep", "find"]);
	});
});
