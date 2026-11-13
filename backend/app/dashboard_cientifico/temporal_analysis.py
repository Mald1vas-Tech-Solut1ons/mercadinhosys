from datetime import timezone
"""
Análise Temporal Avançada - Pensando como o dono do mercado
Responde: Qual horário vende mais? Qual produto em cada hora? Quanto faturar por hora?
"""

from typing import Dict, List, Any
from datetime import datetime, timedelta
from sqlalchemy import func, extract
from app.models import db, Venda, VendaItem, Produto
import logging

logger = logging.getLogger(__name__)


class TemporalAnalysis:
    """Análises temporais que importam para o dono do mercado"""

    @staticmethod
    def get_hourly_sales_by_category(estabelecimento_id: int, days: int = 30) -> Dict[str, Any]:
        """
        Qual categoria vende em cada hora?
        Exemplo: Cerveja vende mais à noite, Pão vende mais de manhã
        """
        try:
            start_date = datetime.now(timezone.utc) - timedelta(days=days)
            from app.models import CategoriaProduto
            from app.utils.query_helpers import get_hour_extract
            hour_extract = get_hour_extract(Venda.data_venda)

            query = db.session.query(
                hour_extract.label('hora'),
                func.coalesce(CategoriaProduto.nome, 'Sem Categoria').label('categoria'),
                func.sum(VendaItem.total_item).label('faturamento')
            ).join(
                VendaItem, Venda.id == VendaItem.venda_id
            ).outerjoin(
                Produto, VendaItem.produto_id == Produto.id
            ).outerjoin(
                CategoriaProduto, Produto.categoria_id == CategoriaProduto.id
            ).filter(
                Venda.data_venda >= start_date,
                Venda.status == 'finalizada'
            )
            
            if str(estabelecimento_id).lower() != 'all':
                query = query.filter(Venda.estabelecimento_id == estabelecimento_id)
                
            results = query.group_by(hour_extract, CategoriaProduto.nome).all()

            hourly_cat = {}
            for r in results:
                if r.hora is None: continue
                try: hora_str = f"{int(r.hora):02d}:00"
                except: continue
                cat = r.categoria
                fat = float(r.faturamento or 0)
                
                if cat not in hourly_cat:
                    hourly_cat[cat] = {}
                hourly_cat[cat][hora_str] = {"faturamento": fat}
                
            return hourly_cat
            
        except Exception as e:
            db.session.rollback()
            logger.error(f"Erro em get_hourly_sales_by_category: {e}")
            return {}

    @staticmethod
    def get_period_analysis(estabelecimento_id: int, days: int = 30) -> Dict[str, Any]:
        """
        Análise por período do dia: Manhã (6-12), Tarde (12-18), Noite (18-24)
        Responde: Como varia o faturamento ao longo do dia?
        """
        try:
            start_date = datetime.now(timezone.utc) - timedelta(days=days)
            
            # Compatibilidade cross-database para extração de hora
            # Compatibilidade cross-database para extração de hora
            from app.utils.query_helpers import get_hour_extract
            hour_extract = get_hour_extract(Venda.data_venda)

            query = db.session.query(
                hour_extract.label('hora'),
                func.count(Venda.id).label('qtd_vendas'),
                func.sum(Venda.total).label('faturamento'),
                func.avg(Venda.total).label('ticket_medio')
            ).filter(
                Venda.data_venda >= start_date,
                Venda.status == 'finalizada'
            )
            
            if str(estabelecimento_id).lower() != 'all':
                query = query.filter(Venda.estabelecimento_id == estabelecimento_id)
                
            results = query.group_by(
                hour_extract
            ).order_by(
                hour_extract
            ).all()
            
            periodos = {
                'manha': {'horas': list(range(6, 12)), 'vendas': 0, 'faturamento': 0, 'ticket_medio': 0, 'qtd_horas': 0},
                'tarde': {'horas': list(range(12, 18)), 'vendas': 0, 'faturamento': 0, 'ticket_medio': 0, 'qtd_horas': 0},
                'noite': {'horas': list(range(18, 24)), 'vendas': 0, 'faturamento': 0, 'ticket_medio': 0, 'qtd_horas': 0}
            }
            
            for r in results:
                if r.hora is None:
                    continue
                try:
                    hora = int(r.hora)
                except (ValueError, TypeError):
                    continue
                qtd = r.qtd_vendas or 0
                fat = float(r.faturamento or 0)
                ticket = float(r.ticket_medio or 0)
                
                if 6 <= hora < 12:
                    periodos['manha']['vendas'] += qtd
                    periodos['manha']['faturamento'] += fat
                    periodos['manha']['ticket_medio'] += ticket
                    periodos['manha']['qtd_horas'] += 1
                elif 12 <= hora < 18:
                    periodos['tarde']['vendas'] += qtd
                    periodos['tarde']['faturamento'] += fat
                    periodos['tarde']['ticket_medio'] += ticket
                    periodos['tarde']['qtd_horas'] += 1
                elif 18 <= hora < 24:
                    periodos['noite']['vendas'] += qtd
                    periodos['noite']['faturamento'] += fat
                    periodos['noite']['ticket_medio'] += ticket
                    periodos['noite']['qtd_horas'] += 1
            
            # Calcular médias
            for periodo in periodos:
                if periodos[periodo]['qtd_horas'] > 0:
                    periodos[periodo]['ticket_medio'] = periodos[periodo]['ticket_medio'] / periodos[periodo]['qtd_horas']
                    periodos[periodo]['faturamento_por_hora'] = periodos[periodo]['faturamento'] / periodos[periodo]['qtd_horas']
                    periodos[periodo]['vendas_por_hora'] = periodos[periodo]['vendas'] / periodos[periodo]['qtd_horas']
            
            return periodos
            
        except Exception as e:
            db.session.rollback()
            logger.error(f"Erro em get_period_analysis: {e}")
            return {}

    @staticmethod
    def get_weekday_analysis(estabelecimento_id: int, days: int = 30) -> Dict[str, Any]:
        """
        Análise por dia da semana: Segunda, Terça... Sexta, Sábado, Domingo
        Responde: Sexta e sábado vendem mais cerveja? Qual dia pedir mais pão?
        """
        try:
            start_date = datetime.now(timezone.utc) - timedelta(days=days)
            
            # Compatibilidade cross-database para extração de dia da semana
            from app.utils.query_helpers import get_dow_extract
            dow_extract = get_dow_extract(Venda.data_venda)

            query = db.session.query(
                dow_extract.label('dia_semana'),
                func.count(Venda.id).label('qtd_vendas'),
                func.sum(Venda.total).label('faturamento'),
                func.avg(Venda.total).label('ticket_medio')
            ).filter(
                Venda.data_venda >= start_date,
                Venda.status == 'finalizada'
            )
            
            if str(estabelecimento_id).lower() != 'all':
                query = query.filter(Venda.estabelecimento_id == estabelecimento_id)
                
            results = query.group_by(
                dow_extract
            ).all()
            
            dias_map = {
                '0': 'Domingo', '1': 'Segunda', '2': 'Terça', '3': 'Quarta',
                '4': 'Quinta', '5': 'Sexta', '6': 'Sábado'
            }
            
            por_dia = {}
            for r in results:
                dia_nome = dias_map.get(str(r.dia_semana), 'Desconhecido')
                por_dia[dia_nome] = {
                    'vendas': r.qtd_vendas or 0,
                    'faturamento': float(r.faturamento or 0),
                    'ticket_medio': float(r.ticket_medio or 0)
                }
            
            return por_dia
            
        except Exception as e:
            db.session.rollback()
            logger.error(f"Erro em get_weekday_analysis: {e}")
            return {}

    @staticmethod
    def get_product_hourly_recommendations(estabelecimento_id: int, days: int = 30) -> List[Dict[str, Any]]:
        """
        Recomendações de estoque por hora e categoria
        Responde: Aumentar pão amanhã? Caprichar em cerveja sexta/sábado?
        """
        try:
            start_date = datetime.now(timezone.utc) - timedelta(days=days)
            from app.models import CategoriaProduto
            from app.utils.query_helpers import get_hour_extract
            hour_extract = get_hour_extract(Venda.data_venda)
            
            query = db.session.query(
                hour_extract.label('hora'),
                func.coalesce(CategoriaProduto.nome, 'Geral').label('categoria'),
                VendaItem.produto_nome.label('produto'),
                func.sum(VendaItem.quantidade_base).label('quantidade_vendida'),
                func.sum(VendaItem.total_item).label('faturamento'),
                func.count(Venda.id).label('frequencia')
            ).join(
                VendaItem, Venda.id == VendaItem.venda_id
            ).outerjoin(
                Produto, VendaItem.produto_id == Produto.id
            ).outerjoin(
                CategoriaProduto, Produto.categoria_id == CategoriaProduto.id
            ).filter(
                Venda.data_venda >= start_date,
                Venda.status == 'finalizada'
            )
            if str(estabelecimento_id).lower() != 'all':
                query = query.filter(Venda.estabelecimento_id == estabelecimento_id)
                
            results = query.group_by(hour_extract, CategoriaProduto.nome, VendaItem.produto_nome).order_by(func.sum(VendaItem.total_item).desc()).limit(10).all()
            
            recs = []
            for r in results:
                if r.hora is None: continue
                try: hora = int(r.hora)
                except: continue
                periodo = 'Manhã' if 6 <= hora < 12 else ('Tarde' if 12 <= hora < 18 else 'Noite')
                recs.append({
                    'hora': hora,
                    'periodo': periodo,
                    'categoria': r.categoria,
                    'produto': r.produto,
                    'quantidade_vendida': float(r.quantidade_vendida or 0),
                    'faturamento': float(r.faturamento or 0),
                    'frequencia': int(r.frequencia or 0),
                    'recomendacao': f"Aumentar estoque de {r.produto} para {periodo.lower()} - top vendas ({hora}h)",
                    'prioridade': 'alta' if float(r.faturamento or 0) > 100 else 'media'
                })
            return recs
            
        except Exception as e:
            db.session.rollback()
            logger.error(f"Erro em get_product_hourly_recommendations: {e}")
            return []

    @staticmethod
    def get_category_performance_by_time(estabelecimento_id: int, days: int = 30) -> Dict[str, Any]:
        """
        Performance de cada categoria ao longo do dia
        Responde: Cerveja vende mais à noite? Pão vende mais de manhã?
        """
        try:
            start_date = datetime.now(timezone.utc) - timedelta(days=days)
            from app.models import CategoriaProduto
            from app.utils.query_helpers import get_hour_extract
            hour_extract = get_hour_extract(Venda.data_venda)

            query = db.session.query(
                hour_extract.label('hora'),
                func.coalesce(CategoriaProduto.nome, 'Sem Categoria').label('categoria'),
                func.sum(VendaItem.total_item).label('faturamento')
            ).join(
                VendaItem, Venda.id == VendaItem.venda_id
            ).outerjoin(
                Produto, VendaItem.produto_id == Produto.id
            ).outerjoin(
                CategoriaProduto, Produto.categoria_id == CategoriaProduto.id
            ).filter(
                Venda.data_venda >= start_date,
                Venda.status == 'finalizada'
            )
            
            if str(estabelecimento_id).lower() != 'all':
                query = query.filter(Venda.estabelecimento_id == estabelecimento_id)
                
            results = query.group_by(hour_extract, CategoriaProduto.nome).all()

            perf = {}
            for r in results:
                if r.hora is None: continue
                try: hora = int(r.hora)
                except: continue
                periodo = 'manha' if 6 <= hora < 12 else ('tarde' if 12 <= hora < 18 else 'noite')
                cat = r.categoria
                fat = float(r.faturamento or 0)
                
                if cat not in perf:
                    perf[cat] = {'manha': 0.0, 'tarde': 0.0, 'noite': 0.0}
                perf[cat][periodo] += fat
                
            return perf
            
        except Exception as e:
            db.session.rollback()
            logger.error(f"Erro em get_category_performance_by_time: {e}")
            return {}
