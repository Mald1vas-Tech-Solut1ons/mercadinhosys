"""categorias_produto.codigo/nome: largura das chaves da taxonomia oficial.

A chave oficial mais longa tem 41 caracteres e o nome qualificado "<Família> › <Categoria>" chega a
46 — mas a coluna em produção era varchar(20). Todo cadastro de produto com categoria real morria
com `StringDataRightTruncation: value too long for type character varying(20)` e o cliente via um
500 em cima do formulário. O SQLite dos testes não aplica tamanho de varchar, então a suíte ficava
verde: mesma classe do f3b5d7e9a1c3 (consumo_api_externa.provedor).

Migração só amplia — nunca reescreve dado e não invalida a release que está no ar (varchar maior
aceita tudo que o código antigo aceitava). Idempotente: se a coluna já estiver na largura alvo (ou
for TEXT), não faz nada.
"""
from alembic import op
import sqlalchemy as sa

revision = '9c4e1a7b6d20'
down_revision = 'f3b5d7e9a1c3'
branch_labels = None
depends_on = None

TABELA = 'categorias_produto'
# 120 = piso do model (CategoriaProduto.codigo/nome). Folga para categoria escrita à mão.
LARGURAS = {'codigo': 120, 'nome': 120}


def _colunas(bind):
    return {c['name']: c for c in sa.inspect(bind).get_columns(TABELA)}


def upgrade():
    bind = op.get_bind()
    colunas = _colunas(bind)
    for nome, alvo in LARGURAS.items():
        coluna = colunas.get(nome)
        if coluna is None:
            # Quem cria a coluna é o model (bootstrap/create_all); aqui só alargamos o que existe.
            continue
        atual = getattr(coluna['type'], 'length', None)
        if atual is None or atual >= alvo:
            continue
        op.alter_column(TABELA, nome, existing_type=sa.String(atual), type_=sa.String(alvo),
                        existing_nullable=coluna['nullable'])


def downgrade():
    """Sem volta: estreitar derrubaria linha já gravada (perda de dado) — por isso é no-op."""
    pass
