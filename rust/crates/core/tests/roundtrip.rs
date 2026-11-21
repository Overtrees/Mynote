//! 兼容验收：真实备份（原版导出 + Flutter 版导出，两份内容等价）
//! 经 Rust Core 解析再序列化，必须与原文深相等（数字按 f64 归一
//! 比较，对象键序不敏感，数组顺序敏感）。

use mynote_core::{BackupFile, Manifest};
use serde_json::Value;

fn normalize(v: &Value) -> Value {
    match v {
        Value::Number(n) => {
            let f = n.as_f64().expect("number must fit f64");
            serde_json::json!(f)
        }
        Value::Array(a) => Value::Array(a.iter().map(normalize).collect()),
        Value::Object(m) => {
            Value::Object(m.iter().map(|(k, x)| (k.clone(), normalize(x))).collect())
        }
        other => other.clone(),
    }
}

fn assert_memos_roundtrip(fixture: &str) {
    let raw = std::fs::read_to_string(format!("tests/fixtures/{fixture}")).unwrap();
    let parsed: BackupFile = serde_json::from_str(&raw).unwrap();
    assert_eq!(parsed.version, 2);
    assert_eq!(parsed.memos.len(), 2);
    let back = serde_json::to_value(&parsed).unwrap();
    let orig: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(normalize(&back), normalize(&orig), "roundtrip mismatch in {fixture}");
}

fn assert_manifest_roundtrip(fixture: &str) {
    let raw = std::fs::read_to_string(format!("tests/fixtures/{fixture}")).unwrap();
    let parsed: Manifest = serde_json::from_str(&raw).unwrap();
    assert_eq!(parsed.version, 1);
    let back = serde_json::to_value(&parsed).unwrap();
    let orig: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(normalize(&back), normalize(&orig), "roundtrip mismatch in {fixture}");
}

#[test]
fn real_backup_roundtrips_losslessly() {
    assert_memos_roundtrip("real_memos.json");
    assert_manifest_roundtrip("real_manifest.json");
}

#[test]
fn flutter_export_roundtrips_losslessly() {
    assert_memos_roundtrip("flutter_memos.json");
    assert_manifest_roundtrip("flutter_manifest.json");
}

#[test]
fn memos_expose_plain_text() {
    let raw = std::fs::read_to_string("tests/fixtures/real_memos.json").unwrap();
    let parsed: BackupFile = serde_json::from_str(&raw).unwrap();
    // 样本里「实用技巧」是文本备忘，「冬日」是纯图片备忘（段落文本
    // 为空、正文只有附件块）——按这一事实断言，不强求每条都有文本。
    let total: usize = parsed.memos.iter().map(|m| m.plain_text().len()).sum();
    assert!(total > 0, "no memo yielded any plain text");
    let text_memo = parsed
        .memos
        .iter()
        .find(|m| m.title.as_deref() == Some("实用技巧"))
        .expect("sample memo missing");
    assert!(!text_memo.plain_text().is_empty());
}
