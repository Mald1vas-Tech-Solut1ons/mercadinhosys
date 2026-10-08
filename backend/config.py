import os
import logging
from pathlib import Path
from urllib.parse import urlparse
from dotenv import load_dotenv

# Configure logger for config module
logger = logging.getLogger(__name__)

basedir = Path(__file__).parent.absolute()
db_path = Path("c:/temp/mercadinho_instance/mercadinho.db")

# Carrega .env cedo para que todas as variáveis estejam disponíveis
# antes da avaliação das classes de configuração.
load_dotenv(dotenv_path=basedir / ".env", override=False)


# ==================== HYBRID DATABASE CONFIGURATION ====================
# Hybrid Logic: Cloud First, Local Fallback
# CLOUD_ENABLED: 'true' (default, use cloud if possible), 'false' (standalone local only)
# HYBRID_MODE: 'online' (try cloud, fallback), 'offline' (straight to local)

_cloud_enabled = os.environ.get("CLOUD_ENABLED", "true").lower() == "true"
_hybrid_mode = os.environ.get("HYBRID_MODE", "online").lower()
_database_url = (
    os.environ.get("DATABASE_URL_TARGET")
    or os.environ.get("DB_PRIMARY")
    or os.environ.get("DATABASE_URL")
    or os.environ.get("POSTGRES_URL")
    or os.environ.get("AIVEN_DATABASE_URL")
)

_using_postgres = False
_sqlalchemy_database_uri = None
_db_source = "DEFAULT"

# Caminho padrão para SQLite (Instalável / Fallback)
_local_sqlite_uri = f"sqlite:///{os.path.join(basedir, 'instance', 'mercadinho_local.db')}"

if not _cloud_enabled or _hybrid_mode == "offline":
    _sqlalchemy_database_uri = _local_sqlite_uri
    _db_source = "LOCAL_ONLY"
    reason = "CLOUD_ENABLED=false" if not _cloud_enabled else "HYBRID_MODE=offline"
    print(f"[DB: HYBRID] Mode: {reason} | Using Local SQLite: {_sqlalchemy_database_uri}")
else:
    # Tentar configurar Cloud (Postgres)
    if _database_url:
        if _database_url.startswith("postgres://"):
            _database_url = _database_url.replace("postgres://", "postgresql://", 1)
        
        _sqlalchemy_database_uri = _database_url
        _using_postgres = _database_url.startswith("postgresql://")
        
        # Correção Crítica: Forçar sslmode=disable para localhost se não houver parâmetros
        if _using_postgres and "localhost" in _sqlalchemy_database_uri and "?" not in _sqlalchemy_database_uri:
            _sqlalchemy_database_uri += "?sslmode=disable"
        elif _using_postgres and "127.0.0.1" in _sqlalchemy_database_uri and "?" not in _sqlalchemy_database_uri:
            _sqlalchemy_database_uri += "?sslmode=disable"
            
        _db_source = "CLOUD_ENV"
        
        if _using_postgres:
            print(f"[DB: HYBRID] Mode: ONLINE | Source: CLOUD (Postgres)")
        else:
            print(f"[DB: HYBRID] Mode: ONLINE | Source: CLOUD (SQLite via URL?)")
    else:
        # Sem URL de nuvem configura automaticamente para local
        _sqlalchemy_database_uri = _local_sqlite_uri
        _db_source = "AUTO_LOCAL"
        print(f"[DB: HYBRID] Mode: ONLINE | No Cloud URL found. Fallback to Local SQLite.")

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
    # POOL ENXUTO: o Aiven (free) só tem 20 conexões e os processos internos dele
    # já consomem ~8. Com 2 workers gunicorn, cada um pode usar no máx pool_size+
    # max_overflow = 5 → 10 no total, com folga sob os ~12 disponíveis. Configurável
    # por env (DB_POOL_SIZE/DB_MAX_OVERFLOW) para ajustar conforme o plano do Aiven.
    SQLALCHEMY_ENGINE_OPTIONS = {
        "pool_pre_ping": True,
        "pool_recycle": 280,
        "pool_size": int(os.environ.get("DB_POOL_SIZE", "3")),
        "max_overflow": int(os.environ.get("DB_MAX_OVERFLOW", "2")),
        "pool_timeout": 30,
        "connect_args": {
            "keepalives": 1,
            "keepalives_idle": 30,
            "keepalives_interval": 10,
            "keepalives_count": 5,
            "connect_timeout": 10,
            # NOTA: sslmode NÃO é definido aqui — é controlado pelo __init__.py
            # que detecta se é localhost (disable) ou cloud/Aiven (require).
            # A URL do Aiven já inclui ?sslmode=require na query string.
        },
    } if _using_postgres else {}

    # ==================== CORS ====================
    cors_origins_str = os.environ.get("CORS_ORIGINS", "")
    CORS_ORIGINS = (
        [origin.strip() for origin in cors_origins_str.split(",")]
        if cors_origins_str
        else []
    )

    # ==================== EMAIL ====================
    MAIL_SERVER = os.environ.get("MAIL_SERVER", "smtp.gmail.com")
    MAIL_PORT = int(os.environ.get("MAIL_PORT", 587))
    MAIL_USE_TLS = os.environ.get("MAIL_USE_TLS", "true").lower() == "true"
    MAIL_USE_SSL = os.environ.get("MAIL_USE_SSL", "false").lower() == "true"
    MAIL_USERNAME = os.environ.get("MAIL_USERNAME")
    MAIL_PASSWORD = os.environ.get("MAIL_PASSWORD") or os.environ.get("EMAIL_APP_PASSWORD")
    MAIL_DEFAULT_SENDER = os.environ.get("MAIL_DEFAULT_SENDER", os.environ.get("MAIL_USERNAME"))

    # ==================== UPLOADS ====================
    UPLOAD_FOLDER = os.path.join(basedir, "uploads")
    MAX_CONTENT_LENGTH = 5 * 1024 * 1024  # 5MB max

    # ==================== JWT ====================
    # JWT_SECRET_KEY: manter estável entre restarts; se mudar, tokens em uso passam a retornar 401.
    JWT_ACCESS_TOKEN_EXPIRES = 3600
    # ==================== CACHE ====================
    CACHE_TYPE = os.environ.get("CACHE_TYPE", "SimpleCache")
    CACHE_DEFAULT_TIMEOUT = 300

    # ==================== SYNC ====================
    APP_MODE = os.environ.get("APP_MODE", "local")
    SYNC_ENABLED = os.environ.get("SYNC_ENABLED", "false").lower() == "true"
    SYNC_WORKER_INTERVAL = int(os.environ.get("SYNC_WORKER_INTERVAL", "30"))
    SYNC_MAX_RETRIES = int(os.environ.get("SYNC_MAX_RETRIES", "3"))
    CLOUD_API_URL = os.environ.get("CLOUD_API_URL", "https://mercadinhosys.onrender.com")
    CLOUD_SYNC_TOKEN = os.environ.get("CLOUD_SYNC_TOKEN", "")


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
