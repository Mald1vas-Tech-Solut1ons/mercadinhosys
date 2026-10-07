import { useState, useEffect } from 'react';
import { X, Layers, AlertTriangle, CheckCircle, Clock, Package } from 'lucide-react';
import { apiClient } from '../../../api/apiClient';

interface Lote {
  id: number;
  numero_lote: string;
  quantidade: number;
  data_validade: string;
  data_entrada: string;
  preco_custo: number;
  ativo: boolean;
}

interface LotesResponse {
  produto_id: number;
  produto_nome: string;
  total_quantidade: number;
  lotes: Lote[];
  total_lotes: number;
}

interface Props {
  produtoId: number;
  produtoNome: string;
  onClose: () => void;
}

export default function LotesDisponiveisModal({ produtoId, produtoNome, onClose }: Props) {
  const [data, setData] = useState<LotesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadLotes();
  }, [produtoId]);

  const loadLotes = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await apiClient.get(`/produtos/${produtoId}/lotes-disponiveis`);
      setData(response.data);
    } catch (err: any) {
      console.error('Erro ao carregar lotes:', err);
      setError(err?.response?.data?.error || err.message || 'Erro ao carregar lotes');
    } finally {
      setLoading(false);
    }
  };

  const getDiasParaVencer = (dataValidade: string) => {
    const hoje = new Date();
    const validade = new Date(dataValidade);
    return Math.floor((validade.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
  };

  const getValidadeBadge = (dataValidade: string) => {
    const dias = getDiasParaVencer(dataValidade);
    if (dias < 0) return { classe: 'bg-red-100 text-red-700 border-red-200', icone: <AlertTriangle className="w-3.5 h-3.5" />, texto: `Vencido há ${Math.abs(dias)}d` };
    if (dias <= 7) return { classe: 'bg-red-100 text-red-700 border-red-200', icone: <AlertTriangle className="w-3.5 h-3.5" />, texto: `${dias}d para vencer` };
    if (dias <= 30) return { classe: 'bg-yellow-100 text-yellow-700 border-yellow-200', icone: <Clock className="w-3.5 h-3.5" />, texto: `${dias}d para vencer` };
    if (dias <= 90) return { classe: 'bg-blue-100 text-blue-700 border-blue-200', icone: <Clock className="w-3.5 h-3.5" />, texto: `${dias}d para vencer` };
    return { classe: 'bg-green-100 text-green-700 border-green-200', icone: <CheckCircle className="w-3.5 h-3.5" />, texto: `${dias}d para vencer` };
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-200 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90dvh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-purple-100 rounded-xl">
              <Layers className="w-6 h-6 text-purple-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Lotes Disponíveis (FIFO)</h2>
              <p className="text-sm text-gray-500">{produtoNome}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <div className="text-center">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-purple-600 mx-auto"></div>
                <p className="mt-3 text-gray-500 text-sm">Carregando lotes...</p>
              </div>
            </div>
          ) : error ? (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <div className="flex items-center gap-2 text-red-700">
                <AlertTriangle className="w-5 h-5" />
                <p className="font-medium">{error}</p>
              </div>
            </div>
          ) : data ? (
            <div className="space-y-5">
              {/* Summary Cards */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-purple-50 rounded-xl p-4 text-center border border-purple-100">
                  <p className="text-xs text-purple-600 font-medium">Total em Estoque</p>
                  <p className="text-2xl font-bold text-purple-700">{data.total_quantidade}</p>
                </div>
                <div className="bg-blue-50 rounded-xl p-4 text-center border border-blue-100">
                  <p className="text-xs text-blue-600 font-medium">Lotes Ativos</p>
                  <p className="text-2xl font-bold text-blue-700">{data.total_lotes}</p>
                </div>
                <div className="bg-amber-50 rounded-xl p-4 text-center border border-amber-100">
                  <p className="text-xs text-amber-600 font-medium">Prox. Vencimento</p>
                  <p className="text-lg font-bold text-amber-700">
                    {data.lotes.length > 0
                      ? `${getDiasParaVencer(data.lotes[0].data_validade)}d`
                      : '-'}
                  </p>
                </div>
              </div>

              {/* FIFO Info */}
              <div className="bg-linear-to-r from-purple-50 to-blue-50 border border-purple-100 rounded-xl p-4">
                <p className="text-sm text-purple-700">
                  <strong>FIFO ativo:</strong> Os lotes estao ordenados do mais proximo a vencer para o mais distante.
                  A venda consome automaticamente do lote mais antigo primeiro.
                </p>
              </div>

              {/* Lotes List */}
              {data.lotes.length > 0 ? (
                <div className="space-y-3">
                  {data.lotes.map((lote, idx) => {
                    const badge = getValidadeBadge(lote.data_validade);
                    return (
                      <div
                        key={lote.id}
                        className={`border rounded-xl p-4 transition-all ${
                          idx === 0 ? 'border-purple-200 bg-purple-50/30 ring-1 ring-purple-100' : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${
                              idx === 0 ? 'bg-purple-600 text-white' : 'bg-gray-200 text-gray-600'
                            }`}>
                              {idx + 1}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-bold text-gray-900">{lote.numero_lote}</span>
                                {idx === 0 && (
                                  <span className="px-2 py-0.5 bg-purple-600 text-white text-[10px] font-bold rounded-full uppercase">
                                    Proximo
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-gray-500 mt-0.5">
                                Entrada: {new Date(lote.data_entrada).toLocaleDateString('pt-BR')}
                                {lote.preco_custo > 0 && ` | Custo: R$ ${lote.preco_custo.toFixed(2)}`}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <div className="flex items-center gap-1.5">
                                <Package className="w-4 h-4 text-gray-400" />
                                <span className="font-bold text-gray-900">{lote.quantidade} un</span>
                              </div>
                            </div>
                            <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-full border ${badge.classe}`}>
                              {badge.icone}
                              {badge.texto}
                            </span>
                          </div>
                        </div>
                        {/* Progress bar for quantity */}
                        <div className="mt-3">
                          <div className="w-full bg-gray-200 rounded-full h-1.5">
                            <div
                              className={`h-1.5 rounded-full ${idx === 0 ? 'bg-purple-500' : 'bg-blue-400'}`}
                              style={{ width: `${Math.min(100, (lote.quantidade / (data.total_quantidade || 1)) * 100)}%` }}
                            ></div>
                          </div>
                          <p className="text-[10px] text-gray-400 mt-1">
                            {((lote.quantidade / (data.total_quantidade || 1)) * 100).toFixed(1)}% do estoque total
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-10 text-gray-400">
                  <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>Nenhum lote disponível para este produto</p>
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 p-4">
          <button
            onClick={onClose}
            className="w-full px-4 py-2.5 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-colors font-medium"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
