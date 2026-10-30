# web-search-context Specification

## Purpose
Ensure quiz generation uses relevant, traceable learning material rather than unsupported model knowledge. This capability obtains web or user-provided evidence, checks its suitability, and prevents questions from being delivered when the evidence is insufficient.

## Requirements

### Requirement: Quiz generation obtains relevant learning material
系统 SHALL 在出题前尝试获取参考资料：主题输入通过联网获取，公开 HTTP(S) URL 读取网页，充分正文作为用户资料。未传 `doc_id` 时资料不足 SHALL 补充检索，不能只靠模型知识；有效文档请求 SHALL 按 `knowledge-base-quiz-generation` 先检索文档，并适用该能力明确规定的联网与模型降级规则。

#### Scenario: User enters a topic
- **WHEN** 用户不传 `doc_id`，只提交主题且没有充分学习材料
- **THEN** 系统先检索相关网络资料再生成题目

#### Scenario: User provides a public webpage
- **WHEN** 用户不传 `doc_id`，提交公开 HTTP(S) 网页，可附带学习要求
- **THEN** 系统读取指定网页，以相关正文作为主要资料

#### Scenario: Page cannot be read
- **WHEN** 普通出题所指定的网页无法读取，且没有充分学习资料
- **THEN** 系统暂停生成并提示重试或粘贴正文，不声称已读过网页

#### Scenario: User provides sufficient text during a search outage
- **WHEN** 普通出题提交了足以支持所需题量的正文，且不存在待核验的外部信息或时效要求
- **THEN** 系统可基于正文出题，标注用户提供的资料，不声称已独立联网核实

### Requirement: Reference selection respects topic and requested freshness
The system SHALL prefer relevant primary sources and distinguish publication time from retrieval time. It SHALL assess the requested domain, version, and freshness before accepting evidence. Missing dates SHALL remain unknown, and a recent retrieval time SHALL NOT be presented as a recent publication time.

#### Scenario: New concept conflicts with model knowledge
- **WHEN** relevant primary material describes a concept differently from the model's prior knowledge
- **THEN** the quiz follows the retrieved material for the confirmed topic

#### Scenario: User requests a recent version
- **WHEN** the user specifies a version or asks for current information
- **THEN** evidence must support that version or freshness claim, otherwise the system pauses generation

#### Scenario: Recent filter excludes useful sources
- **WHEN** a narrow date filter yields no suitable evidence for a topic without a user-required date window
- **THEN** the system can broaden retrieval while preserving source dates and checking relevance

#### Scenario: Sources disagree
- **WHEN** retrieved sources contain unresolved conflicting claims needed for a question
- **THEN** the system excludes those claims or pauses generation if the remaining evidence cannot support the requested quiz

### Requirement: Insufficient evidence pauses generation
未传 `doc_id` 时，相关资料不足以支持请求题量及讲解，系统 SHALL 返回明确失败，不静默使用模型知识，不保存题库，也不把部分题目当完整成功结果。有效文档请求 SHALL 适用 `knowledge-base-quiz-generation` 的明确例外：先文档、再联网，仍失败或不足时可以交付带未核实标识的完整模型兜底题库。

#### Scenario: Empty or irrelevant search results
- **WHEN** 普通出题未获得相关资料，或结果来自无关领域
- **THEN** 系统暂停生成，建议补充具体领域、学习正文或参考链接

#### Scenario: Retrieval service unavailable
- **WHEN** 普通出题的检索失败、超时、被关闭或没有有效配置，且用户正文不足
- **THEN** 系统报告无法获取学习资料，提供重试或修改输入的方式

#### Scenario: Too little material for five questions
- **WHEN** 普通出题资料只能支持少于请求的五道题
- **THEN** 系统请求更多资料，不编造事实，也不静默减少题数

#### Scenario: Explicit document fallback exception
- **WHEN** 通过登录、归属和就绪校验的文档请求，其文档与联网资料均未准备成功或仍不足
- **THEN** 系统按文档出题规范尝试模型兜底，明确标记未核实，不将该规则扩展到普通出题

### Requirement: Questions are checked against their evidence
系统 SHALL 对有资料依据的题库核对题干事实、正确答案及讲解，每题必须关联实际依据。无依据的事实、矛盾答案或不明确选项 SHALL 阻止交付，除非在预算内修正并复查。明确标记的文档模型兜底题库 SHALL 仍通过结构、数量、题型、难度及内容校验，但不得声称通过了原文依据核验。

#### Scenario: Unsupported explanation
- **WHEN** 有资料依据的题目出现不能被对应资料支持的讲解
- **THEN** 系统修正并重新审核，或返回失败且不保存题库，不借模型兜底绕过审核

#### Scenario: Unknown source association
- **WHEN** 有资料依据的题目引用本次没有取得的来源
- **THEN** 系统拒绝该关联，不把它作为真实依据

#### Scenario: Valid JSON contains incorrect facts
- **WHEN** 有资料依据的题目结构合法，但事实与资料矛盾
- **THEN** 结构合法不能使其跳过依据检查

#### Scenario: Fallback remains structurally validated
- **WHEN** 文档模型兜底生成的题库不符合请求题量、题型或难度
- **THEN** 系统仍在预算内重试或返回失败，不以“模型兜底”为由交付错误结构

### Requirement: Users can inspect quiz sources
有依据的新题库 SHALL 保存主题、资料准备时间、来源标识和名称、可获得的链接与发布日期、支持摘录和逐题关联，并在讲解中展示。用户正文和私有文档 SHALL 不伪造公开链接。模型兜底题库 SHALL 保存并显示未核实标识及原因，且不伪造引用；本机、云端及报告回看 SHALL 保留相同含义。

#### Scenario: Inspect a question after answering
- **WHEN** 用户查看新题目的讲解
- **THEN** 有依据题目可以展开支持资料及可用链接；模型兜底题目显示未核实提示

#### Scenario: Reopen a saved quiz
- **WHEN** 用户从本机或云端历史重开本次之后生成的题库
- **THEN** 原有来源及逐题关联、或模型兜底信息仍可查看

#### Scenario: Open a historical quiz without sources
- **WHEN** 用户打开此前没有来源或生成方式信息的题库
- **THEN** 题库继续可用，提示没有保存参考来源，不编造引用，也不推断为本次模型兜底

### Requirement: Knowledge acquisition is bounded
系统 SHALL 限制资料工具调用次数、请求期限与交给模型的资料大小。普通出题触及上限或超时 SHALL 明确失败；有效文档请求的资料准备触及上限或超时 SHALL 结束检索，转入规定的模型兜底。完整请求到期时 SHALL 取消未完成的获取和生成，不因降级延长期限。

#### Scenario: Excessive tool use
- **WHEN** 资料获取尝试超过配置的工具调用次数
- **THEN** 系统阻止更多调用；普通出题停止，文档出题仅可按其规则进入模型兜底

#### Scenario: Oversized material
- **WHEN** 取得的资料超过上下文上限
- **THEN** 系统选择保留来源关联的相关片段，并重新判断这些片段是否足够出题

#### Scenario: Stage budgets fit the frontend deadline
- **WHEN** 请求使用默认配置
- **THEN** 资料准备和出题审核各共用 25 秒，包含保存的整个请求最多 55 秒；文档检索、联网及模型降级不各自重新获得完整请求时间

### Requirement: External material is treated as data
The system SHALL treat webpage content, supplied text, and topic selections as untrusted learning material. It SHALL NOT obey embedded instructions that alter system rules or fabricate evidence. It SHALL only submit public HTTP(S) webpage URLs for extraction and SHALL keep service credentials on the backend.

#### Scenario: Page contains prompt injection
- **WHEN** a webpage instructs the model to ignore its rules or generate unrelated answers
- **THEN** that text does not override topic, evidence, or output requirements

#### Scenario: Private or unsupported URL
- **WHEN** the user submits a local, private-network, credential-bearing, or non-HTTP(S) URL
- **THEN** the system rejects webpage extraction without accessing the target

#### Scenario: System proxy returns synthetic DNS addresses
- **WHEN** a public domain resolves locally to the proxy's `198.18.0.0/15` synthetic range
- **THEN** the backend verifies its real A and AAAA records through a fixed HTTPS DNS service within the acquisition budget, without modifying system proxy or DNS settings
- **AND** private answers, synthetic IP literals, failed lookups and unverified destinations remain rejected
