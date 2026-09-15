import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify, stripVTControlCharacters } from "node:util";

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL("../bin/xui.mjs", import.meta.url));
const MAX_FAILURE_LENGTH = 7_500;

export async function getStopHookResult(
  input,
  { consumerRoot = process.cwd(), runCheck = runXuiCheck } = {},
) {
  if (!isRecord(input) || typeof input.stop_hook_active !== "boolean") {
    return {
      continue: true,
      systemMessage:
        "xui Stop hook skipped because the provider input is invalid.",
    };
  }

  try {
    await runCheck(consumerRoot);
    return undefined;
  } catch (error) {
    const details = getFailureDetails(error);

    if (!input.stop_hook_active) {
      return {
        decision: "block",
        reason:
          "xui check failed. Diagnose and fix every reported error, then rerun `xui check` before stopping.\n\n" +
          details,
      };
    }

    return {
      continue: true,
      systemMessage:
        "xui check still failed after one Stop-hook continuation. The retry loop is ending so the agent can report the blocker.\n\n" +
        details,
    };
  }
}

export async function runXuiCheck(consumerRoot) {
  await execFileAsync(process.execPath, [CLI_PATH, "check"], {
    cwd: consumerRoot,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
}

function getFailureDetails(error) {
  const output = [];

  if (error && typeof error === "object") {
    if (typeof error.stdout === "string" && error.stdout.trim() !== "") {
      output.push(error.stdout);
    }

    if (typeof error.stderr === "string" && error.stderr.trim() !== "") {
      output.push(error.stderr);
    }
  }

  if (output.length === 0) {
    output.push(error instanceof Error ? error.message : String(error));
  }

  const details = stripVTControlCharacters(output.join("\n")).trim();

  if (details.length <= MAX_FAILURE_LENGTH) {
    return details;
  }

  return `${details.slice(0, MAX_FAILURE_LENGTH)}\n… xui Stop hook output truncated`;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
