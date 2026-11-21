//! Wiki 链接与反向链接（原版 editor.js:2-28 目标提取、
//! memo-list.js:291-302 导航解析的等价实现）：纯按标题的文本
//! 链接，文档里永远只存 `[[标题]]` 字面文本，零新增存储字段；
//! 目标解析与反向链接全部运行时现算，无索引、无 id 引用。
//! 扫描全部手写，不引入 regex（与 list.rs 的口径一致）。

use std::collections::HashSet;

use mynote_core::model::{Memo, Node};

/// 原版 wikiTitleKey：剥 `#锚点` → trim → 小写。
/// （原版用 toLocaleLowerCase，Rust 用 Unicode 小写近似。）
pub fn wiki_title_key(value: &str) -> String {
    value.split('#').next().unwrap_or("").trim().to_lowercase()
}

/// 原版 collectWikiSource：递归收集 doc 全部 text 叶；类型为
/// code/codeblock/fencedcode/inlinecode 的节点整棵子树跳过。
fn collect_wiki_source(node: &Node, out: &mut Vec<String>) {
    if let Some(t) = &node.node_type {
        let lt = t.to_lowercase();
        if matches!(
            lt.as_str(),
            "code" | "codeblock" | "fencedcode" | "inlinecode"
        ) {
            return;
        }
    }
    if let Some(text) = &node.text {
        out.push(text.clone());
    }
    if let Some(children) = &node.children {
        for c in children {
            collect_wiki_source(c, out);
        }
    }
}

/// 在 chars[from..] 中找 pat 的首次出现（char 下标）。
fn find_run(chars: &[char], from: usize, pat: &[char]) -> Option<usize> {
    if pat.is_empty() || chars.len() < pat.len() || from > chars.len() - pat.len() {
        return None;
    }
    (from..=chars.len() - pat.len()).find(|&k| &chars[k..k + pat.len()] == pat)
}

/// 剥反引号对包裹的内容（原版 /(`+)([\s\S]*?)\1/g → ''）：
/// 一段反引号 run 与其后同形 run 之间的内容整段删除。
fn strip_backtick_spans(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    let n = chars.len();
    let mut out = String::with_capacity(s.len());
    let mut i = 0usize;
    while i < n {
        if chars[i] == '`' {
            let mut run = 1usize;
            while i + run < n && chars[i + run] == '`' {
                run += 1;
            }
            let pat: Vec<char> = chars[i..i + run].to_vec();
            if let Some(close) = find_run(&chars, i + run, &pat) {
                i = close + run;
                continue;
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

/// 删转义写法（原版 /\[\[[^\]\r\n]*\]\]/g → ''）：`\[[...]]`
/// 不计为链接。
fn remove_escaped_wiki(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    let n = chars.len();
    let mut out = String::with_capacity(s.len());
    let mut i = 0usize;
    while i < n {
        if chars[i] == '\\' && i + 2 < n && chars[i + 1] == '[' && chars[i + 2] == '[' {
            let mut j = i + 3;
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
                i = j + 2;
                continue;
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

/// 原版 memoWikiTargets：本篇 doc 里全部 `[[目标]]` 的归一化键
/// 集合。语法 / \[\[([^\]\r\n|]+)(?:\|[^\]\r\n]+)?\]\] /：target
/// 禁 `]`/换行/`|`；带 `|` 时别名段必须非空，否则整体不成立。
pub fn memo_wiki_targets(memo: &Memo) -> HashSet<String> {
    let mut texts = Vec::new();
    for block in &memo.doc {
        collect_wiki_source(block, &mut texts);
    }
    let joined = texts.join("\n");
    let no_code = strip_backtick_spans(&joined);
    let clean = remove_escaped_wiki(&no_code);
    let chars: Vec<char> = clean.chars().collect();
    let n = chars.len();
    let mut out = HashSet::new();
    let mut i = 0usize;
    while i + 1 < n {
        if chars[i] == '[' && chars[i + 1] == '[' {
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
                let target = parts.next().unwrap_or("");
                let label_ok = match parts.next() {
                    Some(label) => !label.is_empty(),
                    None => true,
                };
                if label_ok && !target.is_empty() {
                    let key = wiki_title_key(target);
                    if !key.is_empty() {
                        out.insert(key);
                    }
                }
                i = j + 2;
                continue;
            }
        }
        i += 1;
    }
    out
}

/// 原版 Editor 内联反向链接过滤：非自身（按 id 排除）且其
/// targets 含当前标题键的备忘，保持数组原序。匹配用正在编辑
/// 的标题（live_title）；字面「无标题」的标题按原版口径视为空
///（editor.js:113），故永远不成为反向链接目标。
/// 返回 (id, title) 列表（title 可为空串，显示端回落文案）。
pub fn compute_backlinks(
    memos: &[Memo],
    current_id: &str,
    live_title: &str,
) -> Vec<(String, String)> {
    let effective = if live_title.trim() == "无标题" {
        ""
    } else {
        live_title
    };
    let key = wiki_title_key(effective);
    if key.is_empty() {
        return Vec::new();
    }
    memos
        .iter()
        .filter(|m| m.id.to_string() != current_id)
        .filter(|m| memo_wiki_targets(m).contains(&key))
        .map(|m| (m.id.to_string(), m.title.clone().unwrap_or_default()))
        .collect()
}
