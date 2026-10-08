import { useState, useEffect } from 'react';
import { Calendar, Download, Filter, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';
import { apiClient } from '../../../api/apiClient';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface EspelhoPontoData {
  funcionario_id: number;
  nome: string;
  cargo: string;
  registros_diarios: Array<{
    data: string;
    entrada: string | null;
    saida: string | null;
    intervalo_inicio: string | null;
    intervalo_fim: string | null;
    minutos_atraso: number;
    minutos_extras: number;
    horas_trabalhadas: number;
    observacao?: string;
  }>;
  resumo: {
    total_dias_trabalhados: number;
    total_atrasos: number;
    total_minutos_atraso: number;
    total_horas_extras: number;
    total_horas_trabalhadas: number;
    media_horas_dia: number;
  };
}

interface Funcionario {
  id: number;
  nome: string;
  cargo: string;
}

export default function EspelhoPonto() {
  const [espelhoData, setEspelhoData] = useState<EspelhoPontoData | null>(null);
  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [funcionarioId, setFuncionarioId] = useState<string>('');
  const [dataInicio, setDataInicio] = useState<string>('');
  const [dataFim, setDataFim] = useState<string>('');
  const [expandedDays, setExpandedDays] = useState<Record<string, boolean>>({});

  useEffect(() => {
    loadFuncionarios();

    const hoje = new Date();
    const primeiroDia = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    setDataInicio(primeiroDia.toISOString().split('T')[0]);
    setDataFim(hoje.toISOString().split('T')[0]);
  }, []);

  const loadFuncionarios = async () => {
    try {
      const response = await apiClient.get('/funcionarios', {
        params: { simples: true, por_pagina: 200, incluir_estatisticas: false },
      });
      const items = response?.data?.data || response?.data?.funcionarios || response?.data || [];
      setFuncionarios(Array.isArray(items) ? items : []);
    } catch (err) {
      console.error('Erro ao carregar funcionários:', err);
      setFuncionarios([]);
    }
  };

  const loadEspelhoPonto = async () => {
    if (!funcionarioId || !dataInicio || !dataFim) {
      setError('Por favor, selecione um funcionário e o período');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await apiClient.get('/dashboard/rh/ponto/espelho', {
        params: {
          funcionario_id: Number(funcionarioId),
          data_inicio: dataInicio,
          data_fim: dataFim
        }
      });

      setEspelhoData(response.data?.data);
    } catch (err: any) {
      console.error('Erro ao carregar espelho de ponto:', err);
      setError(err?.response?.data?.message || err?.message || 'Erro ao carregar espelho');
      setEspelhoData(null);
    } finally {
      setLoading(false);
    }
  };

  const toggleDay = (data: string) => {
    setExpandedDays(prev => ({
      ...prev,
      [data]: !prev[data]
    }));
  };

  const exportarPDF = () => {
    if (!espelhoData) return;

    const doc = new jsPDF();

    doc.setFillColor(99, 102, 241);
    doc.rect(0, 0, 210, 50, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(22);
    doc.text('Espelho de Ponto', 105, 20, { align: 'center' });
    doc.setFontSize(12);
    doc.text(`Funcionário: ${espelhoData.nome}`, 105, 30, { align: 'center' });
    doc.text(`Cargo: ${espelhoData.cargo}`, 105, 37, { align: 'center' });
    doc.setFontSize(10);
    doc.text(`Período: ${new Date(dataInicio).toLocaleDateString('pt-BR')} a ${new Date(dataFim).toLocaleDateString('pt-BR')}`, 105, 44, { align: 'center' });

    const headers = [['Data', 'Entrada', 'Saída', 'Int. Início', 'Int. Fim', 'Atraso', 'Extras', 'H. Trab.']];
    const data = espelhoData.registros_diarios.map(r => [
      new Date(r.data).toLocaleDateString('pt-BR'),
      r.entrada || '-',
      r.saida || '-',
      r.intervalo_inicio || '-',
      r.intervalo_fim || '-',
      r.minutos_atraso > 0 ? `${r.minutos_atraso}m` : '-',
      r.minutos_extras > 0 ? `${(r.minutos_extras / 60).toFixed(1)}h` : '-',
      `${(r.horas_trabalhadas / 60).toFixed(1)}h`
    ]);

    autoTable(doc, {
      head: headers,
      body: data,
      startY: 60,
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [99, 102, 241], textColor: [255, 255, 255] },
      alternateRowStyles: { fillColor: [245, 245, 245] }
    });

    const finalY = (doc as any).lastAutoTable.finalY + 15;
    doc.setFontSize(14);
    doc.setTextColor(0, 0, 0);
    doc.text('Resumo do Período', 14, finalY);

    doc.setFontSize(10);
    doc.text(`Dias Trabalhados: ${espelhoData.resumo.total_dias_trabalhados}`, 14, finalY + 8);
    doc.text(`Total de Atrasos: ${espelhoData.resumo.total_atrasos} (${espelhoData.resumo.total_minutos_atraso} minutos)`, 14, finalY + 15);
    doc.text(`Total Horas Extras: ${espelhoData.resumo.total_horas_extras.toFixed(1)}h`, 14, finalY + 22);
    doc.text(`Total Horas Trabalhadas: ${espelhoData.resumo.total_horas_trabalhadas.toFixed(1)}h`, 14, finalY + 29);
    doc.text(`Média Horas/Dia: ${espelhoData.resumo.media_horas_dia.toFixed(1)}h`, 14, finalY + 36);

    doc.save(`espelho-ponto-${espelhoData.nome.replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.pdf`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black text-gray-900 dark:text-white tracking-tight">Espelho de Ponto</h2>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mt-1">Visualização detalhada dos registros por funcionário</p>
        </div>
        {espelhoData && (
          <button
            onClick={exportarPDF}
            className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl shadow-lg shadow-rose-600/20 font-bold transition-all flex items-center gap-2"
          >
            <Download className="w-5 h-5" />
            Exportar PDF
          </button>
        )}
      </div>

      <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-2xl shadow-sm p-6 border border-gray-200/50 dark:border-gray-700/50">
        <div className="flex items-center gap-2 mb-4">
          <Filter className="w-5 h-5 text-indigo-500 dark:text-indigo-400" />
          <h3 className="font-bold text-gray-900 dark:text-white">Filtros de Busca</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Funcionário *</label>
            <select
              value={funcionarioId}
              onChange={(e) => setFuncionarioId(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900/50 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
            >
              <option value="">Selecione...</option>
              {funcionarios.map(f => (
                <option key={f.id} value={f.id}>{f.nome} - {f.cargo}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Data Início *</label>
            <input
              type="date"
              value={dataInicio}
              onChange={(e) => setDataInicio(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900/50 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Data Fim *</label>
            <input
              type="date"
              value={dataFim}
              onChange={(e) => setDataFim(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900/50 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
            />
          </div>

          <div className="flex items-end">
            <button
              onClick={loadEspelhoPonto}
              disabled={!funcionarioId || !dataInicio || !dataFim}
              className="w-full px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-lg shadow-indigo-600/20 font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              Gerar Espelho
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center min-h-[400px] bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm rounded-3xl border border-gray-100 dark:border-gray-700/50">
          <div className="relative w-16 h-16 mb-4">
            <div className="absolute inset-0 border-4 border-indigo-100 dark:border-indigo-900/30 rounded-full"></div>
            <div className="absolute inset-0 border-4 border-indigo-500 rounded-full border-t-transparent animate-spin"></div>
          </div>
          <p className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest animate-pulse">Gerando espelho de ponto...</p>
        </div>
      ) : error ? (
        <div className="bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-2xl p-6">
          <div className="flex items-center gap-3 text-rose-700 dark:text-rose-400">
            <AlertCircle className="w-6 h-6" />
            <p className="font-bold">{error}</p>
          </div>
        </div>
      ) : espelhoData ? (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-2xl shadow-sm p-6 border border-gray-200/50 dark:border-gray-700/50">
            <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-6">Resumo do Período</h3>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="p-5 bg-blue-50 dark:bg-blue-500/10 rounded-xl border border-blue-100 dark:border-blue-500/20 relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/10 rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110"></div>
                <p className="text-xs text-blue-600 dark:text-blue-400 font-bold uppercase tracking-wider mb-1 relative z-10">Dias Trabalhados</p>
                <p className="text-4xl font-black text-blue-700 dark:text-blue-300 tracking-tight relative z-10">{espelhoData.resumo.total_dias_trabalhados}</p>
              </div>
              <div className="p-5 bg-rose-50 dark:bg-rose-500/10 rounded-xl border border-rose-100 dark:border-rose-500/20 relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-24 h-24 bg-rose-500/10 rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110"></div>
                <p className="text-xs text-rose-600 dark:text-rose-400 font-bold uppercase tracking-wider mb-1 relative z-10">Atrasos</p>
                <p className="text-4xl font-black text-rose-700 dark:text-rose-300 tracking-tight relative z-10">{espelhoData.resumo.total_atrasos}</p>
                <p className="text-xs text-rose-500 dark:text-rose-400/70 font-bold mt-1 relative z-10">{espelhoData.resumo.total_minutos_atraso}m</p>
              </div>
              <div className="p-5 bg-orange-50 dark:bg-orange-500/10 rounded-xl border border-orange-100 dark:border-orange-500/20 relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-24 h-24 bg-orange-500/10 rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110"></div>
                <p className="text-xs text-orange-600 dark:text-orange-400 font-bold uppercase tracking-wider mb-1 relative z-10">Horas Extras</p>
                <p className="text-4xl font-black text-orange-700 dark:text-orange-300 tracking-tight relative z-10">{espelhoData.resumo.total_horas_extras.toFixed(1)}h</p>
              </div>
              <div className="p-5 bg-emerald-50 dark:bg-emerald-500/10 rounded-xl border border-emerald-100 dark:border-emerald-500/20 relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/10 rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110"></div>
                <p className="text-xs text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-wider mb-1 relative z-10">Totais Trabalhadas</p>
                <p className="text-4xl font-black text-emerald-700 dark:text-emerald-300 tracking-tight relative z-10">{espelhoData.resumo.total_horas_trabalhadas.toFixed(1)}h</p>
              </div>
              <div className="p-5 bg-indigo-50 dark:bg-indigo-500/10 rounded-xl border border-indigo-100 dark:border-indigo-500/20 relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/10 rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110"></div>
                <p className="text-xs text-indigo-600 dark:text-indigo-400 font-bold uppercase tracking-wider mb-1 relative z-10">Média/Dia</p>
                <p className="text-4xl font-black text-indigo-700 dark:text-indigo-300 tracking-tight relative z-10">{espelhoData.resumo.media_horas_dia.toFixed(1)}h</p>
              </div>
            </div>
          </div>

          <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-2xl shadow-sm border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
            <div className="p-6 border-b border-gray-200/50 dark:border-gray-700/50">
              <h3 className="font-bold text-gray-900 dark:text-white">Registros Diários</h3>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-800/80">
              {espelhoData.registros_diarios.map((registro, idx) => (
                <div key={idx} className="p-6 hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors">
                  <div
                    className="flex items-center justify-between cursor-pointer group"
                    onClick={() => toggleDay(registro.data)}
                  >
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-indigo-50 dark:bg-indigo-500/10 rounded-xl group-hover:scale-110 transition-transform">
                        <Calendar className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                      </div>
                      <div>
                        <p className="font-bold text-gray-900 dark:text-white text-lg">
                          {new Date(registro.data).toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                        </p>
                        <p className="text-sm text-gray-500 dark:text-gray-400 font-medium mt-0.5">
                          {registro.entrada || '---'} às {registro.saida || '---'} • <span className="text-indigo-600 dark:text-indigo-400 font-bold">{(registro.horas_trabalhadas / 60).toFixed(1)}h</span> trabalhadas
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {registro.minutos_atraso > 0 && (
                        <span className="px-3 py-1 text-xs font-bold rounded-md bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400">
                          {registro.minutos_atraso}m atraso
                        </span>
                      )}
                      {registro.minutos_extras > 0 && (
                        <span className="px-3 py-1 text-xs font-bold rounded-md bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400">
                          {(registro.minutos_extras / 60).toFixed(1)}h extras
                        </span>
                      )}
                      <div className="p-2 bg-gray-100 dark:bg-gray-800 rounded-full group-hover:bg-gray-200 dark:group-hover:bg-gray-700 transition-colors">
                        {expandedDays[registro.data] ? <ChevronUp className="w-5 h-5 text-gray-500 dark:text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-500 dark:text-gray-400" />}
                      </div>
                    </div>
                  </div>

                  {expandedDays[registro.data] && (
                    <div className="mt-6 ml-13 grid grid-cols-2 md:grid-cols-4 gap-4 animate-in slide-in-from-top-2 duration-200">
                      <div className="p-4 bg-white dark:bg-gray-900/50 rounded-xl border border-gray-100 dark:border-gray-700/50">
                        <p className="text-xs text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-wider">Entrada</p>
                        <p className="text-xl font-black text-gray-900 dark:text-white mt-1">{registro.entrada || '---'}</p>
                      </div>
                      <div className="p-4 bg-white dark:bg-gray-900/50 rounded-xl border border-gray-100 dark:border-gray-700/50">
                        <p className="text-xs text-amber-600 dark:text-amber-400 font-bold uppercase tracking-wider">Pausa Início</p>
                        <p className="text-xl font-black text-gray-900 dark:text-white mt-1">{registro.intervalo_inicio || '---'}</p>
                      </div>
                      <div className="p-4 bg-white dark:bg-gray-900/50 rounded-xl border border-gray-100 dark:border-gray-700/50">
                        <p className="text-xs text-blue-600 dark:text-blue-400 font-bold uppercase tracking-wider">Pausa Fim</p>
                        <p className="text-xl font-black text-gray-900 dark:text-white mt-1">{registro.intervalo_fim || '---'}</p>
                      </div>
                      <div className="p-4 bg-white dark:bg-gray-900/50 rounded-xl border border-gray-100 dark:border-gray-700/50">
                        <p className="text-xs text-rose-600 dark:text-rose-400 font-bold uppercase tracking-wider">Saída</p>
                        <p className="text-xl font-black text-gray-900 dark:text-white mt-1">{registro.saida || '---'}</p>
                      </div>
                      {registro.observacao && (
                        <div className="col-span-2 md:col-span-4 p-4 bg-yellow-50 dark:bg-yellow-500/10 rounded-xl border border-yellow-100 dark:border-yellow-500/20">
                          <p className="text-xs text-yellow-700 dark:text-yellow-400 font-bold uppercase tracking-wider">Observação do RH</p>
                          <p className="text-sm text-yellow-900 dark:text-yellow-200 font-medium mt-1">{registro.observacao}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm border border-gray-200/50 dark:border-gray-700/50 rounded-3xl p-16 text-center">
          <Calendar className="w-16 h-16 mx-auto text-gray-300 dark:text-gray-600 mb-6" />
          <h3 className="text-xl font-black text-gray-900 dark:text-white mb-2">Selecione os Filtros</h3>
          <p className="text-gray-500 dark:text-gray-400 font-medium max-w-sm mx-auto">Preencha o funcionário e o período desejado acima para visualizar e gerar o espelho de ponto.</p>
        </div>
      )}
    </div>
  );
}
