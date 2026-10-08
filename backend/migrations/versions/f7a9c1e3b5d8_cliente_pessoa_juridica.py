"""Cliente PJ, dependentes do funcionário e alíquota de impostos do DRE.

Cliente: tipo de pessoa, CNPJ, razão social, inscrição estadual e contato.
Funcionário: número de dependentes (dedução do IRRF).
Configuração: alíquota efetiva de impostos sobre vendas (DRE).

Migração expansiva: a versão anterior da aplicação continua funcionando com o
esquema novo (colunas novas são nulas ou têm padrão). O CPF passa a aceitar
nulo para pessoa jurídica; clientes existentes viram PF.
"""
from alembic import op
import sqlalchemy as sa

revision = 'f7a9c1e3b5d8'
down_revision = 'f5d7b9c1e3a6'
branch_labels = None
depends_on = None

NOVAS = (('cnpj', sa.String(18)), ('razao_social', sa.String(150)),
         ('inscricao_estadual', sa.String(20)), ('contato_nome', sa.String(100)))


def _inspetor():
    return sa.inspect(op.get_bind())


def upgrade():
    existentes = {c['name'] for c in _inspetor().get_columns('clientes')}
    with op.batch_alter_table('clientes') as lote:
        if 'tipo_pessoa' not in existentes:
            lote.add_column(sa.Column('tipo_pessoa', sa.String(2), nullable=False, server_default='PF'))
        for nome, tipo in NOVAS:
            if nome not in existentes:
                lote.add_column(sa.Column(nome, tipo))
        lote.alter_column('cpf', existing_type=sa.String(14), nullable=True)
    if 'numero_dependentes' not in {c['name'] for c in _inspetor().get_columns('funcionarios')}:
        with op.batch_alter_table('funcionarios') as lote:
            lote.add_column(sa.Column('numero_dependentes', sa.Integer(), nullable=False, server_default='0'))
    if 'aliquota_impostos_venda' not in {c['name'] for c in _inspetor().get_columns('configuracoes')}:
        with op.batch_alter_table('configuracoes') as lote:
            lote.add_column(sa.Column('aliquota_impostos_venda', sa.Numeric(5, 2), nullable=True))
    inspetor = _inspetor()
    if 'uq_cliente_estab_cnpj' not in {u['name'] for u in inspetor.get_unique_constraints('clientes')}:
        with op.batch_alter_table('clientes') as lote:
            lote.create_unique_constraint('uq_cliente_estab_cnpj', ['estabelecimento_id', 'cnpj'])
    if 'ix_cliente_cnpj' not in {i['name'] for i in inspetor.get_indexes('clientes')}:
        op.create_index('ix_cliente_cnpj', 'clientes', ['cnpj'])


def downgrade():
    bind = op.get_bind()
    if 'aliquota_impostos_venda' in {c['name'] for c in _inspetor().get_columns('configuracoes')}:
        with op.batch_alter_table('configuracoes') as lote:
            lote.drop_column('aliquota_impostos_venda')
    if 'numero_dependentes' in {c['name'] for c in _inspetor().get_columns('funcionarios')}:
        with op.batch_alter_table('funcionarios') as lote:
            lote.drop_column('numero_dependentes')
    # CPF volta a ser obrigatório: PJ passa a usar os dígitos do CNPJ para não perder o cadastro.
    if bind.dialect.name == 'postgresql':
        op.execute("UPDATE clientes SET cpf = left(regexp_replace(coalesce(cnpj, ''), '[^0-9]', '', 'g'), 14) WHERE cpf IS NULL")
    else:
        op.execute("UPDATE clientes SET cpf = substr(replace(replace(replace(coalesce(cnpj, ''), '.', ''), '/', ''), '-', ''), 1, 14) WHERE cpf IS NULL")
    inspetor = _inspetor()
    if 'ix_cliente_cnpj' in {i['name'] for i in inspetor.get_indexes('clientes')}:
        op.drop_index('ix_cliente_cnpj', table_name='clientes')
    existentes = {c['name'] for c in inspetor.get_columns('clientes')}
    tem_unica = 'uq_cliente_estab_cnpj' in {u['name'] for u in inspetor.get_unique_constraints('clientes')}
    with op.batch_alter_table('clientes') as lote:
        if tem_unica:
            lote.drop_constraint('uq_cliente_estab_cnpj', type_='unique')
        for nome in ('contato_nome', 'inscricao_estadual', 'razao_social', 'cnpj', 'tipo_pessoa'):
            if nome in existentes:
                lote.drop_column(nome)
        lote.alter_column('cpf', existing_type=sa.String(14), nullable=False)
