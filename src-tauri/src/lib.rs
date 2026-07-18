use std::path::Path;
use serde::Serialize;
use std::fs;
use rusqlite::Connection;
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use tauri::{Emitter, Manager, AppHandle};
use serde_json::Value;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, Modifiers, Code};
use std::str::FromStr;
use winapi::shared::minwindef::DWORD;
use winapi::um::libloaderapi::{LoadLibraryA, GetProcAddress};

pub mod db;
pub mod api;
pub mod monitor;
pub mod capture;
pub mod hoyoplay;
pub mod kurogame;

#[derive(Serialize)]
pub struct FontInfo {
    pub name: String,
    pub size_mb: f64,
    pub is_default: bool,
}

#[derive(Serialize, Clone)]
pub struct GameStats {
    #[serde(rename = "launchCount")]
    pub launch_count: i32,
    #[serde(rename = "totalPlayTime")]
    pub total_play_time: i64, // Minutes
    #[serde(rename = "lastPlayed")]
    pub last_played: Option<String>,
    #[serde(rename = "lastClosed")]
    pub last_closed: Option<String>,
}

pub struct AppState {
    pub db: Mutex<Connection>,
    pub running_processes: Arc<Mutex<HashMap<String, bool>>>,
    pub screenshot_path: Mutex<String>,
    pub screenshot_hotkey: Mutex<String>,
    pub screenshot_watcher: Mutex<Option<notify::RecommendedWatcher>>,
}

#[tauri::command]
fn list_fonts() -> Vec<FontInfo> {
    let mut fonts = Vec::new();
    
    // Read fonts/default (Read-only)
    let default_dir = Path::new("fonts/default");
    if default_dir.exists() {
        if let Ok(entries) = fs::read_dir(default_dir) {
            for entry in entries.flatten() {
                if is_font_file(&entry) {
                    fonts.push(map_font_info(entry, true));
                }
            }
        }
    }

    // Read fonts/ (User uploaded)
    let user_dir = Path::new("fonts");
    if user_dir.exists() {
        if let Ok(entries) = fs::read_dir(user_dir) {
            for entry in entries.flatten() {
                if entry.path().is_file() && is_font_file(&entry) {
                    fonts.push(map_font_info(entry, false));
                }
            }
        }
    }
    fonts
}

fn is_font_file(entry: &fs::DirEntry) -> bool {
    let s = entry.file_name().to_string_lossy().to_lowercase();
    s.ends_with(".ttf") || s.ends_with(".woff") || s.ends_with(".woff2") || s.ends_with(".otf")
}

fn map_font_info(entry: fs::DirEntry, is_default: bool) -> FontInfo {
    let metadata = entry.metadata().ok();
    FontInfo {
        name: entry.file_name().to_string_lossy().to_string(),
        size_mb: metadata.map(|m| m.len() as f64 / 1_048_576.0).unwrap_or(0.0),
        is_default,
    }
}

#[tauri::command]
fn delete_font(name: String) -> Result<(), String> {
    let path = Path::new("fonts").join(&name);
    if !path.exists() { return Err("檔案不存在".to_string()); }
    if path.parent().and_then(|p| p.file_name()) == Some(std::ffi::OsStr::new("default")) {
        return Err("無法刪除預設字體".to_string());
    }
    fs::remove_file(path).map_err(|e| format!("刪除失敗: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn download_asset(url: String, filename: String) -> Result<String, String> {
    let dir = Path::new("assets_cache");
    if !dir.exists() { fs::create_dir_all(dir).map_err(|e| e.to_string())?; }
    
    let dest_path = dir.join(&filename);
    let client = reqwest::Client::new();
    let response = client.get(url).send().await.map_err(|e| e.to_string())?;
    let content = response.bytes().await.map_err(|e| e.to_string())?;
    
    fs::write(&dest_path, content).map_err(|e| e.to_string())?;
    Ok(dest_path.to_string_lossy().to_string())
}

#[tauri::command]
fn get_versions() -> Value {
    let path = Path::new("versions.json");
    if !path.exists() { return serde_json::json!({}); }
    let content = fs::read_to_string(path).unwrap_or_else(|_| "{}".to_string());
    serde_json::from_str(&content).unwrap_or_else(|_| serde_json::json!({}))
}

#[tauri::command]
fn save_version(channel_id: String, version: String) -> Result<(), String> {
    let mut versions = get_versions();
    if let Some(obj) = versions.as_object_mut() {
        obj.insert(channel_id, Value::String(version));
        let content = serde_json::to_string_pretty(&versions).map_err(|e| e.to_string())?;
        fs::write("versions.json", content).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn import_font(path: String) -> Result<String, String> {
    let src = Path::new(&path);
    if !src.exists() { return Err("來源檔案不存在".to_string()); }
    let font_name = src.file_name().ok_or("無效的檔名")?;
    let dest_dir = Path::new("fonts");
    if !dest_dir.exists() { fs::create_dir_all(dest_dir).map_err(|e| e.to_string())?; }
    let dest_path = dest_dir.join(font_name);
    fs::copy(src, &dest_path).map_err(|e| format!("複製失敗: {}", e))?;
    Ok(font_name.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = fs::create_dir_all("fonts/default");
    let _ = fs::create_dir_all("assets_cache");
    let state = AppState {
        db: Mutex::new(db::init_db()),
        running_processes: Arc::new(Mutex::new(HashMap::new())),
        screenshot_path: Mutex::new(String::new()),
        screenshot_hotkey: Mutex::new("Alt+D".to_string()),
        screenshot_watcher: Mutex::new(None),
    };

    // 預設截圖路徑
    let mut current_ss_path = String::new();
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(parent) = exe_path.parent() {
            let ss_path = parent.join("screenshots");
            let _ = fs::create_dir_all(&ss_path);
            current_ss_path = ss_path.to_string_lossy().to_string();
            *state.screenshot_path.lock().unwrap() = current_ss_path.clone();
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new()
            .with_handler(|app, shortcut, event| {
                if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                    let app_clone = app.clone();
                    let state = app_clone.state::<AppState>();
                    let hotkey_str = {
                        let h = state.screenshot_hotkey.lock().unwrap();
                        h.clone()
                    };
                    
                    if let Ok(target) = Shortcut::from_str(&hotkey_str) {
                        if shortcut.mods == target.mods && shortcut.key == target.key {
                            let app_task = app_clone.clone();
                            tauri::async_runtime::spawn(async move {
                                use std::panic::{self, AssertUnwindSafe};
                                let app_inner = app_task.clone();
                                let state_inner = app_inner.state::<AppState>();
                                
                                let _ = panic::catch_unwind(AssertUnwindSafe(move || {
                                    // 同步保護區
                                }));
                                
                                if let Err(e) = capture::capture_screenshot(app_inner.clone(), state_inner, None).await {
                                    eprintln!("Screenshot failed: {}", e);
                                }
                            });
                        }
                    }
                }
            })
            .build())
        .manage(state)
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();
            
            // 註冊預設快捷鍵 Alt+D
            let shortcut = Shortcut::new(Some(Modifiers::ALT), Code::KeyD);
            let _ = app.global_shortcut().register(shortcut);
            
            // 啟動檔案系統監控器
            let state = app.state::<AppState>();
            capture::start_screenshot_watcher(app.handle().clone(), &state);

            // 動態調整視窗比例 (根據顯示器)
            if let Ok(Some(monitor)) = window.current_monitor() {
                let size = monitor.size();
                let scale_factor = monitor.scale_factor();
                
                // 獲取螢幕的邏輯寬度
                let logical_monitor_width = size.width as f64 / scale_factor;
                
                // 設定視窗為該顯示器邏輯像素的 60%
                let target_width = logical_monitor_width * 0.6;
                let target_height = target_width * (720.0 / 1280.0);
                
                let _ = window.set_size(tauri::LogicalSize::new(target_width, target_height));
                let _ = window.center();
            }

            // ── 手把 Home/Guide 鍵截圖輪詢執行緒 ──────────────────────────────
            let app_gamepad = app.handle().clone();
            std::thread::spawn(move || {
                type XInputGetStateExFn = unsafe extern "system" fn(DWORD, *mut XInputStateEx) -> DWORD;

                #[repr(C)]
                struct XInputGamepad {
                    buttons: u16,
                    left_trigger: u8,
                    right_trigger: u8,
                    thumb_lx: i16,
                    thumb_ly: i16,
                    thumb_rx: i16,
                    thumb_ry: i16,
                }

                #[repr(C)]
                struct XInputStateEx {
                    packet_number: DWORD,
                    gamepad: XInputGamepad,
                }

                let func: Option<XInputGetStateExFn> = unsafe {
                    let dll_name = std::ffi::CString::new("xinput1_4.dll").unwrap();
                    let hmod = LoadLibraryA(dll_name.as_ptr());
                    if hmod.is_null() {
                        None
                    } else {
                        let proc = GetProcAddress(hmod, 100 as *const i8);
                        if proc.is_null() { None } else { Some(std::mem::transmute(proc)) }
                    }
                };

                let func = match func {
                    Some(f) => f,
                    None => return,
                };

                const GUIDE_BUTTON: u16 = 0x0400;
                let mut prev_pressed = false;

                loop {
                    std::thread::sleep(std::time::Duration::from_millis(50));

                    let mut state_ex = XInputStateEx {
                        packet_number: 0,
                        gamepad: XInputGamepad {
                            buttons: 0, left_trigger: 0, right_trigger: 0,
                            thumb_lx: 0, thumb_ly: 0, thumb_rx: 0, thumb_ry: 0,
                        },
                    };

                    let mut guide_now = false;
                    for user_index in 0..4u32 {
                        let result = unsafe { func(user_index, &mut state_ex) };
                        if result == 0 {
                            if state_ex.gamepad.buttons & GUIDE_BUTTON != 0 {
                                guide_now = true;
                                break;
                            }
                        }
                    }

                    if guide_now && !prev_pressed {
                        let app_inner = app_gamepad.clone();
                        tauri::async_runtime::spawn(async move {
                            let state_inner = app_inner.state::<AppState>();
                            if let Err(e) = capture::capture_screenshot(app_inner.clone(), state_inner, None).await {
                                eprintln!("Gamepad Home screenshot failed: {}", e);
                            }
                        });
                    }
                    prev_pressed = guide_now;
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            monitor::run_game, 
            monitor::get_game_stats,
            monitor::is_game_running,
            monitor::recover_running_games,
            list_fonts, 
            import_font, 
            delete_font,
            download_asset,
            get_versions,
            save_version,
            capture::open_screenshot_folder,
            capture::ensure_screenshot_dir,
            capture::get_game_screenshots,
            capture::open_folder,
            capture::capture_screenshot,
            capture::delete_screenshot,
            capture::update_screenshot_config,
            capture::open_game_launcher,
            hoyoplay::fetch_hoyoplay_games, 
            hoyoplay::fetch_hoyoplay_game_info,
            hoyoplay::check_hoyoplay_update,
            hoyoplay::open_hoyoplay_launcher,
            kurogame::fetch_kurogame_games,
            kurogame::fetch_kurogame_game_info,
            kurogame::check_kurogame_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
