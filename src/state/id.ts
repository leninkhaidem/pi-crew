import { randomBytes } from "node:crypto";

export function generateAgentId(): string {
	return randomBytes(4).toString("hex");
}
