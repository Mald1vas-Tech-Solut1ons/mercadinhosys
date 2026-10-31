"""produtos.subcategoria e colunas de taxonomia: largura das chaves da taxonomia oficial.

A chave de subcategoria mais longa da TAXONOMIA tem 68 caracteres
(`embalagem_descartavel.embalagen_delivery.marmitex_embalagen_delivery`) e 104 subcategorias passam
de 50 caracteres (ex.: `brinquedos.educativo_criativo.arte_pintura_massinha`, 51 chars). O modal
envia a chave em `data["subcategoria"]` e `criar_produto`/`atualizar_produto` gravam esse valor
também na coluna `produtos.subcategoria`, que era `varchar(50)` — estourando
`StringDataRightTruncation: value too long for type character varying(50)` no PostgreSQL.

Alarga `produtos.subcategoria` para 80 de forma idempotente e garante as colunas da taxonomia
oficial (`familia_produto`, `categoria_oficial`, `subcategoria_oficial`) em `produtos` e
`venda_itens` quando `SKIP_SCHEMA_SYNC=true`.
"""
from alembic import op
import sqlalchemy as sa


revision = 'd5e7f9a1b3c5'
down_revision = 'c2e4f8a1b9d0'
branch_labels = None
depends_on = None

ALVOS = {
    'produtos': {
        'subcategoria': 80,
        'familia_produto': 40,
        'categoria_oficial': 60,
        'subcategoria_oficial': 80,
    },
    'venda_itens': {
        'familia_produto': 40,
        'categoria_oficial': 60,
        'subcategoria_oficial': 80,
    },
}


def upgrade():
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tabelas = set(insp.get_table_names())

    for tabela, colunas_alvo in ALVOS.items():
        if tabela not in tabelas:
            continue
        atuais = {c['name']: c for c in insp.get_columns(tabela)}
        for nome, alvo in colunas_alvo.items():
            coluna = atuais.get(nome)
            if coluna is None:
                op.add_column(tabela, sa.Column(nome, sa.String(alvo), nullable=True))
                continue
            largura = getattr(coluna['type'], 'length', None)
            if largura is None or largura >= alvo:
                continue
            if bind.dialect.name == 'postgresql':
                op.alter_column(
                    tabela,
                    nome,
                    existing_type=sa.String(largura),
                    type_=sa.String(alvo),
                    existing_nullable=coluna['nullable'],
                )
            else:
                with op.batch_alter_table(tabela) as lote:
                    lote.alter_column(
                        nome,
                        existing_type=sa.String(largura),
                        type_=sa.String(alvo),
                        existing_nullable=coluna['nullable'],
                    )


def downgrade():
    """Sem volta: estreitar derrubaria linha já gravada com chave > 50 caracteres."""
    pass
