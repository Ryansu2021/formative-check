# 課堂形成性檢核（國中數學）

課堂用的形成性檢核系統：學生用平板兩輪作答＋勾信心程度，教師儀表板即時顯示選項分布、迷思分布、信心×對錯，下課前產出依迷思分組的補救名單。

| 網址 | 內容 |
|---|---|
| https://ryansu2021.github.io/formative-check/ | 入口 |
| https://ryansu2021.github.io/formative-check/route-a.html | 路線 A：題庫由 Claude 在備課端產生後匯入（內建七上 2-1 質因數分解・標準分解式 9 組平行題） |
| https://ryansu2021.github.io/formative-check/route-b.html | 路線 B：教師端內建 AI 生題（Gemini，老師自己的 key），含路線比較 |

## 功能
- 第一場整卷自主作答 → 停下討論 → 第二場平行題（同迷思、換數字）；每題勾信心程度，「很確定卻答錯」特別標出
- 每個誘答選項對應一個迷思代碼，儀表板即時統計迷思分布，點迷思看座號與補救建議
- 題庫自動驗算：程式重算正解，判讀每個誘答錯在哪
- 投影保護、QR Code 加入、出場摘要、CSV 匯出
- 示範模式（本機，不需帳號）與雲端模式（Firebase，沿用 prime-challenge 專案）

## 檔案
- `route-a.html`、`route-b.html`：單檔系統（學生端、教師端同一檔）
- `bank-7a-2-1-prime-factorization.json`：路線 A 題庫（fa-bank/1 格式）
- `firestore.rules`：Firebase 安全規則（數字大挑戰＋形成性檢核合併版）
- `設定說明.md`

蘇恭弘。數學王子。台南市忠孝國中製作
