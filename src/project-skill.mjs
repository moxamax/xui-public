export const PROJECT_SKILL_NAME = "SKILL.md";
export const CLAUDE_SKILL_PATH = [".claude", "skills", "xui"];
export const CLAUDE_SKILL_TARGET = "../../.agents/skills/xui";

export const PROJECT_SKILL_CONTENT = `---
name: xui
description: 使用專案固定版本的 design-system reference 指導 UI 工作與 xui lifecycle。建立、修改或審查 React／TSX UI，使用元件、表單、圖示、Tailwind class 或 design token，檢查 design-system 合規性，或安裝、查詢狀態與更新 xui 時使用。
---

# xui

## 資訊來源

把本專案內的 xui skill 與 design-system reference 視為同一組版本化配對，並視為本專案唯一具版本約束的 design-system 資訊來源。只把同領域的 user-level skill 或模型記憶當作補充；不得讓它們覆蓋或取代 \`references/\` 內容。

## 唯一執行入口

從 consumer 的 package／Git root 執行所有 lifecycle 命令，且只使用專案內 binary：\`node ./node_modules/xui/bin/xui.mjs <command>\`。不得使用裸 \`xui\`、\`npx xui\`、\`npm exec\` 或其他可能從 registry 取得同名套件的命令。

若 \`node_modules/xui\` 遺失但 consumer 的 package 與 lockfile 仍有固定 SHA 的 xui dependency，先使用 \`npm install --ignore-scripts\` 還原已鎖定依賴。若 dependency 本身遺失，從 \`references/catalog.json\` 確認原來來源，停止並依該 repo 的 \`doc/runbooks/agent-install.md\` 處理；不得臨時下載。

## 每個新對話的第一次啟用

只執行一次唯讀的 \`node ./node_modules/xui/bin/xui.mjs status --json\`，不要在同一對話內重複查詢。用自然語言告訴使用者：

- agent 規則與元件庫是一組固定配對，不會無聲升級。
- \`localPair\` 為 \`valid\` 時表示可繼續；為 \`missing\` 或 \`mismatch\` 時先執行 \`node ./node_modules/xui/bin/xui.mjs init\` 並修正其後檢查錯誤。
- \`updateStatus\` 只查詢 xui release。為 \`current\` 時表示已是最新 xui 配對，不代表上游 design-system 沒有新版；為 \`available\` 時只告知有新 xui 配對可用，不自動升級；為 \`unknown\` 時說明暫時無法查詢，但有效的本地配對仍可使用。

除非除錯需要，不要要求使用者理解或選擇原始版本號與 Git SHA。

## 自然語言更新

只有使用者表達升級意圖時才更新；單純發現 updateStatus: available 不得自動升級。更新時：

1. 從 consumer package.json 目前的 xui Git dependency 保留相同 remote，查詢其 immutable semver tags；使用者未指定版本時選最新的較新 release，指定版本時只接受存在的 semver release。
2. 將目標 tag 解析並驗證為其指向的完整 40 位 commit SHA；annotated tag 必須使用 peeled commit，不得把 tag object SHA 寫入 dependency。
3. 把 xui dependency 更新為相同 Git source 加上該完整 SHA，使用 \`npm install --save-exact --ignore-scripts\` 安裝後，重跑 \`node ./node_modules/xui/bin/xui.mjs init\`。不得使用浮動 branch、alias、tag 字串或臨時執行方式，也不得新增或呼叫公開的 upgrade command。
4. 依新版本 package README 重新確認 setup，檢查受影響的既有用法，再執行下方審查與檢查迴圈直到全綠。

交付時除了一般驗證狀態，另以自然語言摘要文件與程式差異、受影響元件、已做修正及剩餘未知；不要要求使用者閱讀 Git diff。

## Provider 啟用

Codex 只會在專案為 trusted 時載入 project-local \`.codex/hooks.json\`，且新增或變更的 command hook 必須先在 \`/hooks\` 審閱並信任當前 hash。若尚未完成，說明 Stop backstop 目前未啟用並引導使用者完成審閱；不得自行修改 \`.codex/config.toml\` 或在一般工作中繞過 hook trust。

## 查閱與 setup

1. 先讀 \`references/llms.txt\`。
2. 再只搜尋 \`references/llms-full.txt\` 中與當前工作相關的章節。
3. API 有歧義或文件版本標示與配對不一致時，依 consumer 根目錄的 [上游資料判準](../../../node_modules/xui/doc/reference/upstream-guidance.md) 核對實際安裝 package 的 spec、\`.d.ts\` 與 metadata。

開始 UI 工作前，確認 consumer 已符合當前版本的 setup。初次 setup 或版本配對變更時，另讀實際安裝 package README 的 setup 章節，依 consumer 結構處理 CSS imports、Tailwind source 與 Provider。

## 實作選擇

新建元件前先搜尋 consumer 的現有程式。依序考慮：

1. design-system 已有的元件或能力。
2. consumer 已有的元件、依賴或可安全使用的原生元素。
3. 新依賴。

只有在需要新增依賴，或遇到實質 UX／accessibility 取捨時，才先請使用者決定。若 design-system 沒有所需能力而改用 consumer 現有能力，在交付時揭露。

## 審查與檢查迴圈

實作後先重新對照本次使用元件的相關上游指引，修正已知偏離，再執行 \`node ./node_modules/xui/bin/xui.mjs check\`。診斷並修正所有錯誤後重跑。該檢查回報的 consumer 錯誤即使早於本次工作就已存在，也必須修正；不得以「既有問題」略過，也不得建立 baseline 或 suppression。

型別檢查遇到 React 19 的 \`@dnd-kit/core\`／\`JSX\` 錯誤時，先讀 [上游資料判準](../../../node_modules/xui/doc/reference/upstream-guidance.md#react-19-的頂層-import)，依適用配對處理再重跑。

檢查全綠後，再次重新對照相關上游指引。若因此修改程式，必須再跑 \`node ./node_modules/xui/bin/xui.mjs check\`。重複到沒有已知偏離且靜態契約全綠；若有無法自行排除的外部 blocker，清楚說明原因與未完成項目。

## 交付

用自然語言摘要改動，並分開回報：

- 上游指引審查：已對照的相關章節與剩餘已知偏離。
- xui 靜態檢查：\`node ./node_modules/xui/bin/xui.mjs check\` 的實際結果。
- consumer 原有驗證：另外執行的適用 test、build 或其他專案指令；不要暗示 xui 靜態檢查已執行這些驗證。
- 視覺／瀏覽器驗證：使用其他適用 skill 或工具的結果；若未執行，明確寫「未執行」。
`;
