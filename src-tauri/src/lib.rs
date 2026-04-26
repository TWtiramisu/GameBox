use std::path::Path;
use std::process::Command;
use tauri_plugin_opener::OpenerExt;
use serde::Serialize;
use std::fs;

#[derive(Serialize)]
struct FontInfo {
    name: String,
    size_mb: f64,
}

#[derive(Serialize)]
struct GameAssets {
    logo: Option<String>,
    background: Option<String>,
    is_video: bool,
}

#[tauri::command]
fn list_fonts() -> Vec<FontInfo> {
    let font_dir = Path::new("fonts");
    if !font_dir.exists() {
        let _ = fs::create_dir_all(font_dir);
        return vec![];
    }

    if let Ok(entries) = fs::read_dir(font_dir) {
        entries.flatten()
            .filter(|e| {
                let s = e.file_name().to_string_lossy().to_lowercase();
                s.ends_with(".ttf") || s.ends_with(".woff") || s.ends_with(".woff2") || s.ends_with(".otf")
            })
            .map(|e| {
                let metadata = e.metadata().ok();
                FontInfo {
                    name: e.file_name().to_string_lossy().to_string(),
                    size_mb: metadata.map(|m| m.len() as f64 / 1_048_576.0).unwrap_or(0.0),
                }
            })
            .collect()
    } else {
        vec![]
    }
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

#[tauri::command]
fn extract_icon(_path: String) -> Result<String, String> {
    // 雖然保留函數以供編譯，但不再執行任何自動操作
    Err("自動提取已停用".to_string())
}

#[tauri::command]
fn get_game_assets(_path: String) -> GameAssets {
    GameAssets { logo: None, background: None, is_video: false }
}

#[tauri::command]
fn run_game(app_handle: tauri::AppHandle, path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() { return Err("檔案路徑不存在".to_string()); }
    app_handle.opener().open_path(&path, None::<String>).map_err(|e| format!("啟動失敗: {}", e))?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = fs::create_dir_all("fonts");
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![run_game, get_game_assets, extract_icon, list_fonts, import_font])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
