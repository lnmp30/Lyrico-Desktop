# Lyrico Desktop 重构与功能对齐计划

## 1. 目标与约束

本计划覆盖当前提出的 17 项需求。实施时遵循以下原则：

1. 音频文件是标签、歌词、封面和 ReplayGain 的最终事实来源；数据库保存可查询的媒体库索引、关系、插件、任务和日志，JSON 保存应用配置与插件 manifest。
2. 桌面端插件协议与移动端 API v3 对齐，复用 `manifest.json + source.js + includeDirs` 包结构和标准字段，不另建不兼容协议。
3. 扫描、插件调用、批处理、封面解析都不得阻塞前端事件循环；长任务必须可观察、可取消、可恢复查看结果。
4. 先建立数据层和任务层边界，再改页面，避免页面直接调用 Tauri command 并维护重复状态。
5. 每个阶段都需要通过前端单元测试、TypeScript 构建、Rust 测试/检查和对应的人工验收用例。

## 2. 需求分组与依赖关系

### A. 稳定性与性能

- #1 封面偶发不加载
- #9 文件夹刷新卡死、首次扫描慢
- #10 应用级扫描进度

依赖：后台任务模型、封面缓存策略、轻量索引格式。

### B. 单曲编辑与导航

- #2 重设计编辑页面并加入在线搜索/写入流程
- #5 移除歌曲页右上角编辑标签按钮
- #6 所有单曲 Item 点击打开编辑视图
- #15 艺术家文本跳转指定艺术家
- #17 展示 ReplayGain 等标签；流派支持多值和手动输入

依赖：统一单曲入口、插件搜索服务、完整标签模型。

### C. 插件与批处理

- #3 “数据源”更名为“插件源”
- #4 “任务”改为“批处理”，对齐移动端能力
- #7 实现真实插件系统

依赖：插件运行时、数据库仓储、后台任务队列、完整标签读写。

### D. 浏览体验

- #8 表格列宽可调整并限制最小/最大值
- #14 艺术家详情支持单曲视图/专辑视图切换

依赖：统一可调整表格组件、集合详情模型。

### E. 后端与持久化

- #11 拆分 Rust 单文件
- #12 重构并强化数据库层；因 RocksDB 构建成本过高，按后续确认保留 SQLite
- #13 使用 INI/YAML/JSON 保存应用配置和便携设置，业务数据继续使用数据库
- #16 优先把数据放在安装目录，不可写时保持现状

依赖：数据库仓储、schema 迁移、配置文件原子写入、便携模式目录解析。

## 3. 目标架构

### 3.1 前端

```text
src/
├─ app/                       # 应用装配、路由、全局任务状态
├─ domain/
│  ├─ library/               # Song/Album/Artist 领域模型与聚合
│  ├─ plugins/               # manifest、能力、搜索结果、字段策略
│  └─ batch/                 # 任务、任务项、状态、配置
├─ services/
│  ├─ libraryService.ts      # Tauri API 的领域包装
│  ├─ pluginService.ts
│  └─ batchService.ts
├─ stores/
│  ├─ libraryStore.ts
│  ├─ editorStore.ts
│  └─ taskStore.ts           # 监听全局进度事件
├─ features/
│  ├─ editor/
│  ├─ library/
│  ├─ plugins/
│  └─ batch/
└─ components/               # 无业务状态的复用组件
```

页面只负责渲染和路由；搜索、保存、扫描、插件执行和任务状态由 service/store 负责。

### 3.2 Rust

```text
src-tauri/src/
├─ lib.rs                    # Tauri 装配与 command 注册
├─ error.rs                  # 统一可序列化错误
├─ paths.rs                  # portable/fallback 数据目录
├─ models/                   # Song、Folder、Plugin、BatchTask
├─ commands/                 # 薄 command 层
│  ├─ library.rs
│  ├─ tags.rs
│  ├─ plugins.rs
│  └─ batch.rs
├─ library/
│  ├─ scanner.rs             # 枚举、并发读取、增量判断
│  ├─ index.rs
│  └─ artwork.rs
├─ tags/                     # lofty 读写和字段映射
├─ database/
│  ├─ mod.rs                 # 数据库连接和事务边界
│  ├─ schema.rs              # SQLite schema、索引和 user_version 迁移
│  ├─ repositories/          # 媒体库、插件、任务、日志仓储
│  └─ migration.rs           # 旧 AppData 数据库和配置迁移
├─ config/
│  └─ json_store.rs          # 应用配置的原子 JSON 写入
├─ plugins/
│  ├─ manifest.rs
│  ├─ installer.rs
│  ├─ manager.rs
│  ├─ runtime.rs
│  └─ host_api/
└─ batch/
   ├─ manager.rs
   ├─ worker.rs
   └─ processors/
```

## 4. 数据库与配置持久化设计

### 4.1 数据库选型

保留 **SQLite** 作为嵌入式数据库，但重建其使用方式。SurrealDB + RocksDB 的验证分支因首次编译耗时约 3.5 分钟、Windows 构建依赖 libclang/NASM 而放弃；该成本与当前桌面应用规模不匹配。

强化后的 SQLite 方案：

- 数据访问统一经过 Repository，不允许 Tauri command 或页面直接拼查询。
- 启用 WAL、外键、busy timeout、NORMAL synchronous 和内存临时表。
- 扫描写入、文件夹删除、标签更新和关系重建使用显式事务。
- 使用 `PRAGMA user_version` 管理 schema migration，而不是在启动时散落执行 `ALTER TABLE`。
- 为文件指纹、文件夹、专辑排序、艺术家排序、任务状态和日志建立索引。
- 保留独立的歌曲—艺术家、歌曲—专辑关系表，为后续多艺术家导航和集合查询提供基础。

数据库包含以下表：

| 表/关系 | 职责 | 主要索引 |
|---|---|---|
| `library_folder` | 文件夹、扫描状态、进度摘要 | path unique、status |
| `song` | 轻量标签摘要、文件指纹、技术信息 | path unique、folder、album key、mtime |
| `artist` / `album` | 聚合实体 | normalized name/key unique |
| `artist_song` / `album_song` | 多艺术家和专辑成员关系 | 双向 relation index |
| `source_plugin` | 插件身份、版本、启用和顺序 | plugin id unique、enabled/order |
| `plugin_setting` / `plugin_cache` | 插件配置与隔离缓存 | plugin id、cache key、expires at |
| `batch_task` / `batch_task_item` | 批处理和扫描任务 | status、created at、task relation |
| `app_log` | 插件、扫描、批处理诊断 | type、level、created at、related id |
| `PRAGMA user_version` | 数据库 schema 版本 | 单调递增版本号 |

数据库不保存完整 base64 封面；歌词正文只在确实需要搜索/预览缓存时保存，并带文件指纹，文件变化后失效。标签写入成功后必须重新读取音频文件，再更新数据库摘要。

### 4.2 JSON 配置

JSON 不替代数据库，只保存适合人工备份、迁移和便携运行的应用配置。相较 INI，JSON 能无损表达数组和嵌套配置，并直接映射 serde/TypeScript 类型。

```text
data/
├─ config/
│  ├─ settings.json          # 语言、列宽、视图偏好、扫描并发等
│  └─ data-location.json     # 便携模式及实际数据库目录
├─ database/
│  └─ lyrico.sqlite3         # 强化 schema、WAL 和事务的主数据库
├─ plugins/
│  └─ sources/<plugin-id>/   # manifest.json、脚本、图标；状态和配置存数据库
└─ logs/
```

JSON 配置写入规则：

- 所有文件含 `schemaVersion`。
- 先写同目录临时文件，flush 后原子替换；保留最近一个 `.bak`。
- 进程内用读写锁串行化同一文件更新。
- 文件损坏时读取 `.bak`，仍失败则报告可见错误，不能静默清空。
- 旧 AppData 根目录中的 `lyrico.sqlite3` 在新安装目录数据库不存在时复制迁移；随后通过 `user_version` 增量升级 schema。

数据目录策略：

1. 可执行文件旁存在 `portable.flag` 或 `data/` 且可写时，使用安装目录旁 `data/`。
2. 否则尝试创建并写入安装目录旁 `data/`。
3. 无写权限时回退 Tauri `app_data_dir`，并在设置页显示实际路径和回退原因。

## 5. 分阶段实施

### Phase 0：基线与回归保护

- [x] 核对当前真实技术栈和代码入口。
- [x] 运行现有 `npm test`、`npm run build`、`cargo check`。
- [ ] 为封面缓存、路径归属、艺术家拆分、数据库仓储、JSON 配置原子写入和扫描增量判断补测试。
- [ ] 建立统一错误模型和前端错误提示入口。

验收：改造前测试基线有记录；后续每阶段不降低通过率。

### Phase 1：低耦合交互与封面稳定性

- [x] 封面请求失败不再永久缓存为“无封面”；批量请求支持去重、有限退避重试和刷新失效。
- [x] 编辑抽屉移动到应用级，所有 `LibraryTable` 单曲行使用同一 `openTrackEditor(path)`。
- [x] 移除歌曲页右上角“编辑标签”按钮，以实际点击的行作为编辑目标。
- [x] 专辑、艺术家、文件夹详情中的单曲行点击打开编辑视图。

验收：模拟一次封面读取失败后无需刷新应用即可恢复；任何列表点击的路径与编辑器显示/保存路径一致。

### Phase 2：Rust 拆分与数据库迁移

- [x] 抽取 `models/audio/database/config/commands/paths`，保持 command 名称兼容。
- [x] 建立独立 SQLite Repository，启用 WAL、事务、外键、busy timeout 和 schema version。
- [x] 建立媒体库关系、插件、插件缓存、批处理、任务项和日志表及索引。
- [x] 艺术家拆分设置迁移到 JSON，业务索引、插件、任务和日志保留在数据库。
- [x] 歌曲表只读取轻量摘要和文件指纹；扫描不再生成或持久化新的 base64 封面。
- [x] 实现旧 AppData 数据库和旧数据库设置的一次性兼容迁移。
- [x] 实现安装目录优先、不可写回退 AppData，并在设置页展示实际数据库位置。

验收：全新安装、旧库迁移、事务回滚、schema 升级、JSON 配置损坏回退、只读安装目录六种场景均通过；数据库仓储测试必须验证外键和版本设置。

### Phase 3：后台扫描与应用级进度

- [x] `scan_folder` 将阻塞工作放入后台线程，并通过全局事件提供稳定 `jobId`；页面可在等待结果时正常切换。
- [x] 扫描分为文件枚举、标签读取、索引提交三个阶段。
- [x] 使用最多 4 线程的有界 Rayon 工作池并发读标签，避免无界线程和内存增长。
- [x] 根据 `path + size + mtime + scan signature` 跳过未变化文件；删除项在本轮事务提交时清理。
- [x] 同一文件夹重复刷新会被扫描注册表拒绝，禁止并发互相覆盖。
- [x] 通过 Tauri event 推送 `running/completed/failed` 和阶段、数量、错误数。
- [x] 应用 Shell 常驻显示扫描进度，切换页面不丢失。
- [ ] 增加扫描取消命令，并在文件夹页展示可展开的失败文件明细。

验收：刷新时 UI 可持续操作和切页；大目录二次扫描明显快于首次扫描；任务可取消；单文件失败不终止整个目录。

### Phase 4：真实插件系统（移动端 API v3）

- [ ] 支持 ZIP 导入、manifest 递归发现、候选预览、安装/更新/覆盖/降级判断。
- [ ] 对齐移动端校验：反向域名 ID、API v3、能力、入口/include 路径、大小、文件数、ZIP 穿越防护。
- [ ] 插件原子安装到 `plugins/sources/<id>`，默认禁用。
- [ ] 实现 manifest `configFields` 的 text/password/number/switch/dropdown/textarea/markdown 和依赖表达式。
- [ ] 实现隔离 JS 运行时、每插件串行执行、超时/内存限制、关闭与失效缓存。
- [ ] 第一轮 Host API 覆盖现有官方插件必需的 app/runtime/cache/http/log/json/base64/crypto/compression；随后按移动端 41 API 补齐。
- [ ] 实现 `searchSongs/getLyrics/searchCovers`、标准字段解析、插件私有 `internal` 上下文和字段写入策略。
- [ ] 插件日志、权限调用和错误进入诊断页，不再使用静态演示插件。
- [ ] 将导航和页面文案从“数据源”统一改为“插件源”。

验收：直接安装移动端仓库中的 Apple/网易云/QQ/酷狗插件，能启用、配置、搜索、取歌词/封面、禁用和卸载；故障插件不能拖死主进程。

### Phase 5：编辑器重设计与完整标签模型

编辑器改为三部分：

1. **文件与媒体摘要**：封面、文件名、路径、格式、时长、码率；信息按组排列，不再拥挤在封面右侧。
2. **本地标签**：基础字段、贡献者字段、歌词、注释、ReplayGain、自定义字段。
3. **在线匹配**：插件源顺序、搜索词、候选结果、字段差异、逐字段应用/全部应用。

具体改动：

- [ ] “备注”统一改为“注释”，使用真实单行输入；长内容需要时显式展开编辑。
- [ ] 移除“歌词已找到”“封面已内嵌”两个无效状态项。
- [ ] 文件路径和技术信息移到独立只读区域。
- [ ] 展示并可编辑 Track/Album Gain、Track/Album Peak、Reference Loudness。
- [ ] 标签模型补齐 composer、lyricist、copyright、rating、language、customFields。
- [ ] 流派使用 tags 模式：支持多选、手动输入、粘贴分隔、去重；写入时按格式能力映射为多值或兼容字符串。
- [ ] 封面支持替换、移除、还原和来自插件候选的预览。
- [ ] 保存前展示变更摘要，保存后只刷新对应文件和受影响的专辑/艺术家聚合。

验收：本地编辑和插件匹配都通过同一保存管线；不支持多值的格式有明确降级规则；保存后重新从文件读取核验。

### Phase 6：统一单曲/集合导航

- [ ] 提取统一 `TrackItem`/`LibraryTable` 交互契约，点击永远打开对应路径编辑器。
- [ ] 艺术家详情增加“单曲/专辑”分段切换；专辑视图按同一 ArtistGroup 下的 AlbumGroup 聚合。
- [ ] 歌曲详情和专辑详情中的艺术家文本可点击。
- [ ] 使用移动端同一艺术家拆分规则；多艺术家先弹出选择列表，单艺术家直接跳转。
- [ ] 跳转时切换到艺术家 Tab、设置目标 artistId、打开对应详情，并保留返回上下文。

验收：歌曲、专辑、艺术家、文件夹、批处理结果中的单曲都打开正确文件；多艺术家选择不会误跳。

### Phase 7：表格列宽

- [ ] 建立统一列定义和列宽状态，按表格类型保存到 `config/settings.json`。
- [ ] 表头拖拽调整宽度；标题、专辑、艺术家等列分别定义 min/max/default。
- [ ] 拖拽过程使用局部状态，结束后再持久化，避免频繁写盘。
- [ ] 窄窗口继续支持横向滚动；提供“恢复默认列宽”。

验收：所有主要表格可调整；宽度不会小于最小值或超过最大值；重启后保留。

### Phase 8：批处理中心

- [ ] 导航“任务”改为“批处理”，提供“新建任务”和“任务历史”。
- [ ] 实现任务/任务项状态：queued/running/succeeded/failed/skipped/cancelled。
- [ ] 实现并发限制、取消、单项错误隔离、结果日志和失败项重试。
- [ ] 对齐移动端处理器：
  - 标签匹配：插件顺序、字段补充/覆盖/禁用、文件名优先、并发 1–5。
  - 批量编辑：`<keep>` 语义、预览、封面与自定义字段。
  - 重命名：`@1`–`@8`、非法字符映射、冲突自动编号、执行前预览。
  - 歌词格式化：目标格式、逐句排序、过滤非歌词、移除空行。
  - 导出歌词：TTML 为 `.ttml`，其余 `.lrc`。
  - 导出封面：按原文件基名导出，保留/转换策略明确。
  - ReplayGain：已有值跳过，写入 gain/peak/reference loudness。
- [ ] 批处理进度与扫描任务共用 Shell 全局任务中心。

验收：任务切页和重启后历史仍在；每项成功/失败/跳过可追溯；取消不会继续写后续文件。

## 6. 需求—阶段映射

| 需求 | 阶段 |
|---|---|
| 1 | Phase 1 |
| 2 | Phase 5 |
| 3 | Phase 4 |
| 4 | Phase 8 |
| 5 | Phase 1 |
| 6 | Phase 1、6 |
| 7 | Phase 4 |
| 8 | Phase 7 |
| 9 | Phase 2、3 |
| 10 | Phase 3 |
| 11 | Phase 2 |
| 12 | Phase 2 |
| 13 | Phase 2 |
| 14 | Phase 6 |
| 15 | Phase 6 |
| 16 | Phase 2 |
| 17 | Phase 5、8 |

## 7. 每阶段统一验证

```powershell
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

涉及扫描、插件、写标签或文件重命名时，额外使用测试音乐副本验证，不在唯一原件上做破坏性测试。
