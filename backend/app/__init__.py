"""
MercadinhoSys API - Factory Flask
Arquitetura modular com blueprints por funcionalidade
"""

from flask import Flask, jsonify, request
from flask_migrate import Migrate
from flask_cors import CORS
from flask_jwt_extended import JWTManager
from flask_caching import Cache
from flask_mail import Mail
from app.models import db
from config import config
import os
import re
import logging
from urllib.parse import urlparse
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv

try:
    import sentry_sdk
    from sentry_sdk.integrations.flask import FlaskIntegration
except ModuleNotFoundError:
    sentry_sdk = None
    FlaskIntegration = None

# Função para horário de Manaus (GMT-4)
def get_manaus_time():
    """Retorna datetime atual no fuso de Manaus (GMT-4)"""
    utc_now = datetime.now(timezone.utc)
    manaus_tz = timezone(timedelta(hours=-4))
    return utc_now.astimezone(manaus_tz)

# Inicializa as extensões
migrate = Migrate()
jwt = JWTManager()
# O cache será configurado dinamicamente no factory para suportar Redis
cache = Cache()
mail = Mail()

# Logger básico
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def create_app(config_name=None):
    """Factory function para criar a aplicação Flask"""

    if config_name is None:
        config_name = os.getenv("FLASK_ENV", "default")

    load_dotenv()
    
    # 1. MONITORAMENTO (SENTRY)
    # DSN ausente preserva o destino de produção; DSN explicitamente vazio
    # desativa envio, inclusive quando o ensaio usa configuração production.
    from app.utils.sentry_config import resolve_sentry_dsn
    sentry_dsn = resolve_sentry_dsn(config_name)
    if sentry_dsn and sentry_sdk and FlaskIntegration:
        # Sample rates configuráveis por env. 1.0 (100%) em produção é caro e
        # estoura a cota do plano gratuito — default conservador de 10%.
        def _sample_rate(env_key: str, default: float) -> float:
            try:
                return max(0.0, min(1.0, float(os.getenv(env_key, str(default)))))
            except (TypeError, ValueError):
                return default

        sentry_sdk.init(
            dsn=sentry_dsn,
            integrations=[FlaskIntegration()],
            traces_sample_rate=_sample_rate("SENTRY_TRACES_SAMPLE_RATE", 0.1),
            profiles_sample_rate=_sample_rate("SENTRY_PROFILES_SAMPLE_RATE", 0.1),
            environment=os.getenv("SENTRY_ENVIRONMENT", config_name),
            release=os.getenv("RENDER_GIT_COMMIT") or os.getenv("SENTRY_RELEASE"),
            send_default_pii=False,  # não enviar dados pessoais por padrão (LGPD)
        )
        logger.info("🛡️ Sentry inicializado (environment=%s).", os.getenv("SENTRY_ENVIRONMENT", config_name))
    elif sentry_dsn:
        logger.warning("SENTRY_DSN configurado, mas pacote sentry_sdk nao esta instalado. Monitoramento desativado.")

    app = Flask(__name__)


    # Carrega configurações
    app.config.from_object(config[config_name])

    # Configurar JSON Provider Customizado (Decimal, Date, etc)
    from app.utils.json_provider import CustomJSONProvider
    app.json = CustomJSONProvider(app)

    db_source = None
    runtime_db_url = (
        os.environ.get("DATABASE_URL_TARGET")
        or os.environ.get("DB_PRIMARY")
        or os.environ.get("DATABASE_URL")
        or os.environ.get("POSTGRES_URL")
        or os.environ.get("AIVEN_DATABASE_URL")
    )
    # DETECTAR MODO MULTI-TENANT (não afeta modo normal)
    multi_tenant_mode = os.getenv('MULTI_TENANT_MODE', 'false').lower() == 'true'
    main_db_url = os.getenv('MAIN_DATABASE_URL')
    
    if multi_tenant_mode and main_db_url:
        # Modo Multi-Tenant - usar banco principal para autenticação
        runtime_db_url = main_db_url
        app.config["MULTI_TENANT_MODE"] = True
        logger.info("🏢 MODO MULTI-TENANT ATIVADO")
    else:
        # Modo normal - Prioridade para banco LOCAL (Docker/Postgres) se disponível
        runtime_db_url = (
            os.environ.get("DATABASE_URL_TARGET")
            or os.environ.get("DB_PRIMARY")
            or os.environ.get("DATABASE_URL")
            or os.environ.get("POSTGRES_URL")
            or os.environ.get("AIVEN_DATABASE_URL")
        )
    
    if runtime_db_url:
        if runtime_db_url.startswith("postgres://"):
            runtime_db_url = runtime_db_url.replace("postgres://", "postgresql://", 1)
        app.config["SQLALCHEMY_DATABASE_URI"] = runtime_db_url
        
        # Connection Pooling para Neon/Aiven (Postgres Cloud)
        # pool_recycle DEVE ser menor que o idle_timeout do Neon (~300s / 5min).
        # 1800s (30min) causava SSL SYSCALL error: EOF detected — conexões mortas reutilizadas.
        if "postgres" in runtime_db_url or runtime_db_url.startswith("postgresql"):
            from urllib.parse import urlparse as _urlparse
            _parsed_host = _urlparse(runtime_db_url).hostname or ""
            _is_local_host = _parsed_host in ("localhost", "127.0.0.1", "::1", "postgres", "db", "mercadinhosys-db")

            # pool_size + max_overflow enxutos: Neon free = 20 conexões; 2 workers gunicorn × 5 = 10
            _pool_size     = int(os.environ.get("DB_POOL_SIZE", "3"))
            _max_overflow  = int(os.environ.get("DB_MAX_OVERFLOW", "2"))

            app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {
                "pool_size": _pool_size,
                "max_overflow": _max_overflow,
                # 240s < 300s (timeout idle do Neon) — recicla ANTES do banco fechar
                "pool_recycle": int(os.environ.get("DB_POOL_RECYCLE", "240")),
                "pool_timeout": 30,
                # pool_pre_ping: testa SELECT 1 antes de cada uso — 2ª linha de defesa
                "pool_pre_ping": True,
                "connect_args": {
                    "connect_timeout": 10,
                    "application_name": "mercadinhosys_backend",
                    "keepalives": 1,
                    "keepalives_idle": 30,
                    "keepalives_interval": 10,
                    "keepalives_count": 5,
                    # sslmode NÃO entra aqui — conflita com ?sslmode= na URL.
                    # Neon/Aiven: sslmode=require já vem na DATABASE_URL.
                }
            }
            logger.info(f"[DB] Postgres detectado. Host: {_parsed_host} | pool_recycle=240s | SSL: {'DESATIVADO (local)' if _is_local_host else 'via URL (cloud)'}")

        for key in ["DATABASE_URL_TARGET", "DB_PRIMARY", "DATABASE_URL", "POSTGRES_URL", "AIVEN_DATABASE_URL"]:
            if os.environ.get(key):
                db_source = key
                break

    # Inicializa extensões
    db.init_app(app)
    from app.utils.query_helpers import configure_sqlite_search
    with app.app_context():
        for engine in db.engines.values():
            configure_sqlite_search(engine)
    migrate.init_app(app, db)
    jwt.init_app(app)
    from app.middleware.rate_limit import limiter
    limiter.init_app(app)

    # Callbacks JWT: unificar falhas de autenticação como 401 (ERP/API padrão)
    # Evita 422 para token inválido; frontend trata apenas 401 (refresh ou redirect)
    @jwt.invalid_token_loader
    def custom_invalid_token_callback(error_string):
        logger.warning("[JWT] Token inválido ou malformado (não logamos o valor)")
        return jsonify({
            "success": False,
            "error": "Não autorizado",
            "msg": "Token inválido ou expirado. Faça login novamente.",
        }), 401

    @jwt.expired_token_loader
    def custom_expired_token_callback(_jwt_header, _jwt_data):
        logger.info("[JWT] Token expirado")
        return jsonify({
            "success": False,
            "error": "Não autorizado",
            "msg": "Token expirado. Faça login novamente.",
        }), 401

    @jwt.unauthorized_loader
    def custom_unauthorized_callback(error_string):
        logger.info("[JWT] Requisição sem token válido")
        return jsonify({
            "success": False,
            "error": "Não autorizado",
            "msg": error_string or "Token não informado.",
        }), 401

    # 2. CACHE (REDIS VS SIMPLE)
    redis_url = os.getenv("REDIS_URL")
    if redis_url:
        app.config["CACHE_TYPE"] = "RedisCache"
        app.config["CACHE_REDIS_URL"] = redis_url
        logger.info(f"🚀 CACHE: Redis detectado em {redis_url[:15]}...")
    else:
        app.config["CACHE_TYPE"] = "SimpleCache"
        logger.info("📦 CACHE: Redis não detectado. Usando SimpleCache (Local).")
    
    cache.init_app(app)
    mail.init_app(app)

    @app.before_request
    def load_tenant_context():
        """
        Handler Global: Carrega as claims do JWT para o objeto 'g' do Flask.
        Isso permite que o models.py (TenantQuery) acesse is_super_admin e estabelecimento_id
        sem depender de chamadas diretas ao get_jwt() dentro da classe Query.
        """
        from flask_jwt_extended import get_jwt, verify_jwt_in_request
        from flask import g, request, abort

        # Ignorar OPTIONS e rotas de auth/health que não requerem JWT filtrado
        if request.method == "OPTIONS" or any(p in request.path for p in ["/api/auth/login", "/api/health", "/api/ready", "/api/onboarding"]):
            return

        # Verifica o JWT sem forçar erro (algumas rotas são públicas). Token
        # malformado/expirado não deve gerar 500: tratamos como "sem claims".
        claims = None
        try:
            verify_jwt_in_request(optional=True)
            claims = get_jwt()
        except Exception:
            claims = None

        if not claims:
            return  # Rota pública / sem autenticação: nada a escopar.

        from app.utils.query_helpers import get_authorized_establishment_id
        is_super = bool(claims.get("is_super_admin", False))
        g.is_super_admin = is_super
        # get_authorized_establishment_id já trata impersonation (header) p/ super-admin.
        tid = get_authorized_establishment_id()

        if is_super:
            # Super-admin: pode ser 'all' (visão global) ou um tenant impersonado
            # (modo espelho). O TenantQuery passa a filtrar por 'tid' quando concreto.
            g.estabelecimento_id = tid
            # MODO ESPELHO É SOMENTE LEITURA: ao visualizar uma loja específica, o
            # super admin não pode alterar os dados dela. Bloqueia escrita — exceto
            # no console SaaS (gestão de lojas/planos) e auth.
            if (
                tid is not None
                and str(tid).lower() != "all"
                and request.method not in ("GET", "HEAD", "OPTIONS")
                and not request.path.startswith(("/api/saas", "/api/super-admin", "/api/auth"))
            ):
                logger.info("🔒 Modo espelho (super admin) — escrita bloqueada em %s %s", request.method, request.path)
                abort(403, description="Modo espelho do super admin é somente leitura. Saia do espelho (selecione 'Todos') para alterar dados.")
        elif tid is not None:
            g.estabelecimento_id = tid
            # Bloqueio Global de Inadimplência (Fase 1 Comercial)
            if request.path.startswith("/api/"):
                allowed_prefixes = ("/api/auth", "/api/billing", "/api/onboarding", "/api/saas", "/api/health", "/api/ready")
                if not request.path.startswith(allowed_prefixes):
                    # Performance: o plano_status era buscado no Postgres em CADA request
                    # autenticada (uma ida ao banco remoto por chamada). Agora fica em cache
                    # por 60s. Ativar/inativar loja invalida a chave (ver saas), então o
                    # bloqueio continua imediato quando o status muda de verdade.
                    status_key = f"plano_status:{tid}"
                    cached_data = cache.get(status_key)
                    
                    if isinstance(cached_data, dict):
                        plano_status = cached_data.get('status', 'ativo')
                        venc_str = cached_data.get('vencimento')
                        if venc_str:
                            from datetime import datetime
                            try:
                                vencimento = datetime.fromisoformat(venc_str).date()
                            except Exception:
                                vencimento = None
                        else:
                            vencimento = None
                    else:
                        from app.models import Estabelecimento
                        est = Estabelecimento.query.get(tid)
                        plano_status = (est.plano_status if est else "ativo") or "ativo"
                        vencimento = est.vencimento_plano if est else None
                        
                        cache.set(status_key, {
                            'status': plano_status,
                            'vencimento': vencimento.isoformat() if vencimento else None
                        }, timeout=60)
                        
                    if plano_status in ['cancelado', 'inadimplente', 'suspenso']:
                        logger.warning(f"🚫 Acesso bloqueado para tenant {tid} devido a inadimplência ({plano_status}). Rota: {request.path}")
                        abort(403, description="Sua assinatura está inativa ou suspensa. Acesse o painel de cobrança para regularizar.")
                        
                    if plano_status == 'experimental' and vencimento:
                        from datetime import date
                        if vencimento < date.today():
                            logger.warning(f"🚫 Acesso bloqueado para tenant {tid} devido a trial expirado ({vencimento}). Rota: {request.path}")
                            abort(403, description="Seu período de teste expirou. Acesse o painel de cobrança para regularizar.")
        else:
            # FAIL-CLOSED: token de tenant autenticado SEM estabelecimento resolvido
            # é uma anomalia. Negar é mais seguro que vazar dados de todos os tenants.
            logger.error(
                "🔒 Token autenticado sem estabelecimento_id resolvido em %s — negando (fail-closed).",
                request.path,
            )
            abort(403, description="Contexto de estabelecimento ausente no token.")

    # RBAC + plano por prefixo de URL. Registrado DEPOIS do load_tenant_context
    # para reaproveitar g.estabelecimento_id (before_request roda em ordem).
    from app.middleware.access_control import init_access_control
    init_access_control(app)

    @app.errorhandler(404)
    def handle_404_error(e):
        return jsonify({
            "success": False,
            "error": "Rota não encontrada",
            "path": request.path,
            "method": request.method
        }), 404

    db_uri = app.config.get("SQLALCHEMY_DATABASE_URI")
    redacted_db_uri = db_uri
    if db_uri:
        try:
            parsed = urlparse(db_uri)
            if parsed.password:
                username = parsed.username or ""
                host = parsed.hostname or ""
                port = f":{parsed.port}" if parsed.port else ""
                auth = f"{username}:****@" if username else ""
                redacted_db_uri = parsed._replace(netloc=f"{auth}{host}{port}").geturl()
        except Exception:
            redacted_db_uri = db_uri
    logger.info(f"DB URI: {redacted_db_uri}")
    logger.info(f"DB SOURCE: {db_source or 'config'}")
    
    # Inicializa Flask-Login
    from app.models import login_manager
    login_manager.init_app(app)

    # CORS - Configuração COMPLETA para produção
    import re
    
    # Configuração de CORS - Robusta para Vercel/Render e Local
    cors_origins = None
    if app.config.get("CORS_ORIGINS"):
        cors_origins = app.config["CORS_ORIGINS"]
    
    if not cors_origins:
        # Fallbacks dinâmicos se não houver env
        if os.getenv("VERCEL_URL"):
            cors_origins = [f"https://{os.getenv('VERCEL_URL')}", "https://mercadinhosys.vercel.app"]
        else:
            cors_origins = ["*"] # Desenvolvimento ou fallback absoluto
    
    CORS(app, resources={r"/api/*": {
        "origins": cors_origins,
        "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
        "allow_headers": ["Content-Type", "Authorization", "X-Requested-With", "Access-Control-Allow-Origin", "X-Establishment-ID", "X-Establishment-Id", "X-Impersonate-Tenant-Id", "X-Tenant-ID"],
        "expose_headers": ["Content-Range", "X-Content-Range"],
        "supports_credentials": True,
        "max_age": 600
    }})
    logger.info(f"🌐 CORS configurado (Regex habilitado para Vercel/Render)")


    
    # Cria pastas necessárias
    for folder in ["instance", "instance/uploads", "logs", "backups"]:
        if not os.path.exists(folder):
            os.makedirs(folder)

    # ==================== BOOTSTRAP: CRIAR TABELAS E COLUNAS CRÍTICAS ====================
    # Otimização para Vercel/Render: Pular setup se SKIP_DB_SETUP=true ou se em produção após primeiro deploy
    skip_db_setup = os.environ.get("SKIP_DB_SETUP", "false").lower() == "true"

    # Em produção, o setup pesado em cada requisição causa timeouts (Render/Vercel).
    is_production = config_name == "production"
    is_cloud = os.environ.get("VERCEL") == "1" or os.environ.get("RENDER") == "1"

    # create_app() roda em TODO boot do processo (flask db upgrade, cada worker do
    # gunicorn, etc.) porque run.py chama create_app() no import do módulo. Rodar
    # db.create_all() incondicionalmente aqui cria tabelas "adiantado" a partir do
    # models.py atual, antes do Alembic aplicar a migração correspondente — quando
    # essa migração roda depois, o CREATE TABLE dela colide (DuplicateTable), a
    # migração falha, e o alembic_version trava ali para sempre (mesmo as
    # migrações aditivas seguintes, inofensivas, nunca mais são aplicadas). Isso já
    # causou schema drift real em produção (Aiven) mais de uma vez.
    #
    # Não dá para simplesmente remover o create_all(): a primeira migração da
    # cadeia (366b766bc135, down_revision=None) é aditiva sobre tabelas "core" que
    # já existiam — ou seja, o Alembic foi retrofitado num schema que só o
    # create_all() sabe construir do zero. Um banco vazio precisa do create_all()
    # para ter as tabelas-base antes de `flask db upgrade` rodar.
    #
    # Fix: só rodar esse bootstrap legado se o Alembic ainda não estiver
    # controlando o schema (tabela alembic_version não existe = banco vazio /
    # primeiro boot). Uma vez que alembic_version existe, as migrações são a
    # única fonte de verdade do schema.
    alembic_ja_controla_schema = False
    if not skip_db_setup:
        try:
            with app.app_context():
                from sqlalchemy import inspect as _boot_insp
                alembic_ja_controla_schema = "alembic_version" in _boot_insp(db.engine).get_table_names()
        except Exception as e:
            logger.warning(f"⚠️ Não foi possível checar alembic_version (assumindo banco novo): {e}")

    if not skip_db_setup and not alembic_ja_controla_schema:
        with app.app_context():
            try:
                # Testar conexão se for Postgres
                if app.config.get("USING_POSTGRES"):
                    from sqlalchemy import text
                    logger.info("VERIFICANDO: Conexao com a Nuvem (Postgres)...")
                    db.session.execute(text("SELECT 1"))
                
                logger.info("VERIFICANDO: Tabelas no banco de dados...")
                # Garante que os modelos sejam carregados para o metadata do SQLAlchemy
                from app.models import FuncionarioPreferencias
                db.create_all()
                
                # Garantir que a tabela de histórico de login também seja criada explicitamente se omitida
                from sqlalchemy import text
                id_syntax = "SERIAL PRIMARY KEY" if app.config.get("USING_POSTGRES") else "INTEGER PRIMARY KEY AUTOINCREMENT"
                db.session.execute(text(f"CREATE TABLE IF NOT EXISTS login_history (id {id_syntax}, username VARCHAR(150), ip_address VARCHAR(45), dispositivo VARCHAR(200), success BOOLEAN, observacoes TEXT, token_hash INTEGER, funcionario_id INTEGER, estabelecimento_id INTEGER, data_cadastro TIMESTAMP DEFAULT CURRENT_TIMESTAMP)"))
                db.session.commit()
                
                logger.info("SUCESSO: Tabelas verificadas/criadas.")
            except Exception as e:
                logger.error(f"ERRO: Falha ao conectar na Nuvem: {e}")
                
                # FALLBACK LOGIC - RESTRITO
                # Em produção (Render/Vercel), NÃO fazer fallback automático para SQLite 
                # pois isso cria um banco vazio e esconde o erro real de conexão.
                hybrid_mode = os.environ.get("HYBRID_MODE", "online").lower()
                force_local = os.environ.get("FORCE_LOCAL_FALLBACK", "false").lower() == "true"
                
                # Se for PROD e não for forçado, não faz fallback!
                if is_production and not force_local:
                    logger.critical("🚫 PRODUÇÃO: Conexão com banco falhou. Fallback para SQLite BLOQUEADO para evitar perda de dados aparente.")
                    logger.critical("Verifique DATABASE_URL e firewall.")
                    # Não relançamos o erro para não derrubar o container em loop, mas a app ficará instável/erro 500
                elif hybrid_mode != "offline" and app.config.get("USING_POSTGRES"):
                    logger.error("❌ ERRO CRÍTICO: Falha ao conectar ao Postgres. Fallback para SQLite DESATIVADO para manter integridade.")
                    # Mantém o URI original para tentar reconexão nas próximas requests
                    pass
                    
                    # Recriar engine/session (simplificado - idealmente reiniciaria a app, mas vamos tentar create_all local)
                    try:
                        db.create_all()
                        logger.info("SUCESSO: Banco de dados LOCAL inicializado.")
                    except Exception as le:
                        logger.error(f"ERRO FATAL: Nem o banco local pode ser inicializado: {le}")
                else:
                    logger.error(f"ERRO: Criar tabelas no bootstrap: {e}")

    elif skip_db_setup:
        logger.info("INFO: db.create_all() pulado (SKIP_DB_SETUP=true). Schema sync ainda sera executado.")
    else:
        logger.info("INFO: db.create_all() pulado (alembic_version já existe — schema é responsabilidade só das migrações). Schema sync ainda sera executado.")

    # ==================== SCHEMA SYNC ====================
    # Pode ser pulado com SKIP_SCHEMA_SYNC=true (ex: durante seed que já fez drop_all+create_all)
    if os.environ.get("SKIP_SCHEMA_SYNC", "false").lower() == "true":
        logger.info("⏭️ Schema Sync pulado (SKIP_SCHEMA_SYNC=true).")
    else:
        with app.app_context():
            try:
                from sqlalchemy import text as _sync_text
                is_sqlite = db.engine.name == 'sqlite'

                schema_sqls = [
                    # Estabelecimento - SaaS
                    ("estabelecimentos", "plano",                   "VARCHAR(20)  DEFAULT 'Gratuito'"),
                    ("estabelecimentos", "plano_status",            "VARCHAR(20)  DEFAULT 'experimental'"),
                    ("estabelecimentos", "gateway_customer_id",      "VARCHAR(100)"),
                    ("estabelecimentos", "gateway_subscription_id",  "VARCHAR(100)"),
                    ("estabelecimentos", "vencimento_assinatura",   "TIMESTAMP"),
                    # Estabelecimento - Endereço completo
                    ("estabelecimentos", "cep",                     "VARCHAR(9)   DEFAULT '00000-000'"),
                    ("estabelecimentos", "logradouro",              "VARCHAR(200) DEFAULT 'Nao Informado'"),
                    ("estabelecimentos", "numero",                  "VARCHAR(10)  DEFAULT 'S/N'"),
                    ("estabelecimentos", "complemento",             "VARCHAR(100)"),
                    ("estabelecimentos", "bairro",                  "VARCHAR(100) DEFAULT 'Centro'"),
                    ("estabelecimentos", "cidade",                  "VARCHAR(100) DEFAULT 'Cidade'"),
                    ("estabelecimentos", "estado",                  "VARCHAR(2)   DEFAULT 'SP'"),
                    ("estabelecimentos", "pais",                    "VARCHAR(50)  DEFAULT 'Brasil'"),
                    # Configurações
                    ("configuracoes", "logo_base64",                "TEXT"),
                    ("configuracoes", "tema_escuro",                "BOOLEAN DEFAULT FALSE"),
                    ("configuracoes", "cor_principal",              "VARCHAR(7) DEFAULT '#2563eb'"),
                    ("configuracoes", "emitir_nfe",                 "BOOLEAN DEFAULT FALSE"),
                    ("configuracoes", "emitir_nfce",                "BOOLEAN DEFAULT TRUE"),
                    ("configuracoes", "impressao_automatica",       "BOOLEAN DEFAULT FALSE"),
                    ("configuracoes", "tipo_impressora",            "VARCHAR(20) DEFAULT 'termica_80mm'"),
                    ("configuracoes", "exibir_preco_tela",          "BOOLEAN DEFAULT TRUE"),
                    ("configuracoes", "mostrar_foto_produto_pdv",   "BOOLEAN DEFAULT FALSE"),
                    ("configuracoes", "permitir_venda_sem_estoque", "BOOLEAN DEFAULT FALSE"),
                    ("configuracoes", "desconto_maximo_percentual", "NUMERIC(5,2) DEFAULT 10.00"),
                    ("configuracoes", "desconto_maximo_funcionario","NUMERIC(5,2) DEFAULT 10.00"),
                    ("configuracoes", "arredondamento_valores",     "BOOLEAN DEFAULT TRUE"),
                    ("configuracoes", "formas_pagamento",           "TEXT"),
                    ("configuracoes", "controlar_validade",         "BOOLEAN DEFAULT TRUE"),
                    ("configuracoes", "alerta_estoque_minimo",      "BOOLEAN DEFAULT TRUE"),
                    ("configuracoes", "dias_alerta_validade",       "INTEGER DEFAULT 30"),
                    ("configuracoes", "estoque_minimo_padrao",      "INTEGER DEFAULT 10"),
                    ("configuracoes", "tempo_sessao_minutos",       "INTEGER DEFAULT 30"),
                    ("configuracoes", "tentativas_senha_bloqueio",  "INTEGER DEFAULT 3"),
                    ("configuracoes", "alertas_email",              "BOOLEAN DEFAULT FALSE"),
                    ("configuracoes", "alertas_whatsapp",           "BOOLEAN DEFAULT FALSE"),
                    ("configuracoes", "horas_extras_percentual",    "NUMERIC(5,2) DEFAULT 50.00"),
                    # Funcionarios
                    ("funcionarios", "data_demissao",               "DATE"),
                    ("funcionarios", "salario",                     "NUMERIC(10,2)"),
                    ("funcionarios", "observacoes",                 "TEXT"),
                    ("funcionarios", "foto_url",                    "TEXT"),
                    ("funcionarios", "role",                        "VARCHAR(30)  DEFAULT 'FUNCIONARIO'"),
                    ("funcionarios", "ativo",                       "BOOLEAN      DEFAULT TRUE"),
                    ("funcionarios", "permissoes_json",             "TEXT"),
                    # Produtos
                    ("produtos", "margem_lucro",                    "NUMERIC(10,2)"),
                    ("produtos", "fornecedor_id",                   "INTEGER"),
                    ("produtos", "codigo_barras",                   "VARCHAR(50)"),
                    ("produtos", "ativo",                           "BOOLEAN DEFAULT TRUE"),
                    ("produtos", "fabricante",                      "VARCHAR(100)"),
                    ("produtos", "tipo",                            "VARCHAR(50)"),
                    ("produtos", "subcategoria",                    "VARCHAR(50)"),
                    ("produtos", "ncm",                             "VARCHAR(8)"),
                    ("produtos", "origem",                          "INTEGER DEFAULT 0"),
                    # Clientes
                    ("clientes", "vendedor_id",                     "INTEGER"),
                    ("produtos", "controlar_validade",              "BOOLEAN DEFAULT FALSE"),
                    ("produtos", "data_validade",                   "DATE"),
                    ("produtos", "lote",                            "VARCHAR(50)"),
                    ("produtos", "imagem_url",                      "VARCHAR(255)"),
                    ("produtos", "familia_produto",                 "VARCHAR(40)"),
                    ("produtos", "perfil_fiscal",                   "VARCHAR(40)"),
                    ("produtos", "classificacao_abc",               "VARCHAR(1)"),
                    # Vendas
                    ("vendas", "valor_recebido",                    "NUMERIC(10,2) DEFAULT 0"),
                    ("vendas", "troco",                             "NUMERIC(10,2) DEFAULT 0"),
                    ("vendas", "data_cancelamento",                 "TIMESTAMP"),
                    ("vendas", "motivo_cancelamento",               "VARCHAR(255)"),
                    ("vendas", "quantidade_itens",                  "INTEGER DEFAULT 0"),
                    ("vendas", "observacoes",                       "TEXT"),
                    # Venda Itens
                    ("venda_itens", "custo_unitario",               "NUMERIC(10,2)"),
                    ("venda_itens", "margem_item",                  "NUMERIC(5,2)"),
                    ("venda_itens", "margem_lucro_real",            "NUMERIC(10,2)"),
                    # Despesas
                    ("despesas", "data_emissao",                    "DATE"),
                    ("despesas", "data_vencimento",                 "DATE"),
                    # Rescisão - vínculo financeiro
                    ("rescisoes", "despesa_id",                     "INTEGER"),
                    ("rescisoes", "forma_pagamento",                "VARCHAR(50)"),
                    # Pedido de Compra - janela de entrega
                    ("pedidos_compra", "horario_entrega",           "VARCHAR(30)"),
                ]

                from sqlalchemy import inspect as _insp
                inspector = _insp(db.engine)
                logger.info("⚡ Iniciando Schema Sync Otimizado...")
                table_columns_cache = {}
                existing_tables = inspector.get_table_names()
                added = 0

                for table, col, col_type in schema_sqls:
                    if table not in existing_tables:
                        continue
                    if table not in table_columns_cache:
                        table_columns_cache[table] = [c['name'] for c in inspector.get_columns(table)]
                    if col not in table_columns_cache[table]:
                        try:
                            logger.info(f"➕ Adicionando coluna {col} na tabela {table}...")
                            db.session.execute(_sync_text(f"ALTER TABLE {table} ADD COLUMN {col} {col_type}"))
                            db.session.commit()
                            table_columns_cache[table].append(col)
                            added += 1
                        except Exception as e:
                            db.session.rollback()
                            logger.warning(f"⚠️ Erro ao adicionar {table}.{col}: {e}")

                logger.info(f"✅ Schema sync concluido: {added} colunas novas adicionadas.")
                
                # Criar novas tabelas SFA que não existiam antes para evitar erro 500 em Produção onde create_all é desativado
                if "metas_vendedor" not in existing_tables:
                    try:
                        logger.info("Criando tabela metas_vendedor (SFA)...")
                        id_syntax = "SERIAL PRIMARY KEY" if app.config.get("USING_POSTGRES") else "INTEGER PRIMARY KEY AUTOINCREMENT"
                        db.session.execute(_sync_text(f"""
                            CREATE TABLE IF NOT EXISTS metas_vendedor (
                                id {id_syntax},
                                vendedor_id INTEGER NOT NULL REFERENCES funcionarios(id),
                                estabelecimento_id INTEGER NOT NULL REFERENCES estabelecimentos(id),
                                mes INTEGER NOT NULL,
                                ano INTEGER NOT NULL,
                                valor_meta NUMERIC(10, 2) NOT NULL DEFAULT 0.0
                            )
                        """))
                        db.session.commit()
                    except Exception as e:
                        db.session.rollback()
                        logger.warning(f"Erro ao criar metas_vendedor: {e}")
                        
                if "produtos_foco" not in existing_tables:
                    try:
                        logger.info("Criando tabela produtos_foco (SFA)...")
                        id_syntax = "SERIAL PRIMARY KEY" if app.config.get("USING_POSTGRES") else "INTEGER PRIMARY KEY AUTOINCREMENT"
                        db.session.execute(_sync_text(f"""
                            CREATE TABLE IF NOT EXISTS produtos_foco (
                                id {id_syntax},
                                estabelecimento_id INTEGER NOT NULL REFERENCES estabelecimentos(id),
                                produto_id INTEGER NOT NULL REFERENCES produtos(id),
                                ativo BOOLEAN DEFAULT TRUE,
                                data_inicio DATE NOT NULL,
                                data_fim DATE
                            )
                        """))
                        db.session.commit()
                    except Exception as e:
                        db.session.rollback()
                        logger.warning(f"Erro ao criar produtos_foco: {e}")
            except Exception as sync_err:
                db.session.rollback()
                logger.error(f"⚠️ Schema sync falhou: {sync_err}")



    # ==================== REGISTRO DE BLUEPRINTS ====================
    # Auth - IMPORTANTE: Usamos a versão Multi-Tenant como padrão para garantir
    # que rotas como /verify-tenant estejam sempre disponíveis, delegando ao 
    # blueprint o tratamento de fallback para modo offline/local.
    try:
        from app.routes.auth_multi_tenant import auth_bp
        app.register_blueprint(auth_bp, url_prefix="/api/auth")
        logger.info("✅ Blueprint Auth (Multi-Tenant Logic) registrado em /api/auth")
        
        # Mapeamento para garantir que rotas legadas ou específicas continuem funcionando
        # se houver necessidade de manter ambos os blueprints, mas aqui optamos pela unificação.
    except Exception as e:
        logger.error(f"❌ Erro ao registrar auth: {e}")

    # Produtos
    try:
        from app.routes.produtos import produtos_bp

        app.register_blueprint(produtos_bp, url_prefix="/api/produtos")
        logger.info("✅ Blueprint produtos registrado em /api/produtos")
    except Exception as e:
        logger.error(f"❌ Erro ao registrar produtos: {e}")

    # Motor de Renderizacao Contextual (schema dinamico por segmento/tenant)
    try:
        from app.routes.view_schema import view_schema_bp

        app.register_blueprint(view_schema_bp, url_prefix="/api/view-schema")
        logger.info("✅ Blueprint view_schema registrado em /api/view-schema")
    except Exception as e:
        logger.error(f"❌ Erro ao registrar view_schema: {e}")

    # Fornecedores
    try:
        from app.routes.fornecedores import fornecedores_bp
        app.register_blueprint(fornecedores_bp, url_prefix="/api/fornecedores")
        logger.info("✅ Blueprint fornecedores registrado em /api/fornecedores")
    except Exception as e:
        logger.error(f"❌ Erro ao registrar fornecedores: {e}")

    # Funcionarios
    try:
        from app.routes.funcionarios import funcionarios_bp

        app.register_blueprint(funcionarios_bp, url_prefix="/api/funcionarios")
        logger.info("✅ Blueprint funcionarios registrado em /api/funcionarios")
    except Exception as e:
        logger.error(f"❌ Erro ao registrar funcionarios: {e}")

    # Clientes
    try:
        from app.routes.clientes import clientes_bp

        app.register_blueprint(clientes_bp, url_prefix="/api/clientes")
        logger.info("✅ Blueprint clientes registrado em /api/clientes")
    except Exception as e:
        logger.error(f"❌ Erro ao registrar clientes: {e}")

    # Vendas
    try:
        from app.routes.vendas import vendas_bp

        app.register_blueprint(vendas_bp, url_prefix="/api/vendas")
        logger.info("✅ Blueprint vendas registrado em /api/vendas")
    except Exception as e:
        logger.error(f"❌ Erro ao registrar vendas: {e}")

    # Fiscal (entrada XML / emissão)
    try:
        from app.routes.fiscal import fiscal_bp
        app.register_blueprint(fiscal_bp, url_prefix="/api/fiscal")
        logger.info("✅ Blueprint fiscal registrado em /api/fiscal")
    except Exception as e:
        logger.error(f"❌ Erro ao registrar fiscal: {e}")

    # Auditoria do tenant (cada loja vê os próprios logs)
    try:
        from app.routes.auditoria import auditoria_bp
        app.register_blueprint(auditoria_bp, url_prefix="/api/auditoria")
        logger.info("✅ Blueprint auditoria registrado em /api/auditoria")
    except Exception as e:
        logger.error(f"❌ Erro ao registrar auditoria: {e}")

    # PDV
    try:
        from app.routes.pdv import pdv_bp

        app.register_blueprint(pdv_bp, url_prefix="/api/pdv")
        logger.info("✅ Blueprint pdv registrado em /api/pdv")
    except Exception as e:
        logger.error(f"❌ Erro ao registrar pdv: {e}")

    # Caixas
    try:
        from app.routes.caixas import caixas_bp

        app.register_blueprint(caixas_bp, url_prefix="/api/caixas")
        logger.info("✅ Blueprint caixas registrado em /api/caixas")
    except Exception as e:
        logger.error(f"❌ Erro ao registrar caixas: {e}")

    # Configuração
    try:
        from app.routes.configuracao import configuracao_bp
        app.register_blueprint(configuracao_bp, url_prefix="/api/configuracao")
        logger.info("✅ Blueprint configuracao registrado em /api/configuracao")
    except Exception as e:
        logger.error(f"❌ Erro ao registrar configuracao: {e}")

    # Dashboard
    try:
        from app.routes.dashboard import dashboard_bp
        app.register_blueprint(dashboard_bp, url_prefix="/api/dashboard")
        logger.info("✅ Blueprint dashboard registrado em /api/dashboard")
        app.config['DASHBOARD_CIENTIFICO_DISPONIVEL'] = True
    except Exception as e:
        import traceback
        logger.error(f"❌ Erro ao registrar dashboard: {e}\n{traceback.format_exc()}")
        app.config['DASHBOARD_CIENTIFICO_DISPONIVEL'] = False

    # SaaS (Monitoramento & Onboarding)
    try:
        from app.routes.saas import saas_bp
        app.register_blueprint(saas_bp, url_prefix="/api/saas")
        logger.info("✅ Blueprint saas registrado em /api/saas")
    except Exception as e:
        logger.error(f"❌ Erro ao registrar saas: {e}")

    # Despesas
    try:
        from app.routes.despesas import despesas_bp

        app.register_blueprint(despesas_bp, url_prefix="/api/despesas")
        logger.info("✅ Blueprint despesas registrado em /api/despesas")
    except Exception as e:
        logger.error(f"❌ Erro ao registrar despesas: {e}")

    # Relatórios
    try:
        from app.routes.relatorios import relatorios_bp

        app.register_blueprint(relatorios_bp, url_prefix="/api/relatorios")
        logger.info("✅ Blueprint relatorios registrado em /api/relatorios")
    except Exception as e:
        logger.error(f"❌ Erro ao registrar relatorios: {e}")

    # Sync (replicação local -> Neon)
    try:
        from app.routes.sync import sync_bp
        app.register_blueprint(sync_bp)
        logger.info("✅ Blueprint sync registrado (/api/sync/replicar)")
    except Exception as e:
        logger.error(f"❌ Erro ao registrar sync: {e}")

    # Ponto (controle de ponto)
    try:
        from app.routes.ponto import ponto_bp
        app.register_blueprint(ponto_bp, url_prefix="/api/ponto")
        logger.info("✅ Blueprint ponto registrado em /api/ponto")
    except Exception as e:
        logger.error(f"❌ Erro ao registrar ponto: {e}")

    # RH (Justificativas + Benefícios + Banco de Horas)
    try:
        from app.routes.rh import rh_bp
        app.register_blueprint(rh_bp, url_prefix="/api/rh")
        logger.info("✅ Blueprint rh registrado em /api/rh")
    except Exception as e:
        logger.error(f"❌ Erro ao registrar rh: {e}")

    # Pedidos de Compra
    try:
        from app.routes.pedidos_compra import pedidos_compra_bp
        app.register_blueprint(pedidos_compra_bp, url_prefix="/api")
        logger.info("✅ Blueprint pedidos_compra registrado em /api")
    except Exception as e:
        logger.error(f"❌ Erro ao registrar pedidos_compra: {e}")

    # Consultor IA
    try:
        from app.routes.consultor import consultor_bp
        app.register_blueprint(consultor_bp, url_prefix="/api/consultor")
        logger.info("✅ Blueprint consultor registrado em /api/consultor")
    except Exception as e:
        logger.error(f"❌ Erro ao registrar consultor: {e}")

    # Logística (App Entregador)
    try:
        from app.routes.logistica import logistica_bp
        app.register_blueprint(logistica_bp, url_prefix="/api/logistica")
        logger.info("✅ Blueprint logistica registrado em /api/logistica")
    except Exception as e:
        logger.error(f"❌ Erro ao registrar logistica: {e}")

    # LGPD (Anonimização e Exclusão de Dados)
    try:
        from app.routes.lgpd import lgpd_bp
        app.register_blueprint(lgpd_bp, url_prefix="/api/lgpd")
        logger.info("✅ Blueprint lgpd registrado em /api/lgpd")
    except Exception as e:
        logger.error(f"❌ Erro ao registrar lgpd: {e}")

    # Monitoramento Global (SaaS Monitor)
    try:
        from app.routes.monitor import monitor_bp
        app.register_blueprint(monitor_bp, url_prefix="/api/saas/monitor")
        logger.info("✅ Blueprint SaaS Monitor registrado em /api/saas/monitor")
    except Exception as e:
        logger.error(f"❌ Erro ao registrar monitor: {e}")

    # Dashboard do Product Owner (Super Admin): churn, MRR, auditoria, sync
    try:
        from app.routes.super_admin_dashboard import super_admin_dashboard_bp
        app.register_blueprint(super_admin_dashboard_bp, url_prefix="/api/super-admin")
        logger.info("✅ Blueprint Super Admin Dashboard registrado em /api/super-admin")
    except Exception as e:
        logger.error(f"❌ Erro ao registrar super_admin_dashboard: {e}")

    # Sincronização Híbrida
    try:
        from app.routes.sync_hybrid import sync_hybrid_bp
        app.register_blueprint(sync_hybrid_bp, url_prefix="/api/sync-hybrid")
        logger.info("✅ Blueprint Sincronização Híbrida registrado em /api/sync-hybrid")
        
        from app.routes.sync_cloud import sync_cloud_bp
        app.register_blueprint(sync_cloud_bp, url_prefix="/api/sync")
        logger.info("✅ Blueprint Cloud Sync (Receiver) registrado em /api/sync")
    except Exception as e:
        logger.error(f"❌ Erro ao registrar sync_hybrid ou sync_cloud: {e}")


    # Billing (Efí Bank)
    try:
        from app.routes.billing_routes import billing_bp
        app.register_blueprint(billing_bp)
        logger.info("✅ Blueprint Billing (Efí) registrado")
    except Exception as e:
        logger.error(f"❌ Erro ao registrar billing: {e}")

    # Delivery & Logística
    try:
        from app.routes.delivery import delivery_bp
        app.register_blueprint(delivery_bp, url_prefix="/api/delivery")
        logger.info("✅ Blueprint delivery registrado em /api/delivery")
    except Exception as e:
        logger.error(f"❌ Erro ao registrar delivery: {e}")

    # Onboarding SaaS
    try:
        from app.routes.onboarding import onboarding_bp
        app.register_blueprint(onboarding_bp, url_prefix="/api/onboarding")
        logger.info("✅ Blueprint SaaS Onboarding registrado em /api/onboarding")
    except Exception as e:
        logger.error(f"❌ Erro ao registrar onboarding: {e}")

    # SFA (Sales Force Automation)
    try:
        from app.routes.sfa import bp as sfa_bp
        app.register_blueprint(sfa_bp, url_prefix="/api")
        logger.info("✅ Blueprint SFA registrado em /api/sfa")
    except Exception as e:
        logger.error(f"❌ Erro ao registrar SFA: {e}")

    # Dashboard Científico já é tratado via dashboard_bp centralizado
    pass

    # ==================== ROTAS GLOBAIS ====================

    # Rota de saúde
    @app.route("/api/health", methods=["GET"])
    def health_check():
        from sqlalchemy import text
        try:
            import psutil
        except ModuleNotFoundError:
            psutil = None

        health = {
            "status": "healthy",
            "service": "mercadinhosys-api",
            "version": "2.0.0",
            "timestamp": get_manaus_time().isoformat(),
        }
        database_ok = True

        # Database Check
        try:
            db.session.execute(text("SELECT 1"))
            health["database"] = {"status": "connected"}
        except Exception as e:
            database_ok = False
            health["status"] = "unhealthy"
            health["database"] = {"status": "error"}

        # Cache Check
        try:
            cache.set("health_ping", 1, timeout=5)
            ping = cache.get("health_ping")
            health["cache"] = {
                "status": "alive" if ping == 1 else "fail"
            }
            if ping != 1 and health["status"] == "healthy":
                health["status"] = "degraded"
        except Exception as e:
            health["cache"] = {"status": "unreachable"}
            if health["status"] == "healthy":
                health["status"] = "degraded"

        # System Metrics
        try:
            health["system"] = {
                "cpu_percent": psutil.cpu_percent(),
                "memory_usage_mb": round(psutil.Process().memory_info().rss / (1024 * 1024), 2),
                "disk_usage_percent": psutil.disk_usage('/').percent
            }
        except:
            pass

        return jsonify(health), 200 if database_ok else 503

    @app.route("/api/ready", methods=["GET"])
    def readiness_check():
        from sqlalchemy import text

        readiness = {
            "status": "ready",
            "service": "mercadinhosys-api",
            "timestamp": get_manaus_time().isoformat(),
            "checks": {},
        }
        status_code = 200

        try:
            db.session.execute(text("SELECT 1"))
            readiness["checks"]["database"] = {"status": "ok"}
        except Exception as e:
            readiness["status"] = "not_ready"
            readiness["checks"]["database"] = {"status": "error"}
            status_code = 503

        try:
            cache.set("readiness_ping", "ok", timeout=5)
            readiness["checks"]["cache"] = {
                "status": "ok" if cache.get("readiness_ping") == "ok" else "fail"
            }
            if readiness["checks"]["cache"]["status"] != "ok":
                readiness["status"] = "not_ready"
                status_code = 503
        except Exception as e:
            readiness["status"] = "not_ready"
            readiness["checks"]["cache"] = {"status": "error"}
            status_code = 503

        return jsonify(readiness), status_code

    # Rota inicial
    @app.route("/", methods=["GET"])
    @app.route("/api", methods=["GET"])
    def index():
        return jsonify(
            {
                "message": "🚀 MercadinhoSys API - Sistema de Gestão para Mercados",
                "version": "2.0.0",
                "status": "operational",
                "endpoints": {
                    "auth": "/api/auth",
                    "produtos": "/api/produtos",
                    "vendas": "/api/vendas",
                    "dashboard": "/api/dashboard",
                    "pdv": "/api/pdv",
                    "relatorios": "/api/relatorios",
                    "cientifico": (
                        "/api/cientifico" if app.config.get('DASHBOARD_CIENTIFICO_DISPONIVEL') else None
                    ),
                },
                "health_check": "/api/health",
                "readiness_check": "/api/ready",
            }
        )

    # Erro de conexão com o banco (ex.: Neon pooler - remover statement_timeout em config)
    from sqlalchemy.exc import OperationalError
    @app.errorhandler(OperationalError)
    def handle_db_connection_error(exc):
        logger.error(f"[DB] Falha de conexão: {exc}")
        return (
            jsonify({
                "success": False,
                "error": "Banco de dados temporariamente indisponível",
                "message": "Verifique a configuração da conexão (Neon pooler não suporta statement_timeout).",
            }),
            503,
        )

    # Manipuladores de erro
    @app.errorhandler(404)
    def not_found(error):
        return (
            jsonify(
                {
                    "error": "Recurso não encontrado",
                    "message": "Consulte /api para ver endpoints disponíveis",
                }
            ),
            404,
        )

    @app.errorhandler(500)
    def internal_error(error):
        import traceback
        err_msg = str(error)
        tb = traceback.format_exc()
        logger.error(f"💥 [ERRO GRAVE 500]: {err_msg}\n{tb}")
        
        # Se for um erro do SQLAlchemy, o rollback é obrigatório para não travar a session
        try:
            db.session.rollback()
        except:
            pass

        return (
            jsonify(
                {
                    "success": False,
                    "error": "Erro interno no servidor",
                    "message": err_msg,
                    "code": "INTERNAL_SERVER_ERROR",
                    "timestamp": get_manaus_time().isoformat(),
                }
            ),
            500,
        )

    # ==================== ROTA PARA SERVIR UPLOADS ====================
    from flask import send_from_directory, abort

    @app.route("/uploads/<path:filename>")
    @app.route("/api/uploads/<path:filename>")
    def serve_uploads(filename):
        """Serve arquivos da pasta uploads (logos, etc)"""
        from pathlib import PurePosixPath
        if '\\' in filename or '..' in PurePosixPath(filename).parts:
            abort(404)
        # Documentos pessoais nunca são públicos. Logos legadas são públicas.
        prefix = filename.split('/', 1)[0]
        if prefix != 'logos':
            from flask_jwt_extended import verify_jwt_in_request, get_jwt_identity, get_jwt
            from app.models import Funcionario, Motorista, Veiculo, JustificativaPonto
            from app.decorators.rbac import nivel_do_role
            verify_jwt_in_request()
            try:
                actor = db.session.get(Funcionario, int(get_jwt_identity()))
            except (TypeError, ValueError):
                abort(401)
            if not actor or not actor.ativo or actor.deleted_at or (actor.status and actor.status.lower() != 'ativo'):
                abort(401)
            if not actor.is_super_admin and str(get_jwt().get('estabelecimento_id')) != str(actor.estabelecimento_id):
                abort(403)
            models = {'motoristas': (Motorista, 'cnh_documento_url'), 'veiculos': (Veiculo, 'crlv_documento_url'),
                      'justificativas': (JustificativaPonto, 'documento_url')}
            if prefix not in models:
                abort(404)
            if prefix in ('motoristas', 'veiculos') and not actor.is_super_admin and nivel_do_role(actor.role) not in (1, 2, 4, 5, 6):
                abort(403)
            model, column = models[prefix]
            query = db.session.query(model).filter(getattr(model, column) == f'/uploads/{filename}')
            if not actor.is_super_admin:
                query = query.filter(model.estabelecimento_id == actor.estabelecimento_id)
            document = query.first()
            if not document:
                abort(404)
            if prefix == 'justificativas' and not actor.is_super_admin and document.funcionario_id != actor.id and nivel_do_role(actor.role) not in (1, 2, 3):
                abort(403)
        # Tenta pegar do config
        upload_folder = app.config.get("UPLOAD_FOLDER")
        
        # Se não estiver no config ou for relativo, tenta resolver
        if not upload_folder:
            # Fallback para ../uploads relativo a app/
            # app.root_path é .../backend/app
            # Queremos .../backend/uploads
            upload_folder = os.path.join(os.path.dirname(app.root_path), "uploads")
        
        if not os.path.isabs(upload_folder):
            # Se for relativo (ex: 'uploads'), assume relativo ao root
            base = os.path.dirname(app.root_path)
            upload_folder = os.path.join(base, upload_folder)

        logger.info(f"Serving upload: '{filename}' from '{upload_folder}'")
        
        try:
            response = send_from_directory(upload_folder, filename)
            response.headers['Cache-Control'] = 'private, no-store'
            response.headers['X-Content-Type-Options'] = 'nosniff'
            response.headers['Content-Security-Policy'] = "sandbox"
            return response
        except Exception as e:
            logger.error(f"Erro ao servir arquivo {filename}: {e}")
            abort(404)

    # Log de inicialização — nunca logar a URI crua: ela carrega a senha do banco
    # em texto puro e este log roda em todo boot (fica em logs do Render/CI).
    _db_uri = app.config.get('SQLALCHEMY_DATABASE_URI', 'SQLite')
    _db_uri_masked = re.sub(r'://([^:/]+):([^@]+)@', r'://\1:****@', _db_uri)
    logger.info(
        f"""
    {'='*60}
    MercadinhoSys API v2.0.0 INICIALIZADA
    Ambiente: {config_name}
    Banco: {_db_uri_masked}
    Dashboard Cientifico: {'[OK] Disponivel' if app.config.get('DASHBOARD_CIENTIFICO_DISPONIVEL') else '[OFF] Nao disponivel'}
    {'='*60}
    """
    )

    # Configurar Listeners de Sincronia (Abordagem de Guerrilha)
    with app.app_context():
        try:
            from app.listeners import setup_listeners
            setup_listeners()
            
            # Iniciar Worker de Sincronia de Guerrilha (Em processo separado)
            if os.getenv("SYNC_ENABLED", "false").lower() == "true":
                from app.services.sync_worker import start_sync_worker
                start_sync_worker(app)

        except Exception as e:
            app.logger.error(f"Erro ao configurar listeners ou worker: {e}")

    # Agendador de push automático local -> Aiven (a cada 30 min)
    try:
        from app.services.cloud_push_scheduler import start_cloud_push_scheduler
        start_cloud_push_scheduler(app)
    except Exception as e:
        app.logger.error(f"Erro ao iniciar Cloud Push Scheduler: {e}")

    # ==================== CLI COMMANDS ====================
    # Registra comandos de gestão: flask push-to-aiven, flask sync-status
    try:
        from app.commands import register_commands
        register_commands(app)
        logger.info("✅ CLI commands registrados (flask push-to-aiven, flask sync-status)")
    except Exception as e:
        logger.error(f"❌ Erro ao registrar CLI commands: {e}")

    return app
