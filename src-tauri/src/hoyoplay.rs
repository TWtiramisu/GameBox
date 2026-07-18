use reqwest::Client;
use serde::Serialize;
use std::path::Path;
use std::fs;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HoYoGame {
    pub id: String,
    pub name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HoYoGameAssets {
    pub logo: Option<String>,
    pub background: Option<String>,
    pub background_is_video: bool,
    pub top_left_logo: Option<String>,
    pub theme: Option<String>,
}

#[tauri::command]
pub async fn fetch_hoyoplay_games() -> Result<Vec<HoYoGame>, String> {
    let client = Client::new();
    let url = "https://sg-hyp-api.hoyoverse.com/hyp/hyp-connect/api/getGames?launcher_id=VYTpXlbWo8&language=zh-tw";
    
    let res = client.get(url).send().await.map_err(|e| e.to_string())?;
    let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    
    let mut games = Vec::new();
    if let Some(games_arr) = json["data"]["games"].as_array() {
        for g in games_arr {
            let id = if g["id"].is_string() {
                g["id"].as_str().unwrap().to_string()
            } else if g["id"].is_number() {
                g["id"].as_i64().unwrap().to_string()
            } else {
                continue;
            };

            if let Some(name) = g["display"]["name"].as_str() {
                games.push(HoYoGame {
                    id,
                    name: name.to_string(),
                });
            }
        }
    }
    
    Ok(games)
}

#[tauri::command]
pub async fn fetch_hoyoplay_game_info(game_id: String) -> Result<HoYoGameAssets, String> {
    let client = Client::new();
    let launcher_id = "VYTpXlbWo8";
    
    // Fetch Logo & Top Left Logo
    let url_games = format!("https://sg-hyp-api.hoyoverse.com/hyp/hyp-connect/api/getGames?launcher_id={}&language=zh-tw", launcher_id);
    let res_games: serde_json::Value = client.get(&url_games).send().await.map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())?;
    
    let mut logo = None;
    let mut top_left_logo = None;
    if let Some(games_arr) = res_games["data"]["games"].as_array() {
        for g in games_arr {
            let id = if g["id"].is_string() {
                g["id"].as_str().unwrap().to_string()
            } else if g["id"].is_number() {
                g["id"].as_i64().unwrap().to_string()
            } else {
                continue;
            };

            if id == game_id {
                if let Some(url) = g["display"]["shortcut"]["url"].as_str() {
                    if !url.is_empty() {
                        logo = Some(url.to_string());
                    }
                }
                if let Some(url) = g["display"]["logo"]["url"].as_str() {
                    if !url.is_empty() {
                        top_left_logo = Some(url.to_string());
                    }
                }
                break;
            }
        }
    }
    
    // Fetch Background
    let url_bg = format!("https://sg-hyp-api.hoyoverse.com/hyp/hyp-connect/api/getAllGameBasicInfo?launcher_id={}&language=zh-tw", launcher_id);
    let res_bg: serde_json::Value = client.get(&url_bg).send().await.map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())?;
    
    let mut background = None;
    let mut background_is_video = false;
    let mut theme = None;
    
    if let Some(list_arr) = res_bg["data"]["game_info_list"].as_array() {
        for game_info in list_arr {
            let id = if game_info["game"]["id"].is_string() {
                game_info["game"]["id"].as_str().unwrap().to_string()
            } else if game_info["game"]["id"].is_number() {
                game_info["game"]["id"].as_i64().unwrap().to_string()
            } else {
                continue;
            };

            if id == game_id {
                if let Some(bgs_arr) = game_info["backgrounds"].as_array() {
                    if let Some(bg) = bgs_arr.first() {
                        if let Some(url) = bg["video"]["url"].as_str() {
                            if !url.is_empty() {
                                background = Some(url.to_string());
                                background_is_video = true;
                            }
                        }
                        if background.is_none() {
                            if let Some(url) = bg["background"]["url"].as_str() {
                                if !url.is_empty() {
                                    background = Some(url.to_string());
                                    background_is_video = false;
                                }
                            }
                        }
                        if let Some(url) = bg["theme"]["url"].as_str() {
                            if !url.is_empty() {
                                theme = Some(url.to_string());
                            }
                        }
                    }
                }
                break;
            }
        }
    }
    
    Ok(HoYoGameAssets {
        logo,
        background,
        background_is_video,
        top_left_logo,
        theme,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub is_update_available: bool,
    pub latest_version: String,
    pub local_version: String,
    pub background_url: Option<String>,
    pub background_is_video: bool,
    pub logo_url: Option<String>,
    pub top_left_logo_url: Option<String>,
    pub theme_url: Option<String>,
}

#[tauri::command]
pub async fn check_hoyoplay_update(game_id: String, local_path: String) -> Result<UpdateInfo, String> {
    let mut local_version = String::new();
    let path = Path::new(&local_path);
    if let Some(parent) = path.parent() {
        let config_path = parent.join("config.ini");
        if let Ok(content) = fs::read_to_string(&config_path) {
            for line in content.lines() {
                if line.starts_with("game_version=") {
                    local_version = line.trim_start_matches("game_version=").trim().to_string();
                    break;
                }
            }
        }
    }

    let client = Client::new();
    let url = "https://sg-hyp-api.hoyoverse.com/hyp/hyp-connect/api/getGamePackages?launcher_id=VYTpXlbWo8&language=zh-tw";
    let res: serde_json::Value = client.get(url).send().await.map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())?;

    let mut latest_version = local_version.clone();
    
    if let Some(packages) = res["data"]["game_branches"].as_array() {
        for pkg in packages {
            let id = if pkg["game"]["id"].is_string() {
                pkg["game"]["id"].as_str().unwrap().to_string()
            } else if pkg["game"]["id"].is_number() {
                pkg["game"]["id"].as_i64().unwrap().to_string()
            } else {
                continue;
            };

            if id == game_id {
                if let Some(ver) = pkg["main"]["tag"].as_str() {
                    latest_version = ver.to_string();
                }
                break;
            }
        }
    }

    let is_update_available = !local_version.is_empty() && !latest_version.is_empty() && local_version != latest_version;
    
    let mut background_url = None;
    let mut background_is_video = false;
    let mut logo_url = None;
    let mut top_left_logo_url = None;
    let mut theme_url = None;

    // 不論是否需要更新，都獲取最新的資產資訊供前端判斷是否需要下載入庫
    if let Ok(assets) = fetch_hoyoplay_game_info(game_id).await {
        background_url = assets.background;
        background_is_video = assets.background_is_video;
        logo_url = assets.logo;
        top_left_logo_url = assets.top_left_logo;
        theme_url = assets.theme;
    }

    Ok(UpdateInfo {
        is_update_available,
        latest_version,
        local_version,
        background_url,
        background_is_video,
        logo_url,
        top_left_logo_url,
        theme_url,
    })
}

#[tauri::command]
pub async fn open_hoyoplay_launcher(local_path: String) -> Result<(), String> {
    let path = Path::new(&local_path);
    let mut current_dir = path.parent();
    
    // 往上找最多 3 層，尋找 launcher.exe
    let mut launcher_path = None;
    for _ in 0..3 {
        if let Some(dir) = current_dir {
            let possible_launcher = dir.join("launcher.exe");
            if possible_launcher.exists() {
                launcher_path = Some(possible_launcher);
                break;
            }
            current_dir = dir.parent();
        }
    }
    
    if let Some(l_path) = launcher_path {
        std::process::Command::new(l_path)
            .spawn()
            .map_err(|e| format!("無法啟動 HoYoPlay: {}", e))?;
    } else {
        // 如果找不到 launcher.exe，就開啟遊戲資料夾
        if let Some(parent) = path.parent() {
            #[cfg(target_os = "windows")]
            {
                std::process::Command::new("explorer")
                    .arg(parent)
                    .spawn()
                    .map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}
