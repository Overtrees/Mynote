//! 文档模型：逐字段镜像现有块 JSON 格式（原版 Web 应用与 Flutter 版
//! 共用的那一份），不新造格式。任何本模型尚未显式建模的字段都经
//! `extra` 透传，保证往返序列化无损——格式的事实标准是现网数据，
//! 不是本文件。

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// 笔记 id：线上数据里字符串与数字两种都有（真实样本各一），
/// 无标签枚举原样保真。
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Id {
    Str(String),
    Num(i64),
}

impl std::fmt::Display for Id {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Id::Str(s) => write!(f, "{s}"),
            Id::Num(n) => write!(f, "{n}"),
        }
    }
}

/// 时间戳：线上以 ISO-8601 字符串为主，个别来源是毫秒数，
/// 两种都保真收下，换算由 `to_millis` 提供。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Timestamp {
    Iso(String),
    Millis(i64),
}

impl Timestamp {
    /// 换算为毫秒 epoch；ISO 解析失败时返回 None（不猜）。
    pub fn to_millis(&self) -> Option<i64> {
        match self {
            Timestamp::Millis(n) => Some(*n),
            Timestamp::Iso(s) => chrono::DateTime::parse_from_rfc3339(s)
                .ok()
                .map(|dt| dt.timestamp_millis()),
        }
    }
}

/// 一条笔记。`doc` 是块数组；备忘级扩展（如 layout）走 `extra`。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Memo {
    pub id: Id,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pinned: Option<bool>,
    #[serde(rename = "createdAt")]
    pub created_at: Timestamp,
    #[serde(rename = "updatedAt")]
    pub updated_at: Timestamp,
    #[serde(default)]
    pub doc: Vec<Node>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// 文档节点：行内文本与块共用一个形状，与线上 JSON 一致。
/// 有 `text` 而无 `type` 的是行内文本节点；有 `type` 的是块。
/// 块的专有字段（卡片的 url/status/meta、附件的 fileId、图片的
/// attrs 等）一律经 `extra` 透传，待编辑器内核阶段再逐类建模。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Node {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(rename = "type", default, skip_serializing_if = "Option::is_none")]
    pub node_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<Node>>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl Node {
    pub fn is_text(&self) -> bool {
        self.node_type.is_none() && self.text.is_some()
    }

    pub fn is_block(&self) -> bool {
        self.node_type.is_some()
    }

    /// 块类型名（paragraph / heading / todo / image / link-card …）。
    pub fn block_type(&self) -> Option<&str> {
        self.node_type.as_deref()
    }

    /// 节点的纯文本（行内节点取自身，块递归拼接子节点）。
    pub fn plain_text(&self) -> String {
        let mut out = String::new();
        if let Some(t) = &self.text {
            out.push_str(t);
        }
        if let Some(children) = &self.children {
            for c in children {
                out.push_str(&c.plain_text());
            }
        }
        out
    }
}

impl Memo {
    /// 全文纯文本（搜索索引与摘要用）。
    pub fn plain_text(&self) -> String {
        self.doc.iter().map(|n| n.plain_text()).collect()
    }
}
