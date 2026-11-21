//! 备份 ZIP 的读写：包结构 = memos.json + manifest.json +
//! attachments/<id> 原始字节。上限沿用原版备份校验（包 50MiB /
//! 条目 3000 / 单文件 50MiB / 解压总量 200MiB），超限直接拒绝。
//! 本模块只依赖 zip 的 deflate（纯 Rust 后端），可在 wasm 目标
//! 下编译——Web 端与原生端共用同一套包格式代码。

use std::collections::BTreeMap;
use std::io::{Cursor, Read, Write};

use crate::backup::{BackupFile, Manifest};

pub const MAX_ZIP_BYTES: u64 = 50 * 1024 * 1024;
pub const MAX_ENTRIES: usize = 3000;
pub const MAX_ENTRY_BYTES: u64 = 50 * 1024 * 1024;
pub const MAX_EXPANDED_BYTES: u64 = 200 * 1024 * 1024;

/// 一个完整解析校验过的备份包。
#[derive(Debug, Clone, PartialEq)]
pub struct BackupPackage {
    pub backup: BackupFile,
    pub manifest: Manifest,
    /// manifest.json 原文——导出时原样带回，不经模型重组。
    pub manifest_raw: Vec<u8>,
    pub attachments: BTreeMap<String, Vec<u8>>,
}

#[derive(Debug)]
pub enum BackupZipError {
    Zip(zip::result::ZipError),
    Json(serde_json::Error),
    Io(std::io::Error),
    MissingEntry(&'static str),
    TooLarge(&'static str),
}

impl std::fmt::Display for BackupZipError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BackupZipError::Zip(e) => write!(f, "zip: {e}"),
            BackupZipError::Json(e) => write!(f, "json: {e}"),
            BackupZipError::Io(e) => write!(f, "io: {e}"),
            BackupZipError::MissingEntry(n) => write!(f, "backup missing entry: {n}"),
            BackupZipError::TooLarge(w) => write!(f, "backup too large: {w}"),
        }
    }
}
impl std::error::Error for BackupZipError {}
impl From<zip::result::ZipError> for BackupZipError {
    fn from(e: zip::result::ZipError) -> Self {
        BackupZipError::Zip(e)
    }
}
impl From<serde_json::Error> for BackupZipError {
    fn from(e: serde_json::Error) -> Self {
        BackupZipError::Json(e)
    }
}
impl From<std::io::Error> for BackupZipError {
    fn from(e: std::io::Error) -> Self {
        BackupZipError::Io(e)
    }
}

pub type Result<T> = std::result::Result<T, BackupZipError>;

/// 解析并校验一个备份 ZIP 的全部内容（导入前的唯一入口：
/// 校验不过，调用方一行数据都不该动）。
pub fn read_backup_zip(bytes: &[u8]) -> Result<BackupPackage> {
    if bytes.len() as u64 > MAX_ZIP_BYTES {
        return Err(BackupZipError::TooLarge("zip file"));
    }
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes))?;
    if archive.len() > MAX_ENTRIES {
        return Err(BackupZipError::TooLarge("entry count"));
    }

    let memos_json = read_entry(&mut archive, "memos.json")?;
    let backup: BackupFile = serde_json::from_slice(&memos_json)?;

    let manifest_raw = read_entry(&mut archive, "manifest.json")?;
    let manifest: Manifest = serde_json::from_slice(&manifest_raw)?;

    let mut attachments: BTreeMap<String, Vec<u8>> = BTreeMap::new();
    let mut expanded: u64 = memos_json.len() as u64 + manifest_raw.len() as u64;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i)?;
        let name = entry.name().to_string();
        if let Some(id) = name.strip_prefix("attachments/") {
            if id.is_empty() {
                continue;
            }
            if entry.size() > MAX_ENTRY_BYTES {
                return Err(BackupZipError::TooLarge("attachment"));
            }
            let mut buf = Vec::new();
            entry.read_to_end(&mut buf)?;
            expanded += buf.len() as u64;
            if expanded > MAX_EXPANDED_BYTES {
                return Err(BackupZipError::TooLarge("expanded total"));
            }
            attachments.insert(id.to_string(), buf);
        }
    }

    Ok(BackupPackage {
        backup,
        manifest,
        manifest_raw,
        attachments,
    })
}

/// 组装一个备份 ZIP：memos.json 用给定 BackupFile 序列化，
/// manifest 用原文，附件逐 id 写原始字节。
pub fn write_backup_zip(
    backup: &BackupFile,
    manifest_raw: &[u8],
    attachments: &BTreeMap<String, Vec<u8>>,
) -> Result<Vec<u8>> {
    let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    writer.start_file("memos.json", opts)?;
    writer.write_all(serde_json::to_string(backup)?.as_bytes())?;
    writer.start_file("manifest.json", opts)?;
    writer.write_all(manifest_raw)?;
    for (id, data) in attachments {
        writer.start_file(format!("attachments/{id}"), opts)?;
        writer.write_all(data)?;
    }
    let cursor = writer.finish()?;
    Ok(cursor.into_inner())
}

fn read_entry(
    archive: &mut zip::ZipArchive<Cursor<&[u8]>>,
    name: &'static str,
) -> Result<Vec<u8>> {
    match archive.by_name(name) {
        Ok(mut entry) => {
            if entry.size() > MAX_ENTRY_BYTES {
                return Err(BackupZipError::TooLarge(name));
            }
            let mut buf = Vec::new();
            entry.read_to_end(&mut buf)?;
            Ok(buf)
        }
        Err(zip::result::ZipError::FileNotFound) => Err(BackupZipError::MissingEntry(name)),
        Err(e) => Err(BackupZipError::Zip(e)),
    }
}
