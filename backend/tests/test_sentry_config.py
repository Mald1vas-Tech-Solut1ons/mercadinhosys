import pytest

from app.utils.sentry_config import FALLBACK_SENTRY_DSN, resolve_sentry_dsn


@pytest.mark.parametrize("dsn", ["", "   "])
def test_explicit_empty_dsn_disables_production_fallback(monkeypatch, dsn):
    monkeypatch.setenv("SENTRY_DSN", dsn)
    monkeypatch.setenv("RENDER", "true")
    assert resolve_sentry_dsn("production") is None


def test_missing_dsn_preserves_production_monitoring(monkeypatch):
    monkeypatch.delenv("SENTRY_DSN", raising=False)
    monkeypatch.delenv("RENDER", raising=False)
    assert resolve_sentry_dsn("production") == FALLBACK_SENTRY_DSN
    assert resolve_sentry_dsn("testing") is None


def test_explicit_monitoring_destination_takes_precedence(monkeypatch):
    monkeypatch.setenv("SENTRY_DSN", "https://public@example.test/1")
    assert resolve_sentry_dsn("production") == "https://public@example.test/1"
