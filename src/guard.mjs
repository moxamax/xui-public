import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ESLint } from "eslint";

import { noDynamicTailwindClass } from "./rules/no-dynamic-tailwind-class.mjs";
import { createNoShadcnAlias } from "./rules/no-shadcn-alias.mjs";
import { noUnreasonedArbitraryValue } from "./rules/no-unreasoned-arbitrary-value.mjs";
import { createNoUnknownLayoutToken } from "./rules/no-unknown-layout-token.mjs";
import { createRequireIconOnlyAriaLabel } from "./rules/require-icon-only-aria-label.mjs";
import { readRelease } from "./release.mjs";

const LAYOUT_TOKEN_DECLARATION =
  /^\s*(--layout-space-[a-z0-9-]+)\s*:/gmu;

export async function runConsumerGuards(consumerRoot) {
  const release = await readRelease();
  const layoutTokens = await readInstalledLayoutTokens(consumerRoot);
  const shadcnAliases = await readInstalledShadcnAliases(consumerRoot);
  const plugin = {
    rules: {
      "no-dynamic-tailwind-class": noDynamicTailwindClass,
      "no-shadcn-alias": createNoShadcnAlias(shadcnAliases),
      "no-unreasoned-arbitrary-value": noUnreasonedArbitraryValue,
      "no-unknown-layout-token": createNoUnknownLayoutToken(layoutTokens),
      "require-icon-only-aria-label": createRequireIconOnlyAriaLabel(
        release.designSystem.name,
      ),
    },
  };
  const eslint = new ESLint({
    cwd: consumerRoot,
    overrideConfig: [
      {
        name: "xui/guards",
        files: ["**/*.{js,jsx,mjs,cjs,ts,tsx}"],
        plugins: { xui: plugin },
        rules: {
          "xui/no-dynamic-tailwind-class": "error",
          "xui/no-shadcn-alias": "error",
          "xui/no-unreasoned-arbitrary-value": "error",
          "xui/no-unknown-layout-token": "error",
          "xui/require-icon-only-aria-label": "error",
        },
      },
    ],
  });
  const results = await eslint.lintFiles(["."]);
  const failures = results.filter((result) => result.errorCount > 0);

  if (failures.length === 0) {
    return;
  }

  const formatter = await eslint.loadFormatter("stylish");
  const output = formatter.format(failures).trimEnd();
  throw new Error(`xui guard failed:\n${output}`);
}

async function readInstalledLayoutTokens(consumerRoot) {
  const release = await readRelease();
  const css = await readFile(
    join(
      consumerRoot,
      "node_modules",
      ...release.designSystem.name.split("/"),
      "src",
      "tokens",
      "layoutSpace",
      "layoutSpace.css",
    ),
    "utf8",
  );

  return new Set(
    [...css.matchAll(LAYOUT_TOKEN_DECLARATION)].map((match) => match[1]),
  );
}

async function readInstalledShadcnAliases(consumerRoot) {
  const release = await readRelease();
  const registry = JSON.parse(
    await readFile(
      join(
        consumerRoot,
        "node_modules",
        ...release.designSystem.name.split("/"),
        "src",
        "tokens",
        "utility-registry.json",
      ),
      "utf8",
    ),
  );

  return new Set(registry.shadcn_alias.block.color_alias);
}
