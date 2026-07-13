# Lyrico Desktop 实施计划与新对话交接

> 最后整理：2026-07-13
>
> 桌面端仓库：`E:\Lyrico-Desktop`
>
> 移动端行为基准：`E:\Lyrico`
>
> 移动端插件及测试工具：`E:\Lyrico\Lyrico-Plugins`

## 0. 新对话接手说明

新对话不要从零设计，也不要只根据本文件中的勾选项推测代码已经完成。接手后按以下顺序开始：

1. 读取本文件，先看“当前快照”“不可回退的产品约束”和“下一阶段执行顺序”。
2. 运行 `git status --short`，保护用户已有修改；不要重置、覆盖或清理不属于当前任务的改动。
3. 对照实时代码和移动端实现确认入口，尤其不要把旧 Flutter 仓库 `E:\lyrico_desktop` 与当前 Tauri/React 仓库混淆。
4. 修改前运行与目标模块相关的测试；修改后至少运行第 9 节的统一验证。
5. 每完成一项立即更新本文件：只有实现、测试和对应验收证据齐全才能标记为 `[x]`。

推荐新对话开场任务：

> 继续 `E:\Lyrico-Desktop\IMPLEMENTATION_PLAN.md`。先完成 M1 移动端歌词管线剩余对齐，再实施 M2 Rust 后台批处理运行器。开始前检查实时工作区和移动端对应实现，不要重做已完成项，并在每个里程碑后更新计划与运行验证。

## 1. 当前真实快照

### 1.1 技术栈与持久化决策

- 前端：React 19、TypeScript、Ant Design、Vite。
- 桌面端：Tauri 2、Rust。
- 音频标签：当前使用 Lofty；只有完成格式兼容测试后才决定是否切换到移动端同款 TagLib。
- 业务索引：保留 SQLite，启用 WAL、外键、事务和 schema version；不再尝试引入构建成本过高的 RocksDB。
- 人工可迁移配置：使用 JSON；数据库不能被 JSON 替代。
- 数据目录：当前由 Tauri `app_local_data_dir` 解析。用户已明确“安装目录实现麻烦可保持现状”，所以不要把便携目录当作阻塞项，也不要宣称当前已实现安装目录优先。
- 音频文件是标签、歌词、封面和 ReplayGain 的最终事实来源；数据库只保存可查询摘要、关系、插件和任务状态。

### 1.2 最近一次验证证据

2026-07-13 M1 TTML localization/简繁设置补齐与 M2 歌词格式化处理器改动后的最近一次完整验证：

- `npm test`：29 项通过。
- `npm run build`：通过；仅保留 Vite 大 chunk 警告。
- `cargo test --manifest-path src-tauri/Cargo.toml`：32 项通过，2 项环境测试按默认忽略；Apple TTML localization 与 Apple 联网搜索两项环境测试均已单独解除忽略并通过。
- `cargo check --manifest-path src-tauri/Cargo.toml`：通过。
- `git diff --check`：通过。
- 本地浏览器运行态已检查恢复后的批处理“处理器工具栏 + 单操作面板”结构；浏览器环境没有 Tauri IPC，因此任务执行证据以 Rust 测试和真实音频测试副本为准。

这些结果只是当前基线；新对话修改后必须重新运行，不能直接引用为新改动的验证证据。

### 1.3 关键代码入口

| 范围 | 桌面端入口 | 移动端参考 |
|---|---|---|
| 应用状态与页面装配 | `src/app/App.tsx` | 对应 ViewModel/导航流程 |
| 单曲编辑器 | `src/components/SongDetails.tsx` | `EditFieldRegistry`、歌曲编辑页面 |
| 插件歌词转换 | `src/domain/pluginLyrics.ts` | `LyricsDocumentPipeline.kt`、`LrcDocumentFormat.kt`、`TtmlDocumentFormat.kt` |
| 本地歌词工具 | `src/domain/lyrics.ts` | 移动端歌词 processors |
| 歌词回归测试 | `src/domain/pluginLyrics.test.ts`、`src/domain/lyrics.test.ts` | 移动端歌词管线测试集 |
| 插件页面 | `src/pages/PluginsPage.tsx` | 移动端插件管理流程 |
| 插件运行时 | `src-tauri/src/plugins/` | `E:\Lyrico\Lyrico-Plugins` 与移动端 Host API |
| 批处理页面 | `src/pages/TasksPage.tsx` | 移动端批处理页面、Worker、ViewModel |
| ReplayGain | `src-tauri/src/replay_gain.rs` | 移动端 ebur128/批处理实现 |
| 进度订阅 | `src/hooks/useReplayGainProgress.ts` | 移动端任务 Flow/WorkManager |
| 扫描与命令 | `src-tauri/src/commands.rs` | 移动端媒体库扫描逻辑 |
| 数据库 | `src-tauri/src/database.rs` | 移动端实体/Repository 作为语义参考 |
| 可调列宽 | `src/hooks/useResizableColumns.tsx` | 桌面端专属 |
| 设置 | `src/pages/SettingsPage.tsx`、`src-tauri/src/config.rs` | 移动端设置项 |

### 1.4 当前 Rust 模块化边界

Rust 已从单文件抽出 `audio.rs`、`commands.rs`、`config.rs`、`database.rs`、`models.rs`、`paths.rs`、`replay_gain.rs` 和 `plugins/`，但拆分尚未完成：

- `commands.rs` 约 831 行，仍混合扫描、标签、ReplayGain 和批处理 command。
- `database.rs` 约 1150 行，schema、迁移和多个 Repository 仍在同一文件。
- `plugins/installer.rs` 与 `plugins/runtime.rs` 均超过 600 行，后续新增 Host API 前需要按职责拆分。

因此原需求“Rust 代码合理分配”状态为**部分完成**，不得在新对话中宣称已经收尾。

## 2. 不可回退的产品约束

后续实现必须保留以下已经确认的语义：

1. UI 术语使用“插件源”“批处理”“注释”，不退回“数据源”“任务”“备注”。
2. 不使用分页；大列表使用单一滚动区域、虚拟化或其他不会切断选集的策略。
3. 歌曲页右上角不放不明确目标的“编辑标签”按钮；任何单曲 Item 点击都必须打开该文件的编辑器。
4. 专辑/艺术家集合 Drawer 打开单曲编辑器时，编辑器必须处于最上层，不能被集合视图遮挡。
5. 任意含歌曲 Item 的列表都可进入多选；专辑/艺术家主列表勾选代表加入该集合的全部歌曲，详情仍支持逐首勾选。
6. 侧边栏“已选歌曲”位于折叠按钮上方，支持查看、移除、清空和进入批处理，不维护第二份选集状态。
7. 空标签值表示用户要删除该字段；缺失请求字段表示协议错误或未挂载字段保留原值，Rust 不得自作主张填默认值。
8. 在线匹配默认搜索所有已启用插件，使用“全部 + 各插件源”Tab；单源失败不能清空其他源结果。
9. 搜索结果的标签、封面、歌词是三个独立操作：
   - 标签：逐字段勾选，每行独立覆盖/补充；顶部提供全选和批量策略。
   - 封面：调整目标图片大小，不允许修改来源 URL 冒充封面编辑。
   - 歌词：支持普通 LRC、逐字 LRC、增强 LRC、TTML 切换和确认前编辑。
10. 插件返回结果只进入编辑器临时状态；确认保存后才写音频文件。
11. ReplayGain 必须使用 ebur128：目标响度 `-18 LUFS`，曲目响度使用 integrated/global loudness，峰值使用 true peak，禁止用 RMS 或平均 LUFS 替代。
12. 扫描、插件、封面和批处理不能阻塞前端事件循环；任务切页后仍可观察。
13. 不在媒体库数据库中保存完整 base64 封面；列表只加载缩略图，原图按需读取。
14. 设置必须真实影响行为，不能为了页面存在而保留无效设置或静态摘要。

## 3. 已实现基线

本节只列可继续复用的基线，不代表相关大阶段已经全部完成。

### 3.1 媒体库与通用交互

- [x] 歌曲、专辑、艺术家和批处理表格取消分页。
- [x] 应用级单曲编辑 Drawer；专辑、艺术家和文件夹详情中的单曲可打开正确编辑器。
- [x] 打开编辑器前关闭集合 Drawer，修复编辑器被压在单曲列表下方。
- [x] 移除歌曲页不明确目标的编辑按钮。
- [x] 替换 WebView 默认浏览器右键菜单。
- [x] 封面请求合并、批量去重、有限重试、视口预取和失败缓存失效。
- [x] 应用级选集、主列表集合多选、详情逐首多选和侧边栏已选歌曲抽屉。
- [x] 歌曲/专辑/艺术家列表头部及多选按钮位置完成第一轮统一。

### 3.2 数据、扫描与配置

- [x] SQLite Repository 基线、WAL、外键、busy timeout、事务和 `user_version`。
- [x] 媒体库关系、插件、插件缓存、批处理、任务项和日志表基线。
- [x] JSON 设置、原子替换、备份以及旧设置迁移基线。
- [x] 当前统一使用 Tauri `app_local_data_dir`；安装目录便携模式按用户确认暂不作为必做项。
- [x] 扫描放入后台线程，分为枚举、读标签、索引提交；最多 4 线程有界并发。
- [x] `path + size + mtime + scan signature` 增量判断和重复扫描拒绝。
- [x] Shell 应用级扫描进度。

### 3.3 插件系统

- [x] 移动端 API v3 manifest 基本校验、ZIP 路径安全和原子安装。
- [x] QuickJS 独立上下文、同插件串行、内存/栈/超时限制和隔离缓存。
- [x] `includeDirs` 与入口加载顺序。
- [x] `searchSongs/getLyrics/searchCovers`、标准字段及私有 `internal` 透传。
- [x] text/password/number/switch/dropdown/textarea/markdown 配置字段和依赖表达式。
- [x] 插件配置 Markdown 安全渲染；配置/清单 Tab；图标 Data URL；启停/卸载统一布局。
- [x] 兼容 manifest 中 boolean/number/null 标量默认值，修复 QQ 插件安装失败。
- [x] 修复 `bodyBytes: null` 覆盖正常 JSON body 导致 QQ 搜索返回空结果。
- [x] 编辑器默认并发搜索所有源，“全部 + 单源”Tab 和独立标签/封面/歌词确认对话框。

### 3.4 编辑器与歌词

- [x] 本地标签、在线匹配和文件信息 Tab；技术参数拆分为格式、时长、码率、采样率和声道数。
- [x] 封面右侧只保留替换、同专辑、导出、移除和还原操作。
- [x] 注释改为真实单行输入；删除“歌词已找到”“封面已内嵌”等无效状态。
- [x] 多值/手动输入流派；composer、lyricist、copyright、rating、language 第一轮读写。
- [x] 本地封面替换、移除、还原、同专辑复用和导出。
- [x] 歌词文件导入导出、时间偏移、移除空行和纯文本预览第一阶段。
- [x] 插件歌词使用统一 `LyricsDocument` 第一阶段，不再用单个正则直接拼接四种格式。
- [x] 修复逐字 LRC 最后一个字丢失、TTML `1.5s` 等时间表达失败、翻译按数组下标错配和逐字空格丢失。
- [x] 保存请求使用完整快照：显式空值删除，未挂载字段不被错误清空。

### 3.5 批处理、ReplayGain 与设置

- [x] 批处理页删除无效说明、占位统计和假历史页；未实现操作禁用。
- [x] SQLite 任务/任务项状态 API 基线和 ReplayGain 第一条真实执行链路。
- [x] Symphonia 流式解码并将交错 PCM 交给 `ebur128`，写入 track gain/peak。
- [x] ReplayGain 取消、跳过已有字段、成功/失败/取消状态记录。
- [x] Rust 运行进度最多每 100 ms 推送一次；前端独立进度存储最多每 160 ms 更新一次。
- [x] Shell 和当前编辑器局部订阅 ReplayGain 进度；应用根组件与批处理表格不再随每个 PCM 进度重渲染。
- [x] 歌词格式化由 Rust runner 执行，复用从 TypeScript `LyricsDocument` 管线生成的嵌入式运行时；支持目标格式、行序整理、标签行和空行处理，写入后重新读取文件。
- [x] 设置页左侧分类，删除静态占位内容；搜索数量和歌词格式/翻译/罗马音设置已真实接入行为。

## 4. 下一阶段执行顺序

除非新需求改变优先级，按 M1 → M2 → M3 → M4 → M5 → M6 实施。每个里程碑可以独立验收，禁止一次把所有未完成项混成不可审查的大改动。

### M1：完成移动端歌词管线对齐（已完成）

目标：本地歌词工具、插件歌词预览和批量歌词格式化共用一条结构化管线，不再出现同一歌词在不同入口解析结果不同。

- [x] 逐文件阅读移动端 `LyricsDocumentPipeline`、LRC/TTML parser/writer、processors 和测试，不凭记忆补语义。
- [x] 将 `src/domain/lyrics.ts` 中仍以正则处理的偏移、空行清理等逻辑迁移到统一 `LyricsDocument` processors。
- [x] 移植逐句排序和原文/翻译/罗马音显示顺序。
- [x] 移植非歌词内容/标签行过滤，并保证删除原文时同步删除关联翻译和罗马音。
- [x] 移植仅翻译策略、空行策略和简繁转换。
- [x] 将简繁转换模式接入桌面设置持久化和插件歌词预览，不再停留在未传参的管线内部能力。
- [x] 对齐 Apple TTML localization：同语系中文 replacement 替换正文并移除已消费翻译，跨语系 subtitle 保留；判断继续由移动端同源插件负责，不在通用 TTML 管线误删中文翻译。
- [x] 保留 TTML agent、`itunes:key`、翻译语言、罗马音、背景和声、文本节点空格及已知扩展。
- [x] 对未知 TTML 扩展定义明确策略：同格式无处理时原文透传；跨格式通过 `LyricsPipelineResult.warnings` 记录不可表达的命名空间信息，而不是静默丢失。
- [x] 将移动端歌词管线关键测试移植到桌面端，至少覆盖：
  - 最后一个逐字结束时间；
  - 行级歌词降级；
  - metadata translation；
  - agent/key/translation 关联；
  - 背景和声；
  - 空原文与关联轨道删除；
  - LRC ↔ TTML 往返；
  - TTML `ms/s/秒数/HH:MM:SS/MM:SS`；
  - 文本节点空格与 timed space。
- [x] 插件歌词预览和本地歌词按钮只调用统一入口；已导出 processor 契约和同源夹具。M2 尚未接入的 Rust 批量歌词处理器必须复用这些夹具与语义，不得新增正则路径。

验收：使用移动端同一测试夹具转换四种格式，文本、时间和轨道关系无意外丢失；`npm test` 与 `npm run build` 通过。

2026-07-13 M1 验证证据：`npm test` 27 项通过；`npm run build` 通过（仅保留既有大 chunk 警告）；`cargo test --manifest-path src-tauri/Cargo.toml` 20 项通过、1 项联网插件测试按环境忽略；`cargo check --manifest-path src-tauri/Cargo.toml` 与 `git diff --check` 通过。新增测试覆盖移动端 TTML/LRC 夹具、轨道顺序、关联删除、标签行过滤、OpenCC 简繁转换、统一 offset、全部移动端时间表达和跨格式扩展告警。

2026-07-13 M1 TTML localization 纠偏验证证据：确认问题不是通用 TTML parser 漏掉一个过滤条件，而是桌面插件运行时缺少移动端 `xml.getRootAttributes/findElements/replaceChildrenByAttr/removeElements` 四项 Host API，导致 Apple 插件主动跳过 localization；另确认 OpenCC 处理器已存在但桌面设置和 `SongDetails` 未传 `conversionMode`。现已补齐 Rust XML 模块、QuickJS `Platform.xml` 暴露、supportedHostApis、简繁设置持久化及预览传参。`npm test` 29 项、`npm run build`、`cargo test` 29 项（2 项环境测试默认忽略）、`cargo check`、`cargo fmt --check` 与 `git diff --check` 通过；Apple 专项测试显式加载移动端原始 `E:\Lyrico\Lyrico-Plugins\apple\lib\01_apple_api.js`，验证中文同语系无 type translation 被替换/去重、英文正文的中文 translation 保留，并覆盖 XML 实体/属性转义。设置页三种转换选项与原批处理单面板已在 `http://127.0.0.1:1420/` 实际检查。

### M2：Rust 后台批处理运行器（运行器、ReplayGain 与歌词格式化已完成，其他处理器待接入）

目标：页面只创建任务和订阅快照；任务不由 React `for` 循环驱动，切页和界面重渲染不影响执行。

- [x] 在 Rust 建立 `batch/manager.rs`、`worker.rs` 和 processor 接口。
- [x] 从 SQLite 恢复 queued/running 任务；running 项与 running item 重置为 queued，保留已完成项，ReplayGain 依靠写后重读和已有字段跳过保证恢复幂等。
- [x] 实现 1–5 有界并发，默认 3，与移动端 Worker 一致。
- [x] 实现任务级/单项取消、单项错误隔离、失败项重试和结构化日志。
- [x] 将 ReplayGain 前端串行编排迁移到 Rust；前端只监听任务快照和当前文件进度，旧的前端状态写入 command 已从 IPC 暴露面移除。
- [x] 按用户确认保留原有“处理器工具栏 + 单操作面板”交互，不再用“新建批处理/历史记录”双 Tab、Card 和明细表替换主流程。
- [x] ReplayGain 保留原有选中歌曲表格、字段状态、开始/取消和当前任务进度；执行改由 Rust runner 驱动，默认并发 3 写入任务配置，切页不影响任务。
- [ ] 历史记录以后只通过不干扰主流程的次级入口接入；Rust 已具备状态快照、单项原因、失败重试和取消 API，当前不把完整历史表塞回主页面。
- [ ] 逐项接入移动端处理器：
  1. [x] 歌词格式化；
  2. [x] 标签匹配；
  3. [ ] 批量编辑；
  4. [ ] 重命名；
  5. [ ] 导出歌词；
  6. [ ] 导出封面；
  7. [x] ReplayGain 曲目模式；专辑模式仍待实现。
- [ ] 重命名支持 `@1`–`@8`、非法字符映射、冲突编号和执行前预览。
- [ ] 导出歌词保持 TTML `.ttml`、其他 `.lrc`；导出封面按原文件基名并处理冲突。
- [ ] 批处理进度与扫描进度合并到 Shell 全局任务中心。

验收：启动批处理后切换到任意页面仍持续执行；取消后不再写后续文件；重启可查看历史；失败项可单独重试。

2026-07-13 M2 运行器验证证据：Rust 单元测试覆盖默认/边界并发和 running 任务/单项重启恢复；`sinewave.flac` 测试副本通过真实 ebur128 分析与 ReplayGain 写后重读；前端已删除串行 `for` 编排与任务状态写入 IPC，只保留 create/start/cancel/retry/load。页面纠偏后 `npm test` 27 项、`cargo test` 22 项通过（1 项联网插件测试按环境忽略），`npm run build`、`cargo check` 与 `git diff --check` 通过。本地 `http://127.0.0.1:1420/` 已实际检查原处理器工具栏、单 ReplayGain 表格、禁用空选集启动按钮及无双 Tab/Card 结构。尚未完成的处理器、轻量历史入口、专辑 ReplayGain 和统一 Shell 任务中心继续保留未勾选，不能把 M2 整体宣称为全部完成。

2026-07-13 M2 歌词格式化验证证据：逐文件核对移动端 `LyricsFormatProcessor`、`BatchLyricsFormatViewModel` 和配置 Bottom Sheet；桌面端 `formatLyrics` processor 复用由 `src/domain/pluginLyrics.ts` 生成的 105 KB QuickJS 运行时，没有新增正则转换路径。Rust 专项测试覆盖移动端格式枚举、逐字/增强 LRC 转普通 LRC、TTML 关联翻译随标签行过滤和无操作跳过；真实 `sinewave.flac` 副本完成歌词写入后重读，并确认标题、艺术家、专辑和 ReplayGain 未变化。最终 `npm test` 28 项、`cargo test` 26 项通过（1 项联网插件测试按环境忽略），`npm run build`、`cargo check` 与 `git diff --check` 通过；本地页面实际检查“歌词格式化”仍在原处理器工具栏中，配置和歌曲表格保持单面板结构。

2026-07-13 M2 标签匹配验证证据：逐段对照移动端 `BatchMatchConfig`、`BatchMatchViewModel`、`MatchMetadataProcessor` 和 `MusicMatchUtils`，Rust `matchMetadata` processor 已接入启用插件源顺序、最多 5 个查询、文本/时长/排名评分、`final 0.76 / text 0.72` 低分跳过、字段级停用/补充/覆盖、歌词获取与统一管线/OpenCC、封面下载校验、取消前写入检查和写后数据库摘要刷新。字段策略放在次级“匹配字段”弹窗，主页面保留原插件源选择、歌曲表和单一开始/取消入口；未支持实际写入的 Reference Loudness 没有伪装为可选字段，继续留在 M4 格式适配。`npm test` 29 项、`cargo test` 32 项通过（2 项环境测试默认忽略），`npm run build`、`cargo check`、`cargo fmt --check` 与 `git diff --check` 通过；显式运行移动端 Apple 插件联网搜索通过并返回 3 个“周杰伦 晴天”结果，页面已在 `http://127.0.0.1:1420/` 实际检查标签匹配单面板、字段弹窗、空选择/无源禁用状态。

### M3：插件系统收尾

- [x] 补齐移动端 Host API 的 XML 四项，并已使用 Apple 移动端原始 TTML 插件逻辑验证同语系 replacement 与跨语系 subtitle；作为 M1 TTML 纠偏提前完成。
- [ ] 多插件 ZIP、覆盖安装、升级、降级前展示候选和版本差异确认。
- [ ] 建立插件诊断视图：运行日志、Host API 错误、超时、权限/能力调用和相关插件 ID。
- [ ] 使用 `E:\Lyrico\Lyrico-Plugins` 的测试工具分别复验 Apple、QQ、酷狗、网易云、汽水。
- [ ] 对网络导致的空结果和宿主协议错误使用可区分的诊断信息，不能都显示“无结果”。
- [ ] 拆分过大的 `installer.rs`、`runtime.rs` 与 Host API 模块，保持 command 薄层。

验收：官方移动端插件可安装、配置、搜索、取标签/歌词/封面、禁用、升级和卸载；故障插件不会拖死主进程。

### M4：编辑器与标签模型收尾

- [ ] 逐项对齐移动端 `EditFieldRegistry` 的六组、字段名称、字段类型和可空语义。
- [ ] 补齐 `customFields` 的读取、编辑、写入和格式兼容规则。
- [ ] 展示并编辑 Track/Album Gain、Track/Album Peak、Reference Loudness。
- [ ] 为 ID3v2、Vorbis Comment、APE、MP4 建立 ReplayGain 格式适配器；不支持的字段必须明确提示。
- [ ] 完成封面编辑移动端语义：尺寸调整、格式/质量策略和预览；不能修改插件来源 URL。
- [ ] 保存前展示字段变更摘要。
- [ ] 保存后重新读取音频文件核验，只刷新目标歌曲及受影响的专辑/艺术家聚合。
- [ ] 建立 MP3/FLAC/M4A/APE/OGG 测试副本矩阵，再决定是否需要从 Lofty 切换到 TagLib。

验收：删除空字段、写多值流派、写歌词/封面/ReplayGain 后重新读取结果一致；不支持字段不会静默丢失。

### M5：导航、表格与扫描补全

- [ ] 提取统一 `TrackItem`/`LibraryTable` 点击、双击、多选和键盘契约。
- [ ] 艺术家详情增加“单曲 / 专辑”视图切换。
- [ ] 歌曲页和专辑详情中的艺术家文本可点击。
- [ ] 多艺术家先展示选择列表，单艺术家直接跳转到艺术家 Tab 并打开对应详情。
- [ ] 列宽按表格类型持久化到 `settings.json`；拖拽期间局部更新，结束后写盘。
- [ ] 所有主要表格维持 min/max、窄屏横向滚动，并提供“恢复默认列宽”。
- [ ] 增加扫描取消 command。
- [ ] 文件夹页展示可展开的失败文件明细。
- [ ] 使用大目录记录首次扫描、二次增量扫描和刷新期间 UI 响应数据。

验收：重启后列宽保留；艺术家跳转无误；扫描可取消；单文件失败不终止整个目录。

### M6：后端边界与回归保护

- [ ] 将 `commands.rs` 按 library/tags/plugins/batch 拆分，command 只做参数校验和调用 service。
- [ ] 将 `database.rs` 拆成 schema、migration 和 repositories。
- [ ] 将模型按 library/plugin/batch 分组，避免所有序列化结构继续堆在 `models.rs`。
- [ ] 建立统一可序列化错误模型；前端区分用户输入、文件格式、网络、插件、任务取消和内部错误。
- [ ] 为封面缓存、路径归属、JSON 原子写入、数据库迁移、扫描取消和任务恢复补测试。
- [ ] 评估 Vite 大 chunk，按编辑器/插件/设置页面做路由级或组件级代码分割。

验收：模块边界与职责对应；测试不依赖真实用户音乐库；错误提示能定位来源且不暴露敏感配置。

## 5. 原始需求状态矩阵

状态含义：完成 = 已实现且有基础验证；部分 = 有可用基线但验收未闭环；待做 = 尚未实现核心能力。

| # | 需求 | 状态 | 后续里程碑 |
|---|---|---|---|
| 1 | 封面偶发不加载、加载滞后 | 部分 | M5 压测与失败恢复验收 |
| 2 | 重设计编辑页并体现插件在线写入 | 部分 | M1、M4 |
| 3 | 数据源改为插件源 | 完成 | 防回退 |
| 4 | 任务改为批处理并对齐移动端能力 | 部分 | M2 |
| 5 | 移除歌曲页右上角编辑标签按钮 | 完成 | 防回退 |
| 6 | 任意单曲 Item 打开正确编辑器 | 完成 | M5 统一契约收尾 |
| 7 | 真实插件系统 | 部分 | M3 |
| 8 | 表格列宽可调并限制 min/max | 部分 | M5 持久化/恢复默认 |
| 9 | 文件夹刷新卡死、扫描慢 | 部分 | M5 取消/失败明细/压测 |
| 10 | 应用级扫描进度 | 完成 | M2 合并任务中心 |
| 11 | Rust 单文件合理拆分 | 部分 | M3、M6 |
| 12 | 不用过于简陋的数据库，最终允许 SQLite | 完成 | 已保留强化 SQLite |
| 13 | INI/YAML/JSON 持久化配置 | 完成 | 使用 JSON，业务数据仍入库 |
| 14 | 艺术家详情支持单曲/专辑视图 | 待做 | M5 |
| 15 | 艺术家文本跳转到指定艺术家 | 待做 | M5 |
| 16 | 数据优先放安装目录，困难时保持现状 | 按确认保持现状 | 当前使用 `app_local_data_dir` |
| 17 | 标签展示 ReplayGain；流派多选/手输 | 部分 | M4 Reference Loudness/格式适配 |

## 6. 后续补充需求状态

| 补充/缺陷 | 状态 | 后续里程碑 |
|---|---|---|
| 批处理主流程恢复为原工具栏和单面板 | 完成 | 防回退；历史以后使用次级入口 |
| 替换浏览器默认右键菜单 | 完成 | 防回退 |
| 编辑字段、分类、类型对齐移动端 | 部分 | M4 |
| 取消分页 | 完成 | 防回退 |
| 封面提前加载与失败恢复 | 部分 | M5 验收 |
| 集合单曲 Drawer 遮挡编辑 Drawer | 完成 | 防回退 |
| 空字段无法保存 | 完成 | 防回退并保留参数测试 |
| 任意歌曲列表进入多选并跳转批处理 | 完成 | 防回退 |
| 侧边栏查看、移除、清空已选歌曲 | 完成 | 防回退 |
| 专辑/艺术家主列表批量选择全部歌曲 | 完成 | 防回退 |
| 插件图标、间距、Markdown、配置/清单 Tab | 完成 | 防回退 |
| 标签/封面/歌词结果分别确认和调整 | 完成 | M1/M4 深化 |
| 默认搜索全部插件并按来源 Tab | 完成 | M3 错误诊断 |
| 设置页面侧边分类并接入真实选项 | 完成 | 后续按功能增量添加 |
| 歌词转换解析失败或丢信息 | 部分 | M1 |
| 批处理期间页面卡顿 | 部分 | 已消除根状态高频刷新；M2 移除前端编排 |
| ReplayGain 使用 ebur128 | 部分 | 曲目完成；M2/M4 补专辑与格式适配 |

## 7. 数据与架构目标

### 7.1 数据职责

| 数据 | 最终事实来源 | 持久化位置 |
|---|---|---|
| 音频标签、歌词、封面、ReplayGain | 音频文件 | 文件标签；写入后重新读取核验 |
| 歌曲/专辑/艺术家可查询摘要 | 音频文件扫描结果 | SQLite |
| 文件夹、插件状态、任务、日志 | 应用业务状态 | SQLite |
| 语言、列宽、歌词偏好、扫描并发 | 用户配置 | `settings.json` |
| 插件代码、manifest、图标 | 插件包 | `data/plugins/sources/<id>` |
| 大封面 | 音频文件/按需缓存 | 不进入歌曲摘要和数据库 base64 字段 |

### 7.2 当前数据目录

当前根目录来自 Tauri `app_local_data_dir`，其内部结构为：

```text
data/
├─ config/
│  ├─ settings.json
│  └─ data-location.json
├─ database/
│  └─ lyrico.sqlite3
├─ plugins/
│  └─ sources/<plugin-id>/
└─ logs/
```

配置文件必须包含 `schemaVersion`，使用同目录临时文件写入、flush、原子替换并保留 `.bak`。损坏时读取备份；备份也失败必须显示可见错误，不能静默清空。若未来实现安装目录便携模式，必须复用同一目录结构和迁移策略，不能再创建第二套数据模型。

## 8. ReplayGain 固定算法契约

后续实现专辑模式或重构时必须保持：

- 解码：Symphonia 流式解码为交错 PCM。
- 分析：`ebur128`，模式包含 integrated/global loudness 与 true peak。
- 目标响度：`-18 LUFS`。
- 曲目增益：`gain = -18 - measured_loudness`。
- Gain 格式：`%.2f dB`。
- Peak 格式：`%.6f`，只限制最小值为 0。
- 专辑响度：保留每首曲目的 ebur128 state，使用等价于 `ebur128_loudness_global_multiple` 的聚合；禁止直接平均 LUFS。
- 专辑峰值：所有曲目 true peak 最大值。
- 编辑器计算只写临时表单；用户保存或批处理执行时才写文件。
- 批处理只要任一 ReplayGain 字段已有值就跳过并记录原因，除非后续 UI 明确提供覆盖重算选项。

## 9. 统一验证与交付标准

### 9.1 每个里程碑必须运行

```powershell
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
git diff --check
```

### 9.2 专项验证

- 歌词：使用移动端同源夹具，比较四种格式的文本、时间、轨道、关联键和元数据。
- 插件：优先运行插件目录内 devkit/测试工具，再通过桌面 Host 运行同一请求做对照。
- 标签：只使用测试音乐副本验证 MP3/FLAC/M4A/APE/OGG，不在唯一原件上试写。
- 扫描：记录首次/增量耗时、取消行为、单文件失败和切页响应。
- 批处理：至少包含成功、已有值跳过、单项失败、任务取消、重启恢复和失败重试。
- UI：实际运行 `http://localhost:1420/` 或 Tauri 窗口，检查滚动、Drawer 层级、窄屏、长文本和多选。

### 9.3 完成定义

一项只有同时满足以下条件才能标记完成：

1. 真实入口已接通，不是演示状态或无效按钮。
2. 对应移动端语义已通过代码或文档核对。
3. 有自动化测试覆盖关键失败场景。
4. 前端构建和 Rust 检查通过。
5. 涉及文件写入时已从文件重新读取核验。
6. 涉及 UI 时已做真实窗口人工验收。
7. 本文件已同步状态、证据和剩余风险。

## 10. 当前已知风险

- TTML 跨格式转换尚不能保证所有未知命名空间扩展无损。
- Rust 已具备批处理历史、重试和有界并发，但历史的轻量次级 UI 入口尚未接入。
- 专辑 ReplayGain 与 ReplayGain 格式适配尚未完成。
- Reference Loudness 在 Lofty 通用键不支持的格式上仍缺专用适配器。
- 表格列宽当前可拖拽，但未完成跨重启持久化和恢复默认。
- 艺术家详情的专辑视图与艺术家文本跳转尚未实现。
- 扫描取消和失败文件明细尚未实现。
- Rust 大文件拆分尚未收尾。
- 安装目录便携模式当前未实现；按用户确认继续使用 `app_local_data_dir`，不属于当前阻塞问题。
- Vite 主 bundle 仍有大于 500 kB 的警告，后续需要代码分割，但优先级低于功能正确性和任务稳定性。
