import os
import click
from flask.cli import with_appcontext
import logging

logger = logging.getLogger(__name__)


def register_commands(app):
    @app.cli.command("push-to-aiven")
    @with_appcontext
    def push_to_aiven():
        """Replicação completa local → Aiven (motor force_sync, idempotente)."""
        click.echo("🚀 Sincronizando local → Aiven (robust_sync)...")
        try:
            from scripts.robust_sync import robust_sync
            res = robust_sync(silent=False)
            if res.get("success"):
                click.echo(f"✅ Concluído: {res.get('total_registros', 0)} registros enviados ao Aiven.")
            else:
                click.echo(f"❌ Falha: {res.get('erro')}")
        except Exception as e:
            click.echo(f"❌ Erro durante sincronização: {e}")
            logger.error(f"Erro no comando push-to-aiven: {e}")

    @app.cli.command("sync-status")
    @with_appcontext
    def sync_status():
        """Mostra o gap de registros entre o banco local e o Aiven."""
        import psycopg2
        tabelas = ["vendas", "produtos", "clientes", "despesas", "documentos_fiscais", "notas_fiscais_entrada"]
        local_url = os.environ.get("DATABASE_URL")
        aiven_url = os.environ.get("AIVEN_DATABASE_URL")
        if not local_url or not aiven_url:
            click.echo("❌ DATABASE_URL/AIVEN_DATABASE_URL não configurados.")
            return

        def _counts(url):
            out = {}
            try:
                conn = psycopg2.connect(url.replace("postgres://", "postgresql://", 1), connect_timeout=15)
                cur = conn.cursor()
                for t in tabelas:
                    try:
                        cur.execute(f'SELECT count(*) FROM "{t}"')
                        out[t] = cur.fetchone()[0]
                    except Exception:
                        conn.rollback()
                        out[t] = None
                conn.close()
            except Exception as e:
                click.echo(f"  ⚠️ Conexão falhou: {str(e)[:80]}")
            return out

        loc = _counts(local_url)
        aiv = _counts(aiven_url)
        click.echo("=" * 52)
        click.echo(f"  {'Tabela':<24}{'Local':>8}{'Aiven':>8}{'Gap':>8}")
        click.echo("-" * 52)
        for t in tabelas:
            l, a = loc.get(t), aiv.get(t)
            gap = (l - a) if (isinstance(l, int) and isinstance(a, int)) else "—"
            click.echo(f"  {t:<24}{str(l):>8}{str(a):>8}{str(gap):>8}")
        click.echo("=" * 52)

    @app.cli.command("limpar-pedidos-orfaos")
    @click.option("--apply", is_flag=True, help="Aplica a exclusão (sem esta flag, apenas mostra — dry-run).")
    @with_appcontext
    def limpar_pedidos_orfaos(apply):
        """Remove pedidos de compra SEM itens (dado órfão/legado que aparece como
        '0 itens' na tela). Por segurança, só remove pedidos NÃO recebidos e a
        Conta a Pagar vinculada apenas se ainda estiver 'aberto' (não paga).
        Sem --apply é dry-run (não altera nada)."""
        from app.models import db, PedidoCompra, PedidoCompraItem, ContaPagar, allow_all_tenants

        with allow_all_tenants():
            # Pedidos que não possuem nenhum item.
            subq = db.session.query(PedidoCompraItem.pedido_id).distinct()
            orfaos = (PedidoCompra.query
                      .filter(~PedidoCompra.id.in_(subq))
                      .all())

            if not orfaos:
                click.echo("[OK] Nenhum pedido orfao (todos tem itens).")
                return

            click.echo(f"{'[DRY-RUN] ' if not apply else ''}Pedidos SEM itens encontrados: {len(orfaos)}")
            removidos, contas_removidas, preservados = 0, 0, 0
            for p in orfaos:
                if str(p.status).lower() in ("recebido", "parcial"):
                    click.echo(f"  - {p.numero_pedido}: PRESERVADO (status={p.status})")
                    preservados += 1
                    continue
                click.echo(f"  - {p.numero_pedido} (loja {p.estabelecimento_id}, total {p.total}) -> remover")
                if apply:
                    conta = ContaPagar.query.filter_by(pedido_compra_id=p.id).first()
                    if conta and str(conta.status).lower() == "aberto":
                        db.session.delete(conta)
                        contas_removidas += 1
                    db.session.delete(p)
                    removidos += 1

            if apply:
                db.session.commit()
                click.echo(f"[LIMPO] Removidos: {removidos} pedidos, {contas_removidas} contas a pagar. Preservados: {preservados}.")
            else:
                click.echo("-> Rode com --apply para efetivar a limpeza.")

    @app.cli.command("backfill-vendas-produto")
    @click.option("--apply", is_flag=True, help="Grava (sem esta flag é dry-run).")
    @with_appcontext
    def backfill_vendas_produto(apply):
        """Recalcula os contadores denormalizados de venda de CADA produto
        (total_vendido, quantidade_vendida, ultima_venda) a partir do ledger
        (venda_itens, ignorando vendas canceladas). Corrige dados históricos que
        ficaram zerados porque a venda antiga não atualizava esses campos."""
        from sqlalchemy import func
        from app.models import db, Produto, Venda, VendaItem, allow_all_tenants

        with allow_all_tenants():
            linhas = (
                db.session.query(
                    VendaItem.produto_id.label("pid"),
                    func.sum(VendaItem.quantidade).label("qtd_val"),
                    func.sum(VendaItem.total_item).label("total_val"),
                    func.max(Venda.data_venda).label("max_data"),
                )
                .join(Venda, Venda.id == VendaItem.venda_id)
                .filter(func.lower(func.coalesce(Venda.status, "")) != "cancelada")
                .group_by(VendaItem.produto_id)
                .all()
            )

            atualizados = 0
            for row in linhas:
                p = Produto.query.get(row.pid)
                if not p:
                    continue
                p.quantidade_vendida = row.qtd_val or 0
                p.total_vendido = row.total_val or 0
                p.ultima_venda = row.max_data
                atualizados += 1
                click.echo(f"  - {p.nome}: qtd={float(row.qtd_val or 0)}, total={float(row.total_val or 0)}")

            if apply:
                db.session.commit()
                click.echo(f"[OK] {atualizados} produtos recalculados a partir do ledger.")
            else:
                click.echo(f"[DRY-RUN] {atualizados} produtos seriam recalculados. Use --apply.")
