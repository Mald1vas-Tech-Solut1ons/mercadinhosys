import { useState, useEffect } from 'react';
import { apiClient } from '../../api/apiClient';
import { Target, Package, AlertTriangle, Users, DollarSign, Activity } from 'lucide-react';

import ExecutiveTab from './components/tabs/ExecutiveTab';
import SalesSfaTab from './components/tabs/SalesSfaTab';
import InventoryTab from './components/tabs/InventoryTab';
import FinancialTab from './components/tabs/FinancialTab';
import RHTab from './components/tabs/RHTab';
import { authService } from '../auth/authService';
import { isPlanoGratis } from '../../utils/permissions';
import { InsightCard } from '../../components/consultor/InsightCard';
import AlertsPanel from './components/AlertsPanel';
import { useSuperAdmin } from '../../contexts/SuperAdminContext';

export default function DashboardPageV2() {
  const [activeTab, setActiveTab] = useState('executive');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [daysFilter, setDaysFilter] = useState<number | 'custom'>(30);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const { selectedTenantId } = useSuperAdmin();

  useEffect(() => {
    if (daysFilter !== 'custom') {
      loadData();
    }
    // selectedTenantId: modo espelho do super admin troca de loja sem navegar
    // para outra página — sem essa dependência, o dashboard ficava preso nos
    // dados (somados) carregados na montagem inicial.
  }, [daysFilter, selectedTenantId]);

  const loadData = async () => {
    if (daysFilter === 'custom' && (!startDate || !endDate)) {
      return; // Prevenir requisição sem datas
    }
    setLoading(true);
    try {
      // apiClient já inclui /api no baseURL — prefixar aqui viraria /api/api/... (404)
      let url = `/dashboard/cientifico?days=${daysFilter}`;
      if (daysFilter === 'custom') {
        url = `/dashboard/cientifico?start_date=${startDate}T00:00:00&end_date=${endDate}T23:59:59`;
      }
      const response = await apiClient.get(url);
      setData(response.data?.data || response.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // Plano Grátis: apenas a Visão Executiva (Regras do Plano Grátis)
  const planoGratis = isPlanoGratis(authService.getCurrentUser());
  const tabs = planoGratis
    ? [{ id: 'executive', label: 'Visão Executiva', icon: Activity }]
    : [
        { id: 'executive', label: 'Visão Executiva', icon: Activity },
        { id: 'sales', label: 'Vendas & SFA', icon: Target },
        { id: 'inventory', label: 'Estoque Inteligente', icon: Package },
        { id: 'financial', label: 'Financeiro', icon: DollarSign },
        { id: 'rh', label: 'Equipe & RH', icon: Users },
      ];

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-slate-100 p-4 md:p-6 lg:p-8 animate-in fade-in duration-500">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight flex items-center gap-2 tour-indicadores">
            Intelligence Hub <span className="text-blue-500">•</span>
          </h1>
          <p className="text-gray-500 dark:text-slate-400 mt-1">Resumo estratégico do período selecionado</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
           {daysFilter === 'custom' && (
             <div className="flex items-center gap-2 mr-2">
               <input
                 type="date"
                 value={startDate}
                 onChange={(e) => setStartDate(e.target.value)}
                 className="px-3 py-2 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-lg border border-gray-200 dark:border-slate-700 outline-none text-sm"
               />
               <span className="text-gray-500 dark:text-slate-400">até</span>
               <input
                 type="date"
                 value={endDate}
                 onChange={(e) => setEndDate(e.target.value)}
                 className="px-3 py-2 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-lg border border-gray-200 dark:border-slate-700 outline-none text-sm"
               />
               <button 
                 onClick={loadData}
                 disabled={!startDate || !endDate}
                 className="px-3 py-2 bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 text-sm font-bold rounded-lg transition-colors border border-blue-500/30 disabled:opacity-50"
               >
                 Aplicar
               </button>
             </div>
           )}
           <select 
             value={daysFilter} 
             onChange={(e) => {
               const val = e.target.value;
               setDaysFilter(val === 'custom' ? 'custom' : Number(val));
             }}
             className="px-4 py-2 bg-white dark:bg-slate-800 hover:bg-gray-100 dark:hover:bg-slate-700 text-sm font-medium rounded-lg transition-colors border border-gray-200 dark:border-slate-700 outline-none text-gray-900 dark:text-white cursor-pointer"
           >
             <option value={7}>Últimos 7 dias</option>
             <option value={15}>Últimos 15 dias</option>
             <option value={30}>Últimos 30 dias</option>
             <option value={90}>Últimos 90 dias</option>
             <option value={365}>Este Ano (365 dias)</option>
             <option value="custom">Período Personalizado</option>
           </select>
           {daysFilter !== 'custom' && (
             <button onClick={loadData} className="px-4 py-2 bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 text-sm font-bold rounded-lg transition-colors border border-blue-500/30">
               Atualizar
             </button>
           )}
        </div>
      </div>

      <InsightCard especialista="geral" titulo="Consultor M-IA - Inteligência do Negócio" className="mb-6 tour-ia-consultor" />
      
      <div className="mb-6">
        <AlertsPanel />
      </div>

      {/* Tabs Navigation — no mobile vira uma faixa de "pílulas" com rolagem horizontal
          (snap + sangria até as bordas) para nunca cortar/embaralhar os rótulos. */}
      <div className="-mx-4 md:mx-0 mb-6">
        <div className="flex md:border-b border-gray-200 dark:border-slate-800 gap-2 md:gap-6 overflow-x-auto hide-scrollbar snap-x px-4 md:px-0 pb-2">
          {tabs.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 whitespace-nowrap snap-start shrink-0 transition-all
                  rounded-full px-4 py-2 text-sm font-semibold md:rounded-none md:px-1 md:py-0 md:pb-2 md:border-b-2 ${
                  isActive
                    ? 'bg-blue-500/15 text-blue-400 md:bg-transparent md:border-blue-500'
                    : 'bg-white dark:bg-slate-800/60 text-gray-500 dark:text-slate-400 md:bg-transparent md:border-transparent hover:text-gray-700 dark:hover:text-slate-200'
                }`}
              >
                <Icon size={18} className="shrink-0" />
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 relative">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center">
             <div className="flex flex-col items-center gap-4">
               <Activity className="w-10 h-10 text-blue-500 animate-spin" />
               <p className="text-gray-500 dark:text-slate-400 font-medium">Processando inteligência de dados...</p>
             </div>
          </div>
        ) : !data ? (
          <div className="flex flex-col items-center justify-center p-12 bg-white dark:bg-slate-800/50 rounded-2xl border border-gray-200 dark:border-slate-800">
             <AlertTriangle className="w-12 h-12 text-red-400 mb-4" />
             <h3 className="text-xl font-bold">Falha ao carregar dados</h3>
             <p className="text-gray-500 dark:text-slate-400 mt-2">Não foi possível obter as estatísticas do servidor.</p>
          </div>
        ) : (
          <div className="animate-in slide-in-from-bottom-4 duration-500">
            {activeTab === 'executive' && <ExecutiveTab data={data} onNavigateToTab={setActiveTab} />}
            {activeTab === 'sales' && <SalesSfaTab data={data} />}
            {activeTab === 'inventory' && <InventoryTab data={data} />}
            {activeTab === 'financial' && <FinancialTab data={data} />}
            {activeTab === 'rh' && <RHTab data={data} onRefresh={loadData} />}
          </div>
        )}
      </div>

    </div>
  );
}
