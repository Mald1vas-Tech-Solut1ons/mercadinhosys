"""
Serviço centralizado de cálculos RFM (Recency, Frequency, Monetary)
Elimina duplicação em pdv.py, relatorios.py e models.py
"""
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Dict, List, Optional
from app.models import db, Venda, Cliente
from app.utils.timezone import iso_utc

class RFMService:
    """Serviço de análise RFM"""
    
    # Configurações padrão
    JANELA_DIAS = 180
    PESO_RECENCY = 0.4
    PESO_FREQUENCY = 0.3
    PESO_MONETARY = 0.3
    
    @staticmethod
    def calcular_rfm_cliente(cliente_id: int, estabelecimento_id: int, janela_dias: int = JANELA_DIAS) -> Dict:
        """
        Calcula métricas RFM para um cliente específico
        
        Args:
            cliente_id: ID do cliente
            estabelecimento_id: ID do estabelecimento
            janela_dias: Janela de análise em dias
            
        Returns:
            Dict com métricas RFM e segmento
        """
        data_inicio = datetime.now(timezone.utc) - timedelta(days=janela_dias)
        
        # Buscar vendas do cliente
        vendas = Venda.query.filter(
            Venda.estabelecimento_id == estabelecimento_id,
            Venda.cliente_id == cliente_id,
            Venda.data_venda >= data_inicio,
            Venda.status == "finalizada"
        ).all()
        
        if not vendas:
            return {
                "segmento": "Novo",
                "sugerir_desconto": False,
                "recency_days": None,
                "recency_score": 0,
                "frequency": 0,
                "frequency_score": 0,
                "monetary": 0.0,
                "monetary_score": 0,
                "rfm_score": 0,
                "ultima_compra": None
            }
        
        # Calcular métricas
        now = datetime.now(timezone.utc)
        ultima_compra = max(v.data_venda for v in vendas)
        recency_days = (now - ultima_compra).days
        frequency = len(vendas)
        monetary = sum(float(v.total) for v in vendas)
        
        # Calcular scores (1-5)
        recency_score = RFMService._calcular_recency_score(recency_days)
        frequency_score = RFMService._calcular_frequency_score(frequency)
        monetary_score = RFMService._calcular_monetary_score(monetary)
        
        # Score RFM ponderado
        rfm_score = (
            recency_score * RFMService.PESO_RECENCY +
            frequency_score * RFMService.PESO_FREQUENCY +
            monetary_score * RFMService.PESO_MONETARY
        )
        
        # Determinar segmento
        segmento = RFMService._determinar_segmento(recency_score, frequency_score, monetary_score)
        
        # Sugerir desconto para clientes em risco
        sugerir_desconto = segmento in ["Em Risco", "Hibernando", "Perdido"]
        
        return {
            "segmento": segmento,
            "sugerir_desconto": sugerir_desconto,
            "recency_days": recency_days,
            "recency_score": recency_score,
            "frequency": frequency,
            "frequency_score": frequency_score,
            "monetary": round(monetary, 2),
            "monetary_score": monetary_score,
            "rfm_score": round(rfm_score, 2),
            "ultima_compra": iso_utc(ultima_compra) if ultima_compra else None
        }
    
    @staticmethod
    def _calcular_recency_score(recency_days: int) -> int:
        """Calcula score de recência (quanto menor, melhor)"""
        if recency_days <= 30:
            return 5
        elif recency_days <= 60:
            return 4
        elif recency_days <= 90:
            return 3
        elif recency_days <= 120:
            return 2
        else:
            return 1
    
    @staticmethod
    def _calcular_frequency_score(frequency: int) -> int:
        """Calcula score de frequência (quanto maior, melhor)"""
        if frequency >= 10:
            return 5
        elif frequency >= 7:
            return 4
        elif frequency >= 4:
            return 3
        elif frequency >= 2:
            return 2
        else:
            return 1
    
    @staticmethod
    def _calcular_monetary_score(monetary: float) -> int:
        """Calcula score monetário (quanto maior, melhor)"""
        if monetary >= 1000:
            return 5
        elif monetary >= 500:
            return 4
        elif monetary >= 200:
            return 3
        elif monetary >= 50:
            return 2
        else:
            return 1
    
    @staticmethod
    def _determinar_segmento(r: int, f: int, m: int) -> str:
        """
        Determina segmento do cliente baseado em scores RFM
        
        Segmentos:
        - Campeões: R=5, F=5, M=5
        - Leais: R>=4, F>=4
        - Potencial: R>=4, F<4
        - Novos: R>=4, F=1
        - Promissores: R>=3, F<=2, M>=3
        - Precisa Atenção: R=3, F<=3
        - Em Risco: R=2
        - Hibernando: R=1, F>=2
        - Perdido: R=1, F=1
        """
        if r == 5 and f == 5 and m == 5:
            return "Campeões"
        elif r >= 4 and f >= 4:
            return "Leais"
        elif r >= 4 and f == 1:
            return "Novos"
        elif r >= 4 and f < 4:
            return "Potencial"
        elif r >= 3 and f <= 2 and m >= 3:
            return "Promissores"
        elif r == 3 and f <= 3:
            return "Precisa Atenção"
        elif r == 2:
            return "Em Risco"
        elif r == 1 and f >= 2:
            return "Hibernando"
        else:
            return "Perdido"
    
    @staticmethod
    def calcular_rfm_estabelecimento(estabelecimento_id: int, janela_dias: int = JANELA_DIAS) -> Dict:
        """
        Calcula análise RFM para todos os clientes do estabelecimento
        
        Args:
            estabelecimento_id: ID do estabelecimento
            janela_dias: Janela de análise em dias
            
        Returns:
            Dict com análise agregada
        """
        data_inicio = datetime.now(timezone.utc) - timedelta(days=janela_dias)
        
        # Buscar clientes com vendas
        clientes_com_vendas = db.session.query(Cliente.id).join(
            Venda, Cliente.id == Venda.cliente_id
        ).filter(
            Cliente.estabelecimento_id == estabelecimento_id,
            Venda.data_venda >= data_inicio,
            Venda.status == "finalizada"
        ).distinct().all()
        
        # Calcular RFM para cada cliente
        segmentos = {}
        total_clientes = 0
        
        for (cliente_id,) in clientes_com_vendas:
            rfm = RFMService.calcular_rfm_cliente(cliente_id, estabelecimento_id, janela_dias)
            segmento = rfm["segmento"]
            
            if segmento not in segmentos:
                segmentos[segmento] = {
                    "quantidade": 0,
                    "valor_total": 0,
                    "ticket_medio": 0
                }
            
            segmentos[segmento]["quantidade"] += 1
            segmentos[segmento]["valor_total"] += rfm["monetary"]
            total_clientes += 1
        
        # Calcular ticket médio por segmento
        for segmento in segmentos:
            if segmentos[segmento]["quantidade"] > 0:
                segmentos[segmento]["ticket_medio"] = round(
                    segmentos[segmento]["valor_total"] / segmentos[segmento]["quantidade"],
                    2
                )
        
        return {
            "total_clientes": total_clientes,
            "segmentos": segmentos,
            "janela_dias": janela_dias,
            "data_analise": iso_utc(datetime.now(timezone.utc))
        }
    
    @staticmethod
    def obter_clientes_em_risco(estabelecimento_id: int, limite: int = 10) -> List[Dict]:
        """
        Retorna lista de clientes em risco de churn
        
        Args:
            estabelecimento_id: ID do estabelecimento
            limite: Número máximo de clientes
            
        Returns:
            Lista de clientes em risco
        """
        data_inicio = datetime.now(timezone.utc) - timedelta(days=RFMService.JANELA_DIAS)
        
        # Buscar clientes com vendas
        clientes = db.session.query(Cliente).join(
            Venda, Cliente.id == Venda.cliente_id
        ).filter(
            Cliente.estabelecimento_id == estabelecimento_id,
            Venda.data_venda >= data_inicio,
            Venda.status == "finalizada"
        ).distinct().all()
        
        clientes_em_risco = []
        
        for cliente in clientes:
            rfm = RFMService.calcular_rfm_cliente(cliente.id, estabelecimento_id)
            
            if rfm["segmento"] in ["Em Risco", "Hibernando", "Perdido"]:
                clientes_em_risco.append({
                    "cliente_id": cliente.id,
                    "nome": cliente.nome,
                    "email": cliente.email,
                    "telefone": cliente.telefone,
                    "segmento": rfm["segmento"],
                    "recency_days": rfm["recency_days"],
                    "frequency": rfm["frequency"],
                    "monetary": rfm["monetary"],
                    "rfm_score": rfm["rfm_score"]
                })
        
        # Ordenar por score RFM (menor primeiro = maior risco)
        clientes_em_risco.sort(key=lambda x: x["rfm_score"])
        
        return clientes_em_risco[:limite]
