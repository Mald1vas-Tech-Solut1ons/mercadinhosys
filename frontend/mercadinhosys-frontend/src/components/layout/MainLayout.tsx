import React from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { RefreshCw, Eye, Sparkles } from 'lucide-react';
import Sidebar from './Sidebar';
import HeaderProfessional from './HeaderProfessional';
import FootPage from './FootPage';
import BottomNavigation from './BottomNavigation';
import GlobalShortcuts from '../../shortcuts/GlobalShortcuts';
import BuscaGlobal from '../busca/BuscaGlobal';
import TrialNotice from '../../features/trial/TrialNotice';
import usePullToRefresh from '../../hooks/usePullToRefresh';
import { useSuperAdmin } from '../../contexts/SuperAdminContext';
import { useAuth } from '../../contexts/AuthContext';
import TourExecutivo from '../../features/onboarding/TourExecutivo';
import { RolagemContext } from '../../contexts/RolagemContext';
import useRecolherAoRolar from '../../hooks/useRecolherAoRolar';

const MirrorReadOnlyBanner: React.FC = () => {
    const { user } = useAuth();
    const { selectedTenantId, setSelectedTenantId } = useSuperAdmin();
    const espelhando = !!user?.is_super_admin && selectedTenantId !== 'all';
    if (!espelhando) return null;
    return (
        <div className="flex items-center justify-between gap-3 px-4 py-2 bg-amber-500 text-amber-950 text-xs sm:text-sm font-semibold shadow-sm">
            <span className="flex items-center gap-2 min-w-0">
                <Eye className="w-4 h-4 shrink-0" />
                <span className="truncate">Modo espelho (super admin) — visualizando a loja #{selectedTenantId} em <b>somente leitura</b>.</span>
            </span>
            <button
                onClick={() => { setSelectedTenantId('all'); window.location.reload(); }}
                className="shrink-0 px-3 py-1 rounded-lg bg-amber-950/90 text-amber-50 hover:bg-amber-950 transition-colors"
            >
                Sair do espelho
            </button>
        </div>
    );
};

/** Faixa da demonstração da landing: o visitante vê tudo, mas não altera (bloqueio no backend). */
const DemoBanner: React.FC = () => {
    const { user } = useAuth();
    if (!(user as { is_demo?: boolean } | null)?.is_demo) return null;
    return (
        <div className="flex items-center justify-between gap-3 px-4 py-2 bg-[#FFD43B] text-[#0A1220] text-xs sm:text-sm font-semibold shadow-sm">
            <span className="min-w-0 truncate">Você está na demonstração: dá para ver tudo, mas não para alterar.</span>
            <a href="/register" className="shrink-0 px-3 py-1 rounded-lg bg-[#0A1220] text-white font-bold">Criar conta grátis</a>
        </div>
    );
};

const MainLayout: React.FC = () => {
    const [isCollapsed, setIsCollapsed] = React.useState(false);
    const mainRef = React.useRef<HTMLElement>(null);
    const location = useLocation();
    const navigate = useNavigate();
    const emPdv = location.pathname.startsWith('/pdv');
    const emConsultor = location.pathname.startsWith('/consultor');
    // PWA standalone não tem "puxar p/ atualizar" nativo — implementamos aqui.
    // Fora do PDV (recarregar no meio da venda perde o carrinho) e do Consultor (perde a conversa).
    const { distance, refreshing, threshold } = usePullToRefresh(
        mainRef,
        () => window.location.reload(),
        { enabled: !emPdv && !emConsultor },
    );
    const prontoParaSoltar = distance >= threshold;
    // Descendo a página, as barras saem de cena e a informação ocupa a tela; subindo, voltam.
    const recolhido = useRecolherAoRolar(mainRef, !emPdv && !emConsultor);
    const rolagem = React.useMemo(() => ({ recolhido }), [recolhido]);

    return (
        <RolagemContext.Provider value={rolagem}>
        <div className="flex h-dvh bg-gray-50 dark:bg-gray-900 overflow-hidden">
            <GlobalShortcuts />
            <BuscaGlobal />
            <TrialNotice />
            
            <TourExecutivo />
            
            <Sidebar isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} />
            <div className="flex-1 flex flex-col h-full overflow-hidden transition-all duration-300 min-w-0 min-h-0">
                {/* No celular o cabeçalho recolhe ao descer a página (grid 1fr → 0fr anima a altura). */}
                <div className={`grid shrink-0 transition-[grid-template-rows] duration-300 ${recolhido ? 'max-md:grid-rows-[0fr]' : 'grid-rows-[1fr]'}`}>
                    <div className={`min-h-0 ${recolhido ? 'max-md:overflow-hidden' : ''}`}>
                        <HeaderProfessional />
                    </div>
                </div>
                <MirrorReadOnlyBanner />
                <DemoBanner />
                {/* On mobile, add padding bottom equal to the bottom navigation height (approx 4rem = 64px) plus safe area.
                    No Consultor a conversa ocupa a tela toda (modo foco): sem barra de baixo nem rodapé,
                    e o próprio chat cuida da área segura do celular. */}
                <main
                    ref={mainRef}
                    className={`relative flex-1 overflow-x-hidden min-h-0 ${
                        emConsultor
                            ? 'overflow-hidden p-0 md:p-4'
                            : 'overflow-y-auto p-4 md:p-6 pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-6'
                    }`}
                >
                    {/* Indicador de pull-to-refresh (mobile) */}
                    {(distance > 0 || refreshing) && (
                        <div
                            className="md:hidden absolute left-0 right-0 top-0 flex items-center justify-center pointer-events-none z-10"
                            style={{ height: distance || threshold, opacity: Math.min(1, distance / threshold || 1) }}
                        >
                            <RefreshCw
                                className={`w-6 h-6 text-primary-600 ${refreshing ? 'animate-spin' : ''}`}
                                style={{ transform: refreshing ? undefined : `rotate(${distance * 3}deg)` }}
                            />
                            <span className="ml-2 text-xs font-medium text-gray-500 dark:text-gray-400">
                                {refreshing ? 'Atualizando...' : prontoParaSoltar ? 'Solte para atualizar' : 'Puxe para atualizar'}
                            </span>
                        </div>
                    )}
                    <Outlet />
                    {/* Rodapé no fim do conteúdo (só no computador): não come altura fixa da tela. */}
                    {!emPdv && !emConsultor && (
                        <div className="hidden md:block -mx-6 -mb-6 mt-10">
                            <FootPage />
                        </div>
                    )}
                </main>
            </div>
            {!emPdv && !emConsultor && (
                <button
                    type="button"
                    onClick={() => navigate('/consultor')}
                    title="Abrir Consultor da Loja (Ajuda do Sistema, Cadastro Assistido e Relatórios)"
                    className={`fixed ${recolhido ? 'bottom-4' : 'bottom-20'} md:bottom-6 right-4 md:right-6 z-40 flex items-center gap-2 px-4 py-2.5 rounded-full bg-linear-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white text-xs font-bold shadow-lg hover:shadow-xl transition-all`}
                >
                    <Sparkles className="w-4 h-4" />
                    <span className="hidden sm:inline">Consultor da Loja</span>
                </button>
            )}
            {!emConsultor && <BottomNavigation recolhida={recolhido} />}
        </div>
        </RolagemContext.Provider>
    );
};

export default MainLayout;
