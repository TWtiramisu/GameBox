use std::path::Path;
use tauri_plugin_opener::OpenerExt;
use serde::Serialize;
use std::fs;
use rusqlite::{params, Connection};
use chrono::{DateTime, Local, Duration};
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use tauri::Emitter;
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};

mod hoyoplay;

#[derive(Serialize)]
struct FontInfo {
    name: String,
    size_mb: f64,
}

#[derive(Serialize, Clone)]
pub struct GameAssets {
    pub logo: Option<String>,
    pub background: Option<String>,
    pub is_video: bool,
    pub title_logo: Option<String>,
    pub top_left_logo: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct GameStats {
    pub launch_count: i32,
    pub total_play_time: i64, // Minutes
    pub last_played: Option<String>,
    pub last_closed: Option<String>,
}

struct AppState {
    db: Mutex<Connection>,
    running_processes: Arc<Mutex<HashMap<String, bool>>>,
}

fn init_db() -> Connection {
    let conn = Connection::open("gamebox.db").expect("Failed to open database");
    
    // Create table with start_time column
    let _ = conn.execute(
        "CREATE TABLE IF NOT EXISTS game_stats (
            game_id TEXT PRIMARY KEY,
            launch_count INTEGER DEFAULT 0,
            total_play_time INTEGER DEFAULT 0,
            last_played TEXT,
            last_closed TEXT,
            start_time TEXT
        )",
        [],
    );

    // Ensure start_time column exists for migrations
    let _ = conn.execute("ALTER TABLE game_stats ADD COLUMN start_time TEXT", []);
    
    conn
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
fn get_game_stats(state: tauri::State<AppState>, game_id: String) -> GameStats {
    let conn = state.db.lock().unwrap();
    let mut stmt = conn.prepare("SELECT launch_count, total_play_time, last_played, last_closed FROM game_stats WHERE game_id = ?").unwrap();
    let stats = stmt.query_row(params![game_id], |row| {
        Ok(GameStats {
            launch_count: row.get(0)?,
            total_play_time: row.get(1)?,
            last_played: row.get(2)?,
            last_closed: row.get(3)?,
        })
    }).unwrap_or(GameStats {
        launch_count: 0,
        total_play_time: 0,
        last_played: None,
        last_closed: None,
    });
    stats
}

#[tauri::command]
fn is_game_running(state: tauri::State<AppState>, game_id: String) -> bool {
    let running = state.running_processes.lock().unwrap();
    *running.get(&game_id).unwrap_or(&false)
}

#[tauri::command]
async fn run_game(app_handle: tauri::AppHandle, state: tauri::State<'_, AppState>, game_id: String, path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() { return Err("檔案路徑不存在".to_string()); }

    let start_time: DateTime<Local> = Local::now();
    let start_time_iso = start_time.to_rfc3339();

    let running_processes = state.running_processes.clone();
    let game_id_clone = game_id.clone();
    let path_clone = path.clone();
    let app_handle_clone = app_handle.clone();
    
    // Extract EXE name for monitoring
    let exe_name = p.file_name()
        .and_then(|n| n.to_str())
        .ok_or("無效的檔案名稱")?
        .to_string();

    tokio::spawn(async move {
        // Mark as running UI immediately
        {
            let mut running = running_processes.lock().unwrap();
            running.insert(game_id_clone.clone(), true);
        }
        let _ = app_handle_clone.emit("game-status-changed", (game_id_clone.clone(), true));

        // Use OpenerExt for reliable opening
        let _ = app_handle_clone.opener().open_path(&path_clone, None::<String>);
        
        monitor_process(app_handle_clone, running_processes, game_id_clone, exe_name, start_time, start_time_iso, true).await;
    });

    Ok(())
}

async fn monitor_process(
    app_handle: tauri::AppHandle, 
    running_processes: Arc<Mutex<HashMap<String, bool>>>, 
    game_id: String, 
    exe_name: String,
    start_time: DateTime<Local>,
    start_time_iso: String,
    is_new_launch: bool
) {
    let mut sys = System::new_all();
    let mut last_seen = Local::now();
    let mut has_detected = false;
    
    // Initial wait for process to appear
    tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
    
    loop {
        sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::everything());
        
        let is_running = sys.processes().values().any(|p| {
            p.name().to_string_lossy().to_lowercase().contains(&exe_name.to_lowercase())
        });

        if is_running {
            if !has_detected {
                has_detected = true;
                // [NEW] ONLY increase launch count and set last_played after actual detection
                if is_new_launch {
                    let start_time_str = start_time.format("%Y/%m/%d %H:%M").to_string();
                    if let Ok(conn) = Connection::open("gamebox.db") {
                        let _ = conn.execute(
                            "INSERT INTO game_stats (game_id, launch_count, last_played, start_time) VALUES (?1, 1, ?2, ?3)
                             ON CONFLICT(game_id) DO UPDATE SET launch_count = launch_count + 1, last_played = ?2, start_time = ?3",
                            params![game_id, start_time_str, start_time_iso],
                        );
                    }
                    // Inform frontend to refresh stats
                    let _ = app_handle.emit("game-stats-updated", game_id.clone());
                }
            }
            last_seen = Local::now();
        } else {
            // Give it a small grace period (5s) as requested
            if (Local::now() - last_seen).num_seconds() > 5 {
                break;
            }
        }
        tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
    }

    // Mark as closed
    {
        let mut running = running_processes.lock().unwrap();
        running.insert(game_id.clone(), false);
    }
    
    let end_time: DateTime<Local> = Local::now();
    let end_time_str = end_time.format("%Y/%m/%d %H:%M").to_string();
    let duration: Duration = end_time.signed_duration_since(start_time);
    let minutes = duration.num_minutes();

    // Update total time and CLEAR start_time
    if let Ok(conn) = Connection::open("gamebox.db") {
        let _ = conn.execute(
            "UPDATE game_stats SET total_play_time = total_play_time + ?1, last_closed = ?2, start_time = NULL WHERE game_id = ?3",
            params![minutes, end_time_str, game_id],
        );
    }
    
    let _ = app_handle.emit("game-status-changed", (game_id, false));
}

#[tauri::command]
async fn recover_running_games(app_handle: tauri::AppHandle, state: tauri::State<'_, AppState>, games_list: Vec<(String, String)>) -> Result<(), String> {
    for (game_id, path) in games_list {
        let p = Path::new(&path);
        let exe_name = p.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
        if exe_name.is_empty() { continue; }

        let mut sys = System::new_all();
        sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::everything());
        
        let is_actually_running = sys.processes().values().any(|p| {
            p.name().to_string_lossy().to_lowercase().contains(&exe_name.to_lowercase())
        });

        if is_actually_running {
            let (start_time_iso, already_tracked) = {
                let conn = state.db.lock().unwrap();
                conn.query_row(
                    "SELECT start_time FROM game_stats WHERE game_id = ?",
                    params![game_id],
                    |row| {
                        let iso: Option<String> = row.get(0)?;
                        Ok((iso, true))
                    }
                ).unwrap_or((None, false))
            };

            if already_tracked {
                let running_processes = state.running_processes.clone();
                let game_id_clone = game_id.clone();
                let app_handle_clone = app_handle.clone();
                
                let iso_val = start_time_iso.clone().unwrap_or_else(|| Local::now().to_rfc3339());
                let start_time = DateTime::parse_from_rfc3339(&iso_val).map(|dt| dt.with_timezone(&Local)).unwrap_or(Local::now());

                tokio::spawn(async move {
                    {
                        let mut running = running_processes.lock().unwrap();
                        running.insert(game_id_clone.clone(), true);
                    }
                    let _ = app_handle_clone.emit("game-status-changed", (game_id_clone.clone(), true));
                    monitor_process(app_handle_clone, running_processes, game_id_clone, exe_name, start_time, iso_val, false).await;
                });
            }
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = fs::create_dir_all("fonts");
    let state = AppState {
        db: Mutex::new(init_db()),
        running_processes: Arc::new(Mutex::new(HashMap::new())),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            run_game, 
            get_game_stats,
            is_game_running,
            recover_running_games,
            list_fonts, 
            import_font, 
            hoyoplay::fetch_hoyoplay_games, 
            hoyoplay::fetch_hoyoplay_game_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
