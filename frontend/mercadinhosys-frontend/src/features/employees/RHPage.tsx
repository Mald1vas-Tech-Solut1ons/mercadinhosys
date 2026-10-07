import { useState } from 'react';
import { Users, Clock, FileText, BarChart, Timer, AlertTriangle, Wallet, UserMinus, Settings2, Sparkles } from 'lucide-react';
import RHDashboard from './components/RHDashboard';
import PontoHistoricoRH from './components/PontoHistoricoRH';
import EspelhoPonto from './components/EspelhoPonto';
import BancoHorasRH from './components/BancoHorasRH';
import JustificativasRH from './components/JustificativasRH';
import FolhaCustoReal from './components/FolhaCustoReal';
import RescisaoWizard from './components/RescisaoWizard';
import BeneficiosRH from './components/BeneficiosRH';
import ConfigFolhaSettings from './components/ConfigFolhaSettings';
import RetrospectivaGestao from './components/RetrospectivaGestao';
import MeuRH from './components/MeuRH';
import { authService } from '../auth/authService';
import { getNivel } from '../../utils/permissions';
import { InsightCard as ConsultorInsightCard } from '../../components/consultor/InsightCard';

type TabType = 'dashboard' | 'historico' | 'espelho' | 'banco-horas' | 'justificativas' | 'beneficios' | 'folha' | 'rescisao' | 'parametros' | 'retrospectiva';

export default function RHPage() {
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');

  // Regra de Acesso: apenas Admin, Gerente e RH (nível <= 3) veem a gestão
  // completa (todos os funcionários). Os demais níveis usam o autoatendimento
  // — próprio holerite, próprio espelho de ponto e justificativas.
  const nivel = getNivel(authService.getCurrentUser());
  if (nivel > 3) {
    return (
      <div className="p-6 max-w-7xl mx-auto bg-gray-50/50 dark:bg-gray-900/50 min-h-screen">
        <MeuRH />
      </div>
    );
  }

  const tabs = [
    { id: 'dashboard' as TabType, label: 'Dashboard RH', icon: BarChart, description: 'Métricas e análises' },
    { id: 'historico' as TabType, label: 'Histórico de Registros', icon: Clock, description: 'Todos os registros de ponto' },
    { id: 'espelho' as TabType, label: 'Espelho de Ponto', icon: FileText, description: 'Relatório individual' },
    { id: 'banco-horas' as TabType, label: 'Banco de Horas', icon: Timer, description: 'Saldos e créditos' },
    { id: 'justificativas' as TabType, label: 'Justificativas', icon: AlertTriangle, description: 'Atrasos e ausências' },
    { id: 'beneficios' as TabType, label: 'Benefícios', icon: Sparkles, description: 'Vales e descontos' },
    { id: 'folha' as TabType, label: 'Folha & Custo Real', icon: Wallet, description: 'Provisões e custo da equipe' },
    { id: 'rescisao' as TabType, label: 'Demissão', icon: UserMinus, description: 'Rescisão e verbas' },
    { id: 'retrospectiva' as TabType, label: 'Retrospectiva', icon: Sparkles, description: 'Desempenho por colaborador' },
    { id: 'parametros' as TabType, label: 'Parâmetros de Folha', icon: Settings2, description: 'INSS, IRRF, hora extra, FGTS' },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto bg-gray-50/50 dark:bg-gray-900/50 min-h-screen">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center space-x-5 mb-8">
          <div className="p-4 bg-linear-to-br from-indigo-500 to-purple-600 rounded-2xl shadow-xl shadow-indigo-500/20">
            <Users className="w-8 h-8 text-white" />
          </div>
          <div>
            <h1 className="text-4xl font-black text-gray-900 dark:text-white tracking-tight tour-rh-visao">
              Recursos Humanos
            </h1>
            <p className="text-sm font-semibold text-gray-500 dark:text-gray-400 mt-1 uppercase tracking-widest">
              Gestão Mestre • Ponto e Folha
            </p>
          </div>
        </div>

        <ConsultorInsightCard especialista="rh" titulo="Consultor IA - Pessoas & Equipe" className="mb-6" />

        {/* Tabs - Glassmorphism UI */}
        <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-2xl shadow-sm border border-gray-200/50 dark:border-gray-700/50 p-2 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-5 py-4 rounded-xl transition-all duration-300 flex items-center justify-center gap-3 relative overflow-hidden group ${isActive
                    ? 'bg-linear-to-r from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-500/30 ring-1 ring-white/20'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50'
                  }`}
              >
                <div className={`absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out ${isActive ? 'block' : 'hidden'}`}></div>
                <Icon className={`w-5 h-5 relative z-10 transition-colors ${isActive ? 'text-white' : 'text-gray-500 dark:text-gray-400 group-hover:text-indigo-500 dark:group-hover:text-indigo-400'}`} />
                <div className="text-left relative z-10">
                  <div className={`font-bold leading-tight ${isActive ? 'text-white' : 'text-gray-900 dark:text-gray-100'}`}>{tab.label}</div>
                  <div className={`text-[10px] font-bold uppercase tracking-wider mt-0.5 ${isActive ? 'text-indigo-100' : 'text-gray-400 dark:text-gray-500'}`}>
                    {tab.description}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="mt-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        {activeTab === 'dashboard' && <RHDashboard />}
        {activeTab === 'historico' && <PontoHistoricoRH />}
        {activeTab === 'espelho' && <EspelhoPonto />}
        {activeTab === 'banco-horas' && <BancoHorasRH />}
        {activeTab === 'justificativas' && <JustificativasRH />}
        {activeTab === 'beneficios' && <BeneficiosRH />}
        {activeTab === 'folha' && <FolhaCustoReal />}
        {activeTab === 'rescisao' && <RescisaoWizard />}
        {activeTab === 'retrospectiva' && <RetrospectivaGestao />}
        {activeTab === 'parametros' && <ConfigFolhaSettings />}
      </div>
    </div>
  );
}
