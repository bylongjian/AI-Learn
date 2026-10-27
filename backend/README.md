# 学习咩后端

Python 3.11、FastAPI、Pydantic v2、LangChain `ChatPromptTemplate` 与 `langchain-deepseek.ChatDeepSeek`。
默认模型 `deepseek-flash`，通过 `DEEPSEEK_MODEL` 配置。使用 JSON mode、Pydantic 校验，并显式传递
`extra_body={"thinking":{"type":"disabled"}}`。实际模型输出为空、截断或不符合 schema 时会重试；不伪造 AI 结果。
接收后以完整原始文本严格解析 JSON 并重新执行 Pydantic 校验，不接受 LangChain 自动修复的缺括号、Markdown 围栏或尾随内容；拒绝 NaN、Infinity 和数值溢出。
上游 HTTP 200 但 completion 缺少或没有 choices 时也按畸形结果重试；重试时追加简短的严格 JSON/schema 纠正要求，总预算保持 45 秒。认证失败不重试。

## 本地运行

以下命令在 `backend` 目录的 PowerShell 中执行。若系统 `python` 不是 3.11，请改成自己的 Python 3.11 可执行文件路径。

```powershell
python -m venv .venv
./.venv/Scripts/python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
# 编辑 .env 填入自己的 DEEPSEEK_API_KEY
./.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

H5 前端使用 Taro Webpack5，运行地址为 `http://localhost:10086`，通过 `Taro.request` 直连后端 `http://127.0.0.1:8000`。
配置从进程环境和当前工作目录的 `.env` 读取，修改后重启。缺少 Key 时健康检查仍正常，生成接口返回配置提示。
应用正常或异常退出 lifespan 时关闭自己创建的 SDK 客户端；调用方注入的 provider 及借用的 HTTP 客户端由调用方管理。

`requirements.in` 描述直接依赖，`requirements.txt` 固定本次 Python 3.11 验证环境全部依赖，包含测试工具。

## 接口

所有业务接口响应均为 `{"code":0,"message":"ok","data":...}`；失败 `data` 为 `null`，不会回显 Key、输入或上游错误正文。
交互文档位于 `/docs`。

| 接口 | 输入 / 返回 |
| --- | --- |
| `GET /api/v1/health` | 无 Key 可用；返回 `data.status="ok"` |
| `POST /api/v1/quiz/generate` | `user_input` 1–2000 个 Unicode code point；`question_count` 3–5（默认 5）；`difficulty` 为 mixed/easy/medium/hard |
| `POST /api/v1/report/generate` | `quiz_id`、`topic`、完整 `questions`、每题恰好一条 `answer_records` |

Quiz 返回 `quiz_id/source_type/user_input/title/summary/questions`。
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
| 413 / 429 | 41301 / 42901 | 请求体过大 / IP 频率限制 |
| 503 | 50301 / 50302 | Key 或上游配置不可用 / 重试耗尽 |
| 504 | 50401 | 生成总超时 |
| 404 / 405 / 500 | 40400 / 40500 / 50001 | 路由 / 方法 / 未预期异常 |

## 验证

```powershell
./.venv/Scripts/python.exe -m pytest --cov=app --cov-branch --cov-report=term-missing
```

普通测试只在外部模型边界使用替身，并通过 `httpx.MockTransport` 测试真实 `ChatDeepSeek` HTTP 序列化、解析、上游错误和重试；不会调用付费接口。
`TDD.md` 保存测试先失败再通过的证据。

真实验收需自行配置 Key 并主动执行，预计最多 20 个业务生成请求（重试可能增加模型调用）：

```powershell
./.venv/Scripts/python.exe scripts/live_acceptance.py --run-live
```

脚本在进程内启动同一个 FastAPI 应用，对 10 组不同主题、数量与难度调用真实模型，逐组生成报告并检查结构、统计和 50 秒验收界限。
未传 `--run-live` 或 Key 为空时退出且不发送请求。当前实现使用 45 秒总预算，包含全部重试。
每组 quiz/report 的开始、结果、耗时和安全结构元数据逐条写入 `.qa/live-progress.jsonl`；可用 `--progress-log` 指定日志路径。
HTTP、JSON、schema、统计或超时失败都会记录固定原因和失败阶段后停止。schema 日志仅保留固定错误类型，未知类型统一归类；不记录字段路径、未知键、错误消息或输入。

2026-10-25 已完成真实 DeepSeek 验收：10 组出题、10 份报告全部通过，覆盖 3/4/5 题与 easy/medium/hard/mixed；
出题耗时 2.687–4.859 秒，报告 2.016–2.828 秒。非 mixed 每题难度一致、题型数量、严格 JSON/schema、报告统计均通过。
安全进度记录为 `.qa/live-verified-progress.jsonl`，摘要为 `.qa/live-summary.json`。该批次验证结构和流程，未逐题进行独立教学事实审计。
原有 AI 功能的 193 项测试保留通过。加入用户系统后，261 项测试通过，应用语句/分支覆盖率 98%；`pip check` 通过。详细 RED/GREEN 与真实诊断证据见 `TDD.md`。

## 用户、登录和云端练习

用户存储使用 MySQL 8、InnoDB 和 `utf8mb4`。连接池首次访问用户数据时才连接，关闭应用时释放。未配置数据库或数据库不可用均不阻止健康检查和游客 AI 功能启动；有效身份的云端存储失败返回安全的 503，不返回保存成功。

在 `backend/.env` 设置 `MYSQL_HOST/PORT/USER/PASSWORD/DATABASE` 和私有随机 `JWT_SECRET`。`JWT_EXPIRE_SECONDS` 默认 604800 秒；JWT 固定使用 HS256，并验证签名、签发者、受众、过期时间和身份类型。`JWT_SECRET` 没有默认值。微信登录另需 `WECHAT_APP_ID`、`WECHAT_APP_SECRET`，由服务器调用 `code2Session`；整个换码过程最多 5 秒，失败后不自动重用 code。

先由 MySQL 管理员创建数据库并授予该数据库的专用账号权限，再从 `backend` 初始化表：

```powershell
./.venv/Scripts/python.exe -m scripts.init_db
# 指定其他环境文件：
./.venv/Scripts/python.exe -m scripts.init_db --env-file .env.test
```

初始化 SQL 位于 `sql/001_users.sql`，重复执行安全；此命令建表并为已有表补齐统计所需的用户索引，不创建数据库或数据库账号。旧版本升级后也需执行一次。密码从环境文件读取，不作为命令参数传递。表包括用户、完整原始练习、每个练习的一份作答结果和一份报告；外键同时约束练习归属。

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

```powershell
./.venv/Scripts/python.exe -m pytest --cov=app --cov-branch --cov-report=term-missing
./.venv/Scripts/python.exe -m pip check
```

## MVP 范围与限制

包含账号、资料和标题搜索，以及登录后的练习和最终结果云端保存；不提供中途进度同步、游客历史自动导入、头像上传或对外分享接口。游客评分仍基于回传题目，登录评分只使用该用户已保存的原题。
IP 限流仅在本进程内保存，默认最多 1024 个客户端、每 IP 每 60 秒 20 次，拒绝新客户端时也不增长内存。
使用直接连接 IP，不信任任意 `X-Forwarded-For`。本地启动采用单 worker；多 worker/多实例不共享限流状态。
请求体上限默认 64 KiB，包括分块请求。内容规则是可配置词表，覆盖输入与生成结果，不等同于完整语义内容审核。
生产环境如需多实例共享限流、追踪或日志平台，应在后续范围中设计。

参考：[DeepSeek JSON mode](https://api-docs.deepseek.com/guides/json_mode/)、[LangChain DeepSeek](https://docs.langchain.com/oss/python/integrations/chat/deepseek)。
