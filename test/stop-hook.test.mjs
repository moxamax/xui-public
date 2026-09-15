import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { getStopHookResult } from "../src/stop-hook.mjs";

const HOOK_PATH = fileURLToPath(
  new URL("../bin/xui-stop.mjs", import.meta.url),
);

test("shared Stop core passes, blocks once, then reveals and allows failure", async () => {
  const consumerRoot = "/consumer";
  let checkCalls = 0;
  const pass = await getStopHookResult(
    { stop_hook_active: false },
    {
      consumerRoot,
      runCheck: async (root) => {
        checkCalls += 1;
        assert.equal(root, consumerRoot);
      },
    },
  );
  assert.equal(pass, undefined);

  const checkFailure = Object.assign(new Error("check failed"), {
    stdout: "\u001b[31mtypecheck output\u001b[0m\n",
    stderr: "consumer typecheck failed\n",
  });
  const runFailingCheck = async (root) => {
    checkCalls += 1;
    assert.equal(root, consumerRoot);
    throw checkFailure;
  };
  const firstFailure = await getStopHookResult(
    { stop_hook_active: false },
    { consumerRoot, runCheck: runFailingCheck },
  );
  assert.equal(firstFailure.decision, "block");
  assert.match(firstFailure.reason, /xui check failed/u);
  assert.match(firstFailure.reason, /typecheck output/u);
  assert.doesNotMatch(firstFailure.reason, /\u001b/u);

  const retryFailure = await getStopHookResult(
    { stop_hook_active: true },
    { consumerRoot, runCheck: runFailingCheck },
  );
  assert.equal(retryFailure.continue, true);
  assert.equal(retryFailure.decision, undefined);
  assert.match(retryFailure.systemMessage, /retry loop is ending/u);
  assert.match(retryFailure.systemMessage, /consumer typecheck failed/u);
  assert.equal(checkCalls, 3);
});

test("hook runtime captures xui check output and writes only provider JSON", async (t) => {
  const consumerRoot = await mkdtemp(join(tmpdir(), "xui-stop-hook-"));
  t.after(() => rm(consumerRoot, { recursive: true, force: true }));

  const firstRun = await runHook(consumerRoot, {
    stop_hook_active: false,
  });
  assert.equal(firstRun.code, 0);
  assert.equal(firstRun.stderr, "");
  const firstResult = JSON.parse(firstRun.stdout);
  assert.equal(firstResult.decision, "block");
  assert.match(firstResult.reason, /xui local pairing is incomplete/u);

  const retryRun = await runHook(consumerRoot, {
    stop_hook_active: true,
  });
  assert.equal(retryRun.code, 0);
  assert.equal(retryRun.stderr, "");
  const retryResult = JSON.parse(retryRun.stdout);
  assert.equal(retryResult.continue, true);
  assert.equal(retryResult.decision, undefined);
  assert.match(retryResult.systemMessage, /xui local pairing is incomplete/u);
});

async function runHook(cwd, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK_PATH], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(JSON.stringify(input));
  });
}
