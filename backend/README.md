# 学习咩后端

后端使用 Python 3.11、FastAPI、Pydantic v2 和 LangChain，负责资料获取、DeepSeek 出题、计分、报告、登录和知识库。第一次配置请先看[本地运行指南](../docs/保姆级本地运行指南.md)，模块关系见[方案设计](../docs/方案设计文档.md)。

## 一、开发与配置

所有命令在 `backend/` 执行。依赖直接声明在 `requirements.in`，已验证版本锁定在 `requirements.txt`；本次整理不升级依赖。

```powershell
if (-not (Test-Path .venv/Scripts/python.exe)) { python -m venv .venv }
./.venv/Scripts/python.exe -m pip install -r requirements.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
./.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

配置读取进程环境和当前目录 `.env`，修改后重启。缺少 Key 时健康检查可用，对应功能返回配置提示。密钥不写进源码，接口不回显上游原始错误。

| 配置组 | 作用 |
| --- | --- |
| `DEEPSEEK_API_KEY/BASE_URL/MODEL` | 模型连接；默认模型 `deepseek-flash` |
| `TAVILY_API_KEY`、`ENABLE_WEB_SEARCH` | 普通主题与网页资料获取 |
| `MYSQL_*`、`JWT_SECRET` | 账号、云端练习和知识库元数据 |
| `WECHAT_APP_ID/SECRET` | 真实微信 code2session 登录 |
| `APP_ENV`、`DEV_LOGIN_ENABLED` | 开发登录只能在 development 环境启用 |
| `DASHSCOPE_*`、`KB_*` | 百炼向量化、文件数量大小及处理预算 |
| `CHROMA_PERSIST_DIR`、`KB_UPLOAD_DIR` | 持久化与临时目录；相对路径以 backend 为基准 |
| `CORS_ORIGINS`、`RATE_LIMIT_*`、`MAX_BODY_BYTES` | H5 来源、进程内频率和请求大小限制 |

全部字段和默认值见 [.env.example](.env.example)，跨字段约束见 `app/core/config.py`。API 不自动建库建表；账号首次使用或升级后运行 `./.venv/Scripts/python.exe -m scripts.init_db`。初始化会处理全部 SQL、旧表字段与索引，不清空已有记录。

## 二、接口一览

交互文档位于 [localhost:8000/docs](http://127.0.0.1:8000/docs)。正常业务响应为 `{code:0,message:"ok",data:...}`；普通错误的 `data` 为 null，领域确认是带选项的特殊错误响应。

| 方法与路径 | 输入和结果 |
| --- | --- |
| `GET /api/v1/health` | 返回 `data.status="ok"`，不检测外部服务是否全部可用 |
| `POST /api/v1/quiz/generate` | `user_input` 1～2000 字符，`question_count` 3～5，`difficulty` mixed/easy/medium/hard；可选 `topic_context`、`doc_id` |
| `POST /api/v1/report/generate` | `quiz_id/topic/questions/answer_records`；登录用户以本人已存原题判分 |
| `POST /api/v1/user/login` | 微信一次性 code 换取用户资料和 JWT |
| `POST /api/v1/user/dev-login` | 显式开发账号；仅启用开发模式且直接连接地址为本机时可用 |
| `GET/PUT /api/v1/user/profile` | 获取资料与统计、修改昵称和头像 URL；需要登录 |
| `GET /api/v1/user/quizzes` | 本人题库分页、标题关键词与状态筛选 |
| `GET /api/v1/user/quizzes/{quiz_id}` | 本人完整题库、最终作答、报告和引用快照 |
| `POST /api/v1/knowledge/documents` | multipart 单文件字段 `file`，可选 `file_name` 保留微信原名；返回 202 与 processing |
| `GET /api/v1/knowledge/documents` | 本人文档列表、数量和单文件上限 |
| `GET /api/v1/knowledge/documents/{doc_id}` | 状态、片段数与可展示的失败提示 |
| `DELETE /api/v1/knowledge/documents/{doc_id}` | 返回 202 与 deleting；清理完成后查询为 404 |

知识库接口全部要求有效 Bearer 身份；匿名学习接口可作为游客使用。登录题库保存后返回 `X-Learning-User`，前端据此确认云端归属。

### 题库、来源与报告

接口数据必须能在本机和云端往返恢复，因此来源与生成方式随完整题库保存，历史列表只返回摘要。旧题库没有这些可选字段时仍可读。

| 数据 | 主要字段和规则 |
| --- | --- |
| Quiz | `quiz_id/source_type/user_input/title/summary/questions/reference/generation` |
| Question | `id/type/stem/options/answer/explanation/knowledge_point/difficulty`；单选和多选 A～D，判断 A/B |
| Reference | `topic/retrieved_at/sources/question_sources`；每题关联真实来源，不虚构发布日期 |
| Source | `id/kind/title/url/published_at/excerpt`；文档额外有 doc_id、chunk_id 和可用 page |
| Answer record | `question_id/selected_answers/is_correct/duration_ms`；后端忽略客户端正确标记并重新判分 |
| Report | `quiz_id/accuracy/correct/total/xp/mastered_points/weak_points/three_line_summary/advice/share_quote` |

三种题型比例为 `question_count-2` 道单选、一多选、一判断。多选按完整答案集合计分；正确率半数向上取整，`xp=correct*10`。同一知识点任意一题错误即列入待巩固。AI 只生成总结、建议与鼓励语，不能改统计。

### 常用错误

前端按 HTTP 状态和 code 展示下一步操作，不依赖原始异常文本。错误信息不含密钥、文件内部路径或上游响应正文。

| HTTP / code | 含义 |
| --- | --- |
| 401 / `40101` | 需要有效登录 |
| 404 / `40401` | 文档或练习不存在、或不属于当前用户 |
| 409 / `40902` | 需选择领域，`data.options` 提供 2～4 个选项 |
| 409 / `40903`、`40904` | 文档未就绪、文档数量已满 |
| 422 / `42201`、`42202`、`42203` | 输入格式、内容规则、资料不足或网页不可读 |
| 413 / `41301`；429 / `42901` | 请求或文件过大、频率限制 |
| 503 / `50301`～`50304` | 配置、生成重试耗尽、云端存储或联网资料服务不可用 |
| 504 / `50401` | 生成超过总预算 |

## 三、出题和外部调用边界

普通出题先获取资料并确认领域，生成后检查结构和逐题依据，未通过时最多修正一次。关闭搜索或没有 Key 时，只能用充分正文作为明确标记的用户资料，不自动用模型知识冒充已核实资料。

资料准备默认 25 秒，生成与依据检查 25 秒，含保存总请求最多 55 秒，前端等待 60 秒。外部工具最多四次，资料总量最多 12000 字符。单条模型链最多 45 秒，并受所处阶段剩余时间约束；认证失败不重试。

模型使用 JSON mode，完整原始 JSON 重新经过 Pydantic 和业务校验；缺括号、Markdown 围栏、额外尾随内容及非有限数值不会被自动修复后接受。SDK 客户端由创建它的一方释放，应用 lifespan 负责关闭应用自有资源。

公开 URL 保留私网检查。代理 Fake-IP 命中 `198.18.0.0/15` 时，使用固定 DNSPod HTTPS DNS 核验真实地址，最多 3 秒，只提交域名；私网、合成 IP 字面量和核验失败仍拒绝读取。无需通过修改系统代理或关闭保护来绕过。

## 四、私有文档与运行数据

知识库的上传、处理和删除都有明确状态，202 只表示已接受。默认每人 10 篇、每篇 10MB；失败或未清理完的记录仍占名额。支持 PDF/DOCX/MD/TXT，扫描件无 OCR，文本使用 UTF-8。

文档解析由可终止子进程执行，含排队最长 180 秒；原文件解析后删除。默认按 1000 字符分块、重叠 150，向量存本地 Chroma；相对目录以 backend 为准。文档与充分性判断先用最多 8 秒，仍共享整次资料准备的 25 秒预算。

文档出题按“文档 → 联网 → 带警示的模型兜底”执行。`generation.mode` 为 document、document_web、web_fallback 或 model_fallback；兜底时 `reference=null` 并保存未核实提示与原因。身份、归属、文档状态、内容、依据审核、格式和保存失败都不能触发模型兜底。

只运行一个 API worker，不能让多个进程同时写本地 Chroma。备份时停写并同时备份 MySQL 和 Chroma；更换向量模型、维度或地域地址后删除旧文档重传。删除文档保留既有题库、报告和引用快照。

## 五、测试与限制

完整回归需要真实独立 MySQL；测试外部响应均为替代数据，不调用付费接口。配置与不依赖数据库的检查命令见[项目维护指南](../docs/项目维护指南.md)。

```powershell
./.venv/Scripts/python.exe -m pytest -q --tb=short
./.venv/Scripts/python.exe -m pip check
```

共享数据库和文档 fixture 位于 `tests/conftest.py`。`.env.test` 的数据库名必须以 `_test` 结尾，fixture 只清理该独立库；测试账号需要建表、读写与 ALTER 权限。测试不能并发共享同一个数据库。

限流保存在单个 API 进程内，默认每 IP 每 60 秒 20 次；登录另有独立限额。请求体默认 64KiB，文件上传使用 11MiB multipart 上限，文件本身仍为 10MiB。仅使用直接连接 IP，不信任任意转发头；内容词表也不等于完整语义审核。

未实现中途进度跨端同步、游客自动导入、头像上传、对外分享和部署方案。历史真实 API 验证与尚未验证事项见[验收记录索引](../docs/验收记录/README.md)。
