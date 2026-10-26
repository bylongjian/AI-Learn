import httpx
import pytest

from app.core.config import Settings
from app.llm.provider import DeepSeekProvider
from app.main import create_app
from tests.factories import quiz_content
from tests.test_generation import SequenceProvider


@pytest.mark.parametrize("fail_inside", [False, True])
async def test_lifespan_closes_only_app_owned_sdk_clients_even_on_failure(fail_inside):
    app = create_app(Settings(_env_file=None, deepseek_api_key="dummy-test-key"))
    llm = app.state.quiz_service.generator.provider.llm
    try:
        try:
            async with app.router.lifespan_context(app):
                assert not llm.root_client.is_closed()
                assert not llm.root_async_client.is_closed()
                if fail_inside:
                    raise RuntimeError("application stopped unexpectedly")
        except RuntimeError:
            if not fail_inside:
                raise
        assert llm.root_client.is_closed()
        assert llm.root_async_client.is_closed()
    finally:
        llm.root_client.close()
        await llm.root_async_client.close()


async def test_lifespan_leaves_injected_provider_owned_by_caller():
    settings = Settings(_env_file=None, deepseek_api_key="dummy-test-key")
    provider = DeepSeekProvider(settings)
    app = create_app(settings, provider)
    try:
        async with app.router.lifespan_context(app):
            pass
        assert not provider.llm.root_client.is_closed()
        assert not provider.llm.root_async_client.is_closed()
    finally:
        provider.llm.root_client.close()
        await provider.llm.root_async_client.close()


async def test_lifespan_accepts_external_provider_without_close_contract():
    app = create_app(Settings(_env_file=None), SequenceProvider(quiz_content()))
    async with app.router.lifespan_context(app):
        pass


async def test_provider_close_preserves_borrowed_http_client():
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200))) as borrowed:
        provider = DeepSeekProvider(Settings(_env_file=None, deepseek_api_key="dummy-test-key"), http_client=borrowed)
        try:
            await provider.aclose()
            assert provider.llm.root_client.is_closed()
            assert not borrowed.is_closed
        finally:
            provider.llm.root_client.close()


async def test_missing_key_provider_has_no_resources_to_close():
    provider = DeepSeekProvider(Settings(_env_file=None, deepseek_api_key=None))
    await provider.aclose()
