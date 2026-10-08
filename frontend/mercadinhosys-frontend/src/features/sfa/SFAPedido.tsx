import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiClient } from '../../api/apiClient';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { ArrowLeft, Plus, Minus, ShoppingCart, Check, Trash2, Tag, Search, } from 'lucide-react';
import { showToast } from '../../utils/toast';
import { v4 as uuidv4 } from 'uuid';

export default function SFAPedido() {
    const location = useLocation();
    const navigate = useNavigate();
    const cliente = location.state?.cliente;
    
    const [produtos, setProdutos] = useState<any[]>([]);
    const [tabelaItens, setTabelaItens] = useState<any[]>([]);
    const [carrinho, setCarrinho] = useState<any[]>([]);
    const [busca, setBusca] = useState('');
    const [condicaoPagamento, setCondicaoPagamento] = useState('30 Dias');
    const [submetendo, setSubmetendo] = useState(false);

    useEffect(() => {
        if (!cliente) {
            navigate('/sfa');
            return;
        }
        
        // Carregar do Offline Storage
        const p = JSON.parse(localStorage.getItem('@sfa_produtos') || '[]');
        const ti = JSON.parse(localStorage.getItem('@sfa_tabelas_itens') || '[]');
        
        // Filtrar itens da tabela do cliente
        const itensTabelaCliente = ti.filter((i: any) => i.tabela_id === cliente.tabela_preco_id);
        
        setProdutos(p);
        setTabelaItens(itensTabelaCliente);
    }, [cliente, navigate]);

    // Calcula preço para o cliente atual
    const getPrecoVenda = (produto: any) => {
        const item = tabelaItens.find(i => i.produto_id === produto.id);
        if (item) return parseFloat(item.preco_venda);
        return parseFloat(produto.preco_venda);
    };

    const getPrecoMinimo = (produto: any) => {
        const item = tabelaItens.find(i => i.produto_id === produto.id);
        if (item) return parseFloat(item.preco_minimo);
        return parseFloat(produto.preco_venda) * 0.9; // 10% fallback
    };

    const addToCart = (produto: any) => {
        const preco = getPrecoVenda(produto);
        const precoMin = getPrecoMinimo(produto);
        
        setCarrinho(prev => {
            const index = prev.findIndex(item => item.produto.id === produto.id);
            if (index >= 0) {
                const newCart = [...prev];
                newCart[index].quantidade += 1;
                return newCart;
            }
            return [...prev, { produto, quantidade: 1, preco, precoMinimo: precoMin, precoUnitarioEditado: preco }];
        });
        showToast.success('Produto adicionado');
    };

    const updateCart = (index: number, changes: any) => {
        setCarrinho(prev => {
            const newCart = [...prev];
            newCart[index] = { ...newCart[index], ...changes };
            
            // Validar preço mínimo
            if (changes.precoUnitarioEditado !== undefined) {
                if (changes.precoUnitarioEditado < newCart[index].precoMinimo) {
                    showToast.warning('Preço abaixo do mínimo permitido!');
                    newCart[index].precoUnitarioEditado = newCart[index].precoMinimo;
                }
            }
            return newCart;
        });
    };

    const removeFromCart = (index: number) => {
        setCarrinho(prev => prev.filter((_, i) => i !== index));
    };

    const produtosFiltrados = produtos.filter(p => p.nome.toLowerCase().includes(busca.toLowerCase()));
    
    const totalCarrinho = carrinho.reduce((acc, item) => acc + (item.quantidade * item.precoUnitarioEditado), 0);

    const submitPedido = async () => {
        if (carrinho.length === 0) return showToast.warning('Carrinho vazio');
        
        const pedido = {
            cliente_id: cliente.id,
            offline_uuid: uuidv4(),
            subtotal: totalCarrinho,
            total: totalCarrinho,
            condicao_pagamento: condicaoPagamento,
            itens: carrinho.map(item => ({
                produto_id: item.produto.id,
                quantidade: item.quantidade,
                preco_unitario: item.precoUnitarioEditado,
                total_item: item.quantidade * item.precoUnitarioEditado
            }))
        };

        try {
            setSubmetendo(true);
            // Tenta enviar online
            await apiClient.post('/sfa/sync-pedidos', { pedidos: [pedido] });
            showToast.success('Pedido enviado com sucesso!');
            navigate('/sfa');
        } catch (error) {
            console.log('Offline: Salvar pedido na fila', error);
            const fila = JSON.parse(localStorage.getItem('@sfa_fila_pedidos') || '[]');
            fila.push(pedido);
            localStorage.setItem('@sfa_fila_pedidos', JSON.stringify(fila));
            showToast.success('Pedido salvo offline! Será sincronizado depois.');
            navigate('/sfa');
        } finally {
            setSubmetendo(false);
        }
    };

    if (!cliente) return null;

    return (
        <div className="flex flex-col h-[calc(100vh-4rem)] bg-slate-50 dark:bg-slate-950 -m-6 relative">
            {/* Header Fixo */}
            <div className="sticky top-0 bg-white dark:bg-slate-900 shadow-sm z-10 p-4 pb-3">
                <div className="flex items-center gap-3">
                    <Button variant="ghost" size="icon" onClick={() => navigate('/sfa')} className="rounded-full">
                        <ArrowLeft className="w-6 h-6" />
                    </Button>
                    <div>
                        <h1 className="font-bold text-slate-800 dark:text-slate-100 truncate pr-4">{cliente.nome}</h1>
                        <p className="text-xs text-slate-500">Novo Pedido • Limite: R$ {parseFloat(cliente.limite_credito || 0).toFixed(2)}</p>
                    </div>
                </div>
                <div className="mt-4 relative">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <Input 
                        placeholder="Buscar produtos..." 
                        value={busca}
                        onChange={(e) => setBusca(e.target.value)}
                        className="pl-9 bg-slate-50 dark:bg-slate-800"
                    />
                </div>
            </div>

            {/* Lista de Produtos */}
            <div className="flex-1 overflow-y-auto p-4 pb-32">
                <div className="grid grid-cols-1 gap-3">
                    {produtosFiltrados.map(p => (
                        <Card key={p.id} className="overflow-hidden border-slate-200 dark:border-slate-800">
                            <CardContent className="p-3 flex justify-between items-center gap-2">
                                <div className="flex-1 min-w-0">
                                    <h3 className="font-medium text-sm text-slate-800 dark:text-slate-200 truncate">{p.nome}</h3>
                                    <div className="flex items-center gap-2 mt-1">
                                        <span className="font-bold text-blue-600 dark:text-blue-400">
                                            R$ {getPrecoVenda(p).toFixed(2)}
                                        </span>
                                        {getPrecoVenda(p) < p.preco_venda && (
                                            <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 rounded flex items-center">
                                                <Tag className="w-3 h-3 mr-1" />
                                                Promoção Tabela
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-[10px] text-slate-400 mt-0.5">Mínimo: R$ {getPrecoMinimo(p).toFixed(2)}</p>
                                </div>
                                <Button size="sm" onClick={() => addToCart(p)} className="rounded-full w-10 h-10 p-0 shrink-0 bg-blue-100 hover:bg-blue-200 text-blue-700 dark:bg-blue-900/40 dark:hover:bg-blue-800/60 dark:text-blue-300">
                                    <Plus className="w-5 h-5" />
                                </Button>
                            </CardContent>
                        </Card>
                    ))}
                </div>
                
                {/* Carrinho View */}
                {carrinho.length > 0 && (
                    <div className="mt-8 border-t border-slate-200 dark:border-slate-800 pt-6">
                        <h2 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                            <ShoppingCart className="w-5 h-5" /> Resumo do Carrinho
                        </h2>
                        
                        <div className="space-y-4">
                            {carrinho.map((item, idx) => (
                                <div key={idx} className="bg-white dark:bg-slate-900 p-3 rounded-lg shadow-sm border border-slate-100 dark:border-slate-800">
                                    <div className="flex justify-between items-start mb-3">
                                        <h4 className="text-sm font-medium pr-4 line-clamp-2">{item.produto.nome}</h4>
                                        <Button variant="ghost" size="icon" className="h-6 w-6 text-red-500 rounded-full" onClick={() => removeFromCart(idx)}>
                                            <Trash2 className="w-4 h-4" />
                                        </Button>
                                    </div>
                                    <div className="flex items-center justify-between gap-4">
                                        <div className="flex items-center bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
                                            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-md" onClick={() => updateCart(idx, { quantidade: Math.max(1, item.quantidade - 1) })}>
                                                <Minus className="w-4 h-4" />
                                            </Button>
                                            <span className="w-8 text-center text-sm font-bold">{item.quantidade}</span>
                                            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-md" onClick={() => updateCart(idx, { quantidade: item.quantidade + 1 })}>
                                                <Plus className="w-4 h-4" />
                                            </Button>
                                        </div>
                                        <div className="flex flex-col items-end w-24">
                                            <label className="text-[10px] text-slate-500 mb-1">Preço Negociado</label>
                                            <Input 
                                                type="number" 
                                                step="0.01" 
                                                className="h-8 text-right font-bold text-sm"
                                                value={item.precoUnitarioEditado} 
                                                onChange={(e) => updateCart(idx, { precoUnitarioEditado: parseFloat(e.target.value) || 0 })}
                                                onBlur={(e) => {
                                                    const val = parseFloat(e.target.value) || item.preco;
                                                    updateCart(idx, { precoUnitarioEditado: Math.max(val, item.precoMinimo) });
                                                }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                        
                        <div className="mt-4 bg-white dark:bg-slate-900 p-3 rounded-lg shadow-sm border border-slate-100 dark:border-slate-800">
                            <label className="text-xs font-medium text-slate-500 mb-1 block">Condição de Pagamento</label>
                            <select 
                                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md h-10 px-3 text-sm"
                                value={condicaoPagamento}
                                onChange={(e) => setCondicaoPagamento(e.target.value)}
                            >
                                <option>A Vista</option>
                                <option>30 Dias</option>
                                <option>30/60 Dias</option>
                                <option>30/60/90 Dias</option>
                            </select>
                        </div>
                    </div>
                )}
            </div>

            {/* Footer Fixo */}
            <div className="absolute bottom-0 left-0 right-0 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 p-4 flex items-center justify-between shadow-[0_-4px_10px_rgba(0,0,0,0.05)]">
                <div>
                    <p className="text-xs text-slate-500">Total ({carrinho.length} itens)</p>
                    <p className="text-2xl font-black text-slate-900 dark:text-white">R$ {totalCarrinho.toFixed(2)}</p>
                </div>
                <Button 
                    className="bg-emerald-500 hover:bg-emerald-600 text-white rounded-full px-6 shadow-md shadow-emerald-500/20"
                    size="lg"
                    disabled={carrinho.length === 0 || submetendo}
                    onClick={submitPedido}
                >
                    {submetendo ? (
                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    ) : (
                        <>
                            <Check className="w-5 h-5 mr-2" />
                            Finalizar
                        </>
                    )}
                </Button>
            </div>
        </div>
    );
}
