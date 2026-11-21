# Wiki 链接与反向链接 — 功能规格（原版逆向 · 供 Rust 版 1:1 实现）

> 来源：原版 Web 应用源码逐行读取（2026-11-21）。本文只描述原版行为与 Rust 落点，不含实现代码。
> 一句话模型：**纯按标题（title）的文本链接，零新增存储字段**。文档里存的永远是 `[[标题]]` 字面文本；目标解析、反向链接计算全部在运行时现算，无索引、无 id 引用。

---

## 1. 核心函数与数据流（原版）

### 1.1 标题归一化 — `wikiTitleKey(value)`
- 位置：`src/app/editor.js:2-4`
- 定义：`String(value || '').split('#')[0].trim().toLocaleLowerCase()`
- 语义：剥掉 `#` 及其后的锚点部分 → trim → 本地化小写。这是全系统唯一的匹配键。

### 1.2 目标提取 — `memoWikiTargets(memo) -> Set<key>`
- 位置：`src/app/editor.js:18-28`，依赖 `collectWikiSource`（`editor.js:5-17`）
- 数据流：
  1. `collectWikiSource(memo.doc)` 递归遍历 doc JSON，收集所有节点上键名为 `text` 的字符串值；**类型匹配 `/^(code|codeblock|fencedcode|inlinecode)$/` 的节点整棵子树跳过**（代码块内容不计）。
  2. 全部文本以 `'\n'` join 后，先剥行内代码：`.replace(/(`+)([\s\S]*?)\1/g, '')`（反引号对包裹的内容整段删除，围栏代码块也是纯文本里的反引号，一并被此式清掉）。
  3. 再删转义写法：`.replace(/\\\[\[[^\]\r\n]*\]\]/g, '')`（`\[[...]]` 不计为链接）。
  4. 正则提取 `/\[\[([^\]\r\n|]+)(?:\|[^\]\r\n]+)?\]\]/g`，每个 target 经 `wikiTitleKey` 归一化后入 Set（空键丢弃）。
- 注意：收集范围是 doc 里**任意**节点的 `text` 叶（段落、标题、待办、引用、图文说明等都算），不限段落块。

### 1.3 反向链接计算 — Editor 组件内联过滤
- 位置：`src/app/editor.js:114-116`（`Editor` 组件体，每次渲染现算）
- 数据来源：props `relatedMemos` = 列表页的**全部备忘数组**（`src/app/memo-list.js:471` 以 `relatedMemos: memos` 传入）。
- 条件：`candidate.id !== memo.id && wikiTitleKey(title) 非空 && memoWikiTargets(candidate).has(wikiTitleKey(title))`
- **关键细节**：匹配用的是 `title` **state**（正在编辑的标题），不是 `memo.title`。title state 初值在 `editor.js:113`：`memo.title === "无标题" ? "" : memo.title`——即字面标题为「无标题」的备忘，编辑态标题视为空。标题失焦提交后 state 更新，反向链接随之按新标题重算。
- 顺序：保持 `relatedMemos` 数组原序（存储序），不排序、不限量。

### 1.4 目标解析与打开 — `openWikiTarget(target)`
- 位置：`src/app/memo-list.js:291-302`，作为 `onOpenWikiLink` prop 注入 Editor（`memo-list.js:471`）。
- 流程：
  1. `requestedTitle = String(target || '').split('#')[0].trim()`；为空 → 直接返回（无操作）。
  2. `key = requestedTitle.toLocaleLowerCase()`；在 memos 中 `find` **第一篇** `String(candidate.title || '').trim().toLocaleLowerCase() === key` 的备忘。
  3. 命中 → `openEditor(match)`；未命中 → `handleNew(requestedTitle)` **新建一篇同名备忘并打开**。
- `handleNew(initialTitle)`（`memo-list.js:257-276`）：新备忘 `{id: genId(), title: String(initialTitle||'').trim() || "无标题", doc: [一个空段落], pinned: false, createdAt/updatedAt: now}`，插入列表头部、设为正在编辑、自动聚焦首段。

---

## 2. `[[…]]` 语法解析点（四处）

| # | 场景 | 位置 | 规则 |
|---|------|------|------|
| 1 | 编辑器渲染（成链） | `src/editor/editor.md.js:299-304` `preprocessInlineExtensions` | 见 §2.1 |
| 2 | md 段落分类 | `src/editor/editor.md.js:341-343` `looksLikeMarkdown` | 正则含 `\[\[[^\]]+\]\]`：**仅含 `[[…]]` 的段落也判为 Markdown**，进 md 预览渲染（从而可点） |
| 3 | 列表卡片预览 strip | `src/editor/editor.md.js:344-345` `stripMarkdownForPreview` | 先 `[[a\|b]] → $2`（显示别名），后 `[[a]] → $1`（显示目标）。模式为 `\[\[([^\]|]+)\|([^\]]+)\]\]` 与 `\[\[([^\]]+)\]\]`（不排除换行，与渲染端略异） |
| 4 | 目标提取（反向链接用） | `src/app/editor.js:18-28` | 见 §1.2 |
| — | 搜索 | `src/app/memo-list.js:26-31` `matchesMemoSearch` | **无 wiki 特殊处理**：标题 + doc 原始文本拼接后子串匹配，`[[` `]]` 就是普通字符（搜目标名能命中含链接的备忘） |
| — | 导出 HTML | `src/app/editor/export.js:137-138` | 导出走同一 `preprocessExtendedMarkdown` 管线，`[[…]]` 在导出 HTML 里同样转成 wiki 锚点（`href="#"`，导出后不可达） |

### 2.1 渲染端成链规则（editor.md.js:299-304）
- 正则：`/\[\[([^\]\r\n|]+)(?:\|([^\]\r\n]+))?\]\]/g`——target 段禁含 `]`、换行、`|`；别名段禁含 `]`、换行。
- 管线位置：`preprocessExtendedMarkdown`（`editor.md.js:305-313`）顺序为 protectCodeSegments（代码段先 stash 保护）→ … → preprocessInlineExtensions。故**代码块/行内代码里的 `[[…]]` 不成链**。
- 生成 HTML（属性逐字）：
  `<a class="mynote-wiki-link" href="#" data-note-title="{target}" title="打开笔记：{target}">{label}</a>`
  - `target = rawTarget.trim()`；trim 后为空 → 返回原文不成链。
  - `label = rawLabel == null ? target : rawLabel.trim()`，最终显示 `label || target`（别名为空白时回落显示 target）。
  - `data-note-title` 存的是 **trim 后的完整 target（含 `#锚点`）**；剥 `#` 发生在导航端（§1.4）。
  - target/label 均经 `escapeHTML`。
- 适用范围：只有走 md 渲染管线的文本成链——即 md 源段落的预览态（普通段落因 §2 第 2 行同样归入 md 预览）。标题/待办/引用等块的行内叶渲染**没有** wiki 转换代码路径（全仓 `wiki` 命中仅 editor.md.js 一处渲染）。

---

## 3. 点击行为

### 3.1 正文 wiki 链接点击（优先于 md 预览点改）
- 位置：`src/app/editor/use-editor-dom.js:98-115`（编辑器 body 委托 click；`onOpenWikiLink` 由 `use-editor-dom.js:47` opts 注入，Editor 在 `editor.js:2313` 传入）。
- 顺序：此分支在「点击 md 预览块回源码编辑」分支（`use-editor-dom.js:117+`）**之前**，注释原文口径为「双链优先导航」。
- 流程：命中 `a.mynote-wiki-link[data-note-title]` → `preventDefault` → 取 `dataset.noteTitle` → **先 `flushAutoSave()` 落盘当前编辑**，Promise 完成后 `onOpenWikiLink(targetTitle)`；保存失败时 `console.warn('[此刻] wiki navigation save', error)` 并**仍然导航**。无 `flushAutoSave` 时退化为 `triggerAutoSave()` + 立即导航。

### 3.2 反向链接条目点击
- 位置：`src/app/editor.js:3280-3282`（button 的 onClick）。
- 直接 `onOpenWikiLink(sourceMemo.title || '')`——**不走 §3.1 的 flushAutoSave 包装**（保存依赖编辑器切换/卸载自身的机制）。因为来源备忘必然存在，此路径永远命中打开、不会新建。

### 3.3 导航结果
- 命中已有备忘 → 在编辑器中打开该备忘（列表页 `setEditingMemoId`，Editor 以 `key={memo.id}` 强制重挂载，`memo-list.js:471`）。
- 未命中 → 新建同名备忘并打开（§1.4）——**不存在的链接不是死链，点击即建**。
- 链接外观对「目标存在/不存在」**无任何区分**（不预判存在性）。

---

## 4. 反向链接区块（编辑器内）

### 4.1 位置与 DOM
- 位置：`src/app/editor.js:3271-3284`。在 `.detail` 根内、`.editor-spread`（含 `.editor-body` 的正文包裹层）**之后**渲染，即正文区下方、编辑器根的末尾（文件 input 等浮层元素之前）。不在 contentEditable 内。
- 显隐：`backlinks.length > 0` 才渲染整区块；为空无占位、不留白。
- DOM 结构：
  ```html
  <section class="wiki-backlinks" aria-label="引用当前笔记的反向链接">
    <h2 class="wiki-backlinks-title">反向链接</h2>
    <div class="wiki-backlinks-list">
      <button type="button" class="wiki-backlink" key={来源备忘 id}>
        {来源备忘 title || "无标题"}
      </button>
      …
    </div>
  </section>
  ```
- 条目内容只有来源备忘的**标题文本**（无摘要、无时间、无上下文片段）；标题为空时显示「无标题」。

### 4.2 文案（原版硬编码中文，不走语言包）
- 区块标题：`反向链接`；aria-label：`引用当前笔记的反向链接`；链接 title 属性：`打开笔记：{target}`。

---

## 5. UI 规格（逐值，`src/styles/editor.css`）

### 5.1 正文 wiki 链接（editor.css:329-334）
```css
.markdown-render .mynote-wiki-link, .editor-body .mynote-wiki-link {
  color: var(--md-link-color);
  text-decoration: underline; text-decoration-style: dashed;
  text-underline-offset: 0.18em;
}
…:hover { text-decoration-style: solid; }
…:focus-visible { outline: 3px solid var(--md-focus-ring); outline-offset: 3px; border-radius: var(--radius-2); }
```

### 5.2 反向链接区块（editor.css:359-365）
```css
.wiki-backlinks { box-sizing: border-box; width: min(100%, 720px); margin: 24px auto 0; padding: 14px 0 0; border-top: 1px solid var(--border-color); }
.wiki-backlinks-title { margin: 0 0 6px; color: var(--text-secondary); font-size: var(--font-12); font-weight: 650; }
.wiki-backlinks-list { display: flex; flex-direction: column; gap: 2px; }
.wiki-backlink { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 44px; padding: 6px 8px; border: 0; border-radius: var(--radius-10); background: transparent; color: var(--md-link-color); font: inherit; text-align: left; cursor: pointer; }
.wiki-backlink:hover, .wiki-backlink:active { background: var(--fill-hover); }
.wiki-backlink:focus-visible { outline: 3px solid var(--md-focus-ring); outline-offset: 2px; }
.wiki-backlink::before { content: "↗"; flex: none; color: var(--text-secondary); }
```
要点：区块与正文的分隔 = margin-top 24px + border-top + padding-top 14px；宽度上限 720px 居中（正文 `.editor-pad` 横向 padding 16px 在包裹层上，区块在其外，靠 `margin: … auto` 居中）；条目是整行 button，前置 `↗` 图标字形（次级色），标题文字用链接色；条目间 gap 仅 2px、每条 min-height 44px。

### 5.3 令牌值（`src/styles/tokens.css`）
| 令牌 | 浅色 | 深色 |
|---|---|---|
| `--md-link-color` | `#005bbb`（:18） | `#72b7ff`（:203） |
| `--md-focus-ring` | `#005bbb`（:19） | `#72b7ff`（:204） |
| `--border-color` | `rgba(0,0,0,0.05)`（:8） | `rgba(255,255,255,0.1)`（:201） |
| `--fill-hover` | `rgba(127,127,127,0.06)`（:85） | 以 tokens.css 深色段为准 |
| `--font-12` | `12px`（:124） | 同 |
| `--radius-10` | `10px`（:141） | 同 |

---

## 6. 边界情况清单

1. **目标不存在**：链接样式无区分；点击 → 新建同名备忘（标题为 trim 后的请求名）并打开、聚焦首段。
2. **同名多篇**：导航取 memos 数组顺序**第一篇**；反向链接的来源可以是多篇同名备忘并列出现（按 id 区分 key）。
3. **自引用**：反向链接按 id 排除当前备忘自身；但正文点 `[[自己的标题]]` 会命中打开自己（若自己是第一同名匹配，等于重开当前篇）。
4. **重命名**：链接是纯文本，改名**不迁移、不提示**——旧名链接即刻转指「无此名」状态（点击将新建一篇旧名备忘）；新名立刻能被已有 `[[新名]]` 命中。编辑器内反向链接按正在编辑的 title state 实时重算（标题失焦提交后生效）。
5. **无标题备忘**：title state 为 `""`（字面「无标题」亦然，见 §1.3）→ `wikiTitleKey` 为空 → **永远不会出现在任何备忘的反向链接目标位**；但 `[[无标题]]` 点击仍可按字面标题找到/新建一篇标题为「无标题」的备忘（两端不对称，原版如此）。
6. **`#锚点`**：`[[标题#章节]]` 显示文本含 `#章节`（label 缺省 = 完整 target），匹配键与导航都剥 `#` 后部分，只打开备忘、不定位章节。
7. **别名空**：`[[目标|]]` / `[[目标| ]]` → 显示回落为 target；**target 空**：`[[|x]]`、`[[ ]]` → 不成链、原文保留（渲染端）；提取端空键丢弃。
8. **代码与转义**：代码块节点、行内代码、围栏内的 `[[…]]` 不成链、不计入目标提取；`\[[…]]` 转义写法不计入目标提取。
9. **非法字符**：target 段含 `]`、换行或 `|` 时不成链（别名段可含 `|`）。
10. **归一化边界**：仅 trim + 本地化小写；不做全角/半角、繁简等额外归一化——`[[Title]]` 与标题 `title` 互相命中，`[[ 标题 ]]`（内侧空格）渲染端 trim 后命中、提取端经 wikiTitleKey trim 后命中。
11. **反向链接为空**：整区块不渲染。
12. **来源变更**：来源备忘删除/改名/删掉链接文本后，下次打开目标备忘时条目自然消失（每次渲染现算，无持久化索引需同步）。
13. **保存时序差异**：正文链点击显式先 flush 保存再导航（失败也导航、只告警）；反向链接条目点击不显式 flush（见 §3.2）——实现时须保证切篇前当前编辑不丢（见 §8 落点注记）。
14. **性能口径**：原版每次 Editor 渲染对每篇候选备忘全量跑 `memoWikiTargets`（正则扫全 doc），无缓存。备忘量级小（个人笔记）可接受；Rust 实现可 1:1 直算，不必预建索引。

---

## 7. 诊断日志点（原版实情）

- **没有**任何 Diag/诊断日志埋点（全仓 `wiki` 相关日志仅一处）。
- 唯一日志：`use-editor-dom.js:107` `console.warn('[此刻] wiki navigation save', error)`——正文链导航前保存失败时。
- （Rust 项目硬规矩是每模块带诊断日志，故 §8 建议新增 WIKI 标签日志，属超出原版的项目规矩项，需在实现报告中注明。）

---

## 8. Rust 落点建议（`rust/apps/web`，含现状差距）

### 8.1 新增模块 `src/wiki.rs`（纯函数，可单测）
- `wiki_title_key(value: &str) -> String`：`split('#').next()` → trim → `to_lowercase()`（原版 `toLocaleLowerCase`，Rust 用 Unicode 小写近似即可，注明差异）。
- `collect_wiki_source(node: &Node, out: &mut Vec<String>)`：递归走 mynote-core 的 `Node` 树，type（小写）∈ {code, codeblock, fencedcode, inlinecode} 跳过子树；收集 `text` 叶。注意 core 的 Node 模型是结构化字段而非任意 JSON——需按 core 实际形状遍历 children/attrs 中的文本（实现时以 core `model.rs` 为准）。
- `memo_wiki_targets(memo: &Memo) -> HashSet<String>`：join('\n') → 手写剥反引号对（找成对 `` ` `` 序列删除其间内容）→ 删 `\[[...]]` 段 → 手写扫描 `[[target(|label)?]]`（规则同 §1.2 正则：target 禁 `]`/换行/`|`）。**不要为此引入 regex**（项目刚定调手写，见 list.rs 现有 scan_replace 先例）。
- `compute_backlinks(memos: &[Memo], current_id, live_title: &str) -> Vec<Memo>`（或返回引用/id+title 列表）：条件同 §1.3。

### 8.2 预览 strip —— 已就绪，无需动
- `src/list.rs` 的 `strip_markdown` 已含 wiki 两式（`try_wiki_pipe`/`try_wiki`，别名优先），与原版 §2 第 3 行等价。

### 8.3 渲染成链 —— `src/blocks.rs`（主要差距所在）
- 现状：`md_classify` 只覆盖 Code/Callout/List 三类；仅含 `[[…]]` 的段落在原版经 `looksLikeMarkdown` 归入 md 预览，在 Rust 里 `md_classify` 返回 None → 当普通段落渲染，`[[…]]` 是死文本。
- 建议：给 `MdKind` 增加一类（如 `Rich(String)` 或在 MdPreview 的 None 臂处理）：段落文本含合法 `[[…]]` 时走「行内分段渲染」——把文本切成普通文本段与 wiki 链接段，链接段渲染为
  `a { class: "mynote-wiki-link", href: "#", "data-note-title": "{target}", title: "{t(editor.wiki_open_title, target)}", "{label}" }`。
- 同理，原版 md 管线对 Callout 正文行、列表项内的 `[[…]]` 也成链（marked 全量渲染）；Rust 的结构化 Callout/List 预览目前输出纯文本行——此点为**已知次级差距**，建议同一「行内分段渲染」helper 复用到 callout body 与 list items，一并补齐。
- 点击回源码编辑的既有逻辑（editor.rs 的 mdsrc 分支）须让位：见 §8.4 优先级。

### 8.4 点击与导航 —— `src/editor.rs` + `src/main.rs`
- Editor 新 prop：`on_open_wiki: EventHandler<String>`（参数为 target 原文标题）。main.rs 侧实现解析器（对应 `openWikiTarget`）：
  - 剥 `#` → trim → 空则返回；
  - 在 `data` 中找第一篇 title trim+小写相等者 → `selected.set(Some(id))`；
  - 未命中 → 按 main.rs 现有新建备忘代码路径（列表页新建按钮同款：生成 id、空段落 doc、pinned false、时间戳）但 title 用请求名（trim 后为空才回落 `t("editor.untitled")`），persist + diag + `selected.set`。
- 正文链点击：在 EDITOR_JS 桥的 click 处理中，**在 mdsrc（点预览回编辑）判断之前**加分支：`e.target.closest('a.mynote-wiki-link[data-note-title]')` → preventDefault → `dioxus.send({op:'wikiNav', title})`；Rust 侧收到后先走既有 persist 落盘当前 doc/title，再调 `on_open_wiki`（对应原版 flush-then-navigate；保存失败照样导航 + diag 记录，对应原版 console.warn 的语义升级为 diag WIKI 标签）。
- **重挂载注记（重要）**：原版 Editor 以 `key={memo.id}` 切篇重挂。Rust 的 Editor 以 `memo_id` prop 查找备忘、内部 `doc`/`title` 是 `use_signal` 一次性初始化——从列表进编辑器时组件是条件渲染新挂载，没问题；但 wiki 导航是**编辑器→编辑器直切**，必须保证 Editor 按 memo_id 重新挂载（如在 main.rs 给 Editor 元素加 `key: "{memo_id}"` 或以 nav 代次拼 key），否则 doc/title 信号仍是旧备忘。实现时须实测验证。
- 反向链接条目点击：Dioxus 侧 button onclick 直接 `on_open_wiki(source_title)`（无桥参与）；切篇前置保存同上（Editor 内部 doc/title 信号在切篇前应已 persist——Rust 现行 persist 时机是每次变更即落盘，与原版 flush 语义等价，实现时确认标题改名未失焦场景：标题提交在 blur，导航点击会先触发 blur，一般无碍，仍建议在 on_open_wiki 调用前主动 commit 一次标题）。

### 8.5 反向链接区块 —— `src/editor.rs` Editor 组件尾部
- 计算：`let backlinks = compute_backlinks(&data.read().memos, &memo.id, &title.read())`（title 是现成信号，对应原版 title state 语义；注意 Rust 的 title 信号初值是 `memo.title` 原值——原版把字面「无标题」初始化为空字符串。若 memo.title 为 None/空，key 为空自然无反向链接；字面「无标题」的四字标题在 Rust 里 key 非空，与原版 §6.5 的不对称点有细微出入，实现时按原版口径把 title 初值/匹配键做一次「字面 untitled 文案 → 空」处理，或在报告中注明此差异）。
- 渲染位置：Editor 根 `.detail` 内、正文包裹（`.editor-pad` 对应原版 `.editor-spread`）之后，`backlinks` 非空才渲染：
  ```rust
  section { class: "wiki-backlinks", "aria-label": "{t(\"editor.backlinks_aria\")}",
    h2 { class: "wiki-backlinks-title", "{t(\"editor.backlinks\")}" }
    div { class: "wiki-backlinks-list",
      for src in backlinks { button { key: "{src.id}", class: "wiki-backlink", onclick: …, "{src.title or untitled}" } } }
  }
  ```

### 8.6 CSS —— `styles/editor.css` 追加
- §5.1、§5.2 两段逐字移植（类名与值与原版一致）。先核对 Rust `styles/tokens.css` 已有 `--md-link-color`/`--md-focus-ring`/`--radius-10`/`--font-12`（原版 tokens 的移植版，预期齐全，缺则补）。

### 8.7 i18n —— `lang/*.json` ×5 新增 3 键
- 原版三处文案是硬编码中文（§4.2）。按 Rust 版既有规矩（全部 UI 文案走语言包）新增：
  `editor.backlinks` = 「反向链接」、`editor.backlinks_aria` = 「引用当前笔记的反向链接」、`editor.wiki_open_title` = 「打开笔记：{target}」（其余四语言包给对应译文，键集保持一致）。此为与原版实现方式的有意分歧（文案内容 1:1），实现报告中注明。

### 8.8 诊断（项目规矩，原版无）
- `diag.rs` 新增标签 `WIKI`：导航请求（target、命中 id / 未命中→新建 id）、编辑器打开时反向链接条数、正文链导航前保存失败（对应原版 console.warn 点）。

### 8.9 测试建议
- core/wiki 单测：§6 边界 1/5/6/7/8/9/10 各至少一例（目标提取 + 键归一化 + 反向链接过滤）。
- 冒烟新增 `smoke-rustweb-wiki.mjs` 并登记进 `run_all_tests.sh` 与 TESTING.md：导入含 `[[目标|别名]]`、`[[不存在]]`、代码块内 `[[假]]` 的备份 → 列表预览显示别名 → 打开来源备忘点链接跳目标 → 点不存在链接新建同名备忘 → 打开目标备忘见反向链接区块（条数/标题/点击回跳）→ md 预览里点 wiki 链不进源码编辑态（优先级）。

---

## 附：原版参考测试素材
- `tests/browser/markdown-visual.mjs:42`：`[[目标笔记|显示文字]]` 的渲染样例。
- `tests/browser/markdown-visual.mjs:163`：段落 `参考 [[目标笔记|打开目标]]，之后 [[新建笔记]]。`（混合别名与不存在目标）。
