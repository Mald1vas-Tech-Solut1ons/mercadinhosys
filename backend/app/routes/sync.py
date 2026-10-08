from datetime import timezone
from flask import Blueprint, jsonify, request, current_app
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.exc import SQLAlchemyError
import os
from urllib.parse import urlparse
from datetime import datetime
import json
from flask_jwt_extended import get_jwt_identity, get_jwt
from app.decorators.decorator_jwt import gerente_ou_admin_required
from app.decorators.rbac import super_admin_required
from app.models import (
    db,
    Estabelecimento,
    Funcionario,
    Cliente,
    Fornecedor,
    CategoriaProduto,
    Produto,
    Venda,
    VendaItem,
    Pagamento,
    MovimentacaoEstoque,
    Despesa,
    SyncQueue,
)

sync_bp = Blueprint("sync", __name__)


def _resolve_remote_db_url():
    db_url = (
        os.environ.get("AIVEN_DATABASE_URL")
        or os.environ.get("DATABASE_URL_TARGET")
        or os.environ.get("DB_PRIMARY")
        or os.environ.get("DATABASE_URL")
        or os.environ.get("POSTGRES_URL")
    )
    if db_url and db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql://", 1)
    return db_url


def _clone_data(instance):
    data = {}
    for col in instance.__table__.columns:
        data[col.name] = getattr(instance, col.name)
    return data


def _upsert(session, model, data, pk_field="id"):
    pk_value = data.get(pk_field)
    if pk_value is None:
        return False
    obj = session.query(model).get(pk_value)
    if obj:
        for k, v in data.items():
            setattr(obj, k, v)
        return True
    else:
        session.add(model(**data))
        return False


@sync_bp.route("/api/sync/replicar", methods=["POST"])
@super_admin_required
def replicar_para_neon():
    """
    Sincroniza local -> Aiven usando o motor BULK (force_sync): execute_values
    em lotes de 1000 com upsert idempotente e guard de updated_at.
    Substitui o antigo upsert linha-a-linha que estourava timeout em bases grandes.
    """
    try:
        from app.utils.query_helpers import get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()

        db_url = _resolve_remote_db_url()
        if not db_url:
            return jsonify({"success": False, "message": "Banco cloud nao configurado"}), 400

        sync_log = SyncQueue(
            estabelecimento_id=estabelecimento_id or 0,
            tabela="sync_replicar",
            registro_id=0,
            operacao="replicar_para_neon",
            payload_json=json.dumps({"engine": "force_sync_bulk"}),
            status="sincronizando",
            created_at=datetime.now(timezone.utc),
        )
        db.session.add(sync_log)
        db.session.commit()

        try:
            from scripts.robust_sync import robust_sync
            resultado = robust_sync(silent=True)
        except Exception as e:
            sync_log.status = "erro"
            sync_log.mensagem_erro = str(e)[:2000]
            sync_log.synced_at = datetime.now(timezone.utc)
            db.session.commit()
            return jsonify({"success": False, "message": f"Erro ao replicar: {str(e)}"}), 500

        if not resultado.get("success"):
            sync_log.status = "erro"
            sync_log.mensagem_erro = str(resultado.get("erro", "falha"))[:2000]
            sync_log.synced_at = datetime.now(timezone.utc)
            db.session.commit()
            return jsonify({"success": False, "message": resultado.get("erro", "Falha na sincronização")}), 500

        sync_log.status = "sincronizado"
        sync_log.payload_json = json.dumps(resultado, ensure_ascii=False)
        sync_log.synced_at = datetime.now(timezone.utc)
        db.session.commit()
        return jsonify({
            "success": True,
            "message": f"{resultado.get('total_registros', 0)} registros sincronizados com o Aiven.",
            "total_registros": resultado.get("total_registros", 0),
            "sync_log_id": sync_log.id,
        }), 200

    except SQLAlchemyError as e:
        return jsonify({"success": False, "message": f"Erro SQLAlchemy: {str(e)}"}), 500
    except Exception as e:
        return jsonify({"success": False, "message": f"Erro ao replicar: {str(e)}"}), 500


@sync_bp.route("/api/sync/health", methods=["GET"])
@gerente_ou_admin_required
def sync_health():
    try:
        # ── Heartbeat do sync (sinal leve de "sync vivo / parado") ──
        from app.models import SyncHeartbeat
        from datetime import datetime as _dt
        interval = int(os.environ.get("SYNC_PUSH_INTERVAL_SEC", "300"))
        hb = None
        try:
            hb = SyncHeartbeat.query.get(1)
        except Exception:
            db.session.rollback()
        heartbeat = hb.to_dict() if hb else None
        idade_min = None
        sync_saudavel = False
        if hb and hb.last_run_at:
            idade = (_dt.utcnow() - hb.last_run_at).total_seconds()
            idade_min = round(idade / 60, 1)
            # saudável se o último ciclo foi OK e ocorreu há menos de ~3 intervalos
            sync_saudavel = (hb.status == "ok") and (idade < interval * 3 + 600)

        db_url = _resolve_remote_db_url() or current_app.config.get("SQLALCHEMY_DATABASE_URI") or ""
        local_counts = {}
        for model in [Estabelecimento, Funcionario, Cliente, Fornecedor, CategoriaProduto, Produto, Venda, VendaItem, Pagamento, MovimentacaoEstoque, Despesa]:
            try:
                local_counts[model.__tablename__] = db.session.query(model).count()
            except Exception:
                local_counts[model.__tablename__] = None
        neon_status = "desabilitado"
        remote_counts = None
        if db_url.startswith(("postgresql://", "postgres://")):
            try:
                engine = create_engine(db_url.replace("postgres://", "postgresql://", 1))
                with engine.connect() as conn:
                    conn.execute(text("SELECT 1"))
                neon_status = "online"
                remote_counts = {}
                with engine.connect() as conn:
                    for model in [Estabelecimento, Funcionario, Cliente, Fornecedor, CategoriaProduto, Produto, Venda, VendaItem, Pagamento, MovimentacaoEstoque, Despesa]:
                        try:
                            table = model.__tablename__
                            result = conn.execute(text(f'SELECT COUNT(*) AS c FROM "{table}"'))
                            count = result.scalar()
                            remote_counts[table] = int(count) if count is not None else 0
                        except Exception:
                            remote_counts[model.__tablename__] = None
            except Exception as e:
                neon_status = f"offline: {str(e)[:80]}"
        return jsonify({
            "success": True, "neon": neon_status,
            "sync_saudavel": sync_saudavel,
            "sync_idade_minutos": idade_min,
            "sync_heartbeat": heartbeat,
            "local_counts": local_counts, "remote_counts": remote_counts,
        }), 200
    except Exception as e:
        return jsonify({"success": False, "error": str(e)[:120]}), 500


@sync_bp.route("/api/sync/db-info", methods=["GET"])
@gerente_ou_admin_required
def db_info():
    try:
        uri = current_app.config.get("SQLALCHEMY_DATABASE_URI") or ""
        redacted_uri = uri
        if uri:
            try:
                parsed = urlparse(uri)
                if parsed.password:
                    username = parsed.username or ""
                    host = parsed.hostname or ""
                    port = f":{parsed.port}" if parsed.port else ""
                    auth = f"{username}:****@" if username else ""
                    redacted_uri = parsed._replace(netloc=f"{auth}{host}{port}").geturl()
            except Exception:
                redacted_uri = uri
        engine = db.engine
        engine_name = getattr(engine, "name", "unknown")
        is_sqlite = engine_name == "sqlite" or uri.startswith("sqlite://")
        file_exists = None
        file_path = None
        if is_sqlite:
            if uri.startswith("sqlite:///"):
                rel = uri.replace("sqlite:///", "", 1)
                file_path = os.path.abspath(os.path.join(os.getcwd(), rel))
                file_exists = os.path.exists(file_path)
        db_source = None
        for key in ["AIVEN_DATABASE_URL", "NEON_DATABASE_URL", "DATABASE_URL_TARGET", "DB_PRIMARY", "DATABASE_URL", "POSTGRES_URL"]:
            if os.environ.get(key):
                db_source = key
                break
        return jsonify({
            "success": True,
            "uri": redacted_uri,
            "engine": engine_name,
            "sqlite_file_path": file_path,
            "sqlite_file_exists": file_exists,
            "db_source": db_source,
        }), 200
    except Exception as e:
        return jsonify({"success": False, "error": str(e)[:120]}), 500
