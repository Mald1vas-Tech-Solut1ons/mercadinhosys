"""
Serviço de lógica de vendas
"""
from app.models import db, Pagamento, ContaReceber, Cliente, MovimentacaoCaixa
from app.utils.errors import FiadoSemClienteError, PagamentoInvalidoError
from decimal import Decimal
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Any

class VendaService:
    """Serviço de lógica de vendas.

    Baixa e estorno de estoque ficam em ``estoque_service`` (regra única de lotes).
    """
    
    @staticmethod
    def validar_pagamentos(pagamentos_data: List[Dict], total_venda: Decimal) -> None:
        """
        Valida se soma dos pagamentos = total da venda
        
        Args:
            pagamentos_data: Lista de pagamentos
            total_venda: Total da venda
            
        Raises:
            PagamentoInvalidoError: Se soma não bate
        """
        total_pagamentos = sum(Decimal(str(p.get("valor", 0))) for p in pagamentos_data)
        
        if abs(total_pagamentos - total_venda) > Decimal('0.01'):
            raise PagamentoInvalidoError(
                total_esperado=float(total_venda),
                total_recebido=float(total_pagamentos)
            )
    
    @staticmethod
    def criar_pagamentos(venda_id: int, pagamentos_data: List[Dict], estabelecimento_id: int, data_pagamento: datetime) -> tuple:
        """
        Cria registros de pagamento
        
        Args:
            venda_id: ID da venda
            pagamentos_data: Lista de pagamentos
            estabelecimento_id: ID do estabelecimento
            data_pagamento: Data do pagamento
            
        Returns:
            tuple: (tem_fiado: bool, valor_fiado: Decimal)
        """
        tem_fiado = False
        valor_fiado = Decimal('0')
        
        for pagamento_info in pagamentos_data:
            forma = pagamento_info.get("forma", "dinheiro")
            valor = Decimal(str(pagamento_info.get("valor", 0)))
            
            pagamento = Pagamento(
                estabelecimento_id=estabelecimento_id,
                venda_id=venda_id,
                forma_pagamento=forma,
                valor=valor,
                codigo_voucher=pagamento_info.get("referencia"),
                status="aprovado",
                data_pagamento=data_pagamento
            )
            db.session.add(pagamento)
            
            if forma.lower() == "fiado":
                tem_fiado = True
                valor_fiado += valor
        
        return tem_fiado, valor_fiado
    
    @staticmethod
    def criar_conta_receber(cliente_id: int, venda_id: int, valor: Decimal, 
                           data_venda: datetime, data_vencimento: datetime, 
                           estabelecimento_id: int, codigo_venda: str) -> None:
        """
        Cria conta a receber (fiado)
        
        Args:
            cliente_id: ID do cliente
            venda_id: ID da venda
            valor: Valor do fiado
            data_venda: Data da venda
            data_vencimento: Data de vencimento
            estabelecimento_id: ID do estabelecimento
            codigo_venda: Código da venda
        """
        if not cliente_id:
            raise FiadoSemClienteError()
        
        cliente = Cliente.query.get(cliente_id)
        if not cliente:
            from app.utils.errors import ClienteNaoEncontradoError
            raise ClienteNaoEncontradoError(cliente_id)
        
        # Atualizar saldo devedor do cliente
        cliente.saldo_devedor = float(cliente.saldo_devedor or 0) + float(valor)
        
        # Criar conta a receber
        conta = ContaReceber(
            estabelecimento_id=estabelecimento_id,
            cliente_id=cliente_id,
            venda_id=venda_id,
            numero_documento=f"DUP-{codigo_venda}",
            valor_original=valor,
            valor_atual=valor,
            data_emissao=data_venda.date(),
            data_vencimento=data_vencimento,
            status="aberto",
            observacoes=f"Fiado PDV - {cliente.nome}. Venda fiado em {data_venda.strftime('%d/%m/%Y')}"
        )
        db.session.add(conta)
    
    @staticmethod
    def registrar_movimentacao_caixa(caixa_id: int, pagamentos_data: List[Dict], 
                                    venda_id: int, estabelecimento_id: int, 
                                    codigo_venda: str, caixa_obj: Any) -> None:
        """
        Registra movimentação de caixa para cada forma de pagamento
        
        Args:
            caixa_id: ID do caixa
            pagamentos_data: Lista de pagamentos
            venda_id: ID da venda
            estabelecimento_id: ID do estabelecimento
            codigo_venda: Código da venda
            caixa_obj: Objeto do caixa
        """
        for pagamento_info in pagamentos_data:
            forma = pagamento_info.get("forma", "dinheiro")
            valor = Decimal(str(pagamento_info.get("valor", 0)))
            
            # Não registrar fiado como entrada de caixa
            if forma.lower() != "fiado":
                mov_caixa = MovimentacaoCaixa(
                    caixa_id=caixa_id,
                    estabelecimento_id=estabelecimento_id,
                    tipo="venda",
                    valor=valor,
                    forma_pagamento=forma,
                    venda_id=venda_id,
                    descricao=f"Venda PDV {codigo_venda} - {forma}"
                )
                db.session.add(mov_caixa)
                
                # Atualizar saldo do caixa apenas para dinheiro
                if forma.lower() == "dinheiro":
                    caixa_obj.saldo_atual = float(caixa_obj.saldo_atual) + float(valor)
    
    @staticmethod
    def atualizar_metricas_cliente(cliente_id: int, total_venda: Decimal, data_venda: datetime) -> None:
        """
        Atualiza métricas do cliente (total_compras, valor_total_gasto, ultima_compra)
        
        Args:
            cliente_id: ID do cliente
            total_venda: Total da venda
            data_venda: Data da venda
        """
        if not cliente_id:
            return
        
        cliente = Cliente.query.get(cliente_id)
        if cliente:
            cliente.total_compras = int(cliente.total_compras or 0) + 1
            cliente.valor_total_gasto = float(cliente.valor_total_gasto or 0) + float(total_venda)
            cliente.ultima_compra = data_venda
