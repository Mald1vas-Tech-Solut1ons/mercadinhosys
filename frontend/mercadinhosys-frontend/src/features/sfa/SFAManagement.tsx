import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { apiClient } from '../../api/apiClient';
import { showToast } from '../../utils/toast';
import { MapPin, Target, PackageOpen, Users, Save, Trash2, Plus, Clock } from 'lucide-react';
import { formatCurrency } from '../../utils/formatters';

export default function SFAManagement() {
    const [activeTab, setActiveTab] = useState('metas');
    
    // Data lists
    const [metas, setMetas] = useState<any[]>([]);
    const [focos, setFocos] = useState<any[]>([]);
    const [rotas, setRotas] = useState<any[]>([]);
    
    // Aux data
    const [funcionarios, setFuncionarios] = useState<any[]>([]);
    const [produtos, setProdutos] = useState<any[]>([]);
    
    // Form states
    const [metaForm, setMetaForm] = useState({ vendedor_id: '', mes: new Date().getMonth() + 1, ano: new Date().getFullYear(), meta_faturamento: '', meta_positivacao: '' });
    const [focoForm, setFocoForm] = useState({ produto_id: '', data_inicio: '', data_fim: '', meta_quantidade: '', ativo: true });
    const [rotaForm, setRotaForm] = useState({ id: null, nome: '', vendedor_id: '', dia_semana: 0, ativa: true });

    useEffect(() => {
        loadAuxData();
        loadSFAData();
    }, []);

    const loadAuxData = async () => {
        try {
            const [resFunc, resProd] = await Promise.all([
                apiClient.get('/funcionarios'),
                apiClient.get('/produtos')
            ]);
            setFuncionarios(resFunc.data.data || []);
            setProdutos(resProd.data.data || []);
        } catch (error) {
            console.error(error);
            showToast.error('Erro ao carregar dados auxiliares');
        }
    };

    const loadSFAData = async () => {
        try {
            const [resMetas, resFocos, resRotas] = await Promise.all([
                apiClient.get(`/sfa/admin/metas?mes=${new Date().getMonth() + 1}&ano=${new Date().getFullYear()}`),
                apiClient.get('/sfa/admin/produtos-foco'),
                apiClient.get('/sfa/admin/rotas')
            ]);
            setMetas(resMetas.data.data || []);
            setFocos(resFocos.data.data || []);
            setRotas(resRotas.data.data || []);
        } catch (error) {
            console.error(error);
            showToast.error('Erro ao carregar dados do SFA');
        }
    };

    // Salvar Meta
    const handleSaveMeta = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await apiClient.post('/sfa/admin/metas', {
                ...metaForm,
                mes: Number(metaForm.mes),
                ano: Number(metaForm.ano),
                meta_faturamento: Number(metaForm.meta_faturamento),
                meta_positivacao: Number(metaForm.meta_positivacao)
            });
            showToast.success('Meta salva com sucesso!');
            loadSFAData();
        } catch (error) {
            showToast.error('Erro ao salvar meta.');
        }
    };

    // Salvar Produto Foco
    const handleSaveFoco = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await apiClient.post('/sfa/admin/produtos-foco', {
                ...focoForm,
                meta_quantidade: Number(focoForm.meta_quantidade)
            });
            showToast.success('Produto foco salvo com sucesso!');
            loadSFAData();
        } catch (error) {
            showToast.error('Erro ao salvar produto foco.');
        }
    };

    // Deletar Produto Foco
    const handleDeleteFoco = async (id: number) => {
        try {
            await apiClient.delete(`/sfa/admin/produtos-foco?id=${id}`);
            showToast.success('Produto foco removido!');
            loadSFAData();
        } catch (error) {
            showToast.error('Erro ao remover produto foco.');
        }
    };

    // Salvar Rota
    const handleSaveRota = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await apiClient.post('/sfa/admin/rotas', rotaForm);
            showToast.success('Rota salva com sucesso!');
            loadSFAData();
        } catch (error) {
            showToast.error('Erro ao salvar rota.');
        }
    };

    // Deletar Rota
    const handleDeleteRota = async (id: number) => {
        try {
            await apiClient.delete(`/sfa/admin/rotas?id=${id}`);
            showToast.success('Rota removida!');
            loadSFAData();
        } catch (error) {
            showToast.error('Erro ao remover rota.');
        }
    };

    return (
        <div className="container mx-auto p-4 space-y-6 pb-24 max-w-6xl">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-linear-to-r from-blue-600 to-indigo-500 flex items-center gap-2">
                        <Target className="w-8 h-8 text-indigo-500" />
                        Gestão SFA
                    </h1>
                    <p className="text-gray-500 mt-1">Gerencie Metas, Produtos Foco e Rotas da sua Força de Vendas</p>
                </div>
                <Button onClick={loadSFAData} variant="outline" className="gap-2">
                    <Clock className="w-4 h-4" /> Atualizar
                </Button>
            </div>

            <div className="w-full">
                <div className="overflow-x-auto pb-2">
                    <div className="flex w-max min-w-full mb-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                        <button onClick={() => setActiveTab('metas')} className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${activeTab === 'metas' ? 'bg-white shadow-sm text-black' : 'text-slate-500 hover:text-slate-900'}`}>Metas de Vendedor</button>
                        <button onClick={() => setActiveTab('foco')} className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${activeTab === 'foco' ? 'bg-white shadow-sm text-black' : 'text-slate-500 hover:text-slate-900'}`}>Produtos Foco</button>
                        <button onClick={() => setActiveTab('rotas')} className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${activeTab === 'rotas' ? 'bg-white shadow-sm text-black' : 'text-slate-500 hover:text-slate-900'}`}>Rotas e Territórios</button>
                    </div>
                </div>

                {/* ABA DE METAS */}
                {activeTab === 'metas' && (
                <div className="space-y-6">
                    <Card className="border-none shadow-lg bg-white/70 dark:bg-slate-800/70 backdrop-blur-xl">
                        <CardHeader>
                            <CardTitle className="text-slate-900 dark:text-white">Definir Nova Meta</CardTitle>
                            <CardDescription className="text-slate-500 dark:text-slate-400">Estabeleça as metas de faturamento e positivação para o mês.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <form onSubmit={handleSaveMeta} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 items-end">
                                <div className="space-y-2 lg:col-span-1">
                                    <label className="text-sm font-medium leading-none">Vendedor</label>
                                    <select 
                                        className="w-full h-10 px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
                                        value={metaForm.vendedor_id}
                                        onChange={(e) => setMetaForm({...metaForm, vendedor_id: e.target.value})}
                                        required
                                    >
                                        <option value="">Selecione...</option>
                                        {funcionarios.map(f => (
                                            <option key={f.id} value={f.id}>{f.nome}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium leading-none">Mês</label>
                                    <Input type="number" min="1" max="12" value={metaForm.mes} onChange={(e) => setMetaForm({...metaForm, mes: Number(e.target.value)})} required />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium leading-none">Ano</label>
                                    <Input type="number" value={metaForm.ano} onChange={(e) => setMetaForm({...metaForm, ano: Number(e.target.value)})} required />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium leading-none">Meta Faturamento (R$)</label>
                                    <Input type="number" step="0.01" value={metaForm.meta_faturamento} onChange={(e) => setMetaForm({...metaForm, meta_faturamento: e.target.value})} required />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium leading-none">Meta Positivação (Clientes)</label>
                                    <Input type="number" value={metaForm.meta_positivacao} onChange={(e) => setMetaForm({...metaForm, meta_positivacao: e.target.value})} required />
                                </div>
                                <div className="lg:col-span-5 flex justify-end">
                                    <Button type="submit" className="gap-2">
                                        <Save className="w-4 h-4" /> Salvar Meta
                                    </Button>
                                </div>
                            </form>
                        </CardContent>
                    </Card>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {metas.map((m) => {
                            const vend = funcionarios.find(f => f.id === m.vendedor_id);
                            return (
                                <Card key={m.id} className="border-l-4 border-l-blue-500 shadow-md bg-white dark:bg-slate-800">
                                    <CardContent className="pt-6">
                                        <div className="flex justify-between items-start mb-4">
                                            <div>
                                                <h3 className="font-bold text-lg text-slate-900 dark:text-white">{vend ? vend.nome : `Vendedor ID: ${m.vendedor_id}`}</h3>
                                                <p className="text-sm text-gray-500 dark:text-gray-400">Mês {m.mes}/{m.ano}</p>
                                            </div>
                                            <div className="bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-400 p-2 rounded-full">
                                                <Users className="w-5 h-5" />
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <div className="flex justify-between">
                                                <span className="text-gray-600 dark:text-gray-400">Faturamento:</span>
                                                <span className="font-semibold text-slate-900 dark:text-white">{formatCurrency(m.meta_faturamento)}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-gray-600 dark:text-gray-400">Positivação:</span>
                                                <span className="font-semibold text-slate-900 dark:text-white">{m.meta_positivacao} clientes</span>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            )
                        })}
                    </div>
                </div>
                )}

                {/* ABA PRODUTO FOCO */}
                {activeTab === 'foco' && (
                <div className="space-y-6">
                    <Card className="border-none shadow-lg bg-white/70 dark:bg-slate-800/70 backdrop-blur-xl">
                        <CardHeader>
                            <CardTitle className="text-slate-900 dark:text-white">Novo Produto Foco</CardTitle>
                            <CardDescription className="text-slate-500 dark:text-slate-400">Destaque produtos no aplicativo do vendedor para impulsionar as vendas.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <form onSubmit={handleSaveFoco} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
                                <div className="space-y-2 lg:col-span-2">
                                    <label className="text-sm font-medium leading-none">Produto</label>
                                    <select 
                                        className="w-full h-10 px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
                                        value={focoForm.produto_id}
                                        onChange={(e) => setFocoForm({...focoForm, produto_id: e.target.value})}
                                        required
                                    >
                                        <option value="">Selecione...</option>
                                        {produtos.map(p => (
                                            <option key={p.id} value={p.id}>{p.nome}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium leading-none">Data Início</label>
                                    <Input type="date" value={focoForm.data_inicio} onChange={(e) => setFocoForm({...focoForm, data_inicio: e.target.value})} required />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium leading-none">Data Fim</label>
                                    <Input type="date" value={focoForm.data_fim} onChange={(e) => setFocoForm({...focoForm, data_fim: e.target.value})} required />
                                </div>
                                <div className="space-y-2 lg:col-span-2">
                                    <label className="text-sm font-medium leading-none">Meta de Quantidade (Opcional)</label>
                                    <Input type="number" value={focoForm.meta_quantidade} onChange={(e) => setFocoForm({...focoForm, meta_quantidade: e.target.value})} />
                                </div>
                                <div className="lg:col-span-2 flex justify-end">
                                    <Button type="submit" className="gap-2 bg-indigo-600 hover:bg-indigo-700">
                                        <Plus className="w-4 h-4" /> Adicionar Foco
                                    </Button>
                                </div>
                            </form>
                        </CardContent>
                    </Card>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {focos.map((f) => (
                            <Card key={f.id} className="border-l-4 border-l-indigo-500 shadow-md bg-white dark:bg-slate-800">
                                <CardContent className="pt-6">
                                    <div className="flex justify-between items-start mb-4">
                                        <div>
                                            <h3 className="font-bold text-lg text-indigo-900 dark:text-indigo-300">{f.produto_nome}</h3>
                                            <p className="text-xs text-gray-500 dark:text-gray-400">Validade: {new Date(f.data_inicio).toLocaleDateString()} a {new Date(f.data_fim).toLocaleDateString()}</p>
                                        </div>
                                        <div className="bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-400 p-2 rounded-full cursor-pointer hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400 transition-colors" onClick={() => handleDeleteFoco(f.id)}>
                                            <Trash2 className="w-5 h-5" />
                                        </div>
                                    </div>
                                    <div className="flex justify-between items-center mt-4 bg-gray-50 dark:bg-slate-900/50 p-2 rounded">
                                        <span className="text-sm font-medium text-gray-600 dark:text-gray-300 flex items-center gap-2">
                                            <PackageOpen className="w-4 h-4" /> Meta: {f.meta_quantidade || 'N/A'} unid.
                                        </span>
                                        <span className={`text-xs px-2 py-1 rounded-full ${f.ativo ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400' : 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-400'}`}>
                                            {f.ativo ? 'Ativo' : 'Inativo'}
                                        </span>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </div>
                )}

                {/* ABA ROTAS */}
                {activeTab === 'rotas' && (
                <div className="space-y-6">
                    <Card className="border-none shadow-lg bg-white/70 dark:bg-slate-800/70 backdrop-blur-xl">
                        <CardHeader>
                            <CardTitle className="text-slate-900 dark:text-white">Criar Nova Rota</CardTitle>
                            <CardDescription className="text-slate-500 dark:text-slate-400">Defina rotas de visitação e atribua aos vendedores.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <form onSubmit={handleSaveRota} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
                                <div className="space-y-2 lg:col-span-2">
                                    <label className="text-sm font-medium leading-none">Nome da Rota (Ex: Rota Centro Sul)</label>
                                    <Input value={rotaForm.nome} onChange={(e) => setRotaForm({...rotaForm, nome: e.target.value})} required />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium leading-none">Vendedor Responsável</label>
                                    <select 
                                        className="w-full h-10 px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
                                        value={rotaForm.vendedor_id}
                                        onChange={(e) => setRotaForm({...rotaForm, vendedor_id: e.target.value})}
                                        required
                                    >
                                        <option value="">Selecione...</option>
                                        {funcionarios.map(f => (
                                            <option key={f.id} value={f.id}>{f.nome}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium leading-none">Dia da Semana (0=Seg, 6=Dom)</label>
                                    <select 
                                        className="w-full h-10 px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
                                        value={rotaForm.dia_semana}
                                        onChange={(e) => setRotaForm({...rotaForm, dia_semana: Number(e.target.value)})}
                                    >
                                        <option value={0}>Segunda-feira</option>
                                        <option value={1}>Terça-feira</option>
                                        <option value={2}>Quarta-feira</option>
                                        <option value={3}>Quinta-feira</option>
                                        <option value={4}>Sexta-feira</option>
                                        <option value={5}>Sábado</option>
                                        <option value={6}>Domingo</option>
                                    </select>
                                </div>
                                <div className="lg:col-span-4 flex justify-end">
                                    <Button type="submit" className="gap-2 bg-emerald-600 hover:bg-emerald-700">
                                        <Save className="w-4 h-4" /> Salvar Rota
                                    </Button>
                                </div>
                            </form>
                        </CardContent>
                    </Card>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {rotas.map((r) => {
                            const vend = funcionarios.find(f => f.id === r.vendedor_id);
                            const dias = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
                            return (
                                <Card key={r.id} className="border-l-4 border-l-emerald-500 shadow-md bg-white dark:bg-slate-800">
                                    <CardContent className="pt-6">
                                        <div className="flex justify-between items-start mb-4">
                                            <div>
                                                <h3 className="font-bold text-lg text-emerald-900 dark:text-emerald-400 flex items-center gap-2">
                                                    <MapPin className="w-5 h-5 text-emerald-500" />
                                                    {r.nome}
                                                </h3>
                                                <p className="text-sm text-gray-500 dark:text-gray-400">{vend ? vend.nome : 'Sem Vendedor'}</p>
                                            </div>
                                            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 p-2 rounded-full cursor-pointer hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors" onClick={() => handleDeleteRota(r.id)}>
                                                <Trash2 className="w-5 h-5" />
                                            </div>
                                        </div>
                                        <div className="flex justify-between items-center mt-4 bg-gray-50 dark:bg-slate-900/50 p-2 rounded">
                                            <span className="text-sm font-medium text-gray-600 dark:text-gray-300">
                                                Dia: {dias[r.dia_semana] || r.dia_semana}
                                            </span>
                                            <span className={`text-xs px-2 py-1 rounded-full ${r.ativa ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-400' : 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-400'}`}>
                                                {r.ativa ? 'Ativa' : 'Inativa'}
                                            </span>
                                        </div>
                                    </CardContent>
                                </Card>
                            )
                        })}
                    </div>
                </div>
                )}
            </div>
        </div>
    );
}
