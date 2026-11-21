//! 块渲染（只读路径与编辑器共用）：DOM 结构与类名对原版
//! editor.css / editor-shell.css 的阅读态规则——段落/标题/引用/
//! 待办（圆形勾选）/Callout 变体/链接卡 lkc/图文卡/附件文件卡等。

use dioxus::prelude::*;
use mynote_core::{split_highlight, Node};

use crate::idb;

/// 灯箱上下文：图片点击 → 全屏查看（编辑器根提供）。
#[derive(Clone, Copy)]
pub struct Lightbox(pub Signal<Option<String>>);

/// 图文面板上下文：图文卡/图文混排的文本点击 → 打开完整文本面板。
#[derive(Clone, Copy)]
pub struct TextSheet(pub Signal<Option<(String, String)>>);

/// md 源段落编辑态：值为正在编辑源码的块 id（原版点预览回
/// 源码段落编辑、失焦回预览的模型）。编辑器根提供。
#[derive(Clone, Copy)]
pub struct MdEdit(pub Signal<Option<String>>);

/// 卡片重试上下文：音乐卡 error 态的「重试」按钮 → 编辑器根
/// 收到块 id 后走 loading → 拉取元数据 → ready/error（原版
/// retryMusicCard）。编辑器根提供。
#[derive(Clone, Copy)]
pub struct CardRetry(pub Signal<Option<String>>);

/// 原子块选中态：原版是单一 contenteditable，点原子块只有原生
/// 选区；本应用是分块架构，选中态承载原版的边缘点击语义与块
/// 操作入口（删除/换图/设链接只在选中后出现，不常驻）。编辑
/// 器根提供。
#[derive(Clone, Copy)]
pub struct SelBlock(pub Signal<Option<String>>);

/// Wiki 导航上下文：md 预览里的 wiki 链接点击 → 编辑器根收到
/// target 原文后先落盘当前编辑、再调 on_open_wiki 导航（原版
/// 「双链优先导航」：此路径优先于点预览回源码编辑）。编辑器
/// 根提供。
#[derive(Clone, Copy)]
pub struct WikiNav(pub Signal<Option<String>>);

/// encodeURIComponent 等价的百分号编码。
pub fn url_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 2);
    for &b in s.as_bytes() {
        let c = b as char;
        if c.is_ascii_alphanumeric() || "-_.!~*'()".contains(c) {
            out.push(c);
        } else {
            out.push_str(&format!("%{:02X}", b));
        }
    }
    out
}

/// 封面代理（原版 proxyImg）：QQ 音乐封面升分辨率后一律走
/// Worker /img 代理。
pub fn proxy_img(url: &str) -> String {
    if url.is_empty() {
        return String::new();
    }
    let mut u = url.to_string();
    if u.contains("y.gtimg.cn/music/photo_new/T002R") {
        if let Some(pos) = u.find("T002R") {
            let rest = &u[pos + 5..];
            if let Some(end) = rest.find(|c: char| !c.is_ascii_alphanumeric()) {
                u = format!("{}T002R800x800{}", &u[..pos], &rest[end..]);
            }
        }
    }
    format!(
        "https://mynote.overtrees.workers.dev/img?url={}",
        url_encode(&u)
    )
}

/// 卡片来源图标（原版 getTypeIcon）。
pub fn type_icon(meta_type: Option<&str>) -> &'static str {
    match meta_type {
        Some("music") => "🎵",
        Some("video") => "🎬",
        _ => "🔗",
    }
}

/// URL 主机名（原版 new URL().hostname 并去掉 www. 前缀；
/// 解析失败返回空串，调用方回退到完整 URL）。
pub fn host_of(url: &str) -> String {
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .unwrap_or(url);
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host = host.rsplit('@').next().unwrap_or(host);
    let host = host.split(':').next().unwrap_or(host);
    host.strip_prefix("www.").unwrap_or(host).to_string()
}

fn extra_str<'a>(node: &'a Node, key: &str) -> Option<&'a str> {
    node.extra.get(key).and_then(|v| v.as_str())
}

fn extra_bool(node: &Node, key: &str) -> bool {
    node.extra
        .get(key)
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

/// 原版字段位置（use-slash.js 节点工厂实证）：heading 的 level、
/// todo 的 checked、gallery 的 items 都在 attrs 里，不在顶层。
/// 读取一律 attrs 优先、顶层兜底（兼容本应用旧版本写出的顶层形）。
fn attrs_get<'a>(node: &'a Node, key: &str) -> Option<&'a serde_json::Value> {
    node.extra.get("attrs").and_then(|a| a.get(key))
}

pub fn heading_level(node: &Node) -> i64 {
    attrs_get(node, "level")
        .and_then(|v| v.as_i64())
        .or_else(|| node.extra.get("level").and_then(|v| v.as_i64()))
        .unwrap_or(1)
        .clamp(1, 4)
}

pub fn todo_checked(node: &Node) -> bool {
    attrs_get(node, "checked")
        .and_then(|v| v.as_bool())
        .unwrap_or_else(|| extra_bool(node, "checked"))
}

pub fn gallery_items(node: &Node) -> Vec<String> {
    if let Some(items) = attrs_get(node, "items").and_then(|v| v.as_array()) {
        return items
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();
    }
    kids_of(node).iter().filter_map(|k| file_id(k)).collect()
}

fn file_id(node: &Node) -> Option<String> {
    if let Some(fid) = extra_str(node, "fileId") {
        return Some(fid.to_string());
    }
    node.extra
        .get("attrs")
        .and_then(|a| a.get("fileId"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

/// 行内高亮切分与 core 共用一份（split_highlight）：高亮以字面
/// == 存在文本里，渲染时成 mark。

/// 行内节点渲染：语义标签（strong/em/u/s/code/a）+ 高亮 mark。
#[component]
pub fn Inlines(nodes: Vec<Node>) -> Element {
    rsx! {
        for (i, node) in nodes.iter().enumerate() {
            InlineNode { node: node.clone(), key: "{i}" }
        }
    }
}

#[component]
fn InlineNode(node: Node) -> Element {
    if node.node_type.as_deref() == Some("link") {
        let url = extra_str(&node, "url").unwrap_or("").to_string();
        let kids = node.children.clone().unwrap_or_default();
        return rsx! {
            a { href: "{url}", target: "_blank", rel: "noreferrer",
                Inlines { nodes: kids }
            }
        };
    }
    let text = node.text.clone().unwrap_or_default();
    let b = extra_bool(&node, "bold");
    let i = extra_bool(&node, "italic");
    let u = extra_bool(&node, "underline");
    let s = extra_bool(&node, "strikethrough") || extra_bool(&node, "strike");
    let code = extra_bool(&node, "code");
    rsx! {
        for (idx, (hi, seg)) in split_highlight(&text).into_iter().enumerate() {
            {
                let inner = rsx! { "{seg}" };
                let inner = if code { rsx! { code { {inner} } } } else { inner };
                let inner = if s { rsx! { s { {inner} } } } else { inner };
                let inner = if u { rsx! { u { {inner} } } } else { inner };
                let inner = if i { rsx! { em { {inner} } } } else { inner };
                let inner = if b { rsx! { strong { {inner} } } } else { inner };
                rsx! {
                    if hi {
                        mark { class: "mynote-highlight", key: "h{idx}", {inner} }
                    } else {
                        span { key: "t{idx}", {inner} }
                    }
                }
            }
        }
    }
}

fn kids_of(node: &Node) -> Vec<Node> {
    node.children.clone().unwrap_or_default()
}

/// 附件媒体：从 IndexedDB 取字节生成 Blob URL 后渲染图片，
/// 点击打开灯箱（原版图片点击行为）。
#[component]
pub fn BlobMedia(file_id: String, gen: Signal<u32>, kind: String) -> Element {
    let mut url = use_signal(|| Option::<String>::None);
    let fid = file_id.clone();
    use_effect(move || {
        let fid = fid.clone();
        spawn(async move {
            if let Some(bytes) = idb::get_attachment(&fid).await {
                url.set(idb::blob_url(&bytes));
            } else {
                crate::diag::log_once(
                    &format!("att-missing-{fid}"),
                    "ATT",
                    &format!("attachment {fid} not in IDB"),
                );
            }
        });
    });
    let _ = gen.read();
    let lightbox = try_use_context::<Lightbox>();
    let url_state = url.read().clone();
    match url_state.as_ref() {
        Some(u) => {
            let u = u.clone();
            if kind == "video" {
                rsx! { video { class: "blk-media", controls: true, src: "{u}" } }
            } else if kind == "audio" {
                rsx! { audio { class: "blk-media", controls: true, src: "{u}" } }
            } else {
                let u2 = u.clone();
                rsx! {
                    img {
                        class: "blk-media",
                        src: "{u}",
                        onclick: move |_| {
                            if let Some(lb) = lightbox {
                                let mut s = lb.0;
                                s.set(Some(u2.clone()));
                            }
                        },
                    }
                }
            }
        }
        None => rsx! { div { class: "atomic-placeholder", "{crate::i18n::t(\"media.loading\")}" } },
    }
}

fn callout_variant(node: &Node) -> &'static str {
    let raw = extra_str(node, "calloutType")
        .or_else(|| extra_str(node, "kind"))
        .or_else(|| extra_str(node, "variant"))
        .unwrap_or("note")
        .to_lowercase();
    match raw.as_str() {
        "warning" => "warning",
        "tip" => "tip",
        "important" => "important",
        "caution" => "caution",
        _ => "note",
    }
}

fn img_text_of(node: &Node) -> String {
    extra_str(node, "text")
        .or_else(|| extra_str(node, "caption"))
        .map(|s| s.to_string())
        .unwrap_or_else(|| node.plain_text())
}

/// 单块只读渲染（编辑器的非文本块与预览共用）。
#[component]
pub fn BlockView(node: Node, gen: Signal<u32>) -> Element {
    let ty = node.node_type.clone().unwrap_or_else(|| "paragraph".to_string());
    let kids = kids_of(&node);
    match ty.as_str() {
        "paragraph" => {
            // md 源段落（代码/列表/Callout）走预览渲染，与原版一致
            let plain = node.plain_text();
            if md_classify(&plain).is_some() {
                rsx! { MdPreview { text: plain } }
            } else {
                rsx! { div { class: "blk-p", Inlines { nodes: kids } } }
            }
        }
        "heading" => {
            let lv = heading_level(&node);
            let cls = format!("blk-h{lv}");
            rsx! { div { class: "{cls}", Inlines { nodes: kids } } }
        }
        "quote" => rsx! { div { class: "blk-quote", Inlines { nodes: kids } } },
        "todo" => {
            let checked = todo_checked(&node);
            rsx! {
                div { class: if checked { "todo-row done" } else { "todo-row" },
                    span { class: if checked { "todo-checkbox on" } else { "todo-checkbox" } }
                    div { class: "todo-text", Inlines { nodes: kids } }
                }
            }
        }
        "divider" => rsx! { hr { class: "blk-hr" } },
        "callout" => {
            let variant = callout_variant(&node);
            let (icon, title_key) = match variant {
                "warning" => ("⚠", "callout.warning"),
                "tip" => ("💡", "callout.tip"),
                "important" => ("❗", "callout.important"),
                "caution" => ("⛔", "callout.caution"),
                _ => ("ℹ", "callout.note"),
            };
            rsx! {
                div { class: "callout callout-{variant}",
                    div { class: "callout-header",
                        span { class: "callout-icon", "{icon}" }
                        span { class: "callout-title", "{crate::i18n::t(title_key)}" }
                    }
                    div { class: "callout-body", Inlines { nodes: kids } }
                }
            }
        }
        "codeBlock" | "code" => {
            let text = node.plain_text();
            rsx! { pre { class: "blk-code", "{text}" } }
        }
        "bulleted-list" | "numbered-list" => {
            let ordered = ty == "numbered-list";
            rsx! {
                div { class: "list-wrap",
                    for (i, item) in kids.iter().enumerate() {
                        div { class: "list-row", key: "{i}",
                            span { class: "list-marker", if ordered { "{i + 1}." } else { "•" } }
                            div { style: "flex:1;min-width:0;", Inlines { nodes: kids_of(item) } }
                        }
                    }
                }
            }
        }
        "image" => {
            if let Some(fid) = file_id(&node) {
                rsx! {
                    div { class: "atomic", "data-type": "image",
                        BlobMedia { file_id: fid, gen, kind: "image".to_string() }
                    }
                }
            } else if let Some(url) = extra_str(&node, "url") {
                let url = url.to_string();
                rsx! { div { class: "atomic", "data-type": "image", img { src: "{url}" } } }
            } else {
                rsx! { div { class: "atomic-placeholder", "{crate::i18n::t(\"media.image_no_id\")}" } }
            }
        }
        "gallery" => {
            let items: Vec<String> = gallery_items(&node);
            if items.is_empty() {
                rsx! { div { class: "atomic-placeholder", "{crate::i18n::t(\"media.gallery_empty\")}" } }
            } else {
                rsx! {
                    div { class: "atomic", "data-type": "gallery",
                        div { class: "gallery-grid",
                            for fid in items {
                                BlobMedia { file_id: fid, gen, kind: "image".to_string(), key: "{fid}" }
                            }
                        }
                    }
                }
            }
        }
        "video" => {
            if let Some(fid) = file_id(&node) {
                rsx! { div { class: "atomic", "data-type": "video", BlobMedia { file_id: fid, gen, kind: "video".to_string() } } }
            } else if let Some(url) = extra_str(&node, "url") {
                let url = url.to_string();
                rsx! { div { class: "atomic", "data-type": "video", video { controls: true, src: "{url}" } } }
            } else {
                rsx! { div { class: "atomic-placeholder", "{crate::i18n::t(\"media.video_no_src\")}" } }
            }
        }
        "music" | "musicCard" => {
            // 状态机逐项对原版 renderAtomicHTMLUnsafe 的 musicCard
            // 分支：input 胶囊 → ready 卡 → loading 骨架（同形：
            // 封面 2.4/1 + 三行骨架 + 转圈）→ error 卡（🎵+链接+
            // 重试）→ 兜底胶囊。带 fileId 的是音频附件走文件行。
            let url = extra_str(&node, "url").unwrap_or("").to_string();
            let status = extra_str(&node, "status").unwrap_or("").to_string();
            let meta = node.extra.get("meta").cloned().unwrap_or(serde_json::Value::Null);
            let mtitle = meta.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if file_id(&node).is_some() {
                let name = extra_str(&node, "name")
                    .or_else(|| extra_str(&node, "title"))
                    .unwrap_or("")
                    .to_string();
                let fid_open = file_id(&node).unwrap_or_default();
                rsx! {
                    div { class: "attachment-file",
                        onclick: move |_| {
                            let fid = fid_open.clone();
                            spawn(async move {
                                if let Some(bytes) = crate::idb::get_attachment(&fid).await {
                                    if let Some(u) = crate::idb::blob_url(&bytes) {
                                        if let Some(w) = web_sys::window() {
                                            let _ = w.open_with_url_and_target(&u, "_blank");
                                        }
                                    }
                                }
                                crate::diag::log("ATT", &format!("open music file {fid}"));
                            });
                        },
                        span { class: "att-icon", "🎵" }
                        span { class: "att-name", if name.is_empty() { "{url}" } else { "{name}" } }
                        span { class: "att-hint", "{crate::i18n::t(\"media.music\")}" }
                    }
                }
            } else if status == "input" {
                rsx! {
                    div { class: "music-input-pill", "{crate::i18n::t(\"media.music_paste_hint\")}" }
                }
            } else if !mtitle.is_empty() {
                let cover_raw = meta.get("cover").and_then(|v| v.as_str()).unwrap_or("");
                let cover = proxy_img(cover_raw);
                let subtitle = meta.get("subtitle").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let source = meta.get("source").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let shown_source = if source.is_empty() { crate::i18n::t("media.music") } else { source };
                rsx! {
                    a { class: "link-card-block music-card-link", href: "{url}", target: "_blank", rel: "noreferrer",
                        if !cover.is_empty() {
                            div { class: "lkc-cover", img { src: "{cover}" } }
                        }
                        div { class: if cover.is_empty() { "lkc-body" } else { "lkc-body has-cover" },
                            div { class: "lkc-title", "{mtitle}" }
                            if !subtitle.is_empty() {
                                div { class: "lkc-subtitle", "{subtitle}" }
                            }
                            div { class: "lkc-source",
                                span { class: "lkc-source-icon", "🎵" }
                                span { class: "lkc-source-dot" }
                                span { class: "lkc-source-text", "{shown_source}" }
                            }
                        }
                    }
                }
            } else if status == "loading" && !url.is_empty() {
                rsx! {
                    div { class: "link-card-skeleton",
                        div { class: "link-card-skeleton-cover" }
                        div { class: "link-card-skeleton-body",
                            div { class: "link-card-skeleton-line", style: "width:75%" }
                            div { class: "link-card-skeleton-line", style: "width:50%" }
                            div { class: "link-card-skeleton-line", style: "width:35%" }
                        }
                    }
                }
            } else if status == "error" && !url.is_empty() {
                let retry = try_use_context::<CardRetry>();
                let bid = node.id.clone().unwrap_or_default();
                rsx! {
                    div { class: "link-card-block music-card-error",
                        span { class: "music-card-error-icon", "🎵" }
                        a { class: "music-card-error-url music-card-link", href: "{url}", target: "_blank", rel: "noreferrer", "{url}" }
                        if let Some(rt) = retry {
                            button {
                                class: "music-card-retry",
                                onclick: move |_| {
                                    let mut s = rt.0;
                                    s.set(Some(bid.clone()));
                                },
                                "{crate::i18n::t(\"media.retry\")}"
                            }
                        }
                    }
                }
            } else if !url.is_empty() {
                rsx! {
                    a { class: "link-card-block music-card-error music-card-link music-pill", href: "{url}", target: "_blank", rel: "noreferrer",
                        span { "🎵" }
                        span { "{url}" }
                        if status == "error" {
                            span { class: "lkc-source-text", "{crate::i18n::t(\"media.preview_unavailable\")}" }
                        }
                    }
                }
            } else {
                rsx! {
                    div { class: "music-pill",
                        span { "🎵" }
                        span { "{crate::i18n::t(\"media.music_click_hint\")}" }
                    }
                }
            }
        }
        "attachment" => {
            let is_image = extra_bool(&node, "image");
            if let Some(fid) = file_id(&node) {
                if is_image {
                    rsx! {
                        div { class: "atomic attachment",
                            BlobMedia { file_id: fid, gen, kind: "image".to_string() }
                        }
                    }
                } else {
                    let name = extra_str(&node, "name").unwrap_or("").to_string();
                    let fid_open = fid.clone();
                    rsx! {
                        div { class: "attachment-file",
                            onclick: move |_| {
                                let fid = fid_open.clone();
                                spawn(async move {
                                    if let Some(bytes) = crate::idb::get_attachment(&fid).await {
                                        if let Some(u) = crate::idb::blob_url(&bytes) {
                                            if let Some(w) = web_sys::window() {
                                                let _ = w.open_with_url_and_target(&u, "_blank");
                                            }
                                        }
                                    }
                                    crate::diag::log("ATT", &format!("open attachment {fid}"));
                                });
                            },
                            span { class: "att-icon", "📎" }
                            span { class: "att-name", if name.is_empty() { "{crate::i18n::t(\"media.attachment\")}" } else { "{name}" } }
                            span { class: "att-hint", "{crate::i18n::t(\"media.open\")}" }
                        }
                    }
                }
            } else {
                rsx! { div { class: "atomic-placeholder", "{crate::i18n::t(\"media.att_no_id\")}" } }
            }
        }
        "link-card" => {
            // 逐项对原版 renderAtomicHTMLUnsafe 的 link-card 分支：
            // 无 meta.title → link-card-err（div，标题=主机名，
            // 来源行=完整 URL）；有标题 → ready 卡（字段以渲染器
            // 口径为准：subtitle/source/cover/type，旧字段兜底；
            // 哔哩哔哩不显示副标题；封面走 proxyImg）。
            let url = extra_str(&node, "url").unwrap_or("").to_string();
            let meta = node.extra.get("meta").cloned().unwrap_or(serde_json::Value::Null);
            let title = meta
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let host = host_of(&url);
            let status = extra_str(&node, "status").unwrap_or("");
            if status == "loading" && title.is_empty() {
                rsx! {
                    div { class: "link-card-skeleton",
                        div { class: "link-card-skeleton-cover" }
                        div { class: "link-card-skeleton-body",
                            div { class: "link-card-skeleton-line", style: "width:75%" }
                            div { class: "link-card-skeleton-line", style: "width:50%" }
                            div { class: "link-card-skeleton-line", style: "width:35%" }
                        }
                    }
                }
            } else if title.is_empty() {
                let shown = if host.is_empty() { url.clone() } else { host.clone() };
                rsx! {
                    a { class: "atomic link-card-err", href: "{url}", target: "_blank", rel: "noreferrer",
                        div { class: "lkc-body",
                            div { class: "lkc-title", "{shown}" }
                            div { class: "lkc-source",
                                span { class: "lkc-source-icon", "🔗" }
                                span { class: "lkc-source-dot" }
                                span { class: "lkc-source-text", "{url}" }
                            }
                        }
                    }
                }
            } else {
                let subtitle = meta
                    .get("subtitle")
                    .and_then(|v| v.as_str())
                    .or_else(|| meta.get("description").and_then(|v| v.as_str()))
                    .unwrap_or("")
                    .to_string();
                let cover_raw = meta
                    .get("cover")
                    .and_then(|v| v.as_str())
                    .or_else(|| meta.get("image").and_then(|v| v.as_str()))
                    .unwrap_or("");
                let cover = proxy_img(cover_raw);
                let source = meta
                    .get("source")
                    .and_then(|v| v.as_str())
                    .or_else(|| meta.get("siteName").and_then(|v| v.as_str()))
                    .unwrap_or("")
                    .to_string();
                let shown_source = if !source.is_empty() {
                    source
                } else if !host.is_empty() {
                    host
                } else {
                    String::new()
                };
                let icon = type_icon(meta.get("type").and_then(|v| v.as_str()));
                let is_bilibili = shown_source == "哔哩哔哩"
                    || (meta.get("type").and_then(|v| v.as_str()) == Some("video")
                        && (url.contains("bilibili") || url.contains("b23.tv")));
                rsx! {
                    a { class: "link-card-block", href: "{url}", target: "_blank", rel: "noreferrer",
                        if !cover.is_empty() {
                            div { class: "lkc-cover", img { src: "{cover}" } }
                        }
                        div { class: if cover.is_empty() { "lkc-body" } else { "lkc-body has-cover" },
                            div { class: "lkc-title", "{title}" }
                            if !subtitle.is_empty() && !is_bilibili {
                                div { class: "lkc-subtitle", "{subtitle}" }
                            }
                            div { class: "lkc-source",
                                span { class: "lkc-source-icon", "{icon}" }
                                span { class: "lkc-source-dot" }
                                span { class: "lkc-source-text", "{shown_source}" }
                            }
                        }
                    }
                }
            }
        }
        "imgTextCard" => {
            let text = img_text_of(&node);
            let sheet = try_use_context::<TextSheet>();
            let fid = file_id(&node);
            let text2 = text.clone();
            rsx! {
                div { class: "img-text-card",
                    div { class: "itc-img-wrap",
                        if let Some(fid) = fid {
                            BlobMedia { file_id: fid, gen, kind: "image".to_string() }
                        }
                    }
                    div {
                        class: "itc-text",
                        onclick: move |_| {
                            if let Some(sh) = sheet {
                                let mut s = sh.0;
                                s.set(Some((node.id.clone().unwrap_or_default(), text2.clone())));
                            }
                        },
                        "{text}"
                    }
                }
            }
        }
        "imageTextRow" => {
            let text = img_text_of(&node);
            let sheet = try_use_context::<TextSheet>();
            let fid = file_id(&node);
            let text2 = text.clone();
            rsx! {
                div { class: "img-text-row",
                    div { class: "itr-img",
                        if let Some(fid) = fid {
                            BlobMedia { file_id: fid, gen, kind: "image".to_string() }
                        } else {
                            span { class: "itr-placeholder", "🖼" }
                        }
                    }
                    div {
                        class: "itr-text",
                        onclick: move |_| {
                            if let Some(sh) = sheet {
                                let mut s = sh.0;
                                s.set(Some((node.id.clone().unwrap_or_default(), text2.clone())));
                            }
                        },
                        "{text}"
                    }
                }
            }
        }
        _ => {
            crate::diag::log_once(
                &format!("unknown-block-{ty}"),
                "RENDER",
                &format!("unknown block type {ty} degraded to text"),
            );
            let text = node.plain_text();
            rsx! { div { class: "blk-p", "{text}" } }
        }
    }
}

/// Markdown 源段落（原版模型实证，use-slash.js:518-545）：
/// 代码块/列表/Callout 在文档里都是 type=paragraph、children[0].text
/// 存 Markdown 源码，渲染时成 md-preview；点击回源码编辑。
/// 这里是与原版 editor.md.js 等价的分类器（只覆盖块级三类）。
#[derive(Clone, PartialEq)]
pub enum MdKind {
    Code(String),
    /// 含合法 wiki 链接的普通段落（原版 looksLikeMarkdown 含
    /// [[…]] 模式，此类段落进 md 预览、链接成锚点可点）。
    Rich(String),
    Callout {
        style: &'static str,
        title: String,
        body: Vec<String>,
    },
    List {
        ordered: bool,
        items: Vec<String>,
    },
    /// 表格（GFM）：表头 / 对齐（0 左 1 中 2 右）/ 行
    Table {
        head: Vec<String>,
        align: Vec<u8>,
        rows: Vec<Vec<String>>,
    },
    /// 单行 md 标题段（# … ######）
    Heading {
        level: u8,
        text: String,
    },
    /// 引用块：全部行以 > 起（非 Callout），段落已分好
    Quote(Vec<String>),
    /// 分隔线段（--- / *** / ___）
    Divider,
}

fn callout_style_title(raw: &str) -> (&'static str, &'static str) {
    // editor.md.js CALLOUT_STYLE / CALLOUT_TITLE 逐字移植（标题为
    // 原版硬编码中文，不走语言包——与原版行为一致）。
    match raw {
        "info" => ("note", "信息"),
        "todo" => ("note", "待办"),
        "abstract" => ("note", "摘要"),
        "quote" => ("note", "引用"),
        "tip" => ("tip", "提示"),
        "success" => ("tip", "成功"),
        "example" => ("tip", "示例"),
        "question" => ("warning", "问题"),
        "warning" => ("warning", "注意"),
        "important" => ("important", "重要"),
        "failure" => ("important", "失败"),
        "bug" => ("important", "问题"),
        "caution" => ("caution", "小心"),
        "danger" => ("caution", "危险"),
        _ => ("note", "笔记"),
    }
}

/// Wiki 行内分段：把文本切成普通文本段与 wiki 链接段。
/// 规则 = 原版 editor.md.js preprocessInlineExtensions：
/// /\[\[([^\]\r\n|]+)(?:\|([^\]\r\n]+))?\]\]/，target trim 后
/// 为空不成链；label 缺省/空白回落显示 target。反引号代码段
/// 先保护（其内 [[…]] 不成链，与原版 protectCodeSegments 同
/// 口径；代码段在预览里按原文输出）。
#[derive(Clone, PartialEq)]
pub enum WikiSeg {
    Text(String),
    Link { target: String, label: String },
}

pub fn wiki_segments(text: &str) -> Vec<WikiSeg> {
    // 先按反引号 run 切出代码段（成对才算，落单的反引号是原文）
    let chars: Vec<char> = text.chars().collect();
    let n = chars.len();
    let mut spans: Vec<(bool, String)> = Vec::new(); // (is_code, text)
    let mut cur = String::new();
    let mut i = 0usize;
    while i < n {
        if chars[i] == '`' {
            let mut run = 1usize;
            while i + run < n && chars[i + run] == '`' {
                run += 1;
            }
            let pat: Vec<char> = chars[i..i + run].to_vec();
            let close = (i + run..=n.saturating_sub(run))
                .find(|&k| n - k >= run && chars[k..k + run] == pat[..]);
            if let Some(k) = close {
                if !cur.is_empty() {
                    spans.push((false, std::mem::take(&mut cur)));
                }
                spans.push((true, chars[i..k + run].iter().collect()));
                i = k + run;
                continue;
            }
        }
        cur.push(chars[i]);
        i += 1;
    }
    if !cur.is_empty() {
        spans.push((false, cur));
    }
    let mut out: Vec<WikiSeg> = Vec::new();
    for (is_code, span) in spans {
        if is_code {
            out.push(WikiSeg::Text(span));
        } else {
            scan_wiki_in_text(&span, &mut out);
        }
    }
    out
}

fn scan_wiki_in_text(text: &str, out: &mut Vec<WikiSeg>) {
    let chars: Vec<char> = text.chars().collect();
    let n = chars.len();
    let mut buf = String::new();
    let mut i = 0usize;
    while i < n {
        if chars[i] == '[' && i + 1 < n && chars[i + 1] == '[' {
            let mut j = i + 2;
            let mut ok = true;
            while j < n {
                if chars[j] == ']' {
                    if j + 1 < n && chars[j + 1] == ']' {
                        break;
                    }
                    ok = false;
                    break;
                }
                if chars[j] == '\n' || chars[j] == '\r' {
                    ok = false;
                    break;
                }
                j += 1;
            }
            if ok && j < n {
                let inner: String = chars[i + 2..j].iter().collect();
                let mut parts = inner.splitn(2, '|');
                let target_raw = parts.next().unwrap_or("");
                let label_raw = parts.next();
                let label_ok = label_raw.map(|l| !l.is_empty()).unwrap_or(true);
                let target = target_raw.trim().to_string();
                if label_ok && !target_raw.is_empty() && !target.is_empty() {
                    let label = label_raw
                        .map(|l| l.trim().to_string())
                        .filter(|l| !l.is_empty())
                        .unwrap_or_else(|| target.clone());
                    if !buf.is_empty() {
                        out.push(WikiSeg::Text(std::mem::take(&mut buf)));
                    }
                    out.push(WikiSeg::Link { target, label });
                    i = j + 2;
                    continue;
                }
            }
        }
        buf.push(chars[i]);
        i += 1;
    }
    if !buf.is_empty() {
        out.push(WikiSeg::Text(buf));
    }
}

/// 含行内 wiki 链接的文本渲染：链接段成 a.mynote-wiki-link，
/// 点击经 WikiNav 上下文上报（编辑器根先落盘再导航），并阻止
/// 冒泡到 .md-hit 的点改源码处理（原版双链优先）。
#[component]
pub fn WikiText(text: String) -> Element {
    let nav = try_use_context::<WikiNav>();
    let segs = wiki_segments(&text);
    rsx! {
        for (i, seg) in segs.iter().enumerate() {
            match seg {
                WikiSeg::Text(t) => rsx! { span { key: "t{i}", "{t}" } },
                WikiSeg::Link { target, label } => {
                    let target = target.clone();
                    rsx! {
                        a {
                            key: "w{i}",
                            class: "mynote-wiki-link",
                            href: "#",
                            "data-note-title": "{target}",
                            title: "{crate::i18n::tf(\"editor.wiki_open_title\", &[(\"target\", &target)])}",
                            onclick: move |e: Event<MouseData>| {
                                e.stop_propagation();
                                e.prevent_default();
                                if let Some(mut nav) = nav {
                                    nav.0.set(Some(target.clone()));
                                }
                            },
                            "{label}"
                        }
                    }
                }
            }
        }
    }
}

/// 表格行拆分：去掉首尾的 | 后按 | 切分。
fn split_table_row(line: &str) -> Vec<&str> {
    let t = line.trim();
    let t = t.strip_prefix('|').unwrap_or(t);
    let t = t.strip_suffix('|').unwrap_or(t);
    t.split('|').collect()
}

pub fn md_classify(text: &str) -> Option<MdKind> {
    let trimmed = text.trim_matches('\n');
    if trimmed.is_empty() {
        return None;
    }
    let lines: Vec<&str> = trimmed.split('\n').collect();
    // 代码围栏：首行 ``` 起、末行 ``` 止
    if lines.len() >= 2
        && lines[0].trim_start().starts_with("```")
        && lines[lines.len() - 1].trim() == "```"
    {
        return Some(MdKind::Code(lines[1..lines.len() - 1].join("\n")));
    }
    // Callout：首行 > [!TYPE] 可带自定义标题，其余行 > 前缀
    if let Some(first) = lines.first() {
        let f = first.trim_start();
        if let Some(rest) = f.strip_prefix("> [!") {
            if let Some(end) = rest.find(']') {
                let raw = rest[..end].to_lowercase();
                let custom = rest[end + 1..].trim().to_string();
                let (style, default_title) = callout_style_title(&raw);
                let title = if custom.is_empty() {
                    default_title.to_string()
                } else {
                    custom
                };
                let body: Vec<String> = lines[1..]
                    .iter()
                    .map(|l| {
                        let t = l.trim_start();
                        t.strip_prefix('>')
                            .map(|r| r.strip_prefix(' ').unwrap_or(r).to_string())
                            .unwrap_or_else(|| l.to_string())
                    })
                    .collect();
                return Some(MdKind::Callout { style, title, body });
            }
        }
    }
    // 列表：全部非空行同为 - 或 N. 前缀
    let non_empty: Vec<&&str> = lines.iter().filter(|l| !l.trim().is_empty()).collect();
    if !non_empty.is_empty() {
        if non_empty.iter().all(|l| l.trim_start().starts_with("- ")) {
            return Some(MdKind::List {
                ordered: false,
                items: non_empty
                    .iter()
                    .map(|l| l.trim_start()[2..].to_string())
                    .collect(),
            });
        }
        let is_num = |l: &str| -> Option<String> {
            let t = l.trim_start();
            let dot = t.find(". ")?;
            if t[..dot].chars().all(|c| c.is_ascii_digit()) && dot > 0 {
                Some(t[dot + 2..].to_string())
            } else {
                None
            }
        };
        if non_empty.iter().all(|l| is_num(l).is_some()) {
            return Some(MdKind::List {
                ordered: true,
                items: non_empty.iter().map(|l| is_num(l).unwrap()).collect(),
            });
        }
    }
    // 分隔线：整段就是 --- / *** / ___（3 个以上）
    {
        let t = trimmed.trim();
        if t.len() >= 3
            && (t.chars().all(|c| c == '-')
                || t.chars().all(|c| c == '*')
                || t.chars().all(|c| c == '_'))
        {
            return Some(MdKind::Divider);
        }
    }
    // 单行标题：# ~ ###### + 空格
    if lines.len() == 1 {
        let t = lines[0].trim_start();
        let hashes = t.chars().take_while(|c| *c == '#').count();
        if (1..=6).contains(&hashes) && t[hashes..].starts_with(' ') {
            return Some(MdKind::Heading {
                level: hashes as u8,
                text: t[hashes + 1..].trim().to_string(),
            });
        }
    }
    // 表格：首行含 |、次行是 |---|---| 分隔行
    if lines.len() >= 2 && lines[0].contains('|') {
        let sep = lines[1].trim();
        let cells: Vec<&str> = split_table_row(sep);
        let is_sep = !cells.is_empty()
            && cells.iter().all(|c| {
                let c = c.trim();
                !c.is_empty()
                    && c.chars().all(|ch| ch == '-' || ch == ':')
                    && c.contains('-')
            });
        if is_sep {
            let align: Vec<u8> = cells
                .iter()
                .map(|c| {
                    let c = c.trim();
                    if c.starts_with(':') && c.ends_with(':') {
                        1
                    } else if c.ends_with(':') {
                        2
                    } else {
                        0
                    }
                })
                .collect();
            return Some(MdKind::Table {
                head: split_table_row(lines[0])
                    .iter()
                    .map(|c| c.trim().to_string())
                    .collect(),
                align,
                rows: lines[2..]
                    .iter()
                    .filter(|l| !l.trim().is_empty())
                    .map(|l| {
                        split_table_row(l)
                            .iter()
                            .map(|c| c.trim().to_string())
                            .collect()
                    })
                    .collect(),
            });
        }
    }
    // 引用块：全部非空行以 > 起（Callout 已先行处理）
    if !non_empty.is_empty()
        && non_empty.iter().all(|l| l.trim_start().starts_with('>'))
    {
        let mut paras: Vec<String> = Vec::new();
        let mut cur: Vec<String> = Vec::new();
        for l in &lines {
            let t = l.trim_start();
            let body = t
                .strip_prefix('>')
                .map(|r| r.strip_prefix(' ').unwrap_or(r))
                .unwrap_or("");
            if body.trim().is_empty() {
                if !cur.is_empty() {
                    paras.push(cur.join(" "));
                    cur = Vec::new();
                }
            } else {
                cur.push(body.trim().to_string());
            }
        }
        if !cur.is_empty() {
            paras.push(cur.join(" "));
        }
        if !paras.is_empty() {
            return Some(MdKind::Quote(paras));
        }
    }
    // 含合法 wiki 链接的段落也归入 md 预览（原版 looksLikeMarkdown）
    if wiki_segments(text)
        .iter()
        .any(|sg| matches!(sg, WikiSeg::Link { .. }))
    {
        return Some(MdKind::Rich(text.to_string()));
    }
    None
}

/// md 源段落的预览渲染（原版 .md-preview.block.markdown-render）。
#[component]
pub fn MdPreview(text: String) -> Element {
    let kind = md_classify(&text);
    match kind {
        Some(MdKind::Code(code)) => rsx! {
            div { class: "md-preview block markdown-render",
                pre { code { "{code}" } }
            }
        },
        Some(MdKind::Rich(text)) => rsx! {
            div { class: "md-preview block markdown-render",
                p { WikiText { text } }
            }
        },
        Some(MdKind::Callout { style, title, body }) => {
            let icon = crate::icons::callout_icon_markup(style);
            rsx! {
                div { class: "md-preview block markdown-render",
                    aside { class: "callout callout-{style}",
                        div { class: "callout-header",
                            span { class: "callout-icon", dangerous_inner_html: "{icon}" }
                            span { class: "callout-title", "{title}" }
                        }
                        div { class: "callout-body",
                            for (i, line) in body.iter().enumerate() {
                                div { key: "{i}", WikiText { text: line.clone() } }
                            }
                        }
                    }
                }
            }
        }
        Some(MdKind::Divider) => rsx! {
            div { class: "md-preview block markdown-render",
                hr {}
            }
        },
        Some(MdKind::Heading { level, text }) => rsx! {
            div { class: "md-preview block markdown-render",
                match level {
                    1 => rsx! { h1 { WikiText { text } } },
                    2 => rsx! { h2 { WikiText { text } } },
                    3 => rsx! { h3 { WikiText { text } } },
                    4 => rsx! { h4 { WikiText { text } } },
                    5 => rsx! { h5 { WikiText { text } } },
                    _ => rsx! { h6 { WikiText { text } } },
                }
            }
        },
        Some(MdKind::Quote(paras)) => rsx! {
            div { class: "md-preview block markdown-render",
                blockquote {
                    for para in paras {
                        p { WikiText { text: para } }
                    }
                }
            }
        },
        Some(MdKind::Table { head, align, rows }) => {
            let align_style = |i: usize| -> &'static str {
                match align.get(i) {
                    Some(1) => "text-align:center",
                    Some(2) => "text-align:right",
                    _ => "text-align:left",
                }
            };
            rsx! {
                div { class: "md-preview block markdown-render",
                    table {
                        thead {
                            tr {
                                for (i, h) in head.iter().enumerate() {
                                    th { style: "{align_style(i)}", WikiText { text: h.clone() } }
                                }
                            }
                        }
                        tbody {
                            for row in rows {
                                tr {
                                    for (i, cell) in row.iter().enumerate() {
                                        td { style: "{align_style(i)}", WikiText { text: cell.clone() } }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        Some(MdKind::List { ordered, items }) => rsx! {
            div { class: "md-preview block markdown-render",
                if ordered {
                    ol {
                        for (i, item) in items.iter().enumerate() {
                            li { key: "{i}", WikiText { text: item.clone() } }
                        }
                    }
                } else {
                    ul {
                        for (i, item) in items.iter().enumerate() {
                            li { key: "{i}", WikiText { text: item.clone() } }
                        }
                    }
                }
            }
        },
        None => rsx! { div { class: "blk-p", "{text}" } },
    }
}
