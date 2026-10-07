from datetime import timezone
"""
Sistema Híbrido - Sincronização Local ↔ Cloud
Utiliza modelos SQLAlchemy para garantir integridade dos dados.
"""

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt
from app.decorators.rbac import super_admin_required
from pathlib import Path
import json
import os
from datetime import datetime
import logging
from app import db
from app.models import (
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

sync_hybrid_bp = Blueprint('sync_hybrid', __name__)
logger = logging.getLogger(__name__)

MODELS = [
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
]

def export_model_data(model):
    """Exporta dados de um modelo para formato JSON serializável."""
    rows = model.query.all()
    data = []
    for obj in rows:
        item = {}
        for col in obj.__table__.columns:
            value = getattr(obj, col.name)
            if isinstance(value, datetime):
                value = value.isoformat()
            elif isinstance(value, (int, float, str, bool, type(None))):
                value = value
            else:
                value = str(value)
            item[col.name] = value
        data.append(item)
    return data

@sync_hybrid_bp.route('/export', methods=['GET'])
@super_admin_required
def export_all():
    """Exporta todos os dados locais em JSON."""
    try:
        export_data = {}
        for model in MODELS:
            export_data[model.__tablename__] = export_model_data(model)
        
        return jsonify({
            'success': True,
            'data': export_data,
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'tables': len(export_data)
        })
    except Exception as e:
        logger.error(f"Erro na exportação: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@sync_hybrid_bp.route('/status', methods=['GET'])
@super_admin_required
def sync_status():
    """Status da sincronização híbrida."""
    try:
        local_counts = {}
        for model in MODELS:
            local_counts[model.__tablename__] = model.query.count()
        
        # Contagem de itens na fila de sincronização
        pending = SyncQueue.query.filter_by(status='pendente').count()
        synced = SyncQueue.query.filter_by(status='sincronizado').count()
        error = SyncQueue.query.filter_by(status='erro').count()
        
        return jsonify({
            'success': True,
            'local_counts': local_counts,
            'sync_queue': {
                'pending': pending,
                'synced': synced,
                'error': error
            },
            'cloud_url': os.getenv('CLOUD_API_URL', 'Não configurada')
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@sync_hybrid_bp.route('/upload', methods=['POST'])
@super_admin_required
def sync_upload():
    """Sincroniza dados locais para a nuvem via API."""
    try:
        claims = get_jwt()
        estabelecimento_id = claims.get('estabelecimento_id')
        
        # Exportar dados
        export_data = {}
        for model in MODELS:
            export_data[model.__tablename__] = export_model_data(model)
        
        # Registrar operação na SyncQueue
        sync_entry = SyncQueue(
            estabelecimento_id=estabelecimento_id,
            tabela='sync_hybrid_upload',
            registro_id=0,
            operacao='upload',
            payload_json=json.dumps({'tables': list(export_data.keys())}),
            status='pendente',
            created_at=datetime.now(timezone.utc)
        )
        db.session.add(sync_entry)
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Dados preparados para upload. Worker processará em breve.',
            'sync_entry_id': sync_entry.id,
            'tables_exported': len(export_data)
        })
    except Exception as e:
        logger.error(f"Erro no upload: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@sync_hybrid_bp.route('/download', methods=['POST'])
@jwt_required()
def sync_download():
    """Recebe dados da nuvem e importa para o banco local."""
    try:
        data = request.get_json()
        if not data or 'data' not in data:
            return jsonify({'success': False, 'error': 'Payload inválido'}), 400
        
        imported = {}
        for table_name, rows in data['data'].items():
            model = next((m for m in MODELS if m.__tablename__ == table_name), None)
            if not model:
                continue
            
            count = 0
            for row in rows:
                # Remove id para evitar conflito (SQLite autoincrement)
                row.pop('id', None)
                obj = model(**row)
                db.session.add(obj)
                count += 1
            imported[table_name] = count
        
        db.session.commit()
        return jsonify({
            'success': True,
            'imported': imported,
            'message': 'Dados importados com sucesso'
        })
    except Exception as e:
        db.session.rollback()
        logger.error(f"Erro no download: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@sync_hybrid_bp.route('/backup', methods=['POST'])
@super_admin_required
def create_backup():
    """Cria um backup local dos dados em JSON."""
    try:
        export_data = {}
        for model in MODELS:
            export_data[model.__tablename__] = export_model_data(model)
        
        timestamp = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')
        filename = f"backup_{timestamp}.json"
        
        # Salvar localmente (opcional)
        backup_path = os.path.join('/app/backups', filename)
        os.makedirs('/app/backups', exist_ok=True)
        with open(backup_path, 'w', encoding='utf-8') as f:
            json.dump(export_data, f, ensure_ascii=False, indent=2)
        
        return jsonify({
            'success': True,
            'filename': filename,
            'tables': len(export_data),
            'path': backup_path
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@sync_hybrid_bp.route('/restore', methods=['POST'])
@super_admin_required
def restore_backup():
    """Restaura dados a partir de um arquivo de backup JSON."""
    try:
        data = request.get_json() or {}
        filename = data.get('filename')
        if not filename:
            return jsonify({'success': False, 'error': 'Nome do arquivo não fornecido'}), 400
        
        backup_root = Path('/app/backups').resolve()
        if not isinstance(filename, str) or '/' in filename or '\\' in filename:
            return jsonify({'success': False, 'error': 'Nome de arquivo inválido'}), 400
        backup_path = (backup_root / filename).resolve()
        if backup_path.parent != backup_root or backup_path.suffix != '.json':
            return jsonify({'success': False, 'error': 'Nome de arquivo inválido'}), 400
        if not os.path.exists(backup_path):
            return jsonify({'success': False, 'error': 'Arquivo de backup não encontrado'}), 404
        
        with open(backup_path, 'r', encoding='utf-8') as f:
            backup_data = json.load(f)
        
        restored = {}
        for table_name, rows in backup_data.items():
            model = next((m for m in MODELS if m.__tablename__ == table_name), None)
            if not model:
                continue
            
            count = 0
            for row in rows:
                row.pop('id', None)
                obj = model(**row)
                db.session.add(obj)
                count += 1
            restored[table_name] = count
        
        db.session.commit()
        return jsonify({
            'success': True,
            'restored': restored,
            'message': 'Backup restaurado com sucesso'
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500
