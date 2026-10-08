import { useState, useEffect } from 'react';
import { apiClient } from '../../api/apiClient';
import { showToast } from '../../utils/toast';
import { Check, X, Search, Clock, MapPin } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Input } from '../../components/ui/input';

export default function SFAPedidosTab() {
    const [pedidos, setPedidos] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [busca, setBusca] = useState('');
    const [detalhe, setDetalhe] = useState<any>(null);

    const carregarPedidos = async () => {
        setLoading(true);
        try {
            // Gerente/admin recebe a fila da loja inteira, com itens.
            const res = await apiClient.get('/sfa/pedidos', { params: { status: 'pendente' } });
            setPedidos(res.data?.status === 'success' ? res.data.data : []);
        } catch (error: any) {
            console.error('Erro ao buscar pedidos SFA:', error);
            // Sem pedido inventado: a fila fica vazia e o motivo aparece.
            setPedidos([]);
            showToast.error(error?.response?.data?.message || 'Não foi possível carregar os pedidos do SFA');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        carregarPedidos();
    }, []);

    const termo = busca.trim().toLowerCase();
    const pedidosFiltrados = termo
        ? pedidos.filter(p => `${p.cliente_nome || ''} ${p.codigo || ''} ${p.vendedor_nome || ''}`.toLowerCase().includes(termo))
        : pedidos;

    const aprovarPedido = async (id: number) => {
        try {
            await apiClient.post(`/sfa/pedidos/${id}/aprovar`);
            showToast.success('Pedido aprovado com sucesso!');
            setDetalhe(null);
            carregarPedidos();
        } catch (error: any) {
            // Estoque, crédito ou preço recusados pelo servidor: mostrar o motivo real.
            showToast.error(error?.response?.data?.message || 'Erro ao aprovar pedido');
        }
    };

    const rejeitarPedido = async (id: number) => {
        try {
            await apiClient.post(`/sfa/pedidos/${id}/rejeitar`);
            showToast.success('Pedido rejeitado.');
            setDetalhe(null);
            carregarPedidos();
        } catch (error: any) {
            showToast.error(error?.response?.data?.message || 'Erro ao rejeitar pedido');
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-col sm:flex-row justify-between gap-4 items-center">
                <div className="relative w-full sm:w-96">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <Input 
                        placeholder="Buscar pedido ou cliente..." 
                        className="pl-9 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800"
                        value={busca}
                        onChange={(e) => setBusca(e.target.value)}
                    />
                </div>
                <Button variant="outline" onClick={carregarPedidos} disabled={loading}>
                    Atualizar Lista
                </Button>
            </div>

            {loading ? (
                <div className="flex justify-center p-8"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div></div>
            ) : pedidosFiltrados.length === 0 ? (
                <Card className="bg-white dark:bg-slate-900 border-dashed border-2">
                    <CardContent className="flex flex-col items-center justify-center py-12 text-slate-500">
                        <Check className="w-12 h-12 text-slate-300 mb-4" />
                        <p className="text-lg font-medium text-slate-700 dark:text-slate-300">Tudo limpo!</p>
                        <p>Nenhum pedido pendente de aprovação do SFA.</p>
                    </CardContent>
                </Card>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {pedidosFiltrados.map(p => (
                        <Card key={p.id} className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition">
                            <CardContent className="p-4 flex flex-col h-full justify-between">
                                <div>
                                    <div className="flex justify-between items-start mb-2">
                                        <h3 className="font-bold text-slate-800 dark:text-slate-100 truncate flex-1 pr-2">{p.cliente_nome || 'Cliente não identificado'}</h3>
                                        <span className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 text-[10px] font-bold px-2 py-1 rounded-full uppercase flex items-center">
                                            <Clock className="w-3 h-3 mr-1" /> Avaliação
                                        </span>
                                    </div>
                                    <p className="text-sm text-slate-500 mb-4">{p.condicao_pagamento}</p>
                                    
                                    <div className="flex items-center gap-2 mb-4">
                                        <MapPin className="w-4 h-4 text-slate-400" />
                                        <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{p.vendedor_nome || 'Vendedor'} · {p.codigo}</span>
                                    </div>
                                </div>

                                <div className="border-t border-slate-100 dark:border-slate-800 pt-4 flex items-center justify-between mt-4">
                                    <div className="font-black text-lg text-slate-900 dark:text-white">
                                        R$ {Number(p.total).toFixed(2)}
                                    </div>
                                    <Button size="sm" variant="outline" className="text-blue-600 border-blue-200 hover:bg-blue-50" onClick={() => setDetalhe(p)}>
                                        Analisar
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            {detalhe && (
                <div className="fixed inset-0 z-100 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))', paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}>
                    <Card className="w-full max-w-2xl bg-white dark:bg-slate-900 shadow-2xl border-0 overflow-hidden flex flex-col max-h-[90dvh]">
                        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50">
                            <h2 className="font-bold text-lg text-slate-800 dark:text-white">Aprovação de Pedido</h2>
                            <Button variant="ghost" size="icon" onClick={() => setDetalhe(null)} className="rounded-full h-8 w-8">
                                <X className="w-4 h-4" />
                            </Button>
                        </div>
                        
                        <div className="p-6 overflow-y-auto flex-1 space-y-6">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Cliente</p>
                                    <p className="font-bold text-slate-900 dark:text-white">{detalhe.cliente_nome}</p>
                                </div>
                                <div>
                                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Valor Total</p>
                                    <p className="font-bold text-slate-900 dark:text-white text-xl">R$ {Number(detalhe.total).toFixed(2)}</p>
                                </div>
                                <div>
                                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Condição</p>
                                    <p className="font-semibold text-slate-700 dark:text-slate-300">{detalhe.condicao_pagamento}</p>
                                </div>
                            </div>
                            
                            <div>
                                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">Itens do Pedido</p>
                                <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                                    <div className="bg-slate-50 dark:bg-slate-800/50 px-4 py-2 text-xs font-medium text-slate-500 grid grid-cols-12">
                                        <div className="col-span-6">Produto</div>
                                        <div className="col-span-2 text-center">Qtd</div>
                                        <div className="col-span-4 text-right">Subtotal</div>
                                    </div>
                                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                                        {(detalhe.itens || []).map((it: any, i: number) => (
                                            <div key={i} className="px-4 py-3 text-sm grid grid-cols-12 items-center">
                                                <div className="col-span-6 font-medium text-slate-800 dark:text-slate-200 truncate pr-2">{it.produto_nome}</div>
                                                <div className="col-span-2 text-center text-slate-600 dark:text-slate-400">{it.quantidade}</div>
                                                <div className="col-span-4 text-right font-semibold">R$ {Number(it.total_item).toFixed(2)}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex justify-end gap-3">
                            <Button variant="outline" className="border-red-200 text-red-600 hover:bg-red-50" onClick={() => rejeitarPedido(detalhe.id)}>
                                Rejeitar
                            </Button>
                            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => aprovarPedido(detalhe.id)}>
                                Aprovar e Faturar
                            </Button>
                        </div>
                    </Card>
                </div>
            )}
        </div>
    );
}
