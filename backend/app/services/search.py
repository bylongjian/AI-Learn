"""Bounded acquisition. Only collected tool results can become evidence."""
import asyncio
from datetime import date, datetime, timezone
from hashlib import sha256
import ipaddress
import json
import logging
import re
import socket
import ssl
from urllib.parse import urlsplit, urlunsplit

import certifi
import httpx
from langchain.agents import create_agent
from langchain.agents.middleware import ModelCallLimitMiddleware, ToolCallLimitMiddleware, before_model
from langchain_core.tools import StructuredTool, ToolException
from langchain_tavily import TavilyExtract, TavilySearch
from pydantic import ValidationError

from app.core.errors import AppError
from app.models.knowledge import InputAssessment, KnowledgeDecision, KnowledgeSource, PreparedKnowledge
from app.prompts.search import ACQUISITION_PROMPT, ASSESSMENT_PROMPT, INPUT_PROMPT

logger = logging.getLogger(__name__)
URL_PATTERN = re.compile(r"\b[a-zA-Z][a-zA-Z0-9+.-]*://[^\s<>\"']+")
FAKE_IP_NETWORK = ipaddress.ip_network("198.18.0.0/15")
# 启动时加载证书，避免每次校验来源都重复加载证书文件。
DNS_TLS_CONTEXT = ssl.create_default_context(cafile=certifi.where())


def insufficient():
    return AppError(42203, "资料还不足以可靠出题，请补充学习正文、具体领域或公开参考链接", 422)


async def resolve_addresses(host):
    answers = await asyncio.get_running_loop().getaddrinfo(host, None, type=socket.SOCK_STREAM)
    addresses = list({answer[4][0] for answer in answers})
    if not any(ipaddress.ip_address(address) in FAKE_IP_NETWORK for address in addresses):
        return addresses
    # 只兼容代理合成地址；真实私网答案仍交给公开地址校验拒绝。
    if any(not ipaddress.ip_address(address).is_global
           and ipaddress.ip_address(address) not in FAKE_IP_NETWORK for address in addresses):
        return addresses
    try:
        async with asyncio.timeout(3):
            async with httpx.AsyncClient(verify=DNS_TLS_CONTEXT, timeout=3, follow_redirects=False) as client:
                async def lookup(kind):
                    response = await client.get("https://doh.pub/dns-query", params={
                        "name": host.encode("idna").decode("ascii"), "type": kind},
                        headers={"accept": "application/dns-json"})
                    response.raise_for_status()
                    payload = response.json()
                    if not isinstance(payload, dict) or payload.get("Status") != 0 or payload.get("TC"):
                        raise ValueError("DNS lookup failed")
                    return [str(ipaddress.ip_address(answer["data"]))
                            for answer in payload.get("Answer", []) if answer["type"] in (1, 28)]
                queries = [asyncio.create_task(lookup(kind)) for kind in ("A", "AAAA")]
                try:
                    records = await asyncio.gather(*queries)
                finally:
                    for task in queries:
                        task.cancel()
                    await asyncio.gather(*queries, return_exceptions=True)
                return list({address for record in records for address in record})
    except (httpx.HTTPError, TimeoutError, ValueError, TypeError, KeyError):
        raise AppError(50304, "暂时无法确认参考网页的公开地址，请重试或粘贴学习正文", 503) from None


async def validate_public_url(url, resolver=resolve_addresses):
    try:
        parts = urlsplit(url)
        host = (parts.hostname or "").rstrip(".").lower()
        if (parts.scheme not in {"https", "http"} or not host or parts.username is not None
                or parts.password is not None or any(c.isspace() for c in url) or "\\" in url
                or host == "localhost" or host.endswith((".localhost", ".local", ".internal"))):
            raise ValueError("Non-public URL")
        _ = parts.port
        try:
            addresses = [str(ipaddress.ip_address(host))]
        except ValueError:
            if "." not in host:
                raise ValueError("Local hostname")
            addresses = await resolver(host)
        if not addresses or any(not ipaddress.ip_address(address).is_global for address in addresses):
            raise ValueError("Non-public address")
        return urlunsplit((parts.scheme, parts.netloc.lower(), parts.path, parts.query, ""))
    except (ValueError, OSError):
        raise AppError(42203, "请提供不含账号密码的公开 HTTP(S) 网页链接，或粘贴学习正文", 422) from None


def build_tavily_tools(settings):
    # Tavily's env lookup stringifies SecretStr into its mask; unwrap only here.
    api_key = settings.tavily_api_key.get_secret_value()
    return [
        TavilySearch(name="tavily_search_basic", description="轻量搜索：确认主题含义、定位直接来源。",
                     tavily_api_key=api_key, search_depth="basic", max_results=3, include_raw_content=False,
                     include_answer=False, auto_parameters=False, handle_tool_error=False),
        TavilySearch(name="tavily_search_deep", description="深度搜索：复杂、新兴主题及充分的出题原文资料。",
                     tavily_api_key=api_key, search_depth="advanced", max_results=5, include_raw_content=True,
                     include_answer=False, auto_parameters=False, handle_tool_error=False),
        TavilyExtract(name="tavily_extract", tavily_api_key=api_key, extract_depth="basic",
                      include_images=False, format="text", chunks_per_source=5, handle_tool_error=False),
    ]


class SourceCollector:
    def __init__(self, max_chars, resolver=resolve_addresses, *, query=""):
        self.max_chars, self.resolver = max_chars, resolver
        self.query = query
        self.sources = []
        self._fingerprints = set()
        self._full_text_urls = set()

    def context(self):
        return json.dumps([source.model_dump() for source in self.sources], ensure_ascii=False, separators=(",", ":"))

    def add(self, *, kind, title, excerpt, url=None, published_at=None, full_text=False):
        if not isinstance(excerpt, str) or not excerpt.strip():
            return
        previous = next((source for source in self.sources if url and source.url == url), None)
        if previous is None and len(self.sources) >= 5:
            return
        excerpt = excerpt.strip()
        if len(excerpt) > 2000:
            terms = set(re.findall(r"[a-z0-9_]{2,}", self.query.casefold())) - {"https", "http", "www", "com", "index"}
            chinese = re.findall(r"[\u4e00-\u9fff]+", self.query)
            terms.update(word[i:i+2] for word in chinese for i in range(len(word)-1))
            passages = [line[i:i+450] for line in excerpt.splitlines() for i in range(0, len(line), 450)]
            def score(passage):
                # Navigation repeats topic words; favor relevant prose over menus.
                prose = sum(len(line) for line in passage.splitlines() if len(line) >= 100)
                relevance = sum(term in passage.casefold() for term in terms)
                return (relevance + 0.01) * (prose / len(passage) if prose else 0.05)
            ranked = sorted(range(len(passages)), key=lambda i: (-score(passages[i]), i))
            excerpt = "\n…\n".join(passages[i] for i in sorted(ranked[:4]))
        fingerprint = sha256(re.sub(r"\s+", "", excerpt).casefold().encode()).hexdigest()
        previous_fingerprint = sha256(re.sub(r"\s+", "", previous.excerpt).casefold().encode()).hexdigest() if previous else None
        if fingerprint in self._fingerprints and fingerprint != previous_fingerprint:
            return
        if previous:
            if (url in self._full_text_urls and not full_text) or (not full_text and len(excerpt) <= len(previous.excerpt)):
                return
            title = title or previous.title
            published_at = published_at or previous.published_at
        identifier = previous.id if previous else f"s{len(self.sources)+1}"
        try:
            source = KnowledgeSource(id=identifier, kind=kind, title=str(title or url or "用户提供的资料")[:300],
                                     url=url, published_at=published_at, excerpt=excerpt)
        except ValidationError:
            # Unknown or malformed publication time remains unknown, never invented.
            source = KnowledgeSource(id=identifier, kind=kind, title=str(title or url or "用户提供的资料")[:300],
                                     url=url, published_at=previous.published_at if previous else None, excerpt=excerpt)
        index = self.sources.index(previous) if previous else len(self.sources)
        if previous:
            self.sources[index] = source
        else:
            self.sources.append(source)
        if len(self.context()) > self.max_chars:
            if previous:
                self.sources[index] = previous
            else:
                self.sources.pop()
            return
        if previous:
            self._fingerprints.discard(previous_fingerprint)
        self._fingerprints.add(fingerprint)
        if full_text:
            self._full_text_urls.add(url)

    async def collect(self, result):
        if not isinstance(result, dict) or result.get("error"):
            raise AppError(50304, "暂时无法获取学习资料，请重试或补充学习正文", 503)
        items = [item for item in result.get("results", [])[:5] if isinstance(item, dict)]
        async def checked_url(item):
            try:
                return await validate_public_url(item.get("url", ""), self.resolver)
            except AppError:
                return None
        urls = await asyncio.gather(*(checked_url(item) for item in items))
        for item, url in zip(items, urls):
            if url is None:
                continue
            self.add(kind="web", title=item.get("title"), url=url,
                     excerpt=item.get("raw_content") or item.get("content"), published_at=item.get("published_date"),
                     full_text=bool(item.get("raw_content")))


class AcquisitionTools:
    def __init__(self, raw_tools, collector, limit):
        self.collector, self.limit, self.calls = collector, limit, 0
        self.tools = [self._wrap(tool) for tool in raw_tools]

    def _wrap(self, original):
        async def invoke(**arguments):
            # No await between reservation and increment: parallel tasks share this budget.
            if self.calls >= self.limit:
                raise AppError(50304, "资料检索达到本次上限，请补充更具体的领域或参考正文", 503)
            self.calls += 1
            if original.name == "tavily_extract":
                urls = arguments.get("urls", [])
                if not 1 <= len(urls) <= 3:
                    raise insufficient()
                arguments["urls"] = [await validate_public_url(url, self.collector.resolver) for url in urls]
            try:
                result = await original.ainvoke(arguments)
            except AppError:
                raise
            except ToolException as exc:
                if original.name in {"tavily_search_basic", "tavily_search_deep"} and str(exc).startswith("No search results found for "):
                    return json.dumps({"status": "no_results", "material": self.collector.context(),
                                       "message": "本次搜索无结果。可在剩余预算内调整关键词或非用户指定的过滤条件；不要放宽用户明确要求的日期或领域。"}, ensure_ascii=False)
                raise AppError(50304, "暂时无法获取学习资料，请重试或补充学习正文", 503) from None
            except Exception as exc:
                logger.warning("retrieval tool failed; category=%s", type(exc).__name__)
                raise AppError(50304, "暂时无法获取学习资料，请重试或补充学习正文", 503) from None
            if original.name == "tavily_extract" and isinstance(result, dict) and result.get("failed_results"):
                raise AppError(42203, "有参考网页无法读取，请重试或粘贴该网页正文", 422)
            await self.collector.collect(result)
            return self.collector.context()
        return StructuredTool.from_function(coroutine=invoke, name=original.name, description=original.description,
                                            args_schema=original.args_schema)


class KnowledgeService:
    def __init__(self, settings, generator, *, model=None, resolver=resolve_addresses,
                 tool_factory=build_tavily_tools, agent_factory=create_agent):
        self.settings, self.generator, self.model = settings, generator, model
        self.resolver, self.tool_factory, self.agent_factory = resolver, tool_factory, agent_factory

    async def prepare(self, request):
        started = asyncio.get_running_loop().time()
        try:
            async with asyncio.timeout(self.settings.knowledge_timeout_seconds):
                return await self._prepare(request)
        except TimeoutError:
            raise AppError(50401, "学习资料获取超时，请重试或补充学习正文", 504) from None
        except AppError:
            raise
        except Exception as exc:
            logger.warning("knowledge acquisition failed; category=%s", type(exc).__name__)
            raise AppError(50304, "暂时无法获取学习资料，请重试或补充学习正文", 503) from None
        finally:
            logger.info("knowledge acquisition finished; elapsed_seconds=%.3f", asyncio.get_running_loop().time() - started)

    async def _prepare(self, request):
        addresses_by_host = {}
        host_locks = {}
        async def resolve_once(host):
            async with host_locks.setdefault(host, asyncio.Lock()):
                if host not in addresses_by_host:
                    addresses_by_host[host] = await self.resolver(host)
                return addresses_by_host[host]
        collector = SourceCollector(self.settings.knowledge_max_context_chars, resolve_once,
                                    query=f"{request.user_input} {request.topic_context or ''}")
        variables = {**request.model_dump(), "topic_context": request.topic_context or "", "today": date.today().isoformat()}
        urls = [match.group().rstrip(".,;!?，。；！）)") for match in URL_PATTERN.finditer(request.user_input)]
        needs_external = bool(urls)
        if urls:
            if len(urls) > 3:
                raise AppError(42203, "一次最多提供三个参考网页，也可以粘贴整理后的正文", 422)
            urls = [await validate_public_url(url, resolve_once) for url in urls]
        else:
            input_kind = await self.generator.generate(InputAssessment, INPUT_PROMPT, variables)
            needs_external = input_kind.needs_external_verification or not input_kind.is_material
            if input_kind.is_material:
                collector.add(kind="user_text", title="用户提供的资料", excerpt=request.user_input)
                if not needs_external:
                    prepared = await self._assess(request, collector, variables, False)
                    if prepared.status != "insufficient":
                        return prepared
        if not self.settings.enable_web_search or not self.settings.tavily_api_key or not self.settings.tavily_api_key.get_secret_value().strip():
            if collector.sources and not needs_external:
                raise insufficient()
            raise AppError(50304, "联网资料获取暂不可用，请稍后重试，或粘贴完整学习正文", 503)
        if self.model is None:
            raise AppError(50301, "AI 服务配置暂不可用，请联系服务维护者", 503)
        wrapped = AcquisitionTools(self.tool_factory(self.settings), collector, self.settings.knowledge_max_tool_calls)
        if urls:
            extract = next(tool for tool in wrapped.tools if tool.name == "tavily_extract")
            query = f"{URL_PATTERN.sub('', request.user_input).strip()} {request.topic_context or ''}".strip()
            arguments = {"urls": urls}
            if query:
                arguments["query"] = query
            await extract.ainvoke(arguments)
            prepared = await self._assess(request, collector, variables, True)
            if prepared.status != "insufficient":
                return prepared
        prepared_from_full = None

        @before_model(can_jump_to=["end"])
        async def stop_when_material_ready(state, runtime):
            nonlocal prepared_from_full
            if len(collector.sources) == 5:
                # A full list may still contain only summaries. Allow remaining
                # calls to improve existing sources until the material is usable.
                prepared_from_full = await self._assess(request, collector, variables, needs_external)
                if prepared_from_full.status != "insufficient":
                    return {"jump_to": "end"}

        agent = self.agent_factory(model=self.model, tools=wrapped.tools, system_prompt=ACQUISITION_PROMPT,
                                   middleware=[stop_when_material_ready,
                                               ToolCallLimitMiddleware(run_limit=self.settings.knowledge_max_tool_calls, exit_behavior="error"),
                                               ModelCallLimitMiddleware(run_limit=5, exit_behavior="error")])
        await agent.ainvoke({"messages": [{"role": "user", "content": json.dumps({"input": request.user_input,
                             "topic_context": request.topic_context, "today": variables["today"],
                             "already_obtained_material": collector.context()}, ensure_ascii=False)}]}, config={"recursion_limit": 20})
        logger.info("knowledge tools finished; calls=%d sources=%d", wrapped.calls, len(collector.sources))
        prepared = prepared_from_full or await self._assess(request, collector, variables, needs_external)
        if prepared.status == "insufficient":
            raise insufficient()
        return prepared

    async def _assess(self, request, collector, variables, needs_external):
        if not collector.sources:
            return PreparedKnowledge(status="insufficient", topic=request.topic_context or request.user_input)
        decision = await self.generator.generate(KnowledgeDecision, ASSESSMENT_PROMPT,
                                                 {**variables, "context": collector.context()})
        if decision.status == "insufficient":
            return PreparedKnowledge(status="insufficient", topic=decision.topic)
        by_id = {source.id: source for source in collector.sources}
        if not decision.source_ids or len(set(decision.source_ids)) != len(decision.source_ids) or not set(decision.source_ids) <= by_id.keys():
            raise insufficient()
        sources = [by_id[identifier] for identifier in decision.source_ids]
        if decision.status == "clarification":
            return PreparedKnowledge(status="clarification", topic=decision.topic, sources=sources, options=decision.options)
        if decision.status != "ready" or not decision.conflict_free or not decision.freshness_supported:
            return PreparedKnowledge(status="insufficient", topic=decision.topic)
        if needs_external and not any(source.kind == "web" for source in sources):
            raise insufficient()
        reviews = {review.source_id: review for review in decision.reviews}
        if set(reviews) != {source.id for source in sources} or len(reviews) != len(decision.reviews):
            raise insufficient()
        text_only = all(source.kind == "user_text" for source in sources)
        origins = {reviews[source.id].independent_origin.strip().casefold() for source in sources if source.kind == "web"}
        domains = {urlsplit(source.url).hostname for source in sources if source.kind == "web"}
        if not text_only and not any(reviews[source.id].primary for source in sources if source.kind == "web") and (len(origins) < 2 or len(domains) < 2):
            raise insufficient()
        return PreparedKnowledge(status="ready", topic=decision.topic, sources=sources)
