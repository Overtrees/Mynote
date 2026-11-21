# 编辑页「编辑态」全面审计报告（Rust Web 版 vs 原版）

- 审计时间：2026-11-21
- 审计性质：只读审计（未改任何应用代码）。方法 = 两边源码通读 + 无头 Chromium 实证探针（Playwright，393×852，hasTouch；探针脚本 /tmp/probe_editor.mjs、/tmp/probe_editor2.mjs、/tmp/probe_editor3.mjs，可复跑）。
- 对照源：原版 `src/app/editor.js`（handleEditorKeyDown / handleEditorInput / handleEditorPaste）、`src/app/editor/use-editor-dom.js`、`src/app/editor/use-slash.js`、`src/app/editor/use-history.js`；Rust 版 `rust/apps/web/src/editor.rs`（EDITOR_JS 桥 editor.rs:22-524、handle_bridge_msg editor.rs:2126+、op_* editor.rs:2345+）。
- 架构前提（差异的总根源）：原版是**单一 contenteditable**（全篇一个编辑宿主，浏览器原生承担拆/合/跨块选区/跨块方向键/原生 undo），Rust 版是**分块架构**（每块一个非受控 contenteditable + JS 桥模拟结构操作）。凡原版靠浏览器原生完成的行为，Rust 都要显式模拟——本次缺陷集中在模拟不完整处。

---

## 结论总览

| 分级 | 条数 | 要点 |
|---|---|---|
| 缺陷 | **5** | 拆/合后源块 DOM 不回写（画面重复/丢字 + 同步覆盖落库，**数据级**）；Ctrl+Z 走原生 undo 与模型脱钩（菜单却宣传 Cmd+Z）；斜杠面板开着时拼音组合回车被面板截获；撤销/重做后焦点丢失到 BODY；图片粘贴缺失 |
| 行为差异 | **13** | 标题/待办回车语义、Shift+Enter、方向键不跨块、跨块选择/Ctrl+A、斜杠触发条件、md 智能前缀缺失、新建不自动聚焦、撤销粒度/重做不对称、粘贴差异群、退格跨原子块合并、mdsrc 退格、菜单 Esc、光标偏移单位 |
| 已对齐 | 9 项 | 段落拆块落点、合并光标落点、空块退格、首块退格、组合输入主体、实时高亮时机、斜杠键盘操作、md 回车、粘贴焦点 |

---

## 一、缺陷（按严重度）

### D1. 中段拆块 / 合并后，源块 DOM 不回写 → 画面文本重复或丢失，且同步机制会把错误文本覆盖进模型落库

- 实证（探针 Q1）：段落键入 `HelloWorld`，光标置于 `Hell|oWorld` 按回车——模型正确拆为 `Hello` + `World`，但 **DOM 中源块仍显示 `HelloWorld`、新块显示 `World`**（后半段在屏幕上出现两次）；刷新后才恢复正确。探针 P3：两块 `XYZ` / `ABC` 在第二块段首退格合并——模型为 `XYZABC`，但 **DOM 源块只剩 `XYZ`，`ABC` 从屏幕消失**，刷新才回来。
- 根因（代码）：桥在 keydown 里 `preventDefault` 阻止浏览器改 DOM，再由 Rust 改模型（editor.rs EDITOR_JS:121-131）；`op_split`（editor.rs:2345）/`op_merge`（editor.rs:2434）只改模型并 `focus_req` 聚焦目标块，**从不回写源块的 DOM**。源块是 `EditableDiv` 非受控组件（editor.rs:3081，初始 HTML 由 `use_hook` 锁定），重渲染不触碰其 innerHTML。`dom_set` 回写通道只被 `op_paste_text` 与 md 转换使用（editor.rs:2546、2243），拆/合路径没有用。段尾拆块因 after 为空、DOM 恰好一致而不暴露——这正是它此前没被冒烟发现的原因。
- 二次伤害（落库）：桥的自动同步 `collectSync` 每 20 秒及页面隐藏时读取**全部块的 DOM innerHTML**（editor.rs:347-354），`handle_bridge_msg` 的 `sync` 分支把 DOM 文本覆盖进 shadow 模型并 persist（editor.rs:2319-2333）；打开 ••• 菜单（editor.rs:~1754）与返回列表（go_back）也走 `__mnSyncAll → apply_sync_map → doc.set`。即：中段拆块后只要打开一次菜单或等 20 秒，**重复文本被写进模型与存储**；合并后同理**被吞掉的文本永久丢失**。
- 原版对照：单一 contenteditable，拆/合由浏览器在 DOM 内原生完成，DOM 即模型，不存在此问题（editor.js:2115 放行段落回车原生拆分，输入后 80ms 防抖 parseEditorDOM 对齐）。
- 验证方法：新备忘 → 键入 `HelloWorld` → Home 后 ArrowRight×5 → Enter → 断言两个 `[data-bid]` 的 textContent 恰为 `Hello` 与 `World`（当前实测为 `HelloWorld`/`World`，失败）；再等 autosync 或开一次 ••• 菜单后刷新 → 断言仍为 `Hello`/`World`。合并侧：两块各有文本，第二块段首 Backspace → 断言合并块 DOM 立即为拼接全文。

### D2. Ctrl/Cmd+Z 未被接管：走浏览器原生 undo（只改当前块 DOM、不改模型），而菜单副标题却宣传「快捷键 Cmd+Z」

- 实证（探针 P4）：合并后按 Ctrl+Z，块内容被原生 undo 清成空块（原生撤销栈回滚了该块的键入），模型毫不知情；随后 autosync 会把空块 DOM 同步落库（与 D1 同一通道）。
- 代码证据：EDITOR_JS 的 keydown 只处理斜杠面板、Cmd/Ctrl+B/I/U/S、Enter、Backspace（editor.rs:80-140），**没有 z/y 分支**；Rust 侧撤销只有 ••• 菜单按钮（do_undo editor.rs:1448）。而菜单项副标题文案就是「快捷键 → Cmd+Z」（探针 Q4 实测菜单文本 `撤销快捷键→ Cmd…`）——UI 承诺的快捷键实际触发的是破坏性的原生 undo。
- 原版对照：use-history.js 末段全局 keydown 拦截 Cmd/Ctrl+Z、Cmd/Ctrl+Shift+Z、Ctrl+Y 并 preventDefault，走自有快照栈；另监听 beforeinput 的 historyUndo/historyRedo（三指手势）。
- 验证方法：任意块键入文字 → Ctrl+Z → 断言触发的是应用撤销（菜单撤销一次的同等效果）且 `document.activeElement` 仍在编辑区、模型与 DOM 一致；再 Ctrl+Shift+Z 重做回来。

### D3. 斜杠面板打开时，拼音组合输入不安全：面板按键分支排在 composing 守卫之前

- 代码证据：EDITOR_JS keydown 的**第一件事**是斜杠面板分支（editor.rs:83-107：ArrowDown/ArrowUp 移动面板选区、Enter 应用命令、Escape 关闭），**之后**才到 `if (composing || e.isComposing) return;`（editor.rs:~117）。面板开着时用拼音打过滤词（组合中），按回车确认候选会被面板分支抢走、直接应用高亮的斜杠命令；方向键选候选也会被面板抢走。
- 原版对照：handleEditorKeyDown 第一行就是组合守卫（editor.js:2026 `if (isComposingRef.current || e.isComposing || … || e.keyCode === 229) return;`），斜杠分支在其后（editor.js:2052）。
- 备注：正文与标题的组合安全主体已对齐（见 A4），这是唯一漏口——但正落在项目「拼音是生死线」的红线上。
- 验证方法：无头无法驱动系统输入法，用代码级验证 + 合成事件：打开面板后 dispatch `compositionstart`，再向块派发 keydown Enter（isComposing=true）→ 断言面板命令未被应用、块类型未变；修复后同样步骤应无任何 op 发出。真机补验：块首打 `/` 后用拼音输过滤词，回车上屏候选而非应用命令。

### D4. 撤销/重做后焦点彻底丢失（activeElement = BODY），键盘输入无处落点

- 实证（探针 R5）：菜单撤销成功后 `document.activeElement.tagName === 'BODY'`——此后直接打字没有任何反应，必须重新点进某个块。
- 根因：do_undo/do_redo 用 `epoch` 整体重挂载全部块（editor.rs:1506-1507、1526-1527，正文循环 key 含 epoch，editor.rs:1991/1999）恢复快照，但**不设 focus_req、不恢复选区**。
- 原版对照：宿主元素本身不被替换（只换 innerHTML），焦点留在编辑宿主上，输入可继续；事务型历史条目还带选区描述（blockId+offset）并在 rAF 里恢复（use-history.js restoreEditorSelection、undo/redo 的 restoreSelection 字段）。
- 验证方法：键入文字 → 菜单撤销 → 断言 activeElement 是某个 `[data-bid]` 元素且直接继续打字能落字；重做同理。

### D5. 图片粘贴缺失：剪贴板图片被直接丢弃

- 代码证据：桥的 paste 处理只读 `text/html` 与 `text/plain`（editor.rs:308-345），不查 `clipboardData.files/items`，图片粘贴无任何分支（纯图片时 html/text 皆空，什么都不发生）。
- 原版对照：handleEditorPaste 专门收集剪贴板图片文件并逐个 `insertAttachmentAtCursor` 插入为附件块（editor.js:2243-2260）。
- 验证方法：向剪贴板写入一张 PNG（Playwright 权限 + `navigator.clipboard.write` 或 CDP 派发带 files 的 paste 事件）→ 编辑器里 Ctrl+V → 断言新增图片块且附件落库。

---

## 二、行为差异

### B1. 标题/引用/待办块的回车语义不同：Rust 按光标拆分文本，原版不拆分、只在块后插空段落

- 实证 R1：标题 `Title|Text` 中间回车 → Rust 得标题 `Title`（DOM 还显示全量，见 D1）+ 段落 `Text`；实证 R2：待办末尾回车 → Rust 新建**空待办**。
- 原版（editor.js:2080-2114）：焦点在非 paragraph 块时回车一律 `preventDefault`，在该块**后插入一个空段落**并把光标放进去，原块文本整段保留（标题中段回车也不拆）；待办后跟的也是空段落而非新待办。空样式块同理（空标题回车后空标题仍在、下面多一空段）。
- Rust 的 op_split（editor.rs:2345+）：heading/quote/callout → 后半成新段落（拆分）；todo → 后半成新 todo（unchecked）；空样式块回车把**自身**转成段落（split-exit-style，editor.rs:~2395）——三种都与原版不同。段落块本身的拆分两版一致（A1）。
- 验证方法：标题块中段回车、待办末尾回车、空标题回车三例，断言块序列的类型与文本与原版口径一致（标题整段保留 + 其后空段落 + 光标在空段）。

### B2. Shift+Enter 被当作普通回车拆块

- 代码：桥 Enter 分支不看 shiftKey（editor.rs:~121）。原版 editor.js:2115 `if (e.key === 'Enter' && e.shiftKey) return;` 放行浏览器原生行为（块内 `<br>` 软换行，不拆块）。
- 验证方法：段中 Shift+Enter → 断言仍是一个块、块内出现换行（模型里是带 `\n` 的单段），而非两个块。

### B3. 方向键不能跨块：Left/Right/Up/Down 全部止于块边界

- 实证 P2：第二块段首按 ArrowLeft、段尾按 ArrowDown，焦点与光标都留在原块。
- 代码：桥 keydown 没有任何方向键跨块逻辑（面板外）；每个块是独立 contenteditable，浏览器原生方向键出不了块。
- 原版：单一 contenteditable 内方向键原生跨块移动；双栏模式另有 `moveCaretAcrossEditorColumns` 专门处理 Left/Right 跨栏（editor.js:56-98、2079）。
- 验证方法：两块文本，第一块末尾 ArrowRight → 光标进第二块开头；第二块开头 ArrowLeft → 回第一块末尾；第一块末行 ArrowDown → 落第二块对应列附近；反之 ArrowUp。

### B4. 没有跨块选择；Ctrl+A 只选当前块

- 实证 Q3：在第一块按 Ctrl+A，`getSelection().toString()` 只有当前块文本（`Hello/`）。
- 原因：分块架构下每个块是独立编辑宿主，选区无法跨越；原版单一宿主可选全篇、跨块删除/复制。
- 影响：跨块复制、跨块删除、全选删除都不可用（架构性差异，修复代价最高，建议单独立项评估）。
- 验证方法：鼠标从第一块中段拖到第二块中段 → 断言选区覆盖两块文本；Ctrl+A → 断言选区为全文。

### B5. 斜杠面板：触发条件、锚点、关闭时机都比原版窄

- 触发：实证 P5——段中输入 `hello/world` **不弹面板**，只有块首 `/` 才弹。代码：桥 input 处理要求整块文本以 `/` 开头（editor.rs:~233 `t.startsWith('/')`）。原版：块内**最后一个** `/`（光标之前）即可触发，查询 = `/` 与光标之间文字（≤30 字符、不含空白、URL 形态的 token 除外），句中同样可用（use-slash.js:239-261）。
- 锚点：Rust 用块的 getBoundingClientRect（editor.rs:~236），长块时面板出现在块首而非光标处；原版锚在**光标矩形**（含零宽标记兜底，use-slash.js:302-330）。面板尺寸公式已对齐（上一批），差的是锚点。
- 关闭：Rust 面板打开后点击别的块不关（桥 click 处理不发 slashClose，面板状态只由输入/Esc/应用驱动）；原版由 selectionchange 驱动 `updateSlashStateFromSelection`，光标离开 token 即关。
- 链接表单：Rust 的链接 URL 输入框无自动聚焦（SlashPanel editor.rs:3156+，无 autofocus/聚焦调用），点开后还要再点一下输入框。
- 验证方法：段中键入 `abc/def` → 面板应开且过滤词为 `def`；长段落末尾触发 → 面板锚点应在光标附近；面板开着点另一块 → 面板应关。

### B6. Markdown 智能前缀触发缺失（`# `、`## `、`### `、`> `、`[] `、`[] `、`---`）

- 实证 P6：新块键入 `# Title` 后仍是 paragraph、文本原样。
- 原版：输入防抖 80ms 后按 PATTERNS 把段首前缀转成标题/引用/待办/分割线，只替换命中块并把光标按偏移放回（editor.js:1916-2003），且计入撤销点。Rust 全仓无此逻辑（桥 input 只处理斜杠与实时高亮）。
- 验证方法：空段键入 `# 标题一`（含空格）→ 断言块变 heading level 1、文本为 `标题一`、光标在文本末；`[] 任务` → todo；`---` 回车后 → divider。

### B7. 新建备忘不自动聚焦首块（打开已有备忘两版一致不聚焦）

- 实证 Q0：点新建卡片进入编辑器后 activeElement = BODY，键盘不弹、光标不在正文。
- 原版：新建路径 `autoFocus: newEditorAutoFocusId === editingMemo.id`（memo-list.js:471），Editor 挂载 200ms 后聚焦第一个块（editor.js:545-553）；打开已有备忘 autoFocus=false，同样不聚焦——这一点两版一致（探针 P0 Rust 打开已有备忘也是 BODY）。
- 验证方法：列表点新建 → 断言 300ms 内 activeElement 是首块 `[data-bid]`；打开已有备忘 → 断言焦点不在正文（与原版一致）。

### B8. 撤销栈的粒度与对称性：纯打字不入栈、重做不先同步、mdsrc 每键一快照、上限 50 vs 100

- 入栈点（Rust）：桥消息循环只在 **doc 信号变化** 时 `hist_push`（editor.rs:1072-1077）。普通打字不发桥消息（只在结构操作时随 HTML 一起进模型），所以**长时间纯打字在栈里只有一个步**（靠开菜单 editor.rs:~1754 或撤销前 do_undo 的一次全量同步压栈兜底）。实证 R5：菜单撤销一次即整段回退。
- 原版：输入防抖里比较序列化差异、每次变化都 `recordUndoPoint`，600ms 内的连续输入合并成一步（use-history.js recordUndoPoint；editor.js:1905-1913），上限 100 条；Rust `hist_push` 上限 50（editor.rs:536-551）。
- 不对称：do_undo 会先 `__mnSyncAll` 把 DOM 打字同步进模型再压栈（editor.rs:1454-1468），**do_redo 不做**（editor.rs:1489-1507）——撤销后先打字、再重做，新打的字不在模型里，重做换 epoch 重挂后直接丢失（DOM 被快照覆盖且无处入栈）。
- 反例：mdsrc 源码编辑时 `mdText` 在**每个 input 事件**都改 doc 信号 → 每敲一键压一条全量快照，50 条上限很快被源码编辑打满——与普通块的粒度正好两极。
- 标题修改两版都不可撤销（原版快照只含 doc；Rust 快照只含 doc JSON）——已对齐，不算差异。
- 验证方法：打字 3 段（每段间隔 >1s）不做任何结构操作 → 连续点菜单撤销 → 原版口径应逐步回退（约 3 步），Rust 当前 1 步清空；撤销后打字再重做 → 断言新字不丢。

### B9. 粘贴差异群

- 多行纯文本：Rust 拆成多个段落块（op_paste_text editor.rs:2488，实证 R3 焦点落末块 ✓）；原版走 `execCommand('insertText')` 进当前块、换行成块内 `<br>`（editor.js:2262-2270），模型里仍是一个块（其 md 分组在失焦时才处理）。
- HTML 粘贴：Rust 净化后**保留格式**插入 DOM 并同步模型（editor.rs:316-341）；原版只取 `text/plain`（editor.js:2147），格式一律不带。
- 纯 URL 粘贴：原版整段是 URL（或文本中含音乐/媒体 URL）时转成**链接卡块**（editor.js:2196-2241）；Rust 当普通文本/链接 HTML 处理，不成卡。
- 桥 paste 不分块类型：mdsrc 里粘贴多行纯文本会走 pasteText 把源码块拆成多块；codeBlock 里粘贴 HTML 会走 pasteSync 把代码内容换成富文本行内——原版源码段落粘贴就是纯文本落位。
- 验证方法：分别粘贴「三行纯文本」「带格式 HTML」「一个裸 URL」「在 md 源码态粘贴两行文本」四例，对照原版口径断言块数与类型。

### B10. 退格合并会跨过原子块与上一个文本块合并

- 代码：`prev_editable`（editor.rs:678）只认文本块与列表项，原子块（图片/音乐卡等）被跳过——图片后一段在段首退格，文本会越过图片并进再上面的段落，图片位置相对文本发生跳变。
- 原版：单一宿主里的原生退格，段首面对 contenteditable=false 原子兄弟时由浏览器处理（通常删原子或不动），不会把文本越过原子搬走。此项为代码推定，原版侧未做实证，修复前建议先在原版实测确认口径。
- 验证方法：构造「段落 A + 图片块 + 段落 B」，B 段首退格 → 对照两版结果（A/B 文本与图片的相对位置）。

### B11. md 源码编辑态（mdsrc）退格不能合并/删块，代码块同理

- 代码：桥 keydown 对 `btype === 'mdsrc'` 与 `'codeBlock'` 直接 return 放行原生（editor.rs:118-119）——块首退格在块内无前文可删，原生行为是无操作：md 源码块永远无法用退格并回上一块、空 md 块无法退格删除。
- 原版：md 源码编辑时就是普通 `<p>`，退格与普通段完全一致（空块删除、段首合并都走 editor.js:2116 的处理与原生合并）。
- 验证方法：md 预览块点进源码态 → 删空全部文本 → 再按退格 → 原版口径应删块并聚焦上一块末尾；Rust 当前无反应。

### B12. 菜单与底表无 Esc 关闭；焦点回收不一致

- Rust：Escape 只处理斜杠面板（editor.rs:106）与原子块选中态（editor.rs:291-297），••• 菜单（menu-scrim 只能点遮罩关）、BgSheet 打开时按 Esc 无效。原版菜单有 document 级 Esc 关闭（editor.js:243-256 两处菜单组件的 onKeyDown Escape → closeMenu）。
- 灯箱点击关闭、图文面板遮罩关闭两版都有；图文面板的 textarea 编辑态打开时焦点不自动进 textarea（Rust save_sheet_text 一侧无聚焦调用），原版 ImageTextSheet 有 autoFocus（src/components/ImageTextSheet.js:118）。
- 验证方法：开 ••• 菜单按 Esc → 应关；开图文面板进编辑态 → 焦点应在 textarea 内。

### B13. 光标偏移单位不一致：Rust 按字符（Unicode 码点）计，JS 按 UTF-16 码元走字

- 代码：合并落点 `junction = plain_len(...)`（editor.rs:2446）与 `__mnFocus(bid, offset)` 的 TreeWalker 按 `textContent.length`（UTF-16 码元，editor.rs:439-473）逐字消费——文本含 emoji 等星平面字符时，合并/拆分后的光标落点会偏 1-2 个码元。ASCII/CJK 常用字（BMP）下无感，探针 P3 的 offset=3 正确即属此类。
- 验证方法：上一块末尾放一个 😀 再在下一块段首退格合并 → 断言光标恰落在合并点（emoji 之后）。

---

## 三、已对齐（简述，含实证）

| # | 项 | 证据 |
|---|---|---|
| A1 | 段落回车拆块：段首/段中/段尾的模型拆分与「光标落新块开头」 | op_split editor.rs:2345；探针 P1（段尾）焦点在新块、Q1 模型拆分正确（DOM 同步问题归 D1） |
| A2 | 合并后光标落合并点（上一块原文本长度处） | op_merge editor.rs:2469；探针 P3 offset=3 |
| A3 | 空块退格删块并聚焦上一块末尾；首块段首退格无操作 | 桥 merge 路径；探针 R4 块数 6→6 |
| A4 | 组合输入主体安全：桥 `composing`/`isComposing` 守卫拦结构操作、标题 titleText 组合期不提交只做布局同步、标题回车失焦（组合中不触发） | editor.rs:117、200-228、TitleText editor.rs:867+；原版 editor.js:2026、2688；另有用户 2026-11-21 真机九宫格拼音实测通过（漏口见 D3） |
| A5 | 实时高亮 ==…== 只在组合结束后触发（input 处理先查 composing），ZWSP 光标锚点不入模型 | editor.rs:140-182、230-232 |
| A6 | 斜杠面板键盘：上下循环选行、回车应用、Esc 关闭、输入过滤实时更新 | 桥 editor.rs:83-107；探针 R1/R2（ArrowDown×5 选中待办并应用成功） |
| A7 | md 源段落回车只换行不分块；点预览进源码编辑、光标落末尾、失焦回预览 | 桥 mdsrc 分支 editor.rs:119、focusout mdDone；EditorBlock editor.rs:2851+ |
| A8 | 多行粘贴的焦点收尾（末块末尾）与当前块 DOM 回写（dom_set 通道存在且被粘贴使用） | op_paste_text editor.rs:2546-2547；探针 R3 |
| A9 | 标题编辑：聚焦展开全文、失焦 trim 提交、空存「无标题」、截断显示 | TitleText editor.rs:894-960；原版 commitTitleFromDOM editor.js:711 附近、onBlur editor.js:2681 |

---

## 四、修复优先级建议（供主线排期）

1. **D1**（数据正确性，先修）：拆/合后用既有 `dom_set` 通道回写源块 DOM（或给源块换 epoch 局部重挂），并保证 autosync/菜单同步永远不拿未回写的 DOM 覆盖模型。
2. **D2 + D4 + B8**（撤销体系一起治）：桥接管 Ctrl/Cmd+Z / Shift+Z / Ctrl+Y 调菜单同款逻辑；撤销/重做恢复焦点与光标（至少回到操作块）；打字入栈加时间合并；do_redo 先同步。
3. **D3**（一行级修复）：桥 keydown 把 composing 守卫提到面板分支之前（与原版 editor.js:2026 同序）。
4. **B1 + B2**（回车语义）：非段落块回车改原版口径（块后插空段）；Shift+Enter 放行原生。
5. **D5 + B9**（粘贴管线）：补图片粘贴与 URL 成卡；mdsrc/codeBlock 粘贴走纯文本路径。
6. **B3 + B7 + B5 + B6**（光标与触发面）：方向键跨块、 新建自动聚焦、斜杠段中触发+光标锚点、智能前缀转换。
7. B4（跨块选择）架构级，单独立项；B10 先在原版实测再定口径；B11/B12/B13 随手项。
