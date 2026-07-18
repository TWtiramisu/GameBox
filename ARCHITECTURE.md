# GameBox 專案架構說明文件

本文件用以記錄 `GameBox`（遊戲盒子）桌面應用程式的整體系統架構、技術棧、模組設計與前後端契約。

---

## 1. 技術棧 (Tech Stack)
- **桌面端框架**：Tauri v2 (Rust)
- **前端框架**：React 19 + Vite 7 + TypeScript
- **樣式系統**：Tailwind CSS v4 (透過 `@tailwindcss/vite` 插件整合)
- **資料庫**：SQLite (後端透過 `rusqlite` 以 Bundled 模式內嵌)
- **主要 Rust 依賴**：`reqwest` (HTTP)、`sysinfo` (程序監控)、`gilrs` (手柄)、`image` (PNG)、`windows` (GDI/Win32)、`chrono`、`lazy_static`

---

## 2. 視窗適配與限制 (Window Configuration)
- **比例限制**：嚴格限制為 **16:9**，且禁用調整大小與最大化。
- **動態尺寸適配**：標準 1080p 下設為 `1280×720` 實體像素，其他解析度動態計算並置中。

---

## 3. 資料庫設計 (Database Schema)

### `games` 資料表
| 欄位名稱 | 型別 | 說明 |
| :--- | :--- | :--- |
| `game_id` | TEXT (PK) | 遊戲唯一 ID，與執行檔名相同（不含 `.exe`） |
| `game_name` | TEXT | 遊戲顯示名稱 |
| `exe_path` | TEXT | 遊戲執行檔路徑 |
| `launch_count` | INTEGER | 啟動次數（預設 0）|
| `play_time` | INTEGER | 遊玩時間（秒，預設 0）|
| `last_played` | TEXT | 最後遊玩時間（ISO 8601 字串）|
| `screenshot_dir` | TEXT | 本地遊戲截圖目錄絕對路徑 |
| `api_provider` | TEXT | `hoyoverse` \| `kuro` \| `none` |
| `api_game_id` | TEXT | 對應的官方 API 遊戲 ID |

### `config` 資料表
| key | 說明 |
| :--- | :--- |
| `screenshot_base_dir` | 截圖儲存主資料夾路徑 |
| `screenshot_shortcut` | 全域截圖快捷鍵字串，例如 `Alt+D` |

---

## 4. 後端模組架構 (Rust Modules)

### `src-tauri/src/lib.rs`
應用程式進入點。
- 串接所有子模組（`db`、`api`、`monitor`、`capture`）
- 初始化資料庫、監控執行緒、熱鍵監聽
- 在 `setup` 鉤子中動態適配視窗 DPI 與大小
- 向前端暴露所有 Tauri Commands

### `src-tauri/src/db.rs`
SQLite 連線與 CRUD 操作。
- `init_db()` — 建立 `games` 和 `config` 資料表及預設值
- `db_get_games()` — 取回所有遊戲
- `db_add_game(name, path, api_provider, api_game_id)` — 新增遊戲，自動解析 `game_id`（去掉 `.exe`），自動建立截圖子目錄
- `db_delete_game(game_id)` — 刪除遊戲
- `db_update_game(game)` — 編輯遊戲的名稱/路徑/API 設定
- `db_update_game_stats(game_id, launch_count, play_time, last_played)` — 更新統計數據
- `get_config_val(key)` / `set_config_val(key, value)` — 讀寫設定

### `src-tauri/src/api.rs`
HoYoVerse 與庫洛遊戲 API 整合與記憶體快取。
- 使用 `lazy_static` 的 `API_CACHE` 全域 Mutex HashMap 快取結果
- `fetch_game_api_data(game_id, api_provider, api_game_id, exe_path)` — 非同步請求 API 並快取
- **HoYoVerse**：整合 `getGames`（圖標）、`getAllGameBasicInfo`（背景/Theme 疊圖）、`getGamePackages`（版本比對）
- **Kuro Game**：整合 `zh-Hant.json`（背景 + Slogan 疊圖），本地版本讀取 `launcherDownloadConfig.json`
- 版本比對後設定 `need_update: bool`

### `src-tauri/src/monitor.rs`
遊戲程序輪詢監控（每 2 秒）。
- `RUNNING_GAME` — 全域 Mutex 記錄當前執行中的遊戲 PID 與啟動時間
- `start_monitor_thread(app_handle)` — 背景執行緒，使用 `sysinfo` 偵測與資料庫中遊戲 ID 對應的 `.exe` 程序
- 遊戲啟動時：更新 `launch_count`、`last_played`，並 emit `game-status-changed` 事件
- 遊戲關閉時：計算並累加 `play_time`，emit 事件更新前端

### `src-tauri/src/capture.rs`
截圖觸發與 Windows 原生視窗擷取。
- `find_hwnd_by_pid(pid)` — 使用 `EnumWindows` 找到目標 PID 的可見視窗 Handle
- `capture_hwnd(hwnd, path)` — 使用 `BitBlt + GetDIBits` 精準擷取視窗像素緩衝，轉換 BGRA→RGBA 並使用 `image` 庫存為 PNG
- `start_hotkey_listener(app_handle)` — 在獨立執行緒中使用 Win32 `RegisterHotKey`/`GetMessageW` 監聽全域熱鍵
- `start_gamepad_listener(app_handle)` — 使用 `gilrs` 監聽手柄 Mode 鍵（Home 鍵）觸發截圖
- `reload_hotkey()` — 前端可呼叫，透過 `PostThreadMessage` 通知熱鍵執行緒重新讀取資料庫中的快捷鍵設定

---

## 5. Tauri Commands（IPC 契約）

| Command | 參數 | 回傳 | 說明 |
| :--- | :--- | :--- | :--- |
| `get_games` | — | `Vec<Game>` | 取得所有收藏遊戲 |
| `add_game` | `name, path, apiProvider, apiGameId` | `Game` | 新增遊戲（自動處理 `game_id` 和截圖目錄）|
| `delete_game` | `gameId` | — | 刪除遊戲 |
| `update_game` | `game: Game` | — | 更新遊戲設定 |
| `get_config` | `key` | `String` | 讀取全域設定 |
| `set_config` | `key, value` | — | 寫入全域設定（若 `key=screenshot_shortcut` 則自動重載熱鍵）|
| `fetch_api_data` | `gameId, apiProvider, apiGameId, exePath` | `GameApiData` | 非同步請求 API（含快取）|
| `launch_game` | `exePath` | — | 在執行檔目錄啟動遊戲 |
| `open_folder` | `path` | — | 用 Explorer 開啟指定目錄 |
| `reload_hotkey_command` | — | — | 重新載入全域截圖快捷鍵 |

---

## 6. 前端事件（Tauri Event）

| 事件名稱 | Payload | 說明 |
| :--- | :--- | :--- |
| `game-status-changed` | `{ game_id, status: "running"\|"stopped", ... }` | 遊戲啟動/關閉時廣播（含最新統計）|
| `screenshot-captured` | `{ game_id, success, filepath?, error? }` | 截圖完成通知 |

---

## 7. 前端組件架構 (React Components)

- **`App.tsx`** — 主畫面：側邊欄遊戲清單、右側主視覺區（背景淡入動畫）、動作按鈕狀態機（`ready|running|need_update`）、截圖通知 Toast、事件監聽
- **`components/RightClickMenu.tsx`** — 自訂右鍵選單：更改設定、查看截圖、刪除遊戲
- **`components/SettingsModal.tsx`** — 雙 Tab Modal：遊戲設定（新增/編輯）、全域設定（截圖目錄與快捷鍵錄製）

---

## 8. 視覺設計語言 (Micro-Cyberpunk Theme)
- **背景**：深暗底色 `#030307`
- **主題色**：青藍 `rgba(0, 243, 255)` / 粉紅 `rgba(255, 0, 127)` 霓虹發光
- **毛玻璃**：`backdrop-blur-md` + `bg-black/60`，適用於非全螢幕資訊區塊
- **淡入**：遊戲切換時背景圖/影片套用 CSS `transition-opacity duration-500`
- **字體**：Outfit（Google Fonts），配合等寬字體顯示版本與時間統計
