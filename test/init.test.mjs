import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  buildDesignSystemInstallArguments,
  initializeConsumer as initializeConsumerForHost,
} from "../src/init.mjs";
import {
  CLAUDE_SETTINGS_PATH,
  CODEX_HOOKS_PATH,
  XUI_STOP_COMMAND,
} from "../src/provider-hooks.mjs";
import { PROJECT_SKILL_CONTENT } from "../src/project-skill.mjs";
import { getLocalPair } from "../src/status.mjs";

const RELEASE = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const XUI_SOURCE = `github:moxamax/xui-public#${"a".repeat(40)}`;
const CONSUMER_PACKAGES = {
  react: "19.1.1",
  "react-dom": "19.1.1",
  typescript: "5.9.2",
  tailwindcss: "4.1.11",
  eslint: "9.39.1",
};
const REFERENCES = {
  "llms.txt": "# Design system\n",
  "llms-full.txt": "# Complete design system reference\n",
};
const MANAGED_PATHS = [
  "package.json",
  ".agents/skills/xui/SKILL.md",
  ".agents/skills/xui/references/catalog.json",
  ".agents/skills/xui/references/llms.txt",
  ".agents/skills/xui/references/llms-full.txt",
  ".claude/settings.json",
  ".codex/hooks.json",
];

test("init installs the exact release pair and snapshots installed references", async (t) => {
  const consumerRoot = await createConsumer();
  t.after(() => rm(consumerRoot, { recursive: true, force: true }));
  let installRequest;
  let checkedRoot;

  await initializeConsumer(consumerRoot, {
    installDesignSystem: async (request) => {
      installRequest = request;
      await installFixture(request);
    },
    runCheck: async (root) => {
      checkedRoot = root;
    },
  });

  const designSystem = RELEASE.xuiRelease.designSystem;
  assert.deepEqual(installRequest, {
    consumerRoot,
    name: designSystem.name,
    version: designSystem.version,
  });
  assert.equal(checkedRoot, consumerRoot);

  const consumerPackage = await readJson(join(consumerRoot, "package.json"));
  assert.equal(
    consumerPackage.dependencies[designSystem.name],
    designSystem.version,
  );

  const snapshotRoot = join(
    consumerRoot,
    ".agents",
    "skills",
    "xui",
    "references",
  );
  const catalog = await readJson(join(snapshotRoot, "catalog.json"));
  assert.deepEqual(catalog, {
    managedBy: RELEASE.name,
    xui: {
      version: RELEASE.version,
      source: XUI_SOURCE,
    },
    designSystem,
    references: Object.fromEntries(
      Object.entries(REFERENCES).map(([name, content]) => [
        name,
        { sha256: sha256(content) },
      ]),
    ),
  });

  for (const [name, content] of Object.entries(REFERENCES)) {
    assert.equal(await readFile(join(snapshotRoot, name), "utf8"), content);
  }

  const skillRoot = dirname(snapshotRoot);
  const skillContent = await readFile(join(skillRoot, "SKILL.md"), "utf8");
  assert.match(
    skillContent,
    /description: .*\u5efa\u7acb.*\u4fee\u6539.*\u5be9\u67e5 React\uff0fTSX UI.*\u5b89\u88dd.*\u72c0\u614b.*\u66f4\u65b0 xui/u,
  );
  assert.match(
    skillContent,
    /references\/llms\.txt[\s\S]*references\/llms-full\.txt[\s\S]*文件版本標示.*upstream-guidance\.md.*spec.*\.d\.ts/u,
  );
  assert.match(
    skillContent,
    /user-level skill[\s\S]*\u4e0d\u5f97.*\u8986\u84cb\u6216\u53d6\u4ee3 `references\/`/u,
  );

  const claudeSkillPath = join(consumerRoot, ".claude", "skills", "xui");
  assert.equal((await lstat(claudeSkillPath)).isSymbolicLink(), true);
  assert.equal(
    await readlink(claudeSkillPath),
    "../../.agents/skills/xui",
  );
  await assert.rejects(
    lstat(join(consumerRoot, ".codex", "skills", "xui")),
    isMissing,
  );
  assert.deepEqual(
    await readJson(join(consumerRoot, ...CLAUDE_SETTINGS_PATH)),
    canonicalHookConfig(),
  );
  assert.deepEqual(
    await readJson(join(consumerRoot, ...CODEX_HOOKS_PATH)),
    canonicalHookConfig(),
  );
  await assert.rejects(
    lstat(join(consumerRoot, ".codex", "config.toml")),
    isMissing,
  );

  assert.equal(await getLocalPair(consumerRoot), "valid");
});

test("project skill defines the complete consumer agent loop", () => {
  assert.match(
    PROJECT_SKILL_CONTENT,
    /`updateStatus` 只查詢 xui release[\s\S]*`current`.*最新 xui 配對.*不代表上游 design-system 沒有新版[\s\S]*`available`.*有新 xui 配對可用.*不自動升級[\s\S]*`unknown`.*有效的本地配對仍可使用/u,
  );
  assert.match(
    PROJECT_SKILL_CONTENT,
    /只執行一次唯讀.*`node \.\/node_modules\/xui\/bin\/xui\.mjs status --json`[\s\S]*不要.*重複查詢[\s\S]*自然語言[\s\S]*`localPair`[\s\S]*`updateStatus`/u,
  );
  assert.match(
    PROJECT_SKILL_CONTENT,
    /唯一執行入口[\s\S]*只使用專案內 binary[\s\S]*不得使用裸 `xui`、`npx xui`、`npm exec`/u,
  );
  assert.doesNotMatch(
    PROJECT_SKILL_CONTENT,
    /`xui (?:init|status|check)(?:\s|`)/u,
  );
  assert.match(
    PROJECT_SKILL_CONTENT,
    /lockfile 仍有固定 SHA[\s\S]*`npm install --ignore-scripts`[\s\S]*`references\/catalog\.json`[\s\S]*`doc\/runbooks\/agent-install\.md`[\s\S]*不得臨時下載/u,
  );
  assert.match(
    PROJECT_SKILL_CONTENT,
    /固定配對.*不會無聲升級[\s\S]*不要要求使用者理解或選擇原始版本號與 Git SHA/u,
  );
  assert.match(
    PROJECT_SKILL_CONTENT,
    /只有使用者表達升級意圖時才更新[\s\S]*updateStatus: available.*不得自動升級/u,
  );
  assert.match(
    PROJECT_SKILL_CONTENT,
    /immutable semver tags[\s\S]*完整 40 位 commit SHA[\s\S]*annotated tag.*peeled commit[\s\S]*不得把 tag object SHA/u,
  );
  assert.match(
    PROJECT_SKILL_CONTENT,
    /相同 Git source.*完整 SHA[\s\S]*npm install --save-exact --ignore-scripts[\s\S]*node \.\/node_modules\/xui\/bin\/xui\.mjs init[\s\S]*不得使用浮動 branch、alias、tag 字串或臨時執行方式[\s\S]*不得新增或呼叫公開的 upgrade command/u,
  );
  assert.match(
    PROJECT_SKILL_CONTENT,
    /新版本 package README[\s\S]*受影響的既有用法[\s\S]*審查與檢查迴圈直到全綠[\s\S]*文件與程式差異、受影響元件、已做修正及剩餘未知/u,
  );
  assert.match(
    PROJECT_SKILL_CONTENT,
    /Codex.*trusted[\s\S]*`\/hooks`.*當前 hash/u,
  );
  assert.match(
    PROJECT_SKILL_CONTENT,
    /不得自行修改 `\.codex\/config\.toml`.*一般工作中繞過 hook trust/u,
  );
  assert.match(
    PROJECT_SKILL_CONTENT,
    /初次 setup.*實際安裝 package README.*setup[\s\S]*CSS imports.*Tailwind source.*Provider/u,
  );
  assert.match(
    PROJECT_SKILL_CONTENT,
    /design-system 已有[\s\S]*consumer 已有[\s\S]*新依賴/u,
  );
  assert.match(
    PROJECT_SKILL_CONTENT,
    /新增依賴[\s\S]*實質 UX／accessibility 取捨[\s\S]*使用者決定/u,
  );
  assert.match(
    PROJECT_SKILL_CONTENT,
    /實作後先重新對照[\s\S]*再執行 `node \.\/node_modules\/xui\/bin\/xui\.mjs check`[\s\S]*檢查全綠後，再次重新對照[\s\S]*必須再跑 `node \.\/node_modules\/xui\/bin\/xui\.mjs check`[\s\S]*沒有已知偏離且靜態契約全綠/u,
  );
  assert.match(
    PROJECT_SKILL_CONTENT,
    /consumer 錯誤即使早於本次工作[\s\S]*不得以「既有問題」略過[\s\S]*不得建立 baseline 或 suppression/u,
  );
  assert.match(
    PROJECT_SKILL_CONTENT,
    /上游指引審查[\s\S]*xui 靜態檢查[\s\S]*consumer 原有驗證[\s\S]*視覺／瀏覽器驗證/u,
  );
});

test("design-system install disables package lifecycle scripts", () => {
  assert.deepEqual(
    buildDesignSystemInstallArguments("@qijenchen/design-system", "1.2.3"),
    [
      "install",
      "--save-exact",
      "--ignore-scripts",
      "--",
      "@qijenchen/design-system@1.2.3",
    ],
  );
});

test("init is idempotent for an already managed pair", async (t) => {
  const consumerRoot = await createConsumer();
  t.after(() => rm(consumerRoot, { recursive: true, force: true }));
  const options = {
    installDesignSystem: installFixture,
    runCheck: async () => {},
  };

  await initializeConsumer(consumerRoot, options);
  const first = await snapshotManagedFiles(consumerRoot);
  await initializeConsumer(consumerRoot, options);

  assert.deepEqual(await snapshotManagedFiles(consumerRoot), first);
});

test("init conservatively merges one canonical xui Stop hook per provider", async (t) => {
  const consumerRoot = await createConsumer();
  t.after(() => rm(consumerRoot, { recursive: true, force: true }));
  const claudeConfig = {
    permissions: { allow: ["Read"] },
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: "echo pre-tool" }],
        },
      ],
      Stop: [
        {
          matcher: "legacy",
          hooks: [{ type: "command", command: "echo user-stop" }],
        },
        {
          hooks: [
            {
              type: "command",
              command: XUI_STOP_COMMAND,
              timeout: 5,
            },
          ],
        },
      ],
    },
  };
  const codexConfig = {
    description: "consumer hooks",
    hooks: {
      Stop: [
        {
          hooks: [
            { type: "command", command: "echo user-stop" },
            {
              type: "command",
              command: XUI_STOP_COMMAND,
              statusMessage: "old xui message",
            },
          ],
        },
      ],
    },
  };
  const codexProjectConfig = '[features]\nhooks = true\n';
  await writeJson(join(consumerRoot, ...CLAUDE_SETTINGS_PATH), claudeConfig);
  await writeJson(join(consumerRoot, ...CODEX_HOOKS_PATH), codexConfig);
  await writeFile(
    join(consumerRoot, ".codex", "config.toml"),
    codexProjectConfig,
  );

  await initializeConsumer(consumerRoot, {
    installDesignSystem: installFixture,
    runCheck: async () => {},
  });

  claudeConfig.hooks.Stop[1].hooks[0] = canonicalStopHandler();
  codexConfig.hooks.Stop[0].hooks[1] = canonicalStopHandler();
  assert.deepEqual(
    await readJson(join(consumerRoot, ...CLAUDE_SETTINGS_PATH)),
    claudeConfig,
  );
  assert.deepEqual(
    await readJson(join(consumerRoot, ...CODEX_HOOKS_PATH)),
    codexConfig,
  );
  assert.equal(
    await readFile(join(consumerRoot, ".codex", "config.toml"), "utf8"),
    codexProjectConfig,
  );
});

test("init rejects invalid or conflicting provider JSON before installation", async (t) => {
  const cases = [
    {
      name: "invalid Claude settings",
      target: CLAUDE_SETTINGS_PATH,
      content: "{\n",
      error: /existing Claude Code hook settings are invalid/u,
    },
    {
      name: "conflicting Claude Stop shape",
      target: CLAUDE_SETTINGS_PATH,
      content: '{"hooks":{"Stop":{}}}\n',
      error: /existing Claude Code Stop hook configuration conflicts/u,
    },
    {
      name: "invalid Codex hooks",
      target: CODEX_HOOKS_PATH,
      content: "{\n",
      error: /existing Codex hook settings are invalid/u,
    },
    {
      name: "conflicting Codex Stop shape",
      target: CODEX_HOOKS_PATH,
      content: '{"hooks":{"Stop":{}}}\n',
      error: /existing Codex Stop hook configuration conflicts/u,
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async (t) => {
      const consumerRoot = await createConsumer();
      t.after(() => rm(consumerRoot, { recursive: true, force: true }));
      const targetPath = join(consumerRoot, ...scenario.target);
      const otherTarget =
        scenario.target === CLAUDE_SETTINGS_PATH
          ? CODEX_HOOKS_PATH
          : CLAUDE_SETTINGS_PATH;
      const otherPath = join(consumerRoot, ...otherTarget);
      const otherContent = '{"keep":"unchanged"}\n';
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, scenario.content);
      await mkdir(dirname(otherPath), { recursive: true });
      await writeFile(otherPath, otherContent);
      let installCalled = false;

      await assert.rejects(
        initializeConsumer(consumerRoot, {
          installDesignSystem: async () => {
            installCalled = true;
          },
        }),
        scenario.error,
      );

      assert.equal(installCalled, false);
      assert.equal(await readFile(targetPath, "utf8"), scenario.content);
      assert.equal(await readFile(otherPath, "utf8"), otherContent);
      await assertNoSkillArtifacts(consumerRoot);
    });
  }
});

test("init rejects unclear provider hook ownership before installation", async (t) => {
  for (const target of [CLAUDE_SETTINGS_PATH, CODEX_HOOKS_PATH]) {
    await t.test(target.join("/"), async (t) => {
      const consumerRoot = await createConsumer();
      t.after(() => rm(consumerRoot, { recursive: true, force: true }));
      const targetPath = join(consumerRoot, ...target);
      const content = `${JSON.stringify({
        hooks: {
          Stop: [
            {
              hooks: [
                {
                  type: "command",
                  command: "node ./node_modules/xui/bin/xui-stop.mjs",
                },
              ],
            },
          ],
        },
      })}\n`;
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, content);
      let installCalled = false;

      await assert.rejects(
        initializeConsumer(consumerRoot, {
          installDesignSystem: async () => {
            installCalled = true;
          },
        }),
        /xui Stop hook ownership is unclear/u,
      );

      assert.equal(installCalled, false);
      assert.equal(await readFile(targetPath, "utf8"), content);
      await assertNoSkillArtifacts(consumerRoot);
    });
  }
});

test("init rejects an occupied provider settings path before installation", async (t) => {
  for (const target of [CLAUDE_SETTINGS_PATH, CODEX_HOOKS_PATH]) {
    await t.test(target.join("/"), async (t) => {
      const consumerRoot = await createConsumer();
      t.after(() => rm(consumerRoot, { recursive: true, force: true }));
      const targetPath = join(consumerRoot, ...target);
      await mkdir(targetPath, { recursive: true });
      let installCalled = false;

      await assert.rejects(
        initializeConsumer(consumerRoot, {
          installDesignSystem: async () => {
            installCalled = true;
          },
        }),
        /hook settings path ownership is unclear/u,
      );

      assert.equal(installCalled, false);
      assert.equal((await lstat(targetPath)).isDirectory(), true);
      await assertNoSkillArtifacts(consumerRoot);
    });
  }
});

test("init preserves managed artifacts when check fails", async (t) => {
  const consumerRoot = await createConsumer();
  t.after(() => rm(consumerRoot, { recursive: true, force: true }));
  let checkCalled = false;

  await assert.rejects(
    initializeConsumer(consumerRoot, {
      installDesignSystem: installFixture,
      runCheck: async (root) => {
        checkCalled = true;
        assert.equal(await getLocalPair(root), "valid");
        assert.match(
          await readFile(
            join(root, ".agents", "skills", "xui", "SKILL.md"),
            "utf8",
          ),
          /^---\nname: xui$/mu,
        );
        assert.equal(
          await readlink(join(root, ".claude", "skills", "xui")),
          "../../.agents/skills/xui",
        );
        throw new Error("consumer typecheck failed");
      },
    }),
    /consumer typecheck failed/u,
  );

  assert.equal(checkCalled, true);
  assert.equal(await getLocalPair(consumerRoot), "valid");
  await snapshotManagedFiles(consumerRoot);
});

test("init preserves an existing target without xui ownership", async (t) => {
  const consumerRoot = await createConsumer();
  t.after(() => rm(consumerRoot, { recursive: true, force: true }));
  const existingPath = join(
    consumerRoot,
    ".agents",
    "skills",
    "xui",
    "keep.txt",
  );
  await mkdir(dirname(existingPath), { recursive: true });
  await writeFile(existingPath, "user content\n");
  let installCalled = false;

  await assert.rejects(
    initializeConsumer(consumerRoot, {
      installDesignSystem: async () => {
        installCalled = true;
      },
    }),
    /existing xui skill target is not managed by xui/u,
  );

  assert.equal(installCalled, false);
  assert.equal(await readFile(existingPath, "utf8"), "user content\n");
  const consumerPackage = await readJson(join(consumerRoot, "package.json"));
  assert.equal(
    consumerPackage.dependencies[RELEASE.xuiRelease.designSystem.name],
    undefined,
  );
});

test("init preserves an existing Claude skill path without xui ownership", async (t) => {
  const consumerRoot = await createConsumer();
  t.after(() => rm(consumerRoot, { recursive: true, force: true }));
  const claudeSkillPath = join(consumerRoot, ".claude", "skills", "xui");
  await mkdir(dirname(claudeSkillPath), { recursive: true });
  await writeFile(claudeSkillPath, "user content\n");
  let installCalled = false;

  await assert.rejects(
    initializeConsumer(consumerRoot, {
      installDesignSystem: async () => {
        installCalled = true;
      },
    }),
    /existing Claude xui skill link is not managed by xui/u,
  );

  assert.equal(installCalled, false);
  assert.equal(await readFile(claudeSkillPath, "utf8"), "user content\n");
  const consumerPackage = await readJson(join(consumerRoot, "package.json"));
  assert.equal(
    consumerPackage.dependencies[RELEASE.xuiRelease.designSystem.name],
    undefined,
  );
});

test("init preserves a Claude skill link with a different target", async (t) => {
  const consumerRoot = await createConsumer();
  t.after(() => rm(consumerRoot, { recursive: true, force: true }));
  const claudeSkillPath = join(consumerRoot, ".claude", "skills", "xui");
  await mkdir(dirname(claudeSkillPath), { recursive: true });
  await symlink("../user-skill", claudeSkillPath);
  let installCalled = false;

  await assert.rejects(
    initializeConsumer(consumerRoot, {
      installDesignSystem: async () => {
        installCalled = true;
      },
    }),
    /existing Claude xui skill link is not managed by xui/u,
  );

  assert.equal(installCalled, false);
  assert.equal(await readlink(claudeSkillPath), "../user-skill");
  const consumerPackage = await readJson(join(consumerRoot, "package.json"));
  assert.equal(
    consumerPackage.dependencies[RELEASE.xuiRelease.designSystem.name],
    undefined,
  );
});

test("init accepts a Claude skills directory linked to the canonical skills root", async (t) => {
  const consumerRoot = await createConsumer();
  t.after(() => rm(consumerRoot, { recursive: true, force: true }));
  const claudeSkillsRoot = join(consumerRoot, ".claude", "skills");
  await mkdir(join(consumerRoot, ".agents", "skills"), { recursive: true });
  await mkdir(dirname(claudeSkillsRoot), { recursive: true });
  await symlink("../.agents/skills", claudeSkillsRoot);
  const options = {
    installDesignSystem: installFixture,
    runCheck: async () => {},
  };

  await initializeConsumer(consumerRoot, options);
  await initializeConsumer(consumerRoot, options);

  assert.equal(await readlink(claudeSkillsRoot), "../.agents/skills");
  assert.equal(
    (await lstat(join(claudeSkillsRoot, "xui"))).isDirectory(),
    true,
  );
  assert.equal(
    await readFile(join(claudeSkillsRoot, "xui", "SKILL.md"), "utf8"),
    PROJECT_SKILL_CONTENT,
  );
});

test("init rejects a Claude skills directory linked elsewhere before installation", async (t) => {
  const consumerRoot = await createConsumer();
  t.after(() => rm(consumerRoot, { recursive: true, force: true }));
  const claudeSkillsRoot = join(consumerRoot, ".claude", "skills");
  await mkdir(join(consumerRoot, ".claude"), { recursive: true });
  await mkdir(join(consumerRoot, "user-skills"));
  await symlink("../user-skills", claudeSkillsRoot);
  let installCalled = false;

  await assert.rejects(
    initializeConsumer(consumerRoot, {
      installDesignSystem: async () => {
        installCalled = true;
      },
    }),
    /existing Claude skills directory is not managed by xui/u,
  );

  assert.equal(installCalled, false);
  assert.equal(await readlink(claudeSkillsRoot), "../user-skills");
  await assertNoSkillArtifacts(consumerRoot);
  await assertNoProviderArtifacts(consumerRoot);
});

test("init rejects unsafe files inside an existing managed skill before installation", async (t) => {
  const consumerRoot = await createConsumer();
  t.after(() => rm(consumerRoot, { recursive: true, force: true }));
  const skillRoot = join(consumerRoot, ".agents", "skills", "xui");
  const outsidePath = join(consumerRoot, "keep.md");
  await writeJson(join(skillRoot, "references", "catalog.json"), {
    managedBy: RELEASE.name,
  });
  await writeFile(outsidePath, "user content\n");
  await symlink(outsidePath, join(skillRoot, "SKILL.md"));
  let installCalled = false;

  await assert.rejects(
    initializeConsumer(consumerRoot, {
      installDesignSystem: async () => {
        installCalled = true;
      },
    }),
    /existing xui skill target is not managed by xui/u,
  );

  assert.equal(installCalled, false);
  assert.equal(await readFile(outsidePath, "utf8"), "user content\n");
  assert.equal(
    (await lstat(join(skillRoot, "SKILL.md"))).isSymbolicLink(),
    true,
  );
  await assertNoProviderArtifacts(consumerRoot);
});

test("init rejects unsupported consumers without mutating managed files", async (t) => {
  const scenarios = [
    {
      name: "missing typecheck script",
      error: /non-empty `typecheck` script/u,
      arrange: (root) =>
        updateConsumerPackage(root, (consumerPackage) => {
          consumerPackage.scripts.typecheck = "   ";
        }),
    },
    {
      name: "non-macOS platform",
      error: /supports macOS only; detected linux/u,
      options: { platform: "linux" },
    },
    {
      name: "npm workspace",
      error: /workspaces and monorepos are not supported/u,
      arrange: (root) =>
        updateConsumerPackage(root, (consumerPackage) => {
          consumerPackage.workspaces = ["packages/*"];
        }),
    },
    {
      name: "non-npm package manager",
      error: /packageManager must use npm/u,
      arrange: (root) =>
        updateConsumerPackage(root, (consumerPackage) => {
          consumerPackage.packageManager = "pnpm@10.0.0";
        }),
    },
    {
      name: "missing React declaration",
      error: /directly declare React/u,
      arrange: (root) =>
        updateConsumerPackage(root, (consumerPackage) => {
          delete consumerPackage.dependencies.react;
        }),
    },
    {
      name: "missing React DOM declaration",
      error: /directly declare React DOM/u,
      arrange: (root) =>
        updateConsumerPackage(root, (consumerPackage) => {
          delete consumerPackage.dependencies["react-dom"];
        }),
    },
    {
      name: "Tailwind CSS 3",
      error: /Tailwind CSS 4\.1\+ \(4\.x\) version is unsupported: 3\.4\.17/u,
      arrange: (root) =>
        writeJson(join(root, "node_modules", "tailwindcss", "package.json"), {
          name: "tailwindcss",
          version: "3.4.17",
        }),
    },
    {
      name: "Tailwind CSS 4.0",
      error: /Tailwind CSS 4\.1\+ \(4\.x\) version is unsupported: 4\.0\.17/u,
      arrange: (root) =>
        writeJson(join(root, "node_modules", "tailwindcss", "package.json"), {
          name: "tailwindcss",
          version: "4.0.17",
        }),
    },
    {
      name: "ESLint 8",
      error: /ESLint 9 version is unsupported: 8\.57\.1/u,
      arrange: (root) =>
        writeJson(join(root, "node_modules", "eslint", "package.json"), {
          name: "eslint",
          version: "8.57.1",
        }),
    },
    {
      name: "missing ESLint flat config",
      error: /provide an ESLint 9 flat config/u,
      arrange: (root) => rm(join(root, "eslint.config.mjs")),
    },
    {
      name: "package root is not the Git root",
      error: /root must also be the Git root/u,
      arrange: (root) => rm(join(root, ".git"), { recursive: true }),
    },
    {
      name: "missing package-lock.json",
      error: /use npm with a package-lock\.json/u,
      arrange: (root) => rm(join(root, "package-lock.json")),
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async (t) => {
      const consumerRoot = await createConsumer();
      t.after(() => rm(consumerRoot, { recursive: true, force: true }));
      await scenario.arrange?.(consumerRoot);
      const packageBefore = await readFile(
        join(consumerRoot, "package.json"),
        "utf8",
      );
      const lockBefore = await readOptionalFile(
        join(consumerRoot, "package-lock.json"),
      );
      let installCalled = false;

      await assert.rejects(
        initializeConsumer(consumerRoot, {
          ...scenario.options,
          installDesignSystem: async () => {
            installCalled = true;
          },
        }),
        scenario.error,
      );

      assert.equal(installCalled, false);
      assert.equal(
        await readFile(join(consumerRoot, "package.json"), "utf8"),
        packageBefore,
      );
      assert.equal(
        await readOptionalFile(join(consumerRoot, "package-lock.json")),
        lockBefore,
      );
      await assertNoSkillArtifacts(consumerRoot);
      await assertNoProviderArtifacts(consumerRoot);
    });
  }
});

async function createConsumer() {
  const consumerRoot = await mkdtemp(join(tmpdir(), "xui-init-"));

  await writeJson(join(consumerRoot, "package.json"), {
    name: "consumer",
    private: true,
    scripts: {
      typecheck: "tsc --noEmit",
    },
    dependencies: {
      [RELEASE.name]: XUI_SOURCE,
      react: CONSUMER_PACKAGES.react,
      "react-dom": CONSUMER_PACKAGES["react-dom"],
    },
    devDependencies: {
      eslint: CONSUMER_PACKAGES.eslint,
      tailwindcss: CONSUMER_PACKAGES.tailwindcss,
      typescript: CONSUMER_PACKAGES.typescript,
    },
  });
  await writeFile(join(consumerRoot, "package-lock.json"), "{}\n");
  await mkdir(join(consumerRoot, ".git"));
  await writeFile(
    join(consumerRoot, "eslint.config.mjs"),
    "export default [];\n",
  );
  await Promise.all(
    Object.entries(CONSUMER_PACKAGES).map(([name, version]) =>
      writeJson(join(consumerRoot, "node_modules", name, "package.json"), {
        name,
        version,
      }),
    ),
  );

  return consumerRoot;
}

async function initializeConsumer(consumerRoot, options = {}) {
  return initializeConsumerForHost(consumerRoot, {
    platform: "darwin",
    ...options,
  });
}

async function installFixture({ consumerRoot, name, version }) {
  const consumerPackagePath = join(consumerRoot, "package.json");
  const consumerPackage = await readJson(consumerPackagePath);
  consumerPackage.dependencies[name] = version;
  await writeJson(consumerPackagePath, consumerPackage);

  const installedRoot = join(
    consumerRoot,
    "node_modules",
    ...name.split("/"),
  );
  await writeJson(join(installedRoot, "package.json"), { name, version });
  await Promise.all(
    Object.entries(REFERENCES).map(([referenceName, content]) =>
      writeFile(join(installedRoot, referenceName), content),
    ),
  );
}

async function snapshotManagedFiles(consumerRoot) {
  const entries = await Promise.all(
    MANAGED_PATHS.map(async (path) => [
      path,
      await readFile(join(consumerRoot, ...path.split("/")), "utf8"),
    ]),
  );

  return {
    ...Object.fromEntries(entries),
    ".claude/skills/xui": await readlink(
      join(consumerRoot, ".claude", "skills", "xui"),
    ),
  };
}

async function assertNoSkillArtifacts(consumerRoot) {
  await assert.rejects(
    lstat(join(consumerRoot, ".agents", "skills", "xui")),
    isMissing,
  );
  await assert.rejects(
    lstat(join(consumerRoot, ".claude", "skills", "xui")),
    isMissing,
  );
}

async function assertNoProviderArtifacts(consumerRoot) {
  for (const target of [CLAUDE_SETTINGS_PATH, CODEX_HOOKS_PATH]) {
    await assert.rejects(lstat(join(consumerRoot, ...target)), isMissing);
  }
}

function canonicalHookConfig() {
  return {
    hooks: {
      Stop: [{ hooks: [canonicalStopHandler()] }],
    },
  };
}

function canonicalStopHandler() {
  return {
    type: "command",
    command: XUI_STOP_COMMAND,
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readOptionalFile(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissing(error)) {
      return undefined;
    }

    throw error;
  }
}

async function updateConsumerPackage(consumerRoot, update) {
  const path = join(consumerRoot, "package.json");
  const consumerPackage = await readJson(path);
  update(consumerPackage);
  await writeJson(path, consumerPackage);
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
