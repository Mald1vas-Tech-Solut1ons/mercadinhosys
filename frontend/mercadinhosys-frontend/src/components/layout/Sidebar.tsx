import React from 'react';
import { NavLink } from 'react-router-dom';
import {
    Home,
    Package,
    Users,
    ShoppingCart,
    BarChart3,
    Settings,
    CreditCard,
    UserCog,
    FileText,
    Truck,
    Clock,
    Briefcase,
    ChevronLeft,
    ChevronRight,
    DollarSign,
    Building2,
    Target,
    Activity,
    Navigation,
    Receipt,
    MapPin,
    ShoppingBag,
    Sparkles,
    Play,
    Database
} from 'lucide-react';
import { authService } from '../../features/auth/authService';
import { canAccessRoute } from '../../utils/permissions';

const menuItems = [
    { to: '/dashboard', icon: Home, label: 'Dashboard' },
    { to: '/consultor', icon: Sparkles, label: 'Consultor M-IA' },
    { to: '/pdv', icon: ShoppingCart, label: 'PDV' },
    { to: '/pdv?manage=true', icon: DollarSign, label: 'Gerenciar Caixa' },
    { to: '/products', icon: Package, label: 'Produtos' },
    { to: '/compras', icon: ShoppingBag, label: 'Compras & Doca' },
    { to: '/suppliers', icon: Truck, label: 'Fornecedores' },
    { to: '/customers', icon: Users, label: 'Clientes' },
    { to: '/sales', icon: CreditCard, label: 'Vendas' },
    { to: '/sfa', icon: MapPin, label: 'Força de Vendas' },
    { to: '/sfa/gestao', icon: MapPin, label: 'Gestão SFA' },
    { to: '/delivery', icon: Navigation, label: 'Logística & Entregas' },
    { to: '/expenses', icon: FileText, label: 'Despesas' },
    { to: '/fiscal', icon: Receipt, label: 'Fiscal' },
    { to: '/auditoria', icon: Activity, label: 'Auditoria' },
    { to: '/employees', icon: UserCog, label: 'Funcionários' },
    { to: '/rh', icon: Briefcase, label: 'RH & Ponto' },
    { to: '/ponto', icon: Clock, label: 'Controle de Ponto' },
    { to: '/reports', icon: BarChart3, label: 'Relatórios' },
    { to: '/settings', icon: Settings, label: 'Configurações' },
    { to: '/estabelecimentos', icon: Building2, label: 'Estabelecimentos' },
    { to: '/monitor', icon: Activity, label: 'Monitor Sistema' },
    { to: '/leads', icon: Target, label: 'Leads SaaS' },
    { to: '/catalogo-mestre', icon: Database, label: 'Catálogo Mestre' },
];

interface SidebarProps {
    isCollapsed: boolean;
    setIsCollapsed: (collapsed: boolean) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ isCollapsed, setIsCollapsed }) => {
    return (
        <aside className={`hidden md:block bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 h-full overflow-y-auto custom-scrollbar transition-all duration-300 ${isCollapsed ? 'w-20' : 'w-64'}`}>
            <div className="p-4 flex justify-end">
                <button
                    onClick={() => setIsCollapsed(!isCollapsed)}
                    className="p-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                    title={isCollapsed ? "Expandir menu" : "Recolher menu"}
                >
                    {isCollapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
                </button>
            </div>
            <nav className="px-4 pb-4">
                <ul className="space-y-2">
                    {menuItems.filter(item => {
                        const user = authService.getCurrentUser();
                        const isSuperAdmin = user?.is_super_admin || false;

                        // Rotas de administração global do SaaS: só Super Admin
                        if (['/estabelecimentos', '/leads', '/monitor', '/catalogo-mestre'].includes(item.to)) {
                            return isSuperAdmin;
                        }

                        // Regras de Acesso centralizadas (nível do cargo + plano)
                        return isSuperAdmin || canAccessRoute(item.to, user);
                    }).map((item) => (
                        <li key={item.to}>
                            <NavLink
                                to={item.to}
                                className={({ isActive }) =>
                                    `flex items-center rounded-lg transition-colors ${isCollapsed ? 'justify-center px-1 py-3' : 'px-4 py-3 space-x-3'} ${isActive
                                        ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                                    }`
                                }
                            >
                                <item.icon className={`w-5 h-5 shrink-0`} />
                                {!isCollapsed && <span className="font-medium whitespace-nowrap overflow-hidden">{item.label}</span>}
                            </NavLink>
                        </li>
                    ))}
                </ul>
                <div className="mt-6 border-t border-gray-100 dark:border-gray-700 pt-4">
                    <button
                        onClick={() => window.dispatchEvent(new CustomEvent('start-tour'))}
                        className={`w-full flex items-center rounded-lg transition-colors ${isCollapsed ? 'justify-center px-1 py-3' : 'px-4 py-3 space-x-3'} bg-linear-to-r from-blue-600 to-blue-700 text-white shadow-md hover:from-blue-700 hover:to-blue-800`}
                    >
                        <Play className="w-5 h-5 shrink-0 fill-white" />
                        {!isCollapsed && <span className="font-bold whitespace-nowrap overflow-hidden text-sm">Tour & Ajuda</span>}
                    </button>
                </div>
            </nav>
        </aside>
    );
};

export default Sidebar;
