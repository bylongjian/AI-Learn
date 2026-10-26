import pytest
from pydantic import ValidationError


def test_settings_safe_defaults_and_secret_masking(monkeypatch):
    from app.core.config import Settings
    monkeypatch.setenv("DEEPSEEK_API_KEY", "dummy-test-key")
    value = Settings(_env_file=None)
    assert value.deepseek_model == "deepseek-flash"
    assert value.deepseek_base_url == "https://api.deepseek.com"
    assert value.generation_timeout_seconds <= 50
    assert value.deepseek_api_key.get_secret_value() == "dummy-test-key"
    assert "dummy-test-key" not in repr(value)


@pytest.mark.parametrize("changes", [
    {"generation_timeout_seconds": 60}, {"generation_timeout_seconds": 45.1}, {"generation_timeout_seconds": 0},
    {"generation_retries": 3}, {"rate_limit_requests": 0}, {"rate_limit_max_clients": 0},
    {"max_body_bytes": 0}, {"deepseek_base_url": "file:///tmp"},
])
def test_invalid_config_rejected(changes):
    from app.core.config import Settings
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **changes)


def test_content_guard_checks_configured_terms_case_insensitively():
    from app.core.content import ContentGuard
    from app.core.errors import AppError
    guard = ContentGuard(["BLOCKED"])
    guard.check("learning Python")
    with pytest.raises(AppError) as exc:
        guard.check({"nested": ["a blocked phrase"]})
    assert exc.value.status_code == 422


def test_rate_limiter_limits_and_expires_without_unbounded_memory():
    from app.core.limiter import RateLimiter
    limiter = RateLimiter(limit=2, window_seconds=10, max_clients=2)
    assert limiter.allow("a", now=0)
    assert limiter.allow("a", now=1)
    assert not limiter.allow("a", now=2)
    assert limiter.allow("a", now=10)
    assert limiter.allow("b", now=10)
    assert not limiter.allow("c", now=10)
    assert limiter.allow("c", now=21)
