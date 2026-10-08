import React, { useState, useEffect, useRef } from 'react';
import {
    Store, Settings, CreditCard, Printer,
    Shield, Bell, Upload, MapPin,
    Save, CheckCircle, Building2, Clock,
    ShoppingCart, Package, X, XCircle, Edit2, RefreshCw,
    Database, HardDrive, Keyboard, DollarSign, User
} from 'lucide-react';
import settingsService, { Configuracao, Estabelecimento, PontoConfig } from './settingsService';
import ShortcutsHelp from '../../shortcuts/ShortcutsHelp';
import AccountSettings from './AccountSettings';
import { showToast } from '../../components/elements/Toast';
import { useAuth } from '../../contexts/AuthContext';
import { useConfig } from '../../contexts/ConfigContext';
import { buscarCep, formatCep, formatCnpj, formatPhone } from '../../utils/cepUtils';
import { apiClient } from '../../api/apiClient';
import SubscriptionSettings from './SubscriptionSettings';
import SegmentSettings from './SegmentSettings';
import SyncManager from '../../components/sync/SyncManager';
import { SyncDataButton } from './SyncDataButton';
import { useTheme } from '../../theme/useTheme';
import { authService } from '../auth/authService';
import { getSettingsTabs } from '../../utils/permissions';

// Componentes de UI reutilizáveis (poderiam estar em arquivos separados)
type SectionTitleProps = {
    title: string;
    icon: React.ComponentType<{ className?: string }>;
};

type InputFieldProps = {
    label: string;
    value: string | number;
    onChange: React.ChangeEventHandler<HTMLInputElement>;
    type?: string;
    step?: string | number;
    placeholder?: string;
    disabled?: boolean;
    onBlur?: React.FocusEventHandler<HTMLInputElement>;
};

type SwitchFieldProps = {
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
    description?: string;
};

/**
 * PIN de segurança em 4 quadrados: cada dígito preenche um quadrado e,
 * com os 4 preenchidos, o botão Salvar é autorizado.
 */
const PinQuadrados = ({ value, onChange, disabled = false }: {
    value: string;
    onChange: (v: string) => void;
    disabled?: boolean;
}) => {
    const refs = useRef<(HTMLInputElement | null)[]>([]);

    const setDigito = (idx: number, char: string) => {
        const d = char.replace(/\D/g, '').slice(-1);
        const arr = Array.from({ length: 4 }, (_, i) => value[i] || '');
        arr[idx] = d;
        onChange(arr.join('').slice(0, 4));
        if (d && idx < 3) refs.current[idx + 1]?.focus();
    };

    const onKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Backspace' && !value[idx] && idx > 0) {
            refs.current[idx - 1]?.focus();
        }
    };

    return (
        <div className="flex gap-3">
            {[0, 1, 2, 3].map(i => (
                <input
                    key={i}
                    ref={el => { refs.current[i] = el; }}
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={1}
                    disabled={disabled}
                    value={value[i] || ''}
                    onChange={e => setDigito(i, e.target.value)}
                    onKeyDown={e => onKeyDown(i, e)}
                    aria-label={`Dígito ${i + 1} do PIN`}
                    className={`w-12 h-12 text-center text-2xl font-bold rounded-lg border-2 outline-none transition-colors
                        ${value[i]
                            ? 'border-amber-500 bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
                            : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white'}
                        focus:border-amber-500 focus:ring-2 focus:ring-amber-300 disabled:opacity-50`}
                />
            ))}
        </div>
    );
};

const SectionTitle = ({ title, icon: Icon }: SectionTitleProps) => (
    <div className="flex items-center space-x-2 mb-4 border-b pb-2 border-gray-200 dark:border-gray-700">
        <Icon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
        <h3 className="text-lg font-medium text-gray-800 dark:text-gray-200">{title}</h3>
    </div>
);

const InputField = ({ label, value, onChange, type = "text", step, placeholder = "", disabled = false, onBlur }: InputFieldProps) => (
    <div className="flex flex-col space-y-1">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>
        <input
            type={type}
            step={step}
            value={value}
            onChange={onChange}
            onBlur={onBlur}
            disabled={disabled}
            placeholder={placeholder}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white transition-colors"
        />
    </div>
);

const SwitchField = ({ label, checked, onChange, description }: SwitchFieldProps) => (
    <div className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors border-gray-200 dark:border-gray-700">
        <div className="flex flex-col">
            <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{label}</span>
            {description && <span className="text-xs text-gray-500 dark:text-gray-400">{description}</span>}
        </div>
        <button
            onClick={() => onChange(!checked)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${checked ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-600'}`}
        >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
    </div>
);

const defaultConfig: Configuracao = {
    id: 0, estabelecimento_id: 0, cor_principal: '#2563eb', tema_escuro: false,
    emitir_nfe: false, emitir_nfce: true, impressao_automatica: false, tipo_impressora: 'termica_80mm',
    exibir_preco_tela: true, mostrar_foto_produto_pdv: false, permitir_venda_sem_estoque: false, desconto_maximo_percentual: 10,
    desconto_maximo_funcionario: 10, arredondamento_valores: true, formas_pagamento: [],
    motivos_estorno: ["Erro de digitação", "Desistência do cliente", "Produto avariado", "Cobrança duplicada", "Treinamento/Teste"],
    controlar_validade: true, alerta_estoque_minimo: true, dias_alerta_validade: 30, estoque_minimo_padrao: 10,
    tempo_sessao_minutos: 30, tentativas_senha_bloqueio: 3, alertas_email: false, alertas_whatsapp: false
};

const defaultEstab: Estabelecimento = {
    id: 0, nome_fantasia: '', razao_social: '', cnpj: '', telefone: '', email: '',
    cep: '', logradouro: '', numero: '', bairro: '', cidade: '', estado: ''
};

// ==================== PAINEL DE ESTABELECIMENTOS ====================
interface EstabInfo {
    id: number; nome_fantasia: string; razao_social: string; cnpj: string;
    telefone: string; email: string; cidade: string; estado: string;
    ativo: boolean; total_funcionarios: number; total_produtos: number;
    total_clientes: number; faturamento_total: number;
}

const EstabelecimentosPanel: React.FC = () => {
    const [lista, setLista] = useState<EstabInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [editando, setEditando] = useState<EstabInfo | null>(null);

    const carregar = async () => {
        setLoading(true);
        try {
            const res = await apiClient.get('/configuracao/estabelecimentos');
            setLista(res.data.estabelecimentos || []);
        } catch {
            showToast.error('Erro ao carregar estabelecimentos');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { carregar(); }, []);

    const fmt = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <p className="text-sm text-gray-500 dark:text-gray-400">Todos os estabelecimentos cadastrados nesta conta.</p>
                <button onClick={carregar} className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium">
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                    Atualizar
                </button>
            </div>

            {loading && (
                <div className="flex justify-center py-10">
                    <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                </div>
            )}

            {!loading && lista.map(est => (
                <div key={est.id} className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                    {/* Header */}
                    <div className={`px-4 py-3 flex items-center justify-between ${est.ativo ? 'bg-blue-600' : 'bg-gray-500'
                        }`}>
                        <div className="flex items-center gap-2">
                            <Store size={18} className="text-white" />
                            <div>
                                <p className="text-white font-semibold text-sm">{est.nome_fantasia}</p>
                                <p className="text-blue-100 text-xs opacity-80">{est.razao_social}</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${est.ativo ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                                }`}>
                                {est.ativo ? <CheckCircle size={11} /> : <XCircle size={11} />}
                                {est.ativo ? 'Ativa' : 'Inativa'}
                            </span>
                            <button
                                onClick={() => setEditando(est)}
                                className="flex items-center gap-1 text-xs bg-white/20 hover:bg-white/30 text-white px-2.5 py-1 rounded-lg transition-colors"
                            >
                                <Edit2 size={12} /> Editar
                            </button>
                        </div>
                    </div>
                    {/* Métricas */}
                    <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3 bg-white dark:bg-gray-800">
                        <div className="text-center">
                            <p className="text-lg font-bold text-gray-900 dark:text-white">{est.total_funcionarios}</p>
                            <p className="text-xs text-gray-500">Funcionários</p>
                        </div>
                        <div className="text-center">
                            <p className="text-lg font-bold text-gray-900 dark:text-white">{est.total_produtos}</p>
                            <p className="text-xs text-gray-500">Produtos</p>
                        </div>
                        <div className="text-center">
                            <p className="text-lg font-bold text-gray-900 dark:text-white">{est.total_clientes}</p>
                            <p className="text-xs text-gray-500">Clientes</p>
                        </div>
                        <div className="text-center">
                            <p className="text-sm font-bold text-green-600">{fmt(est.faturamento_total)}</p>
                            <p className="text-xs text-gray-500">Faturamento</p>
                        </div>
                    </div>
                    {/* Rodapé contato */}
                    <div className="px-4 py-2 bg-gray-50 dark:bg-gray-700/40 flex flex-wrap gap-x-4 gap-y-1 border-t border-gray-100 dark:border-gray-700">
                        {est.cidade && <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1"><MapPin size={11} /> {est.cidade}/{est.estado}</span>}
                        {est.telefone && <span className="text-xs text-gray-500 dark:text-gray-400">{est.telefone}</span>}
                        {est.email && <span className="text-xs text-gray-500 dark:text-gray-400">{est.email}</span>}
                    </div>
                </div>
            ))}

            {/* Modal de edição */}
            {editando && (
                <div className="fixed inset-0 z-100 flex items-center justify-center p-4 overflow-y-auto" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))', paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}>
                    <div className="absolute inset-0 bg-black/60" onClick={() => setEditando(null)} />
                    <div className="relative w-full max-w-md mx-4 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 space-y-4 max-h-[90dvh] overflow-y-auto my-auto">
                        <div className="flex items-center justify-between">
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                <Building2 size={18} className="text-blue-600" />
                                Editar: {editando.nome_fantasia}
                            </h3>
                            <button onClick={() => setEditando(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                                <X size={20} />
                            </button>
                        </div>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Para editar os dados completos deste estabelecimento, acesse a aba <strong>Estabelecimento</strong> nas configurações ou entre com a conta do administrador desta loja.</p>
                        <div className="grid grid-cols-2 gap-3 text-sm">
                            <div><p className="text-gray-500">ID</p><p className="font-semibold text-gray-900 dark:text-white">#{editando.id}</p></div>
                            <div><p className="text-gray-500">CNPJ</p><p className="font-semibold text-gray-900 dark:text-white">{editando.cnpj || '—'}</p></div>
                            <div><p className="text-gray-500">Faturamento</p><p className="font-semibold text-green-600">{fmt(editando.faturamento_total)}</p></div>
                            <div><p className="text-gray-500">Status</p><p className={`font-semibold ${editando.ativo ? 'text-green-600' : 'text-red-500'}`}>{editando.ativo ? 'Ativa' : 'Inativa'}</p></div>
                        </div>
                        <button
                            onClick={() => setEditando(null)}
                            className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-sm transition-colors"
                        >
                            Fechar
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

const SettingsPage: React.FC = () => {
    const [activeTab, setActiveTab] = useState('geral');
    // Permite abrir uma aba específica via ?tab= (ex.: o CTA do aviso de trial).
    useEffect(() => {
        const tab = new URLSearchParams(window.location.search).get('tab');
        if (tab) setActiveTab(tab);
    }, []);
    const [novoMotivo, setNovoMotivo] = useState('');
    const [loadingEstab, setLoadingEstab] = useState(true);
    const [saving, setSaving] = useState(false);
    const [loadingCep, setLoadingCep] = useState(false);
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    const [loadingGeolocation, setLoadingGeolocation] = useState(false);
    const [logoPreview, setLogoPreview] = useState<string | null>(null);
    const {
        config: globalConfig,
        loading: configLoading,
        updateConfig: updateGlobalConfig,
        updatePreferencias,
        refreshConfig
    } = useConfig();
    const { mode } = useTheme();
    const isDark = mode === 'dark';
    const { user } = useAuth();

    const [config, setConfig] = useState<Configuracao>(defaultConfig);
    const [estab, setEstab] = useState<Estabelecimento>(defaultEstab);

    const isSuperAdmin = user?.is_super_admin || false;
    // Admin da LOJA = usuário nível 1 (dono do mercadinho). NÃO é o super admin
    // (dono do SaaS, nível 0). O PIN é uma config operacional da loja, então
    // pertence ao admin nível 1 — é o registro que o gate (nível ≤ 2) encontra.
    const isTenantAdmin = !isSuperAdmin && (
        ['admin', 'dono'].includes(((user as any)?.role || '').toLowerCase())
        || (((user as any)?.nivel_acesso ?? 99) <= 1)
    );

    // PIN de segurança (autoriza estorno, editar e descartar produtos)
    const [pinForm, setPinForm] = useState('');
    const [temPin, setTemPin] = useState(false);
    const [savingPin, setSavingPin] = useState(false);

    // Configuração REAL de ponto (tabela ConfiguracaoHorario). Vive separada do
    // objeto `config` genérico porque é o que o motor de ponto de fato lê/usa.
    const [pontoConfig, setPontoConfig] = useState<PontoConfig>({});
    const [pontoConfigCarregada, setPontoConfigCarregada] = useState(false);

    useEffect(() => {
        settingsService.getPontoConfig()
            .then(cfg => { setPontoConfig(cfg || {}); setPontoConfigCarregada(true); })
            .catch(() => {});
    }, []);

    useEffect(() => {
        if (!isTenantAdmin) return;
        settingsService.getPinStatus()
            .then(r => setTemPin(!!r.tem_pin))
            .catch(() => {});
    }, [isTenantAdmin]);

    const salvarPin = async () => {
        if (pinForm.length !== 4) { showToast.error('Preencha os 4 quadrados do PIN'); return; }
        setSavingPin(true);
        try {
            await settingsService.setPin(pinForm);
            setTemPin(true);
            setPinForm('');
            showToast.success('PIN de segurança salvo!');
        } catch (e: any) {
            showToast.error(e?.response?.data?.error || 'Erro ao salvar o PIN');
        } finally {
            setSavingPin(false);
        }
    };

    const coresPredefinidas = [
        { nome: 'Azul Padrão', valor: '#2563eb' },
        { nome: 'Esmeralda', valor: '#10b981' },
        { nome: 'Indigo', valor: '#6366f1' },
        { nome: 'Rosa', valor: '#f43f5e' },
        { nome: 'Laranja', valor: '#f59e0b' },
        { nome: 'Roxo', valor: '#8b5cf6' },
        { nome: 'Ardósia', valor: '#475569' },
        { nome: 'Preto', valor: '#111827' }
    ];

    useEffect(() => {
        if (globalConfig) {
            setConfig(globalConfig);
        }
    }, [globalConfig]);

    useEffect(() => {
        const fetchEstab = async () => {
            if (!user?.estabelecimento_id) {
                setLoadingEstab(false);
                return;
            }
            try {
                setLoadingEstab(true);
                const data = await settingsService.getEstabelecimento();
                setEstab(data);
            } catch (error) {
                showToast.error('Erro ao carregar dados do estabelecimento');
            } finally {
                setLoadingEstab(false);
            }
        };
        fetchEstab();
    }, [user?.id, user?.estabelecimento_id]);

    const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (file.size > 2 * 1024 * 1024) {
            showToast.error('Imagem muito grande. Máximo 2MB.');
            return;
        }

        const reader = new FileReader();
        reader.onload = async (event) => {
            const base64 = event.target?.result as string;
            setLogoPreview(base64);
            try {
                // Enviar o objeto File diretamente, conforme esperado pelo service
                const logoUrl = await settingsService.uploadLogo(file);
                if (logoUrl) {
                    await refreshConfig();
                    showToast.success('Logo atualizada com sucesso!');
                }
            } catch (error) {
                showToast.error('Erro ao enviar logo');
            }
        };
        reader.readAsDataURL(file);
    };

    const handleCorChange = (cor: string) => {
        setConfig({ ...config, cor_principal: cor });
        updateGlobalConfig({ cor_principal: cor });
    };

    const handleGetCurrentLocation = () => {
        setLoadingGeolocation(true);
        if (!navigator.geolocation) {
            showToast.error('Geolocalização não suportada');
            setLoadingGeolocation(false);
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                setConfig({
                    ...config,
                    latitude_estabelecimento: position.coords.latitude,
                    longitude_estabelecimento: position.coords.longitude
                });
                showToast.success('Localização obtida!');
                setLoadingGeolocation(false);
            },
            () => {
                showToast.error('Erro ao obter localização');
                setLoadingGeolocation(false);
            }
        );
    };

    const handleSave = async () => {
        try {
            setSaving(true);
            // Removido showToast.info redundante

            const configToUpdate = { ...config };
            delete (configToUpdate as any).tema_escuro; // Não sobrescrever tema pessoal via config geral
            delete (configToUpdate as any).logo_base64;
            // A logo é gerenciada pelo endpoint dedicado (uploadLogo). Reenviá-la
            // aqui quebrava o save: um data-URI base64 estoura o VARCHAR(500) de
            // logo_url (erro 500 StringDataRightTruncation).
            delete (configToUpdate as any).logo_url;

            const tarefas: Promise<unknown>[] = [
                updateGlobalConfig(configToUpdate),
                settingsService.updateEstabelecimento(estab),
            ];
            // Persiste a config REAL de ponto (motor de ponto) somente se ela foi
            // carregada — evita sobrescrever a config do backend com um objeto vazio.
            if (pontoConfigCarregada) {
                tarefas.push(settingsService.updatePontoConfig(pontoConfig));
            }
            await Promise.all(tarefas);

            showToast.success('Configurações salvas!');
        } catch (error) {
            showToast.error('Erro ao salvar');
        } finally {
            setSaving(false);
        }
    };

    const handleTemaChange = async (tema: boolean) => {
        // Agora usamos o toggleTheme centralizado ou updatePreferencias (via ConfigContext)
        // Como o SwitchField envia o novo estado, o toggleTheme convencional não serve
        // direto, mas o ThemeProvider já sincroniza com preferencias.tema_escuro.
        try {
            await updatePreferencias({ tema_escuro: tema });
        } catch (error) {
            showToast.error('Erro ao mudar tema');
        }
    };

    const handleCepBlur = async () => {
        const cepLimpo = estab.cep?.replace(/\D/g, '') ?? '';
        if (cepLimpo.length !== 8) return;

        setLoadingCep(true);
        try {
            const dados = await buscarCep(estab.cep);
            if (dados) {
                setEstab(prev => ({
                    ...prev,
                    logradouro: dados.logradouro || prev.logradouro,
                    bairro: dados.bairro || prev.bairro,
                    cidade: dados.localidade || prev.cidade,
                    estado: dados.uf || prev.estado
                }));
            }
        } finally {
            setLoadingCep(false);
        }
    };

    const todasAsTabs = [
        { id: 'geral', label: 'Geral', icon: Settings },
        { id: 'conta', label: 'Minha Conta', icon: User },
        { id: 'segmento', label: 'Segmento & Exibição', icon: Store },
        { id: 'estabelecimento', label: 'Estabelecimento', icon: Building2 },
        { id: 'fiscal', label: 'Fiscal (NFC-e)', icon: Printer },
        { id: 'vendas', label: 'Vendas & PDV', icon: ShoppingCart },
        { id: 'estoque', label: 'Estoque', icon: Package },
        { id: 'ponto', label: 'Ponto & RH', icon: Clock },
        { id: 'sistema', label: 'Sistema & Segurança', icon: Shield },
        { id: 'sincronizacao', label: 'Sincronização Híbrida', icon: HardDrive },
        { id: 'assinatura', label: 'Assinatura', icon: CreditCard },
        { id: 'lojas', label: 'Meus Clientes', icon: Building2 },
    ];
    // Regras de Acesso: Gerente sem Estabelecimento/Sistema/Fiscal; níveis 3-6
    // só Geral e Minha Conta; plano Grátis limitado às abas do plano.
    const tabsVisiveis = getSettingsTabs(authService.getCurrentUser());
    const tabs = todasAsTabs.filter(t => tabsVisiveis.includes(t.id));

    // Se a aba ativa ficou fora da lista (troca de usuário/plano), volta para a primeira
    useEffect(() => {
        if (!tabs.some(t => t.id === activeTab)) {
            setActiveTab(tabs[0]?.id || 'geral');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tabsVisiveis.join(',')]);

    const loading = configLoading || loadingEstab;
    if (loading) {
        return (
            <div className="flex flex-col justify-center items-center h-screen gap-3 text-gray-500 dark:text-gray-400">
                <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <span>Carregando configurações...</span>
            </div>
        );
    }

    return (
        <div className="container mx-auto p-4 max-w-6xl">

            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-3xl font-bold text-gray-800 dark:text-white flex items-center gap-2">
                        <Settings className="w-8 h-8 text-blue-600" />
                        Configurações do Sistema
                    </h1>
                    <p className="text-gray-500 dark:text-gray-400 mt-1">Gerencie todos os parâmetros do seu ERP</p>
                </div>
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 shadow-lg"
                >
                    {saving ? <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div> : <Save className="w-5 h-5" />}
                    {saving ? 'Salvando...' : 'Salvar Alterações'}
                </button>
            </div>

            <div className="flex flex-col md:flex-row gap-6">
                {/* Sidebar de Abas */}
                <div className="w-full md:w-64 shrink-0">
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden sticky top-4">
                        {tabs.map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`w-full flex items-center gap-3 px-4 py-4 text-left transition-colors border-l-4 ${activeTab === tab.id
                                    ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border-blue-600'
                                    : 'text-gray-600 dark:text-gray-400 border-transparent hover:bg-gray-50 dark:hover:bg-gray-700'
                                    }`}
                            >
                                <tab.icon className="w-5 h-5" />
                                <span className="font-medium">{tab.label}</span>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Conteúdo Principal */}
                <div className="flex-1 space-y-6">

                    {/* ABA GERAL */}
                    {activeTab === 'geral' && (
                        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 space-y-6 animate-fadeIn">
                            <SectionTitle title="Aparência e Identidade" icon={Settings} />

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="col-span-2 flex items-center gap-4 p-4 border rounded-lg border-gray-200 dark:border-gray-700">
                                    <div className="w-20 h-20 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center overflow-hidden border border-gray-300 dark:border-gray-600 relative group">
                                        {config?.logo_url || config?.logo_base64 ? (
                                            <img
                                                src={
                                                    logoPreview ||
                                                    ((config?.logo_url?.startsWith('data:') || config?.logo_url?.startsWith('/'))
                                                        ? config.logo_url
                                                        : (config?.logo_base64 || '/assets/logo.png'))
                                                }
                                                alt={`Logo de ${estab.nome_fantasia || 'MercadinhoSys'}`}
                                                className="w-full h-full object-contain"
                                                onError={(e) => {
                                                    // Fallback definitivo caso o src falhe
                                                    const target = e.target as HTMLImageElement;
                                                    if (target.src !== window.location.origin + '/assets/logo.png') {
                                                        target.src = '/assets/logo.png';
                                                    }
                                                }}
                                            />
                                        ) : (
                                            <img
                                                src="/assets/logo.png"
                                                alt="Logo Padrão"
                                                className="w-full h-full object-contain opacity-50"
                                            />
                                        )}
                                        <div className="absolute inset-0 bg-black bg-opacity-50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                            <label className="cursor-pointer text-white text-xs text-center p-1">
                                                Alterar
                                                <input type="file" className="hidden" accept="image/*" onChange={handleLogoUpload} />
                                            </label>
                                        </div>
                                    </div>
                                    <div>
                                        <h4 className="font-medium text-gray-800 dark:text-white">Logo do Estabelecimento</h4>
                                        <p className="text-sm text-gray-500 dark:text-gray-400">Recomendado: 200x200px (PNG ou JPG)</p>
                                        <label className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded text-sm cursor-pointer transition-colors">
                                            <Upload className="w-4 h-4" /> Upload
                                            <input type="file" className="hidden" accept="image/*" onChange={handleLogoUpload} />
                                        </label>
                                    </div>
                                </div>

                                {/* Seletor de Cor Principal */}
                                <div className="col-span-2">
                                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                                        Cor Principal do Sistema
                                    </label>
                                    <div className="grid grid-cols-4 gap-3">
                                        {coresPredefinidas.map((cor) => (
                                            <button
                                                key={cor.valor}
                                                type="button"
                                                onClick={() => handleCorChange(cor.valor)}
                                                className={`relative p-4 rounded-lg border-2 transition-all hover:scale-105 ${config.cor_principal === cor.valor
                                                    ? 'border-gray-900 dark:border-white shadow-lg'
                                                    : 'border-gray-200 dark:border-gray-700'
                                                    }`}
                                                style={{ backgroundColor: cor.valor }}
                                            >
                                                <div className="absolute inset-0 flex items-center justify-center">
                                                    {config.cor_principal === cor.valor && (
                                                        <div className="w-6 h-6 bg-white rounded-full flex items-center justify-center">
                                                            <div className="w-3 h-3 bg-gray-900 rounded-full"></div>
                                                        </div>
                                                    )}
                                                </div>
                                                <span className="sr-only">{cor.nome}</span>
                                            </button>
                                        ))}
                                    </div>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                                        Cor selecionada: <span className="font-semibold">{coresPredefinidas.find(c => c.valor === config.cor_principal)?.nome || 'Personalizada'}</span>
                                    </p>
                                </div>

                                <div className="col-span-2">
                                    <SwitchField
                                        label="Modo Escuro"
                                        description="Ativar tema escuro por padrão (preferência pessoal)"
                                        checked={isDark}
                                        onChange={handleTemaChange}
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ABA ESTABELECIMENTO */}
                    {activeTab === 'estabelecimento' && (
                        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 space-y-6 animate-fadeIn">
                            <SectionTitle title="Dados da Empresa" icon={Building2} />
                            <p className="text-sm text-gray-500 dark:text-gray-400 -mt-2">
                                Preencha o CEP para buscar endereço automaticamente via ViaCEP.
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <InputField label="Nome Fantasia" value={estab.nome_fantasia} onChange={(e) => setEstab({ ...estab, nome_fantasia: e.target.value })} placeholder="Ex: Mercado do João" />
                                <InputField label="Razão Social" value={estab.razao_social} onChange={(e) => setEstab({ ...estab, razao_social: e.target.value })} placeholder="Ex: João Comércio Ltda" />
                                <InputField label="CNPJ" value={estab.cnpj} onChange={(e) => setEstab({ ...estab, cnpj: formatCnpj(e.target.value) })} placeholder="00.000.000/0000-00" />
                                <InputField label="Inscrição Estadual" value={estab.inscricao_estadual || ''} onChange={(e) => setEstab({ ...estab, inscricao_estadual: e.target.value })} placeholder="Opcional" />
                                <InputField label="Telefone" value={estab.telefone} onChange={(e) => setEstab({ ...estab, telefone: formatPhone(e.target.value) })} placeholder="(00) 00000-0000" />
                                <InputField label="E-mail" value={estab.email} onChange={(e) => setEstab({ ...estab, email: e.target.value })} type="email" placeholder="contato@empresa.com" />
                            </div>

                            <SectionTitle title="Endereço" icon={MapPin} />
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="md:col-span-1">
                                    <div className="flex flex-col space-y-1">
                                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">CEP</label>
                                        <div className="relative flex gap-2">
                                            <input
                                                type="text"
                                                placeholder="00000-000"
                                                value={estab.cep}
                                                onChange={(e) => setEstab({ ...estab, cep: formatCep(e.target.value) })}
                                                onBlur={handleCepBlur}
                                                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white transition-colors"
                                            />
                                            <button
                                                type="button"
                                                onClick={handleCepBlur}
                                                disabled={loadingCep || !estab.cep || estab.cep.replace(/\D/g, '').length !== 8}
                                                className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm text-sm font-medium whitespace-nowrap flex items-center gap-1"
                                            >
                                                {loadingCep ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <ShoppingCart className="w-4 h-4 rotate-90" />}
                                                Buscar
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                <div className="md:col-span-2">
                                    <InputField label="Logradouro" value={estab.logradouro} onChange={(e) => setEstab({ ...estab, logradouro: e.target.value })} placeholder="Rua, Avenida..." />
                                </div>
                                <InputField label="Número" value={estab.numero} onChange={(e) => setEstab({ ...estab, numero: e.target.value })} placeholder="Nº" />
                                <InputField label="Complemento" value={estab.complemento || ''} onChange={(e) => setEstab({ ...estab, complemento: e.target.value })} placeholder="Sala, Loja, etc." />
                                <InputField label="Bairro" value={estab.bairro} onChange={(e) => setEstab({ ...estab, bairro: e.target.value })} placeholder="Preenchido pelo CEP" />
                                <InputField label="Cidade" value={estab.cidade} onChange={(e) => setEstab({ ...estab, cidade: e.target.value })} placeholder="Preenchido pelo CEP" />
                                <InputField label="Estado (UF)" value={estab.estado} onChange={(e) => setEstab({ ...estab, estado: e.target.value.toUpperCase() })} placeholder="UF ou Estado" />
                            </div>
                        </div>
                    )}

                    {/* ABA MINHA CONTA */}
                    {activeTab === 'conta' && <AccountSettings />}

                    {/* ABA SEGMENTO & EXIBIÇÃO — nível Tenant do Motor de Renderização Contextual */}
                    {activeTab === 'segmento' && <SegmentSettings />}

                    {/* ABA VENDAS */}
                    {activeTab === 'fiscal' && (
                        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 space-y-6 animate-fadeIn">
                            <SectionTitle title="Emissão Fiscal (NFC-e / NF-e)" icon={Printer} />
                            <div className="rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 px-4 py-3 text-sm text-blue-700 dark:text-blue-300 mb-6">
                                <p className="mb-2">
                                    Em <strong>homologação</strong> a emissão é de teste (sem valor fiscal) e gratuita. Para produção, você precisará informar o Token da API e o CSC obtido na SEFAZ do seu estado.
                                </p>
                                <div className="p-3 bg-white dark:bg-gray-800 rounded border border-blue-200 dark:border-blue-700">
                                    <h4 className="font-bold mb-1">🔐 Certificado Digital A1 (e-CNPJ)</h4>
                                    <p>Para emitir notas reais, o sistema (através do Gateway Focus NFe) exige que você faça o upload do seu Certificado A1 diretamente no painel da Focus NFe. Ele assina digitalmente a nota com validade jurídica antes de transmitir para a SEFAZ. <strong>Sem o certificado configurado no seu Gateway, as notas de Produção serão rejeitadas.</strong></p>
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2">Regime Tributário</label>
                                    <select value={estab.regime_tributario || 'SIMPLES NACIONAL'} onChange={(e) => setEstab({ ...estab, regime_tributario: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white text-gray-900 dark:bg-gray-700 dark:text-white">
                                        <option value="SIMPLES NACIONAL">Simples Nacional</option>
                                        <option value="LUCRO PRESUMIDO">Lucro Presumido</option>
                                        <option value="LUCRO REAL">Lucro Real</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2">Ambiente</label>
                                    <select value={estab.fiscal_ambiente || 'homologacao'} onChange={(e) => setEstab({ ...estab, fiscal_ambiente: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white text-gray-900 dark:bg-gray-700 dark:text-white">
                                        <option value="homologacao">Homologação (teste, sem valor fiscal)</option>
                                        <option value="producao">Produção (valor fiscal real)</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2">Gateway de emissão</label>
                                    <select value={estab.fiscal_gateway || 'simulado'} onChange={(e) => setEstab({ ...estab, fiscal_gateway: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white text-gray-900 dark:bg-gray-700 dark:text-white">
                                        <option value="simulado">Simulado (desenvolvimento)</option>
                                        <option value="focusnfe">Focus NFe</option>
                                    </select>
                                </div>
                                <InputField label="Série NFC-e" type="number" value={estab.serie_nfce ?? 1} onChange={(e) => setEstab({ ...estab, serie_nfce: parseInt(e.target.value) || 1 })} />
                                <InputField label="Token do Gateway" value={estab.fiscal_token || ''} onChange={(e) => setEstab({ ...estab, fiscal_token: e.target.value })} placeholder="Token da API (Focus NFe)" />
                                <InputField label="CSC (Código de Segurança)" value={estab.fiscal_csc || ''} onChange={(e) => setEstab({ ...estab, fiscal_csc: e.target.value })} placeholder="Obtido na SEFAZ (NFC-e)" />
                                <InputField label="ID do CSC (idToken)" value={estab.fiscal_csc_id || ''} onChange={(e) => setEstab({ ...estab, fiscal_csc_id: e.target.value })} placeholder="Ex: 000001" />
                            </div>
                        </div>
                    )}

                    {activeTab === 'vendas' && (
                        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 space-y-6 animate-fadeIn">
                            <SectionTitle title="Ponto de Venda (PDV)" icon={ShoppingCart} />

                            <div className="flex justify-end">
                                <button
                                    type="button"
                                    onClick={() => setShortcutsOpen(true)}
                                    className="inline-flex items-center gap-2 px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors shadow-sm"
                                >
                                    <Keyboard className="w-4 h-4" />
                                    Atalhos do sistema
                                </button>
                            </div>

                            <div className="space-y-4">
                                <SwitchField
                                    label="Impressão Automática"
                                    description="Imprimir cupom automaticamente ao finalizar venda"
                                    checked={config.impressao_automatica}
                                    onChange={(val: boolean) => setConfig({ ...config, impressao_automatica: val })}
                                />

                                <SwitchField
                                    label="Exibir Preço na Tela"
                                    description="Mostrar preço unitário grande na tela de venda"
                                    checked={config.exibir_preco_tela}
                                    onChange={(val: boolean) => setConfig({ ...config, exibir_preco_tela: val })}
                                />

                                <SwitchField
                                    label="Mostrar Foto do Produto no PDV"
                                    description="Exibir thumbnail do item nos resultados de busca e seleção do caixa"
                                    checked={config.mostrar_foto_produto_pdv}
                                    onChange={(val: boolean) => setConfig({ ...config, mostrar_foto_produto_pdv: val })}
                                />

                                <SwitchField
                                    label="Permitir Venda Sem Estoque"
                                    description="Autorizar vendas mesmo com estoque zerado ou negativo"
                                    checked={config.permitir_venda_sem_estoque}
                                    onChange={(val: boolean) => setConfig({ ...config, permitir_venda_sem_estoque: val })}
                                />

                                <SwitchField
                                    label="Arredondamento de Valores"
                                    description="Arredondar centavos automaticamente no total"
                                    checked={config.arredondamento_valores}
                                    onChange={(val: boolean) => setConfig({ ...config, arredondamento_valores: val })}
                                />
                            </div>

                            <SectionTitle title="Notas Fiscais" icon={Printer} />
                            <div className="space-y-4">
                                <SwitchField
                                    label="Emitir NFC-e"
                                    description="Habilitar emissão de Nota Fiscal de Consumidor Eletrônica"
                                    checked={config.emitir_nfce}
                                    onChange={(val: boolean) => setConfig({ ...config, emitir_nfce: val })}
                                />
                                <SwitchField
                                    label="Emitir NF-e"
                                    description="Habilitar emissão de Nota Fiscal Eletrônica (Grande porte)"
                                    checked={config.emitir_nfe}
                                    onChange={(val: boolean) => setConfig({ ...config, emitir_nfe: val })}
                                />
                            </div>

                            <SectionTitle title="Limites e Descontos" icon={DollarSign} />
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <InputField
                                    label="Desconto Máximo (%)"
                                    type="number"
                                    value={config.desconto_maximo_percentual}
                                    onChange={(e) => setConfig({ ...config, desconto_maximo_percentual: parseFloat(e.target.value) })}
                                />
                                <InputField
                                    label="Desconto Máx. Funcionário (%)"
                                    type="number"
                                    value={config.desconto_maximo_funcionario}
                                    onChange={(e) => setConfig({ ...config, desconto_maximo_funcionario: parseFloat(e.target.value) })}
                                />
                            </div>

                            <SectionTitle title="Motivos de Estorno / Cancelamento" icon={ShoppingCart} />
                            <p className="text-sm text-gray-500 dark:text-gray-400 -mt-2">
                                Lista pré-definida exibida ao cancelar uma venda. O operador escolhe um motivo (exige PIN de admin).
                            </p>
                            <div className="space-y-3">
                                <div className="flex flex-wrap gap-2">
                                    {(config.motivos_estorno || []).map((motivo, idx) => (
                                        <span key={`${motivo}-${idx}`} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 text-sm font-medium">
                                            {motivo}
                                            <button
                                                type="button"
                                                onClick={() => setConfig({ ...config, motivos_estorno: config.motivos_estorno.filter((_, i) => i !== idx) })}
                                                className="text-blue-400 hover:text-red-500 font-bold"
                                                title="Remover"
                                            >
                                                ×
                                            </button>
                                        </span>
                                    ))}
                                    {(!config.motivos_estorno || config.motivos_estorno.length === 0) && (
                                        <span className="text-sm text-gray-400 italic">Nenhum motivo cadastrado.</span>
                                    )}
                                </div>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={novoMotivo}
                                        onChange={(e) => setNovoMotivo(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                const v = novoMotivo.trim();
                                                if (v && !(config.motivos_estorno || []).includes(v)) {
                                                    setConfig({ ...config, motivos_estorno: [...(config.motivos_estorno || []), v] });
                                                }
                                                setNovoMotivo('');
                                            }
                                        }}
                                        placeholder="Novo motivo (Enter para adicionar)"
                                        className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white text-gray-900 dark:bg-gray-700 dark:text-white text-sm"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const v = novoMotivo.trim();
                                            if (v && !(config.motivos_estorno || []).includes(v)) {
                                                setConfig({ ...config, motivos_estorno: [...(config.motivos_estorno || []), v] });
                                            }
                                            setNovoMotivo('');
                                        }}
                                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold"
                                    >
                                        Adicionar
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ABA ESTOQUE */}
                    {activeTab === 'estoque' && (
                        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 space-y-6 animate-fadeIn">
                            <SectionTitle title="Controle de Estoque" icon={Package} />

                            <div className="space-y-4">
                                <SwitchField
                                    label="Controlar Validade"
                                    description="Exigir data de validade para produtos perecíveis"
                                    checked={config.controlar_validade}
                                    onChange={(val: boolean) => setConfig({ ...config, controlar_validade: val })}
                                />

                                <SwitchField
                                    label="Alerta de Estoque Mínimo"
                                    description="Notificar quando produtos atingirem nível crítico"
                                    checked={config.alerta_estoque_minimo}
                                    onChange={(val: boolean) => setConfig({ ...config, alerta_estoque_minimo: val })}
                                />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                                <InputField
                                    label="Dias para Alerta de Validade"
                                    type="number"
                                    value={config.dias_alerta_validade}
                                    onChange={(e) => setConfig({ ...config, dias_alerta_validade: parseInt(e.target.value) })}
                                />
                                <InputField
                                    label="Estoque Mínimo Padrão"
                                    type="number"
                                    value={config.estoque_minimo_padrao}
                                    onChange={(e) => setConfig({ ...config, estoque_minimo_padrao: parseInt(e.target.value) })}
                                />
                            </div>
                        </div>
                    )}

                    {/* ABA PONTO & RH */}
                    {activeTab === 'ponto' && (
                        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 space-y-6 animate-fadeIn">
                            <SectionTitle title="Configurações de Ponto e Frequência" icon={Clock} />

                            <div className="space-y-4">
                                <SwitchField
                                    label="Exigir Foto no Ponto"
                                    description="Obrigatório tirar foto no registro de entrada/saída"
                                    checked={pontoConfig.exigir_foto ?? false}
                                    onChange={(val: boolean) => setPontoConfig({ ...pontoConfig, exigir_foto: val })}
                                />

                                <SwitchField
                                    label="Exigir Localização no Ponto"
                                    description="Validar localização do funcionário via GPS"
                                    checked={pontoConfig.exigir_localizacao ?? false}
                                    onChange={(val: boolean) => setPontoConfig({ ...pontoConfig, exigir_localizacao: val })}
                                />

                                <InputField
                                    label="Tolerância de Atraso (minutos)"
                                    type="number"
                                    value={pontoConfig.tolerancia_entrada ?? 5}
                                    onChange={(e) => setPontoConfig({ ...pontoConfig, tolerancia_entrada: parseInt(e.target.value) || 0 })}
                                />
                            </div>

                            {pontoConfig.exigir_localizacao && (
                                <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
                                    <p className="text-sm font-semibold text-blue-900 dark:text-blue-300 mb-4 flex items-center gap-2">
                                        <MapPin className="w-4 h-4" />
                                        Localização do Estabelecimento
                                    </p>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <InputField
                                            label="Latitude"
                                            type="number"
                                            step="0.000001"
                                            value={config.latitude_estabelecimento || ''}
                                            onChange={(e) => setConfig({ ...config, latitude_estabelecimento: parseFloat(e.target.value) })}
                                            placeholder="-23.550"
                                        />
                                        <InputField
                                            label="Longitude"
                                            type="number"
                                            step="0.000001"
                                            value={config.longitude_estabelecimento || ''}
                                            onChange={(e) => setConfig({ ...config, longitude_estabelecimento: parseFloat(e.target.value) })}
                                            placeholder="-46.633"
                                        />
                                        <InputField
                                            label="Raio de Validação (metros)"
                                            type="number"
                                            value={pontoConfig.raio_permitido_metros ?? 100}
                                            onChange={(e) => setPontoConfig({ ...pontoConfig, raio_permitido_metros: parseInt(e.target.value) || 0 })}
                                            placeholder="100"
                                        />
                                    </div>
                                    <button
                                        onClick={handleGetCurrentLocation}
                                        disabled={loadingGeolocation}
                                        className="mt-4 w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-sm disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                                    >
                                        {loadingGeolocation ? (
                                            <>
                                                <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"></div>
                                                Obtendo localização...
                                            </>
                                        ) : (
                                            <>
                                                📍 Usar Localização Atual
                                            </>
                                        )}
                                    </button>
                                </div>
                            )}

                            <SectionTitle title="Horários de Trabalho" icon={Clock} />

                            <div className="space-y-6">
                                <div className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="font-semibold text-gray-900 dark:text-gray-100">Horário de Entrada</p>
                                            <p className="text-xs text-gray-600 dark:text-gray-400">Início do expediente</p>
                                        </div>
                                        <input
                                            type="time"
                                            value={pontoConfig.hora_entrada || '08:00'}
                                            onChange={(e) => setPontoConfig({ ...pontoConfig, hora_entrada: e.target.value })}
                                            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-bold text-lg"
                                        />
                                    </div>
                                </div>

                                <div className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="font-semibold text-gray-900 dark:text-gray-100">Saída para Almoço</p>
                                            <p className="text-xs text-gray-600 dark:text-gray-400">Horário de pausa</p>
                                        </div>
                                        <input
                                            type="time"
                                            value={pontoConfig.hora_saida_almoco || '12:00'}
                                            onChange={(e) => setPontoConfig({ ...pontoConfig, hora_saida_almoco: e.target.value })}
                                            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-bold text-lg"
                                        />
                                    </div>
                                </div>

                                <div className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="font-semibold text-gray-900 dark:text-gray-100">Retorno do Almoço</p>
                                            <p className="text-xs text-gray-600 dark:text-gray-400">Volta da pausa</p>
                                        </div>
                                        <input
                                            type="time"
                                            value={pontoConfig.hora_retorno_almoco || '13:00'}
                                            onChange={(e) => setPontoConfig({ ...pontoConfig, hora_retorno_almoco: e.target.value })}
                                            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-bold text-lg"
                                        />
                                    </div>
                                </div>

                                <div className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="font-semibold text-gray-900 dark:text-gray-100">Horário de Saída</p>
                                            <p className="text-xs text-gray-600 dark:text-gray-400">Fim do expediente</p>
                                        </div>
                                        <input
                                            type="time"
                                            value={pontoConfig.hora_saida || '18:00'}
                                            onChange={(e) => setPontoConfig({ ...pontoConfig, hora_saida: e.target.value })}
                                            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-bold text-lg"
                                        />
                                    </div>
                                </div>

                                {/* Jornada diária normal (CLT). O que passar disso vira hora extra no espelho de ponto. */}
                                <div className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="font-semibold text-gray-900 dark:text-gray-100">Jornada Diária (horas)</p>
                                            <p className="text-xs text-gray-600 dark:text-gray-400">Limite legal por dia — CLT: 8h (até 44h/semana na escala 6x1). O que exceder vira hora extra.</p>
                                        </div>
                                        <input
                                            type="number"
                                            min={1}
                                            max={12}
                                            step={0.5}
                                            value={((pontoConfig.jornada_diaria_minutos ?? 480) / 60)}
                                            onChange={(e) => {
                                                const horas = parseFloat(e.target.value);
                                                setPontoConfig({ ...pontoConfig, jornada_diaria_minutos: Number.isFinite(horas) ? Math.round(horas * 60) : 480 });
                                            }}
                                            className="w-28 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-bold text-lg"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg border border-green-200 dark:border-green-800 text-sm text-green-800 dark:text-green-300">
                                <p className="font-semibold mb-2">💡 Dica</p>
                                <p>Estes horários e a jornada diária são usados pelo motor de ponto para calcular atrasos e horas extras no espelho de ponto de cada funcionário.</p>
                            </div>
                        </div>
                    )}

                    {/* ABA SISTEMA */}
                    {activeTab === 'sistema' && (
                        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 space-y-6 animate-fadeIn">
                            <SectionTitle title="Segurança" icon={Shield} />

                            {isTenantAdmin && (
                                <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4">
                                    <div className="flex items-center justify-between mb-2">
                                        <label className="text-sm font-bold text-gray-900 dark:text-white">PIN de Segurança (4 dígitos)</label>
                                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${temPin ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>
                                            {temPin ? 'Configurado' : 'Não configurado'}
                                        </span>
                                    </div>
                                    <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
                                        Autoriza operações sensíveis: estorno de venda, editar e descartar produtos.
                                        Somente administradores definem ou alteram este PIN.
                                    </p>
                                    <div className="flex flex-wrap items-center gap-4">
                                        <PinQuadrados value={pinForm} onChange={setPinForm} disabled={savingPin} />
                                        <button onClick={salvarPin} disabled={savingPin || pinForm.length !== 4}
                                            className="px-4 py-2 rounded-lg bg-amber-600 text-white font-bold text-sm hover:bg-amber-700 disabled:opacity-60 disabled:cursor-not-allowed">
                                            {savingPin ? 'Salvando...' : (temPin ? 'Alterar PIN' : 'Salvar PIN')}
                                        </button>
                                    </div>
                                </div>
                            )}

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="flex flex-col space-y-1">
                                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Tempo de Sessão (Logout por Inatividade)</label>
                                    <select
                                        value={config.tempo_sessao_minutos || 30}
                                        onChange={(e) => {
                                            const val = parseInt(e.target.value);
                                            setConfig({ ...config, tempo_sessao_minutos: val });
                                            // Also save to localStorage for the hook to read if it's not using ConfigContext
                                            localStorage.setItem('mercadinhosys_inactivity_timeout_min', val.toString());
                                            window.dispatchEvent(new Event('inactivity-settings-changed'));
                                        }}
                                        className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white transition-colors"
                                    >
                                        <option value={10}>10 minutos</option>
                                        <option value={20}>20 minutos</option>
                                        <option value={30}>30 minutos</option>
                                        <option value={40}>40 minutos</option>
                                    </select>
                                </div>
                                <InputField
                                    label="Tentativas de Senha antes do Bloqueio"
                                    type="number"
                                    value={config.tentativas_senha_bloqueio}
                                    onChange={(e) => setConfig({ ...config, tentativas_senha_bloqueio: parseInt(e.target.value) })}
                                />
                            </div>

                            <SectionTitle title="Notificações" icon={Bell} />
                            <div className="space-y-4">
                                <SwitchField
                                    label="Alertas por E-mail"
                                    description="Receber relatórios e alertas críticos por e-mail"
                                    checked={config.alertas_email}
                                    onChange={(val: boolean) => setConfig({ ...config, alertas_email: val })}
                                />
                                <SwitchField
                                    label="Alertas via WhatsApp"
                                    description="Integração para envio de alertas via WhatsApp"
                                    checked={config.alertas_whatsapp}
                                    onChange={(val: boolean) => setConfig({ ...config, alertas_whatsapp: val })}
                                />
                            </div>

                            <SectionTitle title="Banco & Replicação" icon={Database} />
                            <SyncPanel />
                        </div>
                    )}

                    {/* ABA SINCRONIZAÇÃO */}
                    {activeTab === 'sincronizacao' && (
                        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 space-y-6 animate-fadeIn">
                            <SyncDataButton />
                            <SyncManager />
                        </div>
                    )}

                    {/* ABA ASSINATURA */}
                    {activeTab === 'assinatura' && (
                        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 space-y-6 animate-fadeIn">
                            <SectionTitle title="Assinatura & Plano" icon={CreditCard} />
                            <SubscriptionSettings />
                        </div>
                    )}

                    {/* ABA MEUS CLIENTES (apenas super admin) */}
                    {activeTab === 'lojas' && (
                        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 space-y-6 animate-fadeIn">
                            <SectionTitle title="Meus Clientes" icon={Building2} />
                            <EstabelecimentosPanel />
                        </div>
                    )}

                </div>
            </div>

            <ShortcutsHelp open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
        </div>
    );
};

export default SettingsPage;

const SyncPanel: React.FC = () => {
    const [loading, setLoading] = useState(false);
    const [replicating, setReplicating] = useState(false);
    const [neonStatus, setNeonStatus] = useState<string>('desconhecido');
    const [localCounts, setLocalCounts] = useState<Record<string, number | null> | null>(null);
    const [remoteCounts, setRemoteCounts] = useState<Record<string, number | null> | null>(null);
    const models = [
        'estabelecimentos',
        'funcionarios',
        'clientes',
        'fornecedores',
        'categoria_produto',
        'produtos',
        'vendas',
        'venda_itens',
        'pagamentos',
        'movimentacoes_estoque',
        'despesas',
    ];
    const fetchHealth = async () => {
        try {
            setLoading(true);
            const resp = await apiClient.get('/sync/health');
            setNeonStatus(resp.data?.neon ?? 'desconhecido');
            setLocalCounts(resp.data?.local_counts ?? null);
            setRemoteCounts(resp.data?.remote_counts ?? null);
        } catch (e: unknown) {
            setNeonStatus('erro');
        } finally {
            setLoading(false);
        }
    };
    const replicar = async () => {
        try {
            setReplicating(true);
            await apiClient.post('/sync/replicar');
            await fetchHealth();
            showToast.success('Replicação concluída');
        } catch (e: unknown) {
            const error = e as { response?: { data?: { message?: string } } };
            showToast.error(error.response?.data?.message || 'Erro ao replicar');
        } finally {
            setReplicating(false);
        }
    };
    useEffect(() => {
        fetchHealth();
    }, []);
    return (
        <div className="space-y-4 p-4 border rounded-lg border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Database className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                    <span className="text-sm font-medium text-gray-800 dark:text-gray-200">Status do Neon</span>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={fetchHealth}
                        disabled={loading}
                        className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 rounded"
                    >
                        {loading ? 'Verificando...' : 'Verificar Status'}
                    </button>
                    <button
                        type="button"
                        onClick={replicar}
                        disabled={replicating || (neonStatus !== 'online' && !String(neonStatus).startsWith('offline'))}
                        className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
                    >
                        {replicating ? 'Replicando...' : 'Replicar agora'}
                    </button>
                </div>
            </div>
            <div className="text-sm text-gray-700 dark:text-gray-300">
                <div className="mb-2">
                    Status: <span className="font-semibold">{neonStatus}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <div className="font-semibold mb-1">Local</div>
                        <div className="space-y-1">
                            {models.map((m) => (
                                <div key={m} className="flex justify-between">
                                    <span className="text-xs">{m}</span>
                                    <span className="text-xs">{localCounts?.[m] ?? '-'}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div>
                        <div className="font-semibold mb-1">Neon</div>
                        <div className="space-y-1">
                            {models.map((m) => (
                                <div key={m} className="flex justify-between">
                                    <span className="text-xs">{m}</span>
                                    <span className="text-xs">{remoteCounts?.[m] ?? '-'}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
