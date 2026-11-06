"""Aviso diário de estoque e validade para o dono da loja — FUNÇÃO INCOMPLETA (não está ligada).

O que já existe: as três consultas (ruptura, vencendo em N dias, vencidos). Os alertas DENTRO do app
já funcionam por outro caminho (GET /api/dashboard/alertas, respeitando alerta_estoque_minimo e
dias_alerta_validade da Configuracao).

O que falta para ligar (levantado em 06/11/2026):
  - as funções de envio importadas abaixo NÃO existem em email_service (este módulo não importa);
  - usar `Produto.quantidade_minima` (o modelo não tem `estoque_minimo`) e os lotes (estoque_service);
  - respeitar Configuracao.alerta_estoque_minimo, dias_alerta_validade e alertas_email/alertas_whatsapp;
  - agendar no Oracle (timer systemd, como o mercadinhosys-backup.timer), 1x por dia de manhã.
"""
import logging
from datetime import timedelta
from app.models import db, Produto, Estabelecimento
from app.utils.timezone import hoje_local
from app.services.email_service import notificar_estoque_baixo, notificar_vencimento_proximo

logger = logging.getLogger(__name__)

class EstoqueAlertsTask:
    """
    Serviço para verificar e alertar sobre:
    - Ruptura de Estoque (Estoque Mínimo)
    - Vencimento de Produtos Próximo (30 dias ou definido no produto)
    """

    @staticmethod
    def run_daily_checks(app):
        """
        Executa as verificações de estoque.
        Deve ser chamado por um cronjob diário ou APScheduler.
        """
        with app.app_context():
            logger.info("Iniciando rotina de verificação de estoque e validade...")
            
            # Buscar todos os estabelecimentos
            estabelecimentos = Estabelecimento.query.all()
            
            for estab in estabelecimentos:
                logger.info(f"Verificando estabelecimento {estab.nome_fantasia} (ID: {estab.id})")
                
                # 1. Ruptura de Estoque (Abaixo do mínimo)
                produtos_ruptura = Produto.query.filter(
                    Produto.estabelecimento_id == estab.id,
                    Produto.ativo == True,
                    Produto.quantidade <= Produto.estoque_minimo
                ).all()
                
                if produtos_ruptura:
                    logger.info(f"Encontrados {len(produtos_ruptura)} produtos em ruptura/baixo estoque.")
                    # Na vida real, enviamos push notification, email ou populamos a tabela de alertas
                    # notificar_estoque_baixo(estab, produtos_ruptura)
                    
                # 2. Vencimento Próximo
                hoje = hoje_local()
                dias_alerta = 30 # Default 30 dias para vencer
                data_limite = hoje + timedelta(days=dias_alerta)
                
                produtos_vencimento = Produto.query.filter(
                    Produto.estabelecimento_id == estab.id,
                    Produto.ativo == True,
                    Produto.data_validade != None,
                    Produto.data_validade <= data_limite,
                    Produto.data_validade >= hoje
                ).all()
                
                if produtos_vencimento:
                    logger.info(f"Encontrados {len(produtos_vencimento)} produtos vencendo nos próximos {dias_alerta} dias.")
                    # notificar_vencimento_proximo(estab, produtos_vencimento)
                    
                # 3. Produtos Vencidos
                produtos_vencidos = Produto.query.filter(
                    Produto.estabelecimento_id == estab.id,
                    Produto.ativo == True,
                    Produto.data_validade != None,
                    Produto.data_validade < hoje
                ).all()
                
                if produtos_vencidos:
                     logger.warning(f"Encontrados {len(produtos_vencidos)} produtos VENCIDOS.")
                     
            logger.info("Rotina de verificação finalizada com sucesso.")
            return True
