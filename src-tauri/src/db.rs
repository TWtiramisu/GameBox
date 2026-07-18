use rusqlite::Connection;

pub fn init_db() -> Connection {
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
