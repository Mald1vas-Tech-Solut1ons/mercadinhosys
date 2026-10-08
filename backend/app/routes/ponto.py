from datetime import timezone
"""
Rotas para Sistema de Controle de Ponto
"""

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.models import db, RegistroPonto, ConfiguracaoHorario, Funcionario, Estabelecimento, Auditoria
from datetime import datetime, date, time, timedelta
from sqlalchemy import func, and_, or_
from app.decorators.plan_guards import plan_required, permission_required
import base64
import os
from werkzeug.utils import secure_filename
import logging
from functools import lru_cache
import math

logger = logging.getLogger(__name__)
ponto_bp = Blueprint('ponto', __name__)

# Cache de configurações do ponto.
# IMPORTANTE: guardamos apenas o ID (PK), NUNCA a instância ORM. Cachear a
# instância entre requests causava DetachedInstanceError ("not bound to a
# Session") quando outra request acessava seus atributos após a sessão original
# ter sido fechada. Com o ID, o obter_configuracao_com_cache re-liga o objeto à
# sessão ativa via db.session.get().
_config_id_cache = {}
_config_cache_time = {}
CACHE_TIMEOUT = 3600  # 1 hora


def get_funcionario_logado():
    """Obtém o funcionário logado"""
    user_id = get_jwt_identity()
    if isinstance(user_id, str):
        user_id = int(user_id)
    return Funcionario.query.get(user_id)


def pode_ver_tudo_ponto(funcionario):
    """Regra de Acesso: só Admin (1), Gerente (2) e RH (3) veem os registros
    de TODOS os funcionários; os demais níveis veem apenas os próprios."""
    from app.decorators.rbac import _get_nivel
    return _get_nivel(funcionario) <= 3


def eh_admin_loja(funcionario):
    """Admin da loja (nível 1) ou super admin (nível 0)."""
    from app.decorators.rbac import _get_nivel
    return _get_nivel(funcionario) <= 1


def pode_configurar_ponto(funcionario):
    """Configurar horários/jornada do ponto: Admin (1) e Gerente (2).
    (A aba Ponto & RH das Configurações fica visível para o Gerente.)"""
    from app.decorators.rbac import _get_nivel
    return _get_nivel(funcionario) <= 2


def calcular_minutos_atraso(hora_registro, hora_esperada, tolerancia):
    """Calcula minutos de atraso considerando tolerância"""
    if not hora_registro or not hora_esperada:
        return 0
    
    # Converter para datetime para facilitar cálculo
    hoje = date.today()
    dt_registro = datetime.combine(hoje, hora_registro)
    dt_esperada = datetime.combine(hoje, hora_esperada)
    dt_tolerancia = dt_esperada + timedelta(minutes=tolerancia)
    
    if dt_registro > dt_tolerancia:
        diferenca = dt_registro - dt_esperada
        return int(diferenca.total_seconds() / 60)
    return 0


# Fuso horário padrão (Brasília, UTC-3). O servidor roda em UTC; sem isso a hora do
# ponto ficaria adiantada (ex.: 12:09 BRT seria gravada como 15:09 UTC).
TZ_BRASILIA = timezone(timedelta(hours=-3))


def _agora_brasil():
    """datetime atual (naive) no fuso de Brasília — fallback quando o app não envia a hora local."""
    return datetime.now(timezone.utc).astimezone(TZ_BRASILIA).replace(tzinfo=None)


def _resolver_datahora_local(payload):
    """Resolve a data/hora do registro priorizando o relógio LOCAL do dispositivo (multi-fuso).

    Aceita 'data_local' (YYYY-MM-DD) + 'hora_local' (HH:MM[:SS]) — a hora de parede do aparelho,
    correta em qualquer fuso — ou, em segundo plano, 'timestamp_local' (ISO 8601).
    Fallback: horário de Brasília (UTC-3)."""
    try:
        d = payload.get('data_local')
        h = payload.get('hora_local')
        if d and h:
            fmt = '%H:%M:%S' if h.count(':') >= 2 else '%H:%M'
            return datetime.combine(
                datetime.strptime(d, '%Y-%m-%d').date(),
                datetime.strptime(h[:8], fmt).time()
            )
        ts = payload.get('timestamp_local')
        if ts:
            dt = datetime.fromisoformat(ts.replace('Z', '+00:00'))
            if dt.tzinfo:
                dt = dt.astimezone(TZ_BRASILIA).replace(tzinfo=None)
            return dt
    except (ValueError, TypeError) as e:
        logger.warning(f"data/hora local inválida no registro de ponto: {e}")
    return _agora_brasil()


def salvar_foto_base64(foto_base64, funcionario_id):
    """Salva foto em base64 e retorna o caminho"""
    try:
        if not foto_base64:
            logger.warning("Foto vazia recebida")
            return None
        
        # Verificar se é base64 com data URL
        if not foto_base64.startswith('data:image'):
            logger.error(f"Foto não é data URL válida. Começa com: {foto_base64[:50]}")
            return None

        # 1) PERSISTENTE: Cloudinary (se configurado). O disco do Render é EFÊMERO —
        # fotos salvas localmente somem a cada deploy. Com CLOUDINARY_URL no ambiente,
        # subimos para a nuvem e devolvemos uma URL permanente (CDN).
        if os.getenv("CLOUDINARY_URL"):
            try:
                import cloudinary.uploader  # o SDK lê CLOUDINARY_URL do ambiente
                result = cloudinary.uploader.upload(
                    foto_base64,
                    folder="mercadinhosys/pontos",
                    public_id=f"ponto_{funcionario_id}_{_agora_brasil().strftime('%Y%m%d_%H%M%S')}",
                    resource_type="image",
                )
                url = result.get("secure_url")
                if url:
                    return url
                logger.warning("Cloudinary não retornou secure_url; usando disco local.")
            except Exception as cloud_err:
                logger.error(f"Upload Cloudinary falhou (fallback p/ disco): {cloud_err}")

        # 2) FALLBACK: disco local (ok no dev; em produção SEM Cloudinary a imagem
        # some no próximo deploy do Render).
        # Extrair dados da imagem
        header, encoded = foto_base64.split(',', 1)
        ext = header.split('/')[1].split(';')[0]
        
        # Criar nome do arquivo (timestamp no fuso local, p/ casar com a hora do registro)
        timestamp = _agora_brasil().strftime('%Y%m%d_%H%M%S')
        filename = f"ponto_{funcionario_id}_{timestamp}.{ext}"
        
        # Criar diretório se não existir
        upload_dir = os.path.join('uploads', 'pontos')
        os.makedirs(upload_dir, exist_ok=True)
        
        # Salvar arquivo
        filepath = os.path.join(upload_dir, filename)
        with open(filepath, 'wb') as f:
            f.write(base64.b64decode(encoded))
        
        return f"/uploads/pontos/{filename}"
    except Exception as e:
        logger.error(f"Erro ao salvar foto: {e}")
        return None


def calcular_distancia_haversine(lat1, lon1, lat2, lon2):
    """Calcula distância entre dois pontos usando Haversine (em metros)"""
    try:
        R = 6371000  # Raio da Terra em metros
        
        dLat = math.radians(lat2 - lat1)
        dLon = math.radians(lon2 - lon1)
        
        a = math.sin(dLat / 2) * math.sin(dLat / 2) + \
            math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * \
            math.sin(dLon / 2) * math.sin(dLon / 2)
        
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        
        return R * c  # Distância em metros
    except Exception as e:
        logger.error(f"Erro ao calcular distância: {e}")
        return None


def obter_configuracao_com_cache(estabelecimento_id):
    """Obtém configuração com cache (salva ID, não instância ORM)."""
    cache_key = f"config_{estabelecimento_id}"
    now = datetime.now().timestamp()

    config_id = _config_id_cache.get(cache_key)
    if config_id and (now - _config_cache_time.get(cache_key, 0)) < CACHE_TIMEOUT:
        # Rebind seguro: busca pelo PK na sessão ativa
        return db.session.get(ConfiguracaoHorario, config_id)

    # Cache miss ou expirado: busca completa
    config = ConfiguracaoHorario.query.filter_by(
        estabelecimento_id=estabelecimento_id
    ).first()

    if config:
        _config_id_cache[cache_key] = config.id
        _config_cache_time[cache_key] = now

    return config


@ponto_bp.route('/registrar', methods=['POST'])
@jwt_required()
@permission_required('ponto')
def registrar_ponto():
    """Registra um ponto do funcionário"""
    try:
        funcionario = get_funcionario_logado()
        if not funcionario:
            return jsonify({'success': False, 'message': 'Funcionário não encontrado'}), 404
        
        data = request.get_json()
        tipo_registro = data.get('tipo_registro')
        
        # DEBUG: Log completo do que foi recebido
        logger.info(f"🔍 RECEBIDO NA API PONTO:")
        logger.info(f"   Funcionário: {funcionario.id} - {funcionario.nome}")
        logger.info(f"   Tipo: {tipo_registro}")
        logger.info(f"   Tem foto: {bool(data.get('foto'))}")
        if data.get('foto'):
            foto_str = data.get('foto')
            logger.info(f"   Tamanho foto: {len(foto_str)} caracteres")
            logger.info(f"   Começa com: {foto_str[:80]}")
        logger.info(f"   Latitude: {data.get('latitude')}")
        logger.info(f"   Longitude: {data.get('longitude')}")
        
        if tipo_registro not in ['entrada', 'saida_almoco', 'retorno_almoco', 'saida']:
            return jsonify({'success': False, 'message': 'Tipo de registro inválido'}), 400

        # Data/hora do registro: usar o relógio LOCAL do dispositivo (multi-fuso).
        # Sem isso, o servidor (UTC) gravaria a hora adiantada.
        agora_local = _resolver_datahora_local(data)
        hoje = agora_local.date()

        # Verificar se já existe registro do mesmo tipo hoje
        registro_existente = RegistroPonto.query.filter_by(
            funcionario_id=funcionario.id,
            data=hoje,
            tipo_registro=tipo_registro
        ).first()
        
        if registro_existente:
            return jsonify({
                'success': False,
                'message': f'Você já registrou {tipo_registro.replace("_", " ")} hoje às {registro_existente.hora.strftime("%H:%M")}'
            }), 400
        
        # Obter configuração de horário
        config = obter_configuracao_com_cache(funcionario.estabelecimento_id)
        
        # Validar se foto é obrigatória
        if config and config.exigir_foto and not data.get('foto'):
            return jsonify({
                'success': False,
                'message': 'Foto é obrigatória para este estabelecimento'
            }), 400
        
        # Validar se localização é obrigatória
        if config and config.exigir_localizacao:
            if not data.get('latitude') or not data.get('longitude'):
                return jsonify({
                    'success': False,
                    'message': 'Localização é obrigatória para este estabelecimento'
                }), 400
            
            # Validar raio permitido
            # Usar coordenadas do estabelecimento (se disponíveis)
            # Por enquanto, apenas registrar a localização
            # TODO: Adicionar coordenadas ao estabelecimento para validar raio
        
        # Hora atual (relógio local do dispositivo — resolvido acima)
        hora_atual = agora_local.time()
        
        # Calcular atraso
        minutos_atraso = 0
        status = 'normal'
        
        if config:
            if tipo_registro == 'entrada':
                minutos_atraso = calcular_minutos_atraso(
                    hora_atual, config.hora_entrada, config.tolerancia_entrada
                )
            elif tipo_registro == 'saida_almoco':
                minutos_atraso = calcular_minutos_atraso(
                    hora_atual, config.hora_saida_almoco, config.tolerancia_saida_almoco
                )
            elif tipo_registro == 'retorno_almoco':
                minutos_atraso = calcular_minutos_atraso(
                    hora_atual, config.hora_retorno_almoco, config.tolerancia_retorno_almoco
                )
            elif tipo_registro == 'saida':
                # Para saída, não há atraso (pode sair mais tarde)
                minutos_atraso = 0
        
        if minutos_atraso > 0:
            status = 'atrasado'
        
        # Salvar foto se fornecida
        foto_url = None
        if data.get('foto'):
            logger.info(f"📸 Salvando foto para funcionário {funcionario.id}")
            foto_url = salvar_foto_base64(data.get('foto'), funcionario.id)
            logger.info(f"📸 Foto salva: {foto_url}")
        
        # Criar registro
        registro = RegistroPonto(
            funcionario_id=funcionario.id,
            estabelecimento_id=funcionario.estabelecimento_id,
            data=hoje,
            hora=hora_atual,
            tipo_registro=tipo_registro,
            latitude=data.get('latitude'),
            longitude=data.get('longitude'),
            localizacao_endereco=data.get('localizacao_endereco'),
            foto_url=foto_url,
            dispositivo=data.get('dispositivo'),
            ip_address=request.remote_addr,
            observacao=data.get('observacao'),
            status=status,
            minutos_atraso=minutos_atraso
        )
        
        db.session.add(registro)
        db.session.commit()
        
        # Auditoria SaaS
        try:
            Auditoria.registrar(
                estabelecimento_id=funcionario.estabelecimento_id,
                usuario_id=funcionario.id,
                tipo_evento='Bateu Ponto',
                descricao=f"Funcionário {funcionario.nome} bateu ponto ({tipo_registro}) às {hora_atual.strftime('%H:%M')}."
            )
        except Exception as e_auditoria:
            logger.error(f"Erro ao registrar auditoria de ponto: {e_auditoria}")

        
        return jsonify({
            'success': True,
            'message': f'Ponto de {tipo_registro.replace("_", " ")} registrado com sucesso!',
            'data': registro.to_dict()
        }), 201
        
    except Exception as e:
        logger.error(f"Erro ao registrar ponto: {e}")
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


@ponto_bp.route('/hoje', methods=['GET'])
@jwt_required()
@permission_required('ponto')
def pontos_hoje():
    """Retorna os pontos do funcionário logado hoje"""
    try:
        funcionario = get_funcionario_logado()
        if not funcionario:
            return jsonify({'success': False, 'message': 'Funcionário não encontrado'}), 404
        
        hoje = _agora_brasil().date()
        registros = RegistroPonto.query.filter_by(
            funcionario_id=funcionario.id,
            data=hoje
        ).order_by(RegistroPonto.hora).all()
        
        # Obter configuração
        config = None
        try:
            config = ConfiguracaoHorario.query.filter_by(
                estabelecimento_id=funcionario.estabelecimento_id
            ).first()
        except Exception as e:
            logger.error(f"Erro ao buscar configuração: {e}")
        
        # Serializar registros com tratamento de erro
        registros_dict = []
        for r in registros:
            try:
                registros_dict.append(r.to_dict())
            except Exception as e:
                logger.error(f"Erro ao serializar registro {r.id}: {e}")
                registros_dict.append({
                    'id': r.id,
                    'funcionario_id': r.funcionario_id,
                    'data': r.data.isoformat() if r.data else None,
                    'hora': r.hora.strftime('%H:%M:%S') if r.hora else None,
                    'tipo_registro': r.tipo_registro
                })
        
        # Tentar serializar configuração
        config_dict = None
        if config:
            try:
                config_dict = config.to_dict()
            except Exception as e:
                logger.error(f"Erro ao serializar configuração: {e}")
                config_dict = {
                    'id': config.id,
                    'estabelecimento_id': config.estabelecimento_id,
                    'error': 'Erro ao serializar configuração'
                }
        
        return jsonify({
            'success': True,
            'data': {
                'registros': registros_dict,
                'configuracao': config_dict
            }
        }), 200
        
    except Exception as e:
        logger.error(f"Erro ao buscar pontos de hoje: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False, 
            'message': str(e),
            'error_type': type(e).__name__
        }), 500


@ponto_bp.route('/historico', methods=['GET'])
@jwt_required()
@permission_required('ponto')
def historico_pontos():
    """Retorna histórico de pontos do funcionário"""
    try:
        current_user = get_funcionario_logado()
        if not current_user:
            return jsonify({'success': False, 'message': 'Funcionário não encontrado'}), 404
        
        # Parâmetros de filtro
        data_inicio = request.args.get('data_inicio')
        data_fim = request.args.get('data_fim')
        page = int(request.args.get('page', 1))
        per_page = int(request.args.get('per_page', 30))
        target_funcionario_id = request.args.get('funcionario_id')

        # Admin/Gerente/RH veem tudo; os demais só os próprios registros
        if pode_ver_tudo_ponto(current_user):
            if target_funcionario_id:
                # Vendo funcionário específico
                query = RegistroPonto.query.filter_by(funcionario_id=int(target_funcionario_id))
            else:
                # Visão Geral (todos)
                query = RegistroPonto.query
        else:
            # Padrão: ver os próprios pontos
            query = RegistroPonto.query.filter_by(funcionario_id=current_user.id)
        
        if data_inicio:
            query = query.filter(RegistroPonto.data >= datetime.strptime(data_inicio, '%Y-%m-%d').date())
        if data_fim:
            query = query.filter(RegistroPonto.data <= datetime.strptime(data_fim, '%Y-%m-%d').date())
        
        query = query.order_by(RegistroPonto.data.desc(), RegistroPonto.hora.desc())
        
        pagination = query.paginate(page=page, per_page=per_page, error_out=False)
        
        # Serializar registros com tratamento de erro
        registros_dict = []
        for r in pagination.items:
            try:
                registros_dict.append(r.to_dict())
            except Exception as e:
                logger.error(f"Erro ao serializar registro {r.id}: {e}")
                registros_dict.append({
                    'id': r.id,
                    'error': 'Erro ao serializar registro'
                })
        
        return jsonify({
            'success': True,
            'data': {
                'registros': registros_dict,
                'total': pagination.total,
                'pages': pagination.pages,
                'current_page': page
            }
        }), 200
        
    except Exception as e:
        logger.error(f"Erro ao buscar histórico: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'message': str(e)}), 500


@ponto_bp.route('/admin/todos', methods=['GET'])
@jwt_required()
@permission_required('ponto')
def admin_todos_pontos():
    """
    Retorna histórico de TODOS os funcionários (Apenas Admin/Gerente)
    Permite filtrar por data, funcionário, etc.
    """
    try:
        current_user = get_funcionario_logado()
        if not current_user or not pode_ver_tudo_ponto(current_user):
            return jsonify({'success': False, 'message': 'Acesso não autorizado'}), 403
            
        # Parâmetros
        data_inicio = request.args.get('data_inicio')
        data_fim = request.args.get('data_fim')
        funcionario_id = request.args.get('funcionario_id')
        page = int(request.args.get('page', 1))
        per_page = int(request.args.get('per_page', 50))
        
        query = RegistroPonto.query
        
        if funcionario_id:
            query = query.filter(RegistroPonto.funcionario_id == int(funcionario_id))
            
        if data_inicio:
            query = query.filter(RegistroPonto.data >= datetime.strptime(data_inicio, '%Y-%m-%d').date())
        if data_fim:
            query = query.filter(RegistroPonto.data <= datetime.strptime(data_fim, '%Y-%m-%d').date())
            
        # Join com Funcionario para ordenar por nome e data
        query = query.join(Funcionario).order_by(RegistroPonto.data.desc(), Funcionario.nome.asc(), RegistroPonto.hora.asc())
        
        pagination = query.paginate(page=page, per_page=per_page, error_out=False)
        
        registros_dict = []
        for r in pagination.items:
            data = r.to_dict()
            # Adicionar info extra do funcionário se não vier no to_dict
            if not data.get('funcionario_nome'):
                data['funcionario_nome'] = r.funcionario.nome if r.funcionario else 'N/A'
            registros_dict.append(data)
            
        return jsonify({
            'success': True,
            'data': {
                'registros': registros_dict,
                'total': pagination.total,
                'pages': pagination.pages,
                'current_page': page
            }
        }), 200
    except Exception as e:
        logger.error(f"Erro ao buscar histórico admin: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500


@ponto_bp.route('/estatisticas', methods=['GET'])
@jwt_required()
@permission_required('ponto')
def estatisticas_ponto():
    """Retorna estatísticas de frequência do funcionário"""
    try:
        funcionario = get_funcionario_logado()
        if not funcionario:
            return jsonify({'success': False, 'message': 'Funcionário não encontrado'}), 404
        
        # Últimos 30 dias
        data_inicio = date.today() - timedelta(days=30)
        
        try:
            registros = RegistroPonto.query.filter(
                and_(
                    RegistroPonto.funcionario_id == funcionario.id,
                    RegistroPonto.data >= data_inicio
                )
            ).all()
        except Exception as e:
            logger.error(f"Erro ao buscar registros de ponto: {e}")
            return jsonify({
                'success': True,
                'data': {
                    'dias_trabalhados': 0,
                    'total_atrasos': 0,
                    'minutos_atraso_total': 0,
                    'frequencia_tipo': {'entrada': 0, 'saida_almoco': 0, 'retorno_almoco': 0, 'saida': 0},
                    'grafico_frequencia': [],
                    'taxa_presenca': 0
                }
            }), 200
        
        # Agrupar por data
        registros_por_dia = {}
        for r in registros:
            try:
                data_str = r.data.isoformat() if r.data else None
                if data_str and data_str not in registros_por_dia:
                    registros_por_dia[data_str] = []
                if data_str:
                    registros_por_dia[data_str].append(r)
            except Exception as e:
                logger.error(f"Erro ao processar registro {r.id}: {e}")
                continue
        
        # Calcular estatísticas com tratamento de erro
        dias_trabalhados = len(registros_por_dia)
        total_atrasos = 0
        minutos_atraso_total = 0
        
        for r in registros:
            try:
                if hasattr(r, 'status') and r.status == 'atrasado':
                    total_atrasos += 1
                if hasattr(r, 'minutos_atraso') and r.minutos_atraso:
                    minutos_atraso_total += r.minutos_atraso
            except Exception:
                pass
        
        # Frequência por tipo
        frequencia_tipo = {
            'entrada': 0,
            'saida_almoco': 0,
            'retorno_almoco': 0,
            'saida': 0
        }
        
        for r in registros:
            try:
                if hasattr(r, 'tipo_registro') and r.tipo_registro in frequencia_tipo:
                    frequencia_tipo[r.tipo_registro] += 1
            except Exception:
                pass
        
        # Gráfico de frequência (últimos 30 dias)
        grafico_frequencia = []
        for i in range(30):
            try:
                dia = date.today() - timedelta(days=29-i)
                dia_str = dia.isoformat()
                registros_dia = registros_por_dia.get(dia_str, [])
                
                minutos_atraso_dia = 0
                teve_atraso_dia = False
                for r in registros_dia:
                    try:
                        if hasattr(r, 'status') and r.status == 'atrasado':
                            teve_atraso_dia = True
                        if hasattr(r, 'minutos_atraso') and r.minutos_atraso:
                            minutos_atraso_dia += r.minutos_atraso
                    except Exception:
                        pass
                
                grafico_frequencia.append({
                    'data': dia_str,
                    'total_registros': len(registros_dia),
                    'teve_atraso': teve_atraso_dia,
                    'minutos_atraso': minutos_atraso_dia
                })
            except Exception as e:
                logger.error(f"Erro ao processar dia {dia}: {e}")
                continue
        
        return jsonify({
            'success': True,
            'data': {
                'dias_trabalhados': dias_trabalhados,
                'total_atrasos': total_atrasos,
                'minutos_atraso_total': minutos_atraso_total,
                'frequencia_tipo': frequencia_tipo,
                'grafico_frequencia': grafico_frequencia,
                'taxa_presenca': round((dias_trabalhados / 30) * 100, 1) if dias_trabalhados > 0 else 0
            }
        }), 200
        
    except Exception as e:
        logger.error(f"Erro ao calcular estatísticas: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': True,
            'data': {
                'dias_trabalhados': 0,
                'total_atrasos': 0,
                'minutos_atraso_total': 0,
                'frequencia_tipo': {'entrada': 0, 'saida_almoco': 0, 'retorno_almoco': 0, 'saida': 0},
                'grafico_frequencia': [],
                'taxa_presenca': 0
            }
        }), 200


@ponto_bp.route('/configuracao', methods=['GET'])
@jwt_required()
@permission_required('ponto')
def obter_configuracao():
    """Obtém configuração de horários do estabelecimento"""
    try:
        funcionario = get_funcionario_logado()
        if not funcionario:
            return jsonify({'success': False, 'message': 'Funcionário não encontrado'}), 404
        
        config = ConfiguracaoHorario.query.filter_by(
            estabelecimento_id=funcionario.estabelecimento_id
        ).first()
        
        if not config:
            # Criar configuração padrão
            config = ConfiguracaoHorario(
                estabelecimento_id=funcionario.estabelecimento_id
            )
            db.session.add(config)
            db.session.commit()
        
        return jsonify({
            'success': True,
            'data': config.to_dict()
        }), 200
        
    except Exception as e:
        logger.error(f"Erro ao obter configuração: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500


@ponto_bp.route('/configuracao', methods=['PUT'])
@jwt_required()
@permission_required('ponto')
def atualizar_configuracao():
    """Atualiza configuração de horários (Admin ou Gerente)"""
    try:
        funcionario = get_funcionario_logado()
        if not funcionario or not pode_configurar_ponto(funcionario):
            return jsonify({'success': False, 'message': 'Acesso negado'}), 403

        data = request.get_json()

        config = ConfiguracaoHorario.query.filter_by(
            estabelecimento_id=funcionario.estabelecimento_id
        ).first()
        
        if not config:
            config = ConfiguracaoHorario(estabelecimento_id=funcionario.estabelecimento_id)
            db.session.add(config)
        
        # Atualizar campos
        if 'hora_entrada' in data:
            config.hora_entrada = datetime.strptime(data['hora_entrada'], '%H:%M').time()
        if 'hora_saida_almoco' in data:
            config.hora_saida_almoco = datetime.strptime(data['hora_saida_almoco'], '%H:%M').time()
        if 'hora_retorno_almoco' in data:
            config.hora_retorno_almoco = datetime.strptime(data['hora_retorno_almoco'], '%H:%M').time()
        if 'hora_saida' in data:
            config.hora_saida = datetime.strptime(data['hora_saida'], '%H:%M').time()
        
        if 'tolerancia_entrada' in data:
            config.tolerancia_entrada = data['tolerancia_entrada']
        if 'tolerancia_saida_almoco' in data:
            config.tolerancia_saida_almoco = data['tolerancia_saida_almoco']
        if 'tolerancia_retorno_almoco' in data:
            config.tolerancia_retorno_almoco = data['tolerancia_retorno_almoco']
        if 'tolerancia_saida' in data:
            config.tolerancia_saida = data['tolerancia_saida']

        # Jornada diária normal (CLT: 8h/dia por padrão). Contratos com
        # jornada diferente (ex.: 9h para bater 44h/semana na escala 6x1)
        # configuram aqui — o que passar disso vira hora extra no dia.
        if 'jornada_diaria_minutos' in data:
            config.jornada_diaria_minutos = int(data['jornada_diaria_minutos'])
        elif 'jornada_diaria_horas' in data:
            config.jornada_diaria_minutos = int(round(float(data['jornada_diaria_horas']) * 60))

        if 'exigir_foto' in data:
            config.exigir_foto = data['exigir_foto']
        if 'exigir_localizacao' in data:
            config.exigir_localizacao = data['exigir_localizacao']
        if 'raio_permitido_metros' in data:
            config.raio_permitido_metros = data['raio_permitido_metros']
        
        config.updated_at = datetime.now(timezone.utc)
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Configuração atualizada com sucesso',
            'data': config.to_dict()
        }), 200
        
    except Exception as e:
        logger.error(f"Erro ao atualizar configuração: {e}")
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


@ponto_bp.route('/<int:registro_id>', methods=['PUT'])
@jwt_required()
@permission_required('ponto')
def ajustar_ponto(registro_id):
    """Ajusta um registro de ponto existente (apenas admin)"""
    try:
        funcionario = get_funcionario_logado()
        if not funcionario or not pode_ver_tudo_ponto(funcionario):
            return jsonify({'success': False, 'message': 'Apenas Admin, Gerente ou RH podem ajustar pontos'}), 403
        
        registro = RegistroPonto.query.get(registro_id)
        if not registro:
            return jsonify({'success': False, 'message': 'Registro de ponto não encontrado'}), 404
        
        # Verificar se pertence ao mesmo estabelecimento
        if registro.estabelecimento_id != funcionario.estabelecimento_id:
            return jsonify({'success': False, 'message': 'Acesso negado'}), 403
        
        data = request.get_json()
        
        # Campos que podem ser ajustados
        if 'hora' in data:
            try:
                nova_hora = datetime.strptime(data['hora'], '%H:%M:%S').time()
                registro.hora = nova_hora
                
                # Recalcular atraso
                config = obter_configuracao_com_cache(registro.estabelecimento_id)
                minutos_atraso = 0
                status = 'normal'
                
                if config:
                    if registro.tipo_registro == 'entrada':
                        minutos_atraso = calcular_minutos_atraso(
                            nova_hora, config.hora_entrada, config.tolerancia_entrada
                        )
                    elif registro.tipo_registro == 'saida_almoco':
                        minutos_atraso = calcular_minutos_atraso(
                            nova_hora, config.hora_saida_almoco, config.tolerancia_saida_almoco
                        )
                    elif registro.tipo_registro == 'retorno_almoco':
                        minutos_atraso = calcular_minutos_atraso(
                            nova_hora, config.hora_retorno_almoco, config.tolerancia_retorno_almoco
                        )
                
                if minutos_atraso > 0:
                    status = 'atrasado'
                
                registro.minutos_atraso = minutos_atraso
                registro.status = status
            except ValueError:
                return jsonify({'success': False, 'message': 'Formato de hora inválido. Use HH:MM:SS'}), 400
        
        if 'status' in data:
            if data['status'] in ['normal', 'atrasado', 'justificado']:
                registro.status = data['status']
            else:
                return jsonify({'success': False, 'message': 'Status inválido'}), 400
        
        if 'observacao' in data:
            registro.observacao = data['observacao']
        
        if 'minutos_atraso' in data:
            registro.minutos_atraso = int(data['minutos_atraso'])
        
        registro.updated_at = datetime.now(timezone.utc)
        db.session.commit()
        
        logger.info(f"✅ Ponto ajustado: {registro.funcionario.nome} - {registro.data} {registro.hora}")
        
        # Auditoria SaaS
        try:
            Auditoria.registrar(
                estabelecimento_id=registro.estabelecimento_id,
                funcionario_id=funcionario.id,
                tipo_evento='Editou Ponto',
                descricao=f"Funcionário {funcionario.nome} editou o ponto ({registro.tipo_registro}) do funcionário {registro.funcionario.nome} para {registro.data} {registro.hora}."
            )
        except Exception as e_auditoria:
            logger.error(f"Erro ao registrar auditoria de edição de ponto: {e_auditoria}")
        
        return jsonify({
            'success': True,
            'message': f'Registro de ponto ajustado com sucesso!',
            'data': registro.to_dict()
        }), 200
        
    except Exception as e:
        logger.error(f"Erro ao ajustar ponto: {e}")
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


@ponto_bp.route('/relatorio/funcionarios', methods=['GET'])
@jwt_required()
@permission_required('ponto')
def relatorio_funcionarios():
    """Relatório consolidado de todos os funcionários (Admin/Gerente/RH)"""
    try:
        funcionario = get_funcionario_logado()
        if not funcionario or not pode_ver_tudo_ponto(funcionario):
            return jsonify({'success': False, 'message': 'Acesso negado'}), 403
        
        # Parâmetros
        data_inicio = request.args.get('data_inicio')
        data_fim = request.args.get('data_fim')
        
        if not data_inicio or not data_fim:
            return jsonify({'success': False, 'message': 'data_inicio e data_fim são obrigatórios'}), 400
        
        data_inicio_obj = datetime.strptime(data_inicio, '%Y-%m-%d').date()
        data_fim_obj = datetime.strptime(data_fim, '%Y-%m-%d').date()
        
        # Buscar todos os funcionários do estabelecimento
        funcionarios = Funcionario.query.filter_by(
            estabelecimento_id=funcionario.estabelecimento_id,
            ativo=True
        ).all()
        
        relatorio = []
        
        for func in funcionarios:
            # Buscar registros do período
            registros = RegistroPonto.query.filter(
                and_(
                    RegistroPonto.funcionario_id == func.id,
                    RegistroPonto.data >= data_inicio_obj,
                    RegistroPonto.data <= data_fim_obj
                )
            ).all()
            
            # Calcular estatísticas
            dias_trabalhados = len(set(r.data for r in registros))
            total_atrasos = sum(1 for r in registros if r.status == 'atrasado')
            minutos_atraso_total = sum(r.minutos_atraso for r in registros)
            
            # Calcular dias úteis no período
            dias_uteis = 0
            data_atual = data_inicio_obj
            while data_atual <= data_fim_obj:
                if data_atual.weekday() < 5:  # Segunda a sexta
                    dias_uteis += 1
                data_atual += timedelta(days=1)
            
            taxa_presenca = round((dias_trabalhados / dias_uteis * 100), 1) if dias_uteis > 0 else 0
            
            relatorio.append({
                'funcionario_id': func.id,
                'funcionario_nome': func.nome,
                'cargo': func.cargo,
                'dias_trabalhados': dias_trabalhados,
                'dias_uteis': dias_uteis,
                'taxa_presenca': taxa_presenca,
                'total_atrasos': total_atrasos,
                'minutos_atraso_total': minutos_atraso_total,
                'total_registros': len(registros)
            })
        
        return jsonify({
            'success': True,
            'data': {
                'periodo': {
                    'data_inicio': data_inicio,
                    'data_fim': data_fim,
                    'dias_uteis': dias_uteis
                },
                'funcionarios': relatorio,
                'resumo': {
                    'total_funcionarios': len(funcionarios),
                    'media_presenca': round(sum(f['taxa_presenca'] for f in relatorio) / len(relatorio), 1) if relatorio else 0,
                    'total_atrasos': sum(f['total_atrasos'] for f in relatorio)
                }
            }
        }), 200
        
    except Exception as e:
        logger.error(f"Erro ao gerar relatório: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500


@ponto_bp.route('/relatorio/detalhado/<int:funcionario_id>', methods=['GET'])
@jwt_required()
def relatorio_detalhado_funcionario(funcionario_id):
    """Relatório detalhado de um funcionário específico"""
    try:
        funcionario_logado = get_funcionario_logado()
        if not funcionario_logado:
            return jsonify({'success': False, 'message': 'Funcionário não encontrado'}), 404
        
        # Verificar permissão (Admin/Gerente/RH ou o próprio funcionário)
        if not pode_ver_tudo_ponto(funcionario_logado) and funcionario_logado.id != funcionario_id:
            return jsonify({'success': False, 'message': 'Acesso negado'}), 403
        
        # Parâmetros
        data_inicio = request.args.get('data_inicio')
        data_fim = request.args.get('data_fim')
        
        if not data_inicio or not data_fim:
            return jsonify({'success': False, 'message': 'data_inicio e data_fim são obrigatórios'}), 400
        
        data_inicio_obj = datetime.strptime(data_inicio, '%Y-%m-%d').date()
        data_fim_obj = datetime.strptime(data_fim, '%Y-%m-%d').date()
        
        # Buscar funcionário
        funcionario = Funcionario.query.get(funcionario_id)
        if not funcionario:
            return jsonify({'success': False, 'message': 'Funcionário não encontrado'}), 404
        
        # Buscar registros
        registros = RegistroPonto.query.filter(
            and_(
                RegistroPonto.funcionario_id == funcionario_id,
                RegistroPonto.data >= data_inicio_obj,
                RegistroPonto.data <= data_fim_obj
            )
        ).order_by(RegistroPonto.data, RegistroPonto.hora).all()
        
        # Agrupar por data
        registros_por_dia = {}
        for r in registros:
            data_str = r.data.isoformat()
            if data_str not in registros_por_dia:
                registros_por_dia[data_str] = []
            registros_por_dia[data_str].append(r.to_dict())
        
        # Calcular estatísticas
        dias_trabalhados = len(registros_por_dia)
        total_atrasos = sum(1 for r in registros if r.status == 'atrasado')
        minutos_atraso_total = sum(r.minutos_atraso for r in registros)
        
        # Calcular horas trabalhadas por dia
        horas_por_dia = []
        for data_str, regs in registros_por_dia.items():
            entrada = next((r for r in regs if r['tipo_registro'] == 'entrada'), None)
            saida = next((r for r in regs if r['tipo_registro'] == 'saida'), None)
            
            horas_trabalhadas = 0
            if entrada and saida:
                entrada_time = datetime.strptime(entrada['hora'], '%H:%M:%S').time()
                saida_time = datetime.strptime(saida['hora'], '%H:%M:%S').time()
                
                entrada_dt = datetime.combine(date.today(), entrada_time)
                saida_dt = datetime.combine(date.today(), saida_time)
                
                diferenca = saida_dt - entrada_dt
                horas_trabalhadas = diferenca.total_seconds() / 3600
            
            horas_por_dia.append({
                'data': data_str,
                'horas_trabalhadas': round(horas_trabalhadas, 2),
                'registros': regs
            })
        
        return jsonify({
            'success': True,
            'data': {
                'funcionario': {
                    'id': funcionario.id,
                    'nome': funcionario.nome,
                    'cargo': funcionario.cargo,
                    'email': funcionario.email
                },
                'periodo': {
                    'data_inicio': data_inicio,
                    'data_fim': data_fim
                },
                'estatisticas': {
                    'dias_trabalhados': dias_trabalhados,
                    'total_atrasos': total_atrasos,
                    'minutos_atraso_total': minutos_atraso_total,
                    'total_registros': len(registros),
                    'horas_totais': round(sum(d['horas_trabalhadas'] for d in horas_por_dia), 2)
                },
                'registros_por_dia': horas_por_dia
            }
        }), 200
        
    except Exception as e:
        logger.error(f"Erro ao gerar relatório detalhado: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500
