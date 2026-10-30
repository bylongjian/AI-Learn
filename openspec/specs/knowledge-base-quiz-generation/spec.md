## Purpose

Define quiz generation with relevant learning material, including a separate retrieval path for a referenced private document. Preserve user and document isolation when document retrieval is used.

## Requirements

### Requirement: Quiz generation accepts an optional knowledge base document reference
系统 SHALL 在现有 `POST /api/v1/quiz/generate` 请求上接受可选 `doc_id`。未传时继续当前有依据的普通出题与领域确认；传入时必须先确认登录、归属及 `ready` 状态，再准备文档资料。请求仍保留学习主题、题量、难度和可选领域，成功返回完整题库。

#### Scenario: Request without doc_id behaves unchanged
- **WHEN** 客户端不传 `doc_id`
- **THEN** 系统沿用现有资料充分性、领域确认及逐题依据检查，资料不足时仍暂停，不启用文档专用模型兜底

#### Scenario: Request with doc_id uses the referenced document
- **WHEN** 登录用户提交自己的就绪文档和学习主题
- **THEN** 系统首先检索该文档；资料足够时生成符合请求题量和难度的完整题库，经依据检查并保存后返回

#### Scenario: doc_id references a document not owned by the user
- **WHEN** 文档不存在或属于其他账号
- **THEN** 系统返回未找到，不检索、不联网、不调用模型兜底，也不保存题库

#### Scenario: doc_id references a document that is not ready
- **WHEN** 文档处于 `processing`、`failed`、`deleting` 或 `delete_failed`
- **THEN** 系统返回文档不可用于出题的明确提示，不使用联网或模型绕过此检查

#### Scenario: Guest attempts document generation
- **WHEN** 没有有效登录凭证的请求携带 `doc_id`
- **THEN** 系统返回认证错误，不退回游客出题

### Requirement: Agentic retrieval chooses between knowledge base and web search
有效文档请求 SHALL 先检索指定文档，资料足够即停止补充；资料不足或检索失败时，Agent SHALL 在剩余预算内尝试可用的联网工具。文档和网络资料仍不充分或不可获取时，系统 SHALL 尝试明确标记的模型兜底；不得省略文档检索直接选择模型出题。

#### Scenario: Agent retrieves from knowledge base only
- **WHEN** 指定文档检索到的内容足以支持所需题量和讲解
- **THEN** 系统只使用这些文档依据出题，不必调用联网搜索

#### Scenario: Agent supplements with web search
- **WHEN** 文档检索失败、没有相关内容或不足以支持完整题库，且联网可用
- **THEN** 系统尝试联网补充；充分资料可由文档与网页共同组成，也可仅由网页组成，并如实标明实际来源

#### Scenario: Web search unavailable, knowledge base still used
- **WHEN** 联网未配置或被关闭，但指定文档资料已经充分
- **THEN** 系统仍按文档依据出题，不要求联网成功

#### Scenario: Retrieval agent failure degrades gracefully
- **WHEN** 文档与联网检索均未取得充分资料，或资料准备阶段预算耗尽
- **THEN** 系统在剩余出题预算内按学习主题生成模型兜底题库，明确提示未依据文档或联网资料核实；若模型本身也失败则返回错误，不伪造成功题库

#### Scenario: Ambiguous topic still needs confirmation
- **WHEN** 学习主题存在未解决的领域歧义，无法确定用户要练习的含义
- **THEN** 系统要求确认领域后重新请求，不使用模型兜底替用户选择领域

### Requirement: Knowledge base retrieval is scoped and isolated per user and document
知识库检索 SHALL 同时限定已认证用户和本次指定的 `doc_id`，不得混入该用户的其他文档或其他账号的片段。删除开始后文档 SHALL 不再用于新题库；生成期间发生删除时，系统 SHALL 在保存前拒绝该文档请求，不改成模型兜底来绕过删除。

#### Scenario: Retrieval scoped to the specified document
- **WHEN** Agent 使用不同关键词重新检索文档
- **THEN** 每次结果仍仅来自当前账号的指定文档，Agent 不能自行扩大用户或文档范围

#### Scenario: Document is deleted during generation
- **WHEN** 资料准备后、题库保存前文档被删除或进入删除状态
- **THEN** 系统停止保存并提示文档已不可用，不返回成功题库

### Requirement: Document quizzes preserve their actual generation mode
文档出题 SHALL 保存 `document`、`document_web`、`web_fallback` 或 `model_fallback` 方式及所选文档标识。发生降级时 SHALL 保存安全可读的原因。文档及网页依据模式 SHALL 为每题保留有效引用；模型兜底 SHALL 不包含冒充真实来源的引用或“已核实”声明。

#### Scenario: Document evidence is visible
- **WHEN** 用户查看文档依据题目的讲解或报告回看
- **THEN** 可查看文件名、支持片段、片段标识及可获得的 PDF 页码；非公开文档不生成网页链接或虚构发布日期

#### Scenario: Model fallback is visible before answering
- **WHEN** 用户打开模型兜底生成的题库
- **THEN** 答题前即可看到“模型生成，未依据文档或联网资料核实”和降级原因，每题讲解也保留未核实提示，不显示虚假文档引用

#### Scenario: Reopen saved fallback quiz
- **WHEN** 用户从本机或云端重新打开兜底题库或其报告
- **THEN** 原有生成方式和降级原因仍显示，不被误标成普通“历史记录未保存来源”

#### Scenario: Legacy quizzes have no generation metadata
- **WHEN** 用户打开此前没有生成方式字段或来源字段的题库
- **THEN** 题库继续可用，按原有历史提示展示，不猜测它是否由模型兜底生成

### Requirement: Document fallback cannot bypass other business failures
模型兜底 SHALL 仅用于文档资料准备失败或不足。登录、归属、文档状态、领域待确认、内容违规、限流、请求格式、题目结构、已取得依据的题目审核以及存储失败 SHALL 按各自规则返回，不得当成检索失败吞掉。

#### Scenario: Grounded question fails evidence review
- **WHEN** 已取得充分资料但生成题目与依据不符，且一次修正后仍不通过
- **THEN** 系统返回生成失败，不切换成免于依据检查的模型题库

#### Scenario: Saving a generated quiz fails
- **WHEN** 登录用户的题库因数据库故障未能保存
- **THEN** 系统返回保存失败，不声称已经加入账号，也不再次调用模型进行降级

### Requirement: Document generation has shared deadlines
文档检索、充分性判断和联网补充 SHALL 共用 25 秒资料准备预算，出题及所需依据审核 SHALL 共用 25 秒，完整请求含身份和保存 SHALL 在 55 秒内结束。单次文档检索 SHALL 留出联网补充时间；资料准备超时可进入模型兜底，但完整请求超时 SHALL 返回错误。

#### Scenario: Local retrieval is slow
- **WHEN** 文档检索未能在为其分配的短预算内结束
- **THEN** 系统停止等待该次检索，在资料准备剩余时间尝试联网；资料准备总时间不重新计时

#### Scenario: Preparation budget expires before model fallback
- **WHEN** 文档和联网准备达到 25 秒上限
- **THEN** 系统不再检索，取消未结束的外部调用，并在后续出题预算内尝试模型兜底

#### Scenario: Entire request reaches deadline
- **WHEN** 整个请求达到 55 秒仍未完成
- **THEN** 系统停止本次生成并返回超时，不继续后台出题或排队创建异步出题任务

### Requirement: Private documents do not become public search payloads
文档内容 SHALL 只作为学习资料，不执行其中要求修改系统规则的指令。联网补充 SHALL 基于学习主题检索，不直接发送原文件、文件路径或整段私有摘录；服务密钥 SHALL 仅保存在后端。

#### Scenario: Private material asks the agent to change behavior
- **WHEN** 文档包含“忽略规则”、改用他人文档或伪造来源的文字
- **THEN** 系统不执行这些要求，继续遵守指定文档范围及真实来源规则

#### Scenario: Web supplement follows document retrieval
- **WHEN** 系统根据文档出题请求进行联网补充
- **THEN** 搜索请求使用学习主题，不附带原文件、私有片段或服务端路径
