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

    @app.cli.command("verificar-dados")
    @click.option("--estab", type=int, default=None, help="Só esta loja (padrão: todas).")
    @with_appcontext
    def verificar_dados(estab):
        """Verificação noturna de consistência (só leitura). Divergência vai ao Sentry;
        saída 1 quando acha algo, para o cron registrar."""
        import json
        from app.services.verificacao_dados import verificar

        resultado = verificar(estab)
        click.echo(json.dumps({k: resultado[k] for k in ("ok", "total", "por_checagem", "falhas")}, ensure_ascii=False))
        for d in resultado["divergencias"]:
            click.echo(f"  - [{d['checagem']}] loja {d['estabelecimento_id']} {d['ref']} {d['descricao']}: "
                       f"esperado {d['esperado']}, encontrado {d['encontrado']}")
        if not resultado["ok"]:
            try:
                import sentry_sdk
                with sentry_sdk.push_scope() as scope:
                    scope.set_extra("por_checagem", resultado["por_checagem"])
                    scope.set_extra("amostra", resultado["divergencias"][:20])
                    scope.set_extra("falhas", resultado["falhas"])
                    sentry_sdk.capture_message(
                        f"Verificação de dados: {resultado['total']} divergência(s) {resultado['por_checagem']}",
                        level="warning")
            except Exception:
                pass
            raise SystemExit(1)

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


@app.cli.command("normalizar-produtos")
@click.option("--apply", is_flag=True, help="Aplica a normalizacao (sem esta flag, apenas mostra — dry-run).")
@with_appcontext
def normalizar_produtos(apply):
    """Normaliza o legado ao padrao canônico do Guardião: UPPER em nome/marca/
    fabricante e unidade em sigla UPPER. Idempotente: rodar 2x não muda nada.
    Sem --apply é dry-run (mostra quantos/quaes e nao altera nada)."""
    from app.models import db, Produto, allow_all_tenants
    from app.services.cadastro_guardiao import canonicalizar_texto

    with allow_all_tenants():
        nomes, marcas, unidades = [], [], []
        produtos = Produto.query.with_deleted().all()
        for p in produtos:
            nome_novo = canonicalizar_texto(p.nome)
            if nome_novo and nome_novo != p.nome:
                nomes.append((p.id, p.nome, nome_novo))
            if p.marca and canonicalizar_texto(p.marca) != p.marca:
                marcas.append((p.id, p.marca, canonicalizar_texto(p.marca)))
            if p.unidade_medida and canonicalizar_texto(p.unidade_medida) != p.unidade_medida:
                unidades.append((p.id, p.unidade_medida, canonicalizar_texto(p.unidade_medida)))

        click.echo(f"[{'APLICANDO' if apply else 'DRY-RUN'}] Nomes a normalizar: {len(nomes)} / "
                   f"Marcas: {len(marcas)} / Unidades: {len(unidades)} (de {len(produtos)} produtos)")
        for pid, antes, depois in nomes[:20]:
            click.echo(f"  nome #{pid}: '{antes}' -> '{depois}'")
        for pid, antes, depois in marcas[:10]:
            click.echo(f"  marca #{pid}: '{antes}' -> '{depois}'")

        if not apply:
            click.echo("-> Rode com --apply para efetivar a normalizacao.")
            return
        for pid, _, novo in nomes:
            Produto.query.get(pid).nome = novo
        for pid, _, novo in marcas:
            Produto.query.get(pid).marca = novo
        for pid, _, novo in unidades:
            Produto.query.get(pid).unidade_medida = novo
        db.session.commit()
        click.echo(f"[OK] Normalizados {len(nomes)} nomes, {len(marcas)} marcas, {len(unidades)} unidades.")
