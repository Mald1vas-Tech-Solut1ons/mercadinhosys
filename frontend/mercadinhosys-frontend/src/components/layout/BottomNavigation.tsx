import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Home, ShoppingCart, Users, Package, Menu as MenuIcon, X, LogOut, Settings, CreditCard, BarChart3, Navigation, FileText, Briefcase, UserCog, Clock, Truck, Receipt, DollarSign, Building2, Activity, Target, MapPin, ShoppingBag, Play } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import EstablishmentSelector from '../EstablishmentSelector';
import { authService } from '../../features/auth/authService';
import { canAccessRoute } from '../../utils/permissions';

const mainTabs = [
    { to: '/dashboard', icon: Home, label: 'Início' },
    { to: '/pdv', icon: ShoppingCart, label: 'PDV' },
    { to: '/customers', icon: Users, label: 'Clientes' },
    { to: '/products', icon: Package, label: 'Produtos' },
];

const allMenuItems = [
    { to: '/pdv?manage=true', icon: DollarSign, label: 'Caixa' },
    { to: '/compras', icon: ShoppingBag, label: 'Compras & Doca' },
    { to: '/sales', icon: CreditCard, label: 'Vendas' },
    { to: '/sfa', icon: MapPin, label: 'SFA (Externo)' },
    { to: '/sfa/gestao', icon: MapPin, label: 'Gestão SFA' },
    { to: '/delivery', icon: Navigation, label: 'Entregas' },
    { to: '/fiscal', icon: Receipt, label: 'Fiscal' },
    { to: '/expenses', icon: FileText, label: 'Despesas' },
    { to: '/reports', icon: BarChart3, label: 'Relatórios' },
    { to: '/suppliers', icon: Truck, label: 'Fornecedores' },
    { to: '/employees', icon: UserCog, label: 'Equipe' },
    { to: '/rh', icon: Briefcase, label: 'RH' },
    { to: '/ponto', icon: Clock, label: 'Ponto' },
    { to: '/auditoria', icon: Activity, label: 'Auditoria' },
];

const superAdminItems = [
    { to: '/estabelecimentos', icon: Building2, label: 'SaaS Lojas' },
    { to: '/monitor', icon: Activity, label: 'Monitor' },
    { to: '/leads', icon: Target, label: 'Leads' },
];

const BottomNavigation: React.FC = () => {
    const [menuOpen, setMenuOpen] = useState(false);
    const { logout, user } = useAuth();
    const navigate = useNavigate();

    // Regras de Acesso centralizadas (mesma fonte da Sidebar)
    const currentUser = authService.getCurrentUser();
    const podeVer = (rota: string) =>
        currentUser?.is_super_admin || canAccessRoute(rota, currentUser);
    const visibleMainTabs = mainTabs.filter(tab => podeVer(tab.to));
    const visibleMenuItems = allMenuItems.filter(item => podeVer(item.to));

    const handleLogout = () => {
        setMenuOpen(false);
        logout();
        navigate('/login');
    };

    return (
        <>
            {/* Espaçador para não cobrir o conteúdo (pb-20 é adicionado no MainLayout) */}
            
            {/* Bottom Nav Bar */}
            <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 z-40 px-2 pb-[env(safe-area-inset-bottom)] shadow-[0_-5px_15px_-5px_rgba(0,0,0,0.1)]">
                <div className="flex justify-around items-center h-16">
                    {visibleMainTabs.map((tab) => (
                        <NavLink
                            key={tab.to}
                            to={tab.to}
                            onClick={() => setMenuOpen(false)}
                            className={({ isActive }) =>
                                `flex flex-col items-center justify-center w-16 h-full transition-colors ${
                                    isActive
                                        ? 'text-blue-600 dark:text-blue-400'
                                        : 'text-gray-500 dark:text-gray-400 hover:text-blue-500'
                                }`
                            }
                        >
                            {({ isActive }) => (
                                <>
                                    <tab.icon className={`w-6 h-6 mb-1 ${isActive ? 'fill-blue-50 dark:fill-blue-900/30' : ''}`} strokeWidth={isActive ? 2.5 : 2} />
                                    <span className={`text-[10px] font-semibold ${isActive ? 'opacity-100' : 'opacity-80'}`}>{tab.label}</span>
                                </>
                            )}
                        </NavLink>
                    ))}

                    <button
                        onClick={() => setMenuOpen(!menuOpen)}
                        className={`flex flex-col items-center justify-center w-16 h-full transition-colors ${
                            menuOpen ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400'
                        }`}
                    >
                        {menuOpen ? <X className="w-6 h-6 mb-1" strokeWidth={2.5} /> : <MenuIcon className="w-6 h-6 mb-1" strokeWidth={2} />}
                        <span className={`text-[10px] font-semibold ${menuOpen ? 'opacity-100' : 'opacity-80'}`}>Mais</span>
                    </button>
                </div>
            </div>

            {/* Bottom Sheet Menu */}
            {menuOpen && (
                <>
                    <div 
                        className="md:hidden fixed inset-0 bg-black/60 z-35 backdrop-blur-sm transition-opacity"
                        onClick={() => setMenuOpen(false)}
                    />
                    <div className="md:hidden fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] left-0 right-0 bg-white dark:bg-gray-900 rounded-t-3xl z-40 p-5 shadow-2xl max-h-[80vh] overflow-y-auto animate-in slide-in-from-bottom-full duration-300 ease-out">
                        <div className="flex items-center gap-3 mb-6 p-2 bg-slate-50 dark:bg-gray-800/50 rounded-2xl">
                            {user?.foto_url ? (
                                <img src={user.foto_url} alt={user.nome || ''} className="w-12 h-12 rounded-full object-cover border-2 border-white dark:border-gray-700 shadow-sm" />
                            ) : (
                                <div className="w-12 h-12 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-lg shadow-md">
                                    {user?.nome ? user.nome.charAt(0).toUpperCase() : 'U'}
                                </div>
                            )}
                            <div className="flex-1">
                                <h4 className="font-extrabold text-gray-900 dark:text-white leading-tight">{user?.nome || 'Usuário'}</h4>
                                <p className="text-xs text-blue-600 dark:text-blue-400 font-semibold">{user?.role || 'Admin'}</p>
                            </div>
                        </div>

                        {user?.is_super_admin && (
                            <div className="mb-6 px-1">
                                <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Modo Super-Admin</p>
                                <EstablishmentSelector className="w-full justify-between" />
                            </div>
                        )}

                        <div className="grid grid-cols-4 gap-y-6 gap-x-2 mb-6">
                            {(user?.is_super_admin ? [...visibleMenuItems, ...superAdminItems] : visibleMenuItems).map((item) => {
                                return (
                                    <NavLink
                                        key={item.to}
                                        to={item.to}
                                        onClick={() => setMenuOpen(false)}
                                        className={({ isActive }) =>
                                            `flex flex-col items-center gap-2 ${
                                                isActive ? 'text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-300'
                                            }`
                                        }
                                    >
                                        <div className="w-14 h-14 rounded-2xl bg-gray-50 dark:bg-gray-800 flex items-center justify-center active:scale-95 transition-transform shadow-sm border border-gray-100 dark:border-gray-700">
                                            <item.icon className="w-6 h-6" strokeWidth={1.5} />
                                        </div>
                                        <span className="text-[10px] font-bold text-center leading-tight px-1">{item.label}</span>
                                    </NavLink>
                                )
                            })}
                        </div>

                        <div className="border-t border-gray-100 dark:border-gray-800 pt-4 flex gap-3">
                            <button
                                onClick={() => {
                                    setMenuOpen(false);
                                    window.dispatchEvent(new CustomEvent('start-tour'));
                                }}
                                className="flex-1 py-3 px-2 rounded-xl bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-bold text-xs sm:text-sm flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 active:scale-95 transition-transform"
                            >
                                <Play className="w-4 h-4" /> Tour & Ajuda
                            </button>
                            <button
                                onClick={() => {
                                    setMenuOpen(false);
                                    navigate('/settings');
                                }}
                                className="flex-1 py-3 px-2 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 font-bold text-xs sm:text-sm flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 active:scale-95 transition-transform"
                            >
                                <Settings className="w-4 h-4" /> Ajustes
                            </button>
                            <button
                                onClick={handleLogout}
                                className="flex-1 py-3 px-2 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 font-bold text-xs sm:text-sm flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 active:scale-95 transition-transform"
                            >
                                <LogOut className="w-4 h-4" /> Sair
                            </button>
                        </div>
                    </div>
                </>
            )}
        </>
    );
};

export default BottomNavigation;
