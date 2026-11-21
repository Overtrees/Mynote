//! Web 持久层：IndexedDB（库 mynote-web）。
//! - kv 店：memos_json（BackupFile 序列化）、manifest_raw（原文）
//! - attachments 店：id → 字节（Uint8Array）
//! 导入语义与原生端一致：包先经 core 完整校验，落库只是全量
//! 替换；单请求各开一个事务，顺序 await（W1 规模下足够，
//! 跨店原子性留待后续阶段）。

use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;
use web_sys::{
    IdbDatabase, IdbObjectStore, IdbOpenDbRequest, IdbRequest, IdbTransactionMode,
};

const DB_NAME: &str = "mynote-web";
const KV: &str = "kv";
const ATT: &str = "attachments";

fn request_promise(req: &IdbRequest) -> js_sys::Promise {
    let req = req.clone();
    js_sys::Promise::new(&mut |resolve, reject| {
        let r1 = req.clone();
        let onsuccess = Closure::once_into_js(move |_: JsValue| {
            let _ = resolve.call1(&JsValue::UNDEFINED, &r1.result().unwrap_or_default());
        });
        let r2 = req.clone();
        let onerror = Closure::once_into_js(move |_: JsValue| {
            let err = r2
                .error()
                .ok()
                .flatten()
                .map(JsValue::from)
                .unwrap_or_default();
            let _ = reject.call1(&JsValue::UNDEFINED, &err);
        });
        req.set_onsuccess(Some(onsuccess.unchecked_ref()));
        req.set_onerror(Some(onerror.unchecked_ref()));
    })
}

async fn await_req(req: &IdbRequest) -> Result<JsValue, JsValue> {
    JsFuture::from(request_promise(req)).await
}

async fn open_db() -> Result<IdbDatabase, JsValue> {
    let window = web_sys::window().ok_or_else(|| JsValue::from_str("no window"))?;
    let factory = window
        .indexed_db()?
        .ok_or_else(|| JsValue::from_str("no indexeddb"))?;
    let req: IdbOpenDbRequest = factory.open_with_u32(DB_NAME, 1)?.unchecked_into();
    let onup = Closure::once_into_js(move |e: web_sys::Event| {
        let target = e.target().expect("upgrade event target");
        let open_req: IdbOpenDbRequest = target.unchecked_into();
        let db: IdbDatabase = open_req.result().expect("db on upgrade").unchecked_into();
        if !db.object_store_names().contains(KV) {
            db.create_object_store(KV).expect("create kv store");
        }
        if !db.object_store_names().contains(ATT) {
            db.create_object_store(ATT).expect("create attachments store");
        }
    });
    req.set_onupgradeneeded(Some(onup.unchecked_ref()));
    let result = await_req(req.as_ref()).await?;
    Ok(result.unchecked_into())
}

fn store(db: &IdbDatabase, name: &str, mode: IdbTransactionMode) -> Result<IdbObjectStore, JsValue> {
    Ok(db.transaction_with_str_and_mode(name, mode)?.object_store(name)?)
}

async fn kv_get(db: &IdbDatabase, key: &str) -> Result<Option<String>, JsValue> {
    let s = store(db, KV, IdbTransactionMode::Readonly)?;
    let v = await_req(&s.get(&JsValue::from_str(key))?).await?;
    Ok(if v.is_undefined() || v.is_null() {
        None
    } else {
        v.as_string()
    })
}

async fn kv_put(db: &IdbDatabase, key: &str, value: &str) -> Result<(), JsValue> {
    let s = store(db, KV, IdbTransactionMode::Readwrite)?;
    await_req(&s.put_with_key(&JsValue::from_str(value), &JsValue::from_str(key))?).await?;
    Ok(())
}

/// 启动时读回持久状态：(memos_json, manifest_raw)。
pub async fn load_state() -> Option<(String, String)> {
    let db = open_db().await.ok()?;
    let memos = kv_get(&db, "memos_json").await.ok()??;
    let manifest = kv_get(&db, "manifest_raw").await.ok()?.unwrap_or_default();
    Some((memos, manifest))
}

/// 全量替换落库（导入成功后调用；包此前已经 core 校验）。
pub async fn save_all(
    memos_json: &str,
    manifest_raw: &str,
    attachments: &[(String, Vec<u8>)],
) -> Result<(), JsValue> {
    let db = open_db().await?;
    kv_put(&db, "memos_json", memos_json).await?;
    kv_put(&db, "manifest_raw", manifest_raw).await?;
    let s = store(&db, ATT, IdbTransactionMode::Readwrite)?;
    await_req(&s.clear()?).await?;
    for (id, bytes) in attachments {
        let arr = js_sys::Uint8Array::from(bytes.as_slice());
        await_req(&s.put_with_key(&arr, &JsValue::from_str(id))?).await?;
    }
    crate::diag::log(
        "IDB",
        &format!(
            "save_all ok memos_json={}B atts={}",
            memos_json.len(),
            attachments.len()
        ),
    );
    Ok(())
}

/// 只更新备忘 JSON（编辑保存用，W2 起）。
pub async fn save_memos(memos_json: &str) -> Result<(), JsValue> {
    let db = open_db().await?;
    kv_put(&db, "memos_json", memos_json).await
}

pub async fn get_attachment(id: &str) -> Option<Vec<u8>> {
    let db = open_db().await.ok()?;
    let s = store(&db, ATT, IdbTransactionMode::Readonly).ok()?;
    let v = await_req(&s.get(&JsValue::from_str(id)).ok()?).await.ok()?;
    if v.is_undefined() || v.is_null() {
        return None;
    }
    let arr: js_sys::Uint8Array = v.unchecked_into();
    Some(arr.to_vec())
}

pub async fn get_all_attachments() -> Vec<(String, Vec<u8>)> {
    let mut out = Vec::new();
    let Ok(db) = open_db().await else { return out };
    let Ok(s) = store(&db, ATT, IdbTransactionMode::Readonly) else {
        return out;
    };
    let Ok(keys_v) = await_req(&s.get_all_keys().unwrap()).await else {
        return out;
    };
    let keys = js_sys::Array::from(&keys_v);
    for k in keys.iter() {
        if let Some(id) = k.as_string() {
            if let Ok(v) = await_req(&s.get(&k).unwrap()).await {
                if !v.is_undefined() && !v.is_null() {
                    let arr: js_sys::Uint8Array = v.unchecked_into();
                    out.push((id, arr.to_vec()));
                }
            }
        }
    }
    out
}

/// 附件字节 → Blob 对象 URL（图片/音视频渲染与下载共用）。
pub fn blob_url(bytes: &[u8]) -> Option<String> {
    let arr = js_sys::Uint8Array::from(bytes);
    let parts = js_sys::Array::new();
    parts.push(&arr);
    let blob = web_sys::Blob::new_with_u8_array_sequence(&parts).ok()?;
    web_sys::Url::create_object_url_with_blob(&blob).ok()
}

/// 写入单个附件（编辑器添加附件用，不动其他数据）。
pub async fn put_attachment(id: &str, bytes: &[u8]) -> Result<(), JsValue> {
    let db = open_db().await?;
    let s = store(&db, ATT, IdbTransactionMode::Readwrite)?;
    let arr = js_sys::Uint8Array::from(bytes);
    await_req(&s.put_with_key(&arr, &JsValue::from_str(id))?).await?;
    crate::diag::log("IDB", &format!("put_attachment {id} {}B", bytes.len()));
    Ok(())
}

/// 只更新 manifest（添加附件后同步附件索引）。
pub async fn save_manifest(manifest_raw: &str) -> Result<(), JsValue> {
    let db = open_db().await?;
    kv_put(&db, "manifest_raw", manifest_raw).await
}
