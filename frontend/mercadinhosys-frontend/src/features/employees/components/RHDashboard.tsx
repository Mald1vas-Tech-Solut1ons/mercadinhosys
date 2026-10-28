import { useState, useEffect } from 'react';
import {
  Users, TrendingUp, DollarSign, AlertCircle,
  Download, ChevronDown, ChevronUp, Printer, BarChart
} from 'lucide-react';
import {
  BarChart as RechartsBarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { apiClient } from '../../../api/apiClient';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import HoleriteModal from './HoleriteModal';
import folhaService, { HoleriteBreakdown } from '../folhaService';
import { showToast } from '../../../components/elements/Toast';
import { dataLocalISO } from '../../../utils/dataLocal';

interface RHMetrics {
  total_beneficios_mensal: number;
  total_salarios: number;
  custo_folha_estimado: number;
  funcionarios_ativos: number;
  total_entradas_periodo: number;
  total_atrasos_qtd: number;
  taxa_pontualidade: number;
  total_minutos_atraso: number;
  minutos_extras_estimados: number;
  custo_extras_estimado: number;
  turnover_rate?: number;
  admissoes_periodo?: number;
  demissoes_periodo?: number;
  evolution_turnover?: Array<{ mes: string; admissoes: number; demissoes: number; ausencias?: number; atrasos?: number; horas_extras?: number }>;
  benefits_breakdown?: Array<{ name: string; value: number }>;
  top_overtime_employees?: Array<{ nome: string; horas: number; custo_estimado: number }>;
  atrasos_por_funcionario_mes?: Array<{ funcionario_id: number; nome: string; cargo: string; atrasos_qtd: number; minutos_atraso: number }>;
  horas_extras_por_funcionario_mes?: Array<{ funcionario_id: number; nome: string; cargo: string; minutos_extras: number; custo_extras: number }>;
  faltas_por_funcionario_mes?: Array<{ funcionario_id: number; nome: string; cargo: string; faltas: number; dias_uteis: number; dias_presenca: number }>;
  espelho_pagamento_mes?: Array<{
    funcionario_id: number; nome: string; cargo: string; salario_base: number;
    beneficios: number; horas_extras_horas: number; custo_horas_extras: number;
    atrasos_minutos: number; faltas: number; total_estimado: number
  }>;
  resumo_mes?: { inicio: string | null; fim: string | null; dias_uteis: number; total_atrasos_minutos: number; total_atrasos_qtd: number; total_extras_minutos: number; total_faltas: number };
}

export default function RHDashboard() {
  const [rhData, setRhData] = useState<RHMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    'metricas': true,
    'turnover': true,
    'beneficios': true,
    'folha': true,
    'atrasos': true
  });
  const [filtroAtrasados, setFiltroAtrasados] = useState(false);
  const [periodoDias, setPeriodoDias] = useState(30);

  // Holerite Modal State
  const [holeriteModalOpen, setHoleriteModalOpen] = useState(false);
  const [holeriteBreakdown, setHoleriteBreakdown] = useState<HoleriteBreakdown | null>(null);

  useEffect(() => {
    loadRHData();
  }, [periodoDias]);

  const loadRHData = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await apiClient.get(`/rh/dashboard?days=${periodoDias}`);
      const rhMetrics = response.data?.data;

      if (rhMetrics) {
        setRhData(rhMetrics);
      } else {
        setError('Dados de RH não disponíveis');
      }
    } catch (err: any) {
      console.error('Erro ao carregar dados de RH:', err);
      setError(err.message || 'Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  };

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const openHolerite = async (row: any) => {
    const funcionarioId = row?.funcionario_id ?? row?.id;
    if (!funcionarioId) { showToast.error('Funcionário não identificado'); return; }
    // Deriva a competência (YYYY-MM) do período do dashboard
    const inicio = rhData?.resumo_mes?.inicio;
    const mes_referencia = inicio ? String(inicio).slice(0, 7) : undefined;
    try {
      const holerite = await folhaService.getHolerite({ funcionario_id: funcionarioId, mes_referencia });
      setHoleriteBreakdown(holerite);
      setHoleriteModalOpen(true);
    } catch (e: any) {
      showToast.error(e?.response?.data?.message || 'Erro ao gerar holerite');
    }
  };

  const exportarFolhaPagamentoPDF = () => {
    if (!rhData?.espelho_pagamento_mes) return;

    const doc = new jsPDF();

    doc.setFillColor(99, 102, 241);
    doc.rect(0, 0, 210, 40, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(20);
    doc.text('Folha de Pagamento', 105, 20, { align: 'center' });
    doc.setFontSize(10);
    doc.text(`Período: ${rhData.resumo_mes?.inicio || '-'} a ${rhData.resumo_mes?.fim || '-'}`, 105, 30, { align: 'center' });

    const headers = [['Funcionário', 'Cargo', 'Salário Base', 'Benefícios', 'H. Extras', 'Faltas', 'Atrasos', 'Total']];
    const data = rhData.espelho_pagamento_mes.map(f => [
      f.nome,
      f.cargo,
      `R$ ${f.salario_base.toFixed(2)}`,
      `R$ ${f.beneficios.toFixed(2)}`,
      `${f.horas_extras_horas.toFixed(1)}h / R$ ${f.custo_horas_extras.toFixed(2)}`,
      f.faltas.toString(),
      `${f.atrasos_minutos}m`,
      `R$ ${f.total_estimado.toFixed(2)}`
    ]);

    autoTable(doc, {
      head: headers,
      body: data,
      startY: 50,
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [99, 102, 241], textColor: [255, 255, 255] },
      alternateRowStyles: { fillColor: [245, 245, 245] }
    });

    const finalY = (doc as any).lastAutoTable.finalY + 10;
    doc.setFontSize(12);
    doc.setTextColor(0, 0, 0);
    doc.text(`Total Folha: R$ ${rhData.custo_folha_estimado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, 14, finalY);

    doc.save(`folha-pagamento-${dataLocalISO(new Date())}.pdf`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px] bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm rounded-3xl border border-gray-100 dark:border-gray-700/50">
        <div className="text-center space-y-4">
          <div className="relative w-16 h-16 mx-auto">
            <div className="absolute inset-0 border-4 border-indigo-100 dark:border-indigo-900/30 rounded-full"></div>
            <div className="absolute inset-0 border-4 border-indigo-500 rounded-full border-t-transparent animate-spin"></div>
          </div>
          <p className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest animate-pulse">Sincronizando Métricas</p>
        </div>
      </div>
    );
  }

  if (error || !rhData) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6">
        <div className="flex items-center gap-3 text-red-700 dark:text-red-400">
          <AlertCircle className="w-6 h-6" />
          <div>
            <h3 className="font-bold">Erro ao carregar dados</h3>
            <p className="text-sm">{error || 'Dados não disponíveis'}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black text-gray-900 dark:text-white leading-tight tracking-tight">Métricas de RH</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">Análise de desempenho e custos em tempo real</p>
        </div>
        <select
          value={periodoDias}
          onChange={(e) => setPeriodoDias(Number(e.target.value))}
          className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-bold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all shadow-sm"
        >
          <option value={7}>Últimos 7 dias</option>
          <option value={15}>Últimos 15 dias</option>
          <option value={30}>Últimos 30 dias</option>
          <option value={60}>Últimos 60 dias</option>
          <option value={90}>Últimos 90 dias</option>
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-5">
        <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700/50 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 dark:bg-indigo-500/5 rounded-bl-full -mr-8 -mt-8 transition-transform group-hover:scale-110"></div>
          <div className="flex items-center justify-between mb-4 relative z-10">
            <div className="p-3 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-xl">
              <Users className="w-5 h-5" />
            </div>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 font-bold uppercase tracking-wider mb-1 relative z-10">Funcionários Ativos</p>
          <h3 className="text-4xl font-black text-gray-900 dark:text-white tracking-tight relative z-10">{rhData.funcionarios_ativos}</h3>
        </div>

        <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700/50 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 dark:bg-emerald-500/5 rounded-bl-full -mr-8 -mt-8 transition-transform group-hover:scale-110"></div>
          <div className="flex items-center justify-between mb-4 relative z-10">
            <div className="p-3 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-xl">
              <DollarSign className="w-5 h-5" />
            </div>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 font-bold uppercase tracking-wider mb-1 relative z-10">Folha de Pagamento</p>
          <h3 className="text-3xl font-black text-gray-900 dark:text-white tracking-tight relative z-10">
            R$ {rhData.custo_folha_estimado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </h3>
          <p className="text-[10px] text-gray-400 font-semibold uppercase mt-2 relative z-10">Estimativa mensal atual</p>
        </div>

        <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700/50 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 dark:bg-purple-500/5 rounded-bl-full -mr-8 -mt-8 transition-transform group-hover:scale-110"></div>
          <div className="flex items-center justify-between mb-4 relative z-10">
            <div className="p-3 bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400 rounded-xl">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 font-bold uppercase tracking-wider mb-1 relative z-10">Benefícios</p>
          <h3 className="text-3xl font-black text-gray-900 dark:text-white tracking-tight relative z-10">
            R$ {(rhData.total_beneficios_mensal || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </h3>
          <p className="text-[10px] text-purple-500 dark:text-purple-400 font-bold uppercase tracking-wider mt-2 relative z-10">Total de Vales Ativos</p>
        </div>

        <div
          className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700/50 relative overflow-hidden group cursor-pointer hover:border-rose-200 dark:hover:border-rose-900/50 transition-all"
          onClick={() => setFiltroAtrasados(!filtroAtrasados)}
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-rose-500/10 dark:bg-rose-500/5 rounded-bl-full -mr-8 -mt-8 transition-transform group-hover:scale-110"></div>
          <div className="flex items-center justify-between mb-4 relative z-10">
            <div className="p-3 bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 rounded-xl">
              <AlertCircle className="w-5 h-5" />
            </div>
            <span className="text-[9px] font-black text-rose-600 bg-rose-50 dark:bg-rose-500/10 dark:text-rose-400 px-2.5 py-1 rounded-full uppercase tracking-widest border border-rose-100 dark:border-rose-500/20">
              Filtrar
            </span>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 font-bold uppercase tracking-wider mb-1 relative z-10">Picos de Atraso</p>
          <h3 className="text-4xl font-black text-gray-900 dark:text-white tracking-tight relative z-10">{rhData.total_atrasos_qtd}</h3>
          <p className="text-[10px] text-rose-500 dark:text-rose-400 font-bold uppercase tracking-wider mt-2 relative z-10">{rhData.total_minutos_atraso} min acumulados</p>
        </div>

        <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700/50 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 dark:bg-purple-500/5 rounded-bl-full -mr-8 -mt-8 transition-transform group-hover:scale-110"></div>
          <div className="flex items-center justify-between mb-4 relative z-10">
            <div className="p-3 bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400 rounded-xl">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 font-bold uppercase tracking-wider mb-1 relative z-10">Pontualidade Média</p>
          <h3 className="text-4xl font-black text-gray-900 dark:text-white tracking-tight relative z-10">{rhData.taxa_pontualidade}%</h3>
          <p className="text-[10px] text-purple-500 dark:text-purple-400 font-bold uppercase tracking-wider mt-2 relative z-10">Taxa do período</p>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-6 border border-gray-100 dark:border-gray-700/50">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-50 dark:bg-indigo-500/10 rounded-lg text-indigo-600 dark:text-indigo-400">
              <BarChart className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-gray-900 dark:text-white text-lg">Histórico de Movimentação</h3>
          </div>
          <button
            onClick={() => toggleSection('turnover')}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50 rounded-lg transition-colors"
          >
            {expandedSections['turnover'] ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </button>
        </div>

        {expandedSections['turnover'] && (
          <div className="h-[400px]">
            {rhData.evolution_turnover && rhData.evolution_turnover.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <RechartsBarChart data={rhData.evolution_turnover}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="mes" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                  />
                  <Bar dataKey="admissoes" name="Admissões" fill="#10B981" />
                  <Bar dataKey="demissoes" name="Demissões" fill="#EF4444" />
                  <Bar dataKey="ausencias" name="Ausências" fill="#F59E0B" />
                  <Bar dataKey="atrasos" name="Atrasos" fill="#8B5CF6" />
                </RechartsBarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-gray-500 dark:text-gray-400">
                <TrendingUp className="w-10 h-10 mb-2 opacity-30" />
                <p className="font-bold">Sem dados históricos suficientes para o gráfico</p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-6 border border-gray-100 dark:border-gray-700/50">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-50 dark:bg-indigo-500/10 rounded-lg text-indigo-600 dark:text-indigo-400">
              <DollarSign className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-gray-900 dark:text-white text-lg">Folha de Pagamento Detalhada</h3>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={exportarFolhaPagamentoPDF}
              className="px-4 py-2 bg-rose-50 hover:bg-rose-100 dark:bg-rose-500/10 dark:hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 rounded-lg font-bold text-sm transition-colors flex items-center gap-2 border border-rose-200 dark:border-rose-500/20"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Exportar PDF</span>
            </button>
            <button
              onClick={() => toggleSection('folha')}
              className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50 rounded-lg transition-colors"
            >
              {expandedSections['folha'] ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {expandedSections['folha'] && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-50 dark:bg-gray-900/50 text-gray-500 dark:text-gray-400 font-bold border-b border-gray-200 dark:border-gray-700/80">
                <tr>
                  <th className="px-5 py-4 uppercase tracking-wider text-xs">Funcionário</th>
                  <th className="px-5 py-4 uppercase tracking-wider text-xs">Cargo</th>
                  <th className="px-5 py-4 uppercase tracking-wider text-xs whitespace-nowrap">Salário Base</th>
                  <th className="px-5 py-4 uppercase tracking-wider text-xs">Benefícios</th>
                  <th className="px-5 py-4 uppercase tracking-wider text-xs whitespace-nowrap">H. Extras</th>
                  <th className="px-5 py-4 uppercase tracking-wider text-xs text-center">Faltas</th>
                  <th className="px-5 py-4 uppercase tracking-wider text-xs text-center">Atrasos</th>
                  <th className="px-5 py-4 uppercase tracking-wider text-xs text-right whitespace-nowrap">Total Líq.</th>
                  <th className="px-5 py-4 text-right uppercase tracking-wider text-xs">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {rhData.espelho_pagamento_mes && rhData.espelho_pagamento_mes.length > 0 ? (
                  rhData.espelho_pagamento_mes.map((row, idx) => (
                    <tr key={idx} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/80 transition-colors">
                      <td className="px-5 py-4">
                        <p className="text-gray-900 dark:text-white font-semibold">{row.nome}</p>
                      </td>
                      <td className="px-5 py-4 text-gray-600 dark:text-gray-300 font-medium">{row.cargo}</td>
                      <td className="px-5 py-4 text-gray-700 dark:text-gray-300 whitespace-nowrap font-medium">R$ {row.salario_base.toFixed(2)}</td>
                      <td className="px-5 py-4 text-gray-700 dark:text-gray-300 font-medium">R$ {row.beneficios.toFixed(2)}</td>
                      <td className="px-5 py-4">
                        <div className="flex flex-col">
                          <span className="text-gray-900 dark:text-gray-200 font-semibold">{row.horas_extras_horas.toFixed(1)}h</span>
                          <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">+R$ {row.custo_horas_extras.toFixed(2)}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-center">
                        <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${row.faltas > 0 ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400' : 'text-gray-400'}`}>{row.faltas}</span>
                      </td>
                      <td className="px-5 py-4 text-center">
                        <span className={`inline-flex items-center justify-center px-2 py-1 rounded-md text-xs font-bold ${row.atrasos_minutos > 0 ? 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400' : 'text-gray-400'}`}>{row.atrasos_minutos}m</span>
                      </td>
                      <td className="px-5 py-4 text-right whitespace-nowrap">
                        <span className="text-gray-900 dark:text-white font-black text-sm">R$ {row.total_estimado.toFixed(2)}</span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <button
                          onClick={() => openHolerite(row)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 rounded-md font-bold text-xs uppercase tracking-wider transition-colors"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          <span>Holerite</span>
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={9} className="px-5 py-12 text-center text-gray-400 dark:text-gray-500">
                      Sem dados processados para o período
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal Holerite */}
      {holeriteBreakdown && (
        <HoleriteModal
          isOpen={holeriteModalOpen}
          onClose={() => setHoleriteModalOpen(false)}
          holerite={holeriteBreakdown}
        />
      )}
    </div>
  );
}
