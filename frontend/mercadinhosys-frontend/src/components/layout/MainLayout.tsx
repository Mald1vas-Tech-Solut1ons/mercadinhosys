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

const MainLayout: React.FC = () => {
    const [isCollapsed, setIsCollapsed] = React.useState(false);
    const mainRef = React.useRef<HTMLElement>(null);
    const location = useLocation();
    const navigate = useNavigate();
    // PWA standalone não tem "puxar p/ atualizar" nativo — implementamos aqui.
    const { distance, refreshing, threshold } = usePullToRefresh(
        mainRef,
        () => window.location.reload(),
    );
    const prontoParaSoltar = distance >= threshold;
    const emPdv = location.pathname.startsWith('/pdv');
    const emConsultor = location.pathname.startsWith('/consultor');

    return (
        <div className="flex h-screen bg-gray-50 dark:bg-gray-900 overflow-hidden">
            <GlobalShortcuts />
            <BuscaGlobal />
            <TrialNotice />
            
            <TourExecutivo />
            
            <Sidebar isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} />
            <div className="flex-1 flex flex-col h-full overflow-hidden transition-all duration-300 min-w-0 min-h-0">
                <HeaderProfessional />
                <MirrorReadOnlyBanner />
                {/* On mobile, add padding bottom equal to the bottom navigation height (approx 4rem = 64px) plus safe area */}
                <main ref={mainRef} className="relative flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6 pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-6 min-h-0">
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
                </main>
                {/* Desktop Footer (Hidden on mobile to avoid clutter; no PDV o caixa precisa da altura toda) */}
                <div className={emPdv ? 'hidden' : 'hidden md:block'}>
                    <FootPage />
                </div>
            </div>
            {!emPdv && !emConsultor && (
                <button
                    type="button"
                    onClick={() => navigate('/consultor')}
                    title="Abrir Consultor da Loja (Ajuda do Sistema, Cadastro Assistido e Relatórios)"
                    className="fixed bottom-20 md:bottom-6 right-4 md:right-6 z-40 flex items-center gap-2 px-4 py-2.5 rounded-full bg-linear-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white text-xs font-bold shadow-lg hover:shadow-xl transition-all"
                >
                    <Sparkles className="w-4 h-4" />
                    <span className="hidden sm:inline">Consultor da Loja</span>
                </button>
            )}
            <BottomNavigation />
        </div>
    );
};

export default MainLayout;
