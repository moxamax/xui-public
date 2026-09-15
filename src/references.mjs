import { createHash } from "node:crypto";

export const SKILL_PATH = [".agents", "skills", "xui"];
export const REFERENCE_NAMES = ["llms.txt", "llms-full.txt"];

export function hashReference(content) {
  return createHash("sha256").update(content).digest("hex");
}
