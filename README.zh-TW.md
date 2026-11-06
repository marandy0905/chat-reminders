# Chat 提醒

[English](README.md) | **繁體中文**

為瀏覽器中的 **Slack、Google Chat 與 Microsoft Teams**（app.slack.com、chat.google.com 與 Gmail 內的 Chat、teams.microsoft.com / teams.cloud.microsoft）加上訊息提醒功能，三個 App 的提醒集中在同一個清單。

## 安裝（不需要寫程式）
1. 前往[最新版本](https://github.com/marandy0905/chat-reminders/releases/latest)，下載 **chat-reminders.zip**。
2. 解壓縮，並把資料夾放在固定的位置（例如「文件」）。Chrome 會從該資料夾讀取擴充功能，所以之後請不要刪除或移動它。
3. 在 Chrome 網址列輸入 `chrome://extensions` 並開啟。
4. 開啟右上角的**開發人員模式**。
5. 點選**載入未封裝項目**，選擇剛剛解壓縮的資料夾。
6. 重新整理 Slack、Google Chat 與 Teams 分頁。如果系統詢問，請允許 Chrome 傳送通知。

小提示：點選 Chrome 工具列的拼圖圖示，將 **Chat Reminders** 釘選起來，圖示就會一直顯示。

## 使用方式
- **在訊息上設定：**將滑鼠移到訊息上，點選時鐘按鈕（位於 App 本身的訊息工具列，「更多」按鈕旁）並選擇時間。通知會顯示訊息內容與來源 App，點選通知會切換到該 App 的分頁並開啟該則訊息。
- **所有 App 一個清單：**彈出視窗、總覽與頁面內面板都會一起顯示 Slack、Google Chat 與 Teams 的提醒，並標示來源 App。總覽可依 App 篩選。
- **彈出視窗：**點選工具列圖示（或 Chat 內的時鐘按鈕），可查看即將到來的提醒，並進行延後、開啟或刪除。**延後**會開啟下拉選單：10 分鐘、30 分鐘、1 小時、3 小時或自訂時間。
- 通知上有 **延後 20 分鐘** 與 **標示為完成** 兩個按鈕；點選通知本身只會開啟聊天室。除非你按下**標示為完成**，否則提醒會維持「已逾期」狀態。
- **總覽：**彈出視窗中的**查看全部**會開啟總覽頁面，分為已逾期／今天／明天／之後／已完成，每則提醒都可延後（同樣的延後選單）、完成、開啟或刪除。
- **App 內的捷徑：**時鐘按鈕（Google Chat 在「New chat」旁；Slack 與 Teams 在視窗右側邊緣的小標籤）會開啟提醒面板。任何一個 App 有逾期提醒時都會顯示紅色與數量。快速鍵：**Alt+Shift+R**（可在 `chrome://extensions/shortcuts` 修改）。

- **快速選項：**設定提醒時提供的時間（預設為 20 分鐘、1 小時、2 小時、3 小時、明天 10:00）可以直接在提醒選單裡修改：點選選單上方的**編輯**，就能修改、新增或移除「多久之後」與「明天的時間」（最多 8 個），完成後按**完成**。變更會立即儲存。「自訂時間」一律可用。

## 更新
Chrome 無法自動更新這個擴充功能，所以改成一鍵更新。擴充功能約每天檢查一次新版本，若有新版本，會顯示通知、在工具列圖示上顯示 **NEW** 標記，並在彈出視窗與面板顯示提示。
1. 點選通知或提示，開啟更新頁面。
2. 只有第一次需要：點選**選擇資料夾**，選取你在 `chrome://extensions` 載入的資料夾（解壓縮後的 Chat Reminders 資料夾）。
3. 點選**立即更新**。擴充功能會把最新版本下載到該資料夾並自動重新載入，之後請重新整理 Chat。

注意：請選擇 Chat Reminders 資料夾本身，不要選上層資料夾（例如「文件」，Chrome 會封鎖）。之後的瀏覽工作階段中，Chrome 可能會再次要求確認資料夾存取權。若一鍵更新失敗，請到[最新版本](https://github.com/marandy0905/chat-reminders/releases/latest)下載 **chat-reminders.zip**，解壓縮並覆蓋原資料夾，再到 `chrome://extensions` 重新載入。

## 語言
整個擴充功能（選單、面板、彈出視窗、總覽、通知、更新頁面）在瀏覽器語言為繁體中文（zh-TW／zh-HK／zh-MO／zh-Hant）時顯示繁體中文，其他語言一律顯示英文。

## 備註
- 所有資料都儲存在 `chrome.storage.local`。唯一的網路請求是每日的更新檢查（讀取此專案公開的 `manifest.json`），以及你按下**立即更新**時從 GitHub 下載的發行檔，不會傳送任何提醒資料。
- 每個 App 的頁面結構各自放在 adapter：`sites/gchat.js`、`sites/slack.js`、`sites/teams.js`（共用介面在 `content.js`）。如果某個 App 的時鐘按鈕不再出現，請更新該 adapter 開頭的選擇器。**按住 Shift 點選**時鐘按鈕，會把擴充功能在該則訊息看到的資訊（JSON）複製到剪貼簿，方便除錯。
- 連結：Google Chat 由訊息 ID 組成連結（找不到時改開聊天室／私訊）。Slack 使用訊息本身的永久連結。Teams 需要對話 ID，找不到時點選提醒只會切換到 Teams 分頁。
- 支援 Slack／Teams 之前建立的提醒，一律視為 Google Chat 提醒。
