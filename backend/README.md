# 学习咩后端

Python 3.11、FastAPI、Pydantic v2、LangChain `ChatPromptTemplate` 与 `langchain-deepseek.ChatDeepSeek`。
默认模型 `deepseek-flash`，通过 `DEEPSEEK_MODEL` 配置。使用 JSON mode、Pydantic 校验，并显式传递
`extra_body={"thinking":{"type":"disabled"}}`。实际模型输出为空、截断或不符合 schema 时会重试；不伪造 AI 结果。
接收后以完整原始文本严格解析 JSON 并重新执行 Pydantic 校验，不接受 LangChain 自动修复的缺括号、Markdown 围栏或尾随内容；拒绝 NaN、Infinity 和数值溢出。
上游 HTTP 200 但 completion 缺少或没有 choices 时也按畸形结果重试；重试时追加简短的严格 JSON/schema 纠正要求。单条生成链最多 45 秒；出题还受下文的 25 秒阶段预算和 55 秒请求预算约束。认证失败不重试。

## 本地运行

以下命令在 `backend` 目录的 PowerShell 中执行。若系统 `python` 不是 3.11，请改成自己的 Python 3.11 可执行文件路径。

```powershell
python -m venv .venv
./.venv/Scripts/python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
# 编辑 .env 填入自己的 DEEPSEEK_API_KEY 和 TAVILY_API_KEY
./.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

H5 前端使用 Taro Webpack5，运行地址为 `http://localhost:10086`，通过 `Taro.request` 直连后端 `http://127.0.0.1:8000`。
配置从进程环境和当前工作目录的 `.env` 读取，修改后重启。缺少 Key 时健康检查仍正常，生成接口返回配置提示。
应用正常或异常退出 lifespan 时关闭自己创建的 SDK 客户端；调用方注入的 provider 及借用的 HTTP 客户端由调用方管理。

`requirements.in` 描述直接依赖，`requirements.txt` 固定本次 Python 3.11 验证环境全部依赖，包含测试工具。

## 接口

### 出题参考资料配置

出题前先获取资料，再判断领域和资料是否充分。Tavily 负责关键词搜索和公开网页读取；密钥只保存在后端。

在 `backend/.env` 中填写 `TAVILY_API_KEY=你的密钥`，然后重启后端。其他配置可沿用默认值：

| 配置 | 默认值 | 用途 |
| --- | --- | --- |
| `ENABLE_WEB_SEARCH` | `true` | 启用外部资料获取 |
| `KNOWLEDGE_TIMEOUT_SECONDS` | `25` | 资料获取和领域判断总预算 |
| `QUIZ_BUILD_TIMEOUT_SECONDS` | `25` | 出题、依据检查与修正共享预算 |
| `QUIZ_REQUEST_TIMEOUT_SECONDS` | `55` | 包含保存的出题请求总预算 |
| `KNOWLEDGE_MAX_TOOL_CALLS` | `4` | 每次准备最多四次外部工具调用 |
| `KNOWLEDGE_MAX_CONTEXT_CHARS` | `12000` | 交给模型的资料与元数据大小上限 |

两个阶段的预算之和必须小于请求总预算；总预算最多 55 秒，前端等待 60 秒。
关闭搜索或缺少密钥时，系统不会自动退回模型知识出题。用户仍可粘贴充分的学习正文，作为明确标记的用户资料；这不代表已经核实最新信息。
搜索失败、网页不可读或资料不足时，保留输入并提示重试、补充领域、正文或公开参考链接，不伪造已阅读的资料。

代理启用 Fake-IP 时，无需修改系统代理：后端只在本机解析命中 `198.18.0.0/15` 时，通过固定的 DNSPod HTTPS DNS 接口核对真实 A/AAAA 地址，最多等待 3 秒。同一请求复用同域名结果，不缓存到后续请求；同批来源并行核验。真实私网、合成 IP 字面量及核验故障仍不能提取。只提交域名，不向 DNS 服务发送正文或模型密钥。接口依据：[DNSPod 官方文档](https://cloud.tencent.com/document/product/302/110786)。

纯网页链接读取正文后选择相关片段，不从路径猜测检索词；用户附带学习重点时才按重点提取，最多返回五段供后端筛选。题目依据仍逐字核验，复查引用尽量使用短的连续原文，避免模型改动引号或空格造成误拒。

成功响应为 `{"code":0,"message":"ok","data":...}`；普通错误 `data` 为 `null`。需要选择领域时，HTTP 409 / `40902` 的 `data.options` 返回 2～4 个简短选项。错误不回显密钥或上游错误正文。
交互文档位于 `/docs`。

| 接口 | 输入 / 返回 |
| --- | --- |
| `GET /api/v1/health` | 无 Key 可用；返回 `data.status="ok"` |
| `POST /api/v1/quiz/generate` | `user_input` 1–2000 字符；`question_count` 3–5；`difficulty` 为 mixed/easy/medium/hard；可选 `topic_context` 为 1–200 字符的领域描述 |
| `POST /api/v1/report/generate` | `quiz_id`、`topic`、完整 `questions`、每题恰好一条 `answer_records` |

Quiz 返回 `quiz_id/source_type/user_input/title/summary/questions/reference`。新题库的 `reference` 保存主题、资料准备时间、来源及逐题关联；历史题库允许缺省或为 `null`。
每题字段为 `id/type/stem/options/answer/explanation/knowledge_point/difficulty`；
选项为 `{key,text}`，答案为大写字母数组。题型比例为 `question_count-2` 道单选、1 道多选、1 道判断。
单选/多选严格 A–D 四选项，判断严格 A/B 两选项（A 正确、B 错误）。

答题记录字段为 `question_id/selected_answers/is_correct/duration_ms`；允许空选择，`duration_ms` 非负且有限。
服务端忽略客户端 `is_correct`，按选择与答案集合完全一致判分，不给多选部分分。
Report 返回 `quiz_id/accuracy/correct/total/xp/mastered_points/weak_points/three_line_summary/advice/share_quote`。
`accuracy` 为整数、四舍五入（半数向上），`xp=correct*10`。同一知识点任何一题答错即归入 weak，且不同时归入 mastered。
AI 只生成三条总结、1–5 条建议和一句鼓励，不能修改统计或知识点集合。

| HTTP | code | 含义 |
| --- | --- | --- |
| 422 | 42201 / 42202 | 请求校验失败 / 命中内容规则 |
| 422 | 42203 | 资料不足或参考网页无法读取，请补充资料 |
| 409 | 40902 | 主题有多个含义，需要用户选择领域 |
| 413 / 429 | 41301 / 42901 | 请求体过大 / IP 频率限制 |
| 503 | 50301 / 50302 | Key 或上游配置不可用 / 重试耗尽 |
| 503 | 50304 | 联网资料获取不可用、调用上限或搜索故障 |
| 504 | 50401 | 生成总超时 |
| 404 / 405 / 500 | 40400 / 40500 / 50001 | 路由 / 方法 / 未预期异常 |

### 领域确认与出题顺序

1. 后端判断输入是主题、实际正文还是公开 URL，再获取对应资料。
2. 检索后仍有多个含义时，返回 `data.options`，每项包含 `label` 和 `description`，不生成题库。
3. 用户选择后，用原始 `user_input` 加上所选领域的 `topic_context` 重新提交。选择只限定检索方向，不跳过资料检查。
4. 领域明确、资料充分后生成题目，先检查结构、题型数量和难度，再检查每道题的事实、答案、讲解和原文依据。
5. 依据检查失败时最多修正一次，修正后仍需复查。全部通过后才允许保存和返回。

资料、网页和领域描述都作为输入数据，不执行其中的指令。来源 ID、审核覆盖范围及引用片段需要程序校验，不能仅相信模型自报“已核实”。

搜索无结果与服务故障分开处理：前者允许 Agent 在原预算内调整关键词或非用户指定的过滤条件，后者仍暂停。同一网页后来取得正文时会更新已有来源并保留 ID；即使已有五个来源，资料不足时仍可改进这些来源，不继续增加数量。

### 来源展示与保存

每道题讲解下可以展开参考来源。网页来源显示标题、原文片段、链接和已知发布日期；没有发布日期时明确说明，不使用检索时间代替。充分正文标记为“用户提供的资料 · 未独立联网核实”。

| `reference` 字段 | 内容 |
| --- | --- |
| `topic` / `retrieved_at` | 已确认主题 / 带时区的资料准备时间 |
| `sources` | 最多五项，每项包含 `id/kind/title/url/published_at/excerpt`；正文没有 URL 和发布日期 |
| `question_sources` | 每题一项 `{question_id,source_ids}`，必须覆盖全部题目且只引用实际来源 |

游客随本机题库保存来源；登录后随完整题库保存到 MySQL，详情接口返回同一份资料。历史列表只返回摘要，避免携带大段片段。旧题库仍可答题和查看报告，页面提示“本次记录未保存参考来源”。

若公开网页被拒绝，请先检查 URL 是否公开可读，再查看后端是否提示公开地址核验失败。Fake-IP 已由项目内 HTTPS DNS 核验兼容，无需调整系统代理；核验服务不可达时可稍后重试或粘贴正文，系统不会放宽私网地址限制。

## 验证

```powershell
./.venv/Scripts/python.exe -m pytest -q --tb=short
./.venv/Scripts/python.exe -m pip check
```

当前核心回归为 175 项通过，覆盖资料获取、领域确认、逐题依据检查、来源保存、确定性计分、账号隔离及 MySQL 幂等结算。自动化测试替换外部模型、检索和微信 HTTPS 边界，不调用付费接口；MySQL 仓储使用真实独立测试库，配置与安全规则见下文。真实 API 验收单独记录在 [AI 出题优化验收记录](../docs/AI出题优化验收记录.md)。

## 用户、登录和云端练习

用户存储使用 MySQL 8、InnoDB 和 `utf8mb4`。连接池首次访问用户数据时才连接，关闭应用时释放。未配置数据库或数据库不可用均不阻止健康检查和游客 AI 功能启动；有效身份的云端存储失败返回安全的 503，不返回保存成功。

在 `backend/.env` 设置 `MYSQL_HOST/PORT/USER/PASSWORD/DATABASE` 和私有随机 `JWT_SECRET`。`JWT_EXPIRE_SECONDS` 默认 604800 秒；JWT 固定使用 HS256，并验证签名、签发者、受众、过期时间和身份类型。`JWT_SECRET` 没有默认值。微信登录另需 `WECHAT_APP_ID`、`WECHAT_APP_SECRET`，由服务器调用 `code2Session`；整个换码过程最多 5 秒，失败后不自动重用 code。

先由 MySQL 管理员创建数据库并授予该数据库的专用账号权限，再从 `backend` 初始化表：

```powershell
./.venv/Scripts/python.exe -m scripts.init_db
# 指定其他环境文件：
./.venv/Scripts/python.exe -m scripts.init_db --env-file .env.test
```

初始化 SQL 位于 `sql/001_users.sql`。旧版本升级也执行上述命令：初始化流程查询列是否存在，再按 `sql/002_quiz_reference.sql` 增加可空 `reference JSON` 列，重复执行不会重复加列。命令还会补齐统计所需的用户索引，不创建数据库或数据库账号。密码从环境文件读取，不作为命令参数传递。表包括用户、完整原始练习、每个练习的一份作答结果和一份报告；外键同时约束练习归属。

回滚时配套回退前后端代码，保留新增的可空列和已有数据，不执行删列或清空题库。旧行的来源为 `null`；旧版代码仍按原字段查询。回滚会恢复旧版出题行为，不能继续声称具备本次资料检查能力。

`APP_ENV` 可为 `development/test/production`，默认 `development`。`DEV_LOGIN_ENABLED` 默认 `false`；仅在明确启用且环境为 `development` 时注册开发登录，还要求直连客户端为回环地址。开发账号 a/b 对应不同稳定身份，资料的 `is_test=true`，不依赖微信授权。生产环境禁止启用开发登录并拒绝开发身份 JWT。开发登录不应通过反向代理暴露给外部用户。

以下路径均位于 `/api/v1`，使用现有 `code/message/data` 信封。用户接口要求 `Authorization: Bearer <token>`；缺失或过期返回 401。

| 接口 | 输入 / `data` |
| --- | --- |
| `POST /user/login` | `{code}` → `{token,expires_in,user:Profile}` |
| `POST /user/dev-login` | `{account:"a"或"b"}` → 同上；禁用时 404 |
| `GET /user/profile` | `Profile` |
| `PUT /user/profile` | `{nickname,avatar_url}` → 更新后的 `Profile` |
| `GET /user/quizzes` | `page=1&page_size=10&search=&status=all或pending或completed` → `{items,total,page,page_size,totals}` |
| `GET /user/quizzes/{quiz_id}` | `{quiz:原始完整Quiz,answer_records,report:Report或null,created_at}`；其他用户的练习 404 |

`Profile` 包含 `id`（字符串）、`nickname`、`avatar_url`、`total_xp`、`quiz_count`、`correct_count`、`average_accuracy`、`is_test`。统计只计入完成并保存的结果；没有完成题目时平均正确率为 `null`，否则按全部完成题目加权，并沿用半数向上取整。昵称去除首尾空白后为 1–100 字符且拒绝控制字符；头像为空或不含用户密码的 HTTPS URL，最多 500 字符，没有上传功能。

练习列表按创建时间、内部 ID 倒序，`page_size` 为 1–50，搜索按标题字面子串匹配。`items` 包含 `quiz_id/title/question_count/correct_count/accuracy/status/created_at`；未完成时 `correct_count/accuracy` 为 `null`，`status` 为 `not-started`，完成后为 `completed`。`totals` 的 `all/pending/completed` 基于当前搜索条件。时间使用 UTC ISO 8601。

原有出题和报告路径继续支持游客；缺失或无效凭证按游客处理且完全不访问用户数据库。有效身份出题在返回前保存完整原始题目。报告验证归属和完整原题，不信任客户端的题目修改或 `is_correct`。答题结果、报告和 `correct*10` XP 同事务保存；失败全部回滚。已保存的同答案重试直接返回原报告，不再请求模型，冲突答案返回 409。模型调用期间不持有数据库锁。进程间并发依靠行锁和唯一约束，确保 XP 只增加一次；同进程同时提交还会合并模型调用。

仅在成功完成身份对应的云端保存后，出题与报告响应附带 `X-Learning-User: <用户ID>`。CORS 公开该响应头并允许 `Authorization` 和 `PUT`；客户端可验证请求确实按该身份处理，避免令牌过期时把游客结果误当成云端保存。游客响应不含该头。登录接口另有每 IP 每分钟 30 次的进程内限额，不占 AI 限额；请求体大小限制同时覆盖 POST 和 PUT。

## 用户系统测试环境

用户仓储和端到端 API 测试要求真实 MySQL，不使用 SQLite 或替代仓储。新建独立测试数据库（名称必须以 `_test` 结尾）与专用账号，将配置放在被 Git 忽略的 `.env.test`；不能复制应用数据库名称。建议 `APP_ENV=test`、`DEV_LOGIN_ENABLED=false`，测试会在专用测试应用内显式启用开发身份。测试数据清理仅针对该独立数据库。

测试账号需有独立测试数据库的建表、读写与 ALTER 权限；回滚测试通过临时 CHECK 约束使真实报告写入失败，并在 `finally` 中移除，不修改 MySQL 全局设置。测试依旧只替换外部模型或微信 HTTPS 边界，不访问付费模型。

## MVP 范围与限制

包含账号、资料和标题搜索，以及登录后的练习和最终结果云端保存；不提供中途进度同步、游客历史自动导入、头像上传或对外分享接口。游客评分仍基于回传题目，登录评分只使用该用户已保存的原题。
IP 限流仅在本进程内保存，默认最多 1024 个客户端、每 IP 每 60 秒 20 次，拒绝新客户端时也不增长内存。
使用直接连接 IP，不信任任意 `X-Forwarded-For`。本地启动采用单 worker；多 worker/多实例不共享限流状态。
请求体上限默认 64 KiB，包括分块请求。内容规则是可配置词表，覆盖输入与生成结果，不等同于完整语义内容审核。
生产环境如需多实例共享限流、追踪或日志平台，应在后续范围中设计。

参考：[DeepSeek JSON mode](https://api-docs.deepseek.com/guides/json_mode/)、[LangChain DeepSeek](https://docs.langchain.com/oss/python/integrations/chat/deepseek)。
