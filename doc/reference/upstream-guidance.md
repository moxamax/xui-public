# 上游資料判準

Reference hashes 只證明複本與安裝套件一致，不證明文件語意正確。保留上游文件原文，
不改寫頁首版本，也不因頁首過期便認定全文失效。

文件版本標示與配對不一致，或 API／setup 有歧義時，核對同一個實際安裝套件：

- 版本、peer 最低要求與可匯入路徑以 `package.json` 的 version、peerDependencies、exports 為準。
- 當次使用元件的用法與限制對照相關 spec；props 與 import 另以發布的 `.d.ts` 及 consumer
  `npm run typecheck` 驗證。型別可接受的組合仍須符合 spec 的使用限制。
- Setup 依 README 對照實際檔案，確認 CSS imports、Tailwind source 與必要 Provider。

只核對當次相關內容。若這些證據仍有無法排除的矛盾，回報具體缺口並保持工作未完成；
不得以雜湊一致或 typecheck 通過宣告語意相容。

## React 19 的頂層 import

觸發條件：React 19 的型別檢查出現 `@dnd-kit/core` 的全域 `JSX` 錯誤
（例如 `Cannot find namespace 'JSX'`）。

適用配對：xui release 指定的 `@qijenchen/design-system@0.1.0-beta.131`，
搭配 React 19 型別並執行完整 library typecheck。此配對的頂層 import 會引入上述
錯誤，即使 consumer 只使用 Button。其他配對須先核對實際安裝套件，不直接套用本修法。
遇到此情況，改用 package exports 支援的 `components/Button`、`components/Tooltip`
等元件子路徑，再執行 consumer typecheck；保留原有檢查設定。

這只能避開未使用元件引入的型別問題；若所需元件本身仍引入錯誤，回報 blocker。
