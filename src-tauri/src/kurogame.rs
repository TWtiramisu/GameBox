use serde::Serialize;
use reqwest::Client;
use serde_json::Value;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KuroGame {
    pub id: String,
    pub name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KuroGameAssets {
    pub logo: Option<String>,
    pub background: Option<String>,
    pub background_is_video: bool,
    pub title_logo: Option<String>,
    pub theme: Option<String>,
}

// 使用用戶提供的穩定 Tracker 連結
const KURO_TRACKER_URL: &str = "https://autopatch.hk4e.com/api_tracker/archive/ww_index_os_new/20260430041155.json";

#[tauri::command]
pub async fn fetch_kurogame_games() -> Result<Vec<KuroGame>, String> {
    // 目前 Tracker 主要對應鳴潮國際服
    Ok(vec![
        KuroGame {
            id: "50004".to_string(),
            name: "鳴潮".to_string(),
        }
    ])
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KuroUpdateResponse {
    pub is_update_available: bool,
    pub latest_version: String,
    pub local_version: String,
    pub background_url: Option<String>,
    pub background_is_video: bool,
    pub logo_url: Option<String>,
    pub title_logo_url: Option<String>,
    pub theme_url: Option<String>,
}

#[tauri::command]
pub async fn check_kurogame_update(app_id: String, local_path: String) -> Result<KuroUpdateResponse, String> {
    let mut local_version = String::new();
    let path = std::path::Path::new(&local_path);
    if let Some(parent) = path.parent() {
        let config_path = parent.join("launcherDownload").join("launcherDownloadConfig.json");
        if let Ok(content) = std::fs::read_to_string(&config_path) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(v) = json["version"].as_str() {
                    local_version = v.to_string();
                }
            }
        }
    }

    let client = Client::new();
    let mut latest_version = "3.3.0".to_string();
    
    // 從 Tracker 獲取最新版本 (遠端暫設 Placeholder 邏輯)
    if let Ok(response) = client.get(KURO_TRACKER_URL).header("User-Agent", "Mozilla/5.0").send().await {
        if let Ok(json) = response.json::<Value>().await {
            if let Some(v) = json["default"]["config"]["version"].as_str() {
                latest_version = v.to_string();
            } else if let Some(v) = json["default"]["version"].as_str() {
                latest_version = v.to_string();
            }
        }
    }

    let is_update_available = !local_version.is_empty() && !latest_version.is_empty() && local_version != latest_version;
    
    let mut background_url = None;
    let mut background_is_video = false;
    let mut logo_url = None;
    let mut title_logo_url = None;
    let mut theme_url = None;

    if let Ok(assets) = fetch_kurogame_game_info(app_id).await {
        background_url = assets.background;
        background_is_video = assets.background_is_video;
        logo_url = assets.logo;
        title_logo_url = assets.title_logo;
        theme_url = assets.theme;
    }

    Ok(KuroUpdateResponse {
        is_update_available,
        latest_version,
        local_version,
        background_url,
        background_is_video,
        logo_url,
        title_logo_url,
        theme_url,
    })
}

#[tauri::command]
pub async fn fetch_kurogame_game_info(app_id: String) -> Result<KuroGameAssets, String> {
    let client = Client::new();

    if app_id == "50004" {
        let url = "https://prod-alicdn-gamestarter.kurogame.com/launcher/50004_obOHXFrFanqsaIEOmuKroCcbZkQRBC7c/G153/background/MUHwpKkfomYJYbZD9JhMl1uUUKpgOX0M/zh-Hant.json";
        if let Ok(response) = client.get(url).header("User-Agent", "Mozilla/5.0").send().await {
            if let Ok(json) = response.json::<Value>().await {
                let background = json["backgroundFile"].as_str().map(|s| s.to_string());
                let background_is_video = if let Some(bg_type) = json["backgroundFileType"].as_i64() {
                    bg_type == 2
                } else if let Some(bg_file) = &background {
                    bg_file.ends_with(".mp4") || bg_file.ends_with(".webm")
                } else {
                    false
                };
                let theme = json["slogan"].as_str().map(|s| s.to_string());
                
                // 預設 Logo & Title Logo (可根據需要設定或從 slogan 中取出)
                let logo = Some("https://prod-aki-static-os.aki-game.net/pcdownload/launcher/images/icon.png".to_string());
                let title_logo = Some("https://prod-aki-static-os.aki-game.net/pcdownload/launcher/images/icon.png".to_string());

                return Ok(KuroGameAssets {
                    logo,
                    background,
                    background_is_video,
                    title_logo,
                    theme,
                });
            }
        }
        
        // 發生網路請求或解析錯誤時的 Fallback 預設資源
        Ok(KuroGameAssets {
            logo: Some("https://prod-aki-static-os.aki-game.net/pcdownload/launcher/images/icon.png".to_string()),
            background: Some("https://prod-aki-static-os.aki-game.net/pcdownload/launcher/images/bg.jpg".to_string()),
            background_is_video: false,
            title_logo: Some("https://prod-aki-static-os.aki-game.net/pcdownload/launcher/images/icon.png".to_string()),
            theme: None,
        })
    } else {
        Ok(KuroGameAssets {
            logo: None,
            background: None,
            background_is_video: false,
            title_logo: None,
            theme: None,
        })
    }
}
