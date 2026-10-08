import React, { useState, useEffect } from 'react';
import { Gift, Plus, Trash2, Edit2, AlertCircle } from 'lucide-react';
import { apiClient } from '../../../api/apiClient';

interface Beneficio {
  id: number;
  funcionario_id: number;
  nome_beneficio: string;
  tipo: 'vale_refeicao' | 'vale_transporte' | 'vale_alimentacao' | 'seguro_saude' | 'outro';
  valor_mensal: number;
  data_inicio: string;
  data_fim?: string;
  ativo: boolean;
  observacao?: string;
}

interface Funcionario {
  id: number;
  nome: string;
  cargo: string;
}

export default function BeneficiosFuncionario() {
  const [beneficios, setBeneficios] = useState<Beneficio[]>([]);
  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filtroFuncionario, setFiltroFuncionario] = useState<string>('');
  const [filtroAtivos, setFiltroAtivos] = useState<string>('true');

  const [modalAberto, setModalAberto] = useState(false);
  const [novoBeneficio, setNovoBeneficio] = useState({
    funcionario_id: '',
    nome_beneficio: '',
    tipo: 'vale_refeicao' as any,
    valor_mensal: '',
    data_inicio: new Date().toISOString().split('T')[0],
    data_fim: '',
    observacao: ''
  });

  useEffect(() => {
    loadFuncionarios();
    loadBeneficios();
  }, [filtroFuncionario, filtroAtivos]);

  const loadFuncionarios = async () => {
    try {
      const response = await apiClient.get('/funcionarios', {
        params: { simples: true, por_pagina: 200, incluir_estatisticas: false },
      });
      const items = response?.data?.data || response?.data?.funcionarios || [];
      setFuncionarios(Array.isArray(items) ? items : []);
    } catch (err) {
      console.error('Erro ao carregar funcionários:', err);
    }
  };

  const loadBeneficios = async () => {
    try {
      setLoading(true);
      const params: any = {};
      if (filtroFuncionario) params.funcionario_id = filtroFuncionario;
      if (filtroAtivos) params.ativo = filtroAtivos === 'true';

      const response = await apiClient.get('/rh/beneficios', { params });
      setBeneficios(response.data?.data || []);
    } catch (err: any) {
      console.error('Erro ao carregar benefícios:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.post('/rh/beneficios', novoBeneficio);
      setModalAberto(false);
      loadBeneficios();
      setNovoBeneficio({
        funcionario_id: '',
        nome_beneficio: '',
        tipo: 'vale_refeicao',
        valor_mensal: '',
        data_inicio: new Date().toISOString().split('T')[0],
        data_fim: '',
        observacao: ''
      });
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black text-gray-900 dark:text-white tracking-tight flex items-center gap-3">
            <div className="p-3 bg-indigo-50 dark:bg-indigo-500/10 rounded-2xl">
              <Gift className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
            </div>
            Gestão de Benefícios
          </h2>
          <p className="text-sm font-bold text-gray-500 dark:text-gray-400 mt-2 uppercase tracking-widest pl-16">
            Controle de auxílios e Vales dos colaboradores
          </p>
        </div>
        <button
          onClick={() => setModalAberto(true)}
          className="flex items-center justify-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-lg shadow-indigo-500/20 font-bold transition-all disabled:opacity-50"
        >
          <Plus className="w-5 h-5" />
          Conceder Benefício
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Filtros */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-4xl shadow-sm border border-gray-200/50 dark:border-gray-700/50 p-6 sticky top-6">
            <div className="space-y-5">
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-2">Funcionário</label>
                <select
                  value={filtroFuncionario}
                  onChange={(e) => setFiltroFuncionario(e.target.value)}
                  className="w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-700 rounded-xl focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 bg-gray-50 dark:bg-gray-900/50 text-gray-900 dark:text-white font-medium transition-all"
                >
                  <option value="">Todos</option>
                  {funcionarios.map(func => (
                    <option key={func.id} value={func.id}>{func.nome}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-2">Status do Benefício</label>
                <select
                  value={filtroAtivos}
                  onChange={(e) => setFiltroAtivos(e.target.value)}
                  className="w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-700 rounded-xl focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 bg-gray-50 dark:bg-gray-900/50 text-gray-900 dark:text-white font-medium transition-all"
                >
                  <option value="">Todos</option>
                  <option value="true">Ativos</option>
                  <option value="false">Inativos</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Lista de Benefícios */}
        <div className="lg:col-span-3 bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-4xl shadow-sm border border-gray-200/50 dark:border-gray-700/50 overflow-hidden relative">
          {loading ? (
            <div className="flex justify-center py-20">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
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
                    <th className="px-6 py-5 whitespace-nowrap">Benefício</th>
                    <th className="px-6 py-5 whitespace-nowrap">Tipo</th>
                    <th className="px-6 py-5 whitespace-nowrap">Valor Mensal</th>
                    <th className="px-6 py-5 whitespace-nowrap text-center">Status</th>
                    <th className="px-6 py-5 whitespace-nowrap text-center">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {beneficios.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-16 text-center">
                        <div className="inline-flex flex-col items-center justify-center">
                          <div className="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mb-4">
                            <Gift className="w-8 h-8 text-gray-400" />
                          </div>
                          <p className="text-gray-500 dark:text-gray-400 font-bold">Nenhum benefício encontrado</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    beneficios.map((beneficio) => (
                      <tr key={beneficio.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/40 transition-colors group">
                        <td className="px-6 py-4">
                          <span className="font-bold text-gray-900 dark:text-white">{funcionarios.find(f => f.id === beneficio.funcionario_id)?.nome || '-'}</span>
                        </td>
                        <td className="px-6 py-4 font-black text-gray-700 dark:text-gray-300">{beneficio.nome_beneficio}</td>
                        <td className="px-6 py-4">
                          <span className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{beneficio.tipo.replace('_', ' ')}</span>
                        </td>
                        <td className="px-6 py-4 text-emerald-600 dark:text-emerald-400 font-black">R$ {beneficio.valor_mensal.toFixed(2)}</td>
                        <td className="px-6 py-4 text-center">
                          <span className={`px-3 py-1 text-[11px] font-bold rounded-lg uppercase tracking-wider ${beneficio.ativo ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>
                            {beneficio.ativo ? 'Ativo' : 'Inativo'}
                          </span>
                        </td>
                        <td className="px-6 py-4 flex items-center justify-center gap-2">
                          <button className="p-2 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/20 rounded-lg transition-colors">
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button className="p-2 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/20 rounded-lg transition-colors">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      {modalAberto && (
        <div className="fixed inset-0 z-100 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-gray-100 dark:border-gray-700 animate-in fade-in zoom-in-95 duration-200">
            <div className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-100 dark:border-gray-800 px-6 py-5">
              <h2 className="text-xl font-black text-gray-900 dark:text-white uppercase tracking-tight">Novo Benefício</h2>
            </div>
            <div className="p-6">
              <form onSubmit={handleSubmit}>
                <div className="space-y-5">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-2">Funcionário</label>
                    <select
                      value={novoBeneficio.funcionario_id}
                      onChange={(e) => setNovoBeneficio({ ...novoBeneficio, funcionario_id: e.target.value })}
                      className="w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-700 rounded-xl focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 bg-gray-50 dark:bg-gray-900/50 text-gray-900 dark:text-white font-medium transition-all"
                      required
                    >
                      <option value="">Selecione</option>
                      {funcionarios.map(func => (
                        <option key={func.id} value={func.id}>{func.nome}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-2">Nome do Benefício</label>
                    <input
                      type="text"
                      value={novoBeneficio.nome_beneficio}
                      onChange={(e) => setNovoBeneficio({ ...novoBeneficio, nome_beneficio: e.target.value })}
                      className="w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-700 rounded-xl focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 bg-gray-50 dark:bg-gray-900/50 text-gray-900 dark:text-white font-bold transition-all"
                      placeholder="Ex: Vale Cultura Mensal"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-2">Tipo</label>
                    <select
                      value={novoBeneficio.tipo}
                      onChange={(e) => setNovoBeneficio({ ...novoBeneficio, tipo: e.target.value })}
                      className="w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-700 rounded-xl focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 bg-gray-50 dark:bg-gray-900/50 text-gray-900 dark:text-white font-medium transition-all"
                    >
                      <option value="vale_refeicao">Vale Refeição</option>
                      <option value="vale_transporte">Vale Transporte</option>
                      <option value="vale_alimentacao">Vale Alimentação</option>
                      <option value="seguro_saude">Seguro Saúde</option>
                      <option value="outro">Outro</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-2">Valor Mensal (R$)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={novoBeneficio.valor_mensal}
                      onChange={(e) => setNovoBeneficio({ ...novoBeneficio, valor_mensal: e.target.value })}
                      className="w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-700 rounded-xl focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 bg-gray-50 dark:bg-gray-900/50 text-gray-900 dark:text-emerald-400 font-black transition-all"
                      placeholder="0.00"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-2">Data de Início</label>
                    <input
                      type="date"
                      value={novoBeneficio.data_inicio}
                      onChange={(e) => setNovoBeneficio({ ...novoBeneficio, data_inicio: e.target.value })}
                      className="w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-700 rounded-xl focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 bg-gray-50 dark:bg-gray-900/50 text-gray-900 dark:text-white font-medium transition-all fill-current"
                      required
                    />
                  </div>
                </div>
                <div className="flex gap-4 mt-8">
                  <button
                    type="button"
                    onClick={() => setModalAberto(false)}
                    className="flex-1 px-4 py-3 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 font-bold rounded-xl transition-all"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-lg shadow-indigo-500/20 transition-all"
                  >
                    Salvar Benefício
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
