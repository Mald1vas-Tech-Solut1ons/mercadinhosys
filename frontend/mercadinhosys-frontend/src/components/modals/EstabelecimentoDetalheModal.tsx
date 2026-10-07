import React, { useState, useEffect } from 'react';
import { X, Building2, Users, Package, ShoppingBag, TrendingUp, MapPin, Phone, CreditCard, Settings, Edit2, Check, Loader2, Save } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { apiClient } from '../../api/apiClient';
import { isValidCNPJ } from '../../utils/validators';

interface EstabelecimentoDetalheModalProps {
    estabelecimento: any;
    isOpen: boolean;
    onClose: () => void;
    onUpdate?: () => void;
}

const EstabelecimentoDetalheModal: React.FC<EstabelecimentoDetalheModalProps> = ({
    estabelecimento,
    isOpen,
    onClose,
    onUpdate
}) => {
    const { user } = useAuth();
    const isSuperAdmin = user?.is_super_admin;

    const [isEditingPlan, setIsEditingPlan] = useState(false);
    const [selectedPlan, setSelectedPlan] = useState('');
    const [isSavingPlan, setIsSavingPlan] = useState(false);

    const [isEditing, setIsEditing] = useState(false);
    const [formData, setFormData] = useState<any>({});
    const [isSaving, setIsSaving] = useState(false);

    // Initial sync
    useEffect(() => {
        if (estabelecimento) {
            setFormData(estabelecimento);
            if (estabelecimento.plano) {
                setSelectedPlan(estabelecimento.plano);
            }
        }
    }, [estabelecimento]);

    if (!isOpen || !estabelecimento) return null;

    const handleInputChange = (field: string, value: any) => {
        setFormData((prev: any) => ({ ...prev, [field]: value }));
    };

    const handleSave = async () => {
        if (formData.cnpj && !isValidCNPJ(formData.cnpj)) {
            alert('CNPJ inválido!');
            return;
        }
        try {
            setIsSaving(true);
            await apiClient.put(`/saas/estabelecimentos/${estabelecimento.id}`, formData);
            setIsEditing(false);
            if (onUpdate) onUpdate();
            else window.location.reload();
        } catch (error) {
            console.error('Erro ao salvar:', error);
            alert('Falha ao atualizar dados.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleSavePlan = async () => {
        try {
            setIsSavingPlan(true);
            await apiClient.put(`/saas/estabelecimentos/${estabelecimento.id}/plano`, {
                plano: selectedPlan
            });
            setIsEditingPlan(false);
            if (onUpdate) onUpdate();
            else window.location.reload(); // Fallback se não receber prop
        } catch (error) {
            console.error('Erro ao atualizar plano:', error);
            alert('Falha ao atualizar o plano.');
        } finally {
            setIsSavingPlan(false);
        }
    };

    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL'
        }).format(value);
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString('pt-BR');
    };

    const getPlanoColor = (plano: string) => {
        switch ((plano || '').toLowerCase()) {
            case 'gratuito':
                return 'bg-gray-100 text-gray-800 border-gray-300';
            case 'pro':
                return 'bg-purple-100 text-purple-800 border-purple-300';
            default:
                return 'bg-gray-100 text-gray-800 border-gray-300';
        }
    };

    const getPlanoStatusColor = (status: string) => {
        switch (status?.toLowerCase()) {
            case 'ativo':
                return 'bg-green-100 text-green-800 border-green-300';
            case 'experimental':
                return 'bg-yellow-100 text-yellow-800 border-yellow-300';
            case 'atrasado':
                return 'bg-red-100 text-red-800 border-red-300';
            case 'cancelado':
                return 'bg-gray-100 text-gray-800 border-gray-300';
            default:
                return 'bg-gray-100 text-gray-800 border-gray-300';
        }
    };

    return (
        <div className="fixed inset-0 z-100 flex items-center justify-center p-4 overflow-y-auto" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))', paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}>
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

            <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90dvh] overflow-hidden my-auto flex flex-col">
                {/* Header */}
                <div className="relative bg-linear-to-r from-blue-600 to-indigo-600 p-6 text-white shrink-0">
                    <button
                        onClick={onClose}
                        className="absolute top-4 right-4 p-2 rounded-lg bg-white/20 hover:bg-white/30 transition-colors"
                    >
                        <X size={20} />
                    </button>

                    <div className="flex items-start gap-4">
                        <div className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center">
                            <Building2 size={32} />
                        </div>
                        <div className="flex-1">
                            {isEditing ? (
                                <div className="space-y-2">
                                    <input 
                                        type="text" 
                                        className="text-2xl font-bold bg-white/10 border border-white/30 rounded px-2 py-1 w-full text-white placeholder-white/50 focus:outline-none focus:border-white" 
                                        value={formData.nome_fantasia || ''} 
                                        onChange={e => handleInputChange('nome_fantasia', e.target.value)} 
                                        placeholder="Nome Fantasia"
                                    />
                                    <input 
                                        type="text" 
                                        className="text-blue-100 bg-white/10 border border-white/30 rounded px-2 py-1 w-full placeholder-white/50 focus:outline-none focus:border-white" 
                                        value={formData.razao_social || ''} 
                                        onChange={e => handleInputChange('razao_social', e.target.value)} 
                                        placeholder="Razão Social"
                                    />
                                </div>
                            ) : (
                                <>
                                    <h2 className="text-2xl font-bold">{estabelecimento.nome_fantasia}</h2>
                                    <p className="text-blue-100 mt-1">{estabelecimento.razao_social}</p>
                                </>
                            )}
                            <div className="flex items-center gap-3 mt-3">
                                <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${getPlanoColor(estabelecimento.plano)}`}>
                                    {estabelecimento.plano || 'Gratuito'}
                                </span>
                                <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${getPlanoStatusColor(estabelecimento.plano_status)}`}>
                                    {estabelecimento.plano_status || 'Experimental'}
                                </span>
                                <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${estabelecimento.ativo ? 'bg-green-100 text-green-800 border-green-300' : 'bg-red-100 text-red-800 border-red-300'}`}>
                                    {estabelecimento.ativo ? 'Ativo' : 'Inativo'}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto flex-1">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Informações Principais */}
                        <div className="space-y-4">
                            <div>
                                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                                    <Building2 size={18} />
                                    Informações Principais
                                </h3>
                                <div className="space-y-3">
                                    <div className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                                        <span className="text-sm text-gray-600 dark:text-gray-400">CNPJ</span>
                                        {isEditing ? (
                                            <input type="text" className={`px-2 py-1 text-sm border-2 rounded bg-white dark:bg-gray-800 dark:text-white outline-none ${formData.cnpj ? (isValidCNPJ(formData.cnpj) ? 'border-green-500' : 'border-red-500') : 'dark:border-gray-600'}`} value={formData.cnpj || ''} onChange={e => handleInputChange('cnpj', e.target.value)} />
                                        ) : (
                                            <span className="text-sm font-medium text-gray-900 dark:text-white">{estabelecimento.cnpj}</span>
                                        )}
                                    </div>
                                    <div className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                                        <span className="text-sm text-gray-600 dark:text-gray-400">Inscrição Estadual</span>
                                        {isEditing ? (
                                            <input type="text" className="px-2 py-1 text-sm border rounded bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-white" value={formData.inscricao_estadual || ''} onChange={e => handleInputChange('inscricao_estadual', e.target.value)} />
                                        ) : (
                                            <span className="text-sm font-medium text-gray-900 dark:text-white">{estabelecimento.inscricao_estadual || 'Não informado'}</span>
                                        )}
                                    </div>
                                    <div className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                                        <span className="text-sm text-gray-600 dark:text-gray-400">Regime Tributário</span>
                                        {isEditing ? (
                                            <input type="text" className="px-2 py-1 text-sm border rounded bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-white" value={formData.regime_tributario || ''} onChange={e => handleInputChange('regime_tributario', e.target.value)} />
                                        ) : (
                                            <span className="text-sm font-medium text-gray-900 dark:text-white">{estabelecimento.regime_tributario || 'Não informado'}</span>
                                        )}
                                    </div>
                                    <div className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                                        <span className="text-sm text-gray-600 dark:text-gray-400">Data de Abertura</span>
                                        <span className="text-sm font-medium text-gray-900 dark:text-white">
                                            {estabelecimento.data_abertura ? formatDate(estabelecimento.data_abertura) : 'Não informado'}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <div>
                                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                                    <CreditCard size={18} />
                                    Assinatura
                                </h3>
                                <div className="space-y-3">
                                    <div className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                                        <span className="text-sm text-gray-600 dark:text-gray-400">Plano</span>
                                        <div className="flex items-center gap-2">
                                            {isEditingPlan ? (
                                                <div className="flex items-center gap-2">
                                                    <select
                                                        value={selectedPlan}
                                                        onChange={(e) => setSelectedPlan(e.target.value)}
                                                        className="px-2 py-1 text-sm border rounded bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                                                    >
                                                        <option value="Gratuito">Gratuito</option>
                                                        <option value="Pro">Pro</option>
                                                    </select>
                                                    <button
                                                        onClick={handleSavePlan}
                                                        disabled={isSavingPlan}
                                                        className="p-1.5 text-green-600 hover:bg-green-100 rounded-md transition-colors"
                                                        title="Salvar"
                                                    >
                                                        {isSavingPlan ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                                                    </button>
                                                    <button
                                                        onClick={() => setIsEditingPlan(false)}
                                                        className="p-1.5 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-md transition-colors"
                                                        title="Cancelar"
                                                    >
                                                        <X size={16} />
                                                    </button>
                                                </div>
                                            ) : (
                                                <>
                                                    <span className={`px-2 py-1 rounded text-xs font-semibold border ${getPlanoColor(estabelecimento.plano)}`}>
                                                        {estabelecimento.plano || 'Gratuito'}
                                                    </span>
                                                    {isSuperAdmin && (
                                                        <button
                                                            onClick={() => setIsEditingPlan(true)}
                                                            className="p-1 text-blue-600 hover:bg-blue-100 dark:hover:bg-blue-900 rounded-md transition-colors ml-1"
                                                            title="Alterar Plano"
                                                        >
                                                            <Edit2 size={14} />
                                                        </button>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                                        <span className="text-sm text-gray-600 dark:text-gray-400">Status</span>
                                        <span className={`px-2 py-1 rounded text-xs font-semibold border ${getPlanoStatusColor(estabelecimento.plano_status)}`}>
                                            {estabelecimento.plano_status || 'Experimental'}
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                                        <span className="text-sm text-gray-600 dark:text-gray-400">Vencimento</span>
                                        <span className="text-sm font-medium text-gray-900 dark:text-white">
                                            {estabelecimento.vencimento_assinatura ? formatDate(estabelecimento.vencimento_assinatura) : 'Não definido'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Contato e Endereço */}
                        <div className="space-y-4">
                            <div>
                                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                                    <Phone size={18} />
                                    Contato
                                </h3>
                                <div className="space-y-3">
                                    <div className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                                        <span className="text-sm text-gray-600 dark:text-gray-400">Telefone</span>
                                        {isEditing ? (
                                            <input type="text" className="px-2 py-1 text-sm border rounded bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-white" value={formData.telefone || ''} onChange={e => handleInputChange('telefone', e.target.value)} />
                                        ) : (
                                            <span className="text-sm font-medium text-gray-900 dark:text-white">{estabelecimento.telefone}</span>
                                        )}
                                    </div>
                                    <div className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                                        <span className="text-sm text-gray-600 dark:text-gray-400">E-mail</span>
                                        {isEditing ? (
                                            <input type="text" className="px-2 py-1 text-sm border rounded bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-white w-full max-w-[200px]" value={formData.email || ''} onChange={e => handleInputChange('email', e.target.value)} />
                                        ) : (
                                            <span className="text-sm font-medium text-gray-900 dark:text-white">{estabelecimento.email}</span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div>
                                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                                    <MapPin size={18} />
                                    Endereço
                                </h3>
                                <div className="space-y-3">
                                    <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg space-y-2">
                                        <span className="text-sm text-gray-600 dark:text-gray-400">Endereço Completo</span>
                                        {isEditing ? (
                                            <div className="space-y-2 mt-2">
                                                <div className="flex gap-2">
                                                    <input type="text" placeholder="Logradouro" className="flex-1 px-2 py-1 text-sm border rounded bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-white" value={formData.logradouro || ''} onChange={e => handleInputChange('logradouro', e.target.value)} />
                                                    <input type="text" placeholder="Número" className="w-24 px-2 py-1 text-sm border rounded bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-white" value={formData.numero || ''} onChange={e => handleInputChange('numero', e.target.value)} />
                                                </div>
                                                <input type="text" placeholder="Complemento" className="w-full px-2 py-1 text-sm border rounded bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-white" value={formData.complemento || ''} onChange={e => handleInputChange('complemento', e.target.value)} />
                                                <input type="text" placeholder="Bairro" className="w-full px-2 py-1 text-sm border rounded bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-white" value={formData.bairro || ''} onChange={e => handleInputChange('bairro', e.target.value)} />
                                                <div className="flex gap-2">
                                                    <input type="text" placeholder="Cidade" className="flex-1 px-2 py-1 text-sm border rounded bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-white" value={formData.cidade || ''} onChange={e => handleInputChange('cidade', e.target.value)} />
                                                    <input type="text" placeholder="UF" className="w-16 px-2 py-1 text-sm border rounded bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-white" value={formData.estado || ''} onChange={e => handleInputChange('estado', e.target.value)} />
                                                </div>
                                            </div>
                                        ) : (
                                            <p className="text-sm font-medium text-gray-900 dark:text-white mt-1">
                                                {estabelecimento.logradouro && estabelecimento.numero
                                                    ? `${estabelecimento.logradouro}, ${estabelecimento.numero}`
                                                    : 'Endereço não informado'
                                                }
                                                {estabelecimento.complemento && `, ${estabelecimento.complemento}`}
                                                {estabelecimento.bairro && `, ${estabelecimento.bairro}`}
                                                {estabelecimento.cidade && estabelecimento.estado
                                                    ? `, ${estabelecimento.cidade}/${estabelecimento.estado}`
                                                    : ''
                                                }
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                                        <span className="text-sm text-gray-600 dark:text-gray-400">CEP</span>
                                        {isEditing ? (
                                            <input type="text" className="px-2 py-1 text-sm border rounded bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-white" value={formData.cep || ''} onChange={e => handleInputChange('cep', e.target.value)} />
                                        ) : (
                                            <span className="text-sm font-medium text-gray-900 dark:text-white">{estabelecimento.cep || 'Não informado'}</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Métricas e Estatísticas */}
                    <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                            <TrendingUp size={18} />
                            Métricas e Estatísticas
                        </h3>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="bg-linear-to-br from-blue-500 to-blue-600 p-4 rounded-xl text-white">
                                <div className="flex items-center gap-2 mb-2">
                                    <Users size={16} />
                                    <span className="text-sm text-blue-100">Funcionários</span>
                                </div>
                                <p className="text-2xl font-bold">{estabelecimento.total_funcionarios || 0}</p>
                            </div>
                            <div className="bg-linear-to-br from-green-500 to-green-600 p-4 rounded-xl text-white">
                                <div className="flex items-center gap-2 mb-2">
                                    <Package size={16} />
                                    <span className="text-sm text-green-100">Produtos</span>
                                </div>
                                <p className="text-2xl font-bold">{estabelecimento.total_produtos || 0}</p>
                            </div>
                            <div className="bg-linear-to-br from-purple-500 to-purple-600 p-4 rounded-xl text-white">
                                <div className="flex items-center gap-2 mb-2">
                                    <ShoppingBag size={16} />
                                    <span className="text-sm text-purple-100">Clientes</span>
                                </div>
                                <p className="text-2xl font-bold">{estabelecimento.total_clientes || 0}</p>
                            </div>
                            <div className="bg-linear-to-br from-orange-500 to-orange-600 p-4 rounded-xl text-white">
                                <div className="flex items-center gap-2 mb-2">
                                    <TrendingUp size={16} />
                                    <span className="text-sm text-orange-100">Faturamento</span>
                                </div>
                                <p className="text-2xl font-bold">{formatCurrency(estabelecimento.faturamento_total || 0)}</p>
                            </div>
                        </div>
                    </div>

                    {/* Informações do Sistema */}
                    <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                            <Settings size={18} />
                            Informações do Sistema
                        </h3>
                        <div className="grid grid-cols-1 gap-4">
                            <div className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                                <span className="text-sm text-gray-600 dark:text-gray-400">ID do Estabelecimento</span>
                                <span className="text-sm font-medium text-gray-900 dark:text-white">#{estabelecimento.id}</span>
                            </div>
                            <div className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                                <span className="text-sm text-gray-600 dark:text-gray-400">Data de Cadastro</span>
                                <span className="text-sm font-medium text-gray-900 dark:text-white">
                                    {estabelecimento.data_cadastro ? formatDate(estabelecimento.data_cadastro) : 'Não informado'}
                                </span>
                            </div>
                            <div className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg flex-wrap gap-2">
                                <span className="text-sm text-gray-600 dark:text-gray-400">Gateway Customer ID</span>
                                {isEditing ? (
                                    <input type="text" className="flex-1 min-w-[200px] px-2 py-1 text-sm border rounded bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-white" value={formData.gateway_customer_id || ''} onChange={e => handleInputChange('gateway_customer_id', e.target.value)} />
                                ) : (
                                    <span className="font-medium text-gray-900 dark:text-white break-all">
                                        {estabelecimento.gateway_customer_id || 'Não configurado'}
                                    </span>
                                )}
                            </div>
                            <div className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg flex-wrap gap-2">
                                <span className="text-sm text-gray-600 dark:text-gray-400">Gateway Subscription ID</span>
                                {isEditing ? (
                                    <input type="text" className="flex-1 min-w-[200px] px-2 py-1 text-sm border rounded bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-white" value={formData.gateway_subscription_id || ''} onChange={e => handleInputChange('gateway_subscription_id', e.target.value)} />
                                ) : (
                                    <span className="font-medium text-gray-900 dark:text-white break-all">
                                        {estabelecimento.gateway_subscription_id || 'Não configurado'}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 shrink-0">
                    <div className="flex justify-between items-center">
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                            Última atualização: {estabelecimento.data_cadastro ? formatDate(estabelecimento.data_cadastro) : 'Não informado'}
                        </p>
                        <div className="flex gap-3">
                            <button
                                onClick={onClose}
                                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-white rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                            >
                                Fechar
                            </button>
                            {isSuperAdmin && (
                                isEditing ? (
                                    <button
                                        onClick={handleSave}
                                        disabled={isSaving}
                                        className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2 disabled:opacity-50"
                                    >
                                        {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                                        Salvar Alterações
                                    </button>
                                ) : (
                                    <button
                                        onClick={() => setIsEditing(true)}
                                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
                                    >
                                        <Edit2 size={16} />
                                        Editar Estabelecimento
                                    </button>
                                )
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default EstabelecimentoDetalheModal;
