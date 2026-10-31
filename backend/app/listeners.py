from sqlalchemy import event, inspect
import os
from app.models import db, AuditoriaSincronia, Auditoria
import json
import logging
from flask import g
from datetime import datetime, date

def iso_utc(valor):
    """Import tardio: app.utils carrega serviços que dependem de app (import circular)."""
    from app.utils.timezone import iso_utc as _iso_utc
    return _iso_utc(valor)

logger = logging.getLogger(__name__)

# Tabelas que devem ser sincronizadas com a nuvem (Integridade de Dados)
TABELAS_SINCRONIZAVEIS = [
    "produtos", "categorias_produto", "fornecedores", "clientes", 
    "vendas", "venda_itens", "pagamentos", "movimentacoes_estoque",
    "caixas", "movimentacoes_caixa", "funcionarios", "estabelecimentos",
    "despesas", "contas_pagar", "produto_lotes", "configuracoes",
    "motoristas", "veiculos", "entregas", "taxas_entrega"
]

# Tabelas que aparecem no MONITOR do Super Admin (Inteligência de Negócio)
# Filtramos apenas o que é "Vital" para a Holding ver em tempo real.
TABELAS_MONITOR_MASTER = {
    "vendas": "Venda Realizada",
    "pedidos_compra": "Novo Pedido de Compra",
    "despesas": "Nova Despesa Registrada",
    "produtos": "Alteração em Produto/Preço",
    "clientes": "Movimentação de Cliente",
    "movimentacoes_estoque": "Ajuste de Estoque (Perda/Ganho)",
    "movimentacoes_caixa": "Intervenção de Caixa (Sangria/Suprimento)",
}

# Tabelas cujo INSERT a PRÓPRIA ROTA registra com evento de negócio (autor + descrição legível).
# Para elas o listener não grava a segunda linha de auditoria — antes cada cadastro de produto
# gerava `produtos_insert` (SISTEMA) + `produto_criado` (usuário): 178 eventos para 89 cadastros.
# A fila de sincronia (AuditoriaSincronia) continua sendo alimentada normalmente.
EVENTO_PROPRIO_NO_INSERT = {"produtos"}

def object_to_dict(obj):
    """Converte objeto SQLAlchemy para dict de forma segura, tratando tipos não serilizáveis."""
    from decimal import Decimal
    
    if hasattr(obj, 'to_dict'):
        d = obj.to_dict()
    else:
        # Fallback para inspeção de colunas
        d = {c.key: getattr(obj, c.key) for c in inspect(obj).mapper.column_attrs}
    
    # Sanitização recursiva para JSON
    def sanitize(v):
        if isinstance(v, Decimal):
            return float(v)
        if isinstance(v, (datetime, date)):
            return iso_utc(v)
        if isinstance(v, dict):
            return {k: sanitize(item) for k, item in v.items()}
        if isinstance(v, list):
            return [sanitize(item) for item in v]
        return v

    return {k: sanitize(v) for k, v in d.items()}

def registrar_evento_forense(mapper, connection, target, operacao):
    """
    Hook global para Auditoria Forense e Sincronia.
    Captura o estado do objeto para reconstrução total e auditoria.
    """
    from app.models import Auditoria, AuditoriaSincronia

    # [ESTRATÉGIA DE ELITE] Bypass total e imediato em Simulação ou Sincronia
    if os.environ.get("FLASK_ENV") == "simulation" or \
       os.environ.get("SYNC_IN_PROGRESS") == "1":
        return

    if isinstance(target, (Auditoria, AuditoriaSincronia)):
        return

    # O DONO DO SAAS solicitou ver TODOS os logs do sistema.
    # Portanto, comentamos o early return que impedia tabelas não-monitoradas de gerarem log.
    tabela = target.__tablename__
    # if tabela not in TABELAS_SINCRONIZAVEIS and tabela not in TABELAS_MONITOR_MASTER:
    #     return

    # 1. Resolução de Estabelecimento ID com Precisão de Auditoria
    estabelecimento_id = getattr(target, 'estabelecimento_id', None)
    if not estabelecimento_id and target.__tablename__ == 'estabelecimentos':
        estabelecimento_id = target.id
    
    # Fallback: Tentar pegar do contexto global g se ainda estiver vazio (essencial para scripts/cli)
    if not estabelecimento_id and hasattr(g, 'estabelecimento_id'):
        estabelecimento_id = g.estabelecimento_id

    # Se ainda não temos estabelecimento_id, não podemos auditar perante as restrições de FK
    if not estabelecimento_id:
        return

    # 2. Preparar Payload (Estado Atual)
    try:
        payload = object_to_dict(target)
        
        # 3. Registrar na Auditoria Forense (MONITOR SaaS)
        # Tenta pegar o usuário do contexto global (g)
        usuario_id = getattr(g, 'user_id', None)
        
        # Mapeamento para nome amigável
        label_tabela = TABELAS_MONITOR_MASTER.get(target.__tablename__, target.__tablename__.replace('_', ' ').title())
        
        # Determinar Identificador do Registro (Evitar None se possível)
        registro_id = getattr(target, 'id', None)
        
        # Descrição Inteligente baseada na operação
        if operacao == 'INSERT':
            descricao = f"Novo registro em {label_tabela} (ID: {registro_id}) criado."
            if target.__tablename__ == 'vendas':
                 descricao = f"Venda #{getattr(target, 'codigo', registro_id)} finalizada com sucesso."
            elif target.__tablename__ == 'despesas':
                 descricao = f"Despesa registrada: {getattr(target, 'descricao', 'Sem descrição')}."
            elif target.__tablename__ == 'estabelecimentos':
                 descricao = f"Novo estabelecimento registrado: {getattr(target, 'nome_fantasia', registro_id)}."
        elif operacao == 'UPDATE':
            descricao = f"Alteração realizada em {label_tabela} (ID: {registro_id})."
            if target.__tablename__ == 'produtos':
                 descricao = f"Atualização de dados/preço no produto: {getattr(target, 'nome', registro_id)}."
            elif target.__tablename__ == 'estabelecimentos':
                 descricao = f"Atualização de dados/plano do estabelecimento: {getattr(target, 'nome_fantasia', registro_id)}."
        else:
            descricao = f"Exclusão de {label_tabela} (ID: {registro_id})."

        tipo_evento = f"{target.__tablename__}_{operacao.lower()}"
        
        # O campo 'valor' da Auditoria pode ser preenchido se a tabela tiver 'valor' ou 'total'
        valor = getattr(target, 'total', getattr(target, 'valor', getattr(target, 'valor_original', None)))

        if not (operacao == 'INSERT' and target.__tablename__ in EVENTO_PROPRIO_NO_INSERT):
            Auditoria.registrar_direto(
                connection=connection,
                estabelecimento_id=estabelecimento_id,
                tipo_evento=tipo_evento,
                descricao=descricao,
                usuario_id=usuario_id,
                valor=valor,
                detalhes={
                    "operacao": operacao,
                    "tabela": target.__tablename__,
                    "registro_id": registro_id,
                    "timestamp": iso_utc(datetime.now()),
                    "data": payload
                }
            )

        # 4. Registrar na Auditoria Sincronia (SYNC ENGINE)
        # IMPLEMENTAÇÃO DE ELITE: Se a tabela for sincronizável, enfileira para a nuvem
        if tabela in TABELAS_SINCRONIZAVEIS:
            try:
                from app.models import AuditoriaSincronia
                connection.execute(
                    AuditoriaSincronia.__table__.insert().values(
                        estabelecimento_id=estabelecimento_id,
                        tabela=tabela,
                        registro_id=registro_id,
                        operacao=operacao,
                        payload_json=json.dumps(payload, default=str),
                        status="pendente",
                        tentativas=0,
                        created_at=datetime.now()
                    )
                )
            except Exception as e:
                # Falha silenciosa no sync para não travar a venda
                pass

    except Exception as e:
        # Erros em listeners não devem quebrar a transação principal
        pass

def setup_listeners():
    """Configura os listeners de Auditoria Forense para todos os modelos relevantes"""
    # Itera sobre todos os modelos registrados no SQLAlchemy
    for model_class in db.Model.__subclasses__():
        # Ignorar as tabelas de log e tabelas não-sincronizáveis para evitar loop e ruído
        if not hasattr(model_class, '__tablename__'): continue
        
        t_name = model_class.__tablename__
        if t_name in ['auditoria', 'auditoria_sincronia', 'sync_log', 'sync_queue', 'login_history']:
            continue
            
        event.listen(model_class, 'after_insert', lambda m, c, t: registrar_evento_forense(m, c, t, 'INSERT'))
        event.listen(model_class, 'after_update', lambda m, c, t: registrar_evento_forense(m, c, t, 'UPDATE'))
        event.listen(model_class, 'after_delete', lambda m, c, t: registrar_evento_forense(m, c, t, 'DELETE'))

    logger.info("Muralha Forense: Listeners de Auditoria e Sincronia (Business Intelligence) ativados!")

