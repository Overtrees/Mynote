//! 列表页：分组/相对时间/标签/封面/行组件。
//! 口径全部对原版源码：preview.js（摘要与标签）、time.js（timeAgo）、
//! memo-list.js（分组与图片判定）、SwipeRow.js / ImageCard.js（行结构）。

use dioxus::prelude::*;
use mynote_core::Memo;
use wasm_bindgen::JsCast;

use crate::{icons, i18n};

/// 摘要结果（原版 summarizeMemoDoc 的返回值）。
pub(crate) struct Summary {
    pub preview: String,
    pub tags: Vec<String>,
    pub attach_count: usize,
}

fn is_tag_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '-' || ('\u{4e00}' <= c && c <= '\u{9fa5}')
}

/// 扫描文本中的 #标签（含 # 前缀），去重保序。
fn scan_tags(text: &str, tags: &mut Vec<String>) {
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '#' {
            let mut j = i + 1;
            while j < chars.len() && is_tag_char(chars[j]) {
                j += 1;
            }
            if j > i + 1 {
                let tag: String = chars[i..j].iter().collect();
                if !tags.contains(&tag) {
                    tags.push(tag);
                }
                i = j;
                continue;
            }
        }
        i += 1;
    }
}

fn strip_tag_tokens(text: &str) -> String {
    let mut out = String::new();
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '#' {
            let mut j = i + 1;
            while j < chars.len() && is_tag_char(chars[j]) {
                j += 1;
            }
            if j > i + 1 {
                i = j;
                continue;
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out.trim().to_string()
}

/// 原版 editor.md.js stripMarkdownForPreview 的逐条移植（替换顺序
/// 与原版严格一致）。旧实现只是近似（只剥少数行首标记），md 源
/// 段落（Callout/代码/列表）会在卡面露出「> [!NOTE]…」「```」原文。
/// 全部替换用手工扫描器实现（scan_replace + 各 try_* 匹配器），
/// 与原版正则逐条等价——不引入 regex 引擎（体积账：+1.4MB wasm，
/// 且其不支持预查，原版个别表达式照样要手写，如 ~x~ 下标）。
fn strip_markdown(text: &str) -> String {
    let s = scan_replace(text, try_footnote_def, |_| String::new());
    let s = scan_replace(&s, try_wiki_pipe, emit_cap);
    let s = scan_replace(&s, try_wiki, emit_cap);
    let s = scan_replace(&s, try_footnote_ref, |_| String::new());
    let s = scan_replace(&s, try_math_block, emit_cap);
    let s = scan_replace(&s, try_sup_paren, emit_cap);
    let s = scan_replace(&s, try_sup, emit_cap);
    let s = scan_replace(&s, try_sub_paren, emit_cap);
    let s = strip_single_tilde_sub(&s);
    let s = scan_replace(&s, try_highlight, emit_cap);
    let s = scan_replace(&s, try_fence, |_| " 代码块 ".to_string());
    let s = scan_replace(&s, try_code_span, emit_cap);
    let s = scan_replace(&s, try_image, emit_cap);
    let s = scan_replace(&s, try_link, emit_cap);
    let s = scan_replace(&s, try_heading, emit_cap);
    let s = scan_replace(&s, try_quote, emit_cap);
    let s = scan_replace(&s, try_bullet, emit_cap);
    let s = scan_replace(&s, try_numbered, emit_cap);
    let s = paired(&s, "**", '*');
    let s = paired(&s, "__", '_');
    let s = paired(&s, "*", '*');
    let s = paired(&s, "_", '_');
    let s = paired(&s, "~~", '~');
    let s = strip_math_inline(&s);
    let s = collapse_newlines(&s);
    let s = collapse_spaces(&s);
    s.trim().to_string()
}

/// 替换文本 = 捕获组内容（原版的 "$1"）。
fn emit_cap(cap: Option<&[char]>) -> String {
    cap.map(|c| c.iter().collect()).unwrap_or_default()
}

/// 左到右扫描替换骨架：try_match 在 char 下标 i 处尝试匹配，成功
/// 返回 (匹配总长, Option<(捕获起, 捕获止)>)（下标均相对 i）；
/// 失败则原样输出当前字符并前进 1。与正则 replace_all 的
/// 最左、非重叠语义一致。
fn scan_replace(
    s: &str,
    try_match: impl Fn(&[char], usize) -> Option<(usize, Option<(usize, usize)>)>,
    emit: impl Fn(Option<&[char]>) -> String,
) -> String {
    let chars: Vec<char> = s.chars().collect();
    let n = chars.len();
    let mut out = String::with_capacity(s.len());
    let mut i = 0usize;
    while i < n {
        match try_match(&chars, i) {
            Some((len, cap)) => {
                let slice = cap.map(|(a, b)| &chars[i + a..i + b]);
                out.push_str(&emit(slice));
                i += len.max(1);
            }
            None => {
                out.push(chars[i]);
                i += 1;
            }
        }
    }
    out
}

/// 从 j 起消费满足 pred 的字符，返回结束下标。
fn eat(chars: &[char], mut j: usize, pred: impl Fn(char) -> bool) -> usize {
    while j < chars.len() && pred(chars[j]) {
        j += 1;
    }
    j
}

/// 判定 chars[i..] 是否以 lit 开头。
fn starts(chars: &[char], i: usize, lit: &str) -> bool {
    lit.chars()
        .enumerate()
        .all(|(k, c)| chars.get(i + k) == Some(&c))
}

/// 脚注定义 ^\[\^[^\]]+\]:.*(?:\n[ \t]+.*)*$（仅行首）：整段删除。
fn try_footnote_def(chars: &[char], i: usize) -> Option<(usize, Option<(usize, usize)>)> {
    if i > 0 && chars[i - 1] != '\n' {
        return None;
    }
    if !starts(chars, i, "[^") {
        return None;
    }
    let j = eat(chars, i + 2, |c| c != ']');
    if j == i + 2 || !starts(chars, j, "]:") {
        return None;
    }
    let mut end = eat(chars, j + 2, |c| c != '\n');
    while end < chars.len()
        && chars[end] == '\n'
        && matches!(chars.get(end + 1), Some(' ' | '\t'))
    {
        let line = eat(chars, end + 1, |c| c == ' ' || c == '\t');
        end = eat(chars, line, |c| c != '\n');
    }
    Some((end - i, None))
}

/// \[\[([^\]|]+)\|([^\]]+)\]\] → $2。
fn try_wiki_pipe(chars: &[char], i: usize) -> Option<(usize, Option<(usize, usize)>)> {
    if !starts(chars, i, "[[") {
        return None;
    }
    let g1_end = eat(chars, i + 2, |c| c != ']' && c != '|');
    if g1_end == i + 2 || chars.get(g1_end) != Some(&'|') {
        return None;
    }
    let g2_start = g1_end + 1;
    let g2_end = eat(chars, g2_start, |c| c != ']');
    if g2_end == g2_start || !starts(chars, g2_end, "]]" ) {
        return None;
    }
    Some((g2_end + 2 - i, Some((g2_start - i, g2_end - i))))
}

/// \[\[([^\]]+)\]\] → $1。
fn try_wiki(chars: &[char], i: usize) -> Option<(usize, Option<(usize, usize)>)> {
    if !starts(chars, i, "[[") {
        return None;
    }
    let g_end = eat(chars, i + 2, |c| c != ']');
    if g_end == i + 2 || !starts(chars, g_end, "]]") {
        return None;
    }
    Some((g_end + 2 - i, Some((2, g_end - i))))
}

/// \[\^([^\]]+)\] → 删除。
fn try_footnote_ref(chars: &[char], i: usize) -> Option<(usize, Option<(usize, usize)>)> {
    if !starts(chars, i, "[^") {
        return None;
    }
    let g_end = eat(chars, i + 2, |c| c != ']');
    if g_end == i + 2 || chars.get(g_end) != Some(&']') {
        return None;
    }
    Some((g_end + 1 - i, None))
}

/// \$\$(.*?)\$\$（惰性）→ $1。
fn try_math_block(chars: &[char], i: usize) -> Option<(usize, Option<(usize, usize)>)> {
    if !starts(chars, i, "$$") {
        return None;
    }
    let mut k = i + 2;
    while k + 1 < chars.len() + 1 {
        if starts(chars, k, "$$") {
            return Some((k + 2 - i, Some((2, k - i))));
        }
        k += 1;
        if k >= chars.len() {
            return None;
        }
    }
    None
}

/// \^(([^()\n]+)\)\^ → $1。
fn try_sup_paren(chars: &[char], i: usize) -> Option<(usize, Option<(usize, usize)>)> {
    paren_form(chars, i, "^(", ")^")
}

/// ~\(([^()\n]+)\)~ → $1。
fn try_sub_paren(chars: &[char], i: usize) -> Option<(usize, Option<(usize, usize)>)> {
    paren_form(chars, i, "~(", ")~")
}

fn paren_form(
    chars: &[char],
    i: usize,
    open: &str,
    close: &str,
) -> Option<(usize, Option<(usize, usize)>)> {
    if !starts(chars, i, open) {
        return None;
    }
    let body_start = i + 2;
    let body_end = eat(chars, body_start, |c| !matches!(c, '(' | ')' | '\n'));
    if body_end == body_start || !starts(chars, body_end, close) {
        return None;
    }
    Some((body_end + 2 - i, Some((2, body_end - i))))
}

/// \^([A-Za-z0-9][A-Za-z0-9,+\-]*)\^ → $1。
fn try_sup(chars: &[char], i: usize) -> Option<(usize, Option<(usize, usize)>)> {
    if chars.get(i) != Some(&'^') {
        return None;
    }
    let first = *chars.get(i + 1)?;
    if !first.is_ascii_alphanumeric() {
        return None;
    }
    let body_end = eat(chars, i + 2, |c| {
        c.is_ascii_alphanumeric() || matches!(c, ',' | '+' | '-')
    });
    if chars.get(body_end) != Some(&'^') {
        return None;
    }
    Some((body_end + 1 - i, Some((1, body_end - i))))
}

/// ==([^=]+)== → $1。
fn try_highlight(chars: &[char], i: usize) -> Option<(usize, Option<(usize, usize)>)> {
    if !starts(chars, i, "==") {
        return None;
    }
    let body_end = eat(chars, i + 2, |c| c != '=');
    if body_end == i + 2 || !starts(chars, body_end, "==") {
        return None;
    }
    Some((body_end + 2 - i, Some((2, body_end - i))))
}

/// ```.*?```（惰性）→ 「 代码块 」。
fn try_fence(chars: &[char], i: usize) -> Option<(usize, Option<(usize, usize)>)> {
    if !starts(chars, i, "```") {
        return None;
    }
    let mut k = i + 3;
    loop {
        if starts(chars, k, "```") {
            return Some((k + 3 - i, None));
        }
        if k >= chars.len() {
            return None;
        }
        k += 1;
    }
}

/// `([^`]+)` → $1。
fn try_code_span(chars: &[char], i: usize) -> Option<(usize, Option<(usize, usize)>)> {
    if chars.get(i) != Some(&'`') {
        return None;
    }
    let body_end = eat(chars, i + 1, |c| c != '`');
    if body_end == i + 1 || chars.get(body_end) != Some(&'`') {
        return None;
    }
    Some((body_end + 1 - i, Some((1, body_end - i))))
}

/// !\[([^\]]*)\]\(([^\)]+)\) → $1。
fn try_image(chars: &[char], i: usize) -> Option<(usize, Option<(usize, usize)>)> {
    if !starts(chars, i, "![") {
        return None;
    }
    let alt_end = eat(chars, i + 2, |c| c != ']');
    if !starts(chars, alt_end, "](") {
        return None;
    }
    let url_end = eat(chars, alt_end + 2, |c| c != ')');
    if url_end == alt_end + 2 || chars.get(url_end) != Some(&')') {
        return None;
    }
    Some((url_end + 1 - i, Some((2, alt_end - i))))
}

/// \[([^\]]+)\]\(([^\)]+)\) → $1。
fn try_link(chars: &[char], i: usize) -> Option<(usize, Option<(usize, usize)>)> {
    if chars.get(i) != Some(&'[') {
        return None;
    }
    let text_end = eat(chars, i + 1, |c| c != ']');
    if text_end == i + 1 || !starts(chars, text_end, "](") {
        return None;
    }
    let url_end = eat(chars, text_end + 2, |c| c != ')');
    if url_end == text_end + 2 || chars.get(url_end) != Some(&')') {
        return None;
    }
    Some((url_end + 1 - i, Some((1, text_end - i))))
}

/// 行首锚点：返回 (锚点长度, 正文起始)。锚点本身即原版的 $1
///（起始处为空、行间为那个 \n，替换时原样保留）。
fn line_anchor(chars: &[char], i: usize) -> Option<(usize, usize)> {
    if i == 0 {
        Some((0, 0))
    } else if chars[i] == '\n' {
        Some((1, i + 1))
    } else {
        None
    }
}

/// (^|\n)#{1,6}\s+ → $1。
fn try_heading(chars: &[char], i: usize) -> Option<(usize, Option<(usize, usize)>)> {
    let (alen, body) = line_anchor(chars, i)?;
    let hashes = eat(chars, body, |c| c == '#') - body;
    if hashes == 0 || hashes > 6 {
        return None;
    }
    let after = eat(chars, body + hashes, |c| c.is_whitespace());
    if after == body + hashes {
        return None;
    }
    Some((after - i, Some((0, alen))))
}

/// (^|\n)>\s? → $1。
fn try_quote(chars: &[char], i: usize) -> Option<(usize, Option<(usize, usize)>)> {
    let (alen, body) = line_anchor(chars, i)?;
    if chars.get(body) != Some(&'>') {
        return None;
    }
    let mut end = body + 1;
    if chars.get(end).is_some_and(|c| c.is_whitespace()) {
        end += 1;
    }
    Some((end - i, Some((0, alen))))
}

/// (^|\n)[-*+]\s+ → $1。
fn try_bullet(chars: &[char], i: usize) -> Option<(usize, Option<(usize, usize)>)> {
    let (alen, body) = line_anchor(chars, i)?;
    if !matches!(chars.get(body), Some('-' | '*' | '+')) {
        return None;
    }
    let after = eat(chars, body + 1, |c| c.is_whitespace());
    if after == body + 1 {
        return None;
    }
    Some((after - i, Some((0, alen))))
}

/// (^|\n)\d+\.\s+ → $1。
fn try_numbered(chars: &[char], i: usize) -> Option<(usize, Option<(usize, usize)>)> {
    let (alen, body) = line_anchor(chars, i)?;
    let digits = eat(chars, body, |c| c.is_ascii_digit()) - body;
    if digits == 0 || chars.get(body + digits) != Some(&'.') {
        return None;
    }
    let after = eat(chars, body + digits + 1, |c| c.is_whitespace());
    if after == body + digits + 1 {
        return None;
    }
    Some((after - i, Some((0, alen))))
}

/// 成对定界符替换：delim + (非 excl 字符 ≥1) + delim → 内容。
/// 覆盖 \*\*([^*]+)\*\*、__([^_]+)__、\*([^*]+)\*、_([^_]+)_、
/// ~~([^~]+)~~ 五条原版规则。
fn paired(s: &str, delim: &str, excl: char) -> String {
    let dlen = delim.chars().count();
    scan_replace(
        s,
        move |chars, i| {
            if !starts(chars, i, delim) {
                return None;
            }
            let body_end = eat(chars, i + dlen, |c| c != excl);
            if body_end == i + dlen || !starts(chars, body_end, delim) {
                return None;
            }
            Some((body_end + dlen - i, Some((dlen, body_end - i))))
        },
        emit_cap,
    )
}

/// $…$ 行内公式：原版带回调（未转义且像公式才剥 $），逐匹配重建。
fn strip_math_inline(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    let n = chars.len();
    let mut out = String::with_capacity(s.len());
    let mut i = 0usize;
    while i < n {
        if chars[i] == '$' {
            let body_end = eat(&chars, i + 1, |c| c != '$' && c != '\n');
            if body_end > i + 1 && chars.get(body_end) == Some(&'$') {
                let inner: String = chars[i + 1..body_end].iter().collect();
                let escaped = {
                    let mut count = 0usize;
                    let mut k = i;
                    while k > 0 && chars[k - 1] == '\\' {
                        count += 1;
                        k -= 1;
                    }
                    count % 2 == 1
                };
                if !escaped && looks_like_math(&inner) {
                    out.push_str(&inner);
                } else {
                    out.extend(&chars[i..=body_end]);
                }
                i = body_end + 1;
                continue;
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

/// \n+ → 单个空格。
fn collapse_newlines(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_run = false;
    for c in s.chars() {
        if c == '\n' {
            if !in_run {
                out.push(' ');
                in_run = true;
            }
        } else {
            in_run = false;
            out.push(c);
        }
    }
    out
}

/// \s+ → 单个空格。
fn collapse_spaces(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_run = false;
    for c in s.chars() {
        if c.is_whitespace() {
            if !in_run {
                out.push(' ');
                in_run = true;
            }
        } else {
            in_run = false;
            out.push(c);
        }
    }
    out
}

/// 原版 isEscapedAt：index 前连续反斜杠为奇数个即已转义。
fn is_escaped_at(text: &str, byte_idx: usize) -> bool {
    text[..byte_idx]
        .chars()
        .rev()
        .take_while(|&c| c == '\\')
        .count()
        % 2
        == 1
}

/// 原版 looksLikeMathExpression 的移植。
fn looks_like_math(expr: &str) -> bool {
    let v = expr.trim();
    if v.is_empty() {
        return false;
    }
    let mut chs = v.chars();
    if let (Some(c), None) = (chs.next(), chs.clone().next()) {
        if c.is_ascii_alphabetic() {
            return true;
        }
    }
    let bytes: Vec<char> = v.chars().collect();
    for (i, &c) in bytes.iter().enumerate() {
        if c == '\\' && bytes.get(i + 1).is_some_and(|n| n.is_ascii_alphabetic()) {
            return true;
        }
        if c.is_ascii_digit()
            || matches!(c, '=' | '+' | '-' | '*' | '/' | '^' | '_' | '{' | '}' | '<' | '>')
            || ('\u{03b1}'..='\u{03c9}').contains(&c)
            || ('\u{0391}'..='\u{03a9}').contains(&c)
        {
            return true;
        }
    }
    false
}

/// 原版 /(^|[^~])~([A-Za-z0-9][A-Za-z0-9,+-]*)~(?!~)/ 的手工等价
/// （Rust regex 不支持负向先行断言）：~x~ 下标语法剥除波浪线，
/// 但结尾 ~ 后紧跟另一个 ~ 时不匹配。
fn strip_single_tilde_sub(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    let n = chars.len();
    let body_char = |c: char| c.is_ascii_alphanumeric() || matches!(c, ',' | '+' | '-');
    let mut out: Vec<char> = Vec::with_capacity(n);
    let mut pos = 0usize;
    while pos < n {
        let prefix_len = if pos == 0 {
            Some(0)
        } else if chars[pos] != '~' {
            Some(1)
        } else {
            None
        };
        let matched = prefix_len.and_then(|pl| {
            let mut j = pos + pl;
            if j >= n || chars[j] != '~' {
                return None;
            }
            j += 1;
            if j >= n || !chars[j].is_ascii_alphanumeric() {
                return None;
            }
            let start = j;
            while j < n && body_char(chars[j]) {
                j += 1;
            }
            if j >= n || chars[j] != '~' {
                return None;
            }
            if j + 1 < n && chars[j + 1] == '~' {
                return None;
            }
            Some((pl, start, j))
        });
        match matched {
            Some((pl, start, end)) => {
                out.extend_from_slice(&chars[pos..pos + pl]);
                out.extend_from_slice(&chars[start..end]);
                pos = end + 1;
            }
            None => {
                out.push(chars[pos]);
                pos += 1;
            }
        }
    }
    out.into_iter().collect()
}

/// 原版 preview.js summarizeMemoDoc：只看段落块首个子节点的文本。
pub(crate) fn summarize(memo: &Memo, max_len: usize) -> Summary {
    let mut paras: Vec<String> = Vec::new();
    let mut tags: Vec<String> = Vec::new();
    let mut attach_count = 0usize;
    for node in &memo.doc {
        match node.node_type.as_deref() {
            Some("paragraph") => {
                if let Some(first) = node.children.as_ref().and_then(|c| c.first()) {
                    let text = first.text.clone().unwrap_or_default();
                    let text = text.trim();
                    if !text.is_empty() {
                        scan_tags(text, &mut tags);
                        paras.push(text.to_string());
                    }
                }
            }
            Some("attachment") => attach_count += 1,
            _ => {}
        }
    }
    if paras.is_empty() {
        return Summary {
            preview: i18n::t("list.no_more_text"),
            tags: Vec::new(),
            attach_count,
        };
    }
    let tags: Vec<String> = tags.into_iter().take(3).collect();
    let joined = paras.join(" ");
    let stripped = strip_tag_tokens(&strip_markdown(&joined));
    let cut: String = stripped.chars().take(max_len).collect();
    let preview = if !cut.is_empty() {
        cut
    } else if let Some(first) = tags.first() {
        first.trim_start_matches('#').to_string()
    } else {
        i18n::t("list.no_more_text")
    };
    Summary { preview, tags, attach_count }
}

/// 分组（原版 groupedItems）：置顶组在前，其余按
/// createdAt||updatedAt 的日期标签分桶；组内图片在前。
pub(crate) struct MemoGroup {
    pub label: String,
    pub images: Vec<Memo>,
    pub texts: Vec<Memo>,
}

/// 原版 hasImageAttachment：含 image/gallery/imgTextCard/
/// imageTextRow 块，或 attachment 块且 image 为真。
pub(crate) fn has_image(memo: &Memo) -> bool {
    memo.doc.iter().any(|n| match n.node_type.as_deref() {
        Some("image") | Some("gallery") | Some("imgTextCard") | Some("imageTextRow") => true,
        Some("attachment") => n
            .extra
            .get("image")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        _ => false,
    })
}

/// 天数（days-from-civil，纯算术避免时区库）。
fn day_num(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

fn local_ymd(ms: i64) -> (i64, i64, i64) {
    let d = js_sys::Date::new(&wasm_bindgen::JsValue::from_f64(ms as f64));
    (
        d.get_full_year() as i64,
        d.get_month() as i64 + 1,
        d.get_date() as i64,
    )
}

fn today_day() -> i64 {
    let (y, m, d) = local_ymd(js_sys::Date::now() as i64);
    day_num(y, m, d)
}

/// 原版 getSectionLabel（日期边界与原版一致）。
fn section_label(ms: i64) -> String {
    let (y, m, _) = local_ymd(ms);
    let (ty, _, _) = local_ymd(js_sys::Date::now() as i64);
    let (yy, mm, dd) = local_ymd(ms);
    let diff = today_day() - day_num(yy, mm, dd);
    if diff <= 0 {
        i18n::t("group.today")
    } else if diff == 1 {
        i18n::t("group.yesterday")
    } else if diff <= 7 {
        i18n::t("group.week")
    } else if diff <= 30 {
        i18n::t("group.month")
    } else if y == ty {
        i18n::tf("group.month_of_year", &[("m", &m.to_string())])
    } else {
        i18n::tf("group.year", &[("y", &y.to_string())])
    }
}

/// 原版 matchesMemoSearch 的近似：标题 + doc 内文本类字段
/// （text/title/subtitle/source/name/label/alt/description/content
/// 与非 data: 的 url）拼接后子串匹配（小写）。
/// 性能：搜索文本按 (id, updatedAt) 缓存——旧实现每次按键都把
/// 全部备忘的 doc 序列化成 Value 再遍历，300 条备忘实测搜索
/// 600ms；缓存后每键只需在已拼好的小写文本里做子串匹配。
pub(crate) fn matches_search(memo: &Memo, q: &str) -> bool {
    if q.is_empty() {
        return true;
    }
    let q = q.to_lowercase();
    search_text(memo).contains(&q)
}

thread_local! {
    static SEARCH_CACHE: std::cell::RefCell<std::collections::HashMap<String, String>> =
        std::cell::RefCell::new(std::collections::HashMap::new());
}

fn search_text(memo: &Memo) -> String {
    let key = format!(
        "{}|{}|{}",
        memo.id,
        memo.updated_at.to_millis().unwrap_or(0),
        memo.title.as_deref().unwrap_or("")
    );
    if let Some(hit) = SEARCH_CACHE.with(|c| c.borrow().get(&key).cloned()) {
        return hit;
    }
    let mut fields: Vec<String> = vec![memo.title.clone().unwrap_or_default()];
    fn walk_value(v: &serde_json::Value, out: &mut Vec<String>) {
        match v {
            serde_json::Value::String(_) => {}
            serde_json::Value::Array(arr) => arr.iter().for_each(|x| walk_value(x, out)),
            serde_json::Value::Object(map) => {
                for (k, val) in map {
                    let kl = k.to_lowercase();
                    if matches!(
                        kl.as_str(),
                        "id" | "fileid" | "dataurl" | "blob" | "thumb" | "imagedata"
                    ) {
                        continue;
                    }
                    if let serde_json::Value::String(s) = val {
                        if matches!(
                            kl.as_str(),
                            "text" | "title" | "subtitle" | "source" | "name" | "label"
                                | "alt" | "description" | "content"
                        ) || (kl == "url" && !s.to_lowercase().starts_with("data:"))
                        {
                            out.push(s.clone());
                        }
                    } else {
                        walk_value(val, out);
                    }
                }
            }
            _ => {}
        }
    }
    fn walk_node(n: &mynote_core::Node, out: &mut Vec<String>) {
        if let Some(t) = &n.text {
            out.push(t.clone());
        }
        for v in n.extra.values() {
            walk_value(v, out);
        }
        if let Some(kids) = &n.children {
            for k in kids {
                walk_node(k, out);
            }
        }
    }
    for n in &memo.doc {
        walk_node(n, &mut fields);
    }
    let text = fields.join(" ").to_lowercase();
    SEARCH_CACHE.with(|c| {
        let mut map = c.borrow_mut();
        if map.len() > 512 {
            map.clear();
        }
        map.insert(key, text.clone());
    });
    text
}

pub(crate) fn build_groups(memos: &[Memo]) -> Vec<MemoGroup> {
    let mut pinned = MemoGroup {
        label: i18n::t("group.pinned"),
        images: Vec::new(),
        texts: Vec::new(),
    };
    let mut groups: Vec<MemoGroup> = Vec::new();
    for m in memos {
        let is_img = has_image(m);
        if m.pinned.unwrap_or(false) {
            if is_img { pinned.images.push(m.clone()) } else { pinned.texts.push(m.clone()) }
            continue;
        }
        let created = m.created_at.to_millis().unwrap_or(0);
        let stamp = if created > 0 { created } else { m.updated_at.to_millis().unwrap_or(0) };
        let label = section_label(stamp);
        if groups.last().map(|g| &g.label) != Some(&label) {
            groups.push(MemoGroup { label, images: Vec::new(), texts: Vec::new() });
        }
        let g = groups.last_mut().unwrap();
        if is_img { g.images.push(m.clone()) } else { g.texts.push(m.clone()) }
    }
    let mut out = Vec::new();
    if !pinned.images.is_empty() || !pinned.texts.is_empty() {
        out.push(pinned);
    }
    out.extend(groups);
    out
}

/// 原版 time.js is24hFormat：Intl formatToParts 无 dayPeriod
/// 即 24 小时制（结果缓存，进程内只探一次）。
pub(crate) fn is_24h() -> bool {
    use std::sync::OnceLock;
    static CACHE: OnceLock<bool> = OnceLock::new();
    *CACHE.get_or_init(|| {
        js_sys::eval("(()=>{try{return !new Intl.DateTimeFormat(undefined,{hour:'numeric'}).formatToParts(new Date(2024,0,1,13)).some(function(p){return p.type==='dayPeriod'})}catch(e){return false}})()")
            .ok()
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
    })
}

/// 原版 time.js timeAgo：今天→（24h 时 H:MM，否则上午/下午
/// h:MM）；昨天→昨天；同年 M/D；否则 Y/M/D。
pub(crate) fn time_ago(ts: &mynote_core::model::Timestamp) -> String {
    let Some(ms) = ts.to_millis() else {
        return i18n::t("list.now");
    };
    if ms <= 0 {
        return i18n::t("list.now");
    }
    let (y, m, d) = local_ymd(ms);
    let diff = today_day() - day_num(y, m, d);
    if diff <= 0 {
        let date = js_sys::Date::new(&wasm_bindgen::JsValue::from_f64(ms as f64));
        let h = date.get_hours();
        let min = date.get_minutes();
        if is_24h() {
            return format!("{h}:{min:02}");
        }
        let (ampm, h12) = if h < 12 {
            (i18n::t("time.am"), h % 12)
        } else {
            (i18n::t("time.pm"), h % 12)
        };
        let h12 = if h12 == 0 { 12 } else { h12 };
        format!("{ampm} {h12}:{min:02}")
    } else if diff == 1 {
        i18n::t("group.yesterday")
    } else {
        let (ty, _, _) = local_ymd(js_sys::Date::now() as i64);
        if y == ty {
            format!("{m}/{d}")
        } else {
            format!("{y}/{m}/{d}")
        }
    }
}

/// 封面 = doc 中第一个 attachment 块的 fileId（原版 ImageCard 口径：
/// 是否显示为图片由附件本体类型决定，见 CoverImg 的类型嗅探）。
pub(crate) fn cover_file_id(memo: &Memo) -> Option<String> {
    memo.doc.iter().find_map(|n| {
        if n.node_type.as_deref() == Some("attachment") {
            n.extra
                .get("fileId")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        } else {
            None
        }
    })
}

pub(crate) fn ptr_xy(e: &Event<PointerData>) -> (f64, f64) {
    let p = e.data.client_coordinates();
    (p.x, p.y)
}

/// 封面图：从 IndexedDB 取附件字节，嗅探图片类型后生成 Blob URL；
/// 非图片附件渲染原版的空封面占位（.img-cover 无图态）。
#[component]
pub(crate) fn CoverImg(file_id: String, gen: Signal<u32>) -> Element {
    let mut url = use_signal(|| Option::<String>::None);
    use_effect(move || {
        let fid = file_id.clone();
        spawn(async move {
            if let Some(bytes) = crate::idb::get_attachment(&fid).await {
                let is_img = matches!(
                    bytes.get(..4),
                    Some([0xFF, 0xD8, 0xFF, _])
                        | Some([0x89, 0x50, 0x4E, 0x47])
                        | Some([0x47, 0x49, 0x46, 0x38])
                ) || (bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP");
                if is_img {
                    if let Some(u) = crate::idb::blob_url(&bytes) {
                        url.set(Some(u));
                    }
                }
            }
        });
    });
    let _ = gen.read();
    rsx! {
        if let Some(u) = url.read().as_ref() {
            img { class: "img-cover", src: "{u}", alt: "" }
        } else {
            div { class: "img-cover" }
        }
    }
}

/// 标签 chips（原版 .glass-tag.item-tag：10px/18px 行高，
/// 全部渲染，>2 时多一个 +N，与原版一致）。
#[component]
fn TagList(tags: Vec<String>) -> Element {
    if tags.is_empty() {
        return rsx! {};
    }
    rsx! {
        div { class: "item-tag-list",
            for (i, tag) in tags.iter().enumerate() {
                span {
                    class: "glass-tag item-tag",
                    key: "{tag}-{i}",
                    style: "font-size:var(--font-10);padding:0 5px;border-radius:var(--radius-999);line-height:18px;white-space:nowrap;",
                    "{tag}"
                }
            }
            if tags.len() > 2 {
                span {
                    class: "glass-tag item-tag item-tag-more",
                    style: "font-size:var(--font-10);padding:0 5px;border-radius:var(--radius-999);line-height:18px;white-space:nowrap;",
                    "+{tags.len() - 2}"
                }
            }
        }
    }
}

/// 一行笔记（原版 SwipeRow / ImageCard 的合一实现）：
/// .swipe-wrapper > .swipe-actions（进度揭示） + .list-item / .img-card。
#[component]
pub(crate) fn MemoRow(
    memo: Memo,
    expand_text: Option<String>,
    on_open: EventHandler<String>,
    on_pin: EventHandler<String>,
    on_delete: EventHandler<String>,
    on_expand: EventHandler<()>,
    gen: Signal<u32>,
) -> Element {
    let mid = memo.id.to_string();
    let pinned = memo.pinned.unwrap_or(false);
    let is_image_card = has_image(&memo);
    let cover = cover_file_id(&memo);
    let summary = summarize(&memo, if is_image_card { 60 } else { 80 });
    let ago = time_ago(&memo.updated_at);
    let title_text = memo
        .title
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| i18n::t("list.untitled"));

    let mut off = use_signal(|| 0i32);
    let mut drag = use_signal(|| Option::<(f64, f64, i32, bool)>::None);
    let mut moved = use_signal(|| false);
    let offset = *off.read();
    let p = (offset.unsigned_abs() as f64 / 168.0).min(1.0);
    let pin_p = ((p - 0.35) / 0.65).clamp(0.0, 1.0);
    let del_p = (p / 0.55).clamp(0.0, 1.0);
    let dragging = drag.read().is_some();
    let pe = if offset == -168 { "auto" } else { "none" };
    let trans = if dragging {
        "none"
    } else {
        "transform 0.22s cubic-bezier(0.25,0.46,0.45,0.94)"
    };

    rsx! {
        div { class: "swipe-wrapper",
            div { class: "swipe-actions",
                button {
                    class: "swipe-action-btn",
                    style: "background:var(--color-warning);transform:translateX({(1.0 - pin_p) * 60.0}px);opacity:{pin_p};pointer-events:{pe};",
                    onclick: {
                        let mid = mid.clone();
                        move |_| {
                            off.set(0);
                            on_pin.call(mid.clone());
                        }
                    },
                    { icons::Icon(icons::IconProps { name: "pin".to_string(), size: 17, stroke_width: "2.2".to_string(), stroke: "var(--color-white)".to_string() }) }
                    span { if pinned { "{i18n::t(\"action.unpin\")}" } else { "{i18n::t(\"action.pin\")}" } }
                }
                button {
                    class: "swipe-action-btn",
                    style: "background:var(--color-danger);transform:translateX({(1.0 - del_p) * 30.0}px);opacity:{del_p};pointer-events:{pe};",
                    onclick: {
                        let mid = mid.clone();
                        move |_| {
                            off.set(0);
                            on_delete.call(mid.clone());
                        }
                    },
                    { icons::Icon(icons::IconProps { name: "del".to_string(), size: 17, stroke_width: "2.2".to_string(), stroke: "var(--color-white)".to_string() }) }
                    span { "{i18n::t(\"action.delete\")}" }
                }
            }
            if is_image_card {
                div {
                    class: "img-card",
                    style: "transform:translateX({offset}px);transition:{trans};touch-action:pan-y;",
                    onpointerdown: move |e: Event<PointerData>| {
                        let (x, y) = ptr_xy(&e);
                        drag.set(Some((x, y, offset, false)));
                    },
                    onpointermove: move |e: Event<PointerData>| {
                        let drag_cur = *drag.read();
                        if let Some((sx, sy, base, engaged)) = drag_cur {
                            let (x, y) = ptr_xy(&e);
                            let dx = x - sx;
                            let dy = y - sy;
                            let mut eng = engaged;
                            if !eng && dy.abs() > dx.abs() + 8.0 {
                                drag.set(None);
                                off.set(0);
                                return;
                            }
                            if !eng && dx.abs() > 5.0 { eng = true; }
                            if eng {
                                if dx.abs() > 8.0 { moved.set(true); }
                                off.set((base + dx as i32).clamp(-168, 0));
                                drag.set(Some((sx, sy, base, true)));
                            }
                        }
                    },
                    onpointerup: move |_| {
                        if drag.read().is_some() {
                            let cur = *off.read();
                            off.set(if cur < -55 { -168 } else { 0 });
                            drag.set(None);
                        }
                    },
                    onpointercancel: move |_| {
                        drag.set(None);
                        off.set(0);
                    },
                    onclick: {
                        let mid = mid.clone();
                        move |_| {
                            if offset != 0 { off.set(0); return; }
                            if *moved.read() { moved.set(false); return; }
                            on_open.call(mid.clone());
                        }
                    },
                    if let Some(fid) = cover {
                        CoverImg { file_id: fid, gen }
                    } else {
                        div { class: "img-cover" }
                    }
                    div { class: "img-body",
                        div { class: "img-text",
                            div { class: "t", style: "display:flex;align-items:center;gap:6px;width:100%;",
                                span { class: "img-card-title-text", "{title_text}" }
                                TagList { tags: summary.tags.clone() }
                            }
                            div { class: "m", style: "display:flex;align-items:center;gap:6px;",
                                span { "{ago}" }
                                span { class: "glass-label", style: "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;", "· {summary.preview}" }
                                if let Some(et) = expand_text.clone() {
                                    button {
                                        class: "expand-btn",
                                        onclick: move |e| {
                                            e.stop_propagation();
                                            on_expand.call(());
                                        },
                                        "{et}"
                                    }
                                }
                            }
                        }
                    }
                }
            } else {
                div {
                    class: "list-item",
                    style: "transform:translateX({offset}px);transition:{trans};touch-action:pan-y;",
                    onpointerdown: move |e: Event<PointerData>| {
                        let (x, y) = ptr_xy(&e);
                        drag.set(Some((x, y, offset, false)));
                    },
                    onpointermove: move |e: Event<PointerData>| {
                        let drag_cur = *drag.read();
                        if let Some((sx, sy, base, engaged)) = drag_cur {
                            let (x, y) = ptr_xy(&e);
                            let dx = x - sx;
                            let dy = y - sy;
                            let mut eng = engaged;
                            if !eng && dy.abs() > dx.abs() + 8.0 {
                                drag.set(None);
                                off.set(0);
                                return;
                            }
                            if !eng && dx.abs() > 5.0 { eng = true; }
                            if eng {
                                if dx.abs() > 8.0 { moved.set(true); }
                                off.set((base + dx as i32).clamp(-168, 0));
                                drag.set(Some((sx, sy, base, true)));
                            }
                        }
                    },
                    onpointerup: move |_| {
                        if drag.read().is_some() {
                            let cur = *off.read();
                            off.set(if cur < -55 { -168 } else { 0 });
                            drag.set(None);
                        }
                    },
                    onpointercancel: move |_| {
                        drag.set(None);
                        off.set(0);
                    },
                    onclick: {
                        let mid = mid.clone();
                        move |_| {
                            if offset != 0 { off.set(0); return; }
                            if *moved.read() { moved.set(false); return; }
                            on_open.call(mid.clone());
                        }
                    },
                    div { class: "item-left",
                        div { class: "item-title", style: "display:flex;align-items:center;gap:6px;width:100%;",
                            div { class: "item-title-main",
                                if pinned { span { class: "pin-dot" } }
                                span { class: "item-title-text", "{title_text}" }
                            }
                            TagList { tags: summary.tags.clone() }
                        }
                        div { class: "item-meta", style: "display:flex;align-items:center;gap:6px;",
                            span { style: "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;", "{ago}\u{00a0}\u{00a0}{summary.preview}" }
                            if let Some(et) = expand_text.clone() {
                                button {
                                    class: "expand-btn",
                                    onclick: move |e| {
                                        e.stop_propagation();
                                        on_expand.call(());
                                    },
                                    "{et}"
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/// 新建笔记卡（原版列表首行虚拟 SwipeRow：无滑动操作，
/// 标题新建笔记（弱色）、副行「现在  点击记录你的瞬间」）。
#[component]
pub(crate) fn NewCard(on_new: EventHandler<()>) -> Element {
    rsx! {
        div { class: "swipe-wrapper",
            div {
                class: "list-item",
                onclick: move |_| on_new.call(()),
                div { class: "item-left",
                    div { class: "item-title new-card-title", style: "display:flex;align-items:center;gap:6px;width:100%;",
                        div { class: "item-title-main",
                            span { class: "item-title-text", "{i18n::t(\"list.new_note\")}" }
                        }
                    }
                    div { class: "item-meta",
                        span { "{i18n::t(\"list.now\")}\u{00a0}\u{00a0}{i18n::t(\"list.new_note_sub\")}" }
                    }
                }
            }
        }
    }
}

/// 头像内容：Google 头像（localStorage google_avatar）或恐龙线稿玻璃圆。
#[component]
pub(crate) fn AvatarContent(size: u32) -> Element {
    let google = web_sys::window()
        .and_then(|w| w.local_storage().ok().flatten())
        .and_then(|s| s.get_item("google_avatar").ok().flatten())
        .filter(|s| !s.is_empty());
    rsx! {
        if let Some(src) = google {
            img {
                src: "{src}",
                alt: "",
                style: "width:{size}px;height:{size}px;border-radius:var(--radius-circle);display:block;object-fit:cover;",
            }
        } else {
            div {
                style: "width:{size}px;height:{size}px;backdrop-filter:var(--glass-control-filter);-webkit-backdrop-filter:var(--glass-control-filter);border-radius:var(--radius-circle);background:var(--glass-control-bg);border:0.5px solid var(--glass-control-border);display:flex;align-items:flex-end;justify-content:center;overflow:hidden;",
                span { dangerous_inner_html: "{icons::dino_markup(size - 8, 10)}" }
            }
        }
    }
}


