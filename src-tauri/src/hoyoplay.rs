use reqwest::Client;
use serde::Serialize;

#[derive(Serialize)]
pub struct HoYoGame {
    pub id: String,
    pub name: String,
}

#[derive(Serialize)]
pub struct HoYoGameAssets {
    pub logo: Option<String>,
    pub background: Option<String>,
    pub background_is_video: bool,
    pub top_left_logo: Option<String>,
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
            if let (Some(id), Some(name)) = (g["id"].as_str(), g["display"]["name"].as_str()) {
                games.push(HoYoGame {
                    id: id.to_string(),
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
            if g["id"].as_str() == Some(&game_id) {
                if let Some(url) = g["display"]["icon"]["url"].as_str() {
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
    let url_bg = format!("https://sg-hyp-api.hoyoverse.com/hyp/hyp-connect/api/getAllGameBasicInfo?launcher_id={}&language=zh-tw&game_id={}", launcher_id, game_id);
    let res_bg: serde_json::Value = client.get(&url_bg).send().await.map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())?;
    
    let mut background = None;
    let mut background_is_video = false;
    
    if let Some(list_arr) = res_bg["data"]["game_info_list"].as_array() {
        if let Some(game_info) = list_arr.first() {
            if let Some(bgs_arr) = game_info["backgrounds"].as_array() {
                if let Some(bg) = bgs_arr.first() {
                    let bg_type = bg["type"].as_str().unwrap_or("");
                    if bg_type == "BACKGROUND_TYPE_VIDEO" {
                        if let Some(url) = bg["video"]["url"].as_str() {
                            if !url.is_empty() {
                                background = Some(url.to_string());
                                background_is_video = true;
                            }
                        }
                    } else {
                        if let Some(url) = bg["background"]["url"].as_str() {
                            if !url.is_empty() {
                                background = Some(url.to_string());
                                background_is_video = false;
                            }
                        }
                    }
                }
            }
        }
    }
    
    Ok(HoYoGameAssets {
        logo,
        background,
        background_is_video,
        top_left_logo,
    })
}
