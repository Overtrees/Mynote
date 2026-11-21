//! 行内节点 ⇄ HTML：DOM 编辑器（contenteditable）与冻结块模型
//! 之间的桥。序列化把标记写成 b/i/u/s/code、链接写成 a；解析
//! 接受浏览器会产生的同义标签（strong/em）与未知标签（剥壳
//! 保字），并解码实体。往返保真是验收线（tests/inline_html.rs）。
//!
//! 高亮口径（与原版一致）：模型文本里以字面 ==重点== 存储；
//! 写 HTML 时切段包 <mark class="mynote-highlight">（编辑器与
//! 只读渲染同源，见 split_highlight）；解析时 <mark> 还原为
//! 字面 ==，往返无损。

use serde_json::{json, Map};

use crate::model::Node;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct Marks {
    bold: bool,
    italic: bool,
    underline: bool,
    strike: bool,
    code: bool,
}

impl Marks {
    fn to_extra(&self) -> Map<String, serde_json::Value> {
        let mut m = Map::new();
        if self.bold {
            m.insert("bold".into(), json!(true));
        }
        if self.italic {
            m.insert("italic".into(), json!(true));
        }
        if self.underline {
            m.insert("underline".into(), json!(true));
        }
        if self.strike {
            m.insert("strikethrough".into(), json!(true));
        }
        if self.code {
            m.insert("code".into(), json!(true));
        }
        m
    }
}

fn marks_of(node: &Node) -> Marks {
    let get = |k: &str| node.extra.get(k).and_then(|v| v.as_bool()).unwrap_or(false);
    Marks {
        bold: get("bold"),
        italic: get("italic"),
        underline: get("underline"),
        strike: get("strikethrough") || get("strike"),
        code: get("code"),
    }
}

fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            _ => out.push(c),
        }
    }
    out
}

fn unescape(text: &str) -> String {
    text.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&nbsp;", "\u{a0}")
        .replace("&amp;", "&")
}

/// 把文本按 ==高亮== 切段：(是否高亮, 片段)。未闭合的 == 不算
/// 高亮、原样保留。编辑器写 HTML 与只读渲染共用这一份切分。
pub fn split_highlight(text: &str) -> Vec<(bool, String)> {
    let mut out = Vec::new();
    let mut rest = text;
    loop {
        if let Some(start) = rest.find("==") {
            if let Some(end) = rest[start + 2..].find("==") {
                if start > 0 {
                    out.push((false, rest[..start].to_string()));
                }
                out.push((true, rest[start + 2..start + 2 + end].to_string()));
                rest = &rest[start + 2 + end + 2..];
                continue;
            }
        }
        if !rest.is_empty() {
            out.push((false, rest.to_string()));
        }
        break;
    }
    out
}

/// 行内节点序列 → HTML（写入 contenteditable 的初始内容）。
pub fn inlines_to_html(nodes: &[Node]) -> String {
    let mut out = String::new();
    for n in nodes {
        write_node(n, &mut out);
    }
    out
}

fn write_node(node: &Node, out: &mut String) {
    if node.block_type() == Some("link") {
        let url = node
            .extra
            .get("url")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        out.push_str("<a href=\"");
        out.push_str(&escape(url));
        out.push_str("\">");
        if let Some(kids) = &node.children {
            for k in kids {
                write_node(k, out);
            }
        }
        out.push_str("</a>");
        return;
    }
    if let Some(text) = &node.text {
        let marks = marks_of(node);
        let mut open = String::new();
        let mut close = String::new();
        let mut wrap = |tag: &str, on: bool| {
            if on {
                open.push_str("<");
                open.push_str(tag);
                open.push('>');
                close.insert_str(0, &format!("</{tag}>"));
            }
        };
        wrap("b", marks.bold);
        wrap("i", marks.italic);
        wrap("u", marks.underline);
        wrap("s", marks.strike);
        wrap("code", marks.code);
        for (hi, seg) in split_highlight(text) {
            if hi {
                out.push_str("<mark class=\"mynote-highlight\">");
            }
            out.push_str(&open);
            out.push_str(&escape(&seg));
            out.push_str(&close);
            if hi {
                out.push_str("</mark>");
            }
        }
        return;
    }
    if let Some(kids) = &node.children {
        for k in kids {
            write_node(k, out);
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
enum Token {
    Text(String),
    Open { name: String, href: Option<String> },
    Close { name: String },
    Br,
}

fn tokenize(html: &str) -> Vec<Token> {
    let mut toks = Vec::new();
    let bytes = html.as_bytes();
    let mut i = 0;
    let mut text_start = 0;
    let push_text = |toks: &mut Vec<Token>, s: &str| {
        if !s.is_empty() {
            toks.push(Token::Text(unescape(s)));
        }
    };
    while i < bytes.len() {
        if bytes[i] == b'<' {
            if let Some(end) = html[i..].find('>') {
                let tag = &html[i + 1..i + end];
                push_text(&mut toks, &html[text_start..i]);
                let tag = tag.trim();
                if tag.eq_ignore_ascii_case("br") || tag.eq_ignore_ascii_case("br/") {
                    toks.push(Token::Br);
                } else if let Some(name) = tag.strip_prefix('/') {
                    toks.push(Token::Close {
                        name: name.trim().to_ascii_lowercase(),
                    });
                } else {
                    let name: String = tag
                        .chars()
                        .take_while(|c| c.is_ascii_alphanumeric())
                        .collect::<String>()
                        .to_ascii_lowercase();
                    let href = if name == "a" {
                        extract_href(tag)
                    } else {
                        None
                    };
                    toks.push(Token::Open { name, href });
                }
                i += end + 1;
                text_start = i;
                continue;
            }
        }
        i += 1;
    }
    push_text(&mut toks, &html[text_start..]);
    toks
}

fn extract_href(tag: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let pos = lower.find("href")?;
    let rest = &tag[pos + 4..];
    let rest = rest.trim_start();
    let rest = rest.strip_prefix('=')?.trim_start();
    let quote = rest.chars().next()?;
    if quote == '"' || quote == '\'' {
        let end = rest[1..].find(quote)?;
        Some(unescape(&rest[1..1 + end]))
    } else {
        let end = rest
            .find(|c: char| c.is_whitespace())
            .unwrap_or(rest.len());
        Some(unescape(&rest[..end]))
    }
}

struct Parser {
    toks: Vec<Token>,
    pos: usize,
}

impl Parser {
    /// 解析到 `closing` 标签为止（None = 解析到结尾）。
    fn parse_until(&mut self, marks: Marks, closing: Option<&str>) -> Vec<Node> {
        let mut out: Vec<Node> = Vec::new();
        while self.pos < self.toks.len() {
            match self.toks[self.pos].clone() {
                Token::Text(t) => {
                    self.pos += 1;
                    if !t.is_empty() {
                        push_text_node(&mut out, &t, marks);
                    }
                }
                Token::Br => {
                    self.pos += 1;
                }
                Token::Close { name } => {
                    self.pos += 1;
                    if closing == Some(name.as_str()) {
                        return out;
                    }
                    // 不匹配的闭合标签：忽略
                }
                Token::Open { name, href } => {
                    self.pos += 1;
                    match name.as_str() {
                        "b" | "strong" => {
                            let mut m = marks;
                            m.bold = true;
                            let kids = self.parse_until(m, Some(&name));
                            extend_merging(&mut out, kids);
                        }
                        "i" | "em" => {
                            let mut m = marks;
                            m.italic = true;
                            let kids = self.parse_until(m, Some(&name));
                            extend_merging(&mut out, kids);
                        }
                        "u" => {
                            let mut m = marks;
                            m.underline = true;
                            let kids = self.parse_until(m, Some(&name));
                            extend_merging(&mut out, kids);
                        }
                        "s" | "strike" | "del" => {
                            let mut m = marks;
                            m.strike = true;
                            let kids = self.parse_until(m, Some(&name));
                            extend_merging(&mut out, kids);
                        }
                        "code" => {
                            let mut m = marks;
                            m.code = true;
                            let kids = self.parse_until(m, Some(&name));
                            extend_merging(&mut out, kids);
                        }
                        "mark" => {
                            // 高亮元素还原为字面 ==…==（存储口径）
                            let kids = self.parse_until(marks, Some("mark"));
                            extend_merging(&mut out, mark_to_literal(kids));
                        }
                        "a" => {
                            let kids = self.parse_until(marks, Some("a"));
                            let mut extra = Map::new();
                            if let Some(u) = href {
                                extra.insert("url".into(), json!(u));
                            }
                            out.push(Node {
                                text: None,
                                node_type: Some("link".into()),
                                id: None,
                                children: Some(kids),
                                extra,
                            });
                        }
                        _ => {
                            // 未知标签（span/div/font…）：剥壳保字
                            let kids = self.parse_until(marks, Some(&name));
                            extend_merging(&mut out, kids);
                        }
                    }
                }
            }
        }
        out
    }
}

/// <mark> 内容 → 字面 ==…==：去掉编辑占位用的零宽空格，首个
/// 文本节点加前缀 ==、末个加后缀 ==；无文本则整体消失。
fn mark_to_literal(kids: Vec<Node>) -> Vec<Node> {
    fn strip_zwsp(nodes: &mut [Node]) {
        for n in nodes.iter_mut() {
            if let Some(t) = &mut n.text {
                *t = t.replace('\u{200b}', "");
            }
            if let Some(kids) = &mut n.children {
                strip_zwsp(kids);
            }
        }
    }
    fn first_text(nodes: &mut [Node]) -> Option<&mut Node> {
        for n in nodes.iter_mut() {
            if n.text.is_some() {
                return Some(n);
            }
            if let Some(kids) = &mut n.children {
                if let Some(f) = first_text(kids) {
                    return Some(f);
                }
            }
        }
        None
    }
    fn last_text(nodes: &mut [Node]) -> Option<&mut Node> {
        for n in nodes.iter_mut().rev() {
            if n.text.is_some() {
                return Some(n);
            }
            if let Some(kids) = &mut n.children {
                if let Some(f) = last_text(kids) {
                    return Some(f);
                }
            }
        }
        None
    }
    let mut kids = kids;
    strip_zwsp(&mut kids);
    kids.retain(|n| n.text.as_deref() != Some(""));
    let Some(first) = first_text(&mut kids) else {
        return Vec::new();
    };
    if let Some(t) = &mut first.text {
        t.insert_str(0, "==");
    }
    let last = last_text(&mut kids).expect("first text exists");
    if let Some(t) = &mut last.text {
        t.push_str("==");
    }
    kids
}

/// 拼接子解析结果：边界上相邻的同标记文本节点合并。
fn extend_merging(out: &mut Vec<Node>, kids: Vec<Node>) {
    for kid in kids {
        if kid.is_text() {
            if let Some(last) = out.last_mut() {
                if last.is_text() && marks_of(last) == marks_of(&kid) {
                    if let (Some(a), Some(b)) = (&mut last.text, &kid.text) {
                        a.push_str(b);
                        continue;
                    }
                }
            }
        }
        out.push(kid);
    }
}

fn push_text_node(out: &mut Vec<Node>, text: &str, marks: Marks) {
    // 零宽空格只是编辑器里的光标占位符（mark 占位、实时高亮的
    // 边界锚点），不是内容：解析时统一剥掉。
    let text = &text.replace('\u{200b}', "");
    if text.is_empty() {
        return;
    }
    if let Some(last) = out.last_mut() {
        if last.is_text() && marks_of(last) == marks {
            if let Some(t) = &mut last.text {
                t.push_str(text);
                return;
            }
        }
    }
    out.push(Node {
        text: Some(text.to_string()),
        node_type: None,
        id: None,
        children: None,
        extra: marks.to_extra(),
    });
}

/// HTML → 行内节点序列（从 contenteditable 读回时用）。
pub fn html_to_inlines(html: &str) -> Vec<Node> {
    let mut parser = Parser {
        toks: tokenize(html),
        pos: 0,
    };
    let nodes = parser.parse_until(Marks::default(), None);
    if nodes.is_empty() {
        vec![Node {
            text: Some(String::new()),
            node_type: None,
            id: None,
            children: None,
            extra: Map::new(),
        }]
    } else {
        nodes
    }
}
