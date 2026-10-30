# Spec Delta

## MODIFIED Requirements

### Requirement: User can upload a private document
系统 SHALL 允许已登录用户上传 `.pdf`、`.docx`、`.md`、`.txt`，默认每篇最多 10MB（10 × 1024 × 1024 字节）、每人最多 10 篇。系统 SHALL 在接受上传前检查文件格式、实际字节数和文档数，不设每日次数额度；现有请求频率限制仍适用。尚未彻底删除的记录均占用文档名额。

#### Scenario: Successful upload of a supported format
- **WHEN** 已登录用户上传允许格式的文件，文件大小和文档数量都未超限
- **THEN** 系统保存待处理文件、建立 `processing` 记录并返回 `doc_id`，不等待解析和向量化完成

#### Scenario: Unsupported file format rejected
- **WHEN** 用户上传允许格式之外的文件，例如旧版 `.doc`
- **THEN** 系统明确提示支持的格式，不建立文档记录

#### Scenario: File exceeds size limit
- **WHEN** 文件实际大小超过 10MB，无论请求是否声明文件大小
- **THEN** 系统拒绝上传并清理本次临时内容，不占文档名额

#### Scenario: User exceeds document count limit
- **WHEN** 用户已有 10 篇尚未彻底删除的文档后再次上传，或并发上传将使总数超过 10
- **THEN** 系统拒绝超额部分并提示先删除文档，最终接受的文档总数不超过 10

#### Scenario: Unauthenticated upload attempt
- **WHEN** 请求缺少有效登录凭证
- **THEN** 系统返回认证错误，不建立文档记录，不按游客接受上传

### Requirement: Document is parsed and embedded asynchronously
系统 SHALL 后台提取文字、分块、向量化并保存检索片段。全部成功后状态才变成 `ready`；解析、向量化失败或自接受上传起 180 秒内未完成时变成 `failed`，附安全可读的原因。未完成片段 SHALL 不可检索，并被清理；清理未完成必须可追踪和重试。

#### Scenario: PDF document parsed successfully
- **WHEN** 可提取文字的 PDF 在处理期限内完成解析与向量化
- **THEN** 文档变成 `ready`，保存实际片段数量和可获得的页码

#### Scenario: Word document parsed successfully
- **WHEN** DOCX 在处理期限内完成解析与向量化
- **THEN** 文档变成 `ready`，保存实际片段数量，不编造 Word 页码

#### Scenario: Markdown or text document parsed successfully
- **WHEN** UTF-8 编码的 Markdown 或 TXT 在处理期限内完成解析与向量化
- **THEN** 文档变成 `ready`，片段内容可用于检索和出题

#### Scenario: Parsing or embedding failure
- **WHEN** 文件损坏、编码无法读取，或向量化服务失败
- **THEN** 状态变成 `failed`，提示删除后重新上传；部分片段不可用于出题，并执行可重试清理

#### Scenario: PDF has no extractable text
- **WHEN** PDF 只有扫描图片且没有可提取的文字层，或文件需要密码才能读取
- **THEN** 文档变成 `failed`，提示上传可复制文字且无需密码的版本，不调用 OCR，也不假装解析成功

#### Scenario: Processing deadline expires
- **WHEN** 文档自接受上传起 180 秒仍未处理完成，包括排队时间
- **THEN** 文档变成 `failed` 并提示超时，停止后续处理，不允许迟到结果把状态改回 `ready`

### Requirement: User can query document processing status
系统 SHALL 只允许已登录用户读取自己文档的处理状态。状态包括 `processing`、`ready`、`failed`、`deleting`、`delete_failed`；失败时提供可理解的原因，禁止返回密钥、本地路径或服务内部报错详情。

#### Scenario: Poll while processing
- **WHEN** 用户查询仍在处理的自己的文档
- **THEN** 系统返回 `processing`，前端显示处理中且不能开始闯关

#### Scenario: Poll after success
- **WHEN** 用户查询处理成功的自己的文档
- **THEN** 系统返回 `ready` 和实际片段数量

#### Scenario: Poll after failure
- **WHEN** 用户查询处理失败的自己的文档
- **THEN** 系统返回 `failed` 和失败原因，提供删除后重传的操作

#### Scenario: Query another user's document
- **WHEN** 用户查询其他账号的文档或不存在的文档
- **THEN** 系统统一返回未找到，不泄露文件名、片段或状态

### Requirement: User can list their own documents
系统 SHALL 向已登录用户返回其自己的文档列表，按最近上传时间倒序，包含文档 ID、文件名、格式、大小、状态、片段数量、上传时间和可用的失败提示。未登录用户 SHALL 无法读取列表。

#### Scenario: List documents
- **WHEN** 用户打开自己的知识库
- **THEN** 列表只包含该账号的文档，失败或等待删除的文档仍能看到并处理

### Requirement: User can delete their own document
系统 SHALL 允许用户删除自己任意状态的文档，并清除其记录、检索片段及剩余临时文件。接受删除后文档 SHALL 立即不可用于新出题；只有所有清理完成才移除记录。已有题库、报告和引用摘录 SHALL 保留，不依赖原文档继续存在。

#### Scenario: Successful deletion
- **WHEN** 用户删除自己的文档且所有清理完成
- **THEN** 文档从列表消失、名额释放，片段不再存在；先前的题库和报告仍可打开

#### Scenario: Delete another user's document
- **WHEN** 用户尝试删除他人文档或不存在的文档
- **THEN** 系统返回未找到，任何其他文档均不受影响

#### Scenario: Partial cleanup failure does not crash the request
- **WHEN** 删除中的某一步清理失败
- **THEN** 系统继续可独立完成的清理，文档显示 `delete_failed` 和重试入口，不把清理未完成描述成删除成功

#### Scenario: Delete a processing document
- **WHEN** 用户删除还在解析或向量化的文档
- **THEN** 系统将其置为 `deleting`，停止处理并清理；迟到的解析或写入结果不能让文档重新出现或变成 `ready`

## ADDED Requirements

### Requirement: Knowledge library is available on both supported clients
系统 SHALL 在微信小程序和 H5 的“我的”页面提供“我的知识库”入口。知识库 SHALL 提供文件选择、上传、处理状态、删除与就绪文档的开始闯关操作，并沿用当前界面风格和账号登录方式。

#### Scenario: Upload and start on either client
- **WHEN** 已登录用户在微信小程序或 H5 选择允许的文件并上传
- **THEN** 可以在同一知识库页面看到处理结果，文档就绪后开始闯关；用户取消文件选择时不创建记录也不显示上传失败

#### Scenario: Account changes while a request is pending
- **WHEN** 上传、状态查询或出题请求未结束时用户退出或切换账号
- **THEN** 页面清除上一账号的文档展示，停止其轮询并忽略迟到响应，不把旧账号的文档或题库加入新账号

### Requirement: Interrupted processing reaches a visible terminal state
系统 SHALL 在后端重启后恢复对未完成文档的管理，将中断的 `processing` 文档标为失败并清理剩余片段和文件，继续未完成的删除；不得让文档永久停在处理中，也不得自动重新消耗向量化额度。

#### Scenario: Service restarts during embedding
- **WHEN** 文档在向量化过程中因后端重启而中断
- **THEN** 服务恢复后用户看到失败提示并可删除重传，部分片段不可检索，已经就绪的其他文档保持可用

### Requirement: Original uploads are temporary
系统 SHALL 在文字解析结束后清理原文件，在处理失败、超时或删除时也清理剩余原文件和解析中间文件。系统 SHALL 仅长期保留文档记录、检索片段及已经生成的学习历史；原文件不作为下载或预览资源提供。

#### Scenario: Parsing finishes before embedding
- **WHEN** 已成功提取文字并进入向量化阶段
- **THEN** 原文件被删除，向量化使用临时解析结果；全部处理结束后解析中间文件也被清理
