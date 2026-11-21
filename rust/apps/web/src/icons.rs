//! 图标：与原版 src/utils/svg.js 的 SvgIcon 同源——同一套 path 数据、
//! 同样的描边参数（strokeWidth 2.5、round cap/join、fill none），
//! 避免用 emoji/字符冒充图标造成视觉走样。

use dioxus::prelude::*;

/// 原版 PATHS（svg.js）+ 编辑器内联图标，name → path d（| 分隔多段）。
pub(crate) fn paths(name: &str) -> Option<&'static str> {
    Some(match name {
        "pin" => "M12 17v5|M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z",
        "del" => "M3 6h18|M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6|M10 11v6|M14 11v6|M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2",
        "back" => "M15 18l-6-6 6-6",
        "check" => "M5.5 12.3 10 16.7 18.8 7.8",
        "palette" => "M12 3.5a8.5 8.5 0 1 0 8.5 8.5c0-1.1-.9-2-2-2h-1.6a1.8 1.8 0 0 1-1.8-1.8V6.5A3 3 0 0 0 12 3.5Z",
        "undo" => "M1 4v6h6|M3.51 15a9 9 0 1 0 2.13-9.36L1 10",
        "redo" => "M23 4v6h-6|M20.49 15a9 9 0 1 1-2.12-9.36L23 10",
        "attach" => "M8.2 11.8l4.9-4.9a3 3 0 1 1 4.2 4.2l-6.5 6.5a5 5 0 1 1-7.1-7.1l7.1-7.1",
        "export" => "M12 3v12m0 0 4-4m-4 4-4-4M5 17v3h14v-3",
        "columns" => "M3 4h18v16H3z|M12 4v16",
        "heading" => "M5 5v14|M19 5v14|M5 12h14|M5 19h8",
        "heading2" => "M5 5v14|M19 5v14|M5 12h14|M7 19h10",
        "heading3" => "M6 6v12|M18 6v12|M6 12h12",
        "paragraph" => "M10 6h10|M4 10h16|M4 14h16|M4 18h8",
        "quote" => "M6 17h5v-6H7v-1a2 2 0 0 1 2-2V6a5 5 0 0 0-5 5v6zm8 0h5v-6h-4v-1a2 2 0 0 1 2-2V6a5 5 0 0 0-5 5v6z",
        "todo" => "M5 5h14v14H5z|m8 12 3 3 5-6",
        "divider" => "M3 12h18",
        "bold" => "M7 4h6a4 4 0 0 1 0 8H7z|M7 12h7a4 4 0 0 1 0 8H7z",
        "italic" => "M15 4H9|M15 4l-6 16|M15 20H9",
        "highlight" => "M4 16 14 6l4 4L8 20H4z|M12 8l4 4|M3 21h14",
        "codeBlock" => "M4 4h16v16H4z|m9 9-3 3 3 3|m15 9 3 3-3 3",
        "list" => "M9 6h12|M9 12h12|M9 18h12|M4 6h.01|M4 12h.01|M4 18h.01",
        "olist" => "M3 7h2V4H3m0 5h2|M3 12h2v3H3m0 0 1.5-1.5|M3 20h2v-3H3m0 0 1.5 1.5|M9 5h12|M9 12h12|M9 19h12",
        "callout" => "M4 4h16v16H4z|M8 9h8|M8 13h6|M6 7v10",
        "imgTextCard" => "M4 4h16v16H4z|M6 6h12v7H6z|M7 16h10",
        "imageTextRow" => "M3 5h8v14H3z|M14 5h7v14h-7z|M5 9h4",
        "link" => "M10 13a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.7 1.7|M14 11a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.7-1.7",
        "code" => "m8 8-4 4 4 4|m16 8 4 4-4 4",
        "strikethrough" => "M14 7a3 3 0 0 0-3-2H9a3 3 0 0 0-1 5.8|M5 12h14|M8 16a3 3 0 0 0 3 3h2a3 3 0 0 0 3-3",
        "music" => "M8 19a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z|M17 17a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z|M10.5 16V5l9-2v11",
        "image" => "M4 5h16v14H4z|M8 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z|m4 16 5-5 3 3 3-4 5 6",
        "gallery" => "M5 7h15v14H5z|M4 17H3V3h15v2",
        "warning" => "M12 2L2 20h20L12 2z|M12 10v4|M12 17h.01",
        _ => return None,
    })
}

/// 生成与原版 SvgIcon 等价的 <svg> 标记字符串。
pub(crate) fn svg_markup(name: &str, size: u32, stroke_width: &str, stroke: &str) -> String {
    let Some(d) = paths(name) else { return String::new() };
    let mut out = format!(
        "<svg viewBox=\"0 0 24 24\" width=\"{size}\" height=\"{size}\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">"
    );
    for p in d.split('|') {
        out.push_str(&format!(
            "<path d=\"{p}\" stroke=\"{stroke}\" stroke-width=\"{stroke_width}\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"/>"
        ));
    }
    out.push_str("</svg>");
    out
}

/// 描边图标组件（dangerous_inner_html 注入与原版一致的 SVG）。
#[component]
pub(crate) fn Icon(name: String, size: u32, stroke_width: String, stroke: String) -> Element {
    let markup = svg_markup(&name, size, &stroke_width, &stroke);
    rsx! {
        span {
            style: "display:inline-flex;align-items:center;justify-content:center;",
            dangerous_inner_html: "{markup}",
        }
    }
}

/// 恐龙线稿（原版头像/编辑器头像共用，viewBox 512，stroke 图标弱色）。
pub(crate) fn dino_markup(size: u32, translate_y: i32) -> String {
    let paths = [
        "M 90,460 L 90,170 C 90,110 140,70 210,70 L 380,95 C 440,95 470,130 470,185 C 470,225 450,240 410,245 C 350,250 280,230 210,265 C 190,275 190,295 210,310 C 270,350 350,380 410,360 C 435,350 440,325 410,315",
        "M 160,330 C 180,380 230,440 280,460",
        "M 240,365 C 220,400 240,440 310,460",
        "M 90,460 L 310,460",
        "M 415,135 C 425,140 435,150 435,160",
        "M 230,115 C 260,95 310,120 355,140",
        "M 255,140 C 255,170 290,195 320,185 C 345,175 350,150 335,135",
        "M 290,145 C 290,165 315,165 315,150",
        "M 250,243 L 255,265 L 265,243 M 275,245 L 282,270 L 292,245 M 302,246 L 310,273 L 320,247 M 330,248 L 340,275 L 350,248 M 360,249 L 370,274 L 380,248 M 390,248 L 400,270 L 408,246 M 415,244 L 425,263 L 432,240 M 438,235 L 448,252 L 452,228",
        "M 250,323 L 255,305 L 263,326 M 273,329 L 280,308 L 288,333 M 298,336 L 306,313 L 314,340 M 324,343 L 333,318 L 341,346 M 351,348 L 361,323 L 369,351 M 379,352 L 389,328 L 396,353 M 404,351 L 413,330 L 418,348",
    ];
    let mut out = format!(
        "<svg viewBox=\"0 0 512 512\" width=\"{size}\" height=\"{size}\" fill=\"none\" stroke=\"var(--color-icon-muted)\" stroke-width=\"22\" stroke-linecap=\"round\" stroke-linejoin=\"round\" style=\"transform: translateY({translate_y}px)\">"
    );
    for p in paths {
        out.push_str(&format!("<path d=\"{p}\"/>"));
    }
    out.push_str("</svg>");
    out
}

/// 搜索放大镜（原版 memo-list 内联 SVG：circle + line，stroke 次级色）。
pub(crate) fn search_markup(size: u32) -> String {
    format!(
        "<svg viewBox=\"0 0 24 24\" width=\"{size}\" height=\"{size}\" fill=\"none\" stroke=\"var(--text-secondary)\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"11\" cy=\"11\" r=\"8\"/><line x1=\"21\" y1=\"21\" x2=\"16.65\" y2=\"16.65\"/></svg>"
    )
}

/// ••• 圆点（原版 editor-fab.right：三个 fill currentColor 圆）。
pub(crate) fn dots_markup() -> String {
    "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" width=\"22\" height=\"22\" fill=\"currentColor\"><circle cx=\"5\" cy=\"12\" r=\"2\"/><circle cx=\"12\" cy=\"12\" r=\"2\"/><circle cx=\"19\" cy=\"12\" r=\"2\"/></svg>".to_string()
}

/// 导出图标（原版 BackupView 内联 SVG 逐字：上箭头 + 托盘，
/// 28px，stroke accent，strokeWidth 2）。
pub(crate) fn export_icon_markup() -> String {
    "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" width=\"28\" height=\"28\" fill=\"none\" stroke=\"var(--color-accent)\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\"/><polyline points=\"17 8 12 3 7 8\"/><line x1=\"12\" y1=\"3\" x2=\"12\" y2=\"15\"/></svg>".to_string()
}

/// 导入图标（同上，下箭头 + 托盘）。
pub(crate) fn import_icon_markup() -> String {
    "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" width=\"28\" height=\"28\" fill=\"none\" stroke=\"var(--color-accent)\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\"/><polyline points=\"7 10 12 15 17 10\"/><line x1=\"12\" y1=\"15\" x2=\"12\" y2=\"3\"/></svg>".to_string()
}

/// Callout 图标（原版 editor.md.js CALLOUT_ICONS 五路径逐字，
/// stroke 走 --md-callout-*-icon 令牌，18px）。
pub(crate) fn callout_icon_markup(style: &str) -> String {
    let inner = match style {
        "warning" => "<path d=\"M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z\"/><line x1=\"12\" y1=\"9\" x2=\"12\" y2=\"13\"/><line x1=\"12\" y1=\"17\" x2=\"12.01\" y2=\"17\"/>",
        "tip" => "<polygon points=\"12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2\"/>",
        "important" => "<path d=\"M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z\"/><line x1=\"4\" y1=\"22\" x2=\"4\" y2=\"15\"/>",
        "caution" => "<circle cx=\"12\" cy=\"12\" r=\"10\"/><line x1=\"15\" y1=\"9\" x2=\"9\" y2=\"15\"/><line x1=\"9\" y1=\"9\" x2=\"15\" y2=\"15\"/>",
        _ => "<circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"M12 16v-4\"/><path d=\"M12 8h.01\"/>",
    };
    format!(
        "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"var(--md-callout-{style}-icon)\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\">{inner}</svg>"
    )
}

/// 返回箭头（原版 editor-fab：polyline 15 18 9 12 15 6）。
pub(crate) fn back_markup() -> String {
    "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" width=\"22\" height=\"22\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><polyline points=\"15 18 9 12 15 6\"/></svg>".to_string()
}
