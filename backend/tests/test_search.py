import asyncio
import json

import pytest
from langchain_core.tools import StructuredTool

from app.core.config import Settings
from app.core.content import ContentGuard
from app.core.errors import AppError
from app.llm.generation import ReliableGenerator
from app.models.quiz import QuizRequest
from tests.test_generation import SequenceProvider
from unittest.mock import AsyncMock


async def public_dns(host):
    return ["93.184.216.34"]


def decision(status="ready", **changes):
    return {"status": status, "topic": "Confirmed topic", "source_ids": ["s1"], "options": [],
            "reviews": [{"source_id": "s1", "primary": True, "independent_origin": "original author"}],
            "freshness_supported": True, "conflict_free": True, **changes}


def service(*responses, **changes):
    from app.services.search import KnowledgeService
    settings = Settings(_env_file=None, **changes)
    guard = ContentGuard(settings.blocked_terms)
    generator = ReliableGenerator(SequenceProvider(*responses), settings, guard)
    return KnowledgeService(settings, generator, resolver=public_dns)


@pytest.mark.parametrize("url", ["http://localhost/a", "http://127.0.0.1", "http://[::1]/", "http://10.0.0.1", "file:///etc/passwd", "https://u:p@example.org", "http://metadata.google.internal/"])
async def test_private_or_unsupported_urls_never_reach_extraction(url):
    from app.services.search import validate_public_url
    with pytest.raises(AppError):
        await validate_public_url(url, public_dns)


async def test_private_dns_answer_is_rejected():
    from app.services.search import validate_public_url
    async def private_dns(host):
        return ["10.1.2.3"]
    with pytest.raises(AppError):
        await validate_public_url("https://public-looking.example.org/page", private_dns)


async def test_topic_without_search_does_not_use_model_only():
    search = service({"is_material": False, "needs_external_verification": True}, enable_web_search=False)
    with pytest.raises(AppError) as failure:
        await search.prepare(QuizRequest(user_input="Harness Engineering"))
    assert failure.value.code == 50304


async def test_full_text_can_supply_evidence_without_search():
    search = service({"is_material": True, "needs_external_verification": False}, decision(), enable_web_search=False)
    result = await search.prepare(QuizRequest(user_input="Water is a compound of hydrogen and oxygen. Ice is solid water."))
    assert result.status == "ready"
    assert result.sources[0].kind == "user_text"
    assert result.sources[0].url is None


@pytest.mark.parametrize("input_text", ["https://example.org/harness-engineering/", "Learn feedback loops from https://example.org/harness-engineering/"])
async def test_sufficient_requested_page_does_not_trigger_duplicate_acquisition(input_text):
    from app.services.search import KnowledgeService
    queries = []
    async def extract(urls: list[str], query: str | None = None):
        """Read relevant page passages."""
        queries.append(query)
        return {"results": [{"url": urls[0], "raw_content": "Documented learning material."}]}
    def unexpected_agent(**kwargs):
        raise AssertionError("Sufficient page must not be fetched again")
    search = service(decision(), tavily_api_key="test-only")
    search.model = object()
    search.tool_factory = lambda _: [StructuredTool.from_function(coroutine=extract, name="tavily_extract")]
    search.agent_factory = unexpected_agent
    resolved_hosts = []
    async def counted_dns(host):
        resolved_hosts.append(host)
        return await public_dns(host)
    search.resolver = counted_dns
    result = await search.prepare(QuizRequest(user_input=input_text))
    assert result.status == "ready"
    if input_text.startswith('https://'):
        assert queries[0] is None
    else:
        assert queries[0] and "https://" not in queries[0]
    assert resolved_hosts == ["example.org"]


async def test_text_does_not_claim_current_verification():
    search = service({"is_material": True, "needs_external_verification": True}, enable_web_search=False)
    with pytest.raises(AppError):
        await search.prepare(QuizRequest(user_input="请核实下面正文是否符合最新版本，然后出题。"))


async def test_source_collector_bounds_deduplicates_and_preserves_metadata():
    from app.services.search import SourceCollector
    collector = SourceCollector(12000, public_dns)
    await collector.collect({"results": [{"title": "Guide", "url": "https://example.org/guide", "raw_content": "A fact. " * 1000,
                                          "published_date": "2026-10-01"}]})
    await collector.collect({"results": [{"title": "Copy", "url": "https://example.org/guide#part", "content": "same"}]})
    assert len(collector.sources) == 1
    assert len(collector.sources[0].excerpt) <= 2000
    assert collector.sources[0].published_at == "2026-10-01"
    assert len(collector.context()) <= 12000


async def test_tool_error_is_sanitized_and_extraction_partial_failure_is_not_success():
    from app.services.search import SourceCollector, AcquisitionTools
    collector = SourceCollector(12000, public_dns)
    async def extract(urls: list[str]):
        """Read URLs."""
        return {"results": [{"url": urls[0], "raw_content": "Some material"}], "failed_results": [{"url": urls[1], "error": "private-key"}]}
    tools = AcquisitionTools([StructuredTool.from_function(coroutine=extract, name="tavily_extract")], collector, 4)
    with pytest.raises(AppError) as failure:
        await tools.tools[0].ainvoke({"urls": ["https://example.org/a", "https://example.org/b"]})
    assert failure.value.code == 42203
    assert "private-key" not in str(failure.value)


async def test_parallel_tools_are_hard_limited_and_timeout_cancels_work():
    from app.services.search import SourceCollector, AcquisitionTools
    calls = 0
    canceled = 0
    started = asyncio.Event()
    async def lookup(query: str):
        """Search."""
        nonlocal calls, canceled
        calls += 1
        if calls == 2:
            started.set()
        try:
            await asyncio.Future()
        except asyncio.CancelledError:
            canceled += 1
            raise
    wrapped = AcquisitionTools([StructuredTool.from_function(coroutine=lookup, name="search")], SourceCollector(12000, public_dns), 2)
    work = asyncio.gather(*(wrapped.tools[0].ainvoke({"query": "topic"}) for _ in range(4)), return_exceptions=True)
    try:
        await asyncio.wait_for(started.wait(), 2)
        with pytest.raises(TimeoutError):
            async with asyncio.timeout(0):
                await work
    finally:
        work.cancel()
        await asyncio.gather(work, return_exceptions=True)
    assert calls == canceled == 2


@pytest.mark.parametrize("update", [{"freshness_supported": False}, {"conflict_free": False}, {"source_ids": ["invented"]}])
async def test_unverified_or_conflicting_material_cannot_be_ready(update):
    search = service({"is_material": True, "needs_external_verification": False}, decision(**update), enable_web_search=False)
    with pytest.raises(AppError):
        await search.prepare(QuizRequest(user_input="Here is substantive learning material with several facts."))


async def test_agent_uses_installed_tools_and_collects_only_real_results():
    from app.services.search import KnowledgeService, build_tavily_tools
    settings = Settings(_env_file=None, tavily_api_key="test-only", deepseek_api_key="test-only")
    actual_tools = build_tavily_tools(settings)
    assert [tool.name for tool in actual_tools] == ["tavily_search_basic", "tavily_search_deep", "tavily_extract"]
    assert actual_tools[0].max_results == 3 and actual_tools[1].include_raw_content is True
    assert "query" in actual_tools[0].args_schema.model_fields
    # The integration converts SecretStr to its mask if it reaches env lookup.
    assert all(tool.api_wrapper.tavily_api_key.get_secret_value() == "test-only" for tool in actual_tools[:2])
    assert actual_tools[2].apiwrapper.tavily_api_key.get_secret_value() == "test-only"
    async def lookup(query: str):
        """Search topics."""
        return {"results": [{"url": "https://example.org/guide", "title": "Original", "content": "A documented fact."}]}
    raw_tool = StructuredTool.from_function(coroutine=lookup, name="tavily_search_basic")
    class Agent:
        def __init__(self, tools):
            self.tools = tools
        async def ainvoke(self, messages, config=None):
            await self.tools[0].ainvoke({"query": "topic"})
            return {"messages": []}
    def agent_factory(**kwargs):
        assert len(kwargs["middleware"]) == 3
        return Agent(kwargs["tools"])
    generator = ReliableGenerator(SequenceProvider({"is_material": False, "needs_external_verification": True}, decision()), settings, ContentGuard([]))
    search = KnowledgeService(settings, generator, model=object(), resolver=public_dns, tool_factory=lambda _: [raw_tool], agent_factory=agent_factory)
    prepared = await search.prepare(QuizRequest(user_input="Term", topic_context="Chosen domain"))
    assert prepared.status == "ready"
    assert prepared.sources[0].url == "https://example.org/guide"


async def test_relevant_passage_survives_long_page_navigation():
    from app.services.search import SourceCollector
    collector = SourceCollector(12000, public_dns, query="Harness Engineering")
    text = ("Unrelated navigation and links. " * 300) + "Harness Engineering is defined here in the actual relevant passage."
    await collector.collect({"results": [{"url": "https://example.org/article", "raw_content": text}]})
    assert "actual relevant passage" in collector.sources[0].excerpt
    assert len(collector.context()) <= 12000
    dense = SourceCollector(12000, public_dns, query="Harness Engineering")
    navigation = "Harness Engineering\nSkip to main content\n" * 100
    body = "\n".join(f"Harness Engineering practice {i}: " + (f"Documented fact {i} with its original explanation. " * 10) for i in range(4))
    await dense.collect({"results": [{"url": "https://example.org/article", "raw_content": navigation + body}]})
    assert "Skip to main content" not in dense.sources[0].excerpt
    assert sum(f"Documented fact {i}" in dense.sources[0].excerpt for i in range(4)) >= 3


async def test_installed_create_agent_runs_with_tool_calling_model_boundary():
    from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
    from langchain_core.messages import AIMessage
    from app.services.search import KnowledgeService
    class ToolModel(FakeMessagesListChatModel):
        def bind_tools(self, tools, **kwargs):
            return self
    model = ToolModel(responses=[AIMessage(content="", tool_calls=[{"name": "tavily_search_basic", "args": {"query": "Term"}, "id": "lookup-1"}])])
    async def lookup(query: str):
        """Retrieve sources."""
        return {"results": [{"url": f"https://example.org/guide-{i}", "content": f"The actual source definition {i}."} for i in range(5)]}
    tool = StructuredTool.from_function(coroutine=lookup, name="tavily_search_basic")
    config = Settings(_env_file=None, tavily_api_key="test-only")
    generator = ReliableGenerator(SequenceProvider({"is_material": False, "needs_external_verification": False}, decision()), config, ContentGuard([]))
    resolved_hosts = []
    async def counted_dns(host):
        resolved_hosts.append(host)
        await asyncio.sleep(0)
        return await public_dns(host)
    result = await KnowledgeService(config, generator, model=model, resolver=counted_dns, tool_factory=lambda _: [tool]).prepare(QuizRequest(user_input="Term"))
    assert result.status == "ready" and result.sources[0].excerpt == "The actual source definition 0."
    assert resolved_hosts == ["example.org"]


async def test_same_secondary_origin_cannot_count_as_independent_support():
    from app.services.search import SourceCollector
    collector = SourceCollector(12000, public_dns)
    await collector.collect({"results": [{"url": "https://one.example.org/a", "content": "The original article explains the term."},
                                          {"url": "https://two.example.org/b", "content": "A copy quoting the original article."}]})
    checks = [{"source_id": f"s{i}", "primary": False, "independent_origin": "same-original"} for i in (1, 2)]
    search = service(decision(source_ids=["s1", "s2"], reviews=checks))
    variables = {"user_input": "Term", "topic_context": "", "today": "2026-10-28", "question_count": 5}
    with pytest.raises(AppError):
        await search._assess(QuizRequest(user_input="Term"), collector, variables, True)


async def test_installed_search_can_broaden_after_empty_results(monkeypatch):
    from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
    from langchain_core.messages import AIMessage
    from langchain_tavily._utilities import TavilySearchAPIWrapper
    from app.services.search import KnowledgeService
    class ToolModel(FakeMessagesListChatModel):
        def bind_tools(self, tools, **kwargs):
            return self
    lookup = AsyncMock(side_effect=[{"results": []}, {"results": [{"url": "https://example.org/guide", "content": "The documented definition."}]}])
    monkeypatch.setattr(TavilySearchAPIWrapper, "raw_results_async", lookup)
    model = ToolModel(responses=[
        AIMessage(content="", tool_calls=[{"name": "tavily_search_basic", "args": {"query": "Term", "time_range": "week"}, "id": "narrow"}]),
        AIMessage(content="", tool_calls=[{"name": "tavily_search_basic", "args": {"query": "Term"}, "id": "broad"}]),
        AIMessage(content="Done"),
    ])
    config = Settings(_env_file=None, tavily_api_key="test-only")
    generator = ReliableGenerator(SequenceProvider({"is_material": False, "needs_external_verification": True}, decision()), config, ContentGuard([]))
    result = await KnowledgeService(config, generator, model=model, resolver=public_dns).prepare(QuizRequest(user_input="Term"))
    assert result.status == "ready"
    assert [call.kwargs["time_range"] for call in lookup.await_args_list] == ["week", None]
    lookup.side_effect = ConnectionError("private-upstream-error")
    generator = ReliableGenerator(SequenceProvider({"is_material": False, "needs_external_verification": True}), config, ContentGuard([]))
    with pytest.raises(AppError) as failure:
        await KnowledgeService(config, generator, model=model, resolver=public_dns).prepare(QuizRequest(user_input="Term"))
    assert failure.value.code == 50304
    assert "private-upstream-error" not in str(failure.value)


async def test_full_text_updates_same_source_id_and_keeps_context_bounded():
    from app.services.search import SourceCollector
    collector = SourceCollector(12000, public_dns)
    await collector.collect({"results": [{"url": "https://example.org/guide", "title": "Guide", "content": "Short summary.", "published_date": "2026-10-01"}]})
    for i in range(4):
        collector.add(kind="web", title=f"Other {i}", url=f"https://example.org/other-{i}", excerpt=f"Other fact {i}.")
    await collector.collect({"results": [{"url": "https://example.org/guide", "raw_content": "A complete documented explanation that can support all requested questions."}]})
    assert len(collector.sources) == 5
    updated = collector.sources[0]
    assert updated.id == "s1" and "complete documented explanation" in updated.excerpt
    assert updated.title == "Guide" and updated.published_at == "2026-10-01"
    assert len(collector.context()) <= 12000
    # A later short search snippet must not replace acquired full text.
    await collector.collect({"results": [{"url": updated.url, "content": "Short summary."}]})
    assert collector.sources[0] == updated
    identical = SourceCollector(12000, public_dns)
    await identical.collect({"results": [{"url": updated.url, "content": "Verified fact."}]})
    await identical.collect({"results": [{"url": updated.url, "raw_content": "Verified fact.", "published_date": "2026-10-01"}]})
    await identical.collect({"results": [{"url": updated.url, "content": "A longer but less useful search summary."}]})
    assert identical.sources[0].excerpt == "Verified fact."
    assert identical.sources[0].published_at == "2026-10-01"


async def test_full_collector_can_still_acquire_missing_full_text(monkeypatch):
    from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
    from langchain_core.messages import AIMessage
    from langchain_tavily._utilities import TavilySearchAPIWrapper
    from app.services.search import KnowledgeService
    class ToolModel(FakeMessagesListChatModel):
        def bind_tools(self, tools, **kwargs):
            return self
    summaries = [{"url": f"https://example.org/guide-{i}", "content": f"Short summary {i}."} for i in range(5)]
    lookup = AsyncMock(side_effect=[{"results": summaries[:3]}, {"results": summaries[3:]},
                                   {"results": [{"url": summaries[0]["url"], "raw_content": "Complete evidence needed for all five questions."}]}])
    monkeypatch.setattr(TavilySearchAPIWrapper, "raw_results_async", lookup)
    model = ToolModel(responses=[
        AIMessage(content="", tool_calls=[{"name": name, "args": {"query": "Term"}, "id": str(i)}])
        for i, name in enumerate(["tavily_search_basic", "tavily_search_basic", "tavily_search_deep"])
    ] + [AIMessage(content="Done")])
    config = Settings(_env_file=None, tavily_api_key="test-only")
    generator = ReliableGenerator(SequenceProvider({"is_material": False, "needs_external_verification": True},
        decision("insufficient"), decision()), config, ContentGuard([]))
    result = await KnowledgeService(config, generator, model=model, resolver=public_dns).prepare(QuizRequest(user_input="Term"))
    assert result.status == "ready" and "Complete evidence" in result.sources[0].excerpt
    assert lookup.await_count == 3
