//! 存储管线验收：真实备份 ZIP → SQLite → 检索 → 导出 ZIP，
//! 导出包与原包语义等价（memos.json 除 exportedAt 外深相等、
//! manifest 深相等、附件逐 id 字节相等）。

use std::collections::BTreeMap;
use std::io::Read;
use std::path::PathBuf;

use mynote_storage::Store;
use serde_json::Value;

fn acceptance_zip(name: &str) -> PathBuf {
    // 验收样本在仓库外的 mynote-zip-acceptance/（2026-11-19 真机
    // 互通验收的那两份），与 rust/ 同在 workspace 根下。
    let p = PathBuf::from(format!(
        "{}/../../../../mynote-zip-acceptance/{name}",
        env!("CARGO_MANIFEST_DIR")
    ));
    assert!(p.exists(), "acceptance zip missing: {}", p.display());
    p
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

fn zip_entries(path: &PathBuf) -> BTreeMap<String, Vec<u8>> {
    let file = std::fs::File::open(path).unwrap();
    let mut archive = zip::ZipArchive::new(file).unwrap();
    let mut out = BTreeMap::new();
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).unwrap();
        let name = entry.name().to_string();
        let mut buf = Vec::new();
        entry.read_to_end(&mut buf).unwrap();
        out.insert(name, buf);
    }
    out
}

fn run_pipeline(zip_name: &str) {
    let src = acceptance_zip(zip_name);
    let src_entries = zip_entries(&src);
    let src_attachment_count = src_entries
        .keys()
        .filter(|k| k.starts_with("attachments/"))
        .count();

    let mut store = Store::open_in_memory().unwrap();
    let stats = store.import_backup(&src).unwrap();
    assert_eq!(stats.memos, 2);
    assert_eq!(stats.attachments, src_attachment_count);
    assert_eq!(store.memo_count().unwrap(), 2);
    assert_eq!(store.attachment_count().unwrap(), src_attachment_count);

    // 列表：两条都在
    let memos = store.list_memos().unwrap();
    let titles: Vec<_> = memos.iter().filter_map(|m| m.title.clone()).collect();
    assert!(titles.contains(&"冬日".to_string()));
    assert!(titles.contains(&"实用技巧".to_string()));

    // 检索：正文里取一段 4 字子串（走 FTS trigram）必须命中其备忘
    let text_memo = memos
        .iter()
        .find(|m| m.title.as_deref() == Some("实用技巧"))
        .unwrap();
    let text: Vec<char> = text_memo.plain_text().chars().collect();
    assert!(text.len() >= 8, "sample memo text too short");
    let probe: String = text[2..6].iter().collect();
    let hits = store.search(&probe).unwrap();
    assert!(
        hits.contains(&"aps80a7u".to_string()),
        "search {probe:?} missed, got {hits:?}"
    );
    // 标题词与 2 字短查询（LIKE 回退）也要命中
    assert!(store
        .search("实用技巧")
        .unwrap()
        .contains(&"aps80a7u".to_string()));
    assert!(store
        .search("实用")
        .unwrap()
        .contains(&"aps80a7u".to_string()));
    // 不存在的词不命中
    assert!(store.search("不存在的词组").unwrap().is_empty());

    // 导出并与原包对齐
    let out_path = std::env::temp_dir().join(format!(
        "mynote_export_{}_{}.zip",
        std::process::id(),
        zip_name
    ));
    store.export_backup(&out_path).unwrap();
    let out_entries = zip_entries(&out_path);

    let mut src_memos: Value =
        serde_json::from_slice(&src_entries["memos.json"]).unwrap();
    let mut out_memos: Value =
        serde_json::from_slice(&out_entries["memos.json"]).unwrap();
    // exportedAt 是导出时刻，两边都摘掉再比
    src_memos.as_object_mut().unwrap().remove("exportedAt");
    out_memos.as_object_mut().unwrap().remove("exportedAt");
    assert_eq!(normalize(&src_memos), normalize(&out_memos));

    let src_manifest: Value =
        serde_json::from_slice(&src_entries["manifest.json"]).unwrap();
    let out_manifest: Value =
        serde_json::from_slice(&out_entries["manifest.json"]).unwrap();
    assert_eq!(normalize(&src_manifest), normalize(&out_manifest));

    for (name, bytes) in &src_entries {
        if name.starts_with("attachments/") {
            assert_eq!(
                out_entries.get(name),
                Some(bytes),
                "attachment bytes differ: {name}"
            );
        }
    }
    std::fs::remove_file(&out_path).ok();
}

#[test]
fn real_backup_full_pipeline() {
    run_pipeline("real_backup.zip");
}

#[test]
fn flutter_export_full_pipeline() {
    run_pipeline("flutter_export.zip");
}

#[test]
fn reimport_replaces_instead_of_appending() {
    let mut store = Store::open_in_memory().unwrap();
    store.import_backup(&acceptance_zip("real_backup.zip")).unwrap();
    store
        .import_backup(&acceptance_zip("flutter_export.zip"))
        .unwrap();
    assert_eq!(store.memo_count().unwrap(), 2);
}
