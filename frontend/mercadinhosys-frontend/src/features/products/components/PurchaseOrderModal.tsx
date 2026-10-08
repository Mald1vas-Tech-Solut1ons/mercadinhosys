// src/features/products/components/PurchaseOrderModal.tsx
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Trash2, Package, Save, Camera, Barcode, Cloud, Loader2 } from 'lucide-react';
import { Fornecedor, Produto } from '../../../types';
import { CreatePedidoData, purchaseOrderService } from '../purchaseOrderService';
import { productsService } from '../productsService';
import { cosmosService } from '../../../services/cosmosService';
import { apiClient } from '../../../api/apiClient';
import { formatCurrency } from '../../../utils/formatters';
import { showToast } from '../../../utils/toast';
import BarcodeScanner from '../../pdv/components/BarcodeScanner';

interface PurchaseOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  fornecedores: Fornecedor[];
  initialProduct?: Produto | null;
  initialSupplierId?: number;
}

interface ItemPedido {
  produto_id: number;
  produto_nome: string;
  quantidade: number;
  preco_unitario: number;
  desconto_percentual: number;
  total_item: number;
}

const PurchaseOrderModal: React.FC<PurchaseOrderModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  fornecedores,
  initialProduct,
  initialSupplierId
}) => {
  const [loading, setLoading] = useState(false);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [searchProduto, setSearchProduto] = useState('');
  const [condicoesPagamento, setCondicoesPagamento] = useState<{nome: string, tipo: string, dias_prazo: number}[]>([]);
  const [buscando, setBuscando] = useState(false);
  // EAN digitado/escaneado que não existe no nosso banco → oferece cadastro via COSMOS
  const [eanNaoEncontrado, setEanNaoEncontrado] = useState<string | null>(null);
  const [buscandoCosmos, setBuscandoCosmos] = useState(false);
  const [scannerAberto, setScannerAberto] = useState(false);

  const ehEAN = (v: string) => /^\d{8,14}$/.test(v.trim());

  // Form data
  const hoje = new Date().toISOString().slice(0, 10);
  const [formData, setFormData] = useState({
    fornecedor_id: 0,
    condicao_pagamento: '',
    observacoes: '',
    desconto: 0,
    frete: 0,
    data_pedido: hoje,
    data_previsao_entrega: '',
    horario_entrega: '',
  });

  const [itens, setItens] = useState<ItemPedido[]>([]);

  // Initialize with initial data if provided
  useEffect(() => {
    if (isOpen) {
      // Fetch dynamic payment conditions
      apiClient.get('/configuracao/condicoes-pagamento')
        .then(res => {
          if (res.data.success && res.data.condicoes) {
            setCondicoesPagamento(res.data.condicoes);
          }
        })
        .catch(err => console.error('Erro ao buscar condicoes de pagamento:', err));

      if (initialSupplierId) {
        setFormData(prev => ({ ...prev, fornecedor_id: initialSupplierId }));
      }

      if (initialProduct) {
        const novoItem: ItemPedido = {
          produto_id: initialProduct.id,
          produto_nome: initialProduct.nome,
          quantidade: initialProduct.quantidade_minima > initialProduct.quantidade
            ? (initialProduct.quantidade_minima - initialProduct.quantidade) + 10 // Suggest buying enough to exceed min + buffer
            : 10, // Default quantity
          preco_unitario: initialProduct.preco_custo,
          desconto_percentual: 0,
          total_item: initialProduct.preco_custo * (initialProduct.quantidade_minima > initialProduct.quantidade
            ? (initialProduct.quantidade_minima - initialProduct.quantidade) + 10
            : 10)
        };
        setItens([novoItem]);
      } else {
        // Reset if no initial product
        setItens([]);
        setFormData(prev => ({ ...prev, fornecedor_id: 0 }));
      }
    }
  }, [isOpen, initialProduct, initialSupplierId]);

  // Buscar produtos (mesmo mecanismo do PDV: busca local por nome/código de barras;
  // se for um EAN e não existir no nosso banco, oferece cadastrar puxando da COSMOS).
  useEffect(() => {
    const termo = searchProduto.trim();
    setEanNaoEncontrado(null);
    if (termo.length < 2) {
      setProdutos([]);
      return;
    }
    const timer = setTimeout(async () => {
      setBuscando(true);
      try {
        const response = await apiClient.get<{ produtos: Produto[] }>('/produtos/', {
          params: {
            // Params conforme o backend (listar_produtos): por_pagina/ativo.
            // 'busca' casa por NOME e por CÓDIGO DE BARRAS.
            busca: termo,
            por_pagina: 20,
            ativo: true,
          }
        });
        const achados = response.data.produtos || [];
        setProdutos(achados);
        // EAN digitado/escaneado sem correspondência → habilita fluxo COSMOS
        if (achados.length === 0 && ehEAN(termo)) {
          setEanNaoEncontrado(termo);
        }
      } catch (error) {
        console.error('Erro ao buscar produtos:', error);
      } finally {
        setBuscando(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchProduto]);

  // Não achou o EAN no banco → consulta COSMOS, cadastra o produto e adiciona ao pedido.
  const cadastrarViaCosmos = async (ean: string) => {
    setBuscandoCosmos(true);
    try {
      const res = await cosmosService.lookup(ean);
      if (!res.success || !res.data) {
        showToast.error(res.message || 'Produto não encontrado na COSMOS.');
        return;
      }
      const c = res.data;
      const precoRef = c.preco_referencia ?? 0;
      const criado = await productsService.create({
        nome: c.nome || `Produto ${ean}`,
        categoria: c.categoria || 'Geral',
        codigo_barras: ean,
        preco_custo: precoRef || 0.01,
        preco_venda: precoRef || 0.01,
        marca: c.marca || undefined,
        ncm: c.ncm || undefined,
        quantidade: 0,
      } as any);

      // create trata 409 (já existe) devolvendo o produto existente
      const prod = (criado.produto || (criado as any).produto_existente) as Produto | undefined;
      if (!prod || !prod.id) {
        showToast.error(criado.message || 'Não foi possível cadastrar o produto.');
        return;
      }
      handleAddItem(prod);
      showToast.success(`"${prod.nome}" cadastrado via ${res.source === 'catalogo' ? 'catálogo' : 'COSMOS'} e adicionado.`);
      setSearchProduto('');
      setEanNaoEncontrado(null);
    } catch (e: any) {
      showToast.error(e?.response?.data?.error || 'Falha ao cadastrar produto via COSMOS.');
    } finally {
      setBuscandoCosmos(false);
    }
  };

  const handleScan = (codigo: string) => {
    setScannerAberto(false);
    setSearchProduto(codigo);
  };

  // Calcular totais
  const subtotal = itens.reduce((sum, item) => sum + item.total_item, 0);
  const total = subtotal - formData.desconto + formData.frete;

  const handleAddItem = (produto: Produto) => {
    const itemExistente = itens.find(item => item.produto_id === produto.id);

    if (itemExistente) {
      setItens(itens.map(item =>
        item.produto_id === produto.id
          ? { ...item, quantidade: item.quantidade + 1, total_item: (item.quantidade + 1) * item.preco_unitario * (1 - item.desconto_percentual / 100) }
          : item
      ));
    } else {
      const novoItem: ItemPedido = {
        produto_id: produto.id,
        produto_nome: produto.nome,
        quantidade: 1,
        preco_unitario: produto.preco_custo,
        desconto_percentual: 0,
        total_item: produto.preco_custo
      };
      setItens([...itens, novoItem]);
    }

    setSearchProduto('');
    setProdutos([]);
  };

  const handleUpdateItem = (index: number, field: keyof ItemPedido, value: number) => {
    const novosItens = [...itens];
    novosItens[index] = { ...novosItens[index], [field]: value };

    // Recalcular total do item
    if (field === 'quantidade' || field === 'preco_unitario' || field === 'desconto_percentual') {
      const item = novosItens[index];
      item.total_item = item.quantidade * item.preco_unitario * (1 - item.desconto_percentual / 100);
    }

    setItens(novosItens);
  };

  const handleRemoveItem = (index: number) => {
    setItens(itens.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.fornecedor_id) {
      showToast.error('Selecione um fornecedor');
      return;
    }

    if (itens.length === 0) {
      showToast.error('Adicione pelo menos um item ao pedido');
      return;
    }

    setLoading(true);

    try {
      const pedidoData: CreatePedidoData = {
        fornecedor_id: formData.fornecedor_id,
        condicao_pagamento: formData.condicao_pagamento,
        observacoes: formData.observacoes,
        desconto: formData.desconto,
        frete: formData.frete,
        data_pedido: formData.data_pedido || undefined,
        data_previsao_entrega: formData.data_previsao_entrega || undefined,
        horario_entrega: formData.horario_entrega || undefined,
        itens: itens.map(item => ({
          produto_id: item.produto_id,
          quantidade: item.quantidade,
          preco_unitario: item.preco_unitario,
          desconto_percentual: item.desconto_percentual
        }))
      };

      await purchaseOrderService.criarPedido(pedidoData);
      showToast.success('Pedido de compra criado com sucesso!');
      onSuccess();
      handleClose();
    } catch (error: any) {
      console.error('Erro ao criar pedido:', error);
      showToast.error(error.response?.data?.error || 'Erro ao criar pedido');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setFormData({
      fornecedor_id: 0,
      condicao_pagamento: '',
      observacoes: '',
      desconto: 0,
      frete: 0,
      data_pedido: hoje,
      data_previsao_entrega: '',
      horario_entrega: '',
    });
    setItens([]);
    setSearchProduto('');
    setProdutos([]);
    onClose();
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-200 p-0 sm:p-4">
      <div className="bg-white dark:bg-gray-800 sm:rounded-xl shadow-2xl w-full max-w-6xl h-full sm:h-auto max-h-dvh sm:max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700 shrink-0" style={{ paddingTop: 'max(1.5rem, env(safe-area-inset-top))' }}>
          <div className="flex items-center gap-3">
            <Package className="w-6 h-6 text-blue-600" />
            <h2 className="text-xl font-bold text-gray-800 dark:text-white">
              Novo Pedido de Compra
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Informações do Pedido */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Fornecedor *
                </label>
                <select
                  value={formData.fornecedor_id}
                  onChange={(e) => setFormData(prev => ({ ...prev, fornecedor_id: parseInt(e.target.value) }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  required
                >
                  <option value={0}>Selecione um fornecedor</option>
                  {fornecedores.map(fornecedor => (
                    <option key={fornecedor.id} value={fornecedor.id}>
                      {fornecedor.nome_fantasia}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Condição de Pagamento
                </label>
                <select
                  value={formData.condicao_pagamento}
                  onChange={(e) => setFormData(prev => ({ ...prev, condicao_pagamento: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                >
                  <option value="">Selecione uma condição</option>
                  {condicoesPagamento.length > 0 ? condicoesPagamento.map((c, i) => (
                    <option key={i} value={c.nome}>{c.nome}</option>
                  )) : (
                    <>
                      <option value="PIX">PIX</option>
                      <option value="Crédito">Crédito</option>
                      <option value="Boleto 7 dias">Boleto 7 dias</option>
                      <option value="Boleto 14 dias">Boleto 14 dias</option>
                      <option value="Boleto 21 dias">Boleto 21 dias</option>
                      <option value="Boleto 30 dias">Boleto 30 dias</option>
                      <option value="À vista (Dinheiro)">À vista (Dinheiro)</option>
                    </>
                  )}
                </select>
                <div className="mt-3 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50 p-3 rounded-lg border border-gray-200 dark:border-gray-600">
                  <p className="font-semibold mb-1 text-gray-700 dark:text-gray-300">Condições Disponíveis:</p>
                  <ul className="list-disc list-inside space-y-1 ml-1">
                    <li><strong className="text-gray-600 dark:text-gray-300">PIX / À vista (Dinheiro):</strong> Pagamento no ato da entrega.</li>
                    <li><strong className="text-gray-600 dark:text-gray-300">Crédito:</strong> Cartão de crédito.</li>
                    <li><strong className="text-gray-600 dark:text-gray-300">Boletos (7, 14, 21, 30 dias):</strong> Gera automaticamente uma despesa no financeiro ao receber o pedido.</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Datas e janela de entrega */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Data do Pedido
                </label>
                <input
                  type="date"
                  value={formData.data_pedido}
                  onChange={(e) => setFormData(prev => ({ ...prev, data_pedido: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Previsão de Entrega
                </label>
                <input
                  type="date"
                  value={formData.data_previsao_entrega}
                  min={formData.data_pedido || undefined}
                  onChange={(e) => setFormData(prev => ({ ...prev, data_previsao_entrega: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                />
                <p className="text-[11px] text-gray-400 mt-1">Em branco: usa o prazo do fornecedor.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Horário de Entrega
                </label>
                <input
                  type="text"
                  value={formData.horario_entrega}
                  onChange={(e) => setFormData(prev => ({ ...prev, horario_entrega: e.target.value }))}
                  placeholder="Ex: 08:00 - 12:00"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                />
              </div>
            </div>

            {/* Busca de Produtos (nome ou código de barras; scanner + fallback COSMOS) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Adicionar Produtos
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setScannerAberto(true)}
                  title="Escanear código de barras"
                  className="p-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow shrink-0"
                >
                  <Camera className="w-5 h-5" />
                </button>
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={searchProduto}
                    onChange={(e) => setSearchProduto(e.target.value)}
                    placeholder="Nome, marca ou código de barras (EAN)..."
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  />
                  {buscando && (
                    <Loader2 className="w-4 h-4 text-blue-500 animate-spin absolute right-3 top-1/2 -translate-y-1/2" />
                  )}

                  {produtos.length > 0 && (
                    <div className="absolute top-full left-0 right-0 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg mt-1 max-h-60 overflow-y-auto z-10">
                      {produtos.map(produto => (
                        <button
                          key={produto.id}
                          type="button"
                          onClick={() => handleAddItem(produto)}
                          className="w-full px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700 border-b border-gray-200 dark:border-gray-600 last:border-b-0"
                        >
                          <div className="font-medium text-gray-800 dark:text-white flex items-center gap-2">
                            {produto.nome}
                            {(produto as any).codigo_barras && (
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-500">
                                {(produto as any).codigo_barras}
                              </span>
                            )}
                          </div>
                          <div className="text-sm text-gray-600 dark:text-gray-400">
                            Custo: {formatCurrency(produto.preco_custo)} | Estoque: {produto.quantidade}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* EAN não cadastrado no nosso banco → puxar da COSMOS e cadastrar */}
              {eanNaoEncontrado && (
                <div className="mt-2 p-3 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Barcode className="w-5 h-5 text-amber-600 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                        EAN {eanNaoEncontrado} não está no seu catálogo
                      </p>
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        Consulte a COSMOS para cadastrar e adicionar ao pedido.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => cadastrarViaCosmos(eanNaoEncontrado)}
                    disabled={buscandoCosmos}
                    className="shrink-0 px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-bold flex items-center gap-2 disabled:opacity-60"
                  >
                    {buscandoCosmos ? <Loader2 className="w-4 h-4 animate-spin" /> : <Cloud className="w-4 h-4" />}
                    {buscandoCosmos ? 'Consultando...' : 'Buscar na COSMOS'}
                  </button>
                </div>
              )}
            </div>

            {/* Lista de Itens */}
            {itens.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">
                  Itens do Pedido ({itens.length})
                </h3>

                <div className="overflow-x-auto">
                  <table className="w-full border border-gray-200 dark:border-gray-700 rounded-lg">
                    <thead className="bg-gray-50 dark:bg-gray-700">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">Produto</th>
                        <th className="px-4 py-3 text-center text-sm font-medium text-gray-700 dark:text-gray-300">Qtd</th>
                        <th className="px-4 py-3 text-center text-sm font-medium text-gray-700 dark:text-gray-300">Preço Unit.</th>
                        <th className="px-4 py-3 text-center text-sm font-medium text-gray-700 dark:text-gray-300">Desc. %</th>
                        <th className="px-4 py-3 text-center text-sm font-medium text-gray-700 dark:text-gray-300">Total</th>
                        <th className="px-4 py-3 text-center text-sm font-medium text-gray-700 dark:text-gray-300">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {itens.map((item, index) => (
                        <tr key={index} className="border-t border-gray-200 dark:border-gray-700">
                          <td className="px-4 py-3 text-sm text-gray-800 dark:text-white">
                            {item.produto_nome}
                          </td>
                          <td className="px-4 py-3">
                            <input
                              type="number"
                              min="1"
                              value={item.quantidade}
                              onChange={(e) => handleUpdateItem(index, 'quantidade', parseInt(e.target.value) || 1)}
                              className="w-20 px-2 py-1 text-center border border-gray-300 dark:border-gray-600 rounded focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={item.preco_unitario}
                              onChange={(e) => handleUpdateItem(index, 'preco_unitario', parseFloat(e.target.value) || 0)}
                              className="w-24 px-2 py-1 text-center border border-gray-300 dark:border-gray-600 rounded focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              max="100"
                              value={item.desconto_percentual}
                              onChange={(e) => handleUpdateItem(index, 'desconto_percentual', parseFloat(e.target.value) || 0)}
                              className="w-20 px-2 py-1 text-center border border-gray-300 dark:border-gray-600 rounded focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                            />
                          </td>
                          <td className="px-4 py-3 text-center text-sm font-medium text-gray-800 dark:text-white">
                            {formatCurrency(item.total_item)}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveItem(index)}
                              className="p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900 rounded transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Totais e Observações */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Observações
                </label>
                <textarea
                  value={formData.observacoes}
                  onChange={(e) => setFormData(prev => ({ ...prev, observacoes: e.target.value }))}
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="Observações sobre o pedido..."
                />
              </div>

              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Subtotal:</span>
                  <span className="text-lg font-semibold text-gray-800 dark:text-white">
                    {formatCurrency(subtotal)}
                  </span>
                </div>

                <div className="flex justify-between items-center">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Desconto:</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.desconto}
                    onChange={(e) => setFormData(prev => ({ ...prev, desconto: parseFloat(e.target.value) || 0 }))}
                    className="w-24 px-2 py-1 text-right border border-gray-300 dark:border-gray-600 rounded focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  />
                </div>

                <div className="flex justify-between items-center">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Frete:</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.frete}
                    onChange={(e) => setFormData(prev => ({ ...prev, frete: parseFloat(e.target.value) || 0 }))}
                    className="w-24 px-2 py-1 text-right border border-gray-300 dark:border-gray-600 rounded focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  />
                </div>

                <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                  <div className="flex justify-between items-center">
                    <span className="text-lg font-bold text-gray-800 dark:text-white">Total:</span>
                    <span className="text-xl font-bold text-blue-600 dark:text-blue-400">
                      {formatCurrency(total)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Footer — não encolhe e respeita a safe-area p/ os botões nunca ficarem sob a barra */}
          <div className="flex justify-end gap-3 p-6 border-t border-gray-200 dark:border-gray-700 shrink-0" style={{ paddingBottom: 'max(1.5rem, calc(1rem + env(safe-area-inset-bottom)))' }}>
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading || itens.length === 0}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Criando...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Criar Pedido
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {scannerAberto && (
        <BarcodeScanner onScan={handleScan} onClose={() => setScannerAberto(false)} />
      )}
    </div>,
    document.body
  );
};

export default PurchaseOrderModal;
