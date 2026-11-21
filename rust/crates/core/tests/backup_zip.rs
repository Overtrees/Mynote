//! 备份 ZIP 读写验收：两份真实互通样本（原版导出 + Flutter
//! 导出）经 core 的 read → write → read 后语义不变——memos 深
//! 相等（数字按 f64 归一、键序无关、数组序敏感）、manifest
//! 原文一致、附件逐 id 字节一致。

use std::path::PathBuf;

use mynote_core::{read_backup_zip, write_backup_zip};
use serde_json::Value;

fn acceptance_zip(name: &str) -> Vec<u8> {
    let p = PathBuf::from(format!(
        "{}/../../../../mynote-zip-acceptance/{name}",
        env!("CARGO_MANIFEST_DIR")
    ));
    assert!(p.exists(), "acceptance zip missing: {}", p.display());
    std::fs::read(p).unwrap()
}

fn normalize(v: &Value) -> Value {
    match v {
        Value::Number(n) => serde_json::json!(n.as_f64().unwrap()),
        Value::Array(a) => Value::Array(a.iter().map(normalize).collect()),
        Value::Object(m) => {
            Value::Object(m.iter().map(|(k, x)| (k.clone(), normalize(x))).collect())
        }
        other => other.clone(),
    }
}

fn check_roundtrip(name: &str) {
    let bytes = acceptance_zip(name);
    let pkg = read_backup_zip(&bytes).unwrap();
    assert_eq!(pkg.backup.memos.len(), 2, "{name}: memo count");
    assert_eq!(pkg.attachments.len(), 17, "{name}: attachment count");
    assert_eq!(pkg.manifest.version, 1, "{name}: manifest version");

    let out = write_backup_zip(&pkg.backup, &pkg.manifest_raw, &pkg.attachments).unwrap();
    let pkg2 = read_backup_zip(&out).unwrap();

    let a = normalize(&serde_json::to_value(&pkg.backup).unwrap());
    let b = normalize(&serde_json::to_value(&pkg2.backup).unwrap());
    // exportedAt 是导出时刻，两包都会带且必然不同——比较前摘掉
    let mut a = a;
    let mut b = b;
    a.as_object_mut().unwrap().remove("exportedAt");
    b.as_object_mut().unwrap().remove("exportedAt");
    assert_eq!(a, b, "{name}: memos deep-equal after zip roundtrip");
    assert_eq!(pkg.manifest_raw, pkg2.manifest_raw, "{name}: manifest raw");
    assert_eq!(pkg.attachments, pkg2.attachments, "{name}: attachment bytes");
}

#[test]
fn real_backup_zip_roundtrip() {
    check_roundtrip("real_backup.zip");
}

#[test]
fn flutter_export_zip_roundtrip() {
    check_roundtrip("flutter_export.zip");
}
