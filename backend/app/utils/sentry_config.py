"""Destino de monitoramento: DSN vazio explícito desativa o envio no ensaio."""
import os

FALLBACK_SENTRY_DSN = (
    "https://322d96621010f0403946446be4460662"
    "@o4511655329923072.ingest.us.sentry.io/4511655345192960"
)


def resolve_sentry_dsn(config_name):
    if "SENTRY_DSN" in os.environ:
        return os.environ["SENTRY_DSN"].strip() or None
    if config_name == "production" or os.getenv("RENDER"):
        return FALLBACK_SENTRY_DSN
    return None
