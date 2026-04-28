import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { Plus, Play, Gamepad2, X, FolderOpen, Trash2, Image as ImageIcon, ChevronLeft, ChevronRight, Type, Edit3, Clock, Activity, Calendar, Settings, Info, Monitor, ArrowLeft, Upload, Sliders, RefreshCw } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface FontInfo {
  name: string;
  size_mb: number;
}

interface GameAssets {
  logo?: string;
  background?: string;
  is_video?: boolean;
  titleLogo?: string;
  topLeftLogo?: string;
}

interface Game {
  id: string;
  name: string;
  path: string;
  assets?: GameAssets;
  launchCount?: number;
  lastPlayed?: string;
  totalPlayTime?: number;
  autoUpdate?: boolean;
  hoyoChannel?: string;
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

  const syncGameStats = useCallback(async (gameId: string) => {
    try {
      const stats = await invoke<{ launch_count: number; total_play_time: number; last_played: string | null }>("get_game_stats", { gameId });
      setGames(prev => prev.map(g => g.id === gameId ? {
        ...g,
        launchCount: stats.launch_count,
        totalPlayTime: stats.total_play_time,
        lastPlayed: stats.last_played || g.lastPlayed
      } : g));
    } catch (e) {
      console.error("同步統計失敗", e);
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






  useEffect(() => {
    const saved = localStorage.getItem("games");
    if (saved) {
      const parsed = JSON.parse(saved);
      setGames(parsed);
      if (parsed.length > 0) setSelectedId(parsed[0].id);
      
      // 啟動時請求後端恢復追蹤正在執行的遊戲
      const gamePaths = parsed.map((g: any) => [g.id, g.path]);
      invoke("recover_running_games", { gamesList: gamePaths }).catch(console.error);
    }

    const savedFont = localStorage.getItem("app-font");
    if (savedFont) setCurrentFont(savedFont);

    loadFonts();
  }, []);

  useEffect(() => {
    localStorage.setItem("games", JSON.stringify(games));
  }, [games]);

  useEffect(() => {
    localStorage.setItem("app-font", currentFont);
  }, [currentFont]);

  useEffect(() => {
    const unlistenStatus = listen<[string, boolean]>("game-status-changed", (event) => {
      const [gameId, isRunning] = event.payload;
      setRunningGames(prev => ({ ...prev, [gameId]: isRunning }));
      if (!isRunning) {
        // 當遊戲關閉時同步最新的 SQL 數據
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

  useEffect(() => {
    if (selectedId) {
      syncGameStats(selectedId);
      invoke<boolean>("is_game_running", { gameId: selectedId }).then(running => {
        setRunningGames(prev => ({ ...prev, [selectedId]: running }));
      });
    }
  }, [selectedId, syncGameStats]);

  const selectedGame = games.find((g) => g.id === selectedId);

  const getAssetUrl = (url?: string) => {
    if (!url) return "";
    if (url.startsWith("data:image")) return url;
    // Remote HTTP/HTTPS URLs (e.g. HoYoPlay CDN) should be used directly
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

  const closeMenus = useCallback(() => {
    setContextMenu(null);
    setIsFontMenuOpen(false);
  }, []);

  useEffect(() => {
    window.addEventListener("click", closeMenus);
    return () => window.removeEventListener("click", closeMenus);
  }, [closeMenus]);

  const handleSaveGame = async () => {
    if (!newName || !newPath) return;

    let finalAssets: GameAssets = {
      logo: newLogo,
      background: newBackground,
      is_video: newIsVideo,
      titleLogo: titleMode === "logo" ? newTitleLogo : undefined,
      topLeftLogo: undefined
    };

    // If a channel is selected, auto-fetch logo & background
    if (paramAutoUpdate && paramHoyoChannel) {
      setHoyoFetching(true);
      try {
        const assets = await invoke<{ logo: string | null; background: string | null; background_is_video: boolean; top_left_logo: string | null }>("fetch_hoyoplay_game_info", { gameId: paramHoyoChannel });
        finalAssets = {
          logo: assets.logo || newLogo,
          background: assets.background || newBackground,
          is_video: assets.background_is_video,
          titleLogo: finalAssets.titleLogo,
          topLeftLogo: assets.top_left_logo || undefined
        };
      } catch (e) {
        console.error("抓取 HoYoPlay 資產失敗", e);
      } finally {
        setHoyoFetching(false);
      }
    }

    const gameData = {
      name: newName,
      path: newPath,
      assets: finalAssets,
      autoUpdate: paramAutoUpdate,
      hoyoChannel: paramHoyoChannel
    };

    if (editingId) {
      setGames(prev => prev.map(g => g.id === editingId ? { ...g, ...gameData } : g));
    } else {
      const gameId = crypto.randomUUID();
      const newGame: Game = {
        id: gameId,
        ...gameData,
        launchCount: 0,
        totalPlayTime: 0
      };
      setGames(prev => [...prev, newGame]);
      setSelectedId(gameId);
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
      
      // Initialize developer tools state
      setParamAutoUpdate(game.autoUpdate || false);
      setParamHoyoChannel(game.hoyoChannel || "");
      setParamPlatform(game.hoyoChannel ? "hoyoverse" : null);
      
      // Auto-fetch if platform is already set
      if (game.hoyoChannel) {
        setHoyoGames([]); setHoyoLoading(true);
        invoke<HoYoGame[]>("fetch_hoyoplay_games").then(l => setHoyoGames(l)).catch(e => console.error(e)).finally(() => setHoyoLoading(false));
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

  const handleLaunch = async () => {
    if (!selectedGame || runningGames[selectedGame.id]) return;
    try {
      await invoke("run_game", { gameId: selectedGame.id, path: selectedGame.path });
      // 啟動後立即更新一次本地狀態（雖然監聽器也會處理）
      setRunningGames(prev => ({ ...prev, [selectedGame.id]: true }));
      syncGameStats(selectedGame.id);
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
            src: url('${convertFileSrc("fonts/" + f.name)}');
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
        <div className="absolute inset-0 bg-gradient-to-t from-[#030305] via-[#030305]/10 to-transparent" />
        
        {/* 左上角 Logo */}
        {/* 左上角 Logo 暫時取消顯示
        {selectedGame?.assets?.topLeftLogo && (
          <div className="absolute top-12 left-12 z-20 pointer-events-none drop-shadow-2xl">
            <img 
              src={getAssetUrl(selectedGame.assets.topLeftLogo)} 
              alt="Brand Logo" 
              className="h-24 lg:h-32 object-contain opacity-90" 
            />
          </div>
        )}
        */}
      </div>

      <div
        className={cn(
          "h-screen bg-[#0a0a0c]/40 backdrop-blur-[20px] border-r border-white/5 flex flex-col z-20 transition-all duration-500 relative shadow-2xl",
          isSidebarCollapsed ? "w-20" : "w-72"
        )}
      >
        <button
          onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          className="absolute -right-3 top-20 w-6 h-6 rounded-full bg-accent flex items-center justify-center border border-white/20 shadow-xl z-30 hover:scale-110 transition-transform"
        >
          {isSidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>

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
              onClick={() => setSelectedId(game.id)}
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
              <div className="max-h-[400px] overflow-y-auto px-2 space-y-1 custom-scrollbar">
                <button
                  onClick={() => { setCurrentFont("system-ui"); setIsFontMenuOpen(false); }}
                  className={cn(
                    "w-full rounded-2xl px-4 py-3 flex flex-col items-start hover:bg-white/5 transition-all text-left",
                    currentFont === "system-ui" && "bg-accent/10 border border-accent/20"
                  )}
                  style={{ fontFamily: "system-ui" }}
                >
                  <div className="flex items-center justify-between w-full mb-1">
                    <span className="text-xs font-black opacity-40 uppercase tracking-widest">Default</span>
                    <span className="px-1.5 py-0.5 bg-accent/20 text-accent text-[8px] font-black rounded uppercase">支援中/英</span>
                  </div>
                  <span className="text-lg font-bold">系統預設字體</span>
                </button>

                {fonts.map(f => (
                  <button
                    key={f.name}
                    onClick={() => { setCurrentFont(f.name); setIsFontMenuOpen(false); }}
                    className={cn(
                      "w-full rounded-2xl px-4 py-3 flex flex-col items-start hover:bg-white/5 transition-all text-left",
                      currentFont === f.name && "bg-accent/10 border border-accent/20"
                    )}
                    style={{ fontFamily: `'${f.name}'` }}
                  >
                    <div className="flex items-center justify-between w-full mb-1">
                      <span className="text-[10px] opacity-40 truncate flex-1 mr-2">{f.name.replace(/\.[^/.]+$/, "")}</span>
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
                <span className="flex flex-col gap-1"><span className="text-[10px] text-accent uppercase tracking-widest opacity-50">累積時間</span><span className="flex items-center gap-2"><Clock size={14} className="text-accent" /> {selectedGame.totalPlayTime || 0} 分鐘</span></span>
                <span className="flex flex-col gap-1"><span className="text-[10px] text-accent uppercase tracking-widest opacity-50">最後執行</span><span className="flex items-center gap-2"><Calendar size={14} className="text-accent" /> {selectedGame.lastPlayed || "尚未開始"}</span></span>
              </div>

              <div className="flex flex-col items-center gap-5">
                {runningGames[selectedGame.id] ? (
                  <div className="flex items-center gap-2 px-4 py-1.5 bg-blue-500/10 text-blue-400 text-[11px] font-black rounded-full border border-blue-500/20 backdrop-blur-md">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.6)]" />
                    正在遊玩
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
                    "px-20 py-5 rounded-2xl shadow-2xl flex items-center gap-4 relative group overflow-hidden no-drag transition-all duration-500 min-w-[320px] justify-center",
                    runningGames[selectedGame.id] 
                      ? "bg-white/5 border border-white/10 text-gray-500 cursor-not-allowed" 
                      : "btn-primary"
                  )}
                >
                  {!runningGames[selectedGame.id] && <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:animate-[shimmer_2s_infinite]" />}
                  {runningGames[selectedGame.id] ? <Activity size={24} className="animate-pulse" /> : <Play size={24} fill="currentColor" />}
                  <span className="text-xl font-black uppercase tracking-widest">
                    {runningGames[selectedGame.id] ? "遊戲正在執行中" : "開始遊戲"}
                  </span>
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

      {/* 設定介面 */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-12 bg-black/20 backdrop-blur-md animate-in fade-in duration-500">
          <div className="w-full max-w-4xl h-[600px] bg-[#111114]/60 backdrop-blur-[60px] rounded-[32px] overflow-hidden shadow-2xl flex flex-col relative border border-white/10">
            <button onClick={() => setIsSettingsOpen(false)} className="absolute top-8 left-8 z-10 p-3 bg-white/5 hover:bg-accent hover:text-white rounded-2xl transition-all border border-white/10 group">
              <ArrowLeft size={24} className="group-active:-translate-x-1 transition-transform" />
            </button>
            <div className="flex h-full">
              <div className="w-64 border-r border-white/10 p-8 pt-28 space-y-4">
                <button onClick={() => setSettingsTab("about")} className={cn("w-full flex items-center gap-4 px-6 py-4 rounded-2xl font-black transition-all", settingsTab === "about" ? "bg-accent text-white shadow-lg shadow-accent/20" : "hover:bg-white/5 text-gray-500")}>
                  <Info size={20} /> 關於
                </button>
                <button onClick={() => setSettingsTab("general")} className={cn("w-full flex items-center gap-4 px-6 py-4 rounded-2xl font-black transition-all", settingsTab === "general" ? "bg-accent text-white shadow-lg shadow-accent/20" : "hover:bg-white/5 text-gray-500")}>
                  <Monitor size={20} /> 一般
                </button>
              </div>
              <div className="flex-1 p-12 pt-28 overflow-y-auto custom-scrollbar">
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
                    <div className="space-y-6 max-w-xl">
                      <p className="text-gray-400 font-bold leading-relaxed">
                        GameBox 是一款追求極致速度與視覺美感的次世代遊戲啟動器。
                        我們致力於打破各廠商間的藩籬，提供一個統一且高度自定義的遊戲管理空間。
                      </p>
                      <div className="grid grid-cols-2 gap-4 pt-6">
                        <div className="p-6 bg-white/5 rounded-3xl border border-white/5">
                          <p className="text-xs text-accent font-black uppercase mb-1">Developer</p>
                          <p className="font-black text-lg">TWtiramisu</p>
                        </div>
                        <div className="p-6 bg-white/5 rounded-3xl border border-white/5">
                          <p className="text-xs text-accent font-black uppercase mb-1">Framework</p>
                          <p className="font-black text-lg">Tauri + React</p>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-gray-600 opacity-20 italic font-black">
                    <Monitor size={60} className="mb-4" />
                    <p className="text-2xl uppercase tracking-widest">General Settings Coming Soon</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 編輯/新增視窗 (包含開發者工具) */}
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

              {/* 下方：開發者工具 (BETA) */}
              <div className="space-y-8 pb-8">
                <div className="flex items-center gap-3">
                  <Sliders size={20} className="text-accent" />
                  <h4 className="text-xl font-black tracking-tight">開發者工具 <span className="text-[10px] bg-accent/20 text-accent px-2 py-0.5 rounded ml-2">BETA</span></h4>
                </div>

                <div className="grid grid-cols-1 gap-8">
                  {/* 自動更新開關 */}
                  <div className="flex items-center justify-between p-8 bg-white/5 rounded-3xl border border-white/10">
                    <div className="flex items-center gap-6">
                      <div className="w-12 h-12 rounded-2xl bg-green-500/20 flex items-center justify-center border border-green-500/30">
                        <RefreshCw size={24} className="text-green-400" />
                      </div>
                      <div>
                        <p className="font-black text-lg">自動更新</p>
                        <p className="text-sm text-gray-500 mt-1">開啟後選擇平台與遊戲以獲取最新資產</p>
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
                    <div className="grid grid-cols-2 gap-12 animate-in slide-in-from-top-4 duration-500">
                      {/* Platform Select */}
                      <div className="space-y-4 w-full">
                        <label className="text-[14px] font-black text-accent uppercase tracking-[0.2em] ml-1">選擇平台</label>
                        <div className="space-y-3 h-[260px] overflow-y-auto custom-scrollbar pr-2">
                          {[
                            { id: "hoyoverse", name: "HoYoVerse", status: "supported", label: "已支援" },
                            { id: "kuro", name: "Kuro Games", status: "pending", label: "尚未支援" },
                            { id: "perfectworld", name: "Perfect World", status: "pending", label: "尚未支援" }
                          ].map(platform => (
                            <button
                              key={platform.id}
                              disabled={platform.status === 'pending'}
                              onClick={() => {
                                setParamPlatform(platform.id);
                                setParamHoyoChannel("");
                                if (platform.id === "hoyoverse") {
                                  setHoyoGames([]); setHoyoLoading(true);
                                  invoke<HoYoGame[]>("fetch_hoyoplay_games").then(l => setHoyoGames(l)).catch(e => console.error(e)).finally(() => setHoyoLoading(false));
                                }
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
                          {paramPlatform === "hoyoverse" ? (
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
                                    <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 text-[10px] rounded border border-blue-500/30">國際服</span>
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
        <div className="fixed z-[100] min-w-[180px] font-menu-bg rounded-[24px] shadow-2xl border border-white/10 py-3 no-drag" style={{ top: contextMenu.mouseY, left: contextMenu.mouseX }}>
          <button onClick={() => { handleEditClick(contextMenu.gameId); closeMenus(); }} className="w-full flex items-center gap-4 px-6 py-3 hover:bg-white/5 transition-colors text-sm font-bold"><Edit3 size={18} className="text-accent" /> 編輯遊戲</button>
          <div className="my-2 border-t border-white/5" />
          <button onClick={() => { handleDeleteGame(contextMenu.gameId); closeMenus(); }} className="w-full flex items-center gap-4 px-6 py-3 hover:bg-red-500/10 text-red-400 transition-colors text-sm font-bold"><Trash2 size={18} /> 移除遊戲</button>
        </div>
      )}
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 10px; }
        .btn-primary { background: #7c3aed; color: white; transition: all 0.3s; }
        .btn-primary:hover { background: #6d28d9; transform: translateY(-2px); }
        .lucide-upload { stroke-width: 2.5px; }
      `}</style>
      </div>
    </div>
  );
}

export default App;
