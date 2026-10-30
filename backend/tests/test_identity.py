import time

import jwt
import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.core import identity


def test_identity_settings_are_optional_and_mask_secrets():
    configured = Settings(_env_file=None, jwt_secret="a-secret-value", mysql_password="db-secret-value", wechat_app_secret="wx-secret-value")
    assert "a-secret-value" not in repr(configured)
    assert "db-secret-value" not in repr(configured)
    assert "wx-secret-value" not in repr(configured)


def test_dev_login_cannot_be_enabled_in_production():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, app_env="production", dev_login_enabled=True)


def test_token_roundtrip_has_required_scoped_claims():
    config = Settings(_env_file=None, jwt_secret="x" * 64)
    token = identity.create_token(config, "42", is_test=False)
    assert identity.read_token(config, token) == identity.Identity("42", False)
    claims = jwt.decode(token, config.jwt_secret.get_secret_value(), algorithms=["HS256"], audience="ai-learn-client", issuer="ai-learn")
    assert set(("exp", "iat", "sub", "iss", "aud", "is_test")) <= claims.keys()


@pytest.mark.parametrize("change", [
    {"exp": 1}, {"iat": "1"}, {"sub": 1}, {"sub": "-1"}, {"sub": ""},
    {"exp": "9999999999"}, {"iss": "other"}, {"aud": "other"}, {"is_test": "false"},
])
def test_invalid_token_claims_are_anonymous(change):
    config = Settings(_env_file=None, jwt_secret="x" * 64)
    payload = {"sub": "42", "iat": int(time.time()), "exp": int(time.time()) + 60,
               "iss": "ai-learn", "aud": "ai-learn-client", "is_test": False, **change}
    token = jwt.encode(payload, "x" * 64, algorithm="HS256")
    assert identity.read_token(config, token) is None


def test_missing_wrong_algorithm_and_production_dev_tokens_are_rejected():
    config = Settings(_env_file=None, jwt_secret="x" * 64)
    assert identity.read_token(config, "invalid") is None
    assert identity.read_token(Settings(_env_file=None), "invalid") is None
    token = identity.create_token(config, "42", is_test=True)
    production = Settings(_env_file=None, jwt_secret="x" * 64, app_env="production")
    assert identity.read_token(production, token) is None
    claims = {"sub": "42", "iat": int(time.time()), "exp": int(time.time()) + 60,
              "iss": "ai-learn", "aud": "ai-learn-client", "is_test": False}
    assert identity.read_token(config, jwt.encode(claims, "x" * 64, algorithm="HS384")) is None
    claims.pop("iat")
    assert identity.read_token(config, jwt.encode(claims, "x" * 64, algorithm="HS256")) is None


def test_missing_jwt_secret_never_issues_a_token():
    from app.core.errors import AppError
    with pytest.raises(AppError) as exc:
        identity.create_token(Settings(_env_file=None), "1", is_test=False)
    assert exc.value.status_code == 503


def test_configuration_validation_does_not_echo_secret_inputs():
    with pytest.raises(ValidationError) as exc:
        Settings(_env_file=None, jwt_secret="private-validation-secret", app_env="production", dev_login_enabled=True)
    assert "private-validation-secret" not in str(exc.value)
