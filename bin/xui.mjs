#!/usr/bin/env node

const arguments_ = process.argv.slice(2);

try {
  if (arguments_.length === 1 && arguments_[0] === "init") {
    const { initializeConsumer } = await import("../src/init.mjs");
    const { designSystem } = await initializeConsumer(process.cwd());
    process.stdout.write(
      `Initialized xui with ${designSystem.name}@${designSystem.version}.\n` +
        "Codex: use a trusted project, then review and trust the xui Stop hook with `/hooks`.\n",
    );
  } else if (arguments_.length === 1 && arguments_[0] === "check") {
    const { checkConsumer } = await import("../src/check.mjs");
    await checkConsumer(process.cwd());
    process.stdout.write("xui check passed.\n");
  } else if (
    arguments_.length === 2 &&
    arguments_[0] === "status" &&
    arguments_[1] === "--json"
  ) {
    const { getStatus } = await import("../src/status.mjs");
    const status = await getStatus(process.cwd());
    process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
  } else {
    console.error("Usage: xui <init|status --json|check>");
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
