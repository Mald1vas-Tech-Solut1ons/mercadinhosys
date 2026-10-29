from datetime import datetime, timedelta
from app import db
from sqlalchemy import func
from app.models import PedidoCompra, Fornecedor, ContaPagar, Produto
from app.services.consultor.contextos._datas import hoje_local, ini, fim

def montar_contexto(estabelecimento_id: int, is_manager: bool = True) -> dict:
    """Monta o contexto de Compras para o consultor IA."""
    hoje = hoje_local()
    mes_atual_inicio = hoje.replace(day=1)
    
    contexto = {}

    # 1. Pedidos em aberto
    q_pedidos_abertos = db.session.query(func.count(PedidoCompra.id)).filter(
        PedidoCompra.status == 'aberto'
    )
    if estabelecimento_id != 'all':
        q_pedidos_abertos = q_pedidos_abertos.filter(PedidoCompra.estabelecimento_id == estabelecimento_id)
        
    contexto["pedidos_em_aberto_qtd"] = q_pedidos_abertos.scalar() or 0

    # 2. Top fornecedores por volume (mês atual)
    q_top_fornecedores = db.session.query(
        Fornecedor.nome_fantasia,
        Fornecedor.razao_social,
        func.sum(PedidoCompra.total).label("volume_total")
    ).join(PedidoCompra).filter(
        PedidoCompra.status.in_(['concluido', 'parcial']),
        PedidoCompra.data_pedido >= ini(mes_atual_inicio),
        PedidoCompra.data_pedido <= fim(hoje)
    )
    if estabelecimento_id != 'all':
        q_top_fornecedores = q_top_fornecedores.filter(PedidoCompra.estabelecimento_id == estabelecimento_id)
        
    top_forn = q_top_fornecedores.group_by(Fornecedor.id).order_by(func.sum(PedidoCompra.total).desc()).limit(5).all()
    contexto["top_fornecedores_mes_atual"] = [
        {
            "nome": f.nome_fantasia or f.razao_social or "Desconhecido",
            "volume_compras": float(f.volume_total or 0.0)
        }
        for f in top_forn
    ]

    # 3. Prazo médio de entrega (diferença entre data_pedido e data_recebimento concluídos)
    q_prazo = db.session.query(
        func.avg(func.extract('epoch', PedidoCompra.data_recebimento) - func.extract('epoch', PedidoCompra.data_pedido))
    ).filter(
        PedidoCompra.status == 'concluido',
        PedidoCompra.data_recebimento.isnot(None),
        PedidoCompra.data_pedido.isnot(None)
    )
    if estabelecimento_id != 'all':
        q_prazo = q_prazo.filter(PedidoCompra.estabelecimento_id == estabelecimento_id)
        
    prazo_segundos = q_prazo.scalar() or 0
    contexto["prazo_medio_entrega_dias"] = round(prazo_segundos / 86400.0, 1) if prazo_segundos > 0 else 0.0

    # 4. Itens abaixo do mínimo com último fornecedor (ligação estoque -> compra)
    q_alertas = db.session.query(Produto).filter(
        Produto.ativo == True,
        Produto.quantidade <= Produto.quantidade_minima
    )
    if estabelecimento_id != 'all':
        q_alertas = q_alertas.filter(Produto.estabelecimento_id == estabelecimento_id)
        
    # Limitar para não explodir o token count
    produtos_alerta = q_alertas.limit(20).all()
    
    contexto["itens_abaixo_minimo_para_comprar"] = [
        {
            "nome": p.nome,
            "estoque_atual": float(p.quantidade or 0),
            "estoque_minimo": float(p.quantidade_minima or 0),
            "ultimo_custo": float(p.preco_custo or 0.0),
            "ultimo_fornecedor": p.fornecedor.nome_fantasia if hasattr(p, 'fornecedor') and p.fornecedor else "Desconhecido"
        }
        for p in produtos_alerta
    ]

    # 5. Boletos em aberto por fornecedor
    q_boletos_fornecedor = db.session.query(
        Fornecedor.nome_fantasia,
        Fornecedor.razao_social,
        func.sum(func.coalesce(ContaPagar.valor_atual, ContaPagar.valor_original)).label("total_devido")
    ).join(ContaPagar, ContaPagar.fornecedor_id == Fornecedor.id).filter(
        ContaPagar.status == 'aberto'
    )
    if estabelecimento_id != 'all':
        q_boletos_fornecedor = q_boletos_fornecedor.filter(ContaPagar.estabelecimento_id == estabelecimento_id)
        
    boletos_agrupados = q_boletos_fornecedor.group_by(Fornecedor.id).order_by(func.sum(func.coalesce(ContaPagar.valor_atual, ContaPagar.valor_original)).desc()).limit(10).all()
    
    contexto["boletos_abertos_por_fornecedor"] = [
        {
            "fornecedor": f.nome_fantasia or f.razao_social or "Desconhecido",
            "valor_devido": float(f.total_devido or 0.0)
        }
        for f in boletos_agrupados
    ]

    return contexto
