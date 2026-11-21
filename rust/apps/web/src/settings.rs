//! 设置与备份页（对齐原版 components/SettingsView.js、
//! BackupView.js 的文件分工）：设置页、备份页与导入/导出处理。

use dioxus::prelude::*;
use mynote_core::{read_backup_zip, write_backup_zip, BackupFile};
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::JsFuture;

use crate::diag;
use crate::i18n;
use crate::icons;
use crate::idb;

/// 原版文字大小映射（MynoteTokens.fontSizeMap）：小 14 / 中 16 /
/// 大 19（px），存 localStorage sj_fontsize（与原版同键）。
pub(crate) fn font_px(key: &str) -> &'static str {
    match key {
        "small" => "14px",
        "large" => "19px",
        _ => "16px",
    }
}

fn local_get(key: &str) -> Option<String> {
    web_sys::window()
        .and_then(|w| w.local_storage().ok().flatten())
        .and_then(|s| s.get_item(key).ok().flatten())
}

fn local_set(key: &str, val: &str) {
    if let Some(s) = web_sys::window().and_then(|w| w.local_storage().ok().flatten()) {
        let _ = s.set_item(key, val);
    }
}

/// 备份操作历史（原版 BackupView 的「最近操作」，本地保存）。
fn push_history(kind: &str, ok: bool, title: &str) {
    let raw = local_get("mynote_backup_history").unwrap_or_else(|| "[]".to_string());
    let mut arr: Vec<serde_json::Value> =
        serde_json::from_str(&raw).unwrap_or_default();
    arr.insert(
        0,
        serde_json::json!({
            "type": kind,
            "ok": ok,
            "title": title,
            "at": now_iso(),
        }),
    );
    arr.truncate(20);
    if let Ok(s) = serde_json::to_string(&arr) {
        local_set("mynote_backup_history", &s);
    }
    diag::log("BACKUP", &format!("history {kind} ok={ok} {title}"));
}

/// 设置页（原版 SettingsView 逐项复刻）：玻璃返回圆钮 + 紧凑
/// 标题 + 126px 顶距内容；外观（文字大小分段）/ 数据（备份与
/// 恢复；语言、诊断为按用户要求加入的同组入口）/ 关于卡。
#[component]
pub(crate) fn SettingsView(
    mut font_size: Signal<String>,
    on_back: EventHandler<()>,
    on_backup: EventHandler<()>,
    on_language: EventHandler<()>,
    on_diag: EventHandler<()>,
) -> Element {
    let cur_lang_native = i18n::LANGS
        .iter()
        .find(|l| l.code == i18n::current())
        .map(|l| l.native)
        .unwrap_or("");
    let fs = font_size.read().clone();
    rsx! {
        div { class: "page-enter", style: "background:var(--primary-bg);min-height:100vh;",
            button {
                class: "editor-fab left",
                onclick: move |_| on_back.call(()),
                span { dangerous_inner_html: "{icons::back_markup()}" }
            }
            div {
                class: "page-title compact",
                style: "visibility:visible;opacity:1;pointer-events:none;",
                "{i18n::t(\"settings.title\")}"
            }
            div { class: "page-content",
                div { class: "section-header", style: "padding-top:4px;", "{i18n::t(\"settings.appearance\")}" }
                div { class: "list-group",
                    div { class: "swipe-wrapper",
                        div { class: "list-item", style: "cursor:default;",
                            div { class: "item-left",
                                div { class: "item-title",
                                    span { class: "item-title-text", "{i18n::t(\"settings.font_size\")}" }
                                }
                                div { class: "item-meta", "{i18n::t(\"settings.font_note\")}" }
                            }
                            div { class: "seg-row",
                                for (key, label, lfs) in [("small", "settings.font_small", "0.8125rem"), ("medium", "settings.font_medium", "0.9375rem"), ("large", "settings.font_large", "1.0625rem")] {
                                    button {
                                        class: if fs == key { "seg-btn sel" } else { "seg-btn" },
                                        key: "{key}",
                                        style: "font-size:{lfs};",
                                        onclick: move |_| {
                                            local_set("sj_fontsize", key);
                                            font_size.set(key.to_string());
                                            diag::log("SET", &format!("font size {key}"));
                                        },
                                        "{i18n::t(label)}"
                                    }
                                }
                            }
                        }
                    }
                }
                div { class: "page-gap" }
                div { class: "section-header", style: "padding-top:4px;", "{i18n::t(\"settings.data\")}" }
                div { class: "backup-card",
                    div { class: "set-row", onclick: move |_| on_backup.call(()),
                        div { class: "item-left",
                            div { class: "item-title",
                                span { class: "item-title-text", "{i18n::t(\"settings.backup\")}" }
                            }
                            div { class: "item-meta", "{i18n::t(\"settings.backup_meta\")}" }
                        }
                        span { class: "row-chevron", "›" }
                    }
                    div { class: "about-div" }
                    div { class: "set-row", onclick: move |_| on_language.call(()),
                        div { class: "item-left",
                            div { class: "item-title",
                                span { class: "item-title-text", "{i18n::t(\"settings.language\")}" }
                            }
                            div { class: "item-meta", "{cur_lang_native}" }
                        }
                        span { class: "row-chevron", "›" }
                    }
                    div { class: "about-div" }
                    div { class: "set-row", onclick: move |_| on_diag.call(()),
                        div { class: "item-left",
                            div { class: "item-title",
                                span { class: "item-title-text", "{i18n::t(\"settings.diag\")}" }
                            }
                        }
                        span { class: "row-chevron", "›" }
                    }
                }
                div { class: "page-gap" }
                div { class: "section-header", style: "padding-top:4px;", "{i18n::t(\"settings.about\")}" }
                div { class: "backup-card",
                    div { class: "about-row",
                        div { class: "item-title", "{i18n::t(\"settings.version\")}" }
                        span { class: "about-val", "2.2.7" }
                    }
                    div { class: "about-div" }
                    div { class: "about-row",
                        div { class: "item-title", "{i18n::t(\"settings.contact\")}" }
                        span { class: "about-val", style: "font-size:0.85rem;", "overcanopies@gmail.com" }
                    }
                }
                div { class: "settings-footer", "{i18n::t(\"settings.footer\")}" }
            }
        }
    }
}

/// 备份页（原版 BackupView 复刻）：状态总览 hero + 本地备份卡
/// （导出/导入，带确认弹窗）+ Google Drive 卡（未连接态；
/// 云备份方案待定）+ 最近操作。
#[component]
pub(crate) fn BackupView(
    data: Signal<BackupFile>,
    manifest: Signal<String>,
    mut status: Signal<String>,
    gen: Signal<u32>,
    on_back: EventHandler<()>,
) -> Element {
    let memo_count = data.read().memos.len();
    let attach_count = serde_json::from_str::<serde_json::Value>(&manifest.read())
        .ok()
        .and_then(|v| {
            v.get("attachments")
                .and_then(|a| a.as_object())
                .map(|o| o.len())
        })
        .unwrap_or(0);
    let last_backup = local_get("mynote_last_backup").unwrap_or_else(|| i18n::t("backup.never"));
    let history: Vec<serde_json::Value> = local_get("mynote_backup_history")
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default();
    // modal: None | "export" | "import"（导入时已暂存校验过的包）
    let mut modal = use_signal(|| Option::<String>::None);
    let mut pending = use_signal(|| Option::<Vec<u8>>::None);
    let status_text = status.read().clone();

    rsx! {
        div { class: "page-enter", style: "background:var(--primary-bg);min-height:100vh;",
            button {
                class: "editor-fab left",
                onclick: move |_| on_back.call(()),
                span { dangerous_inner_html: "{icons::back_markup()}" }
            }
            div {
                class: "page-title compact",
                style: "visibility:visible;opacity:1;pointer-events:none;",
                "{i18n::t(\"settings.backup\")}"
            }
            div { class: "page-content",
                div { class: "backup-hero",
                    div { class: "backup-hero-top",
                        div { class: "backup-hero-title", "{i18n::t(\"backup.hero_title\")}" }
                        div { class: "backup-hero-badge disconnected", "{i18n::t(\"backup.disconnected\")}" }
                    }
                    div { class: "backup-desc",
                        span { "☁️ Google Drive {i18n::t(\"backup.disconnected\")}" }
                        span { style: "opacity:0.3;", "·" }
                        span { "{i18n::t(\"backup.last\")} {last_backup}" }
                        span { style: "opacity:0.3;", "·" }
                        span { "{memo_count} {i18n::t(\"backup.memos\")} · {attach_count} {i18n::t(\"backup.attachments\")}" }
                    }
                }
                div { class: "backup-card",
                    div {
                        class: "backup-row",
                        onclick: move |_| modal.set(Some("export".to_string())),
                        span { class: "backup-row-icon", dangerous_inner_html: "{crate::icons::export_icon_markup()}" }
                        div { class: "backup-row-left",
                            div { class: "backup-row-title", "{i18n::t(\"backup.export_title\")}" }
                            div { class: "backup-row-desc", "{i18n::t(\"backup.export_desc\")}" }
                        }
                        div { class: "backup-row-right",
                            span { class: "backup-row-arrow", "›" }
                        }
                    }
                    label { class: "backup-row no-border",
                        span { class: "backup-row-icon", dangerous_inner_html: "{crate::icons::import_icon_markup()}" }
                        div { class: "backup-row-left",
                            div { class: "backup-row-title", "{i18n::t(\"backup.import_title\")}" }
                            div { class: "backup-row-desc", "{i18n::t(\"backup.import_desc\")}" }
                        }
                        div { class: "backup-row-right",
                            span { class: "backup-row-arrow", "›" }
                        }
                        input {
                            id: "file-import",
                            r#type: "file",
                            accept: ".zip",
                            style: "display:none",
                            onchange: move |_| {
                                spawn(async move {
                                    if let Some(bytes) = pick_file_bytes().await {
                                        diag::log("IMPORT", &format!("zip {}B staged", bytes.len()));
                                        match read_backup_zip(&bytes) {
                                            Ok(_) => {
                                                pending.set(Some(bytes));
                                                modal.set(Some("import".to_string()));
                                            }
                                            Err(e) => {
                                                diag::log("IMPORT", &format!("validate err: {e}"));
                                                status.set(i18n::tf("status.import_failed", &[("e", &e.to_string())]));
                                            }
                                        }
                                    }
                                });
                            },
                        }
                    }
                }
                div { class: "backup-card",
                    div { class: "backup-row",
                        div { class: "backup-row-left",
                            div { class: "backup-row-title", "{i18n::t(\"backup.drive_title\")}" }
                            div { class: "backup-row-desc", "{i18n::t(\"backup.drive_desc\")}" }
                        }
                        div { class: "backup-state disconnected", "{i18n::t(\"backup.disconnected\")}" }
                    }
                    div { class: "backup-action-bar",
                        button {
                            class: "backup-btn primary",
                            onclick: move |_| {
                                diag::log("BACKUP", "drive connect tapped (pending)");
                                status.set(i18n::t("backup.drive_pending"));
                            },
                            "{i18n::t(\"backup.connect_google\")}"
                        }
                    }
                }
                if !history.is_empty() {
                    div { class: "backup-section-title", "{i18n::t(\"backup.history\")}" }
                    div { class: "backup-card",
                        for (i, h) in history.iter().enumerate() {
                            {
                                let kind = h.get("type").and_then(|v| v.as_str()).unwrap_or("");
                                let kind_label = match kind {
                                    "upload" => i18n::t("backup.kind_upload"),
                                    "export" => i18n::t("backup.kind_export"),
                                    "restore" => i18n::t("backup.kind_restore"),
                                    _ => i18n::t("backup.kind_connect"),
                                };
                                let title = h.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                let at = h.get("at").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                let when = crate::list::time_ago(
                                    &mynote_core::model::Timestamp::Iso(at.clone()),
                                );
                                rsx! {
                                    div {
                                        class: if i + 1 == history.len() { "backup-row no-border" } else { "backup-row" },
                                        key: "{i}",
                                        style: "cursor:default;",
                                        div { class: "backup-row-left",
                                            div { class: "backup-row-title", "{title}" }
                                            div { class: "backup-row-desc", "{kind_label}" }
                                        }
                                        div { class: "backup-row-right", "{when}" }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            if let Some(m) = modal.read().as_ref() {
                div { class: "backup-modal-scrim",
                    div { class: "backup-modal",
                        div { class: "backup-modal-title",
                            if m == "export" { "{i18n::t(\"backup.export_title\")}" } else { "{i18n::t(\"backup.import_title\")}" }
                        }
                        div { class: "backup-modal-msg",
                            if m == "export" { "{i18n::t(\"backup.export_msg\")}" } else { "{i18n::t(\"backup.import_msg\")}" }
                        }
                        div { class: "backup-modal-actions",
                            button {
                                class: "backup-btn secondary",
                                onclick: move |_| {
                                    modal.set(None);
                                    pending.set(None);
                                },
                                "{i18n::t(\"action.cancel\")}"
                            }
                            button {
                                class: "backup-btn primary",
                                onclick: move |_| {
                                    let kind = modal.read().clone();
                                    modal.set(None);
                                    if kind.as_deref() == Some("export") {
                                        let backup = data.read().clone();
                                        let manifest_raw = manifest.read().clone();
                                        spawn(async move {
                                            handle_export(backup, manifest_raw, status).await;
                                        });
                                    } else {
                                        let pend = pending.read().clone();
                                        if let Some(bytes) = pend {
                                            pending.set(None);
                                            spawn(async move {
                                                apply_import(bytes, data, manifest, status, gen).await;
                                            });
                                        }
                                    }
                                },
                                if m == "export" { "{i18n::t(\"backup.confirm_export\")}" } else { "{i18n::t(\"backup.confirm_import\")}" }
                            }
                        }
                    }
                }
            }
            if !status_text.is_empty() {
                div { key: "{status_text}", class: "status-toast", "{status_text}" }
            }
        }
    }
}

/// 确认后执行导入：全量替换（原版恢复语义）。
async fn apply_import(
    bytes: Vec<u8>,
    mut data: Signal<BackupFile>,
    mut manifest: Signal<String>,
    mut status: Signal<String>,
    mut gen: Signal<u32>,
) {
    match read_backup_zip(&bytes) {
        Ok(pkg) => {
            let memos_json = match serde_json::to_string(&pkg.backup) {
                Ok(s) => s,
                Err(e) => {
                    status.set(i18n::tf("status.import_failed", &[("e", &e.to_string())]));
                    return;
                }
            };
            let manifest_raw = String::from_utf8_lossy(&pkg.manifest_raw).into_owned();
            let atts: Vec<(String, Vec<u8>)> =
                pkg.attachments.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
            let (n, m) = (pkg.backup.memos.len(), atts.len());
            if let Err(e) = idb::save_all(&memos_json, &manifest_raw, &atts).await {
                status.set(i18n::tf("status.import_failed", &[("e", &format!("{e:?}"))]));
                return;
            }
            data.set(pkg.backup.clone());
            manifest.set(manifest_raw);
            gen.set(gen() + 1);
            diag::log("IMPORT", &format!("ok memos={n} atts={m}"));
            push_history("restore", true, &i18n::t("backup.import_title"));
            status.set(i18n::tf("status.imported", &[("n", &n.to_string()), ("m", &m.to_string())]));
        }
        Err(e) => {
            diag::log("IMPORT", &format!("err: {e}"));
            status.set(i18n::tf("status.import_failed", &[("e", &e.to_string())]));
        }
    }
}

async fn handle_export(
    mut backup: BackupFile,
    manifest_raw: String,
    mut status: Signal<String>,
) {
    backup.exported_at = Some(serde_json::Value::String(now_iso()));
    let atts = idb::get_all_attachments().await;
    let att_map: std::collections::BTreeMap<String, Vec<u8>> = atts.into_iter().collect();
    match write_backup_zip(&backup, manifest_raw.as_bytes(), &att_map) {
        Ok(bytes) => {
            diag::log("EXPORT", &format!("ok {}B atts={}", bytes.len(), att_map.len()));
            // 原版口径：优先系统分享面板，不支持/失败才回退
            // 下载；用户在分享面板取消则两者都不做
            match try_share_zip(&bytes).await {
                ShareOutcome::Shared => {
                    local_set("mynote_last_backup", &now_iso());
                    push_history("export", true, &i18n::t("status.shared"));
                    status.set(i18n::t("status.shared"));
                }
                ShareOutcome::Cancelled => {
                    diag::log("EXPORT", "share cancelled by user");
                }
                ShareOutcome::Fallback => {
                    download_zip(&bytes);
                    local_set("mynote_last_backup", &now_iso());
                    push_history("export", true, &i18n::t("backup.export_title"));
                    status.set(i18n::t("status.exported"));
                }
            }
        }
        Err(e) => {
            diag::log("EXPORT", &format!("err: {e}"));
            status.set(i18n::tf("status.export_failed", &[("e", &e.to_string())]));
        }
    }
}

async fn pick_file_bytes() -> Option<Vec<u8>> {
    let window = web_sys::window()?;
    let doc = window.document()?;
    let input: web_sys::HtmlInputElement = doc.get_element_by_id("file-import")?.dyn_into().ok()?;
    let file = input.files()?.get(0)?;
    let buf = JsFuture::from(file.array_buffer()).await.ok()?;
    let arr = js_sys::Uint8Array::new(&buf);
    let bytes = arr.to_vec();
    input.set_value("");
    Some(bytes)
}

fn now_iso() -> String {
    js_sys::Date::new_0().to_iso_string().as_string().unwrap_or_default()
}

enum ShareOutcome {
    Shared,
    Cancelled,
    Fallback,
}

/// 系统分享：字节 → Blob URL → JS fetch 转 File → canShare
/// 判定 → navigator.share。返回 shared/cancelled/fallback。
async fn try_share_zip(bytes: &[u8]) -> ShareOutcome {
    let Some(window) = web_sys::window() else {
        return ShareOutcome::Fallback;
    };
    let Some(_doc) = window.document() else {
        return ShareOutcome::Fallback;
    };
    let arr = js_sys::Uint8Array::from(bytes);
    let parts = js_sys::Array::new();
    parts.push(&arr);
    let opts = web_sys::BlobPropertyBag::new();
    opts.set_type("application/zip");
    let Ok(blob) = web_sys::Blob::new_with_u8_array_sequence_and_options(&parts, &opts) else {
        return ShareOutcome::Fallback;
    };
    let Ok(url) = web_sys::Url::create_object_url_with_blob(&blob) else {
        return ShareOutcome::Fallback;
    };
    let js = format!(
        "(async () => {{ try {{ if (!navigator.share || !navigator.canShare) {{ dioxus.send('fallback'); return; }} const r = await fetch('{url}'); const b = await r.blob(); const f = new File([b], 'mynote-backup.zip', {{ type: 'application/zip' }}); if (!navigator.canShare({{ files: [f] }})) {{ dioxus.send('fallback'); return; }} await navigator.share({{ files: [f] }}); dioxus.send('shared'); }} catch (e) {{ dioxus.send(e && e.name === 'AbortError' ? 'cancelled' : 'fallback'); }} }})();"
    );
    let mut eval = dioxus::document::eval(&js);
    let outcome = match eval.recv::<String>().await {
        Ok(v) if v == "shared" => ShareOutcome::Shared,
        Ok(v) if v == "cancelled" => ShareOutcome::Cancelled,
        _ => ShareOutcome::Fallback,
    };
    let _ = web_sys::Url::revoke_object_url(&url);
    outcome
}

fn download_zip(bytes: &[u8]) {
    let Some(window) = web_sys::window() else { return };
    let Some(doc) = window.document() else { return };
    let arr = js_sys::Uint8Array::from(bytes);
    let parts = js_sys::Array::new();
    parts.push(&arr);
    let opts = web_sys::BlobPropertyBag::new();
    opts.set_type("application/zip");
    let Ok(blob) = web_sys::Blob::new_with_u8_array_sequence_and_options(&parts, &opts) else {
        return;
    };
    let Ok(url) = web_sys::Url::create_object_url_with_blob(&blob) else {
        return;
    };
    if let Ok(el) = doc.create_element("a") {
        let a: web_sys::HtmlAnchorElement = el.unchecked_into();
        a.set_href(&url);
        a.set_download("mynote-backup.zip");
        a.click();
    }
    let _ = web_sys::Url::revoke_object_url(&url);
}
