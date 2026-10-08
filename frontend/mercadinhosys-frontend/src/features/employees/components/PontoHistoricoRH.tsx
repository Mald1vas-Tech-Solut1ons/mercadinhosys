import { useState, useEffect } from 'react';
import { Clock, Filter, Download, ChevronLeft, ChevronRight, User, AlertCircle } from 'lucide-react';
import { apiClient } from '../../../api/apiClient';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface PontoRegistro {
  id: number;
  funcionario_id: number;
  funcionario_nome: string;
  funcionario_cargo: string;
  data: string;
  hora: string;
  tipo: 'entrada' | 'saida' | 'intervalo_inicio' | 'intervalo_fim';
  foto_path?: string;
  observacao?: string;
  minutos_atraso?: number;
  minutos_extras?: number;
}

interface Funcionario {
  id: number;
  nome: string;
  cargo: string;
}

export default function PontoHistoricoRH() {
  const [registros, setRegistros] = useState<PontoRegistro[]>([]);
  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filtroFuncionarioId, setFiltroFuncionarioId] = useState<string>('');
  const [filtroDataInicio, setFiltroDataInicio] = useState<string>('');
  const [filtroDataFim, setFiltroDataFim] = useState<string>('');
  const [filtroTipo, setFiltroTipo] = useState<string>('');

  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);

  useEffect(() => {
    loadFuncionarios();
  }, []);

  useEffect(() => {
    loadRegistros();
  }, [page, perPage, filtroFuncionarioId, filtroDataInicio, filtroDataFim, filtroTipo]);

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

  const loadRegistros = async () => {
    try {
      setLoading(true);
      setError(null);

      const params: any = { page, per_page: perPage };
      if (filtroDataInicio) params.data_inicio = filtroDataInicio;
      if (filtroDataFim) params.data_fim = filtroDataFim;
      if (filtroFuncionarioId) params.funcionario_id = Number(filtroFuncionarioId);
      if (filtroTipo) params.tipo = filtroTipo;

      const response = await apiClient.get('/dashboard/rh/ponto/historico', { params });
      const data = response?.data?.data;

      setRegistros(data?.items || []);
      setPage(data?.page || page);
      setPerPage(data?.per_page || perPage);
      setTotal(data?.total || 0);
      setPages(data?.pages || 1);
    } catch (err: any) {
      console.error('Erro ao carregar histórico de ponto:', err);
      setError(err?.response?.data?.message || err?.message || 'Erro ao carregar histórico');
      setRegistros([]);
      setTotal(0);
      setPages(1);
    } finally {
      setLoading(false);
    }
  };

  const limparFiltros = () => {
    setFiltroFuncionarioId('');
    setFiltroDataInicio('');
    setFiltroDataFim('');
    setFiltroTipo('');
    setPage(1);
  };

  const exportarPDF = () => {
    const doc = new jsPDF();

    doc.setFillColor(99, 102, 241);
    doc.rect(0, 0, 210, 40, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(20);
    doc.text('Histórico de Registros de Ponto', 105, 20, { align: 'center' });
    doc.setFontSize(10);
    doc.text(`Gerado em: ${new Date().toLocaleDateString('pt-BR')}`, 105, 30, { align: 'center' });

    const headers = [['Data', 'Hora', 'Funcionário', 'Cargo', 'Tipo', 'Atraso', 'Extras']];
    const data = registros.map(r => [
      new Date(r.data).toLocaleDateString('pt-BR'),
      r.hora,
      r.funcionario_nome,
      r.funcionario_cargo,
      r.tipo,
      r.minutos_atraso ? `${r.minutos_atraso}m` : '-',
      r.minutos_extras ? `${(r.minutos_extras / 60).toFixed(1)}h` : '-'
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

    doc.save(`historico-ponto-${new Date().toISOString().split('T')[0]}.pdf`);
  };

  const getTipoLabel = (tipo: string) => {
    const labels: Record<string, string> = {
      'entrada': 'Entrada',
      'saida': 'Saída',
      'intervalo_inicio': 'Início Intervalo',
      'intervalo_fim': 'Fim Intervalo'
    };
    return labels[tipo] || tipo;
  };

  const getTipoBadgeColor = (tipo: string) => {
    const colors: Record<string, string> = {
      'entrada': 'bg-green-100 text-green-700',
      'saida': 'bg-red-100 text-red-700',
      'intervalo_inicio': 'bg-yellow-100 text-yellow-700',
      'intervalo_fim': 'bg-blue-100 text-blue-700'
    };
    return colors[tipo] || 'bg-gray-100 text-gray-700';
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black text-gray-900 dark:text-white tracking-tight">Histórico de Registros</h2>
          <p className="text-sm font-bold text-gray-500 dark:text-gray-400 mt-1 uppercase tracking-widest">
            Auditoria e acompanhamento de ponto
          </p>
        </div>
        <button
          onClick={exportarPDF}
          className="flex items-center justify-center gap-2 px-5 py-2.5 bg-rose-500 hover:bg-rose-600 text-white rounded-xl shadow-lg shadow-rose-500/20 font-bold transition-all disabled:opacity-50"
        >
          <Download className="w-5 h-5" />
          Exportar PDF
        </button>
      </div>

      <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-4xl shadow-sm border border-gray-200/50 dark:border-gray-700/50 p-6 lg:p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-indigo-50 dark:bg-indigo-500/10 rounded-lg">
            <Filter className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <h3 className="font-bold text-gray-900 dark:text-white uppercase tracking-wider text-sm">Filtros Avançados</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
          <div>
            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-2">Funcionário</label>
            <select
              value={filtroFuncionarioId}
              onChange={(e) => {
                setFiltroFuncionarioId(e.target.value);
                setPage(1);
              }}
              className="w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-700 rounded-xl focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 bg-gray-50 hidden md:block dark:bg-gray-900/50 text-gray-900 dark:text-white font-medium transition-all"
            >
              <option value="">Todos os Colaboradores</option>
              {funcionarios.map(f => (
                <option key={f.id} value={f.id}>{f.nome}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-2">Data Início</label>
            <input
              type="date"
              value={filtroDataInicio}
              onChange={(e) => {
                setFiltroDataInicio(e.target.value);
                setPage(1);
              }}
              className="w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-700 rounded-xl focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 bg-gray-50 dark:bg-gray-900/50 text-gray-900 dark:text-white font-medium transition-all fill-current"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-2">Data Fim</label>
            <input
              type="date"
              value={filtroDataFim}
              onChange={(e) => {
                setFiltroDataFim(e.target.value);
                setPage(1);
              }}
              className="w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-700 rounded-xl focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 bg-gray-50 dark:bg-gray-900/50 text-gray-900 dark:text-white font-medium transition-all"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-2">Tipo de Marcação</label>
            <select
              value={filtroTipo}
              onChange={(e) => {
                setFiltroTipo(e.target.value);
                setPage(1);
              }}
              className="w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-700 rounded-xl focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 bg-gray-50 dark:bg-gray-900/50 text-gray-900 dark:text-white font-medium transition-all"
            >
              <option value="">Todas as Marcações</option>
              <option value="entrada">Entrada</option>
              <option value="saida">Saída</option>
              <option value="intervalo_inicio">Início Intervalo</option>
              <option value="intervalo_fim">Fim Intervalo</option>
            </select>
          </div>

          <div className="flex items-end">
            <button
              onClick={limparFiltros}
              className="w-full px-4 py-3 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-bold rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700 transition-all border-2 border-transparent"
            >
              Limpar Filtros
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-4xl shadow-sm border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-4 text-gray-600">Carregando registros...</p>
            </div>
          </div>
        ) : error ? (
          <div className="p-8 m-6 bg-rose-50 dark:bg-rose-500/10 border-2 border-rose-200 dark:border-rose-500/20 rounded-2xl">
            <div className="flex items-center gap-4 text-rose-700 dark:text-rose-400">
              <div className="p-3 bg-rose-100 dark:bg-rose-500/20 rounded-xl">
                <AlertCircle className="w-8 h-8" />
              </div>
              <div>
                <h3 className="text-lg font-black tracking-tight">Erro no Carregamento</h3>
                <p className="text-sm font-medium mt-1 opacity-80">{error}</p>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-900/50 border-b-2 border-gray-100 dark:border-gray-800">
                    <th className="px-6 py-5 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest whitespace-nowrap">Data</th>
                    <th className="px-6 py-5 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest whitespace-nowrap">Hora</th>
                    <th className="px-6 py-5 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest w-full">Funcionário</th>
                    <th className="px-6 py-5 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest whitespace-nowrap">Cargo</th>
                    <th className="px-6 py-5 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest whitespace-nowrap">Tipo</th>
                    <th className="px-6 py-5 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest whitespace-nowrap">Atraso</th>
                    <th className="px-6 py-5 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest whitespace-nowrap">Extras</th>
                    <th className="px-6 py-5 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest">Observação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {registros.length > 0 ? (
                    registros.map((registro) => (
                      <tr key={registro.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/40 transition-colors group">
                        <td className="px-6 py-4">
                          <span className="font-bold text-gray-900 dark:text-white whitespace-nowrap">
                            {new Date(registro.data).toLocaleDateString('pt-BR')}
                          </span>
                        </td>
                        <td className="px-6 py-4 font-black text-indigo-600 dark:text-indigo-400 tabular-nums">
                          {registro.hora}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-500/20 flex items-center justify-center">
                              <User className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                            </div>
                            <span className="font-bold text-gray-900 dark:text-white">{registro.funcionario_nome}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{registro.funcionario_cargo}</span>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-3 py-1 text-[11px] font-bold rounded-lg uppercase tracking-wider ${getTipoBadgeColor(registro.tipo)}`}>
                            {getTipoLabel(registro.tipo)}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          {registro.minutos_atraso && registro.minutos_atraso > 0 ? (
                            <span className="px-3 py-1 text-xs font-bold rounded-lg bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-400">
                              {registro.minutos_atraso}m
                            </span>
                          ) : (
                            <span className="text-gray-400 dark:text-gray-600 font-bold">-</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          {registro.minutos_extras && registro.minutos_extras > 0 ? (
                            <span className="px-3 py-1 text-xs font-bold rounded-lg bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400">
                              {(registro.minutos_extras / 60).toFixed(1)}h
                            </span>
                          ) : (
                            <span className="text-gray-400 dark:text-gray-600 font-bold">-</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-gray-500 dark:text-gray-400 text-sm font-medium max-w-[200px] truncate" title={registro.observacao}>
                          {registro.observacao || '-'}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8} className="px-6 py-16 text-center">
                        <div className="inline-flex flex-col items-center justify-center">
                          <div className="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mb-4">
                            <Clock className="w-8 h-8 text-gray-400" />
                          </div>
                          <p className="text-gray-500 dark:text-gray-400 font-bold">Nenhum registro encontrado</p>
                          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Ajuste os filtros para tentar novamente.</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {pages > 1 && (
              <div className="flex items-center justify-between px-8 py-5 bg-gray-50/50 dark:bg-gray-900/30 border-t border-gray-100 dark:border-gray-800">
                <div className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest">
                  Mostrando {((page - 1) * perPage) + 1} a {Math.min(page * perPage, total)} de {total}
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setPage(Math.max(1, page - 1))}
                    disabled={page === 1}
                    className="p-2 border-2 border-gray-200 dark:border-gray-700 rounded-xl text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>

                  <span className="px-4 py-2 text-sm font-black text-gray-900 dark:text-white bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
                    {page} <span className="text-gray-400 font-medium">/ {pages}</span>
                  </span>

                  <button
                    onClick={() => setPage(Math.min(pages, page + 1))}
                    disabled={page === pages}
                    className="p-2 border-2 border-gray-200 dark:border-gray-700 rounded-xl text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
