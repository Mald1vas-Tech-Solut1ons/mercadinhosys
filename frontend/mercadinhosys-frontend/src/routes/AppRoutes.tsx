import React, { Suspense, lazy, useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { authService } from '../features/auth/authService';
import SuperAdminRoute from '../components/routes/SuperAdminRoute';
import ModuleGuard from '../components/routes/ModuleGuard';
import { getDefaultRoute } from '../utils/permissions';

import { SplashLoading } from '../components/common/SplashLoading';

// Lazy loading das páginas
const MainLayout = lazy(() => import('../components/layout/MainLayout'));
const ConnectionTest = lazy(() => import('../components/ConnectionTest'));
const LoginPage = lazy(() => import('../features/auth/LoginPage').then(module => ({ default: module.LoginPage })));
const RegisterPage = lazy(() => import('../features/auth/RegisterPage').then(module => ({ default: module.RegisterPage })));
const DashboardPage = lazy(() => import('../features/dashboard/DashboardPage'));
const PDVPage = lazy(() => import('../features/pdv/PDVPage'));
const ProductsPage = lazy(() => import('../features/products/ProductsPage'));
const ProductHubPage = lazy(() => import('../features/products/ProductHubPage'));
const PurchasesPage = lazy(() => import('../features/purchases/PurchasesPage'));
const SuppliersPage = lazy(() => import('../features/suppliers/SuppliersPage'));
const CustomersPage = lazy(() => import('../features/customers/CustomersPage'));
const SalesPage = lazy(() => import('../features/sales/SalesPage'));
const ExpensesPage = lazy(() => import('../features/expenses/ExpensesPage'));
const EmployeesPage = lazy(() => import('../features/employees/EmployeesPage'));
const RHPage = lazy(() => import('../features/employees/RHPage'));
const PontoPage = lazy(() => import('../features/ponto/PontoPage'));
const PontoHistoricoPage = lazy(() => import('../features/ponto/PontoHistoricoPage'));
const RelatoriosPontoPage = lazy(() => import('../features/ponto/RelatoriosPontoPage'));
const DiagnosticoFotos = lazy(() => import('../features/ponto/DiagnosticoFotos'));
const ReportsPage = lazy(() => import('../features/reports/ReportsPage'));
const SettingsPage = lazy(() => import('../features/settings/SettingsPage'));
const LeadDashboard = lazy(() => import('../features/saas/LeadDashboard'));
const SystemMonitorPage = lazy(() => import('../features/saas/SystemMonitorPage'));
const LandingPage = lazy(() => import('../features/landing/LandingPage'));
const EstabelecimentosPage = lazy(() => import('../features/estabelecimentos/EstabelecimentosPage'));
const DeliveryPage = lazy(() => import('../features/delivery/DeliveryPage'));
const FiscalPage = lazy(() => import('../features/fiscal/FiscalPage'));
const MonitorPage = lazy(() => import('../features/monitor/MonitorPage'));
const MasterCatalogPage = lazy(() => import('../features/catalogo-mestre/MasterCatalogPage'));
const ConsultorPage = lazy(() => import('../pages/ConsultorPage').then(module => ({ default: module.ConsultorPage })));

// Páginas públicas institucionais (legais / ajuda)
const TermosPage = lazy(() => import('../features/legal/TermosPage'));
const PrivacidadePage = lazy(() => import('../features/legal/PrivacidadePage'));
const AjudaPage = lazy(() => import('../features/legal/AjudaPage'));

// SFA (Sales Force Automation)
const SFADashboard = lazy(() => import('../features/sfa/SFADashboard'));
const SFAPedido = lazy(() => import('../features/sfa/SFAPedido'));
const SFAManagement = lazy(() => import('../features/sfa/SFAManagement'));
const SFAClientes = lazy(() => import('../features/sfa/SFAClientes'));
const SFAClienteForm = lazy(() => import('../features/sfa/SFAClienteForm'));
const SFAProdutos = lazy(() => import('../features/sfa/SFAProdutos'));




const AppRoutes: React.FC = () => {
    const [isAuthenticated, setIsAuthenticated] = useState(authService.isAuthenticated());
    
    // Rota default por nível (4=Estoque/Caixa→PDV, 5=Vendedor→SFA, 6=Entregador→Entregas)
    const getTargetRoute = () => getDefaultRoute(authService.getCurrentUser());
    
    useEffect(() => {
        const checkAuth = () => {
            setIsAuthenticated(authService.isAuthenticated());
        };
        window.addEventListener('auth-change', checkAuth);
        return () => window.removeEventListener('auth-change', checkAuth);
    }, []);

    return (
        <Suspense fallback={<SplashLoading />}>
            <Routes>
                <Route path="/" element={<LandingPage />} />
                <Route path="/login" element={isAuthenticated ? <Navigate to={getTargetRoute()} replace /> : <LoginPage />} />
                <Route path="/register" element={isAuthenticated ? <Navigate to={getTargetRoute()} replace /> : <RegisterPage />} />
                <Route path="/test" element={<ConnectionTest />} />

                {/* Públicas — institucionais */}
                <Route path="/termos" element={<TermosPage />} />
                <Route path="/privacidade" element={<PrivacidadePage />} />
                <Route path="/ajuda" element={<AjudaPage />} />

                <Route element={isAuthenticated ? <MainLayout /> : <Navigate to="/login" replace />}>
                    <Route path="dashboard" element={<ModuleGuard modulo="dashboard"><DashboardPage /></ModuleGuard>} />
                    <Route path="pdv" element={<ModuleGuard modulo="pdv"><PDVPage /></ModuleGuard>} />
                    <Route path="products" element={<ModuleGuard modulo="produtos"><ProductsPage /></ModuleGuard>} />
                    <Route path="products/:id" element={<ModuleGuard modulo="produtos"><ProductHubPage /></ModuleGuard>} />
                    <Route path="compras" element={<ModuleGuard modulo="compras"><PurchasesPage /></ModuleGuard>} />
                    <Route path="suppliers" element={<ModuleGuard modulo="fornecedores"><SuppliersPage /></ModuleGuard>} />
                    <Route path="suppliers/:id" element={<ModuleGuard modulo="fornecedores"><SuppliersPage /></ModuleGuard>} />
                    <Route path="customers" element={<ModuleGuard modulo="clientes"><CustomersPage /></ModuleGuard>} />
                    <Route path="settings" element={<ModuleGuard modulo="configuracoes"><SettingsPage /></ModuleGuard>} />
                    <Route path="delivery" element={<ModuleGuard modulo="delivery"><DeliveryPage /></ModuleGuard>} />

                    <Route path="sales" element={<ModuleGuard modulo="vendas"><SalesPage /></ModuleGuard>} />
                    <Route path="expenses" element={<ModuleGuard modulo="despesas"><ExpensesPage /></ModuleGuard>} />
                    <Route path="fiscal" element={<ModuleGuard modulo="fiscal"><FiscalPage /></ModuleGuard>} />
                    <Route path="auditoria" element={<ModuleGuard modulo="auditoria"><MonitorPage /></ModuleGuard>} />
                    <Route path="sfa" element={<ModuleGuard modulo="sfa"><SFADashboard /></ModuleGuard>} />
                    <Route path="sfa/clientes" element={<ModuleGuard modulo="sfa"><SFAClientes /></ModuleGuard>} />
                    <Route path="sfa/clientes/novo" element={<ModuleGuard modulo="sfa"><SFAClienteForm /></ModuleGuard>} />
                    <Route path="sfa/produtos" element={<ModuleGuard modulo="sfa"><SFAProdutos /></ModuleGuard>} />
                    <Route path="sfa/pedido" element={<ModuleGuard modulo="sfa"><SFAPedido /></ModuleGuard>} />
                    <Route path="sfa/pedido/:id" element={<ModuleGuard modulo="sfa"><SFAPedido /></ModuleGuard>} />
                    <Route path="sfa/gestao" element={<ModuleGuard modulo="sfa_gestao"><SFAManagement /></ModuleGuard>} />
                    <Route path="employees" element={<ModuleGuard modulo="funcionarios"><EmployeesPage /></ModuleGuard>} />
                    <Route path="rh" element={<ModuleGuard modulo="rh"><RHPage /></ModuleGuard>} />
                    <Route path="ponto" element={<ModuleGuard modulo="ponto"><PontoPage /></ModuleGuard>} />
                    <Route path="ponto-historico" element={<ModuleGuard modulo="ponto"><PontoHistoricoPage /></ModuleGuard>} />
                    <Route path="ponto-relatorios" element={<ModuleGuard modulo="rh_gestao"><RelatoriosPontoPage /></ModuleGuard>} />
                    <Route path="ponto-diagnostico" element={<ModuleGuard modulo="rh_gestao"><DiagnosticoFotos /></ModuleGuard>} />
                    <Route path="reports" element={<ModuleGuard modulo="relatorios"><ReportsPage /></ModuleGuard>} />
                    <Route path="consultor" element={<ModuleGuard modulo="consultor"><ConsultorPage /></ModuleGuard>} />

                    <Route path="estabelecimentos" element={<SuperAdminRoute><EstabelecimentosPage /></SuperAdminRoute>} />
                    <Route path="monitor" element={<SuperAdminRoute><SystemMonitorPage /></SuperAdminRoute>} />
                    <Route path="leads" element={<SuperAdminRoute><LeadDashboard /></SuperAdminRoute>} />
                    <Route path="catalogo-mestre" element={<SuperAdminRoute><MasterCatalogPage /></SuperAdminRoute>} />
                </Route>

                <Route path="*" element={<Navigate to={isAuthenticated ? getTargetRoute() : "/"} replace />} />
            </Routes>
        </Suspense>
    );
};

export default AppRoutes;
