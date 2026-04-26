import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Plus, Play, Gamepad2, X, FolderOpen, Trash2, Image as ImageIcon, Settings2, ChevronLeft, ChevronRight, Type, Edit3, Upload, Clock, Activity, Calendar } from "lucide-react";
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
}

interface Game {
  id: string;
  name: string;
  path: string;
  assets?: GameAssets;
  launchCount?: number;
  lastPlayed?: string;
  totalPlayTime?: number; // 分鐘
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newPath, setNewPath] = useState("");
  const [newLogo, setNewLogo] = useState<string | undefined>(undefined);
  const [newBackground, setNewBackground] = useState<string | undefined>(undefined);
  const [newIsVideo, setNewIsVideo] = useState(false);
  
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [fonts, setFonts] = useState<FontInfo[]>([]);
  const [currentFont, setCurrentFont] = useState<string>("system-ui");
  const [isFontMenuOpen, setIsFontMenuOpen] = useState(false);

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

  const selectedGame = games.find((g) => g.id === selectedId);

  const getAssetUrl = (url?: string) => {
    if (!url) return "";
    if (url.startsWith("data:image")) return url;
    return convertFileSrc(url);
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

  const handleSaveGame = async () => {
    if (!newName || !newPath) return;
    
    if (editingId) {
      setGames(prev => prev.map(g => g.id === editingId ? { 
        ...g, 
        name: newName, 
        path: newPath,
        assets: {
          ...g.assets,
          logo: newLogo,
          background: newBackground,
          is_video: newIsVideo
        }
      } : g));
    } else {
      const gameId = crypto.randomUUID();
      const newGame: Game = { 
        id: gameId, 
        name: newName, 
        path: newPath, 
        assets: {
          logo: newLogo,
          background: newBackground,
          is_video: newIsVideo
        },
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
      setIsModalOpen(true);
    }
  };

  const handleDeleteGame = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const updated = games.filter((g) => g.id !== id);
    setGames(updated);
    if (selectedId === id) setSelectedId(updated.length > 0 ? updated[0].id : null);
  };

  const handlePickFile = async (type: 'exe' | 'logo' | 'bg') => {
    const filters = {
      exe: [{ name: "執行檔", extensions: ["exe", "lnk", "bat"] }],
      logo: [{ name: "圖片", extensions: ["png", "jpg", "jpeg", "webp", "ico"] }],
      bg: [{ name: "素材", extensions: ["png", "jpg", "jpeg", "webp", "gif", "mp4", "webm"] }]
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
      }
    }
  };

  const handleLaunch = async () => {
    if (!selectedGame) return;
    try { 
      await invoke("run_game", { path: selectedGame.path }); 
      setGames(prev => prev.map(g => g.id === selectedGame.id ? {
        ...g,
        launchCount: (g.launchCount || 0) + 1,
        lastPlayed: new Date().toLocaleString('zh-TW', { 
          year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' 
        })
      } : g));
    } 
    catch (err) { alert(`啟動失敗: ${err}`); }
  };

  return (
    <div 
      className="flex h-screen w-full bg-[#030305] text-gray-100 selection:bg-accent/30 overflow-hidden relative transition-all duration-300"
      style={{ fontFamily: currentFont !== "system-ui" ? `'${currentFont}'` : "inherit" }}
    >
      <style>{`
        ${fonts.map(f => `
          @font-face {
            font-family: '${f.name}';
            src: url('${convertFileSrc("fonts/" + f.name)}');
          }
        `).join('\n')}
        @keyframes shimmer { 100% { transform: translateX(100%); } }
        @keyframes bg-fade {
          from { opacity: 0; transform: scale(1.02); }
          to { opacity: 0.8; transform: scale(1); }
        }
        @keyframes content-slide {
          from { opacity: 0; transform: translateX(10px); }
          to { opacity: 1; transform: translateX(0); }
        }
        .animate-bg-fade { animation: bg-fade 1s ease-out forwards; }
        .animate-content-slide { animation: content-slide 0.5s ease-out forwards; }
        .glass-premium { background: rgba(0, 0, 0, 0.2); backdrop-filter: blur(20px); border: 1px solid rgba(255, 255, 255, 0.08); }
        .sidebar-item.active { background: rgba(124, 58, 237, 0.2); border: 1px solid rgba(124, 58, 237, 0.4); color: #fff; }
        .font-menu-bg { background: #0a0a0c; backdrop-filter: blur(50px); border: 1px solid rgba(255, 255, 255, 0.1); }
      `}</style>

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
      </div>

      {/* 側邊欄 */}
      <div 
        className={cn(
          "h-screen bg-black/10 backdrop-blur-[40px] border-r border-white/5 flex flex-col z-20 transition-all duration-500 relative shadow-2xl",
          isSidebarCollapsed ? "w-20" : "w-72"
        )}
      >
        <button 
          onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          className="absolute -right-3 top-20 w-6 h-6 rounded-full bg-accent flex items-center justify-center border border-white/20 shadow-xl z-30 hover:scale-110 transition-transform"
        >
          {isSidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>

        <div className={cn("p-6 flex items-center gap-4 border-b border-white/5", isSidebarCollapsed && "justify-center px-0")}>
          <div className="w-10 h-10 rounded-xl bg-accent/20 flex items-center justify-center border border-accent/30 shadow-lg shadow-accent/10 flex-shrink-0">
            <Gamepad2 className="text-accent w-6 h-6" />
          </div>
          {!isSidebarCollapsed && <h1 className="text-xl font-black tracking-tighter">我的遊戲</h1>}
        </div>

        <div className="flex-1 overflow-y-auto py-4 px-3 space-y-2 overflow-x-hidden">
          {games.map((game) => (
            <div
              key={game.id}
              onClick={() => setSelectedId(game.id)}
              onContextMenu={(e) => handleContextMenu(e, game.id)}
              className={cn(
                "sidebar-item group rounded-xl p-2.5 flex items-center gap-3 cursor-pointer transition-all border border-transparent hover:border-white/5",
                selectedId === game.id && "active",
                isSidebarCollapsed && "justify-center"
              )}
            >
              <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center text-[10px] font-bold overflow-hidden flex-shrink-0 border border-white/10 group-hover:border-accent/30 transition-all duration-300">
                {game.assets?.logo ? (
                  <img src={getAssetUrl(game.assets.logo)} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="opacity-40">{game.name.substring(0, 1)}</span>
                )}
              </div>
              {!isSidebarCollapsed && (
                <span className="flex-1 truncate font-bold text-sm tracking-tight whitespace-pre-wrap">
                  {game.name.split('\n')[0]}
                </span>
              )}
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-white/5 space-y-2 relative">
          {isFontMenuOpen && (
            <div className="absolute bottom-full left-4 right-4 mb-2 font-menu-bg rounded-[32px] overflow-hidden shadow-2xl py-3 animate-in slide-in-from-bottom-2 duration-300 w-80">
              <div className="px-4 pb-2 mb-2 border-b border-white/10">
                <button 
                  onClick={(e) => { e.stopPropagation(); handleImportFont(); }}
                  className="w-full flex items-center justify-center gap-2 py-2 bg-accent/10 hover:bg-accent text-accent hover:text-white rounded-xl transition-all border border-accent/20 font-black text-xs"
                >
                  <Upload size={14} />
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
                    <span className="px-1.5 py-0.5 bg-accent/20 text-accent text-[8px] font-black rounded uppercase">中/英</span>
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
            {!isSidebarCollapsed && <span className="truncate">{currentFont === "system-ui" ? "字體管理選單" : currentFont.replace(/\.[^/.]+$/, "")}</span>}
          </button>
          
          <button
            onClick={() => { resetModal(); setIsModalOpen(true); }}
            className={cn(
              "flex items-center justify-center gap-2 py-3 bg-accent/20 hover:bg-accent text-accent hover:text-white rounded-xl transition-all border border-accent/20 font-black text-sm w-full shadow-lg",
              isSidebarCollapsed && "px-0"
            )}
          >
            <Plus size={18} />
            {!isSidebarCollapsed && <span>新增遊戲</span>}
          </button>
        </div>
      </div>

      {/* 主畫面 */}
      <div className="flex-1 flex flex-col relative z-10 overflow-hidden">
        {selectedGame ? (
          <div 
            key={selectedGame.id}
            className="flex-1 flex flex-col p-12 lg:p-16 relative animate-content-slide"
          >
            <div className="mb-auto relative z-10">
              <div className="absolute -inset-x-12 -inset-y-8 bg-gradient-to-r from-black/50 via-black/10 to-transparent -z-10 rounded-r-full blur-2xl" />
              
              <h2 className="text-4xl lg:text-5xl font-black tracking-tight text-white drop-shadow-[0_4px_12px_rgba(0,0,0,0.9)] leading-tight whitespace-pre-wrap mb-4" style={{ textShadow: "0 2px 10px rgba(0,0,0,0.8)" }}>
                {selectedGame.name}
              </h2>
              
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-1 bg-black/40 text-accent text-[10px] font-black rounded-md border border-accent/30 backdrop-blur-md uppercase tracking-widest">PC版</span>
                  <div className="flex items-center gap-1.5 px-2.5 py-1 bg-black/40 text-green-400 text-[10px] font-black rounded-md border border-green-500/30 backdrop-blur-md">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500/80 animate-pulse" />
                    準備就緒
                  </div>
                </div>
                
                <div className="w-px h-3 bg-white/20 hidden sm:block" />
                
                <div className="flex items-center gap-4 text-white">
                  <div className="flex items-center gap-1.5 font-bold" style={{ textShadow: "0 2px 4px rgba(0,0,0,0.5)" }}>
                    <Activity size={12} className="text-accent" />
                    <span className="text-[10px]">{selectedGame.launchCount || 0} 次啟動</span>
                  </div>
                  <div className="flex items-center gap-1.5 font-bold" style={{ textShadow: "0 2px 4px rgba(0,0,0,0.5)" }}>
                    <Clock size={12} className="text-accent" />
                    <span className="text-[10px]">{selectedGame.totalPlayTime || 0} 分鐘</span>
                  </div>
                  <div className="flex items-center gap-1.5 font-bold" style={{ textShadow: "0 2px 4px rgba(0,0,0,0.5)" }}>
                    <Calendar size={12} className="text-accent" />
                    <span className="text-[10px]">{selectedGame.lastPlayed || "尚未開始"}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end items-center mt-auto">
              <button
                onClick={handleLaunch}
                className="btn-primary text-xl px-12 py-5 rounded-2xl shadow-[0_10px_30px_rgba(0,0,0,0.5)] relative group overflow-hidden active:scale-95 transition-all duration-300"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:animate-[shimmer_2s_infinite]" />
                <Play size={22} fill="currentColor" />
                <span className="font-black ml-4 uppercase tracking-wider">開始遊戲</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500/20 flex-col gap-6">
            <Gamepad2 size={100} className="animate-pulse" />
            <p className="text-lg font-black tracking-[0.5em] opacity-10 uppercase">SELECT A GAME</p>
          </div>
        )}
      </div>

      {/* 右鍵選單 */}
      {contextMenu && (
        <div 
          className="fixed z-[100] w-max min-w-[160px] font-menu-bg rounded-[24px] shadow-2xl border border-white/10 py-3"
          style={{ top: contextMenu.mouseY, left: contextMenu.mouseX }}
        >
          <button onClick={() => handleEditClick(contextMenu.gameId)} className="w-full flex items-center gap-4 px-6 py-3 hover:bg-white/5 transition-colors text-sm font-bold whitespace-nowrap">
            <Edit3 size={18} className="text-accent" /> 編輯遊戲
          </button>
          <div className="my-2 border-t border-white/5" />
          <button onClick={() => handleDeleteGame(contextMenu.gameId)} className="w-full flex items-center gap-4 px-6 py-3 hover:bg-red-500/10 text-red-400 transition-colors text-sm font-bold whitespace-nowrap">
            <Trash2 size={18} /> 移除遊戲
          </button>
        </div>
      )}

      {/* 整合式 視窗 */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/90 backdrop-blur-2xl">
          <div className="w-full max-w-4xl glass-premium rounded-[48px] overflow-hidden shadow-2xl border-white/10 flex flex-col relative">
            <div className="p-12 pb-6 border-b border-white/5 flex items-center justify-between">
              <h3 className="text-4xl font-black tracking-tighter">{editingId ? "編輯遊戲" : "添加新遊戲"}</h3>
              <button onClick={resetModal} className="text-gray-500 hover:text-white transition-colors"><X size={36} /></button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-12 custom-scrollbar">
              <div className="grid grid-cols-2 gap-12">
                <div className="space-y-8">
                  <div className="space-y-3">
                    <label className="text-xs font-black text-accent uppercase tracking-widest ml-1">遊戲名稱 (支援換行)</label>
                    <textarea 
                      value={newName} 
                      onChange={e => setNewName(e.target.value)} 
                      rows={3}
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-8 py-5 outline-none focus:border-accent/50 font-bold text-lg resize-none" 
                      placeholder="請輸入名稱" 
                    />
                  </div>
                  <div className="space-y-3">
                    <label className="text-xs font-black text-accent uppercase tracking-widest ml-1">執行檔路徑</label>
                    <div className="flex gap-4">
                      <input type="text" value={newPath} readOnly className="flex-1 bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-xs text-gray-400 font-mono" />
                      <button onClick={() => handlePickFile('exe')} className="px-6 bg-accent/20 text-accent rounded-xl border border-accent/20 transition-all hover:bg-accent hover:text-white"><FolderOpen size={24} /></button>
                    </div>
                  </div>
                  <button onClick={handleSaveGame} disabled={!newName || !newPath} className="w-full btn-primary justify-center py-6 rounded-2xl font-black text-2xl mt-4 shadow-xl">
                    {editingId ? "儲存所有修改" : "確定添加"}
                  </button>
                </div>

                <div className="space-y-8">
                  <div className="space-y-3">
                    <label className="text-xs font-black text-accent uppercase tracking-widest ml-1">側邊欄圖示 (Logo)</label>
                    <div className="flex items-center gap-6 p-6 bg-white/5 border border-white/10 rounded-3xl relative group">
                      <div className="w-24 h-24 bg-black/40 rounded-2xl overflow-hidden flex items-center justify-center border border-white/10 shadow-lg">
                        {newLogo ? (
                          <img src={getAssetUrl(newLogo)} className="w-full h-full object-contain p-2" />
                        ) : (
                          <ImageIcon size={32} className="opacity-20" />
                        )}
                      </div>
                      <div className="flex-1 space-y-3">
                        <button onClick={() => handlePickFile('logo')} className="w-full flex items-center justify-center gap-2 py-3 bg-white/5 hover:bg-white/10 rounded-xl text-sm font-bold border border-white/10 transition-all">
                          <Settings2 size={16} /> 選擇圖示
                        </button>
                        {newLogo && <button onClick={() => setNewLogo(undefined)} className="w-full text-xs text-red-400 font-bold hover:underline">移除圖示</button>}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <label className="text-xs font-black text-accent uppercase tracking-widest ml-1">全螢幕背景 (圖片或影片)</label>
                    <div className="flex items-center gap-6 p-6 bg-white/5 border border-white/10 rounded-3xl relative group">
                      <div className="w-24 h-24 bg-black/40 rounded-2xl overflow-hidden flex items-center justify-center border border-white/10 shadow-lg relative">
                        {newBackground ? (
                          newIsVideo ? (
                            <video src={getAssetUrl(newBackground)} className="w-full h-full object-cover opacity-50" />
                          ) : (
                            <img src={getAssetUrl(newBackground)} className="w-full h-full object-cover opacity-50" />
                          )
                        ) : (
                          <ImageIcon size={32} className="opacity-20" />
                        )}
                        {newIsVideo && <div className="absolute inset-0 flex items-center justify-center"><Play size={16} fill="white" className="opacity-50" /></div>}
                      </div>
                      <div className="flex-1 space-y-3">
                        <button onClick={() => handlePickFile('bg')} className="w-full flex items-center justify-center gap-2 py-3 bg-white/5 hover:bg-white/10 rounded-xl text-sm font-bold border border-white/10 transition-all">
                          <ImageIcon size={16} /> 選擇背景
                        </button>
                        {newBackground && <button onClick={() => setNewBackground(undefined)} className="w-full text-xs text-red-400 font-bold hover:underline">移除背景</button>}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 10px; }
      `}</style>
    </div>
  );
}

export default App;
