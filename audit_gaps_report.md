# Mynote Rust Web 版 · 与原版剩余差距全量盘点

- 审计时间：2026-11-21
- 审计性质：只读审计（未改任何代码）
- 对照面：原版 = 仓库根目录 Web 应用（`Moment.html` 入口，`src/` 下 JS/CSS）；Rust 版 = `rust/apps/web`（Dioxus）
- 排序：功能缺失 > 行为差异 > 视觉差异；同级内按影响面排序
- 已对齐的大面（列表/搜索/分组/置顶/滑动行、编辑器主体、标题坞、背景系统、卡片状态机、设置页、备份本地导入导出、i18n、字数口径、安全区）经前几批验证，本报告不再逐项列，只在文末汇总一句

---

## 一、功能缺失

### G1. Wiki 双向链接整体缺失（已知未决项）
- 页面/模块：编辑器正文渲染、编辑器文末、列表页跳转
- 原版行为：正文里 `[[标题]]` / `[[标题|别名]]` 渲染为可点链接 `a.mynote-wiki-link`（`src/editor/editor.md.js:302`）；点击先保存当前笔记再按标题跳转目标笔记（`src/app/editor/use-editor-dom.js:99-112`，目标匹配在 `src/app/memo-list.js:291` openWikiTarget）；编辑器文末有「反向链接」区，列出所有引用了当前笔记的笔记并可点击跳转（`src/app/editor.js:114` 计算、`src/app/editor.js:3271-3285` 渲染）
- Rust 现状：无。`[[…]]` 仅在列表预览剥 md 时被当普通文本处理（`rust/apps/web/src/list.rs:175-203`），编辑器内不渲染为链接、无点击跳转、无反向链接区
- 修复要点：行内层加 wiki 链接节点渲染 + 点击回调（保存后按标题打开目标）+ 编辑器文末反向链接区（扫描全部备忘正文中的 `[[当前标题]]`）

### G2. 粘贴纯 URL / 内嵌媒体 URL 不生成链接卡
- 页面/模块：编辑器粘贴
- 原版行为：`handleEditorPaste`（`src/app/editor.js:2145`）——粘贴纯 URL 直接插入链接卡（`:2182`）；文本中夹带音乐/媒体域名 URL（网易云/QQ 音乐/Spotify/Apple Music/b23.tv/小红书）提取后插卡（`:2188`）；夹带普通 URL 且非 Markdown 时插卡、剩余文本保留为卡后段落（`:2195-2218`）
- Rust 现状：无。桥的 paste 监听只处理 `text/html` 与多行纯文本（`rust/apps/web/src/editor.rs:304-348`），粘贴 URL 只会成为普通文字
- 修复要点：桥 paste 增加 URL 判定分支（纯 URL / 媒体域名正则 / 内嵌 URL 三路），发新 op 给 Rust 侧复用已有的卡片创建 + 元数据拉取通路

### G3. 剪贴板图片粘贴不入附件
- 页面/模块：编辑器粘贴
- 原版行为：剪贴板含图片文件时逐个作为附件插入光标处（`src/app/editor.js:2220-2245` insertAttachmentAtCursor）
- Rust 现状：无。paste 监听不读 `clipboardData.items/files`（`rust/apps/web/src/editor.rs:304-348`）；从相册/截图复制图片粘贴进编辑器不会生成图片块
- 修复要点：桥 paste 检测 file 类 item → 读为字节发回 Rust，走已有 attach_file 的落库+插块通路

### G4. 链接卡点击不打开网页
- 页面/模块：编辑器 · 链接卡（link-card 成品卡与错误卡）
- 原版行为：点击带 `data-url` 的卡片区 → `window.open(url, '_blank')`（`src/app/editor/use-editor-dom.js:377-381`）
- Rust 现状：成品卡与错误卡都是无点击行为的 div（`rust/apps/web/src/blocks.rs:478-578` link-card 两臂均无 onclick；音乐卡已是 `<a>` 对齐，唯独链接卡没有）
- 修复要点：给 link-card 两臂加点击打开 URL（注意与块选中手势共存：原版是整卡打开，Rust 现行中心点击=选中，需定口径，建议卡面点击打开、边缘区仍走选中/插入）

### G5. 附件（非图片）点击不打开/下载文件
- 页面/模块：编辑器 · 附件文件块（PDF/文本/音乐文件行）
- 原版行为：点击 `.att-hint` 区域 → 把附件 data URL 转 Blob 并打开（`src/app/editor/use-editor-dom.js:337-352`）
- Rust 现状：附件行只渲染图标+文件名+「打开」字样，无任何点击处理（`rust/apps/web/src/blocks.rs:478-497`；音乐文件行同，`:385-400`）。Rust 里 create_object_url 只用于导出下载（`rust/apps/web/src/editor.rs:3532`），没有附件打开通路
- 修复要点：附件行加点击 → 从 IDB 取附件字节 → Blob URL 打开/下载（复用 idb.rs 已有取数能力）

### G6. Markdown 预览覆盖面不足（表格 / GFM / KaTeX 等）
- 页面/模块：编辑器 · md 源段落预览
- 原版行为：md 源段落经 marked 全量 GFM 渲染（`src/editor/editor.md.js:375` renderMarkdownHtml），含表格、md 标题、引用块、分隔线、任务列表等；`$…$` / `$$…$$` 公式经 KaTeX 渲染（`src/editor/editor.md.js:241-242`）；点击还原源码时表格按行拆回独立段落（`src/app/editor/use-editor-dom.js:197-226`）
- Rust 现状：`md_classify` 只识别代码围栏 / Callout / 列表三类（`rust/apps/web/src/blocks.rs:648-659, 683`），其余 md 段落（表格、`# 标题` 段、`> 引用` 段、`---`、`$$公式$$` 等）在编辑器里以源码原文呈现，与原版的格式化预览不一致
- 修复要点：扩 MdKind：至少补表格、标题行、引用块、分隔线四类渲染 + 点击还原口径；KaTeX 公式渲染单独立项评估（需引入 KaTeX 资源）

### G7. 斜杠面板缺「最近使用」
- 页面/模块：编辑器 · 斜杠面板
- 原版行为：用过的命令记入 localStorage `memos_slash_recent_v1`（`src/app/editor/use-slash.js:97, 655`），面板打开时置顶为「最近使用」分组、行尾带「最近」胶囊（`src/app/editor/slash-model.js:30-56`、`src/app/editor/slash-panel.js:116`）
- Rust 现状：无。面板只有基础/媒体两组固定顺序（`rust/apps/web/src/editor.rs:3047` SlashPanel）
- 修复要点：应用命令时记录 id 到 localStorage，面板渲染时把最近用过的命令抽到顶部「最近使用」组

### G8. Service Worker / 离线缓存缺失
- 页面/模块：全站（PWA 层）
- 原版行为：注册 `./sw.js`（`src/app/sw-register.js:9`），sw 预缓存全部本地运行时资源（`sw.js:1-60`），断网可打开应用
- Rust 现状：无。dist 无 sw.js，`index.html` 与 `src/main.rs` 均无 serviceWorker 注册（manifest 与图标已在上一批补齐，装到主屏可以，但离线打开不行）
- 修复要点：给 dist 加一份预缓存 index/wasm/js/lang 的 sw.js 并在 index.html 注册（注意版本更新策略与既有部署的缓存失效口径）

### G9. 双栏独立滚动只有数据、没有渲染（代码内已自认）
- 页面/模块：编辑器 · ••• 菜单「双栏独立滚动」
- 原版行为：开启后编辑器正文变两栏 `.editor-column` 且可分别滚动（`src/app/editor.js:314-340` 状态与切换、`src/app/editor.js:3250` is-independent-scroll、列布局在 `src/styles/editor-shell.css:188-195` 与 editor.css 的 .editor-spread）
- Rust 现状：开关只写 `memo.extra["layout"]["twoPane"]` 透传落库，渲染层未实现（`rust/apps/web/src/editor.rs:1534-1535` 注释自述「双栏为已知缺口，数据先对齐原版」）；宽屏下只有 CSS 多栏排版（styles/editor.css .editor-spread），不是可独立滚动的两栏
- 修复要点：按原版列模型实现两栏拆分与独立滚动（或明确降级：菜单文案/开关与实际行为一致前先隐藏该项——需产品口径，二选一）

### G10. `?open=` 深链打开笔记缺失
- 页面/模块：列表页启动
- 原版行为：URL 带 `?open=<id 或标题片段>` 时数据加载后自动打开对应笔记（`src/app/memo-list.js:35, 68-75` tryOpenNote）
- Rust 现状：无。启动不解析 location.search（`rust/apps/web/src/main.rs` App 无相关逻辑）
- 修复要点：App 初始化读 `?open=`，数据就绪后按 id 精确/标题包含匹配并置 selected

---

## 二、行为差异

### B1. 斜杠搜索不支持关键词与拼音首字母、无前缀优先排序
- 原版行为：每条命令带 keywords 与拼音首字母（如标题 `bt1`、图文卡片 `twkp`）（`src/app/editor/commands.js` 全表），过滤时对 title+subtitle+keywords+type+pinyin 全串匹配，并把标题/拼音以查询开头的排前面（`src/app/editor/slash-model.js:13-24`）
- Rust 现状：过滤只对本地化标题/副标题/shortcut/act 做子串包含（`rust/apps/web/src/editor.rs:3138-3143`），输「bt」或「标题」以外的词（如「分割」输 `fgx`）搜不到，且无排序
- 修复要点：SLASH_CMDS 补 keywords+pinyin 字段（五种语言下拼音字段沿用中文命令的），过滤与排序按 slash-model 口径移植

### B2. 粘贴富文本的口径相反
- 原版行为：粘贴只取 `text/plain`（及图片文件），富文本来源一律按纯文本插入（`src/app/editor.js:2145-2150, 2237-2246`）
- Rust 现状：优先取 `text/html`，净化后按富 HTML 插入并回同步模型（`rust/apps/web/src/editor.rs:310-341`）
- 影响：从网页/文档复制一段带格式文字，原版得到纯文字，Rust 得到带粗体/链接的富文本——结果不同（无对错之分，但与原版行为不一致）
- 修复要点：定口径——若坚持 1:1，改为只取纯文本 + 图片文件（与 G2/G3 合并改造）；若保留富粘贴，需用户确认这是有意偏离

### B3. 相对时间不做 24 小时制判定
- 原版行为：`timeAgo` 先用 Intl 判定当前区域是否 24 小时制（`src/utils/time.js:2-10`），24h 设备显示 `13:05`，12h 设备显示 `下午 1:05`
- Rust 现状：恒 12 小时制（列表 `rust/apps/web/src/list.rs:828-851`、编辑器副行 `rust/apps/web/src/editor.rs:3559-3570` 均写死上午/下午）
- 修复要点：用 Intl.DateTimeFormat formatToParts 探测 dayPeriod 有无，24h 时输出 `H:MM`

### B4. 关闭编辑器时「删空备忘」的范围不同
- 原版行为：仅当备忘是新建（`__isNewNote`）且未输入文字、未改背景、未设头像、标题未变时才删除（`src/app/editor.js:923-931`）
- Rust 现状：任何备忘只要关闭时正文无文本、无卡片、无背景色、标题为空即被删除（`rust/apps/web/src/editor.rs:1395-1414`）——把一篇旧笔记内容全删光后退出，Rust 会连笔记一起删掉，原版保留空壳笔记
- 修复要点：删除条件加「本会话新建」标记（列表新建入口传入），与原版口径对齐

### B5. 添加附件的文件选择器口径不同
- 原版行为：`accept="image/*,application/pdf,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"` 且 `multiple`（`src/app/editor.js:3286-3287`）
- Rust 现状：`#file-attach` 的 accept 为 `image/*,.pdf,.txt,.md,.zip,.mp3,.mp4` 且无 multiple（`rust/apps/web/src/editor.rs:1950-1952`；带 multiple 的是另一个 `#file-media` 图片入口）——一次只能选一个附件，且 Word 文档不在可选类型内
- 修复要点：accept 改回原版集合并加 multiple，attach_file 循环处理全部选中文件

### B6. 备份导出不走系统分享面板
- 原版行为：导出 zip 时优先 `navigator.share` 调系统分享面板（保存到文件 App/发送），不支持才回退下载，并分别记「文件已分享/备份已下载」历史（`src/components/BackupView.js:175-208`）
- Rust 现状：恒为浏览器下载（`rust/apps/web/src/settings.rs:412-433` handle_export）
- 修复要点：导出时先尝试 navigator.share + canShare(files)，失败再回退现有 download_zip

### B7. 草稿层（DraftStore）缺失——近似等价，低优先
- 原版行为：编辑中的自动保存先进每篇独立的草稿存储（`src/services/storage.local.js:4-20`），打开编辑器时先加载草稿（`src/app/editor.js:142`），正式保存/删除时清草稿（`src/app/editor.js:764, 929`）
- Rust 现状：无草稿层，每次编辑操作直接落主库（`rust/apps/web/src/editor.rs` persist 通路）。崩溃恢复的实际效果接近（最后状态都在），差别在「未关闭即不算正式保存」的语义边界
- 修复要点：如需严格对齐再补草稿层；否则记录为已知语义差异即可

### B8. 标题/待办内按回车的拆分语义（待复核）
- 原版行为：回车落在非段落块内时，在整块之后插入一个新空段落并把光标移过去，块内光标后的文字留在原块（`src/app/editor.js:2076-2110` handleEditorKeyDown 的 Enter 分支）
- Rust 现状：按光标处拆分——标题/引用拆为原块（前段）+新段落（后段），待办拆出一个未勾选的新待办承接后段文字（`rust/apps/web/src/editor.rs:2331-2370` op_split）
- 说明：两者用户可感不同（尤其待办连打与标题中段回车）；原版该分支是否覆盖全部块类型需再做一次双版同操作探针确认，故标待复核
- 修复要点：先探针对齐事实，再决定 op_split 是否改口径

---

## 三、视觉差异

### V1. 空编辑器占位提示从不显示
- 原版行为：文档只有一个空段落时，正文区显示占位文案「点击此处开始输入文字，或输入/使用快捷功能命令面板」（样式 `src/styles/editor-shell.css:4`，挂类条件 `src/app/editor.js:3250`）
- Rust 现状：CSS 规则已移植（`rust/apps/web/styles/editor.css:396`），但没有任何代码给正文容器加 `show-placeholder` 类，提示永不出现
- 修复要点：Editor 渲染时按「doc 恰为单个空段落」条件给容器加该类

### V2. 斜杠面板文案两处不符
- 原版行为：分组标题为「基础块 / 媒体块」（`src/app/editor/slash-model.js:5`）；待办命令的快捷键标注为 `[ ] `（`src/app/editor/commands.js` todo 条目）
- Rust 现状：分组为「基础 / 媒体」（`rust/apps/web/lang/zh-CN.json` slash.group_basic / slash.group_media）；待办标注为 `[] `（`rust/apps/web/src/editor.rs:506`）
- 修复要点：改两处文案/标注（五语言包同步）

### V3. 搜索框占位文案不符
- 原版行为：占位「搜索笔记...」（`src/app/memo-list.js:565`）
- Rust 现状：占位「搜索备忘」（`rust/apps/web/lang/zh-CN.json` search.placeholder）
- 修复要点：改语言包文案（其余语言包同步核对）

### V4. HTML / PDF 导出的成品保真度低
- 原版行为：导出 HTML 是带页眉（头像+标题胶囊+时间·字数 meta）、主题属性、完整排版与打印 CSS 的独立文档（`src/app/editor/export.js:415-501` visualSnapshotMarkup）；PDF 走同一份文档打印
- Rust 现状：`doc_to_html` 只生成极简文档（`<h1>` 标题 + 一段内联样式，无页眉、无主题、无打印规则）（`rust/apps/web/src/editor.rs:3355-3370`）；三种格式（MD/HTML/PDF）本身齐全，仅成品观感差一截。另外旧块类型 decorative_divider 原版导出有专门渲染（`src/app/editor/export.js:191-192`），Rust 导出按普通文本处理
- 修复要点：按 export.js 的快照结构补页眉与样式表；顺手补 decorative_divider 分支

### V5. 天气位缺失（当前配置下与原版等效，仅记录）
- 原版行为：新建卡右侧有天气位（温度+城市+状况）（`src/components/SwipeRow.js` isNewCard 分支），数据来自和风天气；但本站点 `QWEATHER_API_KEY` 为空，`fetchWeather` 直接返回 null（`src/services/weather.js:51-53`），原版在当前配置下也从不显示天气
- Rust 现状：无天气代码（`rust/apps/web/src/list.rs:1165-1184` NewCard 无天气位）
- 修复要点：无需动作；仅当将来给原版配上天气 key 时，Rust 需同步补天气拉取与展示

---

## 四、标注项（按用户既定决定，不列为待修）

- **Google Drive 云备份未接**：原版备份页含连接 Google 账号、上传云端、从云端恢复（覆盖/合并两种模式）（`src/components/BackupView.js:257-490`、`src/services/drive.js`）。Rust 版备份页为「未连接/待定」占位（`rust/apps/web/src/settings.rs:281`）。用户已定：先放着，等其决定 Google OAuth 方案后再做——此处仅标注，不计入待修清单。

## 五、附带确认的对齐项（本轮核查顺带证实，不用再查）

- 斜杠命令集合：原版 22 条（`src/app/editor/commands.js`）与 Rust 22 条（`rust/apps/web/src/editor.rs:500-522`）一一对应
- 导出格式种类：MD / HTML / PDF 三种两版齐全（原版 `src/app/editor.js:3220-3230`，Rust `rust/apps/web/src/editor.rs:1486/1580/1597`）
- 字数口径：仅段落块首叶文字（Rust `orig_char_count`，已实测 114 字与原版一致）
- 相对时间分档、日期分组标签（今天/昨天/过去7天/过去30天/M月/Y年 + 置顶组）、标签提取（#词，最多 3 个）、预览剥 md、滑动行（阈值 -55、吸附 -168、置顶/删除）、折叠展开（>2 折叠）均已对齐
- 设置页：原版仅文字大小/备份与恢复/关于三组（`src/components/SettingsView.js`），Rust 对齐并按用户要求多出语言、诊断两个入口（属新增，非差距）
- 诊断页为 Rust 版按用户硬规矩新增，原版无此页（原版的 error-boundary 悬浮徽章 `src/error-boundary.js:98/106` Rust 未做，功能已被诊断页覆盖，不计差距）
- i18n 五语言为 Rust 版新增能力，原版仅中文，不计差距
