// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Calendar, Filter, Download, Eye, X, ChevronLeft, ChevronRight, Clock, MapPin, Camera,
  User, AlertCircle, CheckCircle, Navigation, ArrowLeft
} from 'lucide-react';
import { pontoService, RegistroPonto } from './pontoService';
import { authService } from '../../features/auth/authService';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

// Função auxiliar para construir URL completa da foto
const construirUrlFoto = (fotoUrl: string | null | undefined): string => {
  if (!fotoUrl) return '';
  
  // Se for URL completa, retorna como está
  if (fotoUrl.startsWith('http://') || fotoUrl.startsWith('https://')) {
    return fotoUrl;
  }
  
  // Em desenvolvimento, o proxy do Vite cuida de /uploads
  // Em produção, usar a mesma origem
  return fotoUrl;
};

const PontoHistoricoPage: React.FC = () => {
  const navigate = useNavigate();
  const [registros, setRegistros] = useState<RegistroPonto[]>([]);
  const [loading, setLoading] = useState(false);
  const [dataInicio, setDataInicio] = useState(
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  );
  const [dataFim, setDataFim] = useState(new Date().toISOString().split('T')[0]);
  const [tipoFiltro, setTipoFiltro] = useState<string | null>(null);
  const [statusFiltro, setStatusFiltro] = useState<string | null>(null);
  const [funcionarioFiltro, setFuncionarioFiltro] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [registroSelecionado, setRegistroSelecionado] = useState<RegistroPonto | null>(null);
  const [fotoExpandida, setFotoExpandida] = useState<string | null>(null);
  const [funcionarios, setFuncionarios] = useState<any[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const perPage = 15;

  useEffect(() => {
    const user = authService.getCurrentUser();
    const isUserAdmin = user?.role === 'ADMIN' || user?.role === 'GERENTE';
    setIsAdmin(isUserAdmin);

    if (isUserAdmin) {
      carregarFuncionarios();
    }
  }, []);

  useEffect(() => {
    carregarHistorico();
  }, [dataInicio, dataFim, page, tipoFiltro, statusFiltro, funcionarioFiltro]);

  const carregarFuncionarios = async () => {
    try {
      const response = await pontoService.obterFuncionarios();
      if (response.success) {
        setFuncionarios(response.data);
      }
    } catch (error) {
      console.error('Erro ao carregar funcionários:', error);
    }
  };

  const carregarHistorico = async () => {
    try {
      setLoading(true);
      const response = await pontoService.obterHistorico({
        data_inicio: dataInicio,
        data_fim: dataFim,
        page,
        per_page: perPage,
        funcionario_id: funcionarioFiltro || undefined
      });

      if (response.success) {
        let registrosFiltrados = response.data.registros;

        // Filtros locais (caso o backend não filtre tudo, mas o endpoint historico já filtra data/func)
        if (tipoFiltro) {
          registrosFiltrados = registrosFiltrados.filter(
            (r: RegistroPonto) => r.tipo_registro === tipoFiltro
          );
        }

        if (statusFiltro) {
          registrosFiltrados = registrosFiltrados.filter(
            (r: RegistroPonto) => r.status === statusFiltro
          );
        }

        console.log('📋 HISTÓRICO CARREGADO:', {
          quantidade: registrosFiltrados.length,
          registros: registrosFiltrados.map(r => ({
            id: r.id,
            tipo: r.tipo_registro,
            funcionario: r.funcionario_nome,
            foto_url: r.foto_url
          }))
        });

        setRegistros(registrosFiltrados);
        setTotalPages(Math.ceil(response.data.total / perPage) || 1); // Usa total do backend se disponível
      }
    } catch (error) {
      console.error('Erro ao carregar histórico:', error);
    } finally {
      setLoading(false);
    }
  };

  const exportarCSV = () => {
    const headers = ['Data', 'Hora', 'Funcionário', 'Tipo', 'Status', 'Atraso (min)'];
    const rows = registros.map(r => [
      r.data,
      r.hora,
      r.funcionario_nome || '-',
      r.tipo_registro,
      r.status,
      r.minutos_atraso || 0
    ]);

    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `historico_ponto_${dataInicio}_${dataFim}.csv`);
    link.click();
  };

  const getTipoLabel = (tipo: string) => {
    const labels = {
      'entrada': 'Entrada',
      'saida_almoco': 'Saída Almoço',
      'retorno_almoco': 'Retorno Almoço',
      'saida': 'Saída'
    };
    return labels[tipo] || tipo;
  };

  const getStatusBadge = (status: string) => {
    const colors = {
      'normal': 'bg-green-100 text-green-800',
      'atrasado': 'bg-red-100 text-red-800',
      'justificado': 'bg-blue-100 text-blue-800'
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  const registrosPorDia = registros.reduce((acc: any, r: RegistroPonto) => {
    const dia = r.data;
    const existente = acc.find((item: any) => item.data === dia);
    if (existente) {
      existente.total += 1;
      existente.atrasos += r.status === 'atrasado' ? 1 : 0;
    } else {
      acc.push({
        data: dia,
        total: 1,
        atrasos: r.status === 'atrasado' ? 1 : 0
      });
    }
    return acc;
  }, []);

  return (
    <div className="min-h-screen bg-linear-to-br from-blue-50 to-indigo-50 p-4 md:p-6">
      {/* HEADER */}
      <div className="mb-8">
        <button
          onClick={() => navigate('/ponto')}
          className="mb-4 flex items-center gap-2 px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition"
        >
          <ArrowLeft className="w-5 h-5" />
          Voltar
        </button>
        <h1 className="text-3xl md:text-4xl font-bold text-gray-900 flex items-center gap-3">
          <Calendar className="w-10 h-10 text-blue-600" />
          Histórico de Pontos
        </h1>
        <p className="text-gray-600 mt-2">Visualize, filtre e exporte seu histórico de registros</p>
      </div>

      {/* FILTROS */}
      <div className="bg-white rounded-2xl shadow-xl p-6 mb-8">
        <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
          <Filter className="w-6 h-6 text-blue-600" />
          Filtros
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
          <div>
            <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-2">Data Início</label>
            <input
              type="date"
              value={dataInicio}
              onChange={(e) => {
                setDataInicio(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 sm:px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none text-sm"
            />
          </div>

          <div>
            <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-2">Data Fim</label>
            <input
              type="date"
              value={dataFim}
              onChange={(e) => {
                setDataFim(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 sm:px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none text-sm"
            />
          </div>

          {isAdmin && (
            <div>
              <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-2">Funcionário</label>
              <select
                value={funcionarioFiltro || ''}
                onChange={(e) => {
                  setFuncionarioFiltro(e.target.value || null);
                  setPage(1);
                }}
                className="w-full px-3 sm:px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none text-sm"
              >
                <option value="">Todos</option>
                {funcionarios.map(f => (
                  <option key={f.id} value={f.id}>{f.nome}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-2">Tipo</label>
            <select
              value={tipoFiltro || ''}
              onChange={(e) => {
                setTipoFiltro(e.target.value || null);
                setPage(1);
              }}
              className="w-full px-3 sm:px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none text-sm"
            >
              <option value="">Todos</option>
              <option value="entrada">Entrada</option>
              <option value="saida_almoco">Saída Almoço</option>
              <option value="retorno_almoco">Retorno Almoço</option>
              <option value="saida">Saída</option>
            </select>
          </div>

          <div>
            <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-2">Status</label>
            <select
              value={statusFiltro || ''}
              onChange={(e) => {
                setStatusFiltro(e.target.value || null);
                setPage(1);
              }}
              className="w-full px-3 sm:px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none text-sm"
            >
              <option value="">Todos</option>
              <option value="normal">Normal</option>
              <option value="atrasado">Atrasado</option>
              <option value="justificado">Justificado</option>
            </select>
          </div>

          <div className="flex items-end">
            <button
              onClick={exportarCSV}
              disabled={registros.length === 0}
              className="w-full px-3 sm:px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2 text-sm font-semibold"
            >
              <Download className="w-4 sm:w-5 h-4 sm:h-5" />
              <span className="hidden sm:inline">CSV</span>
            </button>
          </div>
        </div>
      </div>

      {/* GRÁFICO */}
      <div className="bg-white rounded-2xl shadow-xl p-6 mb-8">
        <h3 className="text-lg font-bold text-gray-900 mb-4">Registros por Dia</h3>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={registrosPorDia}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="data" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="total" fill="#3b82f6" name="Total" />
              <Bar dataKey="atrasos" fill="#ef4444" name="Atrasos" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* TABELA */}
      <div className="bg-white rounded-2xl shadow-xl p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-4">Registros</h3>
        
        {loading ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="text-gray-600 mt-4">Carregando...</p>
          </div>
        ) : registros.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <Calendar className="w-12 h-12 mx-auto opacity-50 mb-4" />
            <p>Nenhum registro encontrado</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-100 border-b-2 border-gray-300">
                  <tr>
                    <th className="px-4 py-3 text-left font-bold">Data</th>
                    <th className="px-4 py-3 text-left font-bold">Hora</th>
                    {isAdmin && <th className="px-4 py-3 text-left font-bold">Funcionário</th>}
                    <th className="px-4 py-3 text-left font-bold">Tipo</th>
                    <th className="px-4 py-3 text-left font-bold">Status</th>
                    <th className="px-4 py-3 text-left font-bold">Atraso</th>
                    <th className="px-4 py-3 text-center font-bold">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {registros.map((r) => (
                    <tr key={r.id} className="border-b border-gray-200 hover:bg-gray-50">
                      <td className="px-4 py-3">{r.data}</td>
                      <td className="px-4 py-3 font-semibold">{r.hora}</td>
                      {isAdmin && (
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 text-xs font-bold">
                              {r.funcionario_nome ? r.funcionario_nome.charAt(0) : '?'}
                            </div>
                            <span className="font-medium text-gray-700">{r.funcionario_nome || 'Desconhecido'}</span>
                          </div>
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-semibold">
                          {getTipoLabel(r.tipo_registro)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusBadge(r.status)}`}>
                          {r.status === 'normal' ? '✅ Normal' : r.status === 'atrasado' ? '⚠️ Atrasado' : '📋 Justificado'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {r.minutos_atraso > 0 ? (
                          <span className="text-red-600 font-bold">{r.minutos_atraso}m</span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => setRegistroSelecionado(r)}
                          className="text-blue-600 hover:text-blue-800 font-semibold inline-flex items-center gap-1"
                        >
                          <Eye className="w-4 h-4" />
                          Ver
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* PAGINAÇÃO */}
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-gray-600">
                Página {page} de {totalPages}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page === 1}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-50"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                  disabled={page === totalPages}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-50"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* MODAL */}
      {registroSelecionado && (
        <div className="fixed inset-0 bg-black bg-opacity-75 z-100 flex items-center justify-center p-2 sm:p-4 overflow-y-auto" style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))', paddingTop: 'calc(0.5rem + env(safe-area-inset-top))' }}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden my-auto">
            <div className="bg-linear-to-r from-blue-600 to-indigo-600 p-4 sm:p-6 flex items-center justify-between text-white">
              <div className="flex-1">
                <h3 className="text-lg sm:text-2xl font-bold flex items-center gap-2">
                  <User className="w-5 sm:w-6 h-5 sm:h-6" />
                  Detalhes
                </h3>
                <p className="text-blue-100 text-xs sm:text-sm mt-1">
                  {getTipoLabel(registroSelecionado.tipo_registro)} - {registroSelecionado.hora}
                </p>
              </div>
              <button
                onClick={() => setRegistroSelecionado(null)}
                className="shrink-0 p-2 hover:bg-white/20 rounded-lg transition ml-2"
              >
                <X className="w-5 sm:w-6 h-5 sm:h-6" />
              </button>
            </div>

            <div className="p-4 sm:p-6 max-h-[calc(100vh-200px)] overflow-y-auto">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4 mb-4 sm:mb-6">
                <div className="p-2 sm:p-4 bg-blue-50 rounded-lg">
                  <p className="text-xs text-blue-600 font-semibold">📅 Data</p>
                  <p className="text-sm sm:text-lg font-bold text-gray-900 mt-1">{registroSelecionado.data}</p>
                </div>
                <div className="p-2 sm:p-4 bg-green-50 rounded-lg">
                  <p className="text-xs text-green-600 font-semibold">⏰ Horário</p>
                  <p className="text-sm sm:text-lg font-bold text-gray-900 mt-1">{registroSelecionado.hora}</p>
                </div>
                <div className="p-2 sm:p-4 bg-purple-50 rounded-lg">
                  <p className="text-xs text-purple-600 font-semibold">🏷️ Tipo</p>
                  <p className="text-lg font-bold text-gray-900 mt-1">{getTipoLabel(registroSelecionado.tipo_registro)}</p>
                </div>
                <div className={`p-4 rounded-lg ${registroSelecionado.status === 'atrasado' ? 'bg-red-50' : 'bg-green-50'}`}>
                  <p className={`text-xs font-semibold ${registroSelecionado.status === 'atrasado' ? 'text-red-600' : 'text-green-600'}`}>
                    Status
                  </p>
                  <p className="text-lg font-bold text-gray-900 mt-1">
                    {registroSelecionado.status === 'atrasado' ? '⚠️ Atrasado' : '✅ Normal'}
                  </p>
                </div>
              </div>

              {registroSelecionado.minutos_atraso > 0 && (
                <div className="p-4 bg-red-50 border-l-4 border-red-600 rounded-lg mb-6">
                  <p className="text-red-900 font-bold flex items-center gap-2">
                    <AlertCircle className="w-5 h-5" />
                    Atraso de {registroSelecionado.minutos_atraso} minutos
                  </p>
                </div>
              )}
              
              {registroSelecionado.funcionario_nome && (
                <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <p className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-2">
                    <User className="w-4 h-4 text-gray-500" />
                    Funcionário
                  </p>
                  <p className="text-lg font-bold text-gray-900">{registroSelecionado.funcionario_nome}</p>
                </div>
              )}

              {registroSelecionado.foto_url ? (
                <div className="mb-6">
                  <p className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                    <Camera className="w-5 h-5 text-blue-600" />
                    Foto
                  </p>
                  <img 
                    src={construirUrlFoto(registroSelecionado.foto_url)} 
                    alt="Foto" 
                    className="w-full rounded-lg shadow-lg max-h-[300px] object-cover cursor-pointer hover:opacity-90 transition-opacity"
                    onClick={() => setFotoExpandida(registroSelecionado.foto_url!)}
                    title="Clique para ampliar"
                    onError={(e) => {
                      console.error('❌ Erro ao carregar foto:', construirUrlFoto(registroSelecionado.foto_url));
                      e.currentTarget.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="300"%3E%3Crect fill="%23f0f0f0" width="400" height="300"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".3em" fill="%23999" font-size="16"%3EFoto não encontrada%3C/text%3E%3C/svg%3E';
                    }}
                  />
                </div>
              ) : (
                <div className="mb-6 p-4 bg-gray-100 rounded-lg border-2 border-dashed border-gray-400">
                  <p className="text-sm text-gray-600 flex items-center gap-2">
                    <Camera className="w-5 h-5 text-gray-400" />
                    Nenhuma foto
                  </p>
                </div>
              )}

              {registroSelecionado.latitude && registroSelecionado.longitude && (
                <div className="p-4 bg-blue-50 rounded-lg border-2 border-blue-300 mb-6">
                  <p className="text-sm font-semibold text-blue-900 mb-3 flex items-center gap-2">
                    <MapPin className="w-5 h-5" />
                    📍 Localização
                  </p>
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div className="bg-white p-3 rounded-lg">
                      <p className="text-xs text-gray-500 font-semibold">Latitude</p>
                      <p className="font-mono text-gray-900 font-bold mt-1">
                        {registroSelecionado.latitude.toFixed(6)}
                      </p>
                    </div>
                    <div className="bg-white p-3 rounded-lg">
                      <p className="text-xs text-gray-500 font-semibold">Longitude</p>
                      <p className="font-mono text-gray-900 font-bold mt-1">
                        {registroSelecionado.longitude.toFixed(6)}
                      </p>
                    </div>
                  </div>
                  <a
                    href={`https://www.google.com/maps/@${registroSelecionado.latitude},${registroSelecionado.longitude},15z`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold"
                  >
                    <Navigation className="w-4 h-4" />
                    Google Maps
                  </a>
                </div>
              )}
            </div>

            <div className="bg-gray-100 p-4 flex justify-end gap-2">
              <button
                onClick={() => setRegistroSelecionado(null)}
                className="px-4 sm:px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold text-sm sm:text-base transition"
              >
                ✕ Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE FOTO EXPANDIDA */}
      {fotoExpandida && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-90 z-100 flex items-center justify-center p-2 sm:p-4"
          style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))', paddingTop: 'calc(0.5rem + env(safe-area-inset-top))' }}
          onClick={() => setFotoExpandida(null)}
        >
          <div 
            className="relative w-full h-full sm:max-w-4xl sm:max-h-[90vh] flex flex-col items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Botão de fechar no topo (mobile first) */}
            <div className="absolute top-2 right-2 z-10 sm:hidden">
              <button
                onClick={() => setFotoExpandida(null)}
                className="p-2 bg-black bg-opacity-60 hover:bg-opacity-80 text-white rounded-full transition"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            
            {/* Foto */}
            <img 
              src={construirUrlFoto(fotoExpandida)} 
              alt="Foto ampliada" 
              className="w-full h-full sm:max-w-full sm:max-h-[70vh] object-contain rounded-lg shadow-2xl"
              onError={(e) => {
                console.error('❌ Erro ao carregar foto expandida:', construirUrlFoto(fotoExpandida));
              }}
            />
            
            {/* Controles */}
            <div className="mt-4 sm:mt-6 flex flex-col sm:flex-row gap-2 sm:gap-4 w-full px-4 sm:px-0">
              <button
                onClick={() => setFotoExpandida(null)}
                className="flex-1 sm:flex-none px-4 sm:px-6 py-2 sm:py-3 bg-white text-gray-900 rounded-lg hover:bg-gray-100 font-semibold transition flex items-center justify-center gap-2"
              >
                <X className="w-4 sm:w-5 h-4 sm:h-5" />
                <span className="hidden sm:inline">Fechar</span>
              </button>
              <a
                href={construirUrlFoto(fotoExpandida)}
                download
                className="flex-1 sm:flex-none px-4 sm:px-6 py-2 sm:py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold transition flex items-center justify-center gap-2"
              >
                <Download className="w-4 sm:w-5 h-4 sm:h-5" />
                <span className="hidden sm:inline">Baixar</span>
              </a>
            </div>

            {/* Dica */}
            <p className="text-white text-xs sm:text-sm mt-3 sm:mt-4 text-center px-4">Clique fora ou em Fechar para sair</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default PontoHistoricoPage;
