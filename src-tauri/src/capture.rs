use std::path::Path;
use std::fs;
use serde::Serialize;
use chrono::{DateTime, Local};
use tauri::{Emitter, Manager, AppHandle};
use screenshots::Screen;
use image::DynamicImage;
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};
use winapi::um::winuser::{GetClientRect, ClientToScreen, IsIconic, GetWindowRect, GetWindowThreadProcessId, EnumWindows, GetForegroundWindow};
use winapi::shared::windef::{RECT, POINT, HWND};
use winapi::shared::minwindef::{LPARAM, BOOL};
use notify::{Watcher, RecommendedWatcher, RecursiveMode};
use crate::AppState;

#[derive(Serialize)]
pub struct ScreenshotInfo {
    pub url: String,
    pub date: String,
    pub filename: String,
}

#[tauri::command]
pub async fn open_screenshot_folder(app: AppHandle, game_id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let base_path = {
        let path = state.screenshot_path.lock().unwrap();
        if path.is_empty() { return Err("尚未設定截圖路徑".to_string()); }
        path.clone()
    };
    let path = Path::new(&base_path).join(&game_id);
    if !path.exists() {
        fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    }
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_path(path.to_string_lossy().to_string(), None::<String>).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn ensure_screenshot_dir(game_id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let base_path = {
        let path = state.screenshot_path.lock().unwrap();
        if path.is_empty() { return Ok(()); }
        path.clone()
    };
    let path = Path::new(&base_path).join(&game_id);
    if !path.exists() {
        let _ = fs::create_dir_all(path);
    }
    Ok(())
}

#[tauri::command]
pub async fn get_game_screenshots(app: AppHandle, state: tauri::State<'_, AppState>, game_id: String) -> Result<Vec<ScreenshotInfo>, String> {
    let screenshot_path = {
        let p = state.screenshot_path.lock().unwrap();
        if p.is_empty() {
            let exe_dir = std::env::current_exe().map_err(|e| e.to_string())?.parent().unwrap().to_path_buf();
            exe_dir.join("screenshots").to_string_lossy().to_string()
        } else {
            p.clone()
        }
    };

    let dir = Path::new(&screenshot_path).join(&game_id);
    if !dir.exists() {
        return Ok(vec![]);
    }

    let mut screenshots = Vec::new();
    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;

    for entry in entries {
        if let Ok(entry) = entry {
            let path = entry.path();
            if path.is_file() {
                let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
                if ["png", "jpg", "jpeg", "webp"].contains(&ext.as_str()) {
                    let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
                    let modified: DateTime<Local> = metadata.modified().map_err(|e| e.to_string())?.into();
                    
                    let filename = path.file_name().unwrap().to_string_lossy().to_string();
                    let url = format!("asset://localhost/{}", path.to_string_lossy().replace("\\", "/"));
                    
                    screenshots.push(ScreenshotInfo {
                        url,
                        date: modified.format("%Y-%m-%d").to_string(),
                        filename,
                    });
                }
            }
        }
    }

    // Sort by filename descending (usually date-time based)
    screenshots.sort_by(|a, b| b.filename.cmp(&a.filename));

    Ok(screenshots)
}

#[tauri::command]
pub async fn delete_screenshot(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    game_id: String,
    filename: String,
) -> Result<(), String> {
    let screenshot_path = {
        let p = state.screenshot_path.lock().unwrap();
        if p.is_empty() {
            let exe_dir = std::env::current_exe().map_err(|e| e.to_string())?.parent().unwrap().to_path_buf();
            exe_dir.join("screenshots").to_string_lossy().to_string()
        } else {
            p.clone()
        }
    };

    let dir = Path::new(&screenshot_path).join(&game_id);
    let file_path = dir.join(&filename);

    if !file_path.starts_with(&dir) {
        return Err("非法檔案路徑".to_string());
    }

    if file_path.exists() && file_path.is_file() {
        fs::remove_file(file_path).map_err(|e| e.to_string())?;
        let _ = app.emit("screenshot-taken", &game_id);
        Ok(())
    } else {
        Err("找不到該截圖檔案".to_string())
    }
}

#[tauri::command]
pub async fn capture_screenshot(app: AppHandle, state: tauri::State<'_, AppState>, game_id: Option<String>) -> Result<String, String> {
    let target_game_id = if let Some(id) = game_id {
        id
    } else {
        let running = state.running_processes.lock().unwrap();
        running.iter()
            .find(|(_, &status)| status)
            .map(|(id, _)| id.clone())
            .ok_or("沒有正在執行的遊戲")?
    };

    let screenshot_path = {
        let p = state.screenshot_path.lock().unwrap();
        if p.is_empty() {
            let exe_dir = std::env::current_exe().map_err(|e| e.to_string())?.parent().unwrap().to_path_buf();
            exe_dir.join("screenshots").to_string_lossy().to_string()
        } else {
            p.clone()
        }
    };

    let mut game_hwnd: Option<HWND> = None;
    
    // 優先檢查當前前景視窗
    unsafe {
        let foreground_hwnd = GetForegroundWindow();
        if !foreground_hwnd.is_null() {
            let mut pid: u32 = 0;
            GetWindowThreadProcessId(foreground_hwnd, &mut pid);
            
            let mut sys = System::new();
            sys.refresh_processes(ProcessesToUpdate::Some(&[sysinfo::Pid::from_u32(pid)]), false);
            if let Some(process) = sys.process(sysinfo::Pid::from_u32(pid)) {
                let name = process.name().to_string_lossy().to_lowercase();
                let process_names = match target_game_id.as_str() {
                    "Genshin" => vec!["GenshinImpact.exe", "YuanShen.exe"],
                    "StarRail" => vec!["StarRail.exe"],
                    "Zenless" => vec!["ZenlessZoneZero.exe"],
                    "WutheringWave" => vec!["Client-Win64-Shipping.exe"],
                    _ => vec![]
                };
                
                if process_names.iter().any(|&p| name == p.to_lowercase()) || name.contains(&target_game_id.to_lowercase()) {
                    if IsIconic(foreground_hwnd) == 0 {
                        game_hwnd = Some(foreground_hwnd);
                    }
                }
            }
        }
    }

    if game_hwnd.is_none() {
        let mut sys = System::new();
        sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
        
        let process_names = match target_game_id.as_str() {
            "Genshin" => vec!["GenshinImpact.exe", "YuanShen.exe"],
            "StarRail" => vec!["StarRail.exe"],
            "Zenless" => vec!["ZenlessZoneZero.exe"],
            "WutheringWave" => vec!["Client-Win64-Shipping.exe"],
            _ => vec![]
        };

        let mut target_pids = Vec::new();
        for process in sys.processes().values() {
            let name = process.name().to_string_lossy().to_lowercase();
            if process_names.iter().any(|&p| name == p.to_lowercase()) || name.contains(&target_game_id.to_lowercase()) {
                target_pids.push(process.pid());
            }
        }

        if !target_pids.is_empty() {
            unsafe {
                struct EnumData {
                    pids: Vec<sysinfo::Pid>,
                    found_hwnd: Option<HWND>,
                }
                
                unsafe extern "system" fn enum_windows_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
                    let data = &mut *(lparam as *mut EnumData);
                    let mut pid: u32 = 0;
                    GetWindowThreadProcessId(hwnd, &mut pid);
                    if data.pids.iter().any(|&p| (p.as_u32() == pid)) {
                        if IsIconic(hwnd) == 0 {
                            data.found_hwnd = Some(hwnd);
                            return 0; // Stop
                        }
                    }
                    1 // Continue
                }

                let mut data = EnumData { pids: target_pids, found_hwnd: None };
                EnumWindows(Some(enum_windows_callback), &mut data as *mut _ as LPARAM);
                game_hwnd = data.found_hwnd;
            }
        }
    }

    let image = if let Some(hwnd) = game_hwnd {
        let mut client_rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        let mut window_rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        let mut top_left = POINT { x: 0, y: 0 };
        
        unsafe {
            GetClientRect(hwnd, &mut client_rect);
            GetWindowRect(hwnd, &mut window_rect);
            ClientToScreen(hwnd, &mut top_left);
        }

        let width = (client_rect.right - client_rect.left) as u32;
        let height = (client_rect.bottom - client_rect.top) as u32;
        
        if width == 0 || height == 0 {
            return Err("遊戲視窗無效".to_string());
        }

        let screens = Screen::all().map_err(|e| e.to_string())?;
        let center_x = top_left.x + (width as i32 / 2);
        let center_y = top_left.y + (height as i32 / 2);
        
        let screen = screens.into_iter().find(|s| {
            let info = s.display_info;
            center_x >= info.x && center_x < info.x + info.width as i32 &&
            center_y >= info.y && center_y < info.y + info.height as i32
        }).unwrap_or_else(|| Screen::all().unwrap().first().unwrap().clone());

        let screen_image = screen.capture().map_err(|e| e.to_string())?;
        let dynamic_img = DynamicImage::ImageRgba8(screen_image);
        
        let crop_x = (top_left.x - screen.display_info.x) as u32;
        let crop_y = (top_left.y - screen.display_info.y) as u32;
        
        dynamic_img.crop_imm(crop_x, crop_y, width, height)
    } else {
        let screens = Screen::all().map_err(|e| e.to_string())?;
        let screen = screens.first().ok_or("找不到顯示器")?;
        DynamicImage::ImageRgba8(screen.capture().map_err(|e| e.to_string())?)
    };

    let dir = Path::new(&screenshot_path).join(&target_game_id);
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    let now = Local::now();
    let filename = format!("{}_{}.png", target_game_id, now.format("%Y%m%d_%H%M%S%.3f"));
    let dest = dir.join(filename);
    image.save(&dest).map_err(|e| e.to_string())?;
    
    let _ = app.emit("screenshot-taken", &target_game_id);
    
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
pub fn update_screenshot_config(app: AppHandle, state: tauri::State<AppState>, path: String, hotkey: String) -> Result<(), String> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
    use std::str::FromStr;

    {
        let mut p = state.screenshot_path.lock().unwrap();
        *p = path;
    }
    {
        let mut h = state.screenshot_hotkey.lock().unwrap();
        *h = hotkey.clone();
    }

    start_screenshot_watcher(app.clone(), &state);

    let _ = app.global_shortcut().unregister_all();
    if !hotkey.is_empty() {
        if let Ok(shortcut) = Shortcut::from_str(&hotkey) {
            app.global_shortcut().register(shortcut).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn open_game_launcher(game_path: String) -> Result<(), String> {
    let p = Path::new(&game_path);
    if !p.exists() { return Err("找不到遊戲路徑".to_string()); }

    let mut launcher_path = p.parent().unwrap().join("launcher.exe");
    
    if !launcher_path.exists() {
        if let Some(parent) = p.parent().and_then(|p| p.parent()) {
            let alt_path = parent.join("launcher.exe");
            if alt_path.exists() {
                launcher_path = alt_path;
            }
        }
    }

    if launcher_path.exists() {
        let _ = std::process::Command::new(launcher_path).spawn().map_err(|e| e.to_string())?;
        Ok(())
    } else {
        let _ = std::process::Command::new(game_path).spawn().map_err(|e| e.to_string())?;
        Ok(())
    }
}

pub fn start_screenshot_watcher(app: AppHandle, state: &AppState) {
    let screenshot_path = {
        let p = state.screenshot_path.lock().unwrap();
        if p.is_empty() {
            let exe_dir = match std::env::current_exe() {
                Ok(pb) => pb.parent().unwrap().to_path_buf(),
                Err(_) => return,
            };
            exe_dir.join("screenshots").to_string_lossy().to_string()
        } else {
            p.clone()
        }
    };

    let path_to_watch = Path::new(&screenshot_path).to_path_buf();
    let _ = fs::create_dir_all(&path_to_watch);

    let app_clone = app.clone();
    let root_path_clone = path_to_watch.clone();

    let mut watcher = notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
        if let Ok(event) = res {
            if event.kind.is_create() || event.kind.is_modify() || event.kind.is_remove() {
                for path in event.paths {
                    let root = &root_path_clone;
                    if let Some(parent) = path.parent() {
                        if parent.parent() == Some(root) {
                            if let Some(game_id_os) = parent.file_name() {
                                let game_id = game_id_os.to_string_lossy().to_string();
                                let _ = app_clone.emit("screenshot-taken", game_id);
                            }
                        }
                    }
                }
            }
        }
    });

    if let Ok(ref mut w) = watcher {
        let _ = w.watch(&path_to_watch, RecursiveMode::Recursive);
    }

    let mut lock = state.screenshot_watcher.lock().unwrap();
    *lock = watcher.ok();
}

#[tauri::command]
pub async fn open_folder(app: AppHandle, path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err("資料夾不存在".to_string());
    }
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_path(path, None::<String>).map_err(|e| e.to_string())?;
    Ok(())
}
