import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../../api/apiClient';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Search, UserPlus, MapPin, UserCircle, RefreshCcw, Briefcase, Phone } from 'lucide-react';
import { showToast } from '../../utils/toast';
import SFABottomNav from './SFABottomNav';

export default function SFAClientes() {
    const navigate = useNavigate();
    const [clientes, setClientes] = useState<any[]>([]);
    const [busca, setBusca] = useState('');
    const [loading, setLoading] = useState(true);

    const loadClientes = async () => {
        try {
            setLoading(true);
            // A API pagina (50 por padrão): percorre todas as páginas da carteira do vendedor.
            const todos: any[] = [];
            for (let pagina = 1; pagina <= 50; pagina++) {
                const res = await apiClient.get('/clientes/', { params: { pagina, por_pagina: 200, ativo: 'true' } });
                todos.push(...(res.data.clientes || []));
                if (pagina >= (res.data.total_paginas || 1)) break;
            }
            setClientes(todos);
        } catch (error) {
            console.error('Erro ao buscar clientes', error);
            showToast.error('Erro ao carregar carteira de clientes.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadClientes();
    }, []);

    const termo = busca.toLowerCase();
    const termoDigitos = busca.replace(/\D/g, '');
    const clientesFiltrados = clientes.filter(c =>
        (c.nome || '').toLowerCase().includes(termo) ||
        (c.razao_social || '').toLowerCase().includes(termo) ||
        (termoDigitos.length >= 3 && String(c.documento || c.cpf_cnpj || '').replace(/\D/g, '').includes(termoDigitos))
    );

    return (
        <div className="flex flex-col min-h-screen bg-slate-50 dark:bg-slate-950 -m-6 p-4 md:p-6 pb-28">
            <div className="flex justify-between items-center mb-6 pt-2">
                <div>
                    <h1 className="text-3xl font-black text-slate-900 dark:text-white flex items-center gap-3 tracking-tight">
                        <Briefcase className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                        Carteira
                    </h1>
                    <p className="text-sm text-slate-500 font-medium mt-1">Meus Clientes e Rotas</p>
                </div>
                <Button variant="outline" size="icon" onClick={loadClientes} disabled={loading} className="rounded-full shadow-sm hover:shadow">
                    <RefreshCcw className={`w-5 h-5 ${loading ? 'animate-spin' : 'text-slate-600 dark:text-slate-300'}`} />
                </Button>
            </div>

            <div className="relative mb-6">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Search className="h-5 w-5 text-slate-400" />
                </div>
                <Input 
                    type="text" 
                    placeholder="Buscar cliente por nome ou CNPJ..." 
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    className="pl-11 h-14 rounded-2xl bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm text-base focus-visible:ring-blue-500"
                />
            </div>

            <Button 
                onClick={() => navigate('/sfa/clientes/novo')}
                className="w-full h-14 rounded-2xl bg-linear-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold text-lg shadow-lg shadow-blue-500/25 mb-8 transform transition hover:-translate-y-0.5"
            >
                <UserPlus className="w-5 h-5 mr-2" />
                Novo Cliente na Rota
            </Button>

            <div className="space-y-4">
                {loading ? (
                    <div className="flex justify-center p-12">
                        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                    </div>
                ) : clientesFiltrados.length === 0 ? (
                    <div className="text-center py-12 px-4 bg-white dark:bg-slate-900 rounded-3xl border border-dashed border-slate-300 dark:border-slate-800">
                        <UserCircle className="w-16 h-16 text-slate-300 dark:text-slate-700 mx-auto mb-4" />
                        <h3 className="text-lg font-bold text-slate-700 dark:text-slate-300">Nenhum cliente encontrado</h3>
                        <p className="text-sm text-slate-500 mt-2">Tente buscar por outro termo ou cadastre um novo.</p>
                    </div>
                ) : (
                    clientesFiltrados.map((cliente) => (
                        <Card key={cliente.id} className="overflow-hidden hover:shadow-xl transition-all duration-300 border-slate-200/60 dark:border-slate-800/60 rounded-3xl bg-white/70 dark:bg-slate-900/70 backdrop-blur-lg cursor-pointer" onClick={() => navigate('/sfa/pedido', { state: { cliente } })}>
                            <CardContent className="p-0">
                                <div className="p-5 flex items-start gap-4">
                                    <div className="w-14 h-14 rounded-2xl bg-linear-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-700 flex items-center justify-center shrink-0 shadow-inner">
                                        <UserCircle className="w-8 h-8 text-slate-500 dark:text-slate-400" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h3 className="font-extrabold text-slate-900 dark:text-white text-lg truncate leading-tight tracking-tight">{cliente.razao_social || cliente.nome}</h3>
                                        <p className="text-sm font-medium text-slate-500 truncate mt-1 flex items-center gap-1.5">
                                            <MapPin className="w-3.5 h-3.5" />
                                            {cliente.cidade ? `${cliente.cidade}/${cliente.estado}` : 'Endereço não informado'}
                                        </p>
                                        
                                        <div className="flex flex-wrap items-center gap-2 mt-3 text-[11px] font-bold uppercase tracking-wider">
                                            {cliente.limite_credito > 0 && (
                                                <span className="text-emerald-700 bg-emerald-50 dark:bg-emerald-500/10 dark:text-emerald-400 px-2.5 py-1 rounded-md">
                                                    Lim: R$ {parseFloat(cliente.limite_credito).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                                </span>
                                            )}
                                            {cliente.saldo_devedor > 0 && (
                                                <span className="text-rose-700 bg-rose-50 dark:bg-rose-500/10 dark:text-rose-400 px-2.5 py-1 rounded-md">
                                                    Devendo: R$ {parseFloat(cliente.saldo_devedor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div className="bg-slate-50 dark:bg-slate-800/50 p-3 px-5 border-t border-slate-100 dark:border-slate-800/80 flex justify-between items-center">
                                    <div className="text-xs font-semibold text-slate-500 flex items-center gap-2">
                                        <Phone className="w-4 h-4" />
                                        {cliente.telefone || 'Sem contato'}
                                    </div>
                                    <div className="text-xs font-bold text-blue-600 dark:text-blue-400 flex items-center gap-1">
                                        Iniciar Pedido &rarr;
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))
                )}
            </div>
            <SFABottomNav />
        </div>
    );
}
