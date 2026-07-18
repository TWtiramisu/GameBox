use std::path::Path;
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use tauri::{Emitter, Manager};
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};
use rusqlite::{params, Connection};
use chrono::{DateTime, Local, Duration};
use crate::AppState;

#[tauri::command]
pub async fn get_game_stats(state: tauri::State<'_, AppState>, game_id: String) -> Result<crate::GameStats, String> {
    let conn = state.db.lock().unwrap();
    let mut stmt = conn.prepare("SELECT launch_count, total_play_time, last_played, last_closed FROM game_stats WHERE game_id = ?").unwrap();
    let stats = stmt.query_row(params![game_id], |row| {
        Ok(crate::GameStats {
            launch_count: row.get(0)?,
            total_play_time: row.get(1)?,
            last_played: row.get(2)?,
            last_closed: row.get(3)?,
        })
    }).unwrap_or(crate::GameStats {
        launch_count: 0,
        total_play_time: 0,
        last_played: None,
        last_closed: None,
    });
    Ok(stats)
}

#[tauri::command]
pub async fn is_game_running(app_handle: tauri::AppHandle, state: tauri::State<'_, AppState>, game_id: String, exe_path: String) -> Result<bool, String> {
    // 1. 先檢查現有的追蹤快取
    {
        let running = state.running_processes.lock().unwrap();
        if *running.get(&game_id).unwrap_or(&false) {
            return Ok(true);
        }
    }

    // 2. 快取沒有，則主動掃描系統進程
    let p = Path::new(&exe_path);
    let exe_name = match p.file_name().and_then(|n| n.to_str()) {
        Some(name) => name,
        None => return Ok(false),
    };

    let mut sys = System::new_all();
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::everything());
    
    let is_running = sys.processes().values().any(|p| {
        let p_name = p.name().to_string_lossy().to_lowercase();
        let target = exe_name.to_lowercase();
        p_name.contains(&target) || target.contains(&p_name)
    });

    if is_running {
        // [自動接管] 如果發現遊戲正在執行但沒被追蹤，啟動一個監測任務 (不計入啟動次數)
        let running_processes = state.running_processes.clone();
        let game_id_clone = game_id.clone();
        let exe_name_clone = exe_name.to_string();
        let app_handle_clone = app_handle.clone();
        
        // 立即標記為執行中，防止重複觸發
        {
            let mut running = running_processes.lock().unwrap();
            running.insert(game_id.clone(), true);
        }
        let _ = app_handle.emit("game-status-changed", (game_id.clone(), true));

        tokio::spawn(async move {
            let start_time = Local::now();
            let start_time_iso = start_time.to_rfc3339();
            monitor_process(app_handle_clone, running_processes, game_id_clone, exe_name_clone, start_time, start_time_iso, false).await;
        });
        return Ok(true);
    }

    Ok(false)
}

#[tauri::command]
pub async fn run_game(app_handle: tauri::AppHandle, state: tauri::State<'_, AppState>, game_id: String, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
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
        // Use OpenerExt for reliable opening
        let _ = app_handle_clone.opener().open_path(&path_clone, None::<String>);
        
        monitor_process(app_handle_clone, running_processes, game_id_clone, exe_name, start_time, start_time_iso, true).await;
    });

    Ok(())
}

pub async fn monitor_process(
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
                
                // Mark as running UI only when process is actually detected
                {
                    let mut running = running_processes.lock().unwrap();
                    running.insert(game_id.clone(), true);
                }
                let _ = app_handle.emit("game-status-changed", (game_id.clone(), true));

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
            // Give it a small grace period (2s) as requested
            if (Local::now() - last_seen).num_seconds() > 2 {
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
pub async fn recover_running_games(app_handle: tauri::AppHandle, state: tauri::State<'_, AppState>, games_list: Vec<(String, String)>) -> Result<(), String> {
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
