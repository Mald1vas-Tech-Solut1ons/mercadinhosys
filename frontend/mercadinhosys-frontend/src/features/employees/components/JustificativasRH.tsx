import { ProtectedDocumentLink } from '@/components/common/ProtectedDocumentLink';
import { useState, useEffect } from 'react';
import { Upload, Download, AlertCircle, CheckCircle, Clock, Filter, ThumbsUp, ThumbsDown, X } from 'lucide-react';
import { apiClient } from '../../../api/apiClient';

interface Justificativa {
  id: number;
  funcionario_id: number;
  funcionario_nome: string;
  tipo: 'atraso' | 'ausencia';
  data: string;
  motivo: string;
  documento_url?: string;
  status: 'pendente' | 'aprovado' | 'rejeitado';
  created_at: string;
  observacao_gerente?: string;
}

interface Funcionario {
  id: number;
  nome: string;
  cargo: string;
}

export default function JustificativasRH() {
  const [justificativas, setJustificativas] = useState<Justificativa[]>([]);
  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filtroFuncionario, setFiltroFuncionario] = useState<string>('');
  const [filtroTipo, setFiltroTipo] = useState<string>('');
  const [filtroStatus, setFiltroStatus] = useState<string>('');

  const [modalAberto, setModalAberto] = useState(false);
  const [modalRespostaAberto, setModalRespostaAberto] = useState(false);
  const [justificativaSelecionada, setJustificativaSelecionada] = useState<Justificativa | null>(null);
  const [acaoResposta, setAcaoResposta] = useState<'aprovar' | 'rejeitar'>('aprovar');
  const [motivoRejeicao, setMotivoRejeicao] = useState('');
  const [respondendo, setRespondendo] = useState(false);
  const [novaJustificativa, setNovaJustificativa] = useState({
    funcionario_id: '',
    tipo: 'atraso' as 'atraso' | 'ausencia',
    data: '',
    motivo: '',
    documento: null as File | null
  });

  useEffect(() => {
    loadFuncionarios();
    loadJustificativas();
  }, [filtroFuncionario, filtroTipo, filtroStatus]);

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

  const loadJustificativas = async () => {
    try {
      setLoading(true);
      const params: any = {};
      if (filtroFuncionario) params.funcionario_id = filtroFuncionario;
      if (filtroTipo) params.tipo = filtroTipo;
      if (filtroStatus) params.status = filtroStatus;

      const response = await apiClient.get('/rh/justificativas', { params });
      setJustificativas(response.data?.data || []);
    } catch (err: any) {
      console.error('Erro ao carregar justificativas:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitJustificativa = async () => {
    if (!novaJustificativa.funcionario_id || !novaJustificativa.data || !novaJustificativa.motivo) {
      alert('Preencha todos os campos obrigatórios');
      return;
    }

    try {
      const formData = new FormData();
      formData.append('funcionario_id', novaJustificativa.funcionario_id);
      formData.append('tipo', novaJustificativa.tipo);
      formData.append('data', novaJustificativa.data);
      formData.append('motivo', novaJustificativa.motivo);
      if (novaJustificativa.documento) {
        formData.append('documento', novaJustificativa.documento);
      }

      await apiClient.post('/rh/justificativas', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      setModalAberto(false);
      setNovaJustificativa({
        funcionario_id: '',
        tipo: 'atraso',
        data: '',
        motivo: '',
        documento: null
      });
      loadJustificativas();
    } catch (err: any) {
      alert('Erro ao salvar justificativa: ' + err.message);
    }
  };

  const abrirModalResposta = (justificativa: Justificativa, acao: 'aprovar' | 'rejeitar') => {
    setJustificativaSelecionada(justificativa);
    setAcaoResposta(acao);
    setMotivoRejeicao('');
    setModalRespostaAberto(true);
  };

  const handleResponderJustificativa = async () => {
    if (!justificativaSelecionada) return;
    if (acaoResposta === 'rejeitar' && !motivoRejeicao.trim()) {
      alert('Informe o motivo da rejeição');
      return;
    }

    try {
      setRespondendo(true);
      const payload: any = { acao: acaoResposta };
      if (acaoResposta === 'rejeitar') {
        payload.motivo_rejeicao = motivoRejeicao;
      }

      await apiClient.put(`/rh/justificativas/${justificativaSelecionada.id}/responder`, payload);
      setModalRespostaAberto(false);
      setJustificativaSelecionada(null);
      loadJustificativas();
    } catch (err: any) {
      alert('Erro ao responder justificativa: ' + (err?.response?.data?.message || err.message));
    } finally {
      setRespondendo(false);
    }
  };



  const getStatusIcon = (status: string) => {
    if (status === 'aprovado') return <CheckCircle className="w-4 h-4" />;
    if (status === 'rejeitado') return <AlertCircle className="w-4 h-4" />;
    return <Clock className="w-4 h-4" />;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black text-gray-900 dark:text-white tracking-tight">Justificativas e Documentos</h2>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mt-1">Gerenciamento de ausências, atestados e atrasos</p>
        </div>
        <button
          onClick={() => setModalAberto(true)}
          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-lg shadow-indigo-600/20 font-bold transition-all flex items-center gap-2"
        >
          <Upload className="w-5 h-5" />
          Nova Justificativa
        </button>
      </div>

      {/* Filtros */}
      <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-2xl shadow-sm p-6 border border-gray-200/50 dark:border-gray-700/50">
        <div className="flex items-center gap-2 mb-4">
          <Filter className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          <h3 className="font-bold text-gray-900 dark:text-white">Filtros</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Funcionário</label>
            <select
              value={filtroFuncionario}
              onChange={(e) => setFiltroFuncionario(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900/50 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
            >
              <option value="">Todos os Funcionários</option>
              {funcionarios.map(f => (
                <option key={f.id} value={f.id}>{f.nome}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Categoria</label>
            <select
              value={filtroTipo}
              onChange={(e) => setFiltroTipo(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900/50 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
            >
              <option value="">Todas</option>
              <option value="atraso">Atrasos</option>
              <option value="ausencia">Ausências/Faltas</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Status da Análise</label>
            <select
              value={filtroStatus}
              onChange={(e) => setFiltroStatus(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900/50 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
            >
              <option value="">Qualquer Status</option>
              <option value="pendente">Aguardando Análise</option>
              <option value="aprovado">Aprovado</option>
              <option value="rejeitado">Rejeitado</option>
            </select>
          </div>
        </div>
      </div>

      {/* Tabela */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700/50 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-4 text-gray-600">Carregando justificativas...</p>
            </div>
          </div>
        ) : error ? (
          <div className="p-6 bg-red-50 border border-red-200 rounded-xl">
            <div className="flex items-center gap-3 text-red-700">
              <AlertCircle className="w-6 h-6" />
              <div>
                <h3 className="font-bold">Erro ao carregar justificativas</h3>
                <p className="text-sm">{error}</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-50/50 dark:bg-gray-900/50 text-gray-500 dark:text-gray-400 font-bold border-b border-gray-200 dark:border-gray-700/80">
                <tr>
                  <th className="px-5 py-4 uppercase tracking-wider text-xs">Funcionário</th>
                  <th className="px-5 py-4 uppercase tracking-wider text-xs">Tipo</th>
                  <th className="px-5 py-4 uppercase tracking-wider text-xs">Data</th>
                  <th className="px-5 py-4 uppercase tracking-wider text-xs">Motivo</th>
                  <th className="px-5 py-4 uppercase tracking-wider text-xs">Documento</th>
                  <th className="px-5 py-4 uppercase tracking-wider text-xs">Status</th>
                  <th className="px-5 py-4 uppercase tracking-wider text-xs text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {justificativas.length > 0 ? (
                  justificativas.map((j) => (
                    <tr key={j.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/80 transition-colors">
                      <td className="px-5 py-4">
                        <p className="font-semibold text-gray-900 dark:text-white">{j.funcionario_nome}</p>
                      </td>
                      <td className="px-5 py-4">
                        <span className={`px-2.5 py-1 text-xs font-bold rounded-md ${j.tipo === 'atraso' ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400' : 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400'
                          }`}>
                          {j.tipo === 'atraso' ? 'Atraso' : 'Ausência'}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-gray-700 dark:text-gray-300 font-medium">{new Date(j.data).toLocaleDateString('pt-BR')}</td>
                      <td className="px-5 py-4 text-gray-600 dark:text-gray-400 max-w-xs truncate" title={j.motivo}>{j.motivo}</td>
                      <td className="px-5 py-4">
                        {j.documento_url ? (
                          <ProtectedDocumentLink url={j.documento_url} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 rounded-md font-bold text-xs uppercase tracking-wider transition-colors">
                            <Download className="w-3.5 h-3.5" />
                            Abrir
                          </ProtectedDocumentLink>
                        ) : (
                          <span className="text-gray-400 dark:text-gray-600 italic text-xs">Sem anexo</span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold rounded-md w-fit ${j.status === 'pendente' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400' : j.status === 'aprovado' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400' : 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400'}`}>
                          {getStatusIcon(j.status)}
                          {j.status === 'pendente' ? 'Em Análise' : j.status === 'aprovado' ? 'Aprovado' : 'Rejeitado'}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        {j.status === 'pendente' ? (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => abrirModalResposta(j, 'aprovar')}
                              className="p-1.5 bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition-colors"
                              title="Aprovar Justificativa"
                            >
                              <ThumbsUp className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => abrirModalResposta(j, 'rejeitar')}
                              className="p-1.5 bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400 rounded-lg hover:bg-rose-100 dark:hover:bg-rose-500/20 transition-colors"
                              title="Rejeitar Justificativa"
                            >
                              <ThumbsDown className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400 dark:text-gray-500 italic">
                            Decidido
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="px-5 py-12 text-center text-gray-500 dark:text-gray-400">
                      Nenhuma justificativa encontrada com os filtros atuais
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      {/* Modal Nova Justificativa */}
      {modalAberto && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-100 p-4 overflow-y-auto" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))', paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200 my-auto">
            <div className="p-6 border-b border-gray-100 dark:border-gray-700/80 flex items-center justify-between">
              <h3 className="text-xl font-black text-gray-900 dark:text-white">Nova Justificativa</h3>
              <button onClick={() => setModalAberto(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              <div>
                <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Funcionário *</label>
                <select
                  value={novaJustificativa.funcionario_id}
                  onChange={(e) => setNovaJustificativa({ ...novaJustificativa, funcionario_id: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 bg-gray-50 dark:bg-gray-900/50 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                >
                  <option value="">Selecione o funcionário</option>
                  {funcionarios.map(f => (
                    <option key={f.id} value={f.id}>{f.nome}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Categoria *</label>
                  <select
                    value={novaJustificativa.tipo}
                    onChange={(e) => setNovaJustificativa({ ...novaJustificativa, tipo: e.target.value as 'atraso' | 'ausencia' })}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 bg-gray-50 dark:bg-gray-900/50 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                  >
                    <option value="atraso">Atraso</option>
                    <option value="ausencia">Ausência Integral</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Data *</label>
                  <input
                    type="date"
                    value={novaJustificativa.data}
                    onChange={(e) => setNovaJustificativa({ ...novaJustificativa, data: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 bg-gray-50 dark:bg-gray-900/50 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Motivo / Explicação *</label>
                <textarea
                  value={novaJustificativa.motivo}
                  onChange={(e) => setNovaJustificativa({ ...novaJustificativa, motivo: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 bg-gray-50 dark:bg-gray-900/50 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all resize-none"
                  rows={3}
                  placeholder="Descreva detalhadamente o motivo..."
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Anexar Documento (Opcional)</label>
                <input
                  type="file"
                  onChange={(e) => setNovaJustificativa({ ...novaJustificativa, documento: e.target.files?.[0] || null })}
                  className="w-full px-4 py-2 text-sm text-gray-500 dark:text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 dark:file:bg-indigo-500/10 dark:file:text-indigo-400 dark:hover:file:bg-indigo-500/20 cursor-pointer border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-900/50"
                />
                <p className="text-[10px] text-gray-400 mt-2">Formatos suportados: PDF, JPG, PNG. Máx 5MB.</p>
              </div>
            </div>

            <div className="p-6 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-100 dark:border-gray-700/80 flex gap-3">
              <button
                onClick={() => setModalAberto(false)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 font-bold text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSubmitJustificativa}
                className="flex-1 px-4 py-2.5 bg-indigo-600 text-white rounded-xl font-bold shadow-lg shadow-indigo-600/20 hover:bg-indigo-700 transition-colors"
              >
                Registrar
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Modal Responder Justificativa */}
      {modalRespostaAberto && justificativaSelecionada && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-100 p-4 overflow-y-auto" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))', paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200 my-auto">
            <div className={`p-6 border-b flex items-center justify-between ${acaoResposta === 'aprovar' ? 'bg-emerald-50/50 dark:bg-emerald-500/5 border-emerald-100 dark:border-emerald-500/10' : 'bg-rose-50/50 dark:bg-rose-500/5 border-rose-100 dark:border-rose-500/10'}`}>
              <h3 className={`text-lg font-black ${acaoResposta === 'aprovar' ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>
                {acaoResposta === 'aprovar' ? 'Aprovar Justificativa' : 'Rejeitar Justificativa'}
              </h3>
              <button onClick={() => setModalRespostaAberto(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6">
              <div className="bg-gray-50 dark:bg-gray-900/50 rounded-xl p-4 mb-6 border border-gray-100 dark:border-gray-700/50 space-y-3">
                <div className="flex justify-between items-start">
                  <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-widest font-bold">Colaborador</p>
                  <p className="text-sm font-bold text-gray-900 dark:text-white text-right">{justificativaSelecionada.funcionario_nome}</p>
                </div>
                <div className="flex justify-between items-center border-t border-gray-200 dark:border-gray-700/50 pt-2">
                  <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-widest font-bold">Data & Tipo</p>
                  <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                    {new Date(justificativaSelecionada.data).toLocaleDateString('pt-BR')} • {justificativaSelecionada.tipo === 'atraso' ? 'Atraso' : 'Ausência'}
                  </p>
                </div>
                <div className="border-t border-gray-200 dark:border-gray-700/50 pt-2">
                  <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-widest font-bold mb-1">Motivo Informado</p>
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-800 p-2 rounded-lg border border-gray-100 dark:border-gray-700/50">{justificativaSelecionada.motivo}</p>
                </div>
              </div>

              {acaoResposta === 'aprovar' ? (
                <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-xl p-4 mb-6 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/10 rounded-bl-full -mr-4 -mt-4"></div>
                  <div className="flex items-center gap-3 text-emerald-700 dark:text-emerald-400 relative z-10">
                    <CheckCircle className="w-6 h-6" />
                    <p className="text-sm font-bold">Confirma a aprovação desta justificativa? O sistema irá abonar a falta/atraso correspondente.</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4 mb-6">
                  <div className="bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-xl p-4 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-rose-500/10 rounded-bl-full -mr-4 -mt-4"></div>
                    <div className="flex items-center gap-3 text-rose-700 dark:text-rose-400 relative z-10">
                      <AlertCircle className="w-6 h-6" />
                      <p className="text-sm font-bold">A justificativa será rejeitada. As penalidades automáticas (descontos) serão aplicadas.</p>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Comentário/Motivo da Rejeição *</label>
                    <textarea
                      value={motivoRejeicao}
                      onChange={(e) => setMotivoRejeicao(e.target.value)}
                      className="w-full px-4 py-3 border border-rose-200 dark:border-rose-500/30 rounded-xl focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-white outline-none transition-all resize-none"
                      rows={3}
                      placeholder="Descreva o motivo para a rejeição do documento..."
                    />
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setModalRespostaAberto(false)}
                  className="flex-1 px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl font-bold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  disabled={respondendo}
                >
                  Cancelar
                </button>
                <button
                  onClick={handleResponderJustificativa}
                  disabled={respondendo}
                  className={`flex-1 px-4 py-2.5 text-white rounded-xl font-bold transition-all flex items-center justify-center gap-2 ${acaoResposta === 'aprovar'
                    ? 'bg-emerald-600 hover:bg-emerald-700 shadow-lg shadow-emerald-600/20'
                    : 'bg-rose-600 hover:bg-rose-700 shadow-lg shadow-rose-600/20'
                    }`}
                >
                  {respondendo ? (
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                  ) : (
                    <>
                      {acaoResposta === 'aprovar' ? <ThumbsUp className="w-5 h-5" /> : <ThumbsDown className="w-5 h-5" />}
                      Confirmar
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
