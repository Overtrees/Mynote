//! Mynote 存储层：SQLite 本地库 + 备份 ZIP 导入/导出。
//!
//! 设计要点（阶段 1）：
//! - 每条备忘以完整 JSON 原样入库（memo_json），另抽索引列
//!   （标题/置顶/时间/纯文本）供列表与检索——导出保真由原样
//!   JSON 保证，查询性能由索引列保证，两者不互相妥协。
//! - 备份导入沿用原版语义：先完整解析校验，再单事务全量替换。
//! - 检索用 FTS5 trigram，对中文做子串匹配（与现行子串检索
//!   语义一致）；trigram 要求查询至少 3 个字符，短查询回退
//!   LIKE 子串扫描。

use std::collections::BTreeMap;
use std::path::Path;

use mynote_core::{BackupFile, Memo};
use rusqlite::{params, Connection};

pub struct Store {
    conn: Connection,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ImportStats {
    pub memos: usize,
    pub attachments: usize,
}

#[derive(Debug)]
pub enum StoreError {
    Sqlite(rusqlite::Error),
    Json(serde_json::Error),
    Backup(mynote_core::BackupZipError),
    Io(std::io::Error),
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StoreError::Sqlite(e) => write!(f, "sqlite: {e}"),
            StoreError::Json(e) => write!(f, "json: {e}"),
            StoreError::Backup(e) => write!(f, "backup: {e}"),
            StoreError::Io(e) => write!(f, "io: {e}"),
        }
    }
}
impl std::error::Error for StoreError {}
impl From<rusqlite::Error> for StoreError {
    fn from(e: rusqlite::Error) -> Self {
        StoreError::Sqlite(e)
    }
}
impl From<serde_json::Error> for StoreError {
    fn from(e: serde_json::Error) -> Self {
        StoreError::Json(e)
    }
}
impl From<mynote_core::BackupZipError> for StoreError {
    fn from(e: mynote_core::BackupZipError) -> Self {
        StoreError::Backup(e)
    }
}
impl From<std::io::Error> for StoreError {
    fn from(e: std::io::Error) -> Self {
        StoreError::Io(e)
    }
}

pub type Result<T> = std::result::Result<T, StoreError>;

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS memos (
    id_json    TEXT PRIMARY KEY,
    id_text    TEXT NOT NULL,
    title      TEXT,
    pinned     INTEGER NOT NULL DEFAULT 0,
    created_ms INTEGER,
    updated_ms INTEGER,
    plain_text TEXT NOT NULL,
    memo_json  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS attachments (
    id   TEXT PRIMARY KEY,
    data BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS memos_fts USING fts5(
    id UNINDEXED, title, content, tokenize='trigram'
);
";

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)?;
        Self::init(conn)
    }

    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        Self::init(conn)
    }

    fn init(conn: Connection) -> Result<Self> {
        conn.execute_batch(SCHEMA)?;
        Ok(Store { conn })
    }

    /// 全量替换式导入一个备份 ZIP（原版恢复语义）：先把包内
    /// 全部内容解析校验完毕，再在单个事务里换库，坏包不污染
    /// 现有数据。
    pub fn import_backup(&mut self, zip_path: &Path) -> Result<ImportStats> {
        // 包的解析校验全在 core 的 read_backup_zip 里完成（含
        // manifest 结构校验与体积上限）；这里拿到的是已校验的
        // 完整包，之后只剩单事务换库。
        let bytes = std::fs::read(zip_path)?;
        let pkg = mynote_core::read_backup_zip(&bytes)?;
        let backup = &pkg.backup;
        let attachments = &pkg.attachments;
        let manifest_raw = pkg.manifest_raw.as_slice();

        let stats = ImportStats {
            memos: backup.memos.len(),
            attachments: attachments.len(),
        };

        let tx = self.conn.transaction()?;
        tx.execute_batch(
            "DELETE FROM memos; DELETE FROM attachments; DELETE FROM memos_fts;",
        )?;
        for memo in &backup.memos {
            Self::insert_memo(&tx, memo)?;
        }
        for (id, data) in attachments {
            tx.execute(
                "INSERT INTO attachments (id, data) VALUES (?1, ?2)",
                params![id, data],
            )?;
        }
        tx.execute(
            "INSERT OR REPLACE INTO meta (key, value) VALUES ('manifest_json', ?1)",
            params![String::from_utf8_lossy(&manifest_raw).into_owned()],
        )?;
        let avatars_json = backup
            .avatars
            .as_ref()
            .map(|a| a.to_string())
            .unwrap_or_else(|| "null".to_string());
        tx.execute(
            "INSERT OR REPLACE INTO meta (key, value) VALUES ('avatars_json', ?1)",
            params![avatars_json],
        )?;
        tx.commit()?;
        Ok(stats)
    }

    fn insert_memo(conn: &Connection, memo: &Memo) -> Result<()> {
        let id_json = serde_json::to_string(&memo.id)?;
        let id_text = memo.id.to_string();
        let plain = memo.plain_text();
        conn.execute(
            "INSERT OR REPLACE INTO memos
             (id_json, id_text, title, pinned, created_ms, updated_ms, plain_text, memo_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                id_json,
                id_text,
                memo.title,
                memo.pinned.unwrap_or(false) as i64,
                memo.created_at.to_millis(),
                memo.updated_at.to_millis(),
                plain,
                serde_json::to_string(memo)?,
            ],
        )?;
        conn.execute(
            "DELETE FROM memos_fts WHERE id = ?1",
            params![id_text],
        )?;
        conn.execute(
            "INSERT INTO memos_fts (id, title, content) VALUES (?1, ?2, ?3)",
            params![id_text, memo.title.clone().unwrap_or_default(), plain],
        )?;
        Ok(())
    }

    /// 列表顺序与现行应用一致：置顶在前，其余按更新时间倒序。
    pub fn list_memos(&self) -> Result<Vec<Memo>> {
        let mut stmt = self.conn.prepare(
            "SELECT memo_json FROM memos ORDER BY pinned DESC, updated_ms DESC",
        )?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(serde_json::from_str(&row?)?);
        }
        Ok(out)
    }

    pub fn memo_count(&self) -> Result<usize> {
        Ok(self
            .conn
            .query_row("SELECT COUNT(*) FROM memos", [], |r| r.get::<_, i64>(0))?
            as usize)
    }

    pub fn attachment_count(&self) -> Result<usize> {
        Ok(self.conn.query_row(
            "SELECT COUNT(*) FROM attachments",
            [],
            |r| r.get::<_, i64>(0),
        )? as usize)
    }

    /// 子串检索（标题 + 正文）：≥3 字符走 FTS5 trigram 短语
    /// 查询；更短的查询 FTS 索引不了，回退 LIKE 扫描。返回
    /// 命中的备忘 id（文本形），顺序同列表。
    pub fn search(&self, query: &str) -> Result<Vec<String>> {
        let q = query.trim();
        if q.is_empty() {
            return Ok(Vec::new());
        }
        let ids: Vec<String> = if q.chars().count() >= 3 {
            let phrase = format!("\"{}\"", q.replace('"', "\"\""));
            let mut stmt = self.conn.prepare(
                "SELECT id FROM memos_fts WHERE memos_fts MATCH ?1",
            )?;
            let rows = stmt.query_map(params![phrase], |r| r.get::<_, String>(0))?;
            rows.collect::<std::result::Result<_, _>>()?
        } else {
            let like = format!("%{q}%");
            let mut stmt = self.conn.prepare(
                "SELECT id_text FROM memos
                 WHERE title LIKE ?1 OR plain_text LIKE ?1
                 ORDER BY pinned DESC, updated_ms DESC",
            )?;
            let rows = stmt.query_map(params![like], |r| r.get::<_, String>(0))?;
            rows.collect::<std::result::Result<_, _>>()?
        };
        Ok(ids)
    }

    /// 导出备份 ZIP：memos.json（version 2，exportedAt 为导出
    /// 时刻，与原版行为一致）+ manifest.json（导入时原文）+
    /// attachments/<id> 原始字节。
    pub fn export_backup(&self, zip_path: &Path) -> Result<()> {
        let memos = self.list_memos_ordered_for_export()?;
        let avatars: Option<serde_json::Value> = self
            .meta("avatars_json")?
            .and_then(|s| serde_json::from_str(&s).ok())
            .filter(|v: &serde_json::Value| !v.is_null());
        let backup = BackupFile {
            version: 2,
            exported_at: Some(serde_json::Value::String(
                chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string(),
            )),
            memos,
            avatars,
            extra: Default::default(),
        };
        let manifest = self
            .meta("manifest_json")?
            .unwrap_or_else(|| "{\"version\":1,\"attachments\":[]}".to_string());

        let mut attachments: BTreeMap<String, Vec<u8>> = BTreeMap::new();
        {
            let mut stmt = self
                .conn
                .prepare("SELECT id, data FROM attachments ORDER BY id")?;
            let rows = stmt.query_map([], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, Vec<u8>>(1)?))
            })?;
            for row in rows {
                let (id, data) = row?;
                attachments.insert(id, data);
            }
        }
        let bytes = mynote_core::write_backup_zip(&backup, manifest.as_bytes(), &attachments)?;
        std::fs::write(zip_path, bytes)?;
        Ok(())
    }

    /// 导出时备忘按创建时间正序（与原版导出文件里的顺序同类）；
    /// 验收按 id 对齐比较，不依赖此顺序。
    fn list_memos_ordered_for_export(&self) -> Result<Vec<Memo>> {
        let mut stmt = self.conn.prepare(
            "SELECT memo_json FROM memos ORDER BY created_ms ASC",
        )?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(serde_json::from_str(&row?)?);
        }
        Ok(out)
    }

    fn meta(&self, key: &str) -> Result<Option<String>> {
        let mut stmt = self.conn.prepare("SELECT value FROM meta WHERE key = ?1")?;
        let mut rows = stmt.query(params![key])?;
        match rows.next()? {
            Some(row) => Ok(Some(row.get(0)?)),
            None => Ok(None),
        }
    }
}
