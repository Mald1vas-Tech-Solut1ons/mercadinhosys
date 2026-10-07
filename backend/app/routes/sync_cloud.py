from datetime import timezone
"""
MercadinhoSys - Cloud Sync Receiver
API para receber dados sincronizados dos clientes locais
Roda apenas no modo cloud (Vercel/Aiven) ou como receptor híbrido
"""

from flask import Blueprint, request, jsonify, current_app
import json
import logging
import os
import secrets
from datetime import datetime
from typing import Dict, Any, List

from app import db

sync_cloud_bp = Blueprint("sync_cloud", __name__)
logger = logging.getLogger(__name__)

# LÓGICA DE ELITE: Desacoplamento de Persistência Híbrida (Singleton Engine)
_cloud_engine = None
_CloudSession = None

def _get_cloud_session():
    """Retorna uma sessão vinculada diretamente à Aiven se disponível"""
    global _cloud_engine, _CloudSession
    cloud_url = os.environ.get("AIVEN_DATABASE_URL")
    
    if not cloud_url:
        return None
        
    if not _cloud_engine:
        if cloud_url.startswith("postgres://"):
            cloud_url = cloud_url.replace("postgres://", "postgresql://", 1)
        
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        
        # OTIMIZAÇÃO: Connection Pooling para evitar erro de conexões esgotadas na Aiven
        _cloud_engine = create_engine(
            cloud_url, 
            pool_size=5, 
            max_overflow=0, 
            pool_pre_ping=True,
            pool_recycle=1800
        )
        _CloudSession = sessionmaker(bind=_cloud_engine)
        logger.info("📡 Motor de Sincronia: Engine Global AIVEN inicializada")
        
    return _CloudSession()

@sync_cloud_bp.route("/receive", methods=["POST"])
def receber_sincronia():
    """Endpoint receptor para dados vindos do Gêmeo Digital (SQLite)"""
    session = None
    try:
        # 1. Autenticação via Token Estático (Sync Token)
        authorization = request.headers.get("Authorization", "")
        expected_token = current_app.config.get("CLOUD_SYNC_TOKEN")
        sync_token = authorization[7:] if authorization.startswith("Bearer ") else ""
        if not expected_token or not sync_token or not secrets.compare_digest(sync_token.encode(), expected_token.encode()):
            logger.warning("🚫 Tentativa de sincronia com token inválido")
            return jsonify({"success": False, "error": "Não autorizado"}), 401
            
        # 2. Obter payload
        data = request.get_json()
        if not data:
            return jsonify({"success": False, "error": "Payload inválido"}), 400
            
        # 3. Tentar obter sessão dedicada Aiven (Fix Connection Exhaustion)
        session = _get_cloud_session()
        if not session:
            session = db.session
            logger.warning(f"⚠️ Usando DB local: AIVEN_DATABASE_URL não definida")
        else:
            logger.info(f"💾 Receptor Híbrido: Persistindo na AIVEN")
            
        # 4. Processar sincronização
        success = _process_sync_data(data, session)
        
        if success:
            # Commit explícito se for sessão dedicada (evitar fechar db.session global)
            if _cloud_engine and session is not db.session:
                session.commit()
                session.close()
            elif session is db.session:
                session.commit()
            
            return jsonify({
                "success": True,
                "message": "Dados sincronizados com sucesso",
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
        else:
            if os.environ.get("AIVEN_DATABASE_URL"):
                session.rollback()
                session.close()
            return jsonify({"success": False, "error": "Falha no processamento"}), 500
            
    except Exception as e:
        if session and os.environ.get("AIVEN_DATABASE_URL"):
            session.rollback()
            session.close()
        logger.error(f"💥 Erro fatal no recebimento: {e}")
        return jsonify({"success": False, "error": str(e)}), 500

def _process_sync_data(data: Dict[str, Any], session) -> bool:
    """Upsert atômico de dados sincronizados no destino correto"""
    try:
        tabela = data["tabela"]
        operacao = str(data["operacao"]).upper()
        payload = data.get("payload")
        if payload is None and data.get("payload_json"):
            try:
                payload = json.loads(data["payload_json"])
            except Exception:
                payload = {}
        if payload is None:
            payload = {}
        registro_id = data.get("registro_id")
        
        # OTIMIZAÇÃO: Importação direta e segura
        from app.models import get_model_by_table
        model_class = get_model_by_table(tabela)
        
        if not model_class:
            logger.error(f"❌ Modelo não mapeado: {tabela}")
            return False

        if operacao == "DELETE":
            registro = session.query(model_class).get(registro_id)
            if registro:
                session.delete(registro)
        
        elif operacao in ["INSERT", "UPDATE"]:
            # Fazer upsert preservando ID original
            from sqlalchemy import inspect
            mapper = inspect(model_class)
            columns = [c.key for c in mapper.column_attrs]
            
            # Verificar se já existe (Upsert)
            registro = session.query(model_class).get(registro_id)
            
            if registro:
                # UPDATE
                for key, value in payload.items():
                    if key in columns and key != 'id':
                        # Tratar datas
                        if (key.endswith("_at") or "data_" in key) and isinstance(value, str):
                            try:
                                from datetime import datetime
                                setattr(registro, key, datetime.fromisoformat(value.replace("Z", "+00:00")))
                            except:
                                setattr(registro, key, value)
                        else:
                            setattr(registro, key, value)
            else:
                # INSERT
                novo_registro = model_class()
                setattr(novo_registro, 'id', registro_id)
                for key, value in payload.items():
                    if key in columns and key != 'id':
                         # Tratar datas
                        if (key.endswith("_at") or "data_" in key) and isinstance(value, str):
                            try:
                                from datetime import datetime
                                setattr(novo_registro, key, datetime.fromisoformat(value.replace("Z", "+00:00")))
                            except:
                                setattr(novo_registro, key, value)
                        else:
                            setattr(novo_registro, key, value)
                session.add(novo_registro)
                
        return True
    except Exception as e:
        logger.error(f"❌ Erro no processamento de {data.get('tabela')}: {e}")
        return False
