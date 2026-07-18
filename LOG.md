# GameBox 開發日誌 (LOG.md)

## [2026-06-23] 階段 2–7：全功能完整實作完成

### 【已完成的內容】

**後端 Rust (src-tauri/src/)**
1. **`db.rs`**：SQLite CRUD 完整實作（`games` 表 + `config` 表、預設設定值、截圖子目錄自動建立）。
2. **`api.rs`**：HoYoVerse API（圖標、背景、Theme 疊圖、版本比對）與 Kuro Game API（背景 + Slogan 疊圖、本地版本讀取）整合，具備啟動後一次性記憶體快取。
3. **`monitor.rs`**：背景執行緒每 2 秒使用 `sysinfo` 輪詢遊戲 `.exe` 進程，自動統計啟動次數、遊玩時間、最後遊玩時間，並透過 Tauri Event 即時通知前端。
4. **`capture.rs`**：Win32 `EnumWindows + BitBlt + GetDIBits` 精準視窗擷取（GDI），BGRA→RGBA 轉換後以 `image` crate 存為 PNG。`RegisterHotKey` 全域熱鍵（預設 `Alt+D`）、`gilrs` 手柄 Home 鍵監聽。快捷鍵可透過前端動態重載。
5. **`lib.rs`**：串接所有模組，暴露 10 個 Tauri Commands：`get_games`、`add_game`、`delete_game`、`update_game`、`get_config`、`set_config`、`fetch_api_data`、`launch_game`、`open_folder`、`reload_hotkey_command`。

**前端 React + TypeScript (src/)**
1. **`index.css`**：微賽博朋克全域樣式（霓虹 Neon 字效/邊框、毛玻璃、自訂捲軸、全域字型 Outfit）。
2. **`App.tsx`**：主畫面完整實作，含：左側遊戲收藏清單（右鍵選單、執行狀態指示燈）、右側主視覺區（背景圖/影片 + Slogan 疊圖淡入 500ms、版本比對顯示）、底部統計資訊欄（啟動次數/遊玩時長/最後遊玩）、右下固定尺寸動作按鈕（`ready|running|need_update` 狀態機）、截圖成功/失敗 Toast 通知。
3. **`components/RightClickMenu.tsx`**：自訂右鍵選單組件（更改設定、查看截圖、刪除遊戲）。
4. **`components/SettingsModal.tsx`**：雙 Tab 毛玻璃 Modal（遊戲新增/編輯、全域設定含快捷鍵即時錄製）。

**驗證結果**
- `cargo check`：0 errors（僅 7 個 warning，均為 dead_code 或 unused_must_use，不影響功能）
- `npm run build`：0 errors，TypeScript + Vite 全部通過，輸出 213KB JS + 36KB CSS

### 【下一步的行動建議】
1. **整合測試**：執行 `npm run tauri dev` 啟動完整應用程式，進行以下驗證：
   - 新增 HoYoVerse 遊戲（例如原神 `gopR6Cufr3`），確認背景圖與版本資訊正確載入
   - 啟動遊戲後，確認按鈕變為「遊戲正在執行中」，關閉後統計時間更新
   - 按下 `Alt+D`，確認在遊戲的截圖目錄下生成了 PNG 截圖
   - 右鍵選單點「查看截圖」，確認 Explorer 正確開啟
2. **警告清理**：可選擇清理 Rust 的 7 個 dead_code warning（移除未使用的函數或加上 `#[allow(dead_code)]`）
3. **進階功能**：可繼續實作遊戲圖示顯示於桌面系統匣（System Tray）或是遊戲版本更新進度條

---

## [2026-06-23] 階段 1：基礎架構與資料庫設計完成

### 【已完成的內容】
1. **專案初始化**：
   - 使用 `create-tauri-app` 初始化了 Tauri v2 + React 19 + TypeScript + Vite 7 專案基礎。
   - 安裝與設定 Tailwind CSS v4 樣式系統，並在 `vite.config.ts` 中完成 `@tailwindcss/vite` 插件設定與引入。
2. **視窗規格配置**：
   - 於 `src-tauri/tauri.conf.json` 中，禁用使用者拖曳調整視窗大小功能 (`resizable: false`)，關閉最大化與全螢幕。
   - 於 `src-tauri/src/lib.rs` 的 `setup` 鉤子中，實作當前螢幕物理解析度與 DPI 的動態適配：
     - 若為標準 1080p 螢幕，初始尺寸精準設為物理像素 `1280x720`。
     - 若為其他解析度，則動態計算約佔螢幕面積 1/4 的 16:9 尺寸，並將視窗居中。
3. **本地 SQLite 資料庫設計**：
   - 於 `Cargo.toml` 引入 `rusqlite` (bundled)。
   - 於後端 `lib.rs` 中實作了 SQLite 初始化邏輯。程式啟動時會自動建立或載入 `gamedata.sqlite` 資料庫，並自動建立 `games` 資料表，欄位包含 `game_id`, `game_name`, `exe_path`, `launch_count`, `play_time`, `last_played`, `screenshot_dir`, `api_provider`, `api_game_id`。
4. **驗證與編譯**：
   - 執行 `cargo check` 驗證後端編譯正常通過，所有相依套件皆順利下載編譯。

### 【下一步的行動建議】
1. **進入階段 2：遊戲庫核心邏輯與 API 整合**
   - 實作遊戲收藏的 Rust 後端 API (tauri commands)：包含新增遊戲、讀取收藏清單。
   - 實作 `game_id` 自動化處理邏輯（自動去除執行檔後綴 `.exe`）。
   - 實作在成功新增遊戲收藏時，在使用者設定的「截圖儲存主資料夾」下自動建立以 `game_id` 為名稱的專屬子資料夾。
   - 整合 HoYoVerse API 抓取遊戲資訊（標識、圖標、背景圖與版本比對）。
   - 整合 Kuro Game API 抓取遊戲背景與 Slogan 圖。
