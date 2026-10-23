"""Tokens de uso único para ativar conta e redefinir senha (só o hash fica no banco)."""
from alembic import op
import sqlalchemy as sa

revision = 'e3a5c7d9f1b4'
down_revision = 'd1f3b5c7e9a2'
branch_labels = None
depends_on = None


def upgrade():
    # Expansiva: tabela nova, nada existente é alterado.
    if 'tokens_senha' in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        'tokens_senha',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('funcionario_id', sa.Integer(), sa.ForeignKey('funcionarios.id', ondelete='CASCADE'), nullable=False),
        sa.Column('finalidade', sa.String(20), nullable=False),
        sa.Column('token_hash', sa.String(64), nullable=False),
        sa.Column('expira_em', sa.DateTime(), nullable=False),
        sa.Column('usado_em', sa.DateTime(), nullable=True),
        sa.Column('criado_em', sa.DateTime(), nullable=False),
        sa.UniqueConstraint('token_hash', name='uq_tokens_senha_token_hash'),
    )
    op.create_index('ix_tokens_senha_funcionario_id', 'tokens_senha', ['funcionario_id'])


def downgrade():
    # Tokens são descartáveis (links de e-mail); apagar só invalida links pendentes.
    op.drop_index('ix_tokens_senha_funcionario_id', table_name='tokens_senha')
    op.drop_table('tokens_senha')
