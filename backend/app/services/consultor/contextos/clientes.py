from app.models import Cliente, db
from sqlalchemy import desc


def montar_contexto(estabelecimento_id: int, is_manager: bool = True) -> dict:
    """Monta o contexto de Clientes (CRM) para o consultor IA (pseudonimizado por LGPD).
    Acesso restrito apenas para gestores (is_manager=True).
    """
    if not is_manager:
        return {"aviso": "Acesso negado. Apenas gestores podem visualizar o contexto de clientes."}

    contexto = {}

    q = Cliente.query.filter(Cliente.ativo == True, Cliente.deleted_at == None)
    if str(estabelecimento_id).lower() != "all":
        q = q.filter(Cliente.estabelecimento_id == estabelecimento_id)

    # 1. Top 15 clientes com maior gasto histórico (pseudonimizado: Cliente #<id>)
    top_gastos = q.order_by(desc(Cliente.valor_total_gasto)).limit(15).all()
    contexto["top_clientes_historico"] = [
        {
            "cliente": f"Cliente #{c.id}",
            "total_compras": int(c.total_compras or 0),
            "valor_gasto": float(c.valor_total_gasto or 0.0),
            "ultima_compra": c.ultima_compra.strftime("%d/%m/%Y") if c.ultima_compra else "Nunca",
        }
        for c in top_gastos
        if c.valor_total_gasto and c.valor_total_gasto > 0
    ]

    # 2. Maiores devedores (fiado em atraso, pseudonimizado: Cliente #<id>)
    top_devedores = q.filter(Cliente.saldo_devedor > 0).order_by(desc(Cliente.saldo_devedor)).limit(10).all()
    contexto["maiores_devedores"] = [
        {
            "cliente": f"Cliente #{c.id}",
            "saldo_devedor": float(c.saldo_devedor or 0.0),
        }
        for c in top_devedores
    ]

    # 3. Resumo RFM Simples (quantidades)
    contexto["total_clientes_ativos"] = q.count()

    return contexto
