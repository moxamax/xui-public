# Agent 安裝 xui

本 runbook 是第一次安裝 xui 的 canonical agent 流程。使用者只提供 consumer 專案與
xui 來源 URL；版本選擇、Git SHA、命令與設定都由 agent 處理。
官方來源為 https://github.com/moxamax/xui-public.git。先從來源 repo 讀取本流程；
無法讀取就停止。完成以下唯讀前置檢查後才可安裝。

## 1. 唯讀前置檢查

在修改 consumer 前完成：

1. 讀取 consumer 的 agent 指引、Git 狀態與 `package.json`；確認目前目錄同時是單一
   Git root 與單一 npm package root。
2. 確認系統為 macOS，Git、Node.js 與 npm 可用，且有 `package-lock.json`。不接受
   workspaces、monorepo、其他 package manager 的 lockfile 或 Windows／Linux。
3. 確認 consumer 直接宣告且已安裝 React、React DOM、TypeScript、Tailwind CSS 4.1+（4.x）與
   ESLint 9，使用 `eslint.config.*` flat config，並有非空白的 `npm run typecheck`。
4. 盤點預期會變動的 `package.json`、`package-lock.json`、`.agents/skills/xui/`、
   `.claude/skills`、`.claude/settings.json` 與 `.codex/hooks.json`。這些路徑若有來源不明或
   會重疊的未提交變更，立即停止並說明；不得自行 stash、commit、reset、刪除或覆寫。
5. 讀取現有 hook 與 skill 路徑的實際類型與 symlink target。無法判定 ownership 或安全
   merge 時停止，不猜測。

任一項不成立時，不安裝套件、不修改檔案，只用白話回報具體缺口。

## 2. 解析不可變 release

1. 查詢來源 repo 的遠端 tags，只接受完整 SemVer tag（可有前置 `v`）。不得把
   `main`、branch、alias 或非 SemVer tag 當成 release。
2. 使用者未指定版本時選最新 SemVer（包含先行版）；有指定時只接受實際存在的完整版本。同一
   SemVer 對應多個 tag 或 commit 時停止並回報歧義。
3. annotated tag 取 `refs/tags/<tag>^{}` 的 peeled commit；lightweight tag 取 tag ref
   本身。結果必須是該 repo 內實際存在的 40 位 commit SHA，不得使用 tag object SHA。
4. 在一次性目錄讀取該 commit 的 `package.json`、CLI entry 與 install lifecycle scripts。確認
   package name 為 `xui`、bin 指向 `bin/xui.mjs`，且沒有未預期的
   `preinstall`、`install`、`postinstall` 或 `prepare` script。異常時停止。

若沒有可安裝的 SemVer release，回報「xui 目前沒有可安裝版本」並停止。不得降級成
`main`、臨時 `npx`、`npm exec`、npm registry 的同名 `xui` 套件或其他來源。

## 3. 固定 SHA 並初始化

從 consumer 根目錄安裝前述同一來源與 commit。npm Git spec 的 repository 部分必須是使用者
提供且剛才審查的同一來源，不得換成 registry 或其他 repository。官方來源的命令如下：

```sh
npm install --save-exact --ignore-scripts -- "xui@git+https://github.com/moxamax/xui-public.git#<full-commit-sha>"
```

確認 `package.json`、`package-lock.json` 與 `node_modules/xui/package.json` 都是剛才審查的同一
package，dependency 以同一 40 位 SHA 結尾。不符就停止。

之後只從 consumer 根目錄執行 project-local CLI：

```sh
node ./node_modules/xui/bin/xui.mjs init
```

`init` 可在建立 skill 與 hooks 後因 consumer 檢查失敗而結束。此時不回滾或改用其他安裝法；
根據實際錯誤繼續修正。

## 4. 完成 consumer setup

1. 讀取 `node_modules/@qijenchen/design-system/README.md` 的 setup 章節。
2. 依 consumer 現有架構完成 CSS imports、Tailwind source 與 Provider。不覆寫既有入口或設定；
   需要新依賴、重要 UX 或 accessibility 取捨時先問使用者。
3. 對照實際安裝版本的 `llms.txt`、相關 `llms-full.txt` 章節，修正本次 setup 及已受
   影響用法的已知偏離。文件版本不一致或 API／setup 有歧義時，依
   [上游資料判準](../reference/upstream-guidance.md) 核對。

## 5. 驗證到全綠

執行：

```sh
node ./node_modules/xui/bin/xui.mjs status --json
node ./node_modules/xui/bin/xui.mjs check
```

安裝後確認 `node_modules/xui/doc/reference/upstream-guidance.md` 存在，且產生的
`.agents/skills/xui/SKILL.md` 連結可讀到該檔。型別檢查遇到 React 19 的
`@dnd-kit/core`／`JSX` 錯誤時，先讀 [上游資料判準](../reference/upstream-guidance.md#react-19-的頂層-import)，依適用配對處理再重跑。

`localPair` 必須為 `valid`。反覆診斷、修正並重跑 `check`，直到 Guard 與 consumer
`npm run typecheck` 全綠；不建立 baseline 或 suppression。之後另外執行 consumer 原有的相關
test、lint、build 與真實環境驗證。若有可用 browser 工具且安裝涉及實際 UI setup，開啟實際
畫面檢查；否則明確回報未執行視覺驗證。

不得使用裸 `xui`、`npx xui`、`npm exec` 或其他可能從 registry 取得同名套件的命令。

## 6. Provider 交接與回報

- Claude Code 必須能透過 `.claude/skills/xui` 讀到 canonical skill。
- Codex 的 project-local Stop hook 只會在 trusted project 中載入。安裝後要求使用者開啟
  `/hooks`，審閱並信任 xui command 的當前 hash；agent 不得代替使用者信任。
- 分開回報：安裝是否完成、版本配對、xui 檢查、consumer 原有驗證、視覺／瀏覽器驗證，
  以及 Codex hook 是否尚待使用者信任。失敗、跳過或尚有 blocker 時不得宣告完成。
