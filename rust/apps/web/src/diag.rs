//! 诊断日志（全模块硬规矩）：任何模块、页面都经 Diag 记一笔，
//! 方便后续定位修复与运维。内存环形缓冲（上限 300 行）+
//! localStorage 持久（键 mynote_diag_v1，字符串数组，与
//! Flutter 版同形），刷新/重启不丢。诊断视图在顶栏「诊断」。

use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

const KEY: &str = "mynote_diag_v1";
const CAP: usize = 300;

static LINES: Mutex<Vec<String>> = Mutex::new(Vec::new());

fn seen() -> &'static Mutex<HashSet<String>> {
    static SEEN: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    SEEN.get_or_init(|| Mutex::new(HashSet::new()))
}

fn clock() -> String {
    let d = js_sys::Date::new_0();
    format!(
        "{:02}:{:02}:{:02}",
        d.get_hours(),
        d.get_minutes(),
        d.get_seconds()
    )
}

fn persist(lines: &[String]) {
    if let Some(storage) = web_sys::window()
        .and_then(|w| w.local_storage().ok())
        .flatten()
    {
        if let Ok(json) = serde_json::to_string(&lines) {
            let _ = storage.set_item(KEY, &json);
        }
    }
}

/// 启动时从 localStorage 读回历史日志（main 里调一次）。
pub fn init() {
    if let Some(storage) = web_sys::window()
        .and_then(|w| w.local_storage().ok())
        .flatten()
    {
        if let Ok(Some(json)) = storage.get_item(KEY) {
            if let Ok(saved) = serde_json::from_str::<Vec<String>>(&json) {
                let mut lines = LINES.lock().unwrap();
                *lines = saved.into_iter().rev().take(CAP).rev().collect();
            }
        }
    }
}

pub fn log(tag: &str, msg: &str) {
    let line = format!("[{}] {} {}", clock(), tag, msg);
    let mut lines = LINES.lock().unwrap();
    lines.push(line);
    if lines.len() > CAP {
        let excess = lines.len() - CAP;
        lines.drain(..excess);
    }
    persist(&lines);
}

/// 同一 key 只记一次（渲染降级、附件缺失这类会反复触发的点）。
pub fn log_once(key: &str, tag: &str, msg: &str) {
    let fresh = seen().lock().unwrap().insert(key.to_string());
    if fresh {
        log(tag, msg);
    }
}

pub fn lines() -> Vec<String> {
    LINES.lock().unwrap().clone()
}

pub fn clear() {
    let mut lines = LINES.lock().unwrap();
    lines.clear();
    persist(&lines);
    seen().lock().unwrap().clear();
}
