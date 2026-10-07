import React, { useEffect, useState } from 'react';
import { CreditCard, Calendar, CheckCircle2, ShieldCheck, Zap, ArrowRight, ExternalLink, RefreshCcw, Star } from 'lucide-react';
import settingsService, { SubscriptionStatus } from './settingsService';
import { showToast } from '../../utils/toast';

const SubscriptionSettings: React.FC = () => {
    const [status, setStatus] = useState<SubscriptionStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);

    const loadStatus = async (silent = false) => {
        try {
            if (!silent) setLoading(true);
            const statusData = await settingsService.getSubscriptionStatus();

            // Caso o backend retorne aliases legados, normalizamos aqui também para a UI
            const search = (statusData.plano || '').toLowerCase();
            const isPro = ['pro', 'pago', 'premium', 'elite', 'advanced', 'enterprise', 'master', 'profissional', 'professional'].some(p => search.includes(p));
            const displayPlano = isPro ? 'Pro' : 'Gratuito';

            setStatus({
                ...statusData,
                plano: displayPlano
            });
        } catch (error) {
            console.error("Erro ao carregar assinatura:", error);
            // Fallback para dados locais se o endpoint de SaaS estiver offline
            const userData = sessionStorage.getItem('user_data');
            if (userData) {
                const user = JSON.parse(userData);
                setStatus({
                    plano: user.plano === 'Pro' ? 'Pro' : 'Gratuito',
                    status: 'ativo',
                    vencimento: null,
                    is_active: true
                });
            } else {
                if (!silent) showToast.error("Falha ao recuperar dados da assinatura.");
            }
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadStatus();
    }, []);

    const formatDate = (dateString: string | null) => {
        if (!dateString) return 'Assinatura Vitalícia';
        return new Date(dateString).toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: 'long',
            year: 'numeric'
        });
    };

    const handleAction = async (planName: string) => {
        try {
            setProcessing(true);
            showToast.info("Iniciando checkout seguro...");
            const response = await settingsService.createCheckoutSession(planName);
            if (response.checkout_url) {
                window.location.href = response.checkout_url;
            }
        } catch {
            showToast.error("Erro ao iniciar processamento de pagamento.");
        } finally {
            setProcessing(false);
        }
    };

    const handlePortal = async () => {
        try {
            setProcessing(true);
            showToast.info("Redirecionando para portal financeiro...");
            const response = await settingsService.openPortal();
            if (response.portal_url) {
                window.location.href = response.portal_url;
            }
        } catch {
            showToast.error("Erro ao acessar portal de faturamento.");
        } finally {
            setProcessing(false);
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-32 space-y-6">
                <div className="relative">
                    <div className="w-16 h-16 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                        <Zap className="w-6 h-6 text-primary animate-pulse" />
                    </div>
                </div>
                <p className="text-sm font-black text-gray-400 uppercase tracking-[0.3em] animate-pulse">Sincronizando Cloud</p>
            </div>
        );
    }

    if (!status) {
        return (
            <div className="max-w-xl mx-auto mt-20 p-12 bg-white dark:bg-gray-900 rounded-[3rem] border border-gray-100 dark:border-gray-800 shadow-2xl text-center">
                <div className="w-20 h-20 bg-red-50 dark:bg-red-900/20 rounded-3xl flex items-center justify-center mx-auto mb-8">
                    <ShieldCheck className="w-10 h-10 text-red-500" />
                </div>
                <h2 className="text-3xl font-black text-gray-900 dark:text-white mb-4">Falha de Autenticação</h2>
                <p className="text-gray-500 dark:text-gray-400 mb-10 font-medium">Não foi possível validar sua licença com o servidor central.</p>
                <button onClick={() => loadStatus()} className="w-full py-5 bg-gray-900 dark:bg-white dark:text-gray-900 text-white rounded-2xl font-black hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-3">
                    <RefreshCcw className="w-5 h-5" /> REENTRAR NO SISTEMA
                </button>
            </div>
        );
    }

    const isActive = status.is_active;
    const isExperimental = status.status === 'experimental';

    return (
        <div className="max-w-6xl mx-auto py-10 space-y-12 animate-in fade-in zoom-in-95 duration-700">
            {/* HERO SECTION PREMIUM */}
            <div className="relative overflow-hidden bg-gray-900 dark:bg-black rounded-[4rem] p-12 lg:p-20 border border-white/10 shadow-3xl">
                {/* Efeito Visual de Fundo */}
                <div className="absolute top-0 right-0 w-1/2 h-full bg-linear-to-l from-primary/10 to-transparent blur-3xl opacity-50"></div>
                <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-primary/20 rounded-full blur-[120px] opacity-30"></div>

                <div className="relative z-10 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
                    <div>
                        <div className="flex items-center gap-4 mb-10">
                            <div className={`px-6 py-2 rounded-full text-[11px] font-black uppercase tracking-[0.25em] ${isActive ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                                {isActive ? '● Conta Ativa' : '● Conta Expirada'}
                            </div>
                            {isExperimental && (
                                <div className="px-6 py-2 rounded-full text-[11px] font-black uppercase tracking-[0.25em] bg-blue-500/10 text-primary border border-primary/20">
                                    Trial Mode
                                </div>
                            )}
                        </div>

                        <h1 className="text-5xl lg:text-7xl font-black text-white leading-[1.1] tracking-tighter mb-8">
                            Seu Plano: <br />
                            <span className="text-transparent bg-clip-text bg-linear-to-r from-primary via-blue-400 to-indigo-400">
                                {status.plano}
                            </span>
                        </h1>

                        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-8 mb-12">
                            <div className="space-y-2">
                                <p className="text-[10px] font-bold text-white/30 uppercase tracking-[0.2em]">Data de Expiração</p>
                                <div className="flex items-center gap-3 text-white/80">
                                    <Calendar className="w-6 h-6 text-primary/60" />
                                    <span className="text-xl font-black tracking-tight">{formatDate(status.vencimento)}</span>
                                </div>
                            </div>
                            <div className="w-px h-12 bg-white/10 hidden sm:block"></div>
                            <div className="space-y-2">
                                <p className="text-[10px] font-bold text-white/30 uppercase tracking-[0.2em]">ID Estalecimento</p>
                                <div className="flex items-center gap-3 text-white/80">
                                    <ShieldCheck className="w-6 h-6 text-primary/60" />
                                    <span className="text-xl font-black tracking-tight whitespace-nowrap overflow-hidden text-ellipsis max-w-[150px]">
                                        Verified System
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-wrap gap-5">
                            {!isExperimental && isActive ? (
                                <button
                                    onClick={handlePortal}
                                    disabled={processing}
                                    className="px-10 py-5 bg-white text-black rounded-3xl font-black text-sm hover:scale-105 transition-all flex items-center gap-3 shadow-2xl shadow-white/10 disabled:opacity-50"
                                >
                                    Portal Financeiro <ExternalLink className="w-5 h-5" />
                                </button>
                            ) : (
                                <button
                                    onClick={() => handleAction('Pro')}
                                    disabled={processing}
                                    className="px-12 py-6 bg-primary text-white rounded-3xl font-black text-lg hover:scale-105 hover:brightness-110 transition-all flex items-center gap-3 shadow-3xl shadow-primary/30 disabled:opacity-50"
                                >
                                    Fazer Upgrade <Zap className="w-6 h-6 fill-current" />
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="hidden lg:grid grid-cols-2 gap-4">
                        {[
                            { icon: CheckCircle2, label: 'Emissões Fiscais' },
                            { icon: Zap, label: 'Velocidade Cloud' },
                            { icon: ShieldCheck, label: 'Backup VIP' },
                            { icon: Star, label: 'Suporte Elite' }
                        ].map((card, i) => (
                            <div key={i} className="bg-white/5 backdrop-blur-xl border border-white/10 p-8 rounded-[2.5rem] flex flex-col items-center justify-center text-center space-y-4 hover:bg-white/10 transition-colors">
                                <card.icon className="w-10 h-10 text-primary" />
                                <span className="text-xs font-black text-white/60 uppercase tracking-widest">{card.label}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* PRICING GRID ELITE */}
            <div className="py-20 text-center space-y-20">
                <div className="space-y-4">
                    <h2 className="text-4xl lg:text-5xl font-black text-gray-900 dark:text-white tracking-tighter">Planos MercadinhoSys</h2>
                    <p className="text-gray-500 dark:text-gray-400 font-bold uppercase tracking-[0.2em] text-sm">Escalabilidade profissional para o seu negócio</p>
                </div>

                <div className="flex justify-center max-w-5xl mx-auto px-6">
                    {/* PLANO PRO ÚNICO */}
                    <div className="bg-gray-900 p-14 rounded-[4rem] shadow-4xl shadow-primary/20 relative scale-105 border-2 border-primary overflow-hidden max-w-md w-full">
                        <div className="absolute top-0 right-14 -translate-y-1/2 bg-primary text-white text-[11px] font-black uppercase tracking-[0.3em] px-8 py-3 rounded-full shadow-xl">Plano Único</div>

                        <div className="mb-10 text-left">
                            <h3 className="text-3xl font-black text-white italic mb-2">Pro</h3>
                            <p className="text-xs font-black text-white/40 uppercase tracking-widest">Acesso completo ao sistema</p>
                        </div>

                        <div className="mb-12 text-left">
                            <div className="flex items-baseline gap-2">
                                <span className="text-7xl font-black text-white tracking-tight">R$99,90</span>
                                <span className="text-white/40 font-bold uppercase tracking-widest text-xs">/mês</span>
                            </div>
                        </div>

                        <button
                            onClick={() => handleAction('Pro')}
                            disabled={processing}
                            className="w-full py-6 bg-primary text-white rounded-4xl font-black text-lg hover:scale-[1.03] hover:brightness-110 active:scale-[0.98] transition-all duration-300 mb-12 shadow-3xl shadow-primary/40 disabled:opacity-50"
                        >
                            Assinar Pro <ArrowRight className="w-6 h-6 ml-2" />
                        </button>

                        <div className="space-y-5 text-left">
                            {[
                                'Terminais PDV Híbridos',
                                'Gestão Multi-Estabelecimento',
                                'Dashboard Científico (IA & RFM)',
                                'Backup em Tempo Real na Nuvem',
                                'Suporte Suporte VIP WhatsApp'
                            ].map(f => (
                                <div key={f} className="flex items-center gap-4 text-sm font-bold text-white">
                                    <CheckCircle2 className="w-6 h-6 text-primary shrink-0" /> {f}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* EFI SECURITY NOTE */}
            <div className="pt-20 border-t border-gray-100 dark:border-gray-800 text-center space-y-8 relative">

                <div className="flex flex-col items-center gap-4 opacity-40 grayscale filter hover:grayscale-0 transition-all duration-700">
                    <img src="https://sejaefi.com.br/wp-content/uploads/2023/02/efi-bank.png" className="h-10 w-auto rounded-lg hidden dark:block" alt="Efí Bank" />
                    <img src="https://sejaefi.com.br/wp-content/uploads/2023/02/efi-bank.png" className="h-6 w-auto dark:hidden" alt="Efí Bank" />
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.4em]">Powered by Efí Bank</p>
                </div>
                <div className="flex justify-center gap-12 text-gray-400">
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest">
                        <ShieldCheck className="w-4 h-4" /> SSL Encryption
                    </div>
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest">
                        <CreditCard className="w-4 h-4" /> PCI Compliant
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SubscriptionSettings;
