import React, { useState, useEffect, useCallback } from 'react';
import {
    Activity,
    RefreshCcw,
    Search,
    ShoppingBag,
    UserPlus,
    Package,
    AlertCircle,
    Building2,
    DollarSign,
    Clock,
    CheckCircle2,
    XCircle,
    Trash2,
    Plus,
    Shield,
    Info,
    Settings
} from 'lucide-react';
import { apiClient } from '../../api/apiClient';
import { toast } from 'react-hot-toast';
import { useSuperAdmin } from '../../contexts/SuperAdminContext';
import { isValidCNPJ, isValidCPF, isValidEmail } from '../../utils/validators';

interface Log {
    id: number;
    estabelecimento_id: number;
    estabelecimento_nome: string;
    usuario_id: number;
    usuario_nome: string;
    tipo_evento: string;
    descricao: string;
    valor: number;
    data_evento: string;
    detalhes: any;
}

interface Establishment {
    id: number;
    nome_fantasia: string;
    razao_social: string;
    cnpj: string;
    telefone: string;
    email: string;
    logradouro?: string;
    numero?: string;
    bairro?: string;
    cidade?: string;
    estado?: string;
    gateway_customer_id?: string;
    gateway_subscription_id?: string;
    ativo: boolean;
    plano: string;
    plano_status: string;
    data_cadastro: string;
    vencimento_assinatura?: string;
}

interface Summary {
    total_estabelecimentos: number;
    vendas_hoje_qtd: number;
    vendas_hoje_valor: number;
    vendas_mes_qtd: number;
    vendas_mes_valor: number;
    novos_clientes_recentes: Array<{ nome: string, data: string }>;
}

const SystemMonitorPage: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'logs' | 'tenants'>('logs');
    const [logs, setLogs] = useState<Log[]>([]);
    const [establishments, setEstablishments] = useState<Establishment[]>([]);
    const [summary, setSummary] = useState<Summary | null>(null);
    const [loading, setLoading] = useState(true);
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [filterType, setFilterType] = useState<string>('');
    const [searchTerm, setSearchTerm] = useState('');

    // Integração do Seletor Global (Context API)
    const { selectedTenantId, setSelectedTenantId, syncStatus } = useSuperAdmin();

    // Onboarding Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [formData, setFormData] = useState({
        nome_fantasia: '',
        cnpj: '',
        telefone_loja: '',
        email_loja: '',
        nome_admin: '',
        email_admin: '',
        username: '',
        cpf_admin: '',
        celular_admin: ''
    });

    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editingTenant, setEditingTenant] = useState<Establishment | null>(null);
    const [editFormData, setEditFormData] = useState({
        nome_fantasia: '',
        razao_social: '',
        cnpj: '',
        telefone: '',
        email: '',
        logradouro: '',
        numero: '',
        bairro: '',
        cidade: '',
        estado: '',
        gateway_customer_id: '',
        gateway_subscription_id: '',
        plano: '',
        plano_status: '',
        ativo: true,
        vencimento_assinatura: ''
    });
    const [editModalTab, setEditModalTab] = useState<'plano' | 'principal' | 'contato' | 'sistema'>('plano');

    const fetchData = useCallback(async () => {
        try {
            const requests = [
                apiClient.get(`/saas/monitor/logs?estab_id=${selectedTenantId}`),
                apiClient.get(`/saas/monitor/summary?estab_id=${selectedTenantId}`)
            ];

            // Sempre carrega os estabelecimentos para popular o Dropdown
            requests.push(apiClient.get('/saas/monitor/establishments'));

            const results = await Promise.all(requests);

            if (results[0].data?.success) setLogs(results[0].data.logs);
            if (results[1].data?.success) setSummary(results[1].data.summary);
            if (activeTab === 'tenants' && results[2]?.data?.success) {
                setEstablishments(results[2].data.establishments);
            }
        } catch (error) {
            console.error('Erro ao buscar dados do monitor:', error);
        } finally {
            setLoading(false);
        }
    }, [activeTab]);

    useEffect(() => {
        fetchData();
        let interval: any;
        if (autoRefresh && activeTab === 'logs') {
            interval = setInterval(fetchData, 10000); // Polling logs only
        }
        return () => clearInterval(interval);
    }, [fetchData, autoRefresh, activeTab]);

    const handleCreateAccount = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isValidCNPJ(formData.cnpj)) return toast.error('CNPJ da loja é inválido!');
        if (!isValidCPF(formData.cpf_admin)) return toast.error('CPF do administrador é inválido!');
        if (!isValidEmail(formData.email_loja) || !isValidEmail(formData.email_admin)) return toast.error('E-mail fornecido é inválido!');
        
        setSubmitting(true);
        try {
            const res = await apiClient.post('/onboarding/registrar', formData);
            if (res.data.success) {
                toast.success('Conta criada e credenciais enviadas por e-mail!');
                setIsModalOpen(false);
                setFormData({
                    nome_fantasia: '', cnpj: '', telefone_loja: '', email_loja: '',
                    nome_admin: '', email_admin: '', username: '', cpf_admin: '', celular_admin: ''
                });
                fetchData();
            }
        } catch (error: any) {
            toast.error(error.response?.data?.error || 'Erro ao criar conta');
        } finally {
            setSubmitting(false);
        }
    };

    const toggleStatus = async (id: number, currentStatus: boolean) => {
        try {
            const res = await apiClient.put(`/saas/monitor/establishments/${id}/status`, { ativo: !currentStatus });
            if (res.data.success) {
                toast.success(res.data.message);
                fetchData();
            }
        } catch (err) {
            toast.error('Erro ao alterar status');
        }
    };

    const deleteAccount = async (id: number, name: string) => {
        if (!window.confirm(`TEM CERTEZA? Isso excluirá TODOS os dados da loja "${name}" permanentemente. Esta ação não pode ser desfeita.`)) return;

        try {
            const res = await apiClient.delete(`/saas/monitor/establishments/${id}`);
            if (res.data.success) {
                toast.success(res.data.message);
                fetchData();
            }
        } catch (err) {
            toast.error('Erro ao excluir conta');
        }
    };

    const handleEdit = (tenant: Establishment) => {
        setEditingTenant(tenant);
        setEditFormData({
            nome_fantasia: tenant.nome_fantasia || '',
            razao_social: tenant.razao_social || '',
            cnpj: tenant.cnpj || '',
            telefone: tenant.telefone || '',
            email: tenant.email || '',
            logradouro: tenant.logradouro || '',
            numero: tenant.numero || '',
            bairro: tenant.bairro || '',
            cidade: tenant.cidade || '',
            estado: tenant.estado || '',
            gateway_customer_id: tenant.gateway_customer_id || '',
            gateway_subscription_id: tenant.gateway_subscription_id || '',
            plano: tenant.plano || '',
            plano_status: tenant.plano_status || '',
            ativo: tenant.ativo,
            vencimento_assinatura: tenant.vencimento_assinatura ? tenant.vencimento_assinatura.split('T')[0] : ''
        });
        setEditModalTab('plano');
        setIsEditModalOpen(true);
    };

    const handleUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingTenant) return;
        
        if (editFormData.cnpj && !isValidCNPJ(editFormData.cnpj)) return toast.error('CNPJ inválido!');
        if (editFormData.email && !isValidEmail(editFormData.email)) return toast.error('E-mail inválido!');

        setSubmitting(true);
        try {
            const res = await apiClient.put(`/saas/estabelecimentos/${editingTenant.id}`, editFormData);
            if (res.data.success) {
                toast.success('Estabelecimento atualizado com sucesso!');
                setIsEditModalOpen(false);
                fetchData();
            }
        } catch (err: any) {
            toast.error(err.response?.data?.error || 'Erro ao atualizar estabelecimento');
        } finally {
            setSubmitting(false);
        }
    };

    const getEventIcon = (type: string) => {
        if (type.includes('venda')) return <ShoppingBag className="text-green-500" size={20} />;
        if (type.includes('estabelecimento_registrado')) return <UserPlus className="text-blue-500" size={20} />;
        if (type.includes('produto')) return <Package className="text-orange-500" size={20} />;
        if (type.includes('pedido_compra')) return <ShoppingBag className="text-purple-500" size={20} />;
        if (type.includes('despesa')) return <DollarSign className="text-red-500" size={20} />;
        if (type.includes('estoque')) return <Activity className="text-amber-500" size={20} />;
        if (type.includes('caixa')) return <DollarSign className="text-indigo-500" size={20} />;
        if (type.includes('ponto')) return <Clock className="text-cyan-500" size={20} />;

        switch (type) {
            case 'venda_finalizada': return <ShoppingBag className="text-green-500" size={20} />;
            case 'vendas_insert': return <ShoppingBag className="text-green-600" size={20} />;
            case 'estabelecimento_registrado': return <UserPlus className="text-blue-500" size={20} />;
            case 'produto_criado': return <Package className="text-orange-500" size={20} />;
            default: return <Activity className="text-gray-400" size={20} />;
        }
    };

    const filteredLogs = logs.filter(log => {
        const matchesType = !filterType || log.tipo_evento.includes(filterType);
        const matchesSearch = !searchTerm ||
            log.estabelecimento_nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
            log.descricao.toLowerCase().includes(searchTerm.toLowerCase());
        return matchesType && matchesSearch;
    });

    const filteredTenants = establishments.filter(e =>
        e.nome_fantasia.toLowerCase().includes(searchTerm.toLowerCase()) ||
        e.cnpj.includes(searchTerm) ||
        e.email.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="space-y-6">
            <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                        <Shield className="text-indigo-600" />
                        Centro de Comando SaaS
                    </h1>
                    <div className="flex items-center gap-3 mt-1 text-sm">
                        <span className="text-gray-500 font-medium">Gestão Estratégica & Monitoramento Local</span>
                        {/* Seletor Global de Inquilino */}
                        <select
                            value={selectedTenantId}
                            onChange={(e) => {
                                setSelectedTenantId(e.target.value);
                                // A atualização do Contexto vai engatilhar o useEffect via fetchData
                            }}
                            className="bg-indigo-50 border border-indigo-100 text-indigo-700 font-black px-3 py-1 rounded-lg text-xs outline-none focus:ring-2 focus:ring-indigo-500 transition-all cursor-pointer shadow-sm"
                        >
                            <option value="all">🌍 MODO HOLDING: Consolidado Global</option>
                            {establishments.map(est => (
                                <option key={est.id} value={est.id}>
                                    🏢 Cliente: {est.nome_fantasia} (ID: {est.id})
                                </option>
                            ))}
                        </select>
                        {selectedTenantId !== 'all' && (
                            <span className="flex items-center gap-1.5 px-2.5 py-1 bg-green-50 text-green-700 border border-green-200 rounded-lg text-[10px] uppercase font-black tracking-wider">
                                <span className={`w-1.5 h-1.5 rounded-full ${syncStatus.status === 'online' ? 'bg-green-500 animate-pulse' : 'bg-green-500'}`}></span>
                                Sincronizado: Hoje
                            </span>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setIsModalOpen(true)}
                        className="flex items-center gap-2 bg-indigo-600 text-white px-5 py-2.5 rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200"
                    >
                        <Plus size={20} />
                        Novo Cliente
                    </button>
                    <div className="h-10 w-px bg-gray-200 mx-2 hidden md:block" />
                    <button
                        onClick={() => setAutoRefresh(!autoRefresh)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-semibold transition-colors ${autoRefresh
                            ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                            : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                            }`}
                    >
                        <RefreshCcw size={16} className={autoRefresh ? 'animate-spin' : ''} />
                        {autoRefresh ? 'Live' : 'Pausado'}
                    </button>
                    <button
                        onClick={() => { setLoading(true); fetchData(); }}
                        className="p-2.5 bg-white border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-all"
                    >
                        <RefreshCcw size={20} />
                    </button>
                </div>
            </header>

            {/* Top Cards Summary */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
                            <Building2 size={24} />
                        </div>
                        <div>
                            <p className="text-xs text-gray-400 uppercase font-black tracking-wider">Clientes Ativos</p>
                            <h2 className="text-3xl font-black text-gray-900">{summary?.total_estabelecimentos || 0}</h2>
                        </div>
                    </div>
                </div>

                <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-green-50 text-green-600 rounded-xl">
                            <DollarSign size={24} />
                        </div>
                        <div>
                            <p className="text-xs text-gray-400 uppercase font-black tracking-wider">Volume Hoje</p>
                            <h2 className="text-2xl font-black text-green-600">R$ {summary?.vendas_hoje_valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) || '0,00'}</h2>
                        </div>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-2 font-bold uppercase tracking-tighter italic">{summary?.vendas_hoje_qtd || 0} transações processadas</p>
                </div>

                <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-purple-50 text-purple-600 rounded-xl">
                            <Clock size={24} />
                        </div>
                        <div>
                            <p className="text-xs text-gray-400 uppercase font-black tracking-wider">Volume 30 Dias</p>
                            <h2 className="text-2xl font-black text-gray-900">R$ {summary?.vendas_mes_valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) || '0,00'}</h2>
                        </div>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-2 font-bold uppercase tracking-tighter italic">{summary?.vendas_mes_qtd || 0} transações no período</p>
                </div>

                <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
                            <Activity size={24} />
                        </div>
                        <div>
                            <p className="text-xs text-gray-400 uppercase font-black tracking-wider">Status API</p>
                            <div className="flex items-center gap-2 mt-1">
                                <span className="w-3 h-3 bg-green-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]"></span>
                                <span className="font-black text-green-700 text-sm">OPERACIONAL</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Custom Tabs */}
            <div className="flex border-b border-gray-200">
                <button
                    onClick={() => setActiveTab('logs')}
                    className={`px-6 py-3 font-bold text-sm transition-all border-b-2 ${activeTab === 'logs' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
                >
                    ATIVIDADE GLOBAL
                </button>
                <button
                    onClick={() => setActiveTab('tenants')}
                    className={`px-6 py-3 font-bold text-sm transition-all border-b-2 ${activeTab === 'tenants' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
                >
                    GESTÃO DE INQUILINOS (TENANTS)
                </button>
            </div>

            {/* Search & Filters Bar */}
            <div className="bg-white border rounded-2xl overflow-hidden shadow-sm">
                <div className="p-4 border-b bg-gray-50/50 flex flex-col md:flex-row gap-4">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                        <input
                            type="text"
                            placeholder={activeTab === 'logs' ? "Buscar por cliente ou descrição..." : "Buscar por Nome, CNPJ ou E-mail..."}
                            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 bg-white transition-all shadow-inner"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    {activeTab === 'logs' && (
                        <div className="flex gap-2">
                            <select
                                className="px-4 py-2 border border-gray-200 rounded-xl bg-white font-bold text-gray-600 text-sm shadow-sm"
                                value={filterType}
                                onChange={(e) => setFilterType(e.target.value)}
                            >
                                <option value="">Todos Eventos</option>
                                <option value="venda">Vendas</option>
                                <option value="produto">Produtos</option>
                                <option value="estoque">Estoque</option>
                                <option value="despesa">Financeiro / Despesas</option>
                                <option value="pedido_compra">Compras</option>
                                <option value="estabelecimento_registrado">Onboarding</option>
                                <option value="ponto">RH / Ponto</option>
                                <option value="funcionario">Funcionários</option>
                            </select>
                        </div>
                    )}
                </div>

                <div className="overflow-x-auto">
                    {activeTab === 'logs' ? (
                        <table className="w-full text-left">
                            <thead className="bg-gray-50 text-gray-400 text-[10px] uppercase font-black tracking-widest border-b">
                                <tr>
                                    <th className="px-6 py-4">Evento</th>
                                    <th className="px-6 py-4">Estabelecimento</th>
                                    <th className="px-6 py-4">Atividade / Descrição</th>
                                    <th className="px-6 py-4">Valor</th>
                                    <th className="px-6 py-4">Timestamp</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {loading && logs.length === 0 ? (
                                    Array(5).fill(0).map((_, i) => (
                                        <tr key={i} className="animate-pulse">
                                            <td colSpan={5} className="px-6 py-6 h-12 bg-gray-50/30"></td>
                                        </tr>
                                    ))
                                ) : filteredLogs.length > 0 ? (
                                    filteredLogs.map((log) => (
                                        <tr key={log.id} className="hover:bg-indigo-50/30 transition-colors group">
                                            <td className="px-6 py-5">
                                                <div className="flex items-center gap-2">
                                                    {getEventIcon(log.tipo_evento)}
                                                    <span className="text-[10px] font-black uppercase bg-gray-100 px-2 py-1 rounded-md text-gray-500 group-hover:bg-white transition-colors">
                                                        {log.tipo_evento.replace('_', ' ')}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-5">
                                                <div className="flex flex-col">
                                                    <span className="font-bold text-gray-900 group-hover:text-indigo-600 transition-colors">{log.estabelecimento_nome}</span>
                                                    <span className="text-[10px] text-gray-400 font-bold tracking-tight">ID INQUILINO: {log.estabelecimento_id}</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-5">
                                                <div className="flex flex-col">
                                                    <span className="text-sm text-gray-700 leading-tight">{log.descricao}</span>
                                                    <span className="text-[10px] text-gray-400 font-medium">Operador: {log.usuario_nome}</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-5">
                                                {log.valor > 0 ? (
                                                    <span className="font-black text-green-600 text-sm">
                                                        R$ {log.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                                    </span>
                                                ) : (
                                                    <span className="text-gray-300 font-bold">-</span>
                                                )}
                                            </td>
                                            <td className="px-6 py-5">
                                                <div className="flex items-center gap-1.5 text-[10px] text-gray-500 font-bold whitespace-nowrap">
                                                    <Clock size={12} className="text-gray-300" />
                                                    {new Date(log.data_evento).toLocaleString('pt-BR')}
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan={5} className="px-6 py-20 text-center text-gray-400">
                                            <div className="flex flex-col items-center gap-3">
                                                <div className="p-4 bg-gray-50 rounded-full">
                                                    <AlertCircle size={48} className="text-gray-200" />
                                                </div>
                                                <p className="font-bold text-gray-300 uppercase tracking-widest text-xs">Sem atividades detectadas no momento</p>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    ) : (
                        <table className="w-full text-left">
                            <thead className="bg-gray-50 text-gray-400 text-[10px] uppercase font-black tracking-widest border-b">
                                <tr>
                                    <th className="px-6 py-4 text-center">Status</th>
                                    <th className="px-6 py-4">Estabelecimento / CNPJ</th>
                                    <th className="px-6 py-4">Contato / E-mail</th>
                                    <th className="px-4 py-4">Plano</th>
                                    <th className="px-6 py-4">Cadastro</th>
                                    <th className="px-6 py-4 text-right">Ações</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {loading ? (
                                    Array(3).fill(0).map((_, i) => (
                                        <tr key={i} className="animate-pulse">
                                            <td colSpan={6} className="px-6 py-6 bg-gray-50/20"></td>
                                        </tr>
                                    ))
                                ) : filteredTenants.map((ten) => (
                                    <tr key={ten.id} className="hover:bg-indigo-50/30 transition-colors group">
                                        <td className="px-6 py-5 text-center">
                                            <button
                                                onClick={() => toggleStatus(ten.id, ten.ativo)}
                                                className={`transition-all hover:scale-110 ${ten.ativo ? 'text-green-500' : 'text-red-400'}`}
                                                title={ten.ativo ? 'Clique para Bloquear' : 'Clique para Ativar'}
                                            >
                                                {ten.ativo ? <CheckCircle2 size={24} /> : <XCircle size={24} />}
                                            </button>
                                        </td>
                                        <td className="px-6 py-5">
                                            <div className="flex flex-col">
                                                <span className="font-bold text-gray-900 group-hover:text-indigo-600 transition-colors uppercase tracking-tight">{ten.nome_fantasia}</span>
                                                <span className="text-[10px] text-gray-400 font-black">CNPJ: {ten.cnpj}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-5">
                                            <div className="flex flex-col">
                                                <span className="text-sm font-medium text-gray-600">{ten.email}</span>
                                                <span className="text-[10px] text-gray-400">{ten.telefone}</span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-5">
                                            <span className="px-3 py-1 bg-indigo-50 text-indigo-700 text-[10px] font-black rounded-lg uppercase border border-indigo-100 italic">
                                                {ten.plano}
                                            </span>
                                        </td>
                                        <td className="px-6 py-5">
                                            <span className="text-[10px] text-gray-400 font-bold whitespace-nowrap">
                                                {new Date(ten.data_cadastro).toLocaleDateString('pt-BR')}
                                            </span>
                                        </td>
                                        <td className="px-6 py-5 text-right">
                                            <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-all">
                                                <button
                                                    onClick={() => handleEdit(ten)}
                                                    className="p-2 text-indigo-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                                                    title="Editar Plano/Conta"
                                                >
                                                    <Settings size={18} />
                                                </button>
                                                <button
                                                    onClick={() => deleteAccount(ten.id, ten.nome_fantasia)}
                                                    className="p-2 text-gray-300 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                                                    title="Excluir Definitivamente"
                                                >
                                                    <Trash2 size={18} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                {filteredTenants.length === 0 && !loading && (
                                    <tr>
                                        <td colSpan={6} className="px-6 py-20 text-center text-gray-400 font-black text-xs uppercase tracking-widest">
                                            Nenhum inquilino encontrado
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>

            {/* ONBOARDING MODAL */}
            {isModalOpen && (
                <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md transition-all ease-out animate-in fade-in duration-300">
                    <div className="bg-white rounded-4xl shadow-2xl w-full max-w-2xl overflow-hidden border border-white/20 animate-in zoom-in-95 duration-300">
                        <div className="bg-indigo-600 p-8 text-white relative">
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-white/20 rounded-2xl backdrop-blur-sm">
                                    <UserPlus size={32} />
                                </div>
                                <div>
                                    <h2 className="text-2xl font-black italic tracking-tight">Onboarding de Novo Cliente</h2>
                                    <p className="text-white/80 text-sm font-medium">Configure uma nova conta "zerada" em segundos.</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setIsModalOpen(false)}
                                className="absolute top-6 right-6 p-2 hover:bg-white/10 rounded-full transition-colors"
                            >
                                <XCircle size={24} />
                            </button>
                        </div>

                        <form onSubmit={handleCreateAccount} className="p-8 space-y-8">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                                {/* LOJA DATA */}
                                <div className="space-y-4">
                                    <h3 className="text-xs font-black text-indigo-600 uppercase tracking-widest border-b pb-2">Dados do Estabelecimento</h3>
                                    <div>
                                        <label className="block text-[10px] font-black text-gray-400 uppercase mb-1 ml-1">Nome Fantasia *</label>
                                        <input
                                            required
                                            className="w-full px-4 py-3 bg-gray-50 border-0 rounded-2xl focus:ring-2 focus:ring-indigo-600 transition-all font-bold text-gray-700"
                                            value={formData.nome_fantasia}
                                            onChange={e => setFormData({ ...formData, nome_fantasia: e.target.value })}
                                            placeholder="Ex: Mercadinho do Bairro"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-black text-gray-400 uppercase mb-1 ml-1">CNPJ *</label>
                                        <input
                                            required
                                            className={`w-full px-4 py-3 bg-gray-50 border-2 rounded-2xl transition-all font-bold text-gray-700 outline-none ${formData.cnpj ? (isValidCNPJ(formData.cnpj) ? 'border-green-500 focus:ring-green-600 focus:border-green-500' : 'border-red-500 focus:ring-red-600 focus:border-red-500') : 'border-transparent focus:ring-2 focus:ring-indigo-600'}`}
                                            value={formData.cnpj}
                                            onChange={e => setFormData({ ...formData, cnpj: e.target.value })}
                                            placeholder="00.000.000/0001-00"
                                        />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-[10px] font-black text-gray-400 uppercase mb-1 ml-1">Telefone Loja *</label>
                                            <input
                                                required
                                                className="w-full px-4 py-3 bg-gray-50 border-0 rounded-2xl focus:ring-2 focus:ring-indigo-600 transition-all font-bold text-gray-700 text-sm"
                                                value={formData.telefone_loja}
                                                onChange={e => setFormData({ ...formData, telefone_loja: e.target.value })}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[10px] font-black text-gray-400 uppercase mb-1 ml-1">E-mail Loja *</label>
                                            <input
                                                required
                                                type="email"
                                                className={`w-full px-4 py-3 bg-gray-50 border-2 rounded-2xl transition-all font-bold text-gray-700 text-sm outline-none ${formData.email_loja ? (isValidEmail(formData.email_loja) ? 'border-green-500 focus:ring-green-600 focus:border-green-500' : 'border-red-500 focus:ring-red-600 focus:border-red-500') : 'border-transparent focus:ring-2 focus:ring-indigo-600'}`}
                                                value={formData.email_loja}
                                                onChange={e => setFormData({ ...formData, email_loja: e.target.value })}
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* ADMIN DATA */}
                                <div className="space-y-4">
                                    <h3 className="text-xs font-black text-indigo-600 uppercase tracking-widest border-b pb-2">Administrador Responsável</h3>
                                    <div>
                                        <label className="block text-[10px] font-black text-gray-400 uppercase mb-1 ml-1">Nome Completo *</label>
                                        <input
                                            required
                                            className="w-full px-4 py-3 bg-gray-50 border-0 rounded-2xl focus:ring-2 focus:ring-indigo-600 transition-all font-bold text-gray-700"
                                            value={formData.nome_admin}
                                            onChange={e => setFormData({ ...formData, nome_admin: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-black text-gray-400 uppercase mb-1 ml-1">Username de Acesso *</label>
                                        <input
                                            required
                                            className="w-full px-4 py-3 bg-gray-50 border-2 border-dashed border-indigo-100 rounded-2xl focus:ring-2 focus:ring-indigo-600 transition-all font-black text-indigo-600 placeholder:text-indigo-200"
                                            value={formData.username}
                                            onChange={e => setFormData({ ...formData, username: e.target.value.toLowerCase().replace(/\s/g, '') })}
                                            placeholder="ex: joao.admin"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-black text-gray-400 uppercase mb-1 ml-1">E-mail para Receber Senha *</label>
                                        <input
                                            required
                                            type="email"
                                            className={`w-full px-4 py-3 bg-gray-50 border-2 rounded-2xl transition-all font-bold text-gray-700 outline-none ${formData.email_admin ? (isValidEmail(formData.email_admin) ? 'border-green-500 focus:ring-green-600 focus:border-green-500' : 'border-red-500 focus:ring-red-600 focus:border-red-500') : 'border-transparent focus:ring-2 focus:ring-indigo-600'}`}
                                            value={formData.email_admin}
                                            onChange={e => setFormData({ ...formData, email_admin: e.target.value })}
                                        />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-[10px] font-black text-gray-400 uppercase mb-1 ml-1">CPF Admin *</label>
                                            <input
                                                required
                                                className={`w-full px-4 py-3 bg-gray-50 border-2 rounded-2xl transition-all font-bold text-gray-700 text-sm outline-none ${formData.cpf_admin ? (isValidCPF(formData.cpf_admin) ? 'border-green-500 focus:ring-green-600 focus:border-green-500' : 'border-red-500 focus:ring-red-600 focus:border-red-500') : 'border-transparent focus:ring-2 focus:ring-indigo-600'}`}
                                                value={formData.cpf_admin}
                                                onChange={e => setFormData({ ...formData, cpf_admin: e.target.value })}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[10px] font-black text-gray-400 uppercase mb-1 ml-1">Celular/Whats *</label>
                                            <input
                                                required
                                                className="w-full px-4 py-3 bg-gray-50 border-0 rounded-2xl focus:ring-2 focus:ring-indigo-600 transition-all font-bold text-gray-700 text-sm"
                                                value={formData.celular_admin}
                                                onChange={e => setFormData({ ...formData, celular_admin: e.target.value })}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-amber-50 p-4 rounded-2xl border border-amber-100 flex gap-3 items-start">
                                <Info className="text-amber-500 shrink-0 mt-0.5" size={18} />
                                <p className="text-[10px] text-amber-800 font-bold leading-tight">
                                    AVISO: Após clicar em criar, o sistema enviará um e-mail com a senha temporária imediatamente para o administrador responsável. Certifique-se de que o e-mail está correto.
                                </p>
                            </div>

                            <div className="flex justify-end gap-3 pt-4 border-t">
                                <button
                                    type="button"
                                    onClick={() => setIsModalOpen(false)}
                                    className="px-6 py-3 font-black text-gray-400 hover:text-gray-600 transition-colors uppercase tracking-widest text-xs"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={submitting}
                                    className="flex items-center gap-2 bg-indigo-600 text-white px-10 py-4 rounded-2xl font-black italic uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100 hover:shadow-indigo-300 disabled:opacity-50 disabled:scale-95 text-sm"
                                >
                                    {submitting ? <RefreshCcw className="animate-spin" size={20} /> : 'FINALIZAR ONBOARDING'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
            {/* Modal de Edição */}
            {isEditModalOpen && (
                <div className="fixed inset-0 z-1000 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsEditModalOpen(false)} />
                    <div className="relative bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="p-8 border-b bg-gray-50/50">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h2 className="text-xl font-black text-gray-900 italic tracking-tight">EDITAR CONTA</h2>
                                    <p className="text-sm text-gray-500 font-medium">{editingTenant?.nome_fantasia}</p>
                                </div>
                                <button onClick={() => setIsEditModalOpen(false)} className="p-2 hover:bg-white rounded-xl transition-colors text-gray-400"><XCircle size={24} /></button>
                            </div>
                        </div>

                        <div className="flex border-b px-2 pt-2 bg-gray-50">
                            <button onClick={() => setEditModalTab('plano')} className={`flex-1 py-3 px-1 text-[10px] sm:text-xs font-black uppercase tracking-widest ${editModalTab === 'plano' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-400 hover:text-gray-600'}`}>Plano & Status</button>
                            <button onClick={() => setEditModalTab('principal')} className={`flex-1 py-3 px-1 text-[10px] sm:text-xs font-black uppercase tracking-widest ${editModalTab === 'principal' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-400 hover:text-gray-600'}`}>Principal</button>
                            <button onClick={() => setEditModalTab('contato')} className={`flex-1 py-3 px-1 text-[10px] sm:text-xs font-black uppercase tracking-widest ${editModalTab === 'contato' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-400 hover:text-gray-600'}`}>Contato/End.</button>
                            <button onClick={() => setEditModalTab('sistema')} className={`flex-1 py-3 px-1 text-[10px] sm:text-xs font-black uppercase tracking-widest ${editModalTab === 'sistema' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-400 hover:text-gray-600'}`}>Sistema</button>
                        </div>

                        <form onSubmit={handleUpdate} className="p-8 space-y-5 max-h-[60vh] overflow-y-auto">
                            {editModalTab === 'plano' && (
                                <div className="space-y-4">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Plano Atual</label>
                                            <select
                                                value={editFormData.plano}
                                                onChange={(e) => setEditFormData({ ...editFormData, plano: e.target.value })}
                                                className="w-full h-12 px-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                                            >
                                                <option value="Gratuito">Gratuito</option>
                                                <option value="Pro">Pro</option>
                                            </select>
                                        </div>

                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Status do Plano</label>
                                            <select
                                                value={editFormData.plano_status}
                                                onChange={(e) => setEditFormData({ ...editFormData, plano_status: e.target.value })}
                                                className="w-full h-12 px-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                                            >
                                                <option value="experimental">Experimental</option>
                                                <option value="ativo">Ativo</option>
                                                <option value="atrasado">Atrasado</option>
                                                <option value="suspenso">Suspenso</option>
                                                <option value="cancelado">Cancelado</option>
                                            </select>
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Vencimento da Assinatura</label>
                                        <input
                                            type="date"
                                            value={editFormData.vencimento_assinatura}
                                            onChange={(e) => setEditFormData({ ...editFormData, vencimento_assinatura: e.target.value })}
                                            className="w-full h-12 px-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                                        />
                                    </div>

                                    <div className="flex items-center gap-3 p-4 bg-indigo-50/50 rounded-2xl border border-indigo-100/50 mt-4">
                                        <input
                                            type="checkbox"
                                            id="is_active"
                                            checked={editFormData.ativo}
                                            onChange={(e) => setEditFormData({ ...editFormData, ativo: e.target.checked })}
                                            className="w-5 h-5 rounded-lg border-indigo-200 text-indigo-600 focus:ring-indigo-500"
                                        />
                                        <label htmlFor="is_active" className="text-sm font-black text-indigo-900 italic">CONTA ATIVA NO SISTEMA</label>
                                    </div>
                                </div>
                            )}

                            {editModalTab === 'principal' && (
                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Nome Fantasia</label>
                                        <input value={editFormData.nome_fantasia} onChange={e => setEditFormData({...editFormData, nome_fantasia: e.target.value})} className="w-full h-12 px-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all" />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Razão Social</label>
                                        <input value={editFormData.razao_social} onChange={e => setEditFormData({...editFormData, razao_social: e.target.value})} className="w-full h-12 px-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all" />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">CNPJ</label>
                                        <input value={editFormData.cnpj} onChange={e => setEditFormData({...editFormData, cnpj: e.target.value})} className={`w-full h-12 px-4 bg-gray-50 border-2 rounded-2xl text-sm font-bold outline-none transition-all ${editFormData.cnpj ? (isValidCNPJ(editFormData.cnpj) ? 'border-green-500 focus:ring-green-500' : 'border-red-500 focus:ring-red-500') : 'border-gray-100 focus:ring-2 focus:ring-indigo-500/20'}`} />
                                    </div>
                                </div>
                            )}

                            {editModalTab === 'contato' && (
                                <div className="space-y-4">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Telefone</label>
                                            <input value={editFormData.telefone} onChange={e => setEditFormData({...editFormData, telefone: e.target.value})} className="w-full h-12 px-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all" />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">E-mail</label>
                                            <input value={editFormData.email} onChange={e => setEditFormData({...editFormData, email: e.target.value})} className={`w-full h-12 px-4 bg-gray-50 border-2 rounded-2xl text-sm font-bold outline-none transition-all ${editFormData.email ? (isValidEmail(editFormData.email) ? 'border-green-500 focus:ring-green-500' : 'border-red-500 focus:ring-red-500') : 'border-gray-100 focus:ring-2 focus:ring-indigo-500/20'}`} />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-3 gap-4">
                                        <div className="space-y-2 col-span-2">
                                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Logradouro</label>
                                            <input value={editFormData.logradouro} onChange={e => setEditFormData({...editFormData, logradouro: e.target.value})} className="w-full h-12 px-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all" />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Número</label>
                                            <input value={editFormData.numero} onChange={e => setEditFormData({...editFormData, numero: e.target.value})} className="w-full h-12 px-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all" />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-3 gap-4">
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Bairro</label>
                                            <input value={editFormData.bairro} onChange={e => setEditFormData({...editFormData, bairro: e.target.value})} className="w-full h-12 px-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all" />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Cidade</label>
                                            <input value={editFormData.cidade} onChange={e => setEditFormData({...editFormData, cidade: e.target.value})} className="w-full h-12 px-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all" />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Estado</label>
                                            <input value={editFormData.estado} onChange={e => setEditFormData({...editFormData, estado: e.target.value})} className="w-full h-12 px-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all" />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {editModalTab === 'sistema' && (
                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Gateway Customer ID</label>
                                        <input value={editFormData.gateway_customer_id} onChange={e => setEditFormData({...editFormData, gateway_customer_id: e.target.value})} className="w-full h-12 px-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all font-mono" />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Gateway Subscription ID</label>
                                        <input value={editFormData.gateway_subscription_id} onChange={e => setEditFormData({...editFormData, gateway_subscription_id: e.target.value})} className="w-full h-12 px-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all font-mono" />
                                    </div>
                                </div>
                            )}

                            <div className="flex gap-4 pt-4 border-t border-gray-100">
                                <button
                                    type="button"
                                    onClick={() => setIsEditModalOpen(false)}
                                    className="flex-1 h-14 bg-gray-100 text-gray-500 rounded-2xl text-xs font-black italic tracking-widest hover:bg-gray-200 transition-all uppercase"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={submitting}
                                    className="flex-2 h-14 bg-indigo-600 text-white rounded-2xl text-xs font-black italic tracking-widest hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    {submitting ? <RefreshCcw className="animate-spin" size={20} /> : 'SALVAR ALTERAÇÕES'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SystemMonitorPage;
