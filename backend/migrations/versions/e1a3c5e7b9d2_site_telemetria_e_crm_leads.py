"""Rastreio do site público e CRM de leads do super admin.

- site_visitantes / site_acessos / site_eventos: medição do site (landing, segmentos,
  regiões) só para quem aceitou cookies de medição; sem nome, sem IP.
- leads ganha o funil do CRM (etapa, loja, segmento, cidade, próximo contato, valor
  digitado, motivo de perda), o vínculo com o visitante e com a loja criada.
- lead_historico: linha do tempo de cada lead.

Idempotente: só cria o que falta (bancos com SKIP_SCHEMA_SYNC).
"""
from alembic import op
import sqlalchemy as sa


revision = 'e1a3c5e7b9d2'
down_revision = 'd5e7f9a1b3c5'
branch_labels = None
depends_on = None

def colunas_lead():
    """Colunas novas de leads (instâncias novas a cada chamada: Column não pode ser reaproveitada)."""
    return [
        sa.Column('etapa', sa.String(20), nullable=False, server_default='novo'),
        sa.Column('nome_loja', sa.String(150)),
        sa.Column('segmento', sa.String(60)),
        sa.Column('cidade', sa.String(80)),
        sa.Column('bairro', sa.String(80)),
        sa.Column('valor_mensal', sa.Numeric(10, 2)),
        sa.Column('proximo_contato', sa.Date()),
        sa.Column('motivo_perda', sa.String(200)),
        sa.Column('loja_criada_id', sa.Integer()),
        sa.Column('visitante_id', sa.String(36)),
        sa.Column('origem_primeira', sa.JSON()),
        sa.Column('origem_ultima', sa.JSON()),
        sa.Column('atualizado_em', sa.DateTime()),
    ]


def upgrade():
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tabelas = set(insp.get_table_names())

    if 'leads' in tabelas:
        existentes = {c['name'] for c in insp.get_columns('leads')}
        for coluna in colunas_lead():
            if coluna.name not in existentes:
                op.add_column('leads', coluna)
        indices = {i['name'] for i in insp.get_indexes('leads')}
        if 'ix_leads_visitante_id' not in indices:
            op.create_index('ix_leads_visitante_id', 'leads', ['visitante_id'])

    if 'lead_historico' not in tabelas:
        op.create_table(
            'lead_historico',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('lead_id', sa.Integer(), sa.ForeignKey('leads.id', ondelete='CASCADE'), nullable=False),
            sa.Column('tipo', sa.String(20), nullable=False),
            sa.Column('texto', sa.Text(), nullable=False),
            sa.Column('autor', sa.String(100)),
            sa.Column('criado_em', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        )
        op.create_index('ix_lead_historico_lead_id', 'lead_historico', ['lead_id'])

    if 'site_visitantes' not in tabelas:
        op.create_table(
            'site_visitantes',
            sa.Column('id', sa.String(36), primary_key=True),
            sa.Column('criado_em', sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column('visto_em', sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column('origem_primeira', sa.JSON()),
            sa.Column('origem_ultima', sa.JSON()),
            sa.Column('dispositivo', sa.String(20)),
            sa.Column('interno', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('lead_id', sa.Integer(), sa.ForeignKey('leads.id', ondelete='SET NULL')),
        )

    if 'site_acessos' not in tabelas:
        op.create_table(
            'site_acessos',
            sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), primary_key=True, autoincrement=True),
            sa.Column('visitante_id', sa.String(36), nullable=False),
            sa.Column('sessao_id', sa.String(36), nullable=False),
            sa.Column('rota', sa.String(300), nullable=False),
            sa.Column('referrer', sa.String(300)),
            sa.Column('utm_source', sa.String(120)),
            sa.Column('utm_medium', sa.String(120)),
            sa.Column('utm_campaign', sa.String(120)),
            sa.Column('dispositivo', sa.String(20)),
            sa.Column('duracao_seg', sa.Integer()),
            sa.Column('rolagem_pct', sa.Integer()),
            sa.Column('criado_em', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        )
        for coluna in ('visitante_id', 'sessao_id', 'criado_em'):
            op.create_index(f'ix_site_acessos_{coluna}', 'site_acessos', [coluna])

    if 'site_eventos' not in tabelas:
        op.create_table(
            'site_eventos',
            sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), primary_key=True, autoincrement=True),
            sa.Column('visitante_id', sa.String(36), nullable=False),
            sa.Column('sessao_id', sa.String(36), nullable=False),
            sa.Column('rota', sa.String(300), nullable=False),
            sa.Column('evento', sa.String(30), nullable=False),
            sa.Column('rotulo', sa.String(120)),
            sa.Column('criado_em', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        )
        for coluna in ('visitante_id', 'sessao_id', 'evento', 'criado_em'):
            op.create_index(f'ix_site_eventos_{coluna}', 'site_eventos', [coluna])


def downgrade():
    for tabela in ('site_eventos', 'site_acessos', 'site_visitantes', 'lead_historico'):
        op.execute(f'DROP TABLE IF EXISTS {tabela}')
