# app/routes/pedidos_compra.py
from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import get_jwt_identity
from datetime import datetime, date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from sqlalchemy import func, and_, or_
from sqlalchemy.orm import joinedload
from sqlalchemy.exc import IntegrityError

from app import db
from app.models import (
    PedidoCompra, PedidoCompraItem, Produto, Fornecedor, Funcionario,
    ContaPagar, ContaPagarBaixa, MovimentacaoEstoque, Despesa, ProdutoLote
)
from app.decorators.decorator_jwt import funcionario_required

pedidos_compra_bp = Blueprint('pedidos_compra', __name__)

def get_current_user():
    """Helper para obter usuário atual"""
    user_id = get_jwt_identity()
    user = Funcionario.query.get(user_id)
    if not user:
        return None
    return user

@pedidos_compra_bp.route('/pedidos-compra/', methods=['GET'])
@funcionario_required
def listar_pedidos():
    """Lista pedidos de compra com filtros e paginação"""
    try:
        user = get_current_user()
        if not user:
            return jsonify({'error': 'Usuário não encontrado'}), 404
        from app.utils.query_helpers import get_authorized_establishment_id
        estab_id = get_authorized_establishment_id()
        
        page = int(request.args.get('page', 1))
        per_page = min(int(request.args.get('per_page', 20)), 100)
        
        # Filtros
        status = request.args.get('status')
        fornecedor_id = request.args.get('fornecedor_id')
        data_inicio = request.args.get('data_inicio')
        data_fim = request.args.get('data_fim')
        
        query = PedidoCompra.query.options(
            joinedload(PedidoCompra.fornecedor),
            joinedload(PedidoCompra.funcionario),
            joinedload(PedidoCompra.itens),
            joinedload(PedidoCompra.conta_pagar),
        )
        if estab_id and str(estab_id).lower() != 'all':
            query = query.filter_by(estabelecimento_id=estab_id)
        
        if status:
            query = query.filter(PedidoCompra.status == status)
        if fornecedor_id:
            query = query.filter(PedidoCompra.fornecedor_id == fornecedor_id)
        if data_inicio:
            query = query.filter(PedidoCompra.data_pedido >= datetime.strptime(data_inicio, '%Y-%m-%d'))
        if data_fim:
            query = query.filter(PedidoCompra.data_pedido <= datetime.strptime(data_fim, '%Y-%m-%d'))
        
        query = query.order_by(PedidoCompra.data_pedido.desc())
        
        pedidos_paginados = query.paginate(
            page=page, per_page=per_page, error_out=False
        )
        
        pedidos = []
        for pedido in pedidos_paginados.items:
            try:
                pedido_dict = pedido.to_dict()
                pedido_dict['fornecedor_nome'] = pedido.fornecedor.nome_fantasia if pedido.fornecedor else None
                pedido_dict['funcionario_nome'] = pedido.funcionario.nome if pedido.funcionario else None
                pedido_dict['total_itens'] = len(pedido.itens) if pedido.itens else 0
                pedido_dict['itens'] = []
                if pedido.itens:
                    for item in pedido.itens:
                        item_data = item.to_dict()
                        if item.produto:
                            item_data['produto'] = item.produto.to_dict()
                        pedido_dict['itens'].append(item_data)

                # ── Status Financeiro (ContaPagar vinculada) ──────────────
                cp = getattr(pedido, 'conta_pagar', None)
                if cp is None:
                    # Fallback: busca direta pelo pedido_compra_id
                    cp = ContaPagar.query.filter_by(pedido_compra_id=pedido.id).first()

                if cp:
                    vencido = (
                        cp.status in ('aberto', 'pendente') and
                        cp.data_vencimento and
                        cp.data_vencimento < date.today()
                    )
                    pedido_dict['financeiro'] = {
                        'status': cp.status,                         # aberto | pago | vencido | cancelado
                        'status_display': (
                            'Vencido' if vencido else
                            'Pago'    if cp.status == 'pago' else
                            'Em aberto'
                        ),
                        'vencido': vencido,
                        'valor_original': float(cp.valor_original) if cp.valor_original else None,
                        'valor_pago': float(cp.valor_pago) if cp.valor_pago else None,
                        'data_vencimento': cp.data_vencimento.isoformat() if cp.data_vencimento else None,
                        'numero_documento': cp.numero_documento,
                    }
                else:
                    pedido_dict['financeiro'] = None

                pedidos.append(pedido_dict)
            except Exception as e:
                from flask import current_app
                current_app.logger.error(f"Erro ao processar pedido {pedido.id}: {str(e)}", exc_info=True)
                continue
        
        return jsonify({
            'pedidos': pedidos,
            'paginacao': {
                'pagina_atual': page,
                'total_paginas': pedidos_paginados.pages,
                'total_itens': pedidos_paginados.total,
                'itens_por_pagina': per_page
            }
        })
        
    except Exception as e:
        from flask import current_app
        current_app.logger.error(f"Erro ao listar pedidos: {str(e)}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@pedidos_compra_bp.route('/pedidos-compra/', methods=['POST'])
@funcionario_required
def criar_pedido():
    """Cria um novo pedido de compra"""
    try:
        user = get_current_user()
        if not user:
            return jsonify({'error': 'Usuário não encontrado'}), 404
        from app.utils.query_helpers import get_authorized_establishment_id
        estab_id = get_authorized_establishment_id()
        
        data = request.get_json()
        
        # Validações
        if not data.get('fornecedor_id'):
            return jsonify({'error': 'Fornecedor é obrigatório'}), 400
        if not data.get('itens') or len(data.get('itens', [])) == 0:
            return jsonify({'error': 'Pelo menos um item é obrigatório'}), 400
        
        # Verificar se fornecedor existe
        fornecedor = Fornecedor.query.filter_by(
            id=data['fornecedor_id'],
            estabelecimento_id=estab_id
        ).first()
        if not fornecedor:
            return jsonify({'error': 'Fornecedor não encontrado'}), 404
        
        # Gerar número do pedido
        ultimo_pedido = PedidoCompra.query.filter_by(
            estabelecimento_id=estab_id
        ).order_by(PedidoCompra.id.desc()).first()
        
        numero_pedido = f"PC{(ultimo_pedido.id + 1 if ultimo_pedido else 1):06d}"

        def _parse_date(valor, default=None):
            """Aceita 'YYYY-MM-DD' (input date do front). Retorna default se vazio/inválido."""
            if not valor:
                return default
            try:
                return datetime.strptime(str(valor)[:10], "%Y-%m-%d").date()
            except (ValueError, TypeError):
                return default

        # Datas: usa o que o operador informou; senão, defaults sensatos.
        data_pedido = _parse_date(data.get('data_pedido'), date.today())
        data_previsao = _parse_date(
            data.get('data_previsao_entrega'),
            date.today() + timedelta(days=fornecedor.prazo_entrega or 7),
        )
        horario_entrega = (data.get('horario_entrega') or '').strip() or None

        # Criar pedido
        pedido = PedidoCompra(
            estabelecimento_id=estab_id,
            fornecedor_id=data['fornecedor_id'],
            funcionario_id=user.id,
            numero_pedido=numero_pedido,
            data_pedido=datetime.combine(data_pedido, datetime.min.time()) if data_pedido else datetime.utcnow(),
            data_previsao_entrega=data_previsao,
            horario_entrega=horario_entrega,
            condicao_pagamento=data.get('condicao_pagamento', fornecedor.forma_pagamento),
            observacoes=data.get('observacoes', ''),
            status='pendente'
        )
        
        db.session.add(pedido)
        db.session.flush()  # Para obter o ID
        
        # Processar itens
        subtotal = Decimal('0')
        for item_data in data['itens']:
            produto = Produto.query.filter_by(
                id=item_data['produto_id'],
                estabelecimento_id=estab_id
            ).first()
            
            if not produto:
                return jsonify({'error': f'Produto ID {item_data["produto_id"]} não encontrado'}), 404
            
            quantidade = int(item_data['quantidade'])
            preco_unitario = Decimal(str(item_data.get('preco_unitario', produto.preco_custo)))
            desconto = Decimal(str(item_data.get('desconto_percentual', 0)))
            
            total_item = quantidade * preco_unitario * (1 - desconto / 100)
            
            item = PedidoCompraItem(
                pedido_id=pedido.id,
                estabelecimento_id=estab_id,
                produto_id=produto.id,
                produto_nome=produto.nome,
                produto_unidade=produto.unidade_medida,
                quantidade_solicitada=quantidade,
                preco_unitario=preco_unitario,
                desconto_percentual=desconto,
                total_item=total_item,
                status='pendente'
            )
            
            db.session.add(item)
            subtotal += total_item
        
        # Calcular totais
        desconto_pedido = Decimal(str(data.get('desconto', 0)))
        frete = Decimal(str(data.get('frete', 0)))
        total = subtotal - desconto_pedido + frete
        
        pedido.subtotal = subtotal
        pedido.desconto = desconto_pedido
        pedido.frete = frete
        pedido.total = total

        # ERP: criar Conta a Pagar ao emitir o pedido (obrigação financeira)
        # A Despesa é criada quando o boleto for pago (pagar boleto)
        data_vencimento = data_previsao or (date.today() + timedelta(days=30))
        conta_pagar = ContaPagar(
            estabelecimento_id=estab_id,
            fornecedor_id=pedido.fornecedor_id,
            pedido_compra_id=pedido.id,
            numero_documento=f'PC-{numero_pedido}',
            tipo_documento='pedido_compra',
            valor_original=total,
            valor_atual=total,
            data_emissao=date.today(),
            data_vencimento=data_vencimento,
            status='aberto',
            observacoes=f'Pedido de compra {numero_pedido}' + (f' - {pedido.observacoes}' if pedido.observacoes else ''),
        )
        db.session.add(conta_pagar)

        db.session.commit()

        return jsonify({
            'message': 'Pedido criado com sucesso',
            'pedido': pedido.to_dict()
        }), 201
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@pedidos_compra_bp.route('/pedidos-compra/<int:pedido_id>', methods=['GET'])
@funcionario_required
def obter_pedido(pedido_id):
    """Obtém detalhes de um pedido específico"""
    try:
        user = get_current_user()
        if not user:
            return jsonify({'error': 'Usuário não encontrado'}), 404
        from app.utils.query_helpers import get_authorized_establishment_id
        estab_id = get_authorized_establishment_id()
        
        query = PedidoCompra.query.filter_by(id=pedido_id)
        if estab_id and str(estab_id).lower() != 'all':
            query = query.filter_by(estabelecimento_id=estab_id)
            
        pedido = query.options(
            joinedload(PedidoCompra.fornecedor),
            joinedload(PedidoCompra.funcionario),
            joinedload(PedidoCompra.itens).joinedload(PedidoCompraItem.produto)
        ).first()
        
        if not pedido:
            return jsonify({'error': 'Pedido não encontrado'}), 404
        
        pedido_dict = pedido.to_dict()
        pedido_dict['fornecedor'] = pedido.fornecedor.to_dict() if pedido.fornecedor else None
        pedido_dict['funcionario'] = pedido.funcionario.to_dict() if pedido.funcionario else None
        pedido_dict['itens'] = []
        for item in pedido.itens:
            item_data = item.to_dict()
            if item.produto:
                item_data['produto'] = item.produto.to_dict()
            pedido_dict['itens'].append(item_data)
        
        # Adicionar informações de conta a pagar se existir
        if pedido.conta_pagar:
            pedido_dict['conta_pagar'] = pedido.conta_pagar.to_dict()
        
        return jsonify({'pedido': pedido_dict})
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@pedidos_compra_bp.route('/pedidos-compra/receber', methods=['POST'])
@funcionario_required
def receber_pedido_compra():
    """Confirma o recebimento de um pedido e atualiza estoque com sistema de lotes"""
    try:
        user = get_current_user()
        if not user:
            return jsonify({'error': 'Usuário não encontrado'}), 404
        from app.utils.query_helpers import get_authorized_establishment_id
        estab_id = get_authorized_establishment_id()
        
        data = request.get_json()
        pedido_id = data.get('pedido_id')
        
        pedido = PedidoCompra.query.filter_by(
            id=pedido_id,
            estabelecimento_id=estab_id
        ).first()
        
        if not pedido:
            return jsonify({'error': 'Pedido não encontrado'}), 404
        
        if pedido.status != 'pendente':
            return jsonify({'error': 'Pedido já foi processado'}), 400
        
        # Processar recebimento dos itens
        itens_recebidos = data.get('itens', [])
        total_recebido = Decimal('0')
        
        for item_data in itens_recebidos:
            item = PedidoCompraItem.query.filter_by(
                id=item_data['item_id'],
                pedido_id=pedido.id
            ).first()
            
            if not item:
                continue
            
            quantidade_recebida = int(item_data.get('quantidade_recebida', 0))
            quantidade_avariada = int(item_data.get('quantidade_avariada', 0))
            quantidade_faltante = int(item_data.get('quantidade_faltante', 0))
            quantidade_bonificada = int(item_data.get('quantidade_bonificada', 0))

            if quantidade_recebida <= 0 and quantidade_bonificada <= 0:
                continue
            
            # Atualizar item
            item.quantidade_recebida = quantidade_recebida
            item.quantidade_avariada = quantidade_avariada
            item.quantidade_faltante = quantidade_faltante
            item.quantidade_bonificada = quantidade_bonificada
            item.status = 'recebido' if (quantidade_recebida + quantidade_faltante) >= item.quantidade_solicitada else 'parcial'
            
            # Atualizar estoque do produto (apenas com a quantidade boa: recebida + bonificada - avariada)
            quantidade_para_estoque = max(0, quantidade_recebida + quantidade_bonificada - quantidade_avariada)

            produto = item.produto
            if produto and quantidade_para_estoque > 0:
                # Obter data de validade e fabricação do item (se fornecidas)
                data_validade = None
                data_fabricacao = None
                if item_data.get('data_validade'):
                    from datetime import datetime as dt
                    data_validade = dt.strptime(item_data['data_validade'], '%Y-%m-%d').date()
                if item_data.get('data_fabricacao'):
                    from datetime import datetime as dt
                    data_fabricacao = dt.strptime(item_data['data_fabricacao'], '%Y-%m-%d').date()
                
                # Criar lote para este recebimento
                numero_lote = item_data.get('numero_lote') or f"LOTE-{pedido.numero_pedido}-{item.id}"
                
                lote = ProdutoLote(
                    estabelecimento_id=estab_id,
                    produto_id=produto.id,
                    fornecedor_id=pedido.fornecedor_id,
                    pedido_compra_id=pedido.id,
                    numero_lote=numero_lote,
                    quantidade=quantidade_para_estoque,
                    quantidade_inicial=quantidade_para_estoque,
                    data_fabricacao=data_fabricacao,
                    data_validade=data_validade or (date.today() + timedelta(days=365)),  # Padrão: 1 ano
                    data_entrada=date.today(),
                    preco_custo_unitario=item.preco_unitario,
                    ativo=True,
                )
                
                db.session.add(lote)
                
                # Recalcular preço de custo médio ponderado ANTES de atualizar o estoque
                if hasattr(produto, 'recalcular_preco_custo_ponderado'):
                    try:
                        produto.recalcular_preco_custo_ponderado(
                            quantidade_entrada=quantidade_para_estoque,
                            custo_unitario_entrada=item.preco_unitario,
                            funcionario_id=user.id,
                            motivo=f'Recebimento pedido {pedido.numero_pedido}'
                        )
                    except Exception as ex:
                        from flask import current_app
                        current_app.logger.warning(
                            f"recalcular_preco_custo_ponderado ignorado para produto {produto.id}: {ex}"
                        )

                # Movimentar estoque (atualiza produto.quantidade e cria MovimentacaoEstoque)
                motivo_movimentacao = f'Recebimento pedido {pedido.numero_pedido}. Lote: {numero_lote}'
                if quantidade_avariada > 0 or quantidade_bonificada > 0:
                    motivo_movimentacao += f' (Avarias: {quantidade_avariada}, Bônus: {quantidade_bonificada})'

                movimentacao = produto.movimentar_estoque(
                    quantidade=quantidade_para_estoque,
                    tipo='entrada',
                    motivo=motivo_movimentacao,
                    usuario_id=user.id
                )
                movimentacao.pedido_compra_id = pedido.id
                db.session.add(movimentacao)
            
            total_recebido += item.preco_unitario * quantidade_recebida
        
        # Atualizar pedido
        pedido.data_recebimento = date.today()
        pedido.status = 'recebido'
        pedido.numero_nota_fiscal = data.get('numero_nota_fiscal', '')
        pedido.serie_nota_fiscal = data.get('serie_nota_fiscal', '')

        # Conta a pagar: usar a criada na emissão do pedido ou criar se recebimento pedir boleto
        conta_existente = getattr(pedido, 'conta_pagar', None) or (
            ContaPagar.query.filter_by(pedido_compra_id=pedido.id, estabelecimento_id=estab_id).first()
        )
        if conta_existente:
            # Atualizar valor com o total realmente recebido (pode diferir do pedido)
            conta_existente.valor_original = total_recebido
            conta_existente.valor_atual = total_recebido
            if data.get('numero_documento'):
                conta_existente.numero_documento = data.get('numero_documento')
        elif data.get('gerar_boleto', False):
            data_vencimento_str = data.get('data_vencimento')
            if not data_vencimento_str:
                dias_prazo = 30
                if pedido.condicao_pagamento:
                    try:
                        dias_prazo = int(str(pedido.condicao_pagamento).split()[0])
                    except (ValueError, IndexError):
                        pass
                data_vencimento = date.today() + timedelta(days=dias_prazo)
            else:
                data_vencimento = datetime.strptime(data_vencimento_str, '%Y-%m-%d').date()

            conta_pagar = ContaPagar(
                estabelecimento_id=estab_id,
                fornecedor_id=pedido.fornecedor_id,
                pedido_compra_id=pedido.id,
                numero_documento=data.get('numero_documento', f'BOL-{pedido.numero_pedido}'),
                tipo_documento='boleto',
                valor_original=total_recebido,
                valor_atual=total_recebido,
                data_emissao=date.today(),
                data_vencimento=data_vencimento,
                status='aberto',
                observacoes=f'Referente ao pedido {pedido.numero_pedido}'
            )
            db.session.add(conta_pagar)

        db.session.commit()
        
        return jsonify({
            'message': 'Pedido recebido com sucesso',
            'pedido': pedido.to_dict()
        })
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@pedidos_compra_bp.route('/pedidos-compra/<int:pedido_id>/devolver', methods=['POST'])
@funcionario_required
def devolver_pedido_compra(pedido_id):
    """
    Recusa/Devolve um pedido de compra inteiro na doca.
    O pedido muda para status 'devolvido', cancelando qualquer cobrança atrelada gerada previamente.
    """
    try:
        user = get_current_user()
        if not user:
            return jsonify({'error': 'Usuário não encontrado'}), 404
        from app.utils.query_helpers import get_authorized_establishment_id
        estab_id = get_authorized_establishment_id()
            
        pedido = PedidoCompra.query.filter_by(
            id=pedido_id,
            estabelecimento_id=estab_id
        ).first()
        
        if not pedido:
            return jsonify({'error': 'Pedido não encontrado'}), 404
            
        if pedido.status != 'pendente':
            return jsonify({'error': f'Apenas pedidos pendentes podem ser devolvidos. Status atual: {pedido.status}'}), 400
            
        # Marca o pedido como devolvido
        pedido.status = 'devolvido'
        pedido.observacoes = f"{pedido.observacoes or ''}\n[Devolução Total registrada em {date.today().strftime('%d/%m/%Y')} por {user.nome}]"
        
        # Cancela qualquer conta a pagar que já pudesse ter sido criada para ele
        contas = ContaPagar.query.filter_by(pedido_compra_id=pedido.id, estabelecimento_id=estab_id).all()
        for conta in contas:
            if conta.status == 'aberto':
                conta.status = 'cancelado'
                conta.observacoes = f"{conta.observacoes or ''} (Cancelado devido à devolução total do pedido na doca)"
                
        db.session.commit()
        return jsonify({
            'message': 'Pedido devolvido/recusado com sucesso.',
            'pedido': pedido.to_dict()
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@pedidos_compra_bp.route('/boletos-fornecedores/', methods=['GET'])
@funcionario_required
def listar_boletos():
    """Lista boletos de fornecedores com filtros"""
    try:
        user = get_current_user()
        if not user:
            return jsonify({'error': 'Usuário não encontrado'}), 404
        from app.utils.query_helpers import get_authorized_establishment_id
        estab_id = get_authorized_establishment_id()
        
        page = int(request.args.get('page', 1))
        per_page = min(int(request.args.get('per_page', 20)), 100)
        
        # Filtros
        status = request.args.get('status', 'aberto')
        fornecedor_id = request.args.get('fornecedor_id')
        vencimento_ate = request.args.get('vencimento_ate')
        apenas_vencidos = request.args.get('apenas_vencidos') == 'true'
        
        query = ContaPagar.query.filter_by(
            estabelecimento_id=estab_id
        ).options(
            joinedload(ContaPagar.fornecedor),
            joinedload(ContaPagar.pedido_compra)
        )
        
        if status:
            query = query.filter(ContaPagar.status == status)
        if fornecedor_id:
            query = query.filter(ContaPagar.fornecedor_id == fornecedor_id)
        if vencimento_ate:
            query = query.filter(ContaPagar.data_vencimento <= datetime.strptime(vencimento_ate, '%Y-%m-%d').date())
        if apenas_vencidos:
            query = query.filter(ContaPagar.data_vencimento < date.today())
        
        query = query.order_by(ContaPagar.data_vencimento.asc())
        
        boletos_paginados = query.paginate(
            page=page, per_page=per_page, error_out=False
        )
        
        boletos = []
        for conta in boletos_paginados.items:
            conta_dict = conta.to_dict()
            conta_dict['fornecedor_nome'] = conta.fornecedor.nome_fantasia if conta.fornecedor else None
            conta_dict['pedido_numero'] = conta.pedido_compra.numero_pedido if conta.pedido_compra else None
            conta_dict['pedido_id'] = conta.pedido_compra.id if conta.pedido_compra else None
            conta_dict['data_pedido'] = conta.pedido_compra.data_pedido.isoformat() if conta.pedido_compra and conta.pedido_compra.data_pedido else None
            conta_dict['itens'] = [item.to_dict() for item in conta.pedido_compra.itens] if conta.pedido_compra else []
            
            # Calcular dias para vencimento
            if conta.data_vencimento:
                dias_vencimento = (conta.data_vencimento - date.today()).days
                conta_dict['dias_vencimento'] = dias_vencimento
                conta_dict['status_vencimento'] = (
                    'vencido' if dias_vencimento < 0 else
                    'vence_hoje' if dias_vencimento == 0 else
                    'vence_em_breve' if dias_vencimento <= 7 else
                    'normal'
                )
            
            boletos.append(conta_dict)
        
        # Estatísticas
        stats = {
            'total_aberto': db.session.query(func.sum(ContaPagar.valor_atual)).filter(
                ContaPagar.estabelecimento_id == estab_id,
                ContaPagar.status == 'aberto'
            ).scalar() or 0,
            'vencidos': db.session.query(func.count(ContaPagar.id)).filter(
                ContaPagar.estabelecimento_id == estab_id,
                ContaPagar.status == 'aberto',
                ContaPagar.data_vencimento < date.today()
            ).scalar() or 0,
            'vence_hoje': db.session.query(func.count(ContaPagar.id)).filter(
                ContaPagar.estabelecimento_id == estab_id,
                ContaPagar.status == 'aberto',
                ContaPagar.data_vencimento == date.today()
            ).scalar() or 0,
            'vence_7_dias': db.session.query(func.count(ContaPagar.id)).filter(
                ContaPagar.estabelecimento_id == estab_id,
                ContaPagar.status == 'aberto',
                ContaPagar.data_vencimento.between(date.today(), date.today() + timedelta(days=7))
            ).scalar() or 0
        }
        
        return jsonify({
            'boletos': boletos,
            'estatisticas': stats,
            'paginacao': {
                'pagina_atual': page,
                'total_paginas': boletos_paginados.pages,
                'total_itens': boletos_paginados.total,
                'itens_por_pagina': per_page
            }
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@pedidos_compra_bp.route('/produtos/<int:produto_id>/lotes-disponiveis', methods=['GET'])
@funcionario_required
def listar_lotes_disponiveis(produto_id):
    """Lista lotes disponíveis de um produto ordenados por FIFO (validade)"""
    try:
        user = get_current_user()
        if not user:
            return jsonify({'error': 'Usuário não encontrado'}), 404
        from app.utils.query_helpers import get_authorized_establishment_id
        estab_id = get_authorized_establishment_id()
        
        produto = Produto.query.filter_by(
            id=produto_id,
            estabelecimento_id=estab_id
        ).first()
        
        if not produto:
            return jsonify({'error': 'Produto não encontrado'}), 404
        
        # Buscar lotes ativos ordenados por data de validade (FIFO)
        lotes = ProdutoLote.query.filter_by(
            produto_id=produto_id,
            estabelecimento_id=estab_id,
            ativo=True
        ).filter(
            ProdutoLote.quantidade > 0  # Apenas lotes com quantidade disponível
        ).order_by(
            ProdutoLote.data_validade.asc()  # FIFO: primeiro a vencer primeiro
        ).all()
        
        lotes_dict = [lote.to_dict() for lote in lotes]
        
        return jsonify({
            'produto_id': produto_id,
            'produto_nome': produto.nome,
            'total_quantidade': produto.quantidade,
            'lotes': lotes_dict,
            'total_lotes': len(lotes_dict)
        })
        
    except Exception as e:
        from flask import current_app
        import traceback
        current_app.logger.error(f"Erro ao listar lotes de {produto_id}: {str(e)}\n{traceback.format_exc()}")
        
        # Blindagem: Se falhou por causa da coluna lote_id ou similar em SQLite Docker 
        # retornamos lista vazia para nao travar o frontend
        if "no such column" in str(e).lower() or "lote_id" in str(e):
            return jsonify({
                'produto_id': produto_id,
                'lotes': [],
                'total_lotes': 0,
                'warning': 'Schema de lotes nao sincronizado'
            })
            
        return jsonify({'error': str(e)}), 500


@pedidos_compra_bp.route('/boletos/<int:conta_id>/pagar', methods=['POST'])
@funcionario_required
def pagar_boleto(conta_id):
    """Baixa atômica; replay com a mesma chave retorna a resposta já gravada."""
    try:
        user = get_current_user()
        if not user:
            return jsonify({'error': 'Usuário não encontrado'}), 404
        from app.utils.query_helpers import get_authorized_establishment_id
        estab_id = get_authorized_establishment_id()
        
        from app.utils.boleto_payment_validation import money, payment_request
        data = request.get_json(silent=True)
        key, fingerprint, valor_pago, data_pagamento, method = payment_request(
            data, request.headers.get('Idempotency-Key'), conta_id)

        conta = ContaPagar.query.populate_existing().with_for_update().filter_by(
            id=conta_id,
            estabelecimento_id=estab_id
        ).first()
        
        if not conta:
            return jsonify({'error': 'Boleto não encontrado'}), 404

        if key:
            previous = ContaPagarBaixa.query.filter_by(estabelecimento_id=estab_id, idempotency_key=key).first()
            if previous:
                if previous.conta_pagar_id != conta_id or previous.request_hash != fingerprint:
                    return jsonify({'error': 'Chave de idempotência já usada em outro pagamento'}), 409
                return jsonify(previous.resposta_json)

        if conta.status not in ('aberto', 'parcial'):
            return jsonify({'error': f'Boleto não pode ser pago no status atual: {conta.status}'}), 400
        
        if valor_pago is None:
            valor_pago = money(conta.valor_atual)

        if valor_pago <= 0:
            return jsonify({'error': 'Valor pago deve ser maior que zero'}), 400

        if valor_pago > conta.valor_atual:
            return jsonify({'error': 'Valor pago não pode ser maior que o saldo devedor atual'}), 400

        # Atualizar conta acumulando o valor pago
        novo_valor_pago = (conta.valor_pago or Decimal('0')) + valor_pago
        conta.valor_pago = novo_valor_pago
        conta.valor_atual = conta.valor_original - novo_valor_pago
        conta.data_pagamento = data_pagamento
        conta.forma_pagamento = method

        if conta.valor_atual <= 0:
            conta.status = 'pago'
        else:
            conta.status = 'parcial'

        conta.observacoes = data.get('observacoes', conta.observacoes)
        
        # Criar despesa correspondente
        despesa = Despesa(
            estabelecimento_id=estab_id,
            fornecedor_id=conta.fornecedor_id,
            descricao=f'Pagamento {conta.numero_documento} - {conta.fornecedor.nome_fantasia if conta.fornecedor else "Fornecedor"}',
            categoria='Fornecedores',
            tipo='variavel',
            valor=valor_pago,
            data_despesa=data_pagamento,
            forma_pagamento=conta.forma_pagamento,
            recorrente=False,
            observacoes=f'Pagamento de boleto - Pedido: {conta.pedido_compra.numero_pedido if conta.pedido_compra else "N/A"}'
        )
        
        db.session.add(despesa)
        db.session.flush()
        resposta = {'message': 'Pagamento registrado com sucesso', 'conta': conta.to_dict()}
        baixa = ContaPagarBaixa(estabelecimento_id=estab_id, conta_pagar_id=conta.id,
                               despesa_id=despesa.id, funcionario_id=user.id, valor=valor_pago,
                               data_pagamento=data_pagamento, idempotency_key=key,
                               request_hash=fingerprint, resposta_json=resposta)
        db.session.add(baixa)
        db.session.flush()
        resposta = {**resposta, 'baixa_id': baixa.id}
        baixa.resposta_json = resposta
        db.session.commit()
        return jsonify(resposta)

    except ValueError as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400
    except IntegrityError:
        db.session.rollback()
        return jsonify({'error': 'Conflito no registro do pagamento; confira a chave de idempotência'}), 409
    except Exception as e:
        db.session.rollback()
        current_app.logger.error('Falha ao baixar boleto %s: %s', conta_id, type(e).__name__)
        return jsonify({'error': 'Não foi possível registrar o pagamento'}), 500
