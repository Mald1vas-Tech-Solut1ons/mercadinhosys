"""Idempotência persistente de notificações Efí confirmadas pelo provedor."""
from alembic import op
import sqlalchemy as sa

revision = 'f4c6a8b0d2e4'
down_revision = 'f3b5a7c9d1e2'
branch_labels = None
depends_on = None


def upgrade():
    if 'efi_webhook_events' not in sa.inspect(op.get_bind()).get_table_names():
        op.create_table('efi_webhook_events',
            sa.Column('event_key', sa.String(64), primary_key=True),
            sa.Column('charge_id', sa.String(50), nullable=False),
            sa.Column('status', sa.String(20), nullable=False),
            sa.Column('received_at', sa.DateTime(), nullable=False))
        op.create_index('ix_efi_webhook_events_charge_id', 'efi_webhook_events', ['charge_id'])


def downgrade():
    op.drop_table('efi_webhook_events')
