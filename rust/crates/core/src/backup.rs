//! 备份文件格式：ZIP 内的 memos.json（version 2）与 manifest.json
//! （version 1）。与原版/Flutter 版的备份层互通是硬约束，验收样本
//! 是真实导出（tests/fixtures/）。avatars 的结构暂不建模、原样
//! 透传，后续存储层阶段再细化。

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::model::Memo;

/// memos.json 根对象。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BackupFile {
    pub version: u32,
    #[serde(rename = "exportedAt", default, skip_serializing_if = "Option::is_none")]
    pub exported_at: Option<Value>,
    #[serde(default)]
    pub memos: Vec<Memo>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatars: Option<Value>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// manifest.json 根对象：附件清单（id → 元数据），暂原样透传。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Manifest {
    pub version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attachments: Option<Value>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}
