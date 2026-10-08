import { useState, useEffect } from 'react';
import { Clock, Filter, TrendingUp, TrendingDown, Minus, User, AlertCircle } from 'lucide-react';
import { apiClient } from '../../../api/apiClient';

interface BancoHorasRegistro {
  id: number;
  funcionario_id: number;
  funcionario_nome: string;
  funcionario_cargo: string;
  mes_referencia: string;
  saldo_minutos: number;
  saldo_horas: number;
  saldo_formatado: string;
  valor_hora_extra: number;
  horas_trabalhadas: number;
  horas_esperadas: number;
  status: 'positivo' | 'negativo' | 'zerado';
}

interface Funcionario {
  id: number;
  nome: string;
  cargo: string;
}

export default function BancoHorasRH() {
  const [registros, setRegistros] = useState<BancoHorasRegistro[]>([]);
  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filtroFuncionarioId, setFiltroFuncionarioId] = useState<string>('');
  const [filtroMes, setFiltroMes] = useState<string>('');

  useEffect(() => {
    loadFuncionarios();
  }, []);

  useEffect(() => {
    loadBancoHoras();
  }, [filtroFuncionarioId, filtroMes]);

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

  const loadBancoHoras = async () => {
    try {
      setLoading(true);
      setError(null);
      const params: any = {};
      if (filtroFuncionarioId) params.funcionario_id = filtroFuncionarioId;
      if (filtroMes) params.mes_referencia = filtroMes;

      const response = await apiClient.get('/rh/banco-horas', { params });
      setRegistros(response.data?.data || []);
    } catch (err: any) {
      console.error('Erro ao carregar banco de horas:', err);
      setError(err.message || 'Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    if (status === 'positivo') return <TrendingUp className="w-4 h-4 text-green-600" />;
    if (status === 'negativo') return <TrendingDown className="w-4 h-4 text-red-600" />;
    return <Minus className="w-4 h-4 text-gray-400" />;
  };

  const getStatusBadge = (status: string) => {
    if (status === 'positivo') return 'bg-green-100 text-green-700 border-green-200';
    if (status === 'negativo') return 'bg-red-100 text-red-700 border-red-200';
    return 'bg-gray-100 text-gray-600 border-gray-200';
  };

  // Resumo totais
  const totalPositivo = registros.filter(r => r.status === 'positivo').length;
  const totalNegativo = registros.filter(r => r.status === 'negativo').length;
  const saldoGeral = registros.reduce((acc, r) => acc + r.saldo_horas, 0);

  // Meses únicos para filtro
  const mesesUnicos = [...new Set(registros.map(r => r.mes_referencia))].sort().reverse();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black text-gray-900 dark:text-white tracking-tight">Banco de Horas</h2>
          <p className="text-sm font-bold text-gray-500 dark:text-gray-400 mt-1 uppercase tracking-widest">Controle de saldos de horas extras e devidas</p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-4xl shadow-sm border border-gray-200/50 dark:border-gray-700/50 p-6">
          <div className="flex items-center gap-4">
            <div className="p-4 bg-blue-50 dark:bg-blue-500/10 rounded-2xl">
              <Clock className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-[10px] text-gray-500 dark:text-gray-400 font-bold uppercase tracking-widest">Registros</p>
              <p className="text-2xl font-black text-gray-900 dark:text-white mt-0.5">{registros.length}</p>
            </div>
          </div>
        </div>
        <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-4xl shadow-sm border border-gray-200/50 dark:border-gray-700/50 p-6">
          <div className="flex items-center gap-4">
            <div className="p-4 bg-emerald-50 dark:bg-emerald-500/10 rounded-2xl">
              <TrendingUp className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="text-[10px] text-gray-500 dark:text-gray-400 font-bold uppercase tracking-widest">Saldo Positivo</p>
              <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-0.5">{totalPositivo}</p>
            </div>
          </div>
        </div>
        <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-4xl shadow-sm border border-gray-200/50 dark:border-gray-700/50 p-6">
          <div className="flex items-center gap-4">
            <div className="p-4 bg-rose-50 dark:bg-rose-500/10 rounded-2xl">
              <TrendingDown className="w-6 h-6 text-rose-600 dark:text-rose-400" />
            </div>
            <div>
              <p className="text-[10px] text-gray-500 dark:text-gray-400 font-bold uppercase tracking-widest">Saldo Negativo</p>
              <p className="text-2xl font-black text-rose-600 dark:text-rose-400 mt-0.5">{totalNegativo}</p>
            </div>
          </div>
        </div>
        <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-4xl shadow-sm border border-gray-200/50 dark:border-gray-700/50 p-6">
          <div className="flex items-center gap-4">
            <div className={`p-4 rounded-2xl ${saldoGeral >= 0 ? 'bg-emerald-50 dark:bg-emerald-500/10' : 'bg-rose-50 dark:bg-rose-500/10'}`}>
              <Clock className={`w-6 h-6 ${saldoGeral >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`} />
              <Clock className={`w-5 h-5 ${saldoGeral >= 0 ? 'text-emerald-600' : 'text-red-600'}`} />
            </div>
            <div>
              <p className="text-[10px] text-gray-500 dark:text-gray-400 font-bold uppercase tracking-widest">Saldo Geral</p>
              <p className={`text-2xl font-black mt-0.5 ${saldoGeral >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                {saldoGeral >= 0 ? '+' : ''}{saldoGeral.toFixed(1)}h
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Filtros Container */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-4xl shadow-sm border border-gray-200/50 dark:border-gray-700/50 p-6 sticky top-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-indigo-50 dark:bg-indigo-500/10 rounded-lg">
                <Filter className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              </div>
              <h3 className="font-bold text-gray-900 dark:text-white uppercase tracking-wider text-sm">Filtros</h3>
            </div>

            <div className="space-y-5">
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-2">Funcionário</label>
                <select
                  value={filtroFuncionarioId}
                  onChange={(e) => setFiltroFuncionarioId(e.target.value)}
                  className="w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-700 rounded-xl focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 bg-gray-50 dark:bg-gray-900/50 text-gray-900 dark:text-white font-medium transition-all"
                >
                  <option value="">Todos</option>
                  {funcionarios.map(f => (
                    <option key={f.id} value={f.id}>{f.nome}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-2">Mês Referência</label>
                <select
                  value={filtroMes}
                  onChange={(e) => setFiltroMes(e.target.value)}
                  className="w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-700 rounded-xl focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 bg-gray-50 dark:bg-gray-900/50 text-gray-900 dark:text-white font-medium transition-all"
                >
                  <option value="">Todos os meses</option>
                  {mesesUnicos.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Tabela */}
        <div className="lg:col-span-3 bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-4xl shadow-sm border border-gray-200/50 dark:border-gray-700/50 overflow-hidden relative">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto"></div>
                <p className="mt-4 text-gray-600">Carregando banco de horas...</p>
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
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-900/50 border-b-2 border-gray-100 dark:border-gray-800 text-gray-500 dark:text-gray-400 font-bold text-xs uppercase tracking-widest">
                    <th className="px-6 py-5 whitespace-nowrap">Funcionário</th>
                    <th className="px-6 py-5 whitespace-nowrap">Cargo</th>
                    <th className="px-6 py-5 whitespace-nowrap">Mês</th>
                    <th className="px-6 py-5 text-right whitespace-nowrap">H. Trabalhadas</th>
                    <th className="px-6 py-5 text-right whitespace-nowrap">H. Esperadas</th>
                    <th className="px-6 py-5 text-center whitespace-nowrap">Saldo</th>
                    <th className="px-6 py-5 text-right whitespace-nowrap">Valor H/E</th>
                    <th className="px-6 py-5 text-center whitespace-nowrap">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {registros.length > 0 ? (
                    registros.map((r) => (
                      <tr key={r.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/40 transition-colors group">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-indigo-100 dark:bg-indigo-500/20 rounded-full flex items-center justify-center">
                              <User className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                            </div>
                            <span className="font-bold text-gray-900 dark:text-white">{r.funcionario_nome}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{r.funcionario_cargo || '-'}</span>
                        </td>
                        <td className="px-6 py-4 font-black text-gray-800 dark:text-gray-200 tracking-wider text-sm">{r.mes_referencia}</td>
                        <td className="px-6 py-4 text-right font-black text-indigo-600 dark:text-indigo-400">{r.horas_trabalhadas}h</td>
                        <td className="px-6 py-4 text-right font-black text-gray-500 dark:text-gray-400">{r.horas_esperadas}h</td>
                        <td className="px-6 py-4 text-center">
                          <span className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg border-2 dark:border-transparent ${getStatusBadge(r.status)}`}>
                            {getStatusIcon(r.status)}
                            {r.saldo_formatado}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right font-black text-gray-900 dark:text-emerald-400">
                          R$ {r.valor_hora_extra.toFixed(2)}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span className={`px-3 py-1 text-[11px] font-bold rounded-lg uppercase tracking-wider ${r.status === 'positivo' ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400' :
                            r.status === 'negativo' ? 'bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-400' :
                              'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                            }`}>
                            {r.status === 'positivo' ? 'Crédito' : r.status === 'negativo' ? 'Débito' : 'Zerado'}
                          </span>
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
                          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Acumule saldo para visualizar os dados de banco de horas.</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
