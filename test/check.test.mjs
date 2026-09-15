import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL("../bin/xui.mjs", import.meta.url));
const RELEASE = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const XUI_SOURCE = `github:moxamax/xui-public#${"a".repeat(40)}`;
const REFERENCES = {
  "llms.txt": "# Design system\n",
  "llms-full.txt": "# Complete design system reference\n",
};
const LAYOUT_SPACE_CSS = [
  ":root {",
  "  --layout-space-loose: 16px;",
  "  --layout-space-tight: 12px;",
  "  --layout-space-bottom: 48px;",
  "}",
  "",
].join("\n");
const UTILITY_REGISTRY = {
  shadcn_alias: {
    block: {
      color_alias: ["bg-popover"],
    },
  },
};

test("release consumes ESLint 9 from the consumer peer", () => {
  assert.equal(RELEASE.peerDependencies?.eslint, "^9.0.0");
  assert.equal(RELEASE.dependencies?.eslint, undefined);
});

test(
  "check accepts a static Tailwind class and runs only consumer typecheck",
  async (t) => {
    const consumerRoot = await createConsumer();
    t.after(() => rm(consumerRoot, { recursive: true, force: true }));

    const { stdout, stderr } = await runCheck(consumerRoot);

    assert.match(stdout, /xui check passed\./u);
    assert.equal(stderr, "");
    assert.equal(
      await readFile(join(consumerRoot, "typecheck-ran"), "utf8"),
      "",
    );
    await assertMarkersMissing(consumerRoot, [
      "lint-ran",
      "build-ran",
      "test-ran",
    ]);
  },
);

test(
  "check accepts complete Tailwind classes selected inside an interpolation",
  async (t) => {
    const consumerRoot = await createConsumer({
      source: [
        "export function Widget({ on }) {",
        '  return <div className={`grid gap-4 ${on ? "bg-red-500" : "bg-gray-500"}`} />;',
        "}",
        "",
      ].join("\n"),
    });
    t.after(() => rm(consumerRoot, { recursive: true, force: true }));

    const { stdout, stderr } = await runCheck(consumerRoot);

    assert.match(stdout, /xui check passed\./u);
    assert.equal(stderr, "");
    assert.equal(
      await readFile(join(consumerRoot, "typecheck-ran"), "utf8"),
      "",
    );
  },
);

test("check locates violations inside class helpers and conditional branches", async (t) => {
  const consumerRoot = await createConsumer({
    source: [
      "export function Widget({ on }) {",
      "  return <div className={cn(",
      '    "bg-popover",',
      '    clsx(on && "gap-[var(--layout-space-wide)]"),',
      '    on ? "w-[37px]" : "flex",',
      "  )} />;",
      "}",
    ].join("\n"),
  });
  t.after(() => rm(consumerRoot, { recursive: true, force: true }));

  await assert.rejects(runCheck(consumerRoot), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /src\/widget\.jsx/u);
    assert.match(error.stderr, /3:5\s+error.*bg-popover.*xui\/no-shadcn-alias/u);
    assert.match(error.stderr, /4:16\s+error.*--layout-space-wide.*xui\/no-unknown-layout-token/u);
    assert.match(error.stderr, /5:10\s+error.*w-\[37px\].*xui\/no-unreasoned-arbitrary-value/u);
    return true;
  });
  await assertMarkersMissing(consumerRoot, ["typecheck-ran"]);
});

test("check reads helper arrays and object keys without interpreting conditions", async (t) => {
  const consumerRoot = await createConsumer({
    source: [
      "export function Widget({ on }) {",
      "  return <div className={clsx([",
      '    { "bg-popover": on },',
      '    on ? "gap-[var(--layout-space-wide)]" : "flex",',
      '    { "w-[37px]": on },',
      "  ])} />;",
      "}",
    ].join("\n"),
  });
  t.after(() => rm(consumerRoot, { recursive: true, force: true }));

  await assert.rejects(runCheck(consumerRoot), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /3:7\s+error.*xui\/no-shadcn-alias/u);
    assert.match(error.stderr, /4:10\s+error.*xui\/no-unknown-layout-token/u);
    assert.match(error.stderr, /5:7\s+error.*xui\/no-unreasoned-arbitrary-value/u);
    return true;
  });
});

test("check finds nested dynamic fragments without treating them as complete aliases", async (t) => {
  const consumerRoot = await createConsumer({
    source: [
      "export function Widget({ on, gap, suffix }) {",
      "  return <div className={cn(",
      '    on ? clsx(`gap-${gap}`) : "flex",',
      '    `grid ${on ? `bg-popover${suffix}` : "block"}`,',
      "    { [`px-${gap}`]: on },",
      "  )} />;",
      "}",
    ].join("\n"),
  });
  t.after(() => rm(consumerRoot, { recursive: true, force: true }));

  await assert.rejects(runCheck(consumerRoot), (error) => {
    assert.equal(error.code, 1);
    assert.equal(error.stderr.match(/xui\/no-dynamic-tailwind-class/gu)?.length, 3);
    assert.doesNotMatch(error.stderr, /xui\/no-shadcn-alias/u);
    return true;
  });
});

test("check accepts complete classes, local reasons and unknown runtime values", async (t) => {
  const consumerRoot = await createConsumer({
    source: [
      "export function Widget({ on, runtime, lookup, suffix }) {",
      '  const direct = <div className={on ? "grid" : "flex"} />;',
      '  const fallback = <div className={runtime ?? "flex"} />;',
      '  const unknown = <div className={lookup("bg-popover", `gap-${suffix}`)} />;',
      "  return <div className={cn(",
      '    `grid ${on ? "bg-surface-raised" : "flex"}`,',
      '    clsx([on && "gap-[var(--layout-space-tight)]", runtime]),',
      '    { "bg-popover": false, "flex": "bg-popover" },',
      '    lookup("bg-popover"), runtime,',
      '    on === "bg-popover" && "flex",',
      "    // @xui-arbitrary-value-allow: chart needs a fixed gutter",
      '    "w-[37px]",',
      "  )}>{direct}{fallback}{unknown}</div>;",
      "}",
    ].join("\n"),
  });
  t.after(() => rm(consumerRoot, { recursive: true, force: true }));

  const { stdout, stderr } = await runCheck(consumerRoot);
  assert.match(stdout, /xui check passed/u);
  assert.equal(stderr, "");
  assert.equal(await readFile(join(consumerRoot, "typecheck-ran"), "utf8"), "");
});

test(
  "check applies consumer ESLint rules without changing its config",
  async (t) => {
    const consumerRoot = await createConsumer({
      eslintRules: { "no-alert": "error" },
      source: 'alert("consumer rule");\n',
    });
    t.after(() => rm(consumerRoot, { recursive: true, force: true }));
    const configPath = join(consumerRoot, "eslint.config.mjs");
    const configHash = sha256(await readFile(configPath, "utf8"));

    await assert.rejects(runCheck(consumerRoot), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /src\/widget\.jsx/u);
      assert.match(error.stderr, /no-alert/u);
      return true;
    });
    assert.equal(sha256(await readFile(configPath, "utf8")), configHash);
    await assertMarkersMissing(consumerRoot, ["typecheck-ran"]);
  },
);

test(
  "check rejects a Tailwind class that cannot be resolved statically",
  async (t) => {
    const consumerRoot = await createConsumer({
      source: [
        "export function Widget({ gap }) {",
        "  return <div className={`gap-${gap}`} />;",
        "}",
        "",
      ].join("\n"),
    });
    t.after(() => rm(consumerRoot, { recursive: true, force: true }));

    await assert.rejects(runCheck(consumerRoot), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /src\/widget\.jsx/u);
      assert.match(error.stderr, /2:33/u);
      assert.match(error.stderr, /xui\/no-dynamic-tailwind-class/u);
      assert.match(
        error.stderr,
        /Tailwind class cannot be resolved statically/u,
      );
      return true;
    });
    await assertMarkersMissing(consumerRoot, ["typecheck-ran"]);
  },
);

test(
  "check rejects a layout token missing from the installed design system",
  async (t) => {
    const consumerRoot = await createConsumer({
      source:
        'export function Widget() { return <div className="gap-[var(--layout-space-wide)]" />; }\n',
    });
    t.after(() => rm(consumerRoot, { recursive: true, force: true }));

    await assert.rejects(runCheck(consumerRoot), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /src\/widget\.jsx/u);
      assert.match(error.stderr, /xui\/no-unknown-layout-token/u);
      assert.match(error.stderr, /--layout-space-wide/u);
      assert.match(error.stderr, /use one of.*--layout-space-loose/u);
      return true;
    });
    await assertMarkersMissing(consumerRoot, ["typecheck-ran"]);
  },
);

test(
  "check accepts a layout token declared by the installed design system",
  async (t) => {
    const consumerRoot = await createConsumer({
      source:
        'export function Widget() { return <div className="gap-[var(--layout-space-loose)]" />; }\n',
    });
    t.after(() => rm(consumerRoot, { recursive: true, force: true }));

    const { stdout, stderr } = await runCheck(consumerRoot);

    assert.match(stdout, /xui check passed\./u);
    assert.equal(stderr, "");
    assert.equal(
      await readFile(join(consumerRoot, "typecheck-ran"), "utf8"),
      "",
    );
  },
);

test(
  "check rejects a shadcn compatibility alias from the installed design system",
  async (t) => {
    const consumerRoot = await createConsumer({
      source:
        'export function Widget() { return <div className="bg-popover" />; }\n',
    });
    t.after(() => rm(consumerRoot, { recursive: true, force: true }));

    await assert.rejects(runCheck(consumerRoot), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /src\/widget\.jsx/u);
      assert.match(error.stderr, /xui\/no-shadcn-alias/u);
      assert.match(error.stderr, /bg-popover/u);
      assert.match(error.stderr, /bg-surface-raised/u);
      return true;
    });
    await assertMarkersMissing(consumerRoot, ["typecheck-ran"]);
  },
);

test(
  "check accepts a canonical design-system utility instead of a shadcn alias",
  async (t) => {
    const consumerRoot = await createConsumer({
      source:
        'export function Widget() { return <div className="bg-surface-raised" />; }\n',
    });
    t.after(() => rm(consumerRoot, { recursive: true, force: true }));

    const { stdout, stderr } = await runCheck(consumerRoot);

    assert.match(stdout, /xui check passed\./u);
    assert.equal(stderr, "");
    assert.equal(
      await readFile(join(consumerRoot, "typecheck-ran"), "utf8"),
      "",
    );
  },
);

test(
  "check rejects a literal arbitrary value without a non-empty adjacent reason",
  async (t) => {
    const consumerRoot = await createConsumer({
      source: [
        "export function Widget() {",
        "  // @xui-arbitrary-value-allow:",
        '  return <div className="w-[37px]" />;',
        "}",
        "",
      ].join("\n"),
    });
    t.after(() => rm(consumerRoot, { recursive: true, force: true }));

    await assert.rejects(runCheck(consumerRoot), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /src\/widget\.jsx/u);
      assert.match(error.stderr, /xui\/no-unreasoned-arbitrary-value/u);
      assert.match(error.stderr, /w-\[37px\]/u);
      assert.match(error.stderr, /@xui-arbitrary-value-allow/u);
      return true;
    });
    await assertMarkersMissing(consumerRoot, ["typecheck-ran"]);
  },
);

test(
  "check accepts a literal arbitrary value with a non-empty adjacent reason",
  async (t) => {
    const consumerRoot = await createConsumer({
      source: [
        "export function Widget() {",
        "  // @xui-arbitrary-value-allow: third-party chart requires a 37px gutter",
        '  return <div className="w-[37px]" />;',
        "}",
        "",
      ].join("\n"),
    });
    t.after(() => rm(consumerRoot, { recursive: true, force: true }));

    const { stdout, stderr } = await runCheck(consumerRoot);

    assert.match(stdout, /xui check passed\./u);
    assert.equal(stderr, "");
    assert.equal(
      await readFile(join(consumerRoot, "typecheck-ran"), "utf8"),
      "",
    );
  },
);

test(
  "check rejects a design-system icon-only Button without an aria-label",
  async (t) => {
    const consumerRoot = await createConsumer({
      source: [
        'import { Button } from "@qijenchen/design-system";',
        "const Settings = () => null;",
        "export function Widget() {",
        "  return <Button iconOnly startIcon={Settings} />;",
        "}",
        "",
      ].join("\n"),
    });
    t.after(() => rm(consumerRoot, { recursive: true, force: true }));

    await assert.rejects(runCheck(consumerRoot), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /src\/widget\.jsx/u);
      assert.match(error.stderr, /xui\/require-icon-only-aria-label/u);
      assert.match(error.stderr, /iconOnly/u);
      assert.match(error.stderr, /add an aria-label/u);
      return true;
    });
    await assertMarkersMissing(consumerRoot, ["typecheck-ran"]);
  },
);

test(
  "check accepts a design-system icon-only Button with an aria-label",
  async (t) => {
    const consumerRoot = await createConsumer({
      source: [
        'import { Button } from "@qijenchen/design-system";',
        "const Settings = () => null;",
        "export function Widget() {",
        '  return <Button iconOnly startIcon={Settings} aria-label="Settings" />;',
        "}",
        "",
      ].join("\n"),
    });
    t.after(() => rm(consumerRoot, { recursive: true, force: true }));

    const { stdout, stderr } = await runCheck(consumerRoot);

    assert.match(stdout, /xui check passed\./u);
    assert.equal(stderr, "");
    assert.equal(
      await readFile(join(consumerRoot, "typecheck-ran"), "utf8"),
      "",
    );
  },
);

test(
  "check reports and clears all five consumer guard violations in one fix loop",
  async (t) => {
    const consumerRoot = await createConsumer({
      source: [
        'import { Button } from "@qijenchen/design-system";',
        "const Settings = () => null;",
        "export function Widget({ gap }) {",
        '  const chart = <div className="w-[37px]" />;',
        "  return (",
        "    <>",
        "      <div className={`gap-${gap}`} />",
        '      <div className="gap-[var(--layout-space-wide)]" />',
        '      <div className="bg-popover" />',
        "      {chart}",
        "      <Button iconOnly startIcon={Settings} />",
        "    </>",
        "  );",
        "}",
        "",
      ].join("\n"),
    });
    t.after(() => rm(consumerRoot, { recursive: true, force: true }));

    await assert.rejects(runCheck(consumerRoot), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /src\/widget\.jsx/u);
      assert.match(error.stderr, /xui\/no-dynamic-tailwind-class/u);
      assert.match(error.stderr, /use complete class names/u);
      assert.match(error.stderr, /xui\/no-unknown-layout-token/u);
      assert.match(error.stderr, /--layout-space-wide/u);
      assert.match(error.stderr, /--layout-space-loose/u);
      assert.match(error.stderr, /xui\/no-shadcn-alias/u);
      assert.match(error.stderr, /bg-popover/u);
      assert.match(error.stderr, /bg-surface-raised/u);
      assert.match(error.stderr, /xui\/no-unreasoned-arbitrary-value/u);
      assert.match(error.stderr, /@xui-arbitrary-value-allow/u);
      assert.match(error.stderr, /xui\/require-icon-only-aria-label/u);
      assert.match(error.stderr, /add an aria-label/u);
      return true;
    });
    await assertMarkersMissing(consumerRoot, ["typecheck-ran"]);

    await writeFile(
      join(consumerRoot, "src", "widget.jsx"),
      [
        'import { Button } from "@qijenchen/design-system";',
        "const Settings = () => null;",
        "export function Widget() {",
        "  // @xui-arbitrary-value-allow: third-party chart requires a 37px gutter",
        '  const chart = <div className="w-[37px]" />;',
        "  return (",
        "    <>",
        '      <div className="gap-4" />',
        '      <div className="gap-[var(--layout-space-loose)]" />',
        '      <div className="bg-surface-raised" />',
        "      {chart}",
        '      <Button iconOnly startIcon={Settings} aria-label="Settings" />',
        "    </>",
        "  );",
        "}",
        "",
      ].join("\n"),
    );

    const { stdout, stderr } = await runCheck(consumerRoot);

    assert.match(stdout, /xui check passed\./u);
    assert.equal(stderr, "");
    assert.equal(
      await readFile(join(consumerRoot, "typecheck-ran"), "utf8"),
      "",
    );
  },
);

test(
  "check rejects a mismatched pair before typecheck with an init instruction",
  async (t) => {
    const consumerRoot = await createConsumer();
    t.after(() => rm(consumerRoot, { recursive: true, force: true }));
    await writeFile(
      join(
        consumerRoot,
        ".agents",
        "skills",
        "xui",
        "references",
        "llms.txt",
      ),
      "changed\n",
    );

    await assert.rejects(runCheck(consumerRoot), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /run `xui init`/u);
      return true;
    });
    await assertMarkersMissing(consumerRoot, [
      "typecheck-ran",
      "lint-ran",
      "build-ran",
      "test-ran",
    ]);
  },
);

test(
  "check requires a non-empty consumer typecheck script",
  async (t) => {
    const consumerRoot = await createConsumer({ includeTypecheck: false });
    t.after(() => rm(consumerRoot, { recursive: true, force: true }));

    await assert.rejects(runCheck(consumerRoot), (error) => {
      assert.equal(error.code, 1);
      assert.match(
        error.stderr,
        /package\.json must define a non-empty `typecheck` script/u,
      );
      return true;
    });
    await assertMarkersMissing(consumerRoot, [
      "lint-ran",
      "build-ran",
      "test-ran",
    ]);
  },
);

test(
  "check propagates typecheck failure without running other scripts",
  async (t) => {
    const consumerRoot = await createConsumer({
      typecheckScript: 'node -e "process.exit(7)"',
    });
    t.after(() => rm(consumerRoot, { recursive: true, force: true }));

    await assert.rejects(runCheck(consumerRoot), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /consumer typecheck failed with exit code 7/u);
      return true;
    });
    await assertMarkersMissing(consumerRoot, [
      "lint-ran",
      "build-ran",
      "test-ran",
    ]);
  },
);

async function createConsumer({
  eslintRules = {},
  includeTypecheck = true,
  typecheckScript =
    'node -e "require(\'node:fs\').writeFileSync(\'typecheck-ran\', \'\')"',
  source = 'export function Widget() { return <div className="grid gap-4" />; }\n',
} = {}) {
  const consumerRoot = await mkdtemp(join(tmpdir(), "xui-check-"));
  const designSystem = RELEASE.xuiRelease.designSystem;
  const scripts = {
    lint: 'node -e "require(\'node:fs\').writeFileSync(\'lint-ran\', \'\')"',
    build:
      'node -e "require(\'node:fs\').writeFileSync(\'build-ran\', \'\')"',
    test: 'node -e "require(\'node:fs\').writeFileSync(\'test-ran\', \'\')"',
  };

  if (includeTypecheck) {
    scripts.typecheck = typecheckScript;
  }

  await writeJson(join(consumerRoot, "package.json"), {
    name: "consumer",
    private: true,
    scripts,
    dependencies: {
      [RELEASE.name]: XUI_SOURCE,
      [designSystem.name]: designSystem.version,
    },
  });

  const installedRoot = join(
    consumerRoot,
    "node_modules",
    ...designSystem.name.split("/"),
  );
  await writeJson(join(installedRoot, "package.json"), {
    name: designSystem.name,
    version: designSystem.version,
  });
  await Promise.all(
    Object.entries(REFERENCES).map(([name, content]) =>
      writeFile(join(installedRoot, name), content),
    ),
  );
  const layoutSpaceRoot = join(
    installedRoot,
    "src",
    "tokens",
    "layoutSpace",
  );
  await mkdir(layoutSpaceRoot, { recursive: true });
  await writeFile(join(layoutSpaceRoot, "layoutSpace.css"), LAYOUT_SPACE_CSS);
  await writeJson(
    join(installedRoot, "src", "tokens", "utility-registry.json"),
    UTILITY_REGISTRY,
  );

  const snapshotRoot = join(
    consumerRoot,
    ".agents",
    "skills",
    "xui",
    "references",
  );
  await writeJson(join(snapshotRoot, "catalog.json"), {
    managedBy: RELEASE.name,
    xui: {
      version: RELEASE.version,
      source: XUI_SOURCE,
    },
    designSystem: {
      name: designSystem.name,
      version: designSystem.version,
    },
    references: Object.fromEntries(
      Object.entries(REFERENCES).map(([name, content]) => [
        name,
        { sha256: sha256(content) },
      ]),
    ),
  });
  await Promise.all(
    Object.entries(REFERENCES).map(([name, content]) =>
      writeFile(join(snapshotRoot, name), content),
    ),
  );
  await writeFile(
    join(consumerRoot, "eslint.config.mjs"),
    [
      "export default [",
      "  {",
      '    files: ["**/*.jsx"],',
      "    languageOptions: {",
      '      ecmaVersion: "latest",',
      '      sourceType: "module",',
      "      parserOptions: { ecmaFeatures: { jsx: true } },",
      "    },",
      `    rules: ${JSON.stringify(eslintRules)},`,
      "  },",
      "];",
      "",
    ].join("\n"),
  );
  await mkdir(join(consumerRoot, "src"), { recursive: true });
  await writeFile(join(consumerRoot, "src", "widget.jsx"), source);

  return consumerRoot;
}

function runCheck(consumerRoot) {
  return execFileAsync(process.execPath, [CLI_PATH, "check"], {
    cwd: consumerRoot,
  });
}

async function assertMarkersMissing(consumerRoot, names) {
  await Promise.all(
    names.map((name) =>
      assert.rejects(readFile(join(consumerRoot, name)), isMissing),
    ),
  );
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function isMissing(error) {
  return error && typeof error === "object" && error.code === "ENOENT";
}
