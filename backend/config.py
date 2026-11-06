import os
import logging
from pathlib import Path
from urllib.parse import urlparse
from dotenv import load_dotenv

# config é importado antes da app factory: garante handler para os logs de import.
# basicConfig é no-op se o root logger já estiver configurado.
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

basedir = Path(__file__).parent.absolute()

# Carrega .env cedo para que todas as variáveis estejam disponíveis
# antes da avaliação das classes de configuração.
load_dotenv(dotenv_path=basedir / ".env", override=False)


# ==================== BANCO DE DADOS ====================
# Uma fonte só: DATABASE_URL. Produção (Oracle) = PostgreSQL na rede interna do Docker.
# Sem DATABASE_URL: desenvolvimento usa SQLite local; produção NÃO sobe (cair calado num banco
# vazio esconderia o erro e o lojista veria a loja "zerada").
_database_url = (os.environ.get("DATABASE_URL") or "").strip()
_local_sqlite_uri = f"sqlite:///{os.path.join(basedir, 'instance', 'mercadinho_local.db')}"

if _database_url:
    if _database_url.startswith("postgres://"):
        _database_url = _database_url.replace("postgres://", "postgresql://", 1)
    _host_local = any(h in _database_url for h in ("@localhost", "@127.0.0.1"))
    if _database_url.startswith("postgresql") and _host_local and "?" not in _database_url:
        _database_url += "?sslmode=disable"
    _sqlalchemy_database_uri = _database_url
elif os.environ.get("FLASK_ENV") == "production":
    raise RuntimeError("CRITICAL: DATABASE_URL não configurada no ambiente de produção!")
else:
    _sqlalchemy_database_uri = _local_sqlite_uri
    logger.info("[DB] DATABASE_URL vazia: usando SQLite local (%s)", _local_sqlite_uri)

_using_postgres = _sqlalchemy_database_uri.startswith("postgresql")

class Config:
    _secret_key = os.environ.get("SECRET_KEY")
    _jwt_secret = os.environ.get("JWT_SECRET_KEY")
    
    if os.environ.get("FLASK_ENV") == "production":
        if not _secret_key:
            raise ValueError("CRITICAL: SECRET_KEY não configurada no ambiente de produção!")
        if not _jwt_secret:
            raise ValueError("CRITICAL: JWT_SECRET_KEY não configurada no ambiente de produção!")

    SECRET_KEY = _secret_key
    JWT_SECRET_KEY = _jwt_secret

    SQLALCHEMY_DATABASE_URI = _sqlalchemy_database_uri
    USING_POSTGRES = _using_postgres

    SQLALCHEMY_TRACK_MODIFICATIONS = False
    # Opções do pool do PostgreSQL: definidas em app/__init__.py (create_app), num lugar só.
    SQLALCHEMY_ENGINE_OPTIONS = {}

    # ==================== CORS ====================
    cors_origins_str = os.environ.get("CORS_ORIGINS", "")
    CORS_ORIGINS = (
        [origin.strip() for origin in cors_origins_str.split(",")]
        if cors_origins_str
        else []
    )

    # ==================== EMAIL ====================
    # Zoho (suporte@maldivastech.dev): SSL direto na 465, sem STARTTLS.
    MAIL_SERVER = os.environ.get("MAIL_SERVER", "smtp.zoho.com")
    MAIL_PORT = int(os.environ.get("MAIL_PORT", 465))
    MAIL_USE_TLS = os.environ.get("MAIL_USE_TLS", "false").lower() == "true"
    MAIL_USE_SSL = os.environ.get("MAIL_USE_SSL", "true").lower() == "true"
    MAIL_USERNAME = os.environ.get("MAIL_USERNAME")
    MAIL_PASSWORD = os.environ.get("MAIL_PASSWORD") or os.environ.get("EMAIL_APP_PASSWORD")
    MAIL_DEFAULT_SENDER = os.environ.get("MAIL_DEFAULT_SENDER", os.environ.get("MAIL_USERNAME"))
    MAIL_REPLY_TO = os.environ.get("MAIL_REPLY_TO")

    # ==================== UPLOADS ====================
    UPLOAD_FOLDER = os.path.join(basedir, "uploads")
    MAX_CONTENT_LENGTH = 5 * 1024 * 1024  # 5MB max

    # ==================== JWT ====================
    # JWT_SECRET_KEY: manter estável entre restarts; se mudar, tokens em uso passam a retornar 401.
    JWT_ACCESS_TOKEN_EXPIRES = 3600
    # ==================== CACHE ====================
    CACHE_TYPE = os.environ.get("CACHE_TYPE", "SimpleCache")
    CACHE_DEFAULT_TIMEOUT = 300


class DevelopmentConfig(Config):
    DEBUG = True
    
    # Log warning when using fallback keys in development
    if not Config._secret_key:
        logger.warning(
            "SECURITY WARNING: Using fallback SECRET_KEY in development. "
            "Set SECRET_KEY environment variable for better security."
        )
    if not Config._jwt_secret:
        logger.warning(
            "SECURITY WARNING: Using fallback JWT_SECRET_KEY in development. "
            "Set JWT_SECRET_KEY environment variable for better security."
        )
    
    SECRET_KEY = Config._secret_key or "dev-fallback-secret-key-12345"
    JWT_SECRET_KEY = Config._jwt_secret or "dev-fallback-jwt-key-67890"
    if not Config.CORS_ORIGINS:
        Config.CORS_ORIGINS = ["http://localhost:3000", "http://localhost:5173"]


class ProductionConfig(Config):
    DEBUG = False
    # Forçar HTTPS em produção
    PREFERRED_URL_SCHEME = 'https'


class TestingConfig(Config):
    TESTING = True
    # Fixed test keys for reproducibility (Requirement 7.4)
    # No logging needed as these are intentionally fixed for testing
    SECRET_KEY = "test-fixed-secret-key-for-reproducibility"
    JWT_SECRET_KEY = "test-fixed-jwt-key-for-reproducibility"
    SQLALCHEMY_DATABASE_URI = os.environ.get('AUDIT_DATABASE_URL', 'sqlite:///:memory:')
    WTF_CSRF_ENABLED = False
    DEBUG = True

config = {
    "development": DevelopmentConfig,
    "production": ProductionConfig,
    "default": DevelopmentConfig,
    "testing": TestingConfig,
    "simulation": DevelopmentConfig,
}
