# Changelog

## 2.2.5

响应式笔记看板与导出视觉一致性
- 手机横屏、平板和 PC 首页采用三列 1:1 笔记卡，圆角 26px；手机竖屏保留原有胶囊列表。
- Markdown、HTML、PDF 共用编辑器实时 DOM/CSS 快照；Markdown 使用样式化 HTML 快照保留图文、链接、音乐、待办等卡片视觉。
- 增加 Mynote 专属视觉规范与导出/断点回归测试。
- 更新应用静态资源与 Service Worker 缓存版本。

## 2.2.4

导出视觉保留
- HTML/PDF 改为按原始块结构导出，保留图文卡片、横排图文、画廊、音乐/网页卡片元数据和附件
- 独立 HTML 内嵌图片与主题/打印样式；Markdown 图文块补回说明文字
- 更新应用静态资源与 Service Worker 缓存版本

## 2.2.3

编辑器导出
- 编辑页更多菜单增加统一导出入口，提供 Markdown、HTML 和 PDF 格式选择
- Markdown/HTML 作为文件下载；PDF 使用浏览器打印与存储流程
- 补齐格式浮层动画、点击态、键盘焦点和关闭交互

## 2.2.2

Markdown 阅读体验
- 编辑态和预览态共享正文、标题、行距与段间距尺度
- 按明暗主题细化链接、引用、提示块、代码和任务复选框颜色；提高辅助文字及提示图标对比度
- 减少引用、提示块和待办列表的胶囊卡片感
- 窄屏表格和代码块改为容器内横向滚动，链接与长代码可安全换行
- 增加链接、任务项的可见键盘焦点和更易触控的待办区域
- 待办编辑控件改用原生复选框，修正空格键切换、无障碍状态同步与保存
- 新增浅色/深色、360/390/1280px Chromium 视觉回归，并更新缓存版本

## 2.2.1

安全与数据完整
- 移除仓库内明文和风天气 key（部署时注入 `__APP_CONFIG__.QWEATHER_API_KEY`）
- `saveMemo` 先同步写 localStorage 再走 IDB；IDB 失败不再连带丢缓存
- Editor 挂 `pagehide` / `visibilitychange`，防抖窗口内关页不丢稿
- Drive 备份改 resumable 上传（multipart 官方限 5MB）
- IDB 首存不再 clear 全表，改为采纳当前 store 为 baseline
- 恢复提交后立即刷新 `_memoBaseline`，防旧状态写回

编辑器
- 封面加载失败改事件委托（DOMPurify 剥内联 onerror）
- 多音乐卡失焦串号（var 循环闭包）修复
- 前缀转换只替换命中块并恢复光标
- 背景色只传 delta，不再展开旧 memo
- 空段落 Backspace 不再连带删原子块
- 粘贴截图/图片作为附件插入
- 图片点击开 lightbox；非图片选入占位有提示
- 句中 `/cmd` 也会被剥掉
- 斜杠命令不再污染共享 defs
- ZIP Worker 不可用时降级主线程 fflate

编辑器重大缺陷修复（本轮真机排查发现）
- 首次应用斜杠命令后光标落在容器游离 div，后续 / 永远不再弹面板（即“串功能/误触”根因）：新增游离块自救 + 光标钉回块内 + 兜底新段落
- mdCheckTimerRef / blurApplyingRef 未定义即传入 hook，inline 类命令（斜体/高亮/彩色标签等）应用即抛错致面板永久失效
- 粘贴修复：文本夹普通链接也抽链接转卡（此前仅纯 URL / 白名单域名），剩余文本保留原位
- 新增 tests/browser/full-smoke.mjs：23 项全功能真机冒烟

清理
- 删除死代码 BlockSystem / LinkCard / restoreAttachmentsFromZip
- IP 定位换 HTTPS 可用的 ipapi.co
- 草稿 load 读 IDB 兼底；clear 同步删 IDB
- 合并云端时单个坏附件不再整体失败

结构与兼容
- editor.js 抽出 slash-model（纯过滤）、lifecycle-hooks（pagehide / 封面破图）、use-history（撤销/重做 + Cmd+Z / iOS 三指）、use-slash + slash-panel（斜杠状态/应用/面板 UI）、use-editor-dom（click/todo/blur/focus 管线）
- editor.js 3662 → 2287 行
- BackupView 拆出 services/zip.js（有界解压/流式打包）与 services/drive.js（Drive 列表/分片上传/解码），1299→1096 行
- storage.idb 拆出 services/backup-validate.js（手写 ZIP 校验 + 备份白名单，纯函数可测），860→677 行
- memo-list 拆出 app/demo-memos.js（demo 笔记 + 城市表），753→671 行
- 全仓去掉可选链 / ????，补 AbortSignal.timeout 与 Promise.allSettled 垫片
- 新增 Service Worker（同源 SWR，不碰跨域 API）
- Moment / index 加 CSP（登录 iframe 已放行 accounts.google.com）
- ZIP 打包改流式 fflate.Zip，主线程不再堆全量附件；manifest 改 cursor 只读 name/type
- Chromium 冒烟：列表渲染 / 编辑输入 / 撤销重做 / 斜杠面板应用+Esc / SW 接管，0 pageerror

## 2.2.0

- 拆分 Moment.html：主运行时按桥接、Editor、天气、列表、启动拆为独立脚本
- 抽取全局设计令牌，CSS 与内联样式统一使用颜色、字号、圆角、阴影变量
- 启动页样式与倒计时脚本独立，移除页面内联 style/script
- 新增拆分结构、样式令牌与运行模块测试

## 2.0.2

编辑页返回首页的过渡顺滑了很多，闪烁明显减少
- Google 登录/退出后，首页头像自动同步，不用手动刷新
- 天气链路修好了（和风主用，彩云兜底）
- 启动页恐龙换成了 SVG，视觉更统一
- 备份页图标、Toast 显示细节修复
- 浅色背景改成 iOS 系统灰 `#f2f2f7`，看着更舒服
