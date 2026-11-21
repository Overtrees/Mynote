//! 行内 HTML 桥验收：模型 → HTML → 模型往返保真；浏览器风格
//! 输入（strong/em/未知标签/实体）解析正确。

use mynote_core::{html_to_inlines, inlines_to_html, Node};
use serde_json::{json, Map};

fn text(s: &str, marks: &[&str]) -> Node {
    let mut extra = Map::new();
    for m in marks {
        extra.insert(m.to_string(), json!(true));
    }
    Node {
        text: Some(s.to_string()),
        node_type: None,
        id: None,
        children: None,
        extra,
    }
}

fn roundtrip(nodes: Vec<Node>) {
    let html = inlines_to_html(&nodes);
    let back = html_to_inlines(&html);
    assert_eq!(back, nodes, "roundtrip via html: {html}");
}

#[test]
fn plain_cjk_roundtrip() {
    roundtrip(vec![text("冬日里的实用技巧", &[])]);
}

#[test]
fn marks_roundtrip() {
    roundtrip(vec![
        text("粗", &["bold"]),
        text("斜", &["italic"]),
        text("粗斜", &["bold", "italic"]),
        text("线", &["underline"]),
        text("删", &["strikethrough"]),
        text("码", &["code"]),
        text("普通", &[]),
    ]);
}

#[test]
fn entities_roundtrip() {
    roundtrip(vec![text("a<b & \"c\" > d", &[])]);
}

#[test]
fn link_roundtrip() {
    let link = Node {
        text: None,
        node_type: Some("link".into()),
        id: None,
        children: Some(vec![text("站点", &["bold"])]),
        extra: {
            let mut m = Map::new();
            m.insert("url".into(), json!("https://example.com/?a=1&b=2"));
            m
        },
    };
    roundtrip(vec![text("看", &[]), link]);
}

#[test]
fn browser_style_input() {
    let nodes = html_to_inlines("<strong>粗</strong>与<em>斜</em><br>次行<span style=\"x\">净</span>");
    assert_eq!(
        nodes,
        vec![
            text("粗", &["bold"]),
            text("与", &[]),
            text("斜", &["italic"]),
            text("次行净", &[]),
        ]
    );
}

#[test]
fn highlight_writes_mark_and_roundtrips() {
    let nodes = vec![text("前==重点==后", &[])];
    let html = inlines_to_html(&nodes);
    assert!(
        html.contains("<mark class=\"mynote-highlight\">重点</mark>"),
        "html: {html}"
    );
    assert_eq!(html_to_inlines(&html), nodes);
}

#[test]
fn mark_parses_back_to_literal() {
    let nodes = html_to_inlines("前<mark class=\"mynote-highlight\">重点</mark>后");
    assert_eq!(nodes, vec![text("前==重点==后", &[])]);
}

#[test]
fn highlight_with_marks_roundtrip() {
    roundtrip(vec![text("==粗亮==", &["bold"]), text("尾", &[])]);
}

#[test]
fn unclosed_highlight_stays_literal() {
    let nodes = vec![text("只有==开头", &[])];
    let html = inlines_to_html(&nodes);
    assert!(!html.contains("<mark"), "html: {html}");
    assert_eq!(html_to_inlines(&html), nodes);
}

#[test]
fn zwsp_caret_anchors_are_stripped() {
    // 实时高亮在 mark 后放零宽空格做光标锚点，回写时不能进模型
    let nodes = html_to_inlines("前\u{200b}后<mark>亮\u{200b}</mark>");
    assert_eq!(nodes, vec![text("前后==亮==", &[])]);
}

#[test]
fn zwsp_only_mark_vanishes() {
    // 斜杠高亮在空选区时插入 <mark>零宽空格</mark> 占位等待键入，
    // 未键入就同步时不应在模型里留下痕迹
    let nodes = html_to_inlines("<mark class=\"mynote-highlight\">\u{200b}</mark>");
    assert_eq!(nodes, vec![text("", &[])]);
}

#[test]
fn empty_html_gives_empty_text_node() {
    let nodes = html_to_inlines("");
    assert_eq!(nodes.len(), 1);
    assert_eq!(nodes[0].text.as_deref(), Some(""));
}
