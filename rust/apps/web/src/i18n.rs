//! 国际化（仿 Telegram 语言包模型）：zh-CN 内嵌保底；其余
//! 语言包是部署在 ./lang/<code>.json 的独立 JSON，选中时才
//! 从网络下载、缓存进 localStorage、立即应用；选择持久化，
//! 重启恢复（先用缓存即时应用，再后台刷新）。界面文案一律
//! 走 t()/tf()，缺失键回退 zh-CN，再回退键名本身。

use std::collections::HashMap;
use std::sync::OnceLock;

use dioxus::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::JsFuture;

use crate::diag;

pub struct LangMeta {
    pub code: &'static str,
    pub native: &'static str,
    pub english: &'static str,
}

pub const LANGS: &[LangMeta] = &[
    LangMeta {
        code: "zh-CN",
        native: "简体中文",
        english: "Chinese (Simplified)",
    },
    LangMeta {
        code: "zh-TW",
        native: "繁體中文",
        english: "Chinese (Traditional)",
    },
    LangMeta {
        code: "en-US",
        native: "English",
        english: "English",
    },
    LangMeta {
        code: "ja-JP",
        native: "日本語",
        english: "Japanese",
    },
    LangMeta {
        code: "ko-KR",
        native: "한국어",
        english: "Korean",
    },
];

pub const DEFAULT_LANG: &str = "zh-CN";
const LS_LANG: &str = "mynote_lang";
const LS_PACK_PREFIX: &str = "mynote_pack_";

static CURRENT: GlobalSignal<String> = Signal::global(|| DEFAULT_LANG.to_string());
static PACK: GlobalSignal<HashMap<String, String>> = Signal::global(HashMap::new);

fn zh_map() -> &'static HashMap<String, String> {
    static ZH: OnceLock<HashMap<String, String>> = OnceLock::new();
    ZH.get_or_init(|| {
        serde_json::from_str(include_str!("../lang/zh-CN.json")).unwrap_or_default()
    })
}

pub fn current() -> String {
    CURRENT.read().clone()
}

pub fn t(key: &str) -> String {
    if let Some(v) = PACK.read().get(key) {
        return v.clone();
    }
    if let Some(v) = zh_map().get(key) {
        return v.clone();
    }
    key.to_string()
}

/// 带 {name} 占位符的文案。
pub fn tf(key: &str, pairs: &[(&str, &str)]) -> String {
    let mut s = t(key);
    for (k, v) in pairs {
        s = s.replace(&format!("{{{k}}}"), v);
    }
    s
}

fn storage() -> Option<web_sys::Storage> {
    web_sys::window()
        .and_then(|w| w.local_storage().ok())
        .flatten()
}

pub fn is_downloaded(code: &str) -> bool {
    if code == DEFAULT_LANG {
        return true;
    }
    storage()
        .and_then(|s| s.get_item(&format!("{LS_PACK_PREFIX}{code}")).ok())
        .flatten()
        .is_some()
}

fn set_pack(code: &str, map: HashMap<String, String>) {
    *PACK.write() = map;
    *CURRENT.write() = code.to_string();
}

async fn fetch_pack(code: &str) -> Result<HashMap<String, String>, String> {
    let url = format!("./lang/{code}.json");
    let window = web_sys::window().ok_or("no window")?;
    let resp = JsFuture::from(window.fetch_with_str(&url))
        .await
        .map_err(|e| format!("{e:?}"))?;
    let resp: web_sys::Response = resp.dyn_into().map_err(|_| "bad response".to_string())?;
    if !resp.ok() {
        return Err(format!("http {}", resp.status()));
    }
    let text = JsFuture::from(resp.text().map_err(|e| format!("{e:?}"))?)
        .await
        .map_err(|e| format!("{e:?}"))?;
    let text = text.as_string().ok_or("pack not text")?;
    if let Some(s) = storage() {
        let _ = s.set_item(&format!("{LS_PACK_PREFIX}{code}"), &text);
    }
    serde_json::from_str(&text).map_err(|e| format!("parse: {e}"))
}

/// 启动恢复：读已存选择；非默认语言先用缓存包立即应用，
/// 再后台从网络刷新。
pub async fn init_lang() {
    let saved = storage()
        .and_then(|s| s.get_item(LS_LANG).ok())
        .flatten()
        .unwrap_or_else(|| DEFAULT_LANG.to_string());
    if saved == DEFAULT_LANG {
        set_pack(DEFAULT_LANG, zh_map().clone());
        diag::log("LANG", "init zh-CN (builtin)");
        return;
    }
    if let Some(cached) = storage()
        .and_then(|s| s.get_item(&format!("{LS_PACK_PREFIX}{saved}")).ok())
        .flatten()
    {
        if let Ok(map) = serde_json::from_str::<HashMap<String, String>>(&cached) {
            set_pack(&saved, map);
            diag::log("LANG", &format!("init {saved} from cache"));
        }
    }
    match fetch_pack(&saved).await {
        Ok(map) => {
            set_pack(&saved, map);
            diag::log("LANG", &format!("init {saved} refreshed from network"));
        }
        Err(e) => diag::log("LANG", &format!("init {saved} refresh failed: {e}")),
    }
}

/// 用户点选语言：下载（或用内嵌）并应用，持久化选择。
pub async fn apply_lang(code: &str) -> Result<(), String> {
    if code == DEFAULT_LANG {
        set_pack(code, zh_map().clone());
        if let Some(s) = storage() {
            let _ = s.set_item(LS_LANG, code);
        }
        diag::log("LANG", "applied zh-CN (builtin)");
        return Ok(());
    }
    let map = fetch_pack(code).await?;
    set_pack(code, map);
    if let Some(s) = storage() {
        let _ = s.set_item(LS_LANG, code);
    }
    diag::log("LANG", &format!("applied {code} (downloaded)"));
    Ok(())
}
