import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const README = await readFile(new URL("../README.md", import.meta.url), "utf8");
const RUNBOOK = await readFile(
  new URL("../doc/runbooks/agent-install.md", import.meta.url),
  "utf8",
);

test("root README gives users one agent-first route to the canonical runbook", () => {
  assert.match(README, /https:\/\/github\.com\/moxamax\/xui-public\.git/u);
  assert.match(README, /doc\/runbooks\/agent-install\.md/u);
  assert.match(
    README,
    /請依 xui 的 Agent 安裝流程[\s\S]*先檢查環境，不符合就停下/u,
  );

  assert.doesNotMatch(README, /npm install/u);
  assert.doesNotMatch(README, /refs\/tags|peeled commit|full-commit-sha/u);
  assert.doesNotMatch(
    README,
    /node \.\/node_modules\/xui\/bin\/xui\.mjs/u,
  );
});

test("install runbook fails closed before touching an unsupported consumer", () => {
  assert.match(RUNBOOK, /唯讀前置檢查/u);
  assert.match(
    RUNBOOK,
    /macOS[\s\S]*package-lock\.json[\s\S]*workspaces、monorepo[\s\S]*Windows／Linux/u,
  );
  assert.match(
    RUNBOOK,
    /React、React DOM、TypeScript、Tailwind CSS 4[\s\S]*ESLint 9[\s\S]*eslint\.config\.\*[\s\S]*npm run typecheck/u,
  );
  assert.match(
    RUNBOOK,
    /來源不明或[\s\S]*未提交變更[\s\S]*立即停止[\s\S]*不得自行 stash、commit、reset、刪除或覆寫/u,
  );
  assert.match(
    RUNBOOK,
    /任一項不成立時，不安裝套件、不修改檔案/u,
  );
});

test("install runbook resolves only an immutable unambiguous SemVer release", () => {
  assert.match(RUNBOOK, /只接受完整 SemVer tag（可有前置 `v`）/u);
  assert.match(RUNBOOK, /未指定版本時選最新 SemVer/u);
  assert.match(RUNBOOK, /多個 tag 或 commit 時停止並回報歧義/u);
  assert.match(
    RUNBOOK,
    /annotated tag[\s\S]*peeled commit[\s\S]*lightweight tag[\s\S]*40 位 commit SHA[\s\S]*不得使用 tag object SHA/u,
  );
  assert.match(
    RUNBOOK,
    /package\.json`?、CLI entry 與 install lifecycle scripts[\s\S]*preinstall[\s\S]*prepare/u,
  );
  assert.match(RUNBOOK, /xui 目前沒有可安裝版本/u);
  assert.match(
    RUNBOOK,
    /不得降級成[\s\S]*`main`[\s\S]*`npx`[\s\S]*`npm exec`[\s\S]*npm registry/u,
  );
});

test("install runbook pins the reviewed source and uses only project-local commands", () => {
  assert.match(
    RUNBOOK,
    /repository 部分必須是使用者[\s\S]*同一來源[\s\S]*不得換成 registry 或其他 repository/u,
  );
  assert.match(
    RUNBOOK,
    /npm install --save-exact --ignore-scripts -- "xui@git\+https:\/\/github\.com\/moxamax\/xui-public\.git#<full-commit-sha>"/u,
  );
  assert.match(
    RUNBOOK,
    /package\.json[\s\S]*package-lock\.json[\s\S]*node_modules\/xui\/package\.json[\s\S]*40 位 SHA/u,
  );
  assert.match(
    RUNBOOK,
    /node \.\/node_modules\/xui\/bin\/xui\.mjs init[\s\S]*node \.\/node_modules\/xui\/bin\/xui\.mjs status --json[\s\S]*node \.\/node_modules\/xui\/bin\/xui\.mjs check/u,
  );
  assert.doesNotMatch(RUNBOOK, /^xui (?:init|status|check)$/mu);
});

test("install runbook carries setup, validation, and provider handoff to completion", () => {
  assert.match(
    RUNBOOK,
    /@qijenchen\/design-system\/README\.md[\s\S]*CSS imports、Tailwind source 與 Provider/u,
  );
  assert.match(
    RUNBOOK,
    /`localPair` 必須為 `valid`[\s\S]*npm run typecheck[\s\S]*test、lint、build 與真實環境驗證/u,
  );
  assert.match(
    RUNBOOK,
    /Claude Code[\s\S]*Codex[\s\S]*`\/hooks`[\s\S]*不得代替使用者信任/u,
  );
  assert.match(
    RUNBOOK,
    /分開回報：安裝是否完成、版本配對、xui 檢查、consumer 原有驗證、視覺／瀏覽器驗證/u,
  );
});
