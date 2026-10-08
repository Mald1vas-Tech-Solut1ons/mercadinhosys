"""
Metrics Calculator - Single Source of Truth for all metrics

This module provides centralized metric calculations to ensure consistency
across all dashboard, reports, and products modules.

Requirements: AC 2.1, 2.2, 2.3, 2.4, 2.5, 4.1, 4.2, 4.3, 4.4, 4.5
"""

from decimal import Decimal, ROUND_HALF_UP
from datetime import datetime, timezone
from typing import Dict
import logging
from sqlalchemy import func

logger = logging.getLogger(__name__)


class MetricsCalculator:
    """Centralized metrics calculator - single source of truth for all calculations."""

    @staticmethod
    def calculate_revenue(
        establishment_id: int,
        start_date: datetime,
        end_date: datetime
    ) -> Decimal:
        """
        Calculate revenue (sum of all finalized sales).
        AC 2.1: Revenue calculations sum all completed sales transactions correctly
        """
        from app.models import db, Venda
        
        if start_date.tzinfo is None:
            start_date = start_date.replace(tzinfo=timezone.utc)
        if end_date.tzinfo is None:
            end_date = end_date.replace(tzinfo=timezone.utc)
        
        end_date = end_date.replace(hour=23, minute=59, second=59)
        
        query = db.session.query(
            func.sum(Venda.total)
        ).filter(
            Venda.estabelecimento_id == establishment_id,
            Venda.data_venda >= start_date,
            Venda.data_venda <= end_date,
            Venda.status == 'finalizada'
        )
        
        result = query.scalar()
        revenue = Decimal(str(result)) if result is not None else Decimal('0.00')
        return revenue.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)

    @staticmethod
    def calculate_cogs(
        establishment_id: int,
        start_date: datetime,
        end_date: datetime
    ) -> Decimal:
        """
        Calculate COGS (Cost of Goods Sold).
        AC 2.2: Profit calculations account for product costs
        """
        from app.models import db, Venda, VendaItem
        from app.models import Produto
        from app.utils.custo import custo_efetivo
        
        if start_date.tzinfo is None:
            start_date = start_date.replace(tzinfo=timezone.utc)
        if end_date.tzinfo is None:
            end_date = end_date.replace(tzinfo=timezone.utc)
        
        end_date = end_date.replace(hour=23, minute=59, second=59)
        
        query = db.session.query(
            func.sum(custo_efetivo() * VendaItem.quantidade)
        ).join(
            Venda, Venda.id == VendaItem.venda_id
        ).outerjoin(
            Produto, Produto.id == VendaItem.produto_id
        ).filter(
            Venda.estabelecimento_id == establishment_id,
            Venda.data_venda >= start_date,
            Venda.data_venda <= end_date,
            Venda.status == 'finalizada'
        )
        
        result = query.scalar()
        cogs = Decimal(str(result)) if result is not None else Decimal('0.00')
        return cogs.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)

    @staticmethod
    def calculate_gross_profit(revenue: Decimal, cogs: Decimal) -> Decimal:
        """
        Calculate gross profit.
        AC 2.2: Profit calculations account for product costs
        Formula: Gross Profit = Revenue - COGS
        """
        revenue = Decimal(str(revenue))
        cogs = Decimal(str(cogs))
        gross_profit = revenue - cogs
        return gross_profit.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)

    @staticmethod
    def calculate_discounts(
        establishment_id: int,
        start_date: datetime,
        end_date: datetime
    ) -> Decimal:
        """
        Calculate total discounts given.
        AC 2.2: Profit calculations account for discount amounts
        """
        from app.models import db, Venda
        
        if start_date.tzinfo is None:
            start_date = start_date.replace(tzinfo=timezone.utc)
        if end_date.tzinfo is None:
            end_date = end_date.replace(tzinfo=timezone.utc)
        
        end_date = end_date.replace(hour=23, minute=59, second=59)
        
        query = db.session.query(
            func.sum(Venda.desconto)
        ).filter(
            Venda.estabelecimento_id == establishment_id,
            Venda.data_venda >= start_date,
            Venda.data_venda <= end_date,
            Venda.status == 'finalizada'
        )
        
        result = query.scalar()
        discounts = Decimal(str(result)) if result is not None else Decimal('0.00')
        return discounts.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)

    @staticmethod
    def calculate_expenses(
        establishment_id: int,
        start_date: datetime,
        end_date: datetime
    ) -> Decimal:
        """
        Calculate total expenses.
        AC 2.2: Profit calculations account for expenses
        AC 4.4: Expense tracking integrates correctly with profit calculations
        """
        from app.models import db, Despesa
        
        if start_date.tzinfo is None:
            start_date = start_date.replace(tzinfo=timezone.utc)
        if end_date.tzinfo is None:
            end_date = end_date.replace(tzinfo=timezone.utc)
        
        start_date_only = start_date.date()
        end_date_only = end_date.date()
        
        query = db.session.query(
            func.sum(Despesa.valor)
        ).filter(
            Despesa.estabelecimento_id == establishment_id,
            Despesa.data_despesa >= start_date_only,
            Despesa.data_despesa <= end_date_only
        )
        
        result = query.scalar()
        expenses = Decimal(str(result)) if result is not None else Decimal('0.00')
        return expenses.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)

    @staticmethod
    def calculate_net_profit(
        gross_profit: Decimal,
        expenses: Decimal,
        discounts: Decimal = Decimal('0.00')
    ) -> Decimal:
        """
        Calculate net profit.
        AC 2.2: Profit calculations account for discounts and expenses
        Formula: Net Profit = Gross Profit - Expenses - Discounts
        """
        gross_profit = Decimal(str(gross_profit))
        expenses = Decimal(str(expenses))
        discounts = Decimal(str(discounts))
        net_profit = gross_profit - expenses - discounts
        return net_profit.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)

    @staticmethod
    def calculate_inventory_value_at_date(establishment_id: int, reference_date: datetime) -> Decimal:
        """Calculate total inventory value at a specific date."""
        from app.models import db, Produto
        if reference_date.tzinfo is None:
            reference_date = reference_date.replace(tzinfo=timezone.utc)
        
        value = db.session.query(
            func.sum(Produto.preco_custo * Produto.quantidade)
        ).filter(
            Produto.estabelecimento_id == establishment_id,
            Produto.created_at <= reference_date
        ).scalar()
        
        result = Decimal(str(value)) if value is not None else Decimal('0.00')
        return result.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)

    @staticmethod
    def calculate_inventory_turnover(
        establishment_id: int,
        start_date: datetime,
        end_date: datetime
    ) -> Decimal:
        """
        Calculate inventory turnover (Giro de Estoque).
        AC 2.3: Inventory turnover is calculated using correct formula
        Formula: Inventory Turnover = COGS / Average Inventory Value
        """
        from app.models import db, Produto
        
        if start_date.tzinfo is None:
            start_date = start_date.replace(tzinfo=timezone.utc)
        if end_date.tzinfo is None:
            end_date = end_date.replace(tzinfo=timezone.utc)
        
        cogs = MetricsCalculator.calculate_cogs(establishment_id, start_date, end_date)
        
        if cogs == 0:
            return Decimal('0.00')
        
        beginning_inventory = db.session.query(
            func.sum(Produto.preco_custo * Produto.quantidade)
        ).filter(
            Produto.estabelecimento_id == establishment_id,
            Produto.created_at <= start_date
        ).scalar() or Decimal('0.00')
        
        ending_inventory = db.session.query(
            func.sum(Produto.preco_custo * Produto.quantidade)
        ).filter(
            Produto.estabelecimento_id == establishment_id,
            Produto.created_at <= end_date
        ).scalar() or Decimal('0.00')
        
        beginning_inventory = Decimal(str(beginning_inventory))
        ending_inventory = Decimal(str(ending_inventory))
        average_inventory = (beginning_inventory + ending_inventory) / 2
        
        if average_inventory == 0:
            return Decimal('0.00')
        
        turnover = cogs / average_inventory
        return turnover.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)

    @staticmethod
    def calculate_abc_classification(
        establishment_id: int,
        start_date: datetime,
        end_date: datetime
    ) -> Dict[int, str]:
        """
        Calculate ABC classification for products.
        AC 2.4: ABC analysis correctly classifies products by revenue contribution
        """
        from app.models import db, Venda, VendaItem
        
        if start_date.tzinfo is None:
            start_date = start_date.replace(tzinfo=timezone.utc)
        if end_date.tzinfo is None:
            end_date = end_date.replace(tzinfo=timezone.utc)
        
        end_date = end_date.replace(hour=23, minute=59, second=59)
        
        product_revenues = db.session.query(
            VendaItem.produto_id,
            func.sum(VendaItem.preco_unitario * VendaItem.quantidade).label('revenue')
        ).join(
            Venda, Venda.id == VendaItem.venda_id
        ).filter(
            Venda.estabelecimento_id == establishment_id,
            Venda.data_venda >= start_date,
            Venda.data_venda <= end_date,
            Venda.status == 'finalizada'
        ).group_by(
            VendaItem.produto_id
        ).order_by(
            db.desc('revenue')
        ).all()
        
        if not product_revenues:
            return {}
        
        total_revenue = sum(Decimal(str(pr.revenue)) for pr in product_revenues)
        
        if total_revenue == 0:
            return {pr.produto_id: 'C' for pr in product_revenues}
        
        classifications = {}
        cumulative_revenue = Decimal('0.00')
        
        for pr in product_revenues:
            cumulative_revenue += Decimal(str(pr.revenue))
            cumulative_percentage = (cumulative_revenue / total_revenue) * 100
            
            if cumulative_percentage <= 80:
                classifications[pr.produto_id] = 'A'
            elif cumulative_percentage <= 95:
                classifications[pr.produto_id] = 'B'
            else:
                classifications[pr.produto_id] = 'C'
        
        return classifications

    @staticmethod
    def safe_percentage(
        numerator: Decimal,
        denominator: Decimal,
        default: Decimal = Decimal('0.00')
    ) -> Decimal:
        """
        Safe percentage calculation with division-by-zero handling.
        AC 2.5: All percentage calculations handle edge cases
        """
        numerator = Decimal(str(numerator))
        denominator = Decimal(str(denominator))
        default = Decimal(str(default))
        
        if denominator == 0 or denominator is None:
            return default
        
        result = (numerator / denominator) * 100
        return result.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)

    @staticmethod
    def calculate_gross_margin(revenue: Decimal, cogs: Decimal) -> Decimal:
        """Calculate gross margin percentage."""
        revenue = Decimal(str(revenue))
        cogs = Decimal(str(cogs))
        
        if revenue == 0:
            return Decimal('0.00')
        
        gross_profit = revenue - cogs
        margin = (gross_profit / revenue) * 100
        return margin.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)

    @staticmethod
    def calculate_net_margin(net_profit: Decimal, revenue: Decimal) -> Decimal:
        """Calculate net margin percentage."""
        return MetricsCalculator.safe_percentage(net_profit, revenue)

    @staticmethod
    def calculate_roi(net_profit: Decimal, inventory_value: Decimal) -> Decimal:
        """Calculate ROI (Return On Investment)."""
        return MetricsCalculator.safe_percentage(net_profit, inventory_value)

    @staticmethod
    def get_period_financials(
        establishment_id: int,
        start_date: datetime,
        end_date: datetime
    ) -> Dict[str, Decimal]:
        """Get complete financial snapshot for a period."""
        revenue = MetricsCalculator.calculate_revenue(establishment_id, start_date, end_date)
        cogs = MetricsCalculator.calculate_cogs(establishment_id, start_date, end_date)
        gross_profit = MetricsCalculator.calculate_gross_profit(revenue, cogs)
        gross_margin = MetricsCalculator.calculate_gross_margin(revenue, cogs)
        expenses = MetricsCalculator.calculate_expenses(establishment_id, start_date, end_date)
        discounts = MetricsCalculator.calculate_discounts(establishment_id, start_date, end_date)
        net_profit = MetricsCalculator.calculate_net_profit(gross_profit, expenses, discounts)
        net_margin = MetricsCalculator.calculate_net_margin(net_profit, revenue)
        
        return {
            'revenue': revenue,
            'cogs': cogs,
            'gross_profit': gross_profit,
            'gross_margin': gross_margin,
            'expenses': expenses,
            'discounts': discounts,
            'net_profit': net_profit,
            'net_margin': net_margin,
        }
