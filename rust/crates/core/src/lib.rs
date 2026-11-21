//! Mynote Rust Core：文档模型与备份格式。
//! 阶段 1 目标只有一个——独立读写现有笔记数据且往返无损，
//! 格式逐字节沿用现网块 JSON + ZIP 备份，不新造格式。

pub mod backup;
pub mod backup_zip;
pub mod inline_html;
pub mod model;

pub use backup::{BackupFile, Manifest};
pub use backup_zip::{read_backup_zip, write_backup_zip, BackupPackage, BackupZipError};
pub use inline_html::{html_to_inlines, inlines_to_html, split_highlight};
pub use model::{Memo, Node};
