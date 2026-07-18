import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { Plus, Play, Gamepad2, X, FolderOpen, Trash2, Image as ImageIcon, ChevronLeft, ChevronRight, Type, Edit3, Clock, Activity, Calendar, Settings, Info, Monitor, ArrowLeft, Upload, Sliders, RefreshCw, UploadCloud, Lock, Zap, ExternalLink } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface FontInfo {
  name: string;
  size_mb: number;
  is_default: boolean;
}

interface GameAssets {
  logo?: string;
  background?: string;
  is_video?: boolean;
  titleLogo?: string;
  topLeftLogo?: string;
  theme?: string;
}

const GAME_ID_MAP: Record<string, string> = {
  // HoYoPlay String IDs
  "gopR6Cufr3": "GenshinImpact",
  "4ziysqXOQ8": "StarRail",
  "U5hbdsT9W7": "ZenlessZoneZero",
  "5TIVvvcwtM": "Honkai3rd",

  // HoYoPlay Legacy/Numeric IDs (Fallbacks)
  "g_overseas": "Genshin",
  "ps_overseas": "Genshin",
  "hkrpg_global": "StarRail",
  "nap_global": "Zenless",
  "bh3_global": "Honkai3rd",
  "bh3_overseas": "Honkai3rd",
  "50004": "WutheringWave",
  "18": "Genshin", // HoYoPlay Internal ID for Genshin
  "11": "StarRail", // HoYoPlay Internal ID for StarRail
  "13": "Zenless"   // HoYoPlay Internal ID for Zenless
};

// 輔助函式：確保取得穩定 ID
const getStableId = (channelId: string | undefined): string | null => {
  if (!channelId) return null;
  // 嘗試匹配映射表 (不分大小寫)
  const entry = Object.entries(GAME_ID_MAP).find(
    ([key]) => key.toLowerCase() === channelId.toLowerCase()
  );
  return entry ? entry[1] : channelId;
};

export interface Game {
  id: string;
  name: string;
  path: string;
  assets?: GameAssets;
  launchCount?: number;
  lastPlayed?: string;
  totalPlayTime?: number;
  autoUpdate?: boolean;
  hoyoChannel?: string;
  version?: string;
  useOfficialAssets?: boolean;
}

interface HoYoGame {
  id: string;
  name: string;
}

interface ContextMenuState {
  mouseX: number;
  mouseY: number;
  gameId: string;
}

function App() {
  const [games, setGames] = useState<Game[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"about" | "general">("about");
  const [paramAutoUpdate, setParamAutoUpdate] = useState(false);
  const [paramPlatform, setParamPlatform] = useState<string | null>(null);
  const [paramHoyoChannel, setParamHoyoChannel] = useState<string>("");
  const [useOfficialAssets, setUseOfficialAssets] = useState(true);
  const [hoyoGames, setHoyoGames] = useState<HoYoGame[]>([]);
  const [hoyoLoading, setHoyoLoading] = useState(false);
  const [hoyoFetching, setHoyoFetching] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [newPath, setNewPath] = useState("");
  const [newLogo, setNewLogo] = useState<string | undefined>(undefined);
  const [newBackground, setNewBackground] = useState<string | undefined>(undefined);
  const [newIsVideo, setNewIsVideo] = useState(false);
  const [newTitleLogo, setNewTitleLogo] = useState<string | undefined>(undefined);
  const [titleMode, setTitleMode] = useState<"text" | "logo">("text");

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);
  const [fonts, setFonts] = useState<FontInfo[]>([]);
  const [currentFont, setCurrentFont] = useState<string>("system-ui");
  const [isFontMenuOpen, setIsFontMenuOpen] = useState(false);
  const [runningGames, setRunningGames] = useState<Record<string, boolean>>({});
  const [updateStatus, setUpdateStatus] = useState<Record<string, { needsUpdate: boolean; latestVersion?: string }>>({});

  const [hasCheckedUpdates, setHasCheckedUpdates] = useState(false);
  const [fontContextMenu, setFontContextMenu] = useState<{ mouseX: number, mouseY: number, fontName: string, isDefault: boolean } | null>(null);
  const [screenshotContextMenu, setScreenshotContextMenu] = useState<{ mouseX: number, mouseY: number, gameId: string, filename: string } | null>(null);
  const [gameVersions, setGameVersions] = useState<Record<string, string>>({});

  const [screenshotPath, setScreenshotPath] = useState<string>(localStorage.getItem("screenshotPath") || "");
  const [screenshotHotkey, setScreenshotHotkey] = useState<string>(localStorage.getItem("screenshotHotkey") || "Alt+D");
  const [isRecordingHotkey, setIsRecordingHotkey] = useState(false);

  const [isScreenshotViewerOpen, setIsScreenshotViewerOpen] = useState(false);
  const [viewingScreenshots, setViewingScreenshots] = useState<any[]>([]);
  const [viewingGameId, setViewingGameId] = useState<string | null>(null);

  const syncGameStats = useCallback(async (gameId: string) => {
    try {
      // Backend uses #[serde(rename_all = "camelCase")], so fields come back as camelCase
      const stats = await invoke<{ launchCount: number; totalPlayTime: number; lastPlayed: string | null; lastClosed: string | null }>("get_game_stats", { gameId });
      setGames(prev => prev.map(g => g.id === gameId ? {
        ...g,
        launchCount: stats.launchCount ?? g.launchCount ?? 0,
        totalPlayTime: stats.totalPlayTime ?? g.totalPlayTime ?? 0,
        lastPlayed: stats.lastPlayed || g.lastPlayed
      } : g));
    } catch (e) {
      console.error("syncGameStats failed:", e);
    }
  }, []);

  const loadFonts = async () => {
    try {
      const fontList = await invoke<FontInfo[]>("list_fonts");
      setFonts(fontList);
    } catch (e) {
      console.error("無法載入字體列表", e);
    }
  };

  const handleDeleteFont = async (name: string) => {
    try {
      await invoke("delete_font", { name });
      loadFonts();
    } catch (e) {
      alert(`刪除失敗: ${e}`);
    }
  };

  useEffect(() => {
    const saved = localStorage.getItem("games");
    if (saved) {
      const parsed = JSON.parse(saved);
      setGames(parsed);
      if (parsed.length > 0) setSelectedId(parsed[0].id);

      const gamePaths = parsed.map((g: any) => [g.id, g.path]);
      invoke("recover_running_games", { gamesList: gamePaths }).catch(console.error);
    }

    const savedFont = localStorage.getItem("app-font");
    if (savedFont) setCurrentFont(savedFont);

    invoke<Record<string, string>>("get_versions").then(setGameVersions);
    loadFonts();
  }, []);

  useEffect(() => {
    localStorage.setItem("games", JSON.stringify(games));
  }, [games]);

  useEffect(() => {
    localStorage.setItem("app-font", currentFont);
  }, [currentFont]);

  // 一次性啟動檢查
  useEffect(() => {
    if (hasCheckedUpdates || games.length === 0) return;

    const checkAllUpdates = async () => {
      let currentGames = [...games];
      let hasAnyChange = false;

      for (const game of games) {
        if (game.hoyoChannel) {
          const isKuro = game.hoyoChannel.startsWith("5");
          const command = isKuro ? "check_kurogame_update" : "check_hoyoplay_update";

          try {
            const res = await invoke<{
              isUpdateAvailable: boolean;
              latestVersion: string;
              localVersion: string;
              backgroundUrl?: string;
              backgroundIsVideo: boolean;
              logoUrl?: string;
              titleLogoUrl?: string;
              topLeftLogoUrl?: string;
              themeUrl?: string;
            }>(command, {
              gameId: game.hoyoChannel,
              localPath: game.path,
              appId: game.hoyoChannel
            });

            let savedVersion = gameVersions[game.hoyoChannel];
            if (!savedVersion && res.localVersion) {
              await invoke("save_version", { channelId: game.hoyoChannel, version: res.localVersion });
              savedVersion = res.localVersion;
            }
            const currentSaved = gameVersions[game.hoyoChannel] || savedVersion;

            if (game.useOfficialAssets) {
              let assetsChanged = false;
              const newAssets = { ...game.assets };

              if (res.backgroundUrl) {
                const currentBg = game.assets?.background;
                const isMissingFromCache = !currentBg || !currentBg.includes("assets_cache");
                if (currentSaved !== res.latestVersion || isMissingFromCache) {
                  const ext = res.backgroundIsVideo ? "mp4" : "jpg";
                  const filename = `${game.id}_${res.latestVersion.replace(/\./g, '_')}_bg.${ext}`;
                  newAssets.background = await invoke<string>("download_asset", { url: res.backgroundUrl, filename });
                  newAssets.is_video = res.backgroundIsVideo;
                  assetsChanged = true;
                }
              }

              if (res.logoUrl) {
                const currentLogo = game.assets?.logo;
                const isMissingLogo = !currentLogo || !currentLogo.includes("assets_cache");
                if (currentSaved !== res.latestVersion || isMissingLogo) {
                  const filename = `${game.id}_${res.latestVersion.replace(/\./g, '_')}_logo.png`;
                  newAssets.logo = await invoke<string>("download_asset", { url: res.logoUrl, filename });
                  assetsChanged = true;
                }
              }

              if (res.themeUrl) {
                const currentTheme = game.assets?.theme;
                const isMissingTheme = !currentTheme || !currentTheme.includes("assets_cache");
                if (currentSaved !== res.latestVersion || isMissingTheme) {
                  const ext = res.themeUrl.split('.').pop()?.split('?')[0] || "png";
                  const filename = `${game.id}_${res.latestVersion.replace(/\./g, '_')}_theme.${ext}`;
                  newAssets.theme = await invoke<string>("download_asset", { url: res.themeUrl, filename });
                  assetsChanged = true;
                }
              }

              if (assetsChanged) {
                currentGames = currentGames.map(g => g.id === game.id ? { ...g, assets: newAssets } : g);
                hasAnyChange = true;
              }
            }

            if (res.isUpdateAvailable) {
              setUpdateStatus(prev => ({ ...prev, [game.id]: { needsUpdate: true, latestVersion: res.latestVersion } }));
            } else {
              setUpdateStatus(prev => ({ ...prev, [game.id]: { needsUpdate: false, latestVersion: res.latestVersion } }));

              if (currentSaved !== res.latestVersion && game.autoUpdate) {
                currentGames = currentGames.map(g => g.id === game.id ? { ...g, version: res.latestVersion } : g);
                hasAnyChange = true;
                await invoke("save_version", { channelId: game.hoyoChannel, version: res.latestVersion });
              }
            }
          } catch (e) {
            console.error(`Startup check failed for ${game.name}`, e);
          }
        }
      }

      if (hasAnyChange) {
        setGames(currentGames);
        localStorage.setItem('games', JSON.stringify(currentGames));
      }
      setHasCheckedUpdates(true);
    };

    if (Object.keys(gameVersions).length >= 0) {
      checkAllUpdates();
    }
  }, [games, hasCheckedUpdates, gameVersions]);

  const selectedGame = games.find((g) => g.id === selectedId);

  const getAssetUrl = (url?: string) => {
    if (!url) return "";
    if (url.startsWith("data:image")) return url;
    if (url.startsWith("http://") || url.startsWith("https://")) return url;
    return convertFileSrc(url);
  };

  const handleImportFont = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "字體檔案", extensions: ["ttf", "woff", "woff2", "otf"] }],
    });
    if (selected && typeof selected === "string") {
      try {
        await invoke("import_font", { path: selected });
        await loadFonts();
      } catch (e) {
        alert(`匯入失敗: ${e}`);
      }
    }
  };

  const handleContextMenu = (e: React.MouseEvent, gameId: string) => {
    e.preventDefault();
    setContextMenu({ mouseX: e.clientX, mouseY: e.clientY, gameId });
  };

  const handleScreenshotContextMenu = (e: React.MouseEvent, gameId: string, filename: string) => {
    e.preventDefault();
    e.stopPropagation();
    setScreenshotContextMenu({ mouseX: e.clientX, mouseY: e.clientY, gameId, filename });
  };

  const closeMenus = useCallback(() => {
    setContextMenu(null);
    setFontContextMenu(null);
    setScreenshotContextMenu(null);
    setIsFontMenuOpen(false);
  }, []);

  useEffect(() => {
    window.addEventListener("click", closeMenus);
    return () => window.removeEventListener("click", closeMenus);
  }, [closeMenus]);

  useEffect(() => {
    if (isRecordingHotkey) {
      const handleKeyDown = (e: KeyboardEvent) => {
        e.preventDefault();
        e.stopPropagation();

        const modifiers: string[] = [];
        if (e.ctrlKey) modifiers.push("Ctrl");
        if (e.altKey) modifiers.push("Alt");
        if (e.shiftKey) modifiers.push("Shift");
        if (e.metaKey) modifiers.push("Command");

        let key = e.key.toUpperCase();
        if (key === "CONTROL") key = "";
        if (key === "ALT") key = "";
        if (key === "SHIFT") key = "";
        if (key === "META") key = "";
        if (key === "ESCAPE") {
          setIsRecordingHotkey(false);
          return;
        }

        if (key) {
          const combo = [...modifiers, key].join("+");
          setScreenshotHotkey(combo);
          localStorage.setItem("screenshotHotkey", combo);
          setIsRecordingHotkey(false);
        }
      };

      window.addEventListener("keydown", handleKeyDown, true);
      return () => window.removeEventListener("keydown", handleKeyDown, true);
    }
  }, [isRecordingHotkey]);

  useEffect(() => {
    invoke("update_screenshot_config", { path: screenshotPath, hotkey: screenshotHotkey });
  }, [screenshotPath, screenshotHotkey]);

  useEffect(() => {
    const unlistenStatus = listen<[string, boolean]>("game-status-changed", (event) => {
      const [gameId, isRunning] = event.payload;
      setRunningGames(prev => ({ ...prev, [gameId]: isRunning }));
      if (!isRunning) {
        syncGameStats(gameId);
      }
    });

    const unlistenStats = listen<string>("game-stats-updated", (event) => {
      syncGameStats(event.payload);
    });

    return () => {
      unlistenStatus.then(f => f());
      unlistenStats.then(f => f());
    };
  }, [syncGameStats]);

  // 定期輪詢所有遊戲狀態
  useEffect(() => {
    const interval = setInterval(async () => {
      if (games.length === 0) return;

      const statusUpdates: Record<string, boolean> = {};
      for (const game of games) {
        try {
          const isRunning = await invoke<boolean>("is_game_running", {
            gameId: game.id,
            exePath: game.path
          });
          statusUpdates[game.id] = isRunning;
        } catch (e) {
          console.error(`Check running status failed for ${game.name}`, e);
        }
      }
      setRunningGames(statusUpdates);
    }, 2000);

    return () => clearInterval(interval);
  }, [games]);

  useEffect(() => {
    if (selectedId) {
      syncGameStats(selectedId);
    }
  }, [selectedId, syncGameStats]);

  useEffect(() => {
    if (paramHoyoChannel && paramPlatform && paramAutoUpdate && newPath) {
      const infoCommand = paramPlatform === "kuro" ? "fetch_kurogame_game_info" : "fetch_hoyoplay_game_info";
      const checkCommand = paramPlatform === "kuro" ? "check_kurogame_update" : "check_hoyoplay_update";

      setHoyoFetching(true);

      Promise.all([
        invoke<{ logo?: string; background?: string; backgroundIsVideo: boolean; topLeftLogo?: string; theme?: string }>(infoCommand, {
          gameId: paramHoyoChannel,
          appId: paramHoyoChannel
        }),
        invoke<{ isUpdateAvailable: boolean; latestVersion: string; localVersion: string }>(checkCommand, {
          gameId: paramHoyoChannel,
          localPath: newPath,
          appId: paramHoyoChannel
        })
      ]).then(([infoRes, checkRes]) => {
        if (infoRes.logo) setNewLogo(infoRes.logo);
        if (infoRes.background) {
          setNewBackground(infoRes.background);
          setNewIsVideo(infoRes.backgroundIsVideo);
        }
        const savedVersion = gameVersions[paramHoyoChannel] || checkRes.localVersion;
        const needsUpdate = checkRes.isUpdateAvailable || (savedVersion !== checkRes.latestVersion);
        setUpdateStatus(prev => ({ ...prev, [editingId || 'new-game']: { needsUpdate, latestVersion: checkRes.latestVersion } }));
      }).catch(e => console.error(e)).finally(() => setHoyoFetching(false));
    }
  }, [paramHoyoChannel, paramPlatform, paramAutoUpdate, newPath, gameVersions, editingId]);

  const handleSaveGame = async () => {
    if (!newName || !newPath) return;

    let finalAssets: GameAssets = {
      logo: newLogo,
      background: newBackground,
      is_video: newIsVideo,
      titleLogo: titleMode === "logo" ? newTitleLogo : undefined,
      topLeftLogo: undefined
    };

    if (paramAutoUpdate && paramHoyoChannel && useOfficialAssets) {
      setHoyoFetching(true);
      try {
        if (paramPlatform === "hoyoverse") {
          const assets = await invoke<{ logo: string | null; background: string | null; backgroundIsVideo: boolean; topLeftLogo: string | null; theme: string | null }>("fetch_hoyoplay_game_info", { gameId: paramHoyoChannel });
          finalAssets = {
            logo: assets.logo || newLogo,
            background: assets.background || newBackground,
            is_video: assets.backgroundIsVideo,
            titleLogo: titleMode === "logo" ? newTitleLogo : undefined,
            topLeftLogo: undefined,
            theme: assets.theme || undefined
          };
        } else if (paramPlatform === "kuro") {
          const assets = await invoke<{ logo: string | null; background: string | null; backgroundIsVideo: boolean; titleLogo: string | null; theme: string | null }>("fetch_kurogame_game_info", { appId: paramHoyoChannel });
          finalAssets = {
            logo: assets.logo || newLogo,
            background: assets.background || newBackground,
            is_video: assets.backgroundIsVideo,
            titleLogo: titleMode === "logo" ? newTitleLogo : undefined,
            topLeftLogo: undefined,
            theme: assets.theme || undefined
          };
        }
      } catch (e) {
        console.error("抓取資產失敗", e);
      } finally {
        setHoyoFetching(false);
      }
    }

    const gameData = {
      name: newName,
      path: newPath,
      assets: finalAssets,
      autoUpdate: paramAutoUpdate,
      hoyoChannel: paramHoyoChannel,
      useOfficialAssets: useOfficialAssets
    };

    const stableId = getStableId(paramHoyoChannel);
    const exeBasedId = !stableId && newPath
      ? newPath.split(/[/\\]/).pop()?.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, "_") || null
      : null;

    if (editingId) {
      const newId = stableId || exeBasedId || editingId;
      setGames(prev => prev.map(g => g.id === editingId ? { ...g, id: newId, ...gameData } : g));
      if (editingId !== newId) {
        setSelectedId(newId);
      }
    } else {
      const gameId = stableId || exeBasedId || crypto.randomUUID();

      const newGame: Game = {
        id: gameId,
        ...gameData,
        launchCount: 0,
        totalPlayTime: 0
      };
      setGames(prev => [...prev, newGame]);
      setSelectedId(gameId);

      if (screenshotPath) {
        invoke("ensure_screenshot_dir", { gameId, basePath: screenshotPath }).catch(console.error);
      }

      if (updateStatus['new-game']) {
        setUpdateStatus(prev => {
          const newState = { ...prev, [gameId]: prev['new-game'] };
          const { 'new-game': _, ...rest } = newState;
          return rest;
        });
      }
    }
    resetModal();
  };

  const resetModal = () => {
    setNewName("");
    setNewPath("");
    setNewLogo(undefined);
    setNewBackground(undefined);
    setNewIsVideo(false);
    setNewTitleLogo(undefined);
    setParamAutoUpdate(false);
    setParamPlatform(null);
    setParamHoyoChannel("");
    setIsModalOpen(false);
    setEditingId(null);
  };

  const handleEditClick = (gameId: string) => {
    const game = games.find(g => g.id === gameId);
    if (game) {
      setEditingId(gameId);
      setNewName(game.name);
      setNewPath(game.path);
      setNewLogo(game.assets?.logo);
      setNewBackground(game.assets?.background);
      setNewIsVideo(game.assets?.is_video || false);
      setNewTitleLogo(game.assets?.titleLogo);
      setTitleMode(game.assets?.titleLogo ? "logo" : "text");

      setParamAutoUpdate(game.autoUpdate || false);
      setParamHoyoChannel(game.hoyoChannel || "");
      setUseOfficialAssets(game.useOfficialAssets ?? true);
      const platform = game.hoyoChannel?.startsWith("5") ? "kuro" : (game.hoyoChannel ? "hoyoverse" : null);
      setParamPlatform(platform);

      if (game.hoyoChannel) {
        setHoyoGames([]); setHoyoLoading(true);
        const command = platform === "kuro" ? "fetch_kurogame_games" : "fetch_hoyoplay_games";
        invoke<HoYoGame[]>(command).then(l => setHoyoGames(l)).catch(e => console.error(e)).finally(() => setHoyoLoading(false));
      }

      setIsModalOpen(true);
    }
  };

  const handleDeleteGame = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const updated = games.filter((g) => g.id !== id);
    setGames(updated);
    if (selectedId === id) setSelectedId(updated.length > 0 ? updated[0].id : null);
  };

  const handlePickFile = async (type: 'exe' | 'logo' | 'bg' | 'titleLogo') => {
    const filters = {
      exe: [{ name: "執行檔", extensions: ["exe", "lnk", "bat"] }],
      logo: [{ name: "圖片", extensions: ["png", "jpg", "jpeg", "webp", "ico"] }],
      bg: [{ name: "素材", extensions: ["png", "jpg", "jpeg", "webp", "gif", "mp4", "webm"] }],
      titleLogo: [{ name: "圖片", extensions: ["png", "jpg", "jpeg", "webp"] }]
    }[type];

    const selected = await open({ multiple: false, filters });
    if (selected && typeof selected === "string") {
      if (type === 'exe') {
        setNewPath(selected);
        if (!newName) setNewName(selected.split(/[\\/]/).pop()?.replace(/\.[^/.]+$/, "") || "");
      } else if (type === 'logo') {
        setNewLogo(selected);
      } else if (type === 'bg') {
        setNewBackground(selected);
        setNewIsVideo(selected.toLowerCase().endsWith(".mp4") || selected.toLowerCase().endsWith(".webm"));
      } else if (type === 'titleLogo') {
        setNewTitleLogo(selected);
      }
    }
  };

  const handleSelectScreenshotPath = async () => {
    try {
      const selected = await open({
        multiple: false,
        directory: true,
      });
      if (selected && typeof selected === "string") {
        setScreenshotPath(selected);
        localStorage.setItem("screenshotPath", selected);
        invoke("update_screenshot_config", { path: selected, hotkey: screenshotHotkey }).catch(console.error);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleOpenFolder = async (path?: string) => {
    try {
      const target = path || screenshotPath;
      await invoke("open_folder", { path: target });
    } catch (e) {
      console.error(e);
    }
  };

  const handleViewScreenshots = async (gameId: string) => {
    try {
      const res = await invoke<any[]>("get_game_screenshots", { gameId });
      setViewingScreenshots(res);
      setViewingGameId(gameId);
      setIsScreenshotViewerOpen(true);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    listen<string>("screenshot-taken", (event) => {
      const takenGameId = event.payload;
      if (isScreenshotViewerOpen && viewingGameId === takenGameId) {
        handleViewScreenshots(takenGameId);
      }
    }).then(f => unlisten = f);

    return () => {
      if (unlisten) unlisten();
    };
  }, [isScreenshotViewerOpen, viewingGameId]);

  const groupedScreenshots = viewingScreenshots.reduce((acc: Record<string, any[]>, ss) => {
    if (!acc[ss.date]) acc[ss.date] = [];
    acc[ss.date].push(ss);
    return acc;
  }, {});

  const getCleanPath = (assetUrl: string) => {
    return assetUrl.replace("asset://localhost/", "").replace(/\\/g, "/");
  };

  const handleLaunch = async () => {
    if (!selectedGame || runningGames[selectedGame.id]) return;

    if (updateStatus[selectedGame.id]?.needsUpdate) {
      try {
        await invoke("open_game_launcher", { gamePath: selectedGame.path });
      } catch (err) { alert(`無法啟動更新器: ${err}`); }
      return;
    }

    try {
      await invoke("run_game", { gameId: selectedGame.id, path: selectedGame.path });
    }
    catch (err) { alert(`啟動失敗: ${err}`); }
  };

  return (
    <div
      className="flex flex-col h-screen w-full bg-[#030305] text-gray-100 selection:bg-accent/30 overflow-hidden relative transition-all duration-300"
      style={{ fontFamily: currentFont !== "system-ui" ? `'${currentFont}'` : "inherit" }}
    >
      <style>{`
        ${fonts.map(f => `
          @font-face {
            font-family: '${f.name}';
            src: url('${convertFileSrc((f.is_default ? "fonts/default/" : "fonts/") + f.name)}');
          }
        `).join('\n')}
        @keyframes shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
        @keyframes bg-fade { from { opacity: 0; transform: scale(1.05); } to { opacity: 0.8; transform: scale(1); } }
        @keyframes content-slide { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        .animate-bg-fade { animation: bg-fade 1s ease-out forwards; }
        .animate-content-slide { animation: content-slide 0.5s ease-out forwards; }
        .glass-premium { background: rgba(255, 255, 255, 0.03); backdrop-filter: blur(40px); border: 1px solid rgba(255, 255, 255, 0.05); }
        .sidebar-item.active { 
          background: rgba(124, 58, 237, 0.2); 
          border: 1px solid rgba(139, 92, 246, 0.5); 
          box-shadow: 0 0 15px rgba(139, 92, 246, 0.4), inset 0 0 8px rgba(139, 92, 246, 0.2);
          color: #fff; 
        }
        .font-menu-bg { background: rgba(10, 10, 12, 0.95); border: 1px solid rgba(255, 255, 255, 0.1); }
        .no-drag { -webkit-app-region: no-drag; }
      `}</style>

      <div className="flex flex-1 overflow-hidden relative">
        {/* 背景層 */}
        <div className="absolute inset-0 z-0 overflow-hidden">
          {selectedGame?.assets?.background ? (
            selectedGame.assets.is_video ? (
              <video
                key={selectedGame.id + "_vid"}
                src={getAssetUrl(selectedGame.assets.background)}
                autoPlay loop muted playsInline
                className="w-full h-full object-cover animate-bg-fade"
              />
            ) : (
              <img
                key={selectedGame.id + "_img"}
                src={getAssetUrl(selectedGame.assets.background)}
                alt=""
                className="w-full h-full object-cover animate-bg-fade"
              />
            )
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-accent/20 via-transparent to-transparent opacity-40" />
          )}

          {selectedGame?.assets?.theme && (
            <img
              key={selectedGame.id + "_theme"}
              src={getAssetUrl(selectedGame.assets.theme)}
              alt=""
              className="absolute inset-0 w-full h-full object-cover pointer-events-none z-10 animate-bg-fade"
            />
          )}

          <div className="absolute inset-0 bg-gradient-to-t from-[#030305] via-[#030305]/10 to-transparent" />
        </div>

        <div
          className={cn(
            "h-screen bg-[#0a0a0c]/40 backdrop-blur-[20px] border-r border-white/5 flex flex-col transition-[width,transform,opacity,background-color] duration-500 relative shadow-2xl",
            isSidebarCollapsed ? "w-20" : "w-72",
            isScreenshotViewerOpen ? "z-[1500]" : "z-20"
          )}
        >
          {!isScreenshotViewerOpen && (
            <button
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              className="absolute -right-3 top-20 w-6 h-6 rounded-full bg-accent flex items-center justify-center border border-white/20 shadow-xl z-30 hover:scale-110 transition-transform"
            >
              {isSidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
            </button>
          )}

          <div className={cn("p-5 flex items-center gap-4 border-b border-white/5", isSidebarCollapsed && "justify-center px-0")}>
            <div className="w-[52px] h-[52px] rounded-xl bg-accent/20 flex items-center justify-center border border-accent/30 shadow-lg shadow-accent/10 flex-shrink-0">
              <Gamepad2 className="text-accent w-7 h-7" />
            </div>
            {!isSidebarCollapsed && <h1 className="text-xl font-black tracking-tighter uppercase">我的遊戲</h1>}
          </div>

          <div className="flex-1 overflow-y-auto py-4 px-3 space-y-2 overflow-x-hidden">
            {games.map((game) => (
              <div
                key={game.id}
                onClick={() => {
                  setSelectedId(game.id);
                  if (isScreenshotViewerOpen) handleViewScreenshots(game.id);
                }}
                onContextMenu={(e) => handleContextMenu(e, game.id)}
                className={cn(
                  "sidebar-item group rounded-xl p-2 flex items-center gap-3 cursor-pointer transition-all border border-transparent hover:border-white/5",
                  selectedId === game.id && "active",
                  isSidebarCollapsed ? "justify-center w-[52px] h-[52px] mx-auto" : "w-full p-2.5"
                )}
              >
                <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center overflow-hidden flex-shrink-0 border border-white/10 group-hover:border-accent/30 transition-all pointer-events-none">
                  {game.assets?.logo ? (
                    <img src={getAssetUrl(game.assets.logo)} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="opacity-40 font-black">{game.name.substring(0, 1)}</span>
                  )}
                </div>
                {!isSidebarCollapsed && (
                  <div className="flex-1 min-w-0 pointer-events-none">
                    <p className="truncate font-bold text-sm tracking-tight">{game.name.split('\n')[0]}</p>
                  </div>
                )}
              </div>
            ))}

            <div
              onClick={() => { resetModal(); setIsModalOpen(true); }}
              className={cn(
                "rounded-xl flex items-center justify-center cursor-pointer transition-all border border-dashed border-white/10 hover:border-accent/50 hover:bg-accent/5 group",
                isSidebarCollapsed ? "w-[52px] h-[52px] mx-auto" : "p-3"
              )}
            >
              <Plus className="text-white/20 group-hover:text-accent w-6 h-6" />
            </div>
          </div>

          <div className="p-4 border-t border-white/5 space-y-2 relative">
            {isFontMenuOpen && (
              <div
                className="absolute bottom-full left-4 right-4 mb-2 font-menu-bg rounded-[32px] overflow-hidden shadow-2xl py-3 animate-in slide-in-from-bottom-2 duration-300 w-80 z-[100]"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-4 pb-2 mb-2 border-b border-white/10">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleImportFont(); }}
                    className="w-full flex items-center justify-center gap-2 py-2 bg-accent/10 hover:bg-accent text-accent hover:text-white rounded-xl transition-all border border-accent/20 font-black text-xs"
                  >
                    <Upload size={14} className="lucide-upload" />
                    <span>匯入字體檔案</span>
                  </button>
                </div>
                <div className="max-h-[300px] overflow-y-auto px-2 space-y-1 custom-scrollbar">
                  <button
                    onClick={() => { setCurrentFont("system-ui"); setIsFontMenuOpen(false); }}
                    className={cn(
                      "w-full rounded-2xl px-4 py-3 flex flex-col items-start hover:bg-white/5 transition-all text-left",
                      currentFont === "system-ui" && "bg-accent/10 border border-accent/20"
                    )}
                    style={{ fontFamily: "system-ui" }}
                  >
                    <div className="flex items-center justify-between w-full mb-1">
                      <div className="flex items-center gap-2">
                        <Lock size={14} className="text-accent" />
                        <span className="text-xs font-black opacity-40 uppercase tracking-widest">Default</span>
                      </div>
                      <span className="px-1.5 py-0.5 bg-accent/20 text-accent text-[8px] font-black rounded uppercase">支援中/英</span>
                    </div>
                    <span className="text-lg font-bold">系統預設字體</span>
                  </button>

                  {fonts.map(f => (
                    <button
                      key={f.name}
                      onClick={() => { setCurrentFont(f.name); setIsFontMenuOpen(false); }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setFontContextMenu({ mouseX: e.clientX, mouseY: e.clientY, fontName: f.name, isDefault: f.is_default });
                      }}
                      className={cn(
                        "w-full rounded-2xl px-4 py-3 flex flex-col items-start hover:bg-white/5 transition-all text-left",
                        currentFont === f.name && "bg-accent/10 border border-accent/20"
                      )}
                      style={{ fontFamily: `'${f.name}'` }}
                    >
                      <div className="flex items-center justify-between w-full mb-1">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          {f.is_default && <Lock size={14} className="text-accent" />}
                          <span className="text-[10px] opacity-40 truncate">{f.name.replace(/\.[^/.]+$/, "")}</span>
                        </div>
                        <span className={cn(
                          "px-1.5 py-0.5 text-[8px] font-black rounded uppercase",
                          f.size_mb > 1 ? "bg-accent/20 text-accent" : "bg-orange-500/20 text-orange-400"
                        )}>
                          {f.size_mb > 1 ? "支援中/英" : "僅限英文"}
                        </span>
                      </div>
                      <span className="text-xl">Abcd 測試文字</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={(e) => { e.stopPropagation(); setIsFontMenuOpen(!isFontMenuOpen); }}
              className={cn(
                "flex items-center justify-center gap-2 py-2.5 bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl transition-all border border-white/5 font-bold text-xs w-full",
                isSidebarCollapsed && "px-0"
              )}
            >
              <Type size={16} />
              {!isSidebarCollapsed && <span className="truncate">{currentFont === "system-ui" ? "字體管理" : currentFont.replace(/\.[^/.]+$/, "")}</span>}
            </button>

            <button
              onClick={() => { setIsSettingsOpen(true); setSettingsTab("about"); }}
              className={cn(
                "flex items-center justify-center gap-2 py-3 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white rounded-xl transition-all border border-white/5 font-black text-sm w-full",
                isSidebarCollapsed && "px-0"
              )}
            >
              <Settings size={18} />
              {!isSidebarCollapsed && <span>GAMEBOX 設定</span>}
            </button>
          </div>
        </div>

        {/* 主畫面 */}
        <div className="flex-1 flex flex-col relative z-10 overflow-hidden">
          {selectedGame ? (
            <div key={selectedGame.id} className="flex-1 flex flex-col p-12 lg:p-16 relative animate-content-slide">
              <div className="mb-auto">
                {selectedGame.assets?.titleLogo ? (
                  <img src={getAssetUrl(selectedGame.assets.titleLogo)} alt={selectedGame.name} className="h-24 lg:h-32 object-contain mb-6 drop-shadow-2xl" />
                ) : (
                  <h2 className="text-5xl lg:text-6xl font-black tracking-tight text-white leading-tight whitespace-pre-wrap mb-4" style={{ textShadow: "0 2px 20px rgba(0,0,0,0.8)" }}>
                    {selectedGame.name}
                  </h2>
                )}
              </div>

              <div className="mt-auto flex items-end justify-between">
                <div className="flex gap-10 text-white/80 font-bold text-[13px] tracking-tight pb-2">
                  <span className="flex flex-col gap-1"><span className="text-[10px] text-accent uppercase tracking-widest opacity-50">啟動次數</span><span className="flex items-center gap-2"><Activity size={14} className="text-accent" /> {selectedGame.launchCount || 0} 次</span></span>
                  <span className="flex flex-col gap-1"><span className="text-[10px] text-accent uppercase tracking-widest opacity-50">累積時間</span><span className="flex items-center gap-2"><Clock size={14} className="text-accent" /> {selectedGame.totalPlayTime ? (selectedGame.totalPlayTime >= 60 ? `${Math.floor(selectedGame.totalPlayTime / 60)} 小時 ${selectedGame.totalPlayTime % 60} 分` : `${selectedGame.totalPlayTime} 分鐘`) : "0 分鐘"}</span></span>
                  <span className="flex flex-col gap-1"><span className="text-[10px] text-accent uppercase tracking-widest opacity-50">最後執行</span><span className="flex items-center gap-2"><Calendar size={14} className="text-accent" /> {selectedGame.lastPlayed || "尚未開始"}</span></span>
                </div>

                <div className="flex flex-col items-center gap-5">
                  {runningGames[selectedGame.id] ? (
                    <div className="flex items-center gap-2 px-4 py-1.5 bg-blue-500/10 text-blue-400 text-[11px] font-black rounded-full border border-blue-500/20 backdrop-blur-md">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.6)]" />
                      正在遊玩
                    </div>
                  ) : updateStatus[selectedGame.id]?.needsUpdate ? (
                    <div className="flex items-center gap-2 px-4 py-1.5 bg-amber-900/30 text-amber-400 text-[11px] font-black rounded-full border border-amber-500/20 backdrop-blur-md">
                      <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse shadow-[0_0_8px_rgba(180,130,20,0.5)]" />
                      需要更新
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 px-4 py-1.5 bg-green-500/10 text-green-400 text-[11px] font-black rounded-full border border-green-500/20 backdrop-blur-md">
                      <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
                      準備就緒
                    </div>
                  )}
                  <button
                    onClick={handleLaunch}
                    disabled={runningGames[selectedGame.id]}
                    className={cn(
                      "px-8 h-[72px] rounded-2xl shadow-2xl flex items-center gap-4 relative group overflow-hidden no-drag transition-all duration-500 w-[320px] justify-center",
                      runningGames[selectedGame.id]
                        ? "bg-white/5 border border-white/10 text-gray-500 cursor-not-allowed scale-[0.98] shadow-none"
                        : updateStatus[selectedGame.id]?.needsUpdate
                          ? "btn-update"
                          : "btn-primary"
                    )}
                  >
                    {!runningGames[selectedGame.id] && <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:animate-[shimmer_2s_infinite]" />}
                    {runningGames[selectedGame.id] ? (
                      <div className="flex items-center gap-4 animate-pulse">
                        <Activity size={24} className="text-accent" />
                        <span className="text-xl font-black tracking-wide">遊戲正在執行中</span>
                      </div>
                    ) : (
                      <>
                        {updateStatus[selectedGame.id]?.needsUpdate ? <UploadCloud size={22} /> : <Play size={24} fill="currentColor" />}
                        {updateStatus[selectedGame.id]?.needsUpdate ? (
                          <div className="flex flex-col items-start text-left">
                            <span className="text-lg font-black leading-tight">更新遊戲</span>
                            <span className="text-[10px] font-bold leading-tight opacity-70">需開啟官方啟動器進行</span>
                          </div>
                        ) : (
                          <span className="text-xl font-black tracking-wide">開始遊戲</span>
                        )}
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-500/10 flex-col gap-6">
              <Gamepad2 size={120} className="animate-pulse" />
              <p className="text-2xl font-black tracking-[0.5em] opacity-10 uppercase">Select a game</p>
            </div>
          )}
        </div>

        {/* 遊戲截圖檢視器 (全螢幕毛玻璃) */}
        {isScreenshotViewerOpen && (
          <div
            className={cn(
              "fixed inset-0 z-[1000] flex flex-col bg-[#0a0a0c]/60 backdrop-blur-[60px] animate-in fade-in duration-500 overflow-hidden",
              isSidebarCollapsed ? "pl-20" : "pl-72"
            )}
          >
            {/* Header */}
            <div className="px-10 h-[93px] border-b border-white/5 flex items-center justify-between bg-white/[0.02] shrink-0">
              <div className="flex items-center gap-6">
                <button
                  onClick={() => setIsScreenshotViewerOpen(false)}
                  className="p-2.5 bg-white/5 hover:bg-white/10 rounded-2xl transition-all group border border-white/5"
                >
                  <ArrowLeft size={22} className="group-active:-translate-x-1 transition-transform" />
                </button>
                <div>
                  <h3 className="text-2xl font-black italic tracking-tighter flex items-center gap-3">
                    {games.find(g => g.id === viewingGameId)?.name} <span className="text-accent text-lg">遊戲截圖</span>
                  </h3>
                </div>
              </div>

              <button
                onClick={() => {
                  const target = screenshotPath ? `${screenshotPath}/${viewingGameId}` : undefined;
                  handleOpenFolder(target);
                }}
                className="flex items-center gap-3 px-6 py-2.5 bg-white/5 hover:bg-white/10 rounded-xl transition-all border border-white/10 group"
              >
                <FolderOpen size={18} className="text-accent group-hover:scale-110 transition-transform" />
                <span className="font-black text-sm">開啟資料夾</span>
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
              {Object.keys(groupedScreenshots).length > 0 ? (
                Object.entries(groupedScreenshots).sort((a, b) => b[0].localeCompare(a[0])).map(([date, items]) => (
                  <div key={date} className="space-y-2">
                    <div className="flex items-center gap-4">
                      <h4 className="text-sm font-black tracking-[0.2em] text-gray-500 uppercase italic">{date}</h4>
                      <div className="h-px flex-1 bg-gradient-to-r from-white/5 to-transparent" />
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                      {items.map((ss, idx) => (
                        <div
                          key={idx}
                          className="group relative aspect-video bg-white/5 rounded-lg overflow-hidden border border-white/5 hover:border-accent/50 transition-all cursor-pointer shadow-lg hover:shadow-accent/10"
                          onClick={() => handleOpenFolder(getCleanPath(ss.url))}
                          onContextMenu={(e) => handleScreenshotContextMenu(e, viewingGameId!, ss.filename)}
                        >
                          <img
                            src={convertFileSrc(getCleanPath(ss.url))}
                            alt=""
                            className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                            loading="lazy"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <div className="h-full flex flex-col items-center justify-center space-y-6 opacity-20">
                  <ImageIcon size={120} strokeWidth={1} />
                  <p className="text-2xl font-black tracking-[0.5em] uppercase">No Screenshots Found</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 設定介面 */}
        {isSettingsOpen && (
          <div className="fixed inset-0 z-[1800] flex items-center justify-center p-12 bg-black/20 backdrop-blur-md animate-in fade-in duration-500">
            <div className="w-full max-w-4xl h-[600px] bg-[#111114]/60 backdrop-blur-[60px] rounded-[32px] overflow-hidden shadow-2xl flex flex-col relative border border-white/10">
            {/* 內部按鈕點擊微互動 active:scale-95 */}
              <button onClick={() => setIsSettingsOpen(false)} className="absolute top-8 left-8 z-10 p-3 bg-white/5 hover:bg-accent hover:text-white rounded-xl transition-all duration-300 border border-white/10 group active:scale-95">
                <ArrowLeft size={24} className="group-hover:-translate-x-1 transition-transform duration-300" />
              </button>
              <div className="flex h-full">
                    {/* 側邊欄按鈕加入 active:scale-95 的非線性回彈感 */}
                    <div className="w-64 border-r border-white/5 p-8 pt-28 space-y-2 shrink-0">
                      <button onClick={() => setSettingsTab("about")} className={cn("w-full flex items-center gap-4 px-6 py-4 rounded-xl font-black transition-all duration-300 active:scale-95", settingsTab === "about" ? "bg-accent text-white shadow-lg shadow-accent/20" : "hover:bg-white/5 text-gray-500 hover:text-gray-300")}>
                        <Info size={20} /> 關於
                      </button>
                      <button onClick={() => setSettingsTab("general")} className={cn("w-full flex items-center gap-4 px-6 py-4 rounded-xl font-black transition-all duration-300 active:scale-95", settingsTab === "general" ? "bg-accent text-white shadow-lg shadow-accent/20" : "hover:bg-white/5 text-gray-500 hover:text-gray-300")}>
                        <Monitor size={20} /> 一般
                      </button>
                    </div>
                <div className="flex-1 p-10 pt-8 overflow-y-auto custom-scrollbar bg-black/10">
                  {settingsTab === "about" ? (
                    <div className="space-y-12 animate-in slide-in-from-right-4 duration-500">
                      <div className="space-y-4 text-center sm:text-left">
                        <div className="w-20 h-20 rounded-[32px] bg-accent flex items-center justify-center shadow-2xl shadow-accent/30 mb-8 mx-auto sm:mx-0">
                          <Gamepad2 size={40} className="text-white" />
                        </div>
                        <h3 className="text-5xl font-black italic tracking-tighter">遊戲盒子！<br />GameBox</h3>
                        <div className="flex items-center gap-3 justify-center sm:justify-start">
                          <span className="px-3 py-1 bg-accent/20 text-accent rounded-full text-[10px] font-black uppercase tracking-widest border border-accent/20">Version 1.5.0 Stable</span>
                        </div>
                      </div>
                      <div className="space-y-6 max-w-xl text-left">
                        <p className="text-gray-400 font-bold leading-relaxed">
                          GameBox 是一款追求極致速度與視覺美感的次世代遊戲啟動器。
                          我們致力於打破各廠商間的藩籬，提供一個統一且高度自定義的遊戲管理空間。
                        </p>
                        <div className="grid grid-cols-2 gap-4 pt-6">
                          <div className="p-6 bg-white/5 rounded-3xl border border-white/5 text-left">
                            <p className="text-xs text-accent font-black uppercase mb-1">Developer</p>
                            <p className="font-black text-lg">TWtiramisu</p>
                          </div>
                          <div className="p-6 bg-white/5 rounded-3xl border border-white/5 text-left">
                            <p className="text-xs text-accent font-black uppercase mb-1">Framework</p>
                            <p className="font-black text-lg">Tauri + React</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-10 animate-in slide-in-from-right-4 duration-500">
                      <div className="space-y-6">
                        <div className="flex items-center gap-4">
                          <div className="p-3 bg-accent/20 rounded-2xl text-accent">
                            <ImageIcon size={24} />
                          </div>
                          <div>
                            <h4 className="text-xl font-black italic">遊戲截圖設定</h4>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-6">
                          <div className="space-y-3">
                            <label className="text-xs font-black text-gray-500 uppercase tracking-widest pl-1">截圖儲存資料夾</label>
                            <div className="flex gap-2">
                              <div className="flex-1 flex items-center justify-between gap-3 px-5 py-4 bg-white/5 rounded-2xl border border-white/10 overflow-hidden">
                                <span className="text-sm font-bold text-gray-300 truncate">
                                  {screenshotPath || "預設路徑 (啟動器目錄/screenshots)"}
                                </span>
                                <button
                                  onClick={() => handleOpenFolder()}
                                  className="p-2 hover:bg-white/10 rounded-lg text-accent transition-colors shrink-0"
                                  title="開啟資料夾"
                                >
                                  <ExternalLink size={18} />
                                </button>
                              </div>
                              <button onClick={handleSelectScreenshotPath} className="px-6 py-4 bg-accent hover:bg-accent/80 text-white rounded-2xl font-black text-sm transition-all shadow-lg shadow-accent/20 shrink-0">
                                選擇路徑
                              </button>
                            </div>
                          </div>

                          <div className="space-y-3">
                            <label className="text-xs font-black text-gray-500 uppercase tracking-widest pl-1">截圖快捷鍵</label>
                            <div className="flex gap-8 items-center h-14">
                              <div className="flex-1 h-full px-5 bg-white/5 rounded-2xl border border-white/10 text-center relative group overflow-hidden flex items-center justify-center">
                                <input
                                  type="text"
                                  readOnly
                                  value={isRecordingHotkey ? "請按下..." : screenshotHotkey}
                                  className="bg-transparent text-center w-full focus:outline-none font-black text-2xl text-accent tracking-widest cursor-pointer"
                                  onClick={() => setIsRecordingHotkey(true)}
                                />
                                {isRecordingHotkey && (
                                  <div className="absolute inset-0 bg-accent/20 backdrop-blur-sm flex items-center justify-center animate-in fade-in duration-300">
                                    <span className="text-xs font-black text-white animate-pulse uppercase tracking-wider text-center">監聽中</span>
                                  </div>
                                )}
                              </div>
                              <div className="flex-1 flex items-center h-full justify-center">
                                <p className="text-[14px] font-bold text-gray-500 opacity-90 text-center whitespace-nowrap">
                                  {isRecordingHotkey ? (
                                    <>錄製中... 按下新快捷鍵或 <span className="text-accent">ESC</span> 停止錄製</>
                                  ) : (
                                    <>擷取後將自動歸類至上面所選資料夾</>
                                  )}
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 編輯/新增視窗 */}
        {isModalOpen && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-6 bg-black/20 backdrop-blur-md">
            <div className="w-full max-w-5xl h-[85vh] bg-[#111114]/60 backdrop-blur-[60px] rounded-[32px] overflow-hidden flex flex-col relative animate-in zoom-in-95 duration-300 border border-white/10">
              <div className="p-10 pb-6 border-b border-white/5 flex items-center justify-between">
                <h3 className="text-3xl font-black tracking-tighter">{editingId ? "編輯遊戲詳情" : "添加新收藏"}</h3>
                <div className="flex items-center gap-4">
                  <button
                    onClick={handleSaveGame}
                    className="px-6 py-3 bg-accent text-white rounded-xl font-black text-sm shadow-lg flex items-center gap-2 hover:bg-accent/80 transition-all"
                  >
                    {hoyoFetching ? <RefreshCw size={18} className="animate-spin" /> : <Edit3 size={18} />}
                    儲存
                  </button>
                  <button onClick={resetModal} className="p-2 hover:bg-white/5 rounded-full transition-all text-gray-500 hover:text-white"><X size={32} /></button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-12 custom-scrollbar space-y-16">
                <div className="grid grid-cols-2 gap-12">
                  {/* 左側：基本資訊 */}
                  <div className="space-y-10">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between ml-1">
                        <label className="text-[14px] font-black text-accent uppercase tracking-[0.2em]">遊戲標題顯示</label>
                        <div className="flex bg-white/5 rounded-lg p-1">
                          <button onClick={() => setTitleMode("text")} className={cn("px-3 py-1 text-[10px] font-bold rounded-md transition-all", titleMode === "text" ? "bg-accent text-white" : "text-gray-500 hover:text-white")}>文字名稱</button>
                          <button onClick={() => setTitleMode("logo")} className={cn("px-3 py-1 text-[10px] font-bold rounded-md transition-all", titleMode === "logo" ? "bg-accent text-white" : "text-gray-500 hover:text-white")}>圖示 LOGO</button>
                        </div>
                      </div>
                      {titleMode === "text" ? (
                        <textarea value={newName} onChange={e => setNewName(e.target.value)} rows={3} className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 outline-none focus:border-accent font-bold text-lg resize-none" placeholder="請輸入遊戲名稱..." />
                      ) : (
                        <div className="flex items-center gap-6 p-6 bg-white/5 border border-white/10 rounded-3xl group h-[144px]">
                          <div className="w-24 h-24 bg-black/40 rounded-2xl overflow-hidden flex items-center justify-center border border-white/10 shadow-lg relative">
                            {newTitleLogo ? <img src={getAssetUrl(newTitleLogo)} className="w-full h-full object-contain p-2" /> : <ImageIcon size={32} className="opacity-20" />}
                          </div>
                          <div className="flex-1 flex flex-col gap-2">
                            <button onClick={() => handlePickFile('titleLogo')} className="w-full flex items-center justify-center gap-2 py-3 bg-white/5 hover:bg-white/10 rounded-xl text-sm font-bold border border-white/10 transition-all">選擇 LOGO</button>
                            {newTitleLogo && <button onClick={() => setNewTitleLogo(undefined)} className="w-full py-2 hover:bg-red-500/10 text-red-400 rounded-xl text-xs font-bold transition-all">清空 LOGO</button>}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="space-y-4">
                      <label className="text-[14px] font-black text-accent uppercase tracking-[0.2em] ml-1">執行檔案</label>
                      <div className="flex gap-4 items-center">
                        <div className="flex-1 bg-white/5 border border-white/10 rounded-xl px-5 py-4 text-sm text-gray-300 font-mono truncate">{newPath || "未選擇路徑"}</div>
                        <button onClick={() => handlePickFile('exe')} className="p-4 bg-accent/20 text-accent rounded-xl border border-accent/20 transition-all hover:bg-accent hover:text-white"><FolderOpen size={24} /></button>
                      </div>
                    </div>
                  </div>

                  {/* 右側：資產設定 */}
                  <div className="space-y-10">
                    <div className="space-y-4">
                      <label className="text-[14px] font-black text-accent uppercase tracking-[0.2em] ml-1">遊戲圖示</label>
                      <div className="flex items-center gap-6 p-6 bg-white/5 border border-white/10 rounded-3xl group">
                        <div className="w-24 h-24 bg-black/40 rounded-2xl overflow-hidden flex items-center justify-center border border-white/10 shadow-lg">
                          {newLogo ? <img src={getAssetUrl(newLogo)} className="w-full h-full object-contain p-2" /> : <ImageIcon size={32} className="opacity-20" />}
                        </div>
                        <div className="flex-1 flex flex-col gap-2">
                          <button onClick={() => handlePickFile('logo')} className="w-full flex items-center justify-center gap-2 py-3 bg-white/5 hover:bg-white/10 rounded-xl text-sm font-bold border border-white/10 transition-all">選擇圖示</button>
                          {newLogo && <button onClick={() => setNewLogo(undefined)} className="w-full py-2 hover:bg-red-500/10 text-red-400 rounded-xl text-xs font-bold transition-all">清空圖示</button>}
                        </div>
                      </div>
                    </div>
                    <div className="space-y-4">
                      <label className="text-[14px] font-black text-accent uppercase tracking-[0.2em] ml-1">遊戲背景</label>
                      <div className="flex items-center gap-6 p-6 bg-white/5 border border-white/10 rounded-3xl group">
                        <div className="w-24 h-24 bg-black/40 rounded-2xl overflow-hidden flex items-center justify-center border border-white/10 shadow-lg relative">
                          {newBackground ? (newIsVideo ? <video src={getAssetUrl(newBackground)} className="w-full h-full object-cover opacity-50" /> : <img src={getAssetUrl(newBackground)} className="w-full h-full object-cover opacity-50" />) : <ImageIcon size={32} className="opacity-20" />}
                        </div>
                        <div className="flex-1 flex flex-col gap-2">
                          <button onClick={() => handlePickFile('bg')} className="w-full flex items-center justify-center gap-2 py-3 bg-white/5 hover:bg-white/10 rounded-xl text-sm font-bold border border-white/10 transition-all">選擇背景</button>
                          {newBackground && <button onClick={() => { setNewBackground(undefined); setNewIsVideo(false); }} className="w-full py-2 hover:bg-red-500/10 text-red-400 rounded-xl text-xs font-bold transition-all">清空背景</button>}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 分隔線 */}
                <div className="h-px bg-white/5 w-full" />

                {/* 下方：開發者工具 */}
                <div className="space-y-8 pb-8">
                  <div className="flex items-center gap-3">
                    <Sliders size={20} className="text-accent" />
                    <h4 className="text-xl font-black tracking-tight">開發者工具 <span className="text-[10px] bg-accent/20 text-accent px-2 py-0.5 rounded ml-2">BETA</span></h4>
                  </div>

                  <div className="grid grid-cols-1 gap-8">
                    {/* 自動更新開關 */}
                    <div className="flex items-center justify-between p-8 bg-white/5 rounded-3xl border border-white/10 shadow-xl relative overflow-hidden group">
                      <div className="absolute inset-0 bg-gradient-to-r from-accent/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                      <div className="flex items-center gap-6 relative">
                        <div className="w-12 h-12 rounded-2xl bg-accent/20 flex items-center justify-center border border-accent/30 shadow-inner">
                          <Zap size={24} className="text-accent" />
                        </div>
                        <div>
                          <p className="font-black text-lg">更新渠道整合</p>
                          <p className="text-sm text-gray-500 mt-1">選定平台與渠道後，將自動偵測本機版本並提醒更新</p>
                        </div>
                      </div>
                      <button
                        onClick={() => { setParamAutoUpdate(!paramAutoUpdate); if (paramAutoUpdate) { setParamPlatform(null); setParamHoyoChannel(""); } }}
                        className={cn("relative w-16 h-8 rounded-full transition-all duration-300 border", paramAutoUpdate ? 'bg-accent border-accent' : 'bg-white/10 border-white/20')}
                      >
                        <span className={cn("absolute top-[3px] w-6 h-6 bg-white rounded-full shadow-lg transition-all duration-300", paramAutoUpdate ? 'left-[34px]' : 'left-[4px]')} />
                      </button>
                    </div>

                    {paramAutoUpdate && (
                      <div className="flex items-center justify-between p-8 bg-white/5 rounded-3xl border border-white/10 shadow-xl relative overflow-hidden group animate-in slide-in-from-top-2 duration-300">
                        <div className="absolute inset-0 bg-gradient-to-r from-accent/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                        <div className="flex items-center gap-6 relative">
                          <div className="w-12 h-12 rounded-2xl bg-accent/20 flex items-center justify-center border border-accent/30 shadow-inner">
                            <ImageIcon size={24} className="text-accent" />
                          </div>
                          <div>
                            <p className="font-black text-lg">官方資產同步</p>
                            <p className="text-sm text-gray-500 mt-1">開啟後將自動使用官方伺服器的圖示與背景</p>
                          </div>
                        </div>
                        <button
                          onClick={() => setUseOfficialAssets(!useOfficialAssets)}
                          className={cn("relative w-16 h-8 rounded-full transition-all duration-300 border", useOfficialAssets ? 'bg-accent border-accent' : 'bg-white/10 border-white/20')}
                        >
                          <span className={cn("absolute top-[3px] w-6 h-6 bg-white rounded-full shadow-lg transition-all duration-300", useOfficialAssets ? 'left-[34px]' : 'left-[4px]')} />
                        </button>
                      </div>
                    )}

                    {paramAutoUpdate && (
                      <div className="grid grid-cols-2 gap-12 animate-in slide-in-from-top-4 duration-500">
                        {/* Platform Select */}
                        <div className="space-y-4 w-full">
                          <label className="text-[14px] font-black text-accent uppercase tracking-[0.2em] ml-1">選擇平台</label>
                          <div className="space-y-3 h-[260px] overflow-y-auto custom-scrollbar pr-2">
                            {[
                              { id: "hoyoverse", name: "HoYoVerse", status: "supported", label: "已支援" },
                              { id: "kuro", name: "Kuro Games", status: "supported", label: "已支援" },
                              { id: "perfectworld", name: "Perfect World", status: "pending", label: "尚未支援" }
                            ].map(platform => (
                              <button
                                key={platform.id}
                                disabled={platform.status === 'pending'}
                                onClick={() => {
                                  setParamPlatform(platform.id);
                                  setParamHoyoChannel("");
                                  setHoyoGames([]); setHoyoLoading(true);
                                  const command = platform.id === "kuro" ? "fetch_kurogame_games" : "fetch_hoyoplay_games";
                                  invoke<HoYoGame[]>(command).then(l => setHoyoGames(l)).catch(e => console.error(e)).finally(() => setHoyoLoading(false));
                                }}
                                className={cn(
                                  "w-full flex items-center justify-between px-6 py-4 rounded-2xl border transition-all font-bold group/item",
                                  paramPlatform === platform.id
                                    ? "bg-accent/10 border-accent text-white shadow-lg shadow-accent/10"
                                    : platform.status === 'pending'
                                      ? "bg-white/[0.02] border-white/5 text-gray-600 cursor-not-allowed"
                                      : "bg-white/5 border-white/10 text-gray-400 hover:bg-white/10 hover:border-white/20"
                                )}
                              >
                                <div className="flex items-center gap-3">
                                  <div className={cn("w-2 h-2 rounded-full", platform.status === 'supported' ? "bg-accent" : "bg-gray-700")} />
                                  <span>{platform.name}</span>
                                </div>
                                <span className={cn(
                                  "px-3 py-1 text-[10px] rounded-full font-black tracking-tighter border",
                                  platform.status === 'supported'
                                    ? "bg-accent/20 border-accent/30 text-accent"
                                    : "bg-white/5 border-white/10 text-gray-500"
                                )}>
                                  {platform.label}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Game Select */}
                        <div className="space-y-4 w-full">
                          <label className="text-[14px] font-black text-accent uppercase tracking-[0.2em] ml-1">選擇連結遊戲</label>
                          <div className="h-[260px]">
                            {paramPlatform ? (
                              hoyoLoading ? (
                                <div className="flex items-center justify-center h-full gap-3 p-4 bg-white/5 border border-white/10 rounded-2xl text-gray-500"><RefreshCw size={18} className="animate-spin" /> 讀取中...</div>
                              ) : (
                                <div className="space-y-2 h-full overflow-y-auto custom-scrollbar pr-2">
                                  {hoyoGames.map(g => (
                                    <button
                                      key={g.id}
                                      onClick={() => setParamHoyoChannel(g.id)}
                                      className={cn("w-full flex items-center justify-between px-6 py-4 rounded-2xl border transition-all font-bold", paramHoyoChannel === g.id ? "bg-accent/20 border-accent text-white shadow-[0_0_20px_rgba(124,58,237,0.3)]" : "bg-white/5 border-white/10 text-gray-400 hover:bg-white/10")}
                                    >
                                      <span>{g.name}</span>
                                      <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 text-[10px] rounded border border-blue-500/30">
                                        {paramPlatform === "kuro" ? "國際" : "國際服"}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              )
                            ) : (
                              <div className="flex items-center justify-center h-full p-12 bg-white/[0.02] border border-dashed border-white/5 rounded-2xl text-gray-600 text-sm font-bold">
                                請先選擇平台
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 右鍵選單 */}
        {contextMenu && (
          <div className="fixed z-[2000] min-w-[160px] bg-[#111114]/80 backdrop-blur-[40px] rounded-[24px] shadow-2xl border border-white/10 py-2.5 no-drag animate-in fade-in zoom-in-95 duration-200" style={{ top: contextMenu.mouseY, left: contextMenu.mouseX }}>
            <div className="px-1.5 space-y-0.5">
              <button
                onClick={() => { handleEditClick(contextMenu.gameId); closeMenus(); }}
                className="w-full flex items-center gap-3 px-3.5 py-2.5 hover:bg-white/10 text-white rounded-xl transition-all group"
              >
                <Edit3 size={18} className="text-blue-400 transition-colors" />
                <span className="font-bold text-[13px]">編輯遊戲</span>
              </button>
              <button
                onClick={() => { handleViewScreenshots(contextMenu.gameId); closeMenus(); }}
                className="w-full flex items-center gap-3 px-3.5 py-2.5 hover:bg-white/10 text-white rounded-xl transition-all group"
              >
                <ImageIcon size={18} className="text-accent transition-colors" />
                <span className="font-bold text-[13px]">查看截圖</span>
              </button>
              <div className="h-px bg-white/5 my-1 mx-2" />
              <button
                onClick={() => { handleDeleteGame(contextMenu.gameId); closeMenus(); }}
                className="w-full flex items-center gap-3 px-3.5 py-2.5 hover:bg-red-500/10 text-red-400 rounded-xl transition-all group"
              >
                <Trash2 size={18} className="text-red-400 transition-colors" />
                <span className="font-bold text-[13px]">刪除收藏</span>
              </button>
            </div>
          </div>
        )}

        {/* 字體右鍵選單 */}
        {fontContextMenu && (
          <div className="fixed z-[2000] min-w-[150px] font-menu-bg rounded-[24px] shadow-2xl border border-white/10 py-3 no-drag" style={{ top: fontContextMenu.mouseY, left: fontContextMenu.mouseX }}>
            <button
              onClick={() => { handleDeleteFont(fontContextMenu.fontName); closeMenus(); }}
              disabled={fontContextMenu.isDefault}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 hover:bg-red-500/20 text-red-400 rounded-xl transition-all group",
                fontContextMenu.isDefault && "opacity-20 cursor-not-allowed"
              )}
            >
              <Trash2 size={18} className="group-hover:scale-110 transition-transform" />
              <span className="font-bold">刪除字體</span>
            </button>
          </div>
        )}

        {/* 截圖右鍵選單 */}
        {screenshotContextMenu && (
          <div
            className="fixed z-[2000] min-w-[160px] bg-[#111114]/80 backdrop-blur-[40px] rounded-[24px] shadow-2xl border border-white/10 py-2.5 no-drag animate-in fade-in zoom-in-95 duration-200"
            style={{ top: screenshotContextMenu.mouseY, left: screenshotContextMenu.mouseX }}
          >
            <div className="px-1.5 space-y-0.5">
              <button
                onClick={async () => {
                  const { gameId, filename } = screenshotContextMenu;
                  try {
                    await invoke("delete_screenshot", { gameId, filename });
                  } catch (err) {
                    console.error("刪除失敗:", err);
                  }
                  closeMenus();
                }}
                className="w-full flex items-center gap-3 px-3.5 py-2.5 hover:bg-red-500/10 text-red-400 rounded-xl transition-all group"
              >
                <Trash2 size={18} className="text-red-400 group-hover:scale-110 transition-transform" />
                <span className="font-bold text-[13px]">刪除截圖</span>
              </button>
            </div>
          </div>
        )}
      </div>
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 10px; }
        .lucide-upload { stroke-width: 2.5px; }
      `}</style>
    </div>
  );
}

export default App;
