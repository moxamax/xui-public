#!/usr/bin/env node

import { getStopHookResult } from "../src/stop-hook.mjs";

try {
  const input = await readInput();
  const result = await getStopHookResult(input);

  if (result !== undefined) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({
      continue: true,
      systemMessage: `xui Stop hook could not run: ${
        error instanceof Error ? error.message : String(error)
      }`,
    })}\n`,
  );
}

async function readInput() {
  let rawInput = "";

  process.stdin.setEncoding("utf8");

  for await (const chunk of process.stdin) {
    rawInput += chunk;
  }

  try {
    return JSON.parse(rawInput);
  } catch {
    return undefined;
  }
}
