import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { runConsumerGuards } from "./guard.mjs";
import { getLocalPair } from "./status.mjs";

export async function checkConsumer(
  consumerRoot,
  { runTypecheck = runConsumerTypecheck } = {},
) {
  const localPair = await getLocalPair(consumerRoot);

  if (localPair === "missing") {
    throw new Error(
      "xui local pairing is incomplete; run `xui init` to restore the package, catalog, and references",
    );
  }

  if (localPair === "mismatch") {
    throw new Error(
      "xui local pairing does not match this release; run `xui init` to restore the exact version and references",
    );
  }

  const consumerPackage = await readConsumerPackage(consumerRoot);
  const typecheckScript = consumerPackage.scripts?.typecheck;

  if (typeof typecheckScript !== "string" || typecheckScript.trim() === "") {
    throw new Error(
      "consumer package.json must define a non-empty `typecheck` script before running `xui check`",
    );
  }

  await runConsumerGuards(consumerRoot);
  await runTypecheck(consumerRoot);
}

async function runConsumerTypecheck(consumerRoot) {
  await new Promise((resolve, reject) => {
    const child = spawn("npm", ["run", "typecheck"], {
      cwd: consumerRoot,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          signal
            ? `consumer typecheck was terminated by ${signal}`
            : `consumer typecheck failed with exit code ${code}`,
        ),
      );
    });
  });
}

async function readConsumerPackage(consumerRoot) {
  try {
    const value = JSON.parse(
      await readFile(join(consumerRoot, "package.json"), "utf8"),
    );

    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("consumer package.json is invalid");
    }

    return value;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "consumer package.json is invalid"
    ) {
      throw error;
    }

    throw new Error("consumer package.json is unavailable");
  }
}
