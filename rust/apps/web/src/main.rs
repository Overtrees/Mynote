//! 此刻 · Rust Web（Dioxus / DOM 路线）：
//! 真实数据闭环——备份 ZIP 导入（core 校验）→ IndexedDB 持久
//! → 列表/搜索 → 块编辑器 → 备份 ZIP 导出。
//! 首次打开以真实样本数据播种，导入后全量替换（原版恢复语义）。
//! 页面结构与度量对原版逐项复刻（见各模块注释）。

mod blocks;
mod diag;
mod editor;
mod icons;
mod idb;
mod i18n;
mod list;
mod settings;
mod wiki;

use dioxus::prelude::*;
use std::collections::HashSet;
use mynote_core::{BackupFile, Memo};
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::JsFuture;

const EMPTY_MANIFEST: &str = "{\"version\":1,\"attachments\":{}}";

/// 样式按模块拆分（styles/ 目录，对齐原版 styles 的组织）：
/// tokens.css 设计令牌（含深色令牌组）/ base.css 基础+列表 /
/// editor.css 编辑器+块渲染 / panels.css 功能页。
/// 组件里禁止再堆内联样式；动态值只走 CSS 变量注入。
const CSS: &str = concat!(
    include_str!("../styles/tokens.css"),
    include_str!("../styles/base.css"),
    include_str!("../styles/editor.css"),
    include_str!("../styles/panels.css"),
);

fn main() {
    diag::init();
    diag::log("APP", "start");
    // 清掉外壳的启动页占位：dioxus::launch 只往 #main 追加根节点，
    // 不清已有子节点，启动页会残留并把应用顶到一屏之外
    if let Some(el) = web_sys::window()
        .and_then(|w| w.document())
        .and_then(|d| d.get_element_by_id("main"))
    {
        el.set_inner_html("");
    }
    dioxus::launch(App);
}

/// 安全区探针：用一个临时元素的 env() padding 读四边 inset，
/// 连同 inner/vv 尺寸与 standalone 态打进 Diag（标签 SAFE）。
fn spawn_safe_probe() {
    use dioxus::prelude::*;
    spawn(async move {
        let mut eval = document::eval(
            "const d = document.createElement('div');\
             d.style.cssText = 'position:fixed;top:0;left:0;visibility:hidden;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right)';\
             document.body.appendChild(d);\
             const cs = getComputedStyle(d);\
             const r = { t: cs.paddingTop, b: cs.paddingBottom, l: cs.paddingLeft, r: cs.paddingRight, iw: innerWidth, ih: innerHeight, vv: visualViewport ? Math.round(visualViewport.height) : -1, standalone: (navigator.standalone === true) || matchMedia('(display-mode: standalone)').matches };\
             d.remove();\
             dioxus.send(JSON.stringify(r));",
        );
        if let Ok(s) = eval.recv::<String>().await {
            diag::log("SAFE", &s);
        }
    });
}

/// 首次播种 = 原版内置示例数据（demo-memos.js 的数据口径移植：
/// 同标题、同正文、同结构；时间按原版相对今天生成——今天 /
/// 昨天 / 3 天前 / 7 天前 / 14 天前；heading 的 level 与 todo
/// 的 checked 按原版节点工厂放 attrs）。原先的静态样本是真实
/// 备忘的骨架（正文为空、图片附件无字节），首屏会出现一整张
/// 空白图片卡，与原版首屏完全两样，故废弃。
fn sample_data() -> BackupFile {
    let now = js_sys::Date::now() as i64;
    let day: i64 = 86_400_000;
    let p = |id: &str, text: &str| {
        serde_json::json!({ "id": id, "type": "paragraph",
            "children": [{ "text": text }] })
    };
    let v = serde_json::json!({
        "version": 2,
        "memos": [
            { "id": "demo_exhibit", "title": "周末看展记录", "pinned": false,
              "createdAt": now, "updatedAt": now,
              "doc": [
                p("de1", "今天去了 UCCA 的「非物质再现」展。光线透过亚克力板投射在墙上的影子会随着人的移动变化，站久了会忘记时间。"),
                p("de2", "想起上周看的书里那句话：==所谓的边界，只是我们还没习惯的过渡带=="),
                { "id": "de3", "type": "heading", "attrs": { "level": 2 }, "children": [{ "text": "实用信息" }] },
                p("de4", "地址：798 艺术区 UCCA。票价 100 元。")
              ] },
            { "id": "demo_home", "title": "装修踩坑清单", "pinned": true,
              "createdAt": now - day, "updatedAt": now - day,
              "doc": [
                { "id": "dh1", "type": "todo", "attrs": { "checked": true }, "children": [{ "text": "厨房插座至少留 6 个，台面要带开关" }] },
                { "id": "dh2", "type": "todo", "attrs": { "checked": true }, "children": [{ "text": "卫生间防水刷到 1.8m，闭水试验做满 48h" }] },
                { "id": "dh3", "type": "todo", "attrs": { "checked": false }, "children": [{ "text": "地板和瓷砖之间用极窄收边条，不要过门石" }] },
                { "id": "dh4", "type": "todo", "attrs": { "checked": false }, "children": [{ "text": "衣柜做到顶，不要成品柜，顶部积灰严重" }] }
              ] },
            { "id": "demo_tools", "title": "好用的工具网站", "pinned": false,
              "createdAt": now - 3 * day, "updatedAt": now - 3 * day,
              "doc": [
                p("dt1", "几个日常高频用到的小工具，免费无广告。"),
                p("dt2", "Excalidraw — 画架构图和流程图最顺手的白板。"),
                p("dt3", "Carbon — 把代码生成漂亮的分享图，支持 20+ 主题。")
              ] },
            { "id": "demo_book", "title": "读书笔记｜设计的觉醒", "pinned": false,
              "createdAt": now - 7 * day, "updatedAt": now - 7 * day,
              "doc": [
                p("db1", "田中一光的随笔集，断断续续读了一个月。"),
                p("db2", "「设计不是一种技能，而是捕捉事物本质的感觉和洞察力。」"),
                p("db3", "「整理、排布、思考——设计的本质就是这三件事的循环。」")
              ] },
            { "id": "demo_music", "title": "最近在听的歌", "pinned": false,
              "createdAt": now - 14 * day, "updatedAt": now - 14 * day,
              "doc": [
                { "id": "dm1", "type": "heading", "attrs": { "level": 2 }, "children": [{ "text": "上周循环最多的几首" }] },
                p("dm2", "She Her Her Hers — Arrows — 吉他前奏一响整个人都松下来了。适合下雨天窝在沙发上单曲循环。"),
                { "id": "dm3", "type": "musicCard", "url": "https://c6.y.qq.com/base/fcgi-bin/u?__=1RE7gOYaMZgO", "meta": null, "status": "loading" },
                p("dm4", "陶喆 — 月亮代表谁的心 — 晚上十一点半的地铁上听到这首歌，老歌新唱居然听出了不一样的味道。原来有些旋律不管过多少年都不会过期。"),
                { "id": "dm5", "type": "musicCard", "url": "https://music.apple.com/cn/album/%E6%9C%88%E4%BA%AE%E4%BB%A3%E8%A1%A8%E8%B0%81%E7%9A%84%E5%BF%83/914664926?i=914664941", "meta": null, "status": "loading" },
                p("dm6", "黑裙子 — Our Own Summer — 前奏的鼓点一出来就感觉回到了某个无所事事的夏天傍晚，风吹在脸上是热的，但心里是凉的。"),
                { "id": "dm7", "type": "musicCard", "url": "https://163cn.tv/7ceoWN8", "meta": null, "status": "loading" },
                p("dm8", "落日飞车 — My Jinji — 适合晚上开车听，吉他音色软软的，像夏天的风从车窗缝里吹进来。"),
                { "id": "dm9", "type": "musicCard", "url": "https://open.spotify.com/track/7npPPrZEDmeHMk6mxvIeFa?si=zp0-QuSsTBWvhaGVKVUfjg", "meta": null, "status": "loading" }
              ] }
        ]
    });
    serde_json::from_value(v).expect("demo seed must parse")
}

fn sorted_memos(data: &BackupFile) -> Vec<Memo> {
    let mut memos = data.memos.clone();
    memos.sort_by(|a, b| {
        let pa = a.pinned.unwrap_or(false);
        let pb = b.pinned.unwrap_or(false);
        pb.cmp(&pa).then_with(|| {
            b.updated_at
                .to_millis()
                .unwrap_or(0)
                .cmp(&a.updated_at.to_millis().unwrap_or(0))
        })
    });
    memos
}

#[component]
fn App() -> Element {
    let mut data = use_signal(sample_data);
    let mut manifest = use_signal(|| EMPTY_MANIFEST.to_string());
    // 状态 toast 只报用户动作的结果（导入/导出等），启动不弹
    // （原版首开无 toast）；种子/已加载只记诊断日志。
    let status = use_signal(String::new);
    let mut query = use_signal(String::new);
    let mut selected = use_signal(|| Option::<String>::None);
    // 本会话新建的备忘 id 集（列表新建 / wiki 新建时登记，
    // 编辑器关闭后注销）：供「空白关闭即删除」限定范围。
    let mut new_ids = use_signal(HashSet::<String>::new);
    let mut gen = use_signal(|| 0u32);
    // 子页面："" 列表/编辑 | settings 设置 | backup 备份 |
    // language 语言 | diag 诊断（诊断与语言入口都在设置页内）
    let mut page = use_signal(|| "");
    // 折叠展开的子组集合（键 "{label}-img" / "{label}-txt"，原版口径）
    let mut expanded = use_signal(HashSet::<String>::new);
    // 列表滚动位置（驱动标题收缩与紧凑胶囊，原版 TITLE_THRESHOLD=30）
    let mut scroll_y = use_signal(|| 0f64);
    let mut search_open = use_signal(|| false);
    use_hook(spawn_safe_probe);
    use_effect(move || {
        spawn(async move {
            let mut eval = document::eval(
                "window.addEventListener('scroll', () => { dioxus.send(window.scrollY); }, { passive: true });",
            );
            while let Ok(v) = eval.recv::<f64>().await {
                if (v - *scroll_y.read()).abs() > 0.5 {
                    scroll_y.set(v.max(0.0));
                }
            }
        });
    });
    let mut font_size = use_signal(|| {
        web_sys::window()
            .and_then(|w| w.local_storage().ok().flatten())
            .and_then(|s| s.get_item("sj_fontsize").ok().flatten())
            .unwrap_or_else(|| "medium".to_string())
    });
    // 文字大小 = 原版 applyFontSize：改根字号（rem 全局缩放）
    use_effect(move || {
        let px = settings::font_px(font_size.read().as_str());
        spawn(async move {
            let _ = document::eval(&format!(
                "document.documentElement.style.fontSize = '{px}';"
            ))
            .await;
        });
    });

    // 启动：恢复语言选择（缓存即时应用 + 后台刷新语言包）
    use_effect(move || {
        spawn(async move {
            i18n::init_lang().await;
        });
    });

    // 启动：IndexedDB 有持久数据则覆盖样本
    use_effect(move || {
        spawn(async move {
            match idb::load_state().await {
                Some((memos_json, manifest_raw)) => {
                    match serde_json::from_str::<BackupFile>(&memos_json) {
                        Ok(parsed) => {
                            diag::log("APP", &format!("loaded persisted memos={}", parsed.memos.len()));
                            data.set(parsed);
                            if !manifest_raw.is_empty() {
                                manifest.set(manifest_raw);
                            }
                            diag::log("APP", "persisted state applied");
                        }
                        Err(e) => diag::log("APP", &format!("persisted memos_json parse err: {e}")),
                    }
                }
                None => diag::log("APP", "no persisted state, seed sample"),
            }
            // ?open= 深链（原版 tryOpenNote）：id 精确或标题
            // 包含匹配，第一篇命中即打开
            if let Some(open) = web_sys::window()
                .and_then(|w| w.location().search().ok())
                .and_then(|q| {
                    q.trim_start_matches('?')
                        .split('&')
                        .find_map(|kv| kv.strip_prefix("open="))
                        .map(|v| {
                            js_sys::decode_uri_component(v)
                                .map(|j| j.as_string().unwrap_or_default())
                                .unwrap_or_default()
                        })
                })
                .filter(|v| !v.is_empty())
            {
                let hit = data
                    .read()
                    .memos
                    .iter()
                    .find(|m| {
                        m.id.to_string() == open
                            || m.title.as_deref().unwrap_or("").contains(&open)
                    })
                    .map(|m| m.id.to_string());
                if let Some(id) = hit {
                    diag::log("APP", &format!("deep link open={open} -> {id}"));
                    selected.set(Some(id));
                }
            }
        });
    });

    let q = query.read().trim().to_string();
    let all_count = data.read().memos.len();
    let memos: Vec<Memo> = sorted_memos(&data.read())
        .into_iter()
        .filter(|m| list::matches_search(m, &q))
        .collect();
    let sel_id = selected.read().clone();
    let sel_memo = sel_id.as_ref().and_then(|id| {
        data.read()
            .memos
            .iter()
            .find(|m| m.id.to_string() == *id)
            .cloned()
    });

    let groups = list::build_groups(&memos);
    let progress = (*scroll_y.read() / 30.0).clamp(0.0, 1.0);
    let is_compact = progress >= 1.0;
    let title_scale = 1.0 - progress * 0.45;
    let title_ty = progress * -4.0;
    let title_op = 1.0 - progress * 0.3;
    let vis_c = if is_compact { "visible" } else { "hidden" };
    let vis_h = if is_compact { "hidden" } else { "visible" };
    let op_c = if is_compact { 1.0 } else { 0.0 };
    let op_nc = if is_compact { 0.0 } else { 1.0 };
    let op_title = if is_compact { 0.0 } else { title_op };

    let persist = move |backup: BackupFile| {
        spawn(async move {
            if let Ok(json) = serde_json::to_string(&backup) {
                let _ = idb::save_memos(&json).await;
            }
        });
    };

    rsx! {
        document::Style { {CSS} }
        div {
            if *page.read() == "diag" {
                DiagView { on_back: move |_| page.set("settings") }
            } else if *page.read() == "language" {
                LanguageView { on_back: move |_| page.set("settings") }
            } else if *page.read() == "backup" {
                settings::BackupView {
                    data,
                    manifest,
                    status,
                    gen,
                    on_back: move |_| page.set("settings"),
                }
            } else if *page.read() == "settings" {
                settings::SettingsView {
                    font_size,
                    on_back: move |_| page.set(""),
                    on_backup: move |_| page.set("backup"),
                    on_language: move |_| page.set("language"),
                    on_diag: move |_| page.set("diag"),
                }
            } else if sel_memo.is_none() {
                div {
                    class: "page-title compact",
                    style: "visibility:{vis_c};opacity:{op_c};pointer-events:auto;cursor:pointer;width:fit-content;margin:0 auto;",
                    onclick: move |_| page.set("settings"),
                    "{i18n::t(\"app.title\")}"
                }
                div { class: "page-enter", style: "position:relative;background-color:var(--primary-bg);",
                    header { class: "main-header",
                        div { class: "header-actions" }
                    }
                    div { style: "position:relative;",
                        h1 {
                            class: "page-title",
                            style: "transform:scale({title_scale}) translateY({title_ty}px);opacity:{op_title};visibility:{vis_h};transform-origin:left center;pointer-events:auto;cursor:pointer;display:inline-block;width:fit-content;",
                            onclick: move |_| page.set("settings"),
                            list::AvatarContent { size: 72 }
                        }
                        if *search_open.read() {
                            div {
                                class: "glass-search-panel",
                                style: "position:absolute;right:20px;top:7px;height:66px;display:flex;align-items:center;gap:8px;padding:0 14px;border-radius:var(--radius-999);background:var(--glass-overlay-bg);backdrop-filter:var(--glass-overlay-filter);-webkit-backdrop-filter:var(--glass-overlay-filter);border:0.5px solid var(--glass-overlay-border);opacity:{op_nc};visibility:{vis_h};",
                                span { dangerous_inner_html: "{icons::search_markup(18)}" }
                                input {
                                    class: "glass-search-input",
                                    placeholder: "{i18n::t(\"search.placeholder\")}",
                                    value: "{query}",
                                    oninput: move |e| query.set(e.value()),
                                    onblur: move |_| search_open.set(false),
                                    onkeydown: move |e| {
                                        if e.key() == Key::Escape {
                                            search_open.set(false);
                                        }
                                    },
                                    onmounted: move |e| {
                                        spawn(async move {
                                            let _ = e.set_focus(true).await;
                                        });
                                    },
                                    style: "width:140px;height:40px;border:none;background:transparent;font-size:var(--font-15);color:var(--text-main);outline:none;font-family:inherit;",
                                }
                            }
                        } else {
                            button {
                                class: "glass-search-trigger",
                                r#type: "button",
                                onclick: move |_| search_open.set(true),
                                style: "position:absolute;right:20px;top:7px;height:66px;display:flex;align-items:center;justify-content:center;gap:6px;padding:0 18px;border-radius:var(--radius-999);background:var(--glass-control-bg);backdrop-filter:var(--glass-control-filter);-webkit-backdrop-filter:var(--glass-control-filter);border:0.5px solid var(--glass-control-border);cursor:pointer;pointer-events:auto;opacity:{op_nc};visibility:{vis_h};color:var(--glass-label-color);font-family:inherit;",
                                span { dangerous_inner_html: "{icons::search_markup(20)}" }
                                span { style: "font-size:var(--font-14);color:var(--glass-label-color);letter-spacing:-0.1px;", "{i18n::t(\"search.trigger\")}" }
                            }
                        }
                    }
                    div { class: "container",
                        div { class: "list-group",
                            list::NewCard {
                                on_new: move |_| {
                                    let now = js_sys::Date::now() as i64;
                                    let memo = Memo {
                                        id: mynote_core::model::Id::Num(now),
                                        title: None,
                                        pinned: None,
                                        created_at: mynote_core::model::Timestamp::Millis(now),
                                        updated_at: mynote_core::model::Timestamp::Millis(now),
                                        doc: vec![mynote_core::Node {
                                            text: None,
                                            node_type: Some("paragraph".to_string()),
                                            id: None,
                                            children: Some(vec![mynote_core::Node {
                                                text: Some(String::new()),
                                                node_type: None,
                                                id: None,
                                                children: None,
                                                extra: Default::default(),
                                            }]),
                                            extra: Default::default(),
                                        }],
                                        extra: Default::default(),
                                    };
                                    let mut backup = data.read().clone();
                                    backup.memos.push(memo);
                                    data.set(backup.clone());
                                    new_ids.write().insert(now.to_string());
                                    diag::log("APP", &format!("new memo id={now}"));
                                    persist(backup);
                                    selected.set(Some(now.to_string()));
                                },
                            }
                        }
                        if all_count == 0 {
                            div { class: "empty-tip", "{i18n::t(\"list.empty_tip\")}" }
                        }
                        for group in groups.iter() {
                            div { key: "g-{group.label}",
                                div { class: "section-header", "{group.label}" }
                                {
                                    let render_sub = |kind: &'static str, sub: Vec<Memo>| {
                                        if sub.is_empty() {
                                            return rsx! {};
                                        }
                                        let fold_key = format!("{}-{}", group.label, kind);
                                        let is_expanded = expanded.read().contains(&fold_key);
                                        let total = sub.len();
                                        let collapsed = total > 2 && !is_expanded;
                                        let toggle = {
                                            let fold_key = fold_key.clone();
                                            move |_: Event<MouseData>| {
                                                let mut s = expanded.read().clone();
                                                if !s.remove(&fold_key) { s.insert(fold_key.clone()); }
                                                expanded.set(s);
                                            }
                                        };
                                        rsx! {
                                            div { class: "list-group",
                                                if collapsed {
                                                    div {
                                                        class: "card-expand-wrapper",
                                                        onclick: toggle,
                                                        list::MemoRow {
                                                            memo: sub[0].clone(),
                                                            expand_text: Some(i18n::tf("list.expand_n", &[("n", &total.to_string())])),
                                                            on_open: {
                                                                let fold_key = fold_key.clone();
                                                                move |_| {
                                                                    let mut s = expanded.read().clone();
                                                                    s.insert(fold_key.clone());
                                                                    expanded.set(s);
                                                                }
                                                            },
                                                            on_pin: move |mid: String| {
                                                                let mut backup = data.read().clone();
                                                                if let Some(m) = backup.memos.iter_mut().find(|m| m.id.to_string() == mid) {
                                                                    let cur = m.pinned.unwrap_or(false);
                                                                    m.pinned = Some(!cur);
                                                                }
                                                                data.set(backup.clone());
                                                                diag::log("APP", &format!("pin toggle {mid}"));
                                                                persist(backup);
                                                            },
                                                            on_delete: move |mid: String| {
                                                                let mut backup = data.read().clone();
                                                                backup.memos.retain(|m| m.id.to_string() != mid);
                                                                data.set(backup.clone());
                                                                diag::log("APP", &format!("delete memo {mid} (swipe)"));
                                                                persist(backup);
                                                            },
                                                            on_expand: {
                                                                let fold_key = fold_key.clone();
                                                                move |_| {
                                                                    let mut s = expanded.read().clone();
                                                                    if !s.remove(&fold_key) { s.insert(fold_key.clone()); }
                                                                    expanded.set(s);
                                                                }
                                                            },
                                                            gen,
                                                        }
                                                    }
                                                } else {
                                                    for (i, memo) in sub.iter().enumerate() {
                                                        list::MemoRow {
                                                            memo: memo.clone(),
                                                            key: "{memo.id}",
                                                            expand_text: if total > 2 && i == total - 1 { Some(i18n::t("list.collapse")) } else { None },
                                                            on_open: move |mid: String| selected.set(Some(mid)),
                                                            on_pin: move |mid: String| {
                                                                let mut backup = data.read().clone();
                                                                if let Some(m) = backup.memos.iter_mut().find(|m| m.id.to_string() == mid) {
                                                                    let cur = m.pinned.unwrap_or(false);
                                                                    m.pinned = Some(!cur);
                                                                }
                                                                data.set(backup.clone());
                                                                diag::log("APP", &format!("pin toggle {mid}"));
                                                                persist(backup);
                                                            },
                                                            on_delete: move |mid: String| {
                                                                let mut backup = data.read().clone();
                                                                backup.memos.retain(|m| m.id.to_string() != mid);
                                                                data.set(backup.clone());
                                                                diag::log("APP", &format!("delete memo {mid} (swipe)"));
                                                                persist(backup);
                                                            },
                                                            on_expand: {
                                                                let fold_key = fold_key.clone();
                                                                move |_| {
                                                                    let mut s = expanded.read().clone();
                                                                    if !s.remove(&fold_key) { s.insert(fold_key.clone()); }
                                                                    expanded.set(s);
                                                                }
                                                            },
                                                            gen,
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    };
                                    rsx! {
                                        {render_sub("img", group.images.clone())}
                                        if !group.images.is_empty() && !group.texts.is_empty() {
                                            div { class: "gap-16" }
                                        }
                                        {render_sub("txt", group.texts.clone())}
                                    }
                                }
                            }
                        }
                    }
                }
            } else if let Some(memo) = sel_memo {
                editor::Editor {
                    key: "{memo.id}",
                    memo_id: memo.id.to_string(),
                    data,
                    manifest,
                    gen,
                    is_new: new_ids.read().contains(&memo.id.to_string()),
                    on_close: {
                        let close_id = memo.id.to_string();
                        move |_| {
                            new_ids.write().remove(&close_id);
                            selected.set(None);
                        }
                    },
                    on_open_wiki: move |target: String| {
                        // 原版 openWikiTarget：剥 # → trim → 第一篇
                        // 标题全等者打开；未命中 → 新建同名备忘并打开
                        let requested = target.split('#').next().unwrap_or("").trim().to_string();
                        if requested.is_empty() {
                            return;
                        }
                        let key = requested.to_lowercase();
                        let hit = data
                            .read()
                            .memos
                            .iter()
                            .find(|m| {
                                m.title.as_deref().unwrap_or("").trim().to_lowercase() == key
                            })
                            .map(|m| m.id.to_string());
                        if let Some(id) = hit {
                            diag::log("WIKI", &format!("open '{requested}' -> {id}"));
                            selected.set(Some(id));
                        } else {
                            let now = js_sys::Date::now() as i64;
                            let memo = Memo {
                                id: mynote_core::model::Id::Num(now),
                                title: Some(requested.clone()),
                                pinned: None,
                                created_at: mynote_core::model::Timestamp::Millis(now),
                                updated_at: mynote_core::model::Timestamp::Millis(now),
                                doc: vec![mynote_core::Node {
                                    text: None,
                                    node_type: Some("paragraph".to_string()),
                                    id: None,
                                    children: Some(vec![mynote_core::Node {
                                        text: Some(String::new()),
                                        node_type: None,
                                        id: None,
                                        children: None,
                                        extra: Default::default(),
                                    }]),
                                    extra: Default::default(),
                                }],
                                extra: Default::default(),
                            };
                            let mut backup = data.read().clone();
                            backup.memos.push(memo);
                            data.set(backup.clone());
                            new_ids.write().insert(now.to_string());
                            diag::log("WIKI", &format!("create '{requested}' id={now}"));
                            persist(backup);
                            selected.set(Some(now.to_string()));
                        }
                    },
                }
            }
        }
    }
}

/// 子页面页头（原版功能页共用：editor-fab 返回 + 紧凑标题胶囊）。
#[component]
fn PageHead(title: String, on_back: EventHandler<()>) -> Element {
    rsx! {
        button {
            class: "editor-fab left",
            onclick: move |_| on_back.call(()),
            span { dangerous_inner_html: "{icons::back_markup()}" }
        }
        div {
            class: "page-title compact",
            style: "visibility:visible;opacity:1;pointer-events:none;",
            "{title}"
        }
    }
}

#[component]
fn DiagView(on_back: EventHandler<()>) -> Element {
    let mut text = use_signal(|| diag::lines().join("\n"));
    rsx! {
        div { class: "page-enter", style: "background:var(--primary-bg);min-height:100vh;",
            PageHead { title: i18n::t("diag.title"), on_back }
            div { class: "page-content",
                div { class: "diag-actions",
                    button {
                        class: "backup-btn secondary",
                        onclick: move |_| text.set(diag::lines().join("\n")),
                        "{i18n::t(\"diag.refresh\")}"
                    }
                    button {
                        class: "backup-btn secondary",
                        onclick: move |_| {
                            let all = diag::lines().join("\n");
                            spawn(async move {
                                if let Some(nav) = web_sys::window().map(|w| w.navigator()) {
                                    let _ = JsFuture::from(nav.clipboard().write_text(&all)).await;
                                }
                            });
                        },
                        "{i18n::t(\"diag.copy_all\")}"
                    }
                    button {
                        class: "backup-btn secondary",
                        onclick: move |_| {
                            diag::clear();
                            diag::log("DIAG", "cleared");
                            text.set(diag::lines().join("\n"));
                        },
                        "{i18n::t(\"diag.clear\")}"
                    }
                }
                div { class: "diag-body", "{text}" }
            }
        }
    }
}

/// 语言设置（仿 Telegram）：点选语言 → 按需下载语言包 →
/// 立即应用；内置 zh-CN 不需下载；已下载的包缓存在本机。
/// 行结构沿用原版设置页的 .list-item。
#[component]
fn LanguageView(on_back: EventHandler<()>) -> Element {
    let mut busy = use_signal(|| Option::<String>::None);
    let mut failed = use_signal(|| false);
    let cur = i18n::current();
    rsx! {
        div { class: "page-enter", style: "background:var(--primary-bg);min-height:100vh;",
            PageHead { title: i18n::t("lang.title"), on_back }
            div { class: "page-content",
                div { class: "list-group",
                    for lang in i18n::LANGS {
                        {
                            let code = lang.code.to_string();
                            let is_cur = code == cur;
                            let state = if is_cur {
                                i18n::t("lang.active")
                            } else if busy.read().as_deref() == Some(code.as_str()) {
                                i18n::t("lang.downloading")
                            } else if code == i18n::DEFAULT_LANG {
                                i18n::t("lang.builtin")
                            } else if i18n::is_downloaded(&code) {
                                i18n::t("lang.downloaded")
                            } else {
                                i18n::t("lang.download")
                            };
                            rsx! {
                                div {
                                    class: "list-item",
                                    key: "{code}",
                                    onclick: {
                                        let code = code.clone();
                                        move |_| {
                                            if i18n::current() == code {
                                                return;
                                            }
                                            failed.set(false);
                                            busy.set(Some(code.clone()));
                                            let code2 = code.clone();
                                            spawn(async move {
                                                match i18n::apply_lang(&code2).await {
                                                    Ok(()) => busy.set(None),
                                                    Err(e) => {
                                                        diag::log("LANG", &format!("apply {code2} failed: {e}"));
                                                        busy.set(None);
                                                        failed.set(true);
                                                    }
                                                }
                                            });
                                        }
                                    },
                                    div { class: "item-left",
                                        div { class: "item-title",
                                            span { class: "item-title-text", style: "max-width:100%;", "{lang.native}" }
                                        }
                                        div { class: "item-meta", "{lang.english}" }
                                    }
                                    div { class: if is_cur { "lang-state cur" } else { "lang-state" }, "{state}" }
                                }
                            }
                        }
                    }
                }
                if *failed.read() {
                    div { class: "empty-tip", "{i18n::t(\"lang.failed\")}" }
                }
            }
        }
    }
}
