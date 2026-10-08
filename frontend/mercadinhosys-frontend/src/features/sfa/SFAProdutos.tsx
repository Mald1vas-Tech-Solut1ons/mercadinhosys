import { useState, useEffect } from 'react';
import { apiClient } from '../../api/apiClient';
import { Card, CardContent } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Search, PackageSearch, Tag, PackageX, Boxes } from 'lucide-react';
import { showToast } from '../../utils/toast';
import SFABottomNav from './SFABottomNav';

export default function SFAProdutos() {
    const [produtos, setProdutos] = useState<any[]>([]);
    const [busca, setBusca] = useState('');
    const [loading, setLoading] = useState(true);

    const loadProdutos = async () => {
        try {
            setLoading(true);
            const res = await apiClient.get('/produtos'); // Vendedor agora tem acesso via RBAC
            setProdutos(res.data.produtos || []);
        } catch (error) {
            console.error('Erro ao buscar produtos', error);
            showToast.error('Erro ao carregar catálogo.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadProdutos();
    }, []);

    const produtosFiltrados = produtos.filter(p => 
        p.nome.toLowerCase().includes(busca.toLowerCase()) || 
        (p.codigo_barras && p.codigo_barras.includes(busca)) ||
        (p.categoria && p.categoria.toLowerCase().includes(busca.toLowerCase()))
    );

    return (
        <div className="flex flex-col min-h-screen bg-slate-50 dark:bg-slate-950 -m-6 p-4 md:p-6 pb-28">
            <div className="flex justify-between items-center mb-6 pt-2">
                <div>
                    <h1 className="text-3xl font-black text-slate-900 dark:text-white flex items-center gap-3 tracking-tight">
                        <PackageSearch className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
                        Catálogo
                    </h1>
                    <p className="text-sm text-slate-500 font-medium mt-1">Preços e Disponibilidade</p>
                </div>
            </div>

            <div className="relative mb-6">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Search className="h-5 w-5 text-slate-400" />
                </div>
                <Input 
                    type="text" 
                    placeholder="Buscar produto ou código de barras..." 
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    className="pl-11 h-14 rounded-2xl bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm text-base focus-visible:ring-indigo-500"
                />
            </div>

            <div className="space-y-4">
                {loading ? (
                    <div className="grid grid-cols-2 gap-4">
                        {[1,2,3,4].map(i => (
                            <div key={i} className="bg-slate-200 dark:bg-slate-800 h-40 rounded-3xl animate-pulse"></div>
                        ))}
                    </div>
                ) : produtosFiltrados.length === 0 ? (
                    <div className="text-center py-12 px-4 bg-white dark:bg-slate-900 rounded-3xl border border-dashed border-slate-300 dark:border-slate-800">
                        <PackageX className="w-16 h-16 text-slate-300 dark:text-slate-700 mx-auto mb-4" />
                        <h3 className="text-lg font-bold text-slate-700 dark:text-slate-300">Nenhum produto encontrado</h3>
                        <p className="text-sm text-slate-500 mt-2">Tente buscar por outro termo.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {produtosFiltrados.map((produto) => {
                            const emEstoque = produto.estoque_atual > 0;
                            const estoqueBaixo = emEstoque && produto.estoque_atual <= (produto.estoque_minimo || 5);

                            return (
                                <Card key={produto.id} className="overflow-hidden border-none rounded-3xl shadow-sm hover:shadow-xl transition-all duration-300 bg-white dark:bg-slate-900 relative">
                                    {!emEstoque && (
                                        <div className="absolute inset-0 bg-slate-50/60 dark:bg-slate-950/60 backdrop-blur-[1px] z-10 flex items-center justify-center">
                                            <div className="bg-red-500 text-white font-bold px-4 py-1.5 rounded-full text-sm transform -rotate-12 shadow-lg border-2 border-white dark:border-slate-800 uppercase tracking-widest">
                                                Esgotado
                                            </div>
                                        </div>
                                    )}
                                    <CardContent className="p-5">
                                        <div className="flex justify-between items-start mb-3">
                                            <div className="flex-1 pr-2">
                                                <div className="text-xs font-bold text-indigo-500 dark:text-indigo-400 mb-1 tracking-wider uppercase">{produto.categoria || 'Sem categoria'}</div>
                                                <h3 className="font-extrabold text-slate-900 dark:text-white text-base leading-tight">{produto.nome}</h3>
                                            </div>
                                            <div className="w-12 h-12 bg-slate-100 dark:bg-slate-800 rounded-2xl flex items-center justify-center shrink-0 text-slate-400 border border-slate-200 dark:border-slate-700">
                                                <Boxes className="w-6 h-6" />
                                            </div>
                                        </div>

                                        <div className="mt-4 flex items-end justify-between">
                                            <div>
                                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Preço Base</p>
                                                <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400">
                                                    R$ {parseFloat(produto.preco_venda).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                                </p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Estoque</p>
                                                <p className={`text-lg font-bold ${emEstoque ? (estoqueBaixo ? 'text-amber-500' : 'text-slate-800 dark:text-slate-200') : 'text-red-500'}`}>
                                                    {produto.estoque_atual} {produto.unidade_medida || 'UN'}
                                                </p>
                                            </div>
                                        </div>
                                        
                                        <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center text-xs font-semibold text-slate-500">
                                            <span className="flex items-center gap-1">
                                                <Tag className="w-3.5 h-3.5 text-slate-400" />
                                                Custo: R$ {parseFloat(produto.preco_custo || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                            </span>
                                            <span>Cod: {produto.codigo_barras || 'N/A'}</span>
                                        </div>
                                    </CardContent>
                                </Card>
                            )
                        })}
                    </div>
                )}
            </div>
            <SFABottomNav />
        </div>
    );
}
