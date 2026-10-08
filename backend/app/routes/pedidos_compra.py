# app/routes/pedidos_compra.py
from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import get_jwt_identity
from datetime import datetime, date, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from sqlalchemy import func, and_, or_
from sqlalchemy.orm import joinedload
from sqlalchemy.exc import IntegrityError

from app import db
from app.models import (
    PedidoCompra, PedidoCompraItem, Produto, Fornecedor, Funcionario,
    ContaPagar, ContaPagarBaixa, MovimentacaoEstoque, Despesa, ProdutoLote
)
from app.decorators.decorator_jwt import funcionario_required
from app.services.estoque_service import quantidade_valida
from app.utils.sale_validation import number

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
            
            # Fração preservada (kg, litro); preço e desconto validados antes de virar obrigação.
            quantidade = quantidade_valida(item_data.get('quantidade'))
            preco_unitario = number(item_data.get('preco_unitario', produto.preco_custo), 'Preço unitário')
            desconto = number(item_data.get('desconto_percentual', 0), 'Desconto do item')
            if desconto > 100:
                raise ValueError('Desconto do item acima de 100%')

            total_item = (quantidade * preco_unitario * (1 - desconto / 100)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
            
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
        desconto_pedido = number(data.get('desconto', 0), 'Desconto do pedido')
        frete = number(data.get('frete', 0), 'Frete')
        if desconto_pedido > subtotal:
            raise ValueError('Desconto maior que o valor dos itens')
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

    except ValueError as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400
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

CENT = Decimal('0.01')


def _qtd_recebimento(valor, rotulo):
    """Quantidade não negativa e finita (kg/litro aceitam fração)."""
    try:
        quantidade = Decimal(str(valor if valor not in (None, '') else 0))
    except (InvalidOperation, TypeError, ValueError):
        raise ValueError(f'{rotulo} inválida') from None
    if not quantidade.is_finite() or quantidade < 0 or quantidade > Decimal('9999999'):
        raise ValueError(f'{rotulo} inválida')
    return quantidade.quantize(Decimal('0.001'), rounding=ROUND_HALF_UP)


def _preco_liquido(item):
    """Preço unitário já com o desconto do item, como gravado na emissão do pedido."""
    solicitada = Decimal(str(item.quantidade_solicitada or 0))
    if solicitada > 0:
        return Decimal(str(item.total_item or 0)) / solicitada
    return Decimal(str(item.preco_unitario or 0))


def _valor_devido(pedido):
    """Obrigação com o fornecedor: total do pedido (com frete e desconto) menos o
    valor líquido do que veio faltando ou avariado."""
    abatimento = sum(((Decimal(str(i.quantidade_faltante or 0)) + Decimal(str(i.quantidade_avariada or 0)))
                      * _preco_liquido(i) for i in pedido.itens), Decimal('0'))
    devido = (Decimal(str(pedido.total or 0)) - abatimento).quantize(CENT, rounding=ROUND_HALF_UP)
    return devido if devido > 0 else Decimal('0')


def _ajustar_conta_pagar(conta, devido):
    """Recalcula o título preservando o que já foi pago."""
    if conta.status == 'cancelado':
        return
    pago = Decimal(str(conta.valor_pago or 0))
    conta.valor_original = devido
    conta.valor_atual = max(Decimal('0'), devido - pago)
    if pago > devido:
        conta.observacoes = f"{conta.observacoes or ''} | Crédito com fornecedor: R$ {pago - devido:.2f}".strip(' |')
    if conta.valor_atual > 0:
        conta.status = 'parcial' if pago > 0 else 'aberto'
    else:
        conta.status = 'pago' if pago > 0 else 'cancelado'


def _numero_lote_livre(estab_id, base):
    """Número de lote único na loja; recebimentos seguintes do mesmo item ganham sufixo."""
    numero, seq = base[:50], 2
    while ProdutoLote.query.filter_by(estabelecimento_id=estab_id, numero_lote=numero).first():
        sufixo = f'-{seq}'
        numero = base[:50 - len(sufixo)] + sufixo
        seq += 1
    return numero


@pedidos_compra_bp.route('/pedidos-compra/receber', methods=['POST'])
@funcionario_required
def receber_pedido_compra():
    """Registra um recebimento (total ou parcial) acumulando no pedido.

    Cada recebimento cria lote e movimento; o pedido fica ``parcial`` até todos
    os itens estarem recebidos ou declarados em falta. O título do fornecedor
    passa a valer o total do pedido menos faltas e avarias, preservando baixas.
    """
    try:
        user = get_current_user()
        if not user:
            return jsonify({'error': 'Usuário não encontrado'}), 404
        from app.utils.query_helpers import get_authorized_establishment_id
        estab_id = get_authorized_establishment_id()

        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return jsonify({'error': 'Dados não fornecidos'}), 400
        pedido_id = data.get('pedido_id')

        # Trava o pedido: dois recebimentos simultâneos não somam a mesma carga.
        pedido = PedidoCompra.query.filter_by(
            id=pedido_id,
            estabelecimento_id=estab_id
        ).populate_existing().with_for_update().first()

        if not pedido:
            return jsonify({'error': 'Pedido não encontrado'}), 404

        if pedido.status not in ('pendente', 'parcial'):
            return jsonify({'error': 'Pedido já foi processado'}), 400

        itens_recebidos = data.get('itens', [])
        if not isinstance(itens_recebidos, list) or not itens_recebidos:
            return jsonify({'error': 'Informe os itens recebidos'}), 400
        itens_pedido = {item.id: item for item in pedido.itens}
        fator_rateio = Decimal('1')
        if Decimal(str(pedido.subtotal or 0)) > 0:
            # Frete e desconto do pedido entram no custo proporcionalmente ao valor.
            fator_rateio = Decimal(str(pedido.total or 0)) / Decimal(str(pedido.subtotal))
        movimentou = False

        for item_data in itens_recebidos:
            if not isinstance(item_data, dict):
                raise ValueError('Item de recebimento inválido')
            item = itens_pedido.get(int(item_data.get('item_id') or 0))
            if not item:
                raise ValueError(f"Item {item_data.get('item_id')} não pertence ao pedido")

            quantidade_recebida = _qtd_recebimento(item_data.get('quantidade_recebida'), 'Quantidade recebida')
            quantidade_avariada = _qtd_recebimento(item_data.get('quantidade_avariada'), 'Quantidade avariada')
            quantidade_faltante = _qtd_recebimento(item_data.get('quantidade_faltante'), 'Quantidade faltante')
            quantidade_bonificada = _qtd_recebimento(item_data.get('quantidade_bonificada'), 'Quantidade bonificada')
            if quantidade_recebida + quantidade_faltante + quantidade_bonificada == 0:
                continue
            if quantidade_avariada > quantidade_recebida:
                raise ValueError(f'Avaria maior que o recebido em {item.produto_nome}')
            saldo_item = (Decimal(str(item.quantidade_solicitada or 0)) - Decimal(str(item.quantidade_recebida or 0))
                          - Decimal(str(item.quantidade_faltante or 0)))
            if quantidade_recebida + quantidade_faltante > saldo_item:
                raise ValueError(f'{item.produto_nome}: recebido + falta excede o saldo pendente ({saldo_item:f})')

            item.quantidade_recebida = Decimal(str(item.quantidade_recebida or 0)) + quantidade_recebida
            item.quantidade_avariada = Decimal(str(item.quantidade_avariada or 0)) + quantidade_avariada
            item.quantidade_faltante = Decimal(str(item.quantidade_faltante or 0)) + quantidade_faltante
            item.quantidade_bonificada = Decimal(str(item.quantidade_bonificada or 0)) + quantidade_bonificada
            concluido = item.quantidade_recebida + item.quantidade_faltante >= Decimal(str(item.quantidade_solicitada))
            item.status = 'recebido' if concluido else 'parcial'
            movimentou = True

            # Estoque recebe só o que é vendável: recebido - avariado + bonificado.
            quantidade_para_estoque = quantidade_recebida - quantidade_avariada + quantidade_bonificada
            produto = item.produto
            if produto and quantidade_para_estoque > 0:
                data_validade = None
                data_fabricacao = None
                if item_data.get('data_validade'):
                    data_validade = datetime.strptime(str(item_data['data_validade'])[:10], '%Y-%m-%d').date()
                if item_data.get('data_fabricacao'):
                    data_fabricacao = datetime.strptime(str(item_data['data_fabricacao'])[:10], '%Y-%m-%d').date()
                if data_validade is None:
                    if produto.controlar_validade:
                        raise ValueError(f'Informe a validade do lote de {produto.nome}')
                    # Sem controle de validade a data não restringe a venda.
                    data_validade = date.today() + timedelta(days=365)

                numero_lote = _numero_lote_livre(
                    estab_id, str(item_data.get('numero_lote') or f"LOTE-{pedido.numero_pedido}-{item.id}"))
                # Bonificação dilui o custo; avaria não entra no estoque nem é paga.
                custo_entrada = ((quantidade_recebida - quantidade_avariada) * _preco_liquido(item) * fator_rateio
                                 / quantidade_para_estoque).quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP)

                lote = ProdutoLote(
                    estabelecimento_id=estab_id,
                    produto_id=produto.id,
                    fornecedor_id=pedido.fornecedor_id,
                    pedido_compra_id=pedido.id,
                    numero_lote=numero_lote,
                    quantidade=quantidade_para_estoque,
                    quantidade_inicial=quantidade_para_estoque,
                    data_fabricacao=data_fabricacao,
                    data_validade=data_validade,
                    data_entrada=date.today(),
                    preco_custo_unitario=custo_entrada,
                    ativo=True,
                )
                db.session.add(lote)

                # Custo médio ponderado ANTES de somar a entrada ao saldo.
                produto.recalcular_preco_custo_ponderado(
                    quantidade_entrada=quantidade_para_estoque,
                    custo_unitario_entrada=custo_entrada,
                    funcionario_id=user.id,
                    motivo=f'Recebimento pedido {pedido.numero_pedido}'
                )

                motivo_movimentacao = f'Recebimento pedido {pedido.numero_pedido}. Lote: {numero_lote}'
                if quantidade_avariada > 0 or quantidade_bonificada > 0:
                    motivo_movimentacao += f' (Avarias: {quantidade_avariada:f}, Bônus: {quantidade_bonificada:f})'

                db.session.flush()
                movimentacao = produto.movimentar_estoque(
                    quantidade=quantidade_para_estoque,
                    tipo='entrada',
                    motivo=motivo_movimentacao[:100],
                    usuario_id=user.id
                )
                movimentacao.pedido_compra_id = pedido.id
                movimentacao.lote_id = lote.id
                movimentacao.custo_unitario = custo_entrada
                movimentacao.valor_total = (custo_entrada * quantidade_para_estoque).quantize(CENT, rounding=ROUND_HALF_UP)
                db.session.add(movimentacao)

        if not movimentou:
            return jsonify({'error': 'Nenhuma quantidade informada para receber'}), 400

        concluido = all(item.status == 'recebido' for item in pedido.itens)
        pedido.status = 'recebido' if concluido else 'parcial'
        pedido.data_recebimento = date.today()
        if data.get('numero_nota_fiscal'):
            pedido.numero_nota_fiscal = data['numero_nota_fiscal']
        if data.get('serie_nota_fiscal'):
            pedido.serie_nota_fiscal = data['serie_nota_fiscal']

        devido = _valor_devido(pedido)
        conta_existente = ContaPagar.query.filter_by(pedido_compra_id=pedido.id, estabelecimento_id=estab_id)\
            .populate_existing().with_for_update().first()
        if conta_existente:
            _ajustar_conta_pagar(conta_existente, devido)
            if data.get('numero_documento'):
                conta_existente.numero_documento = data.get('numero_documento')
        elif data.get('gerar_boleto', False) and devido > 0:
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
                valor_original=devido,
                valor_atual=devido,
                data_emissao=date.today(),
                data_vencimento=data_vencimento,
                status='aberto',
                observacoes=f'Referente ao pedido {pedido.numero_pedido}'
            )
            db.session.add(conta_pagar)

        db.session.commit()

        return jsonify({
            'message': 'Pedido recebido com sucesso' if concluido else 'Recebimento parcial registrado',
            'pedido': pedido.to_dict()
        })

    except ValueError as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        db.session.rollback()
        current_app.logger.error('Falha ao receber pedido de compra: %s', e)
        return jsonify({'error': 'Não foi possível registrar o recebimento'}), 500

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
