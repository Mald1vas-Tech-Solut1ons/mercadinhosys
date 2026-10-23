"""Backfill: migrar preco_ref_mercado de atributos_json para as colunas novas (Fase A).

Durante o cadastro inicial da clientela antiga, o agente gravou nos produtos
`atributos_json` com as chaves `preco_ref_mercado` e `fonte` (ou `fonte_ref_mercado`).
Este script copia o valor para as colunas de precificação reversa, marca
origem_custo="estimado" e remove as chaves migradas — sem tocar em preco_custo
nem preco_venda.

USO (nunca rode contra produção; quem roda é o CTO):
    python backend/scripts/backfill_custo_estimado.py --estabelecimento-id 1 --dry-run
    python backend/scripts/backfill_custo_estimado.py --estabelecimento-id 1 --aplicar

Idempotente: rodar duas vezes não muda nada na segunda.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import create_app, db  # noqa: E402
from app.models import Produto  # noqa: E402


def _normalizar_fonte(valor) -> str:
    """shopee → shopee; mercado livre/ml/mercadolivre → mercado_livre; demais → outro."""
    v = str(valor or "").strip().lower()
    if not v:
        return "outro"
    if "shopee" in v:
        return "shopee"
    if v in ("mercado_livre", "mercadolivre") or "mercado" in v or v == "ml":
        return "mercado_livre"
    return "outro"


def _atributos(produto) -> dict:
    try:
        dados = json.loads(produto.atributos_json or "{}")
        return dados if isinstance(dados, dict) else {}
    except Exception:
        return {}


def main():
    parser = argparse.ArgumentParser(description="Backfill de custo estimado (Fase A)")
    parser.add_argument("--estabelecimento-id", type=int, required=True)
    parser.add_argument("--aplicar", action="store_true",
                        help="Grava as mudanças (padrão: dry-run, só relatório)")
    parser.add_argument("--dry-run", action="store_true", default=True)
    args = parser.parse_args()

    app = create_app()
    with app.app_context():
        produtos = Produto.query.filter_by(estabelecimento_id=args.estabelecimento_id).all()
        total = 0
        migrados = 0
        ignorados = []

        for produto in produtos:
            atributos = _atributos(produto)
            ref_bruta = atributos.get("preco_ref_mercado")
            if ref_bruta in (None, "", 0, "0"):
                if ref_bruta in (0, "0"):
                    ignorados.append((produto.id, produto.nome, "preco_ref_mercado=0"))
                continue

            try:
                from decimal import Decimal, InvalidOperation
                ref = Decimal(str(ref_bruta).replace(",", "."))
                if not ref.is_finite() or ref <= 0:
                    raise InvalidOperation
            except (InvalidOperation, ValueError):
                ignorados.append((produto.id, produto.nome, f"preco_ref_mercado inválido: {ref_bruta!r}"))
                continue

            total += 1
            fonte_bruta = atributos.get("fonte_ref_mercado", atributos.get("fonte"))
            fonte = _normalizar_fonte(fonte_bruta)

            if getattr(produto, "origem_custo", "estimado") == "estimado" \
                    and produto.preco_referencia_mercado == ref:
                ignorados.append((produto.id, produto.nome, "já migrado"))
                continue

            migrados += 1
            print(f"  produto {produto.id} «{produto.nome}»: {ref_bruta} ({fonte_bruta!r}) → "
                  f"ref={ref} fonte={fonte} origem=estimado")

            if args.aplicar:
                produto.preco_referencia_mercado = ref
                produto.fonte_referencia_mercado = fonte
                produto.referencia_mercado_em = produto.referencia_mercado_em or None
                produto.origem_custo = "estimado"
                for chave in ("preco_ref_mercado", "fonte", "fonte_ref_mercado"):
                    atributos.pop(chave, None)
                produto.atributos = atributos

        if args.aplicar:
            db.session.commit()

        modo = "APLICADO" if args.aplicar else "DRY-RUN (nada gravado; use --aplicar)"
        print(f"\n=== BACKFILL {modo} ===")
        print(f"produtos avaliados:  {len(produtos)}")
        print(f"com referência:      {total}")
        print(f"migrados             : {migrados}")
        print(f"ignorados            : {len(ignorados)}")
        for pid, nome, motivo in ignorados:
            print(f"  - [{pid}] {nome}: {motivo}")
        return 0


if __name__ == "__main__":
    sys.exit(main())