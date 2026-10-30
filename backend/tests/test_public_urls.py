import asyncio
import socket

import httpx
import pytest

from app.core.errors import AppError
from app.services.search import validate_public_url


def fake_proxy_dns(monkeypatch, handler):
    async def lookup(host, port, **kwargs):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('198.18.0.116', 0))]

    monkeypatch.setattr(asyncio.get_running_loop(), 'getaddrinfo', lookup)
    original = httpx.AsyncClient
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kwargs: original(
        **kwargs, transport=httpx.MockTransport(handler)))


async def test_public_page_works_with_fake_ip_without_changing_system_dns(monkeypatch):
    queries = []

    def respond(request):
        assert request.url.host == 'doh.pub'
        assert request.url.params['name'] == 'openai.com'
        kind = request.url.params['type']
        queries.append(kind)
        return httpx.Response(200, json={'Status': 0, 'Answer': [
            {'type': 1 if kind == 'A' else 28,
             'data': '104.18.33.45' if kind == 'A' else '2606:4700::6812:212d'}]})

    fake_proxy_dns(monkeypatch, respond)
    assert await validate_public_url('https://openai.com/index/harness-engineering/') == 'https://openai.com/index/harness-engineering/'
    assert sorted(queries) == ['A', 'AAAA']


async def test_fake_ip_fallback_still_rejects_private_dns_answers(monkeypatch):
    def respond(request):
        return httpx.Response(200, json={'Status': 0, 'Answer': [
            {'type': 1, 'data': '104.18.33.45'}, {'type': 28, 'data': '::1'}]})

    fake_proxy_dns(monkeypatch, respond)
    with pytest.raises(AppError):
        await validate_public_url('https://openai.com/page')


async def test_dns_fallback_failure_never_allows_extraction_or_literal_fake_ip(monkeypatch):
    calls = []
    started = asyncio.Event()
    cancelled = asyncio.Event()

    async def unavailable(request):
        calls.append(request)
        if request.url.params['type'] == 'A':
            await started.wait()
            raise httpx.ConnectError('offline')
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    fake_proxy_dns(monkeypatch, unavailable)
    with pytest.raises(AppError):
        await validate_public_url('https://198.18.0.116/page')
    assert not calls
    with pytest.raises(AppError):
        await validate_public_url('https://openai.com/page')
    assert calls
    assert cancelled.is_set()
