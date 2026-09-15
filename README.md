# xui

xui 是安裝在 React／TypeScript／Tailwind CSS 4 專案裡的 AI agent 消費層。它會讓 AI Agent 使用專案固定版本的 design system，並在交付 UI 工作前完成靜態檢查。

## 交給 Agent 安裝

先用 Codex 或 Claude Code 開啟要導入 xui 的專案根目錄，再貼上：

```text
請替目前專案安全地安裝 xui，來源是 https://github.com/moxamax/xui-public.git
請依 xui 的 Agent 安裝流程 (doc/runbooks/agent-install.md) 安裝最新正式版
先檢查環境，不符合就停下並告訴我缺什麼
```

## 平常使用

安裝後不需要啟動 xui。直接向 Agent 描述 UI 需求，例如：

```text
請用目前專案的 design system 完成這個表單，並依 xui 指引審查、修正到檢查通過。
```

