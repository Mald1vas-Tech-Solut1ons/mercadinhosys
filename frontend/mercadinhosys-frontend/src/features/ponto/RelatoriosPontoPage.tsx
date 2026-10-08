import React, { useState, useEffect } from 'react';
import {
  Filter, Download, AlertCircle,
  Briefcase, FileText,
  AlertTriangle
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from 'recharts';
import { pontoService } from './pontoService';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

interface RelatorioData {
  success: boolean;
  data: Record<string, unknown>;
}

interface TipoRelatorio {
  id: 'geral' | 'funcionario' | 'atrasos';
  label: string;
  desc: string;
}

interface Funcionario {
  id: number;
  nome: string;
  funcao: string;
}

const RelatoriosPontoPage: React.FC = () => {
  const [tipoRelatorio, setTipoRelatorio] = useState<'geral' | 'funcionario' | 'atrasos'>('geral');
  const [dataInicio, setDataInicio] = useState(
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  );
  const [dataFim, setDataFim] = useState(new Date().toISOString().split('T')[0]);
  const [funcionarioSelecionado, setFuncionarioSelecionado] = useState<number | null>(null);
  const [relatorioData, setRelatorioData] = useState<RelatorioData | null>(null);
  const [loading, setLoading] = useState(false);
  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([]);

  useEffect(() => {
    carregarFuncionarios();
  }, []);

  useEffect(() => {
    if (dataInicio && dataFim) {
      gerarRelatorio();
    }
  }, [tipoRelatorio, dataInicio, dataFim, funcionarioSelecionado]);

  const carregarFuncionarios = async () => {
    try {
      // API real aqui
      setFuncionarios([
        { id: 1, nome: 'João Silva', funcao: 'Vendedor' },
        { id: 2, nome: 'Maria Santos', funcao: 'Gerente' },
        { id: 3, nome: 'Pedro Costa', funcao: 'Operacional' }
      ]);
    } catch (error) {
      console.error('Erro ao carregar funcionários:', error);
    }
  };

  const gerarRelatorio = async () => {
    try {
      setLoading(true);
      const response = await pontoService.obterEstatisticas();
      
      if (response.success) {
        setRelatorioData(response as unknown as RelatorioData);
      }
    } catch (error) {
      console.error('Erro ao gerar relatório:', error);
    } finally {
      setLoading(false);
    }
  };

  const exportarPDF = async () => {
    if (!relatorioData) return;
    
    const element = document.getElementById('relatorio-container');
    if (!element) return;

    try {
      const canvas = await html2canvas(element);
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgWidth = 210;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      
      pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight);
      pdf.save(`relatorio_ponto_${dataInicio}_${dataFim}.pdf`);
    } catch (error) {
      console.error('Erro ao exportar PDF:', error);
      alert('Erro ao exportar PDF');
    }
  };

  const exportarCSV = () => {
    // Implementar exportação CSV
    console.log('Exportar CSV');
  };

  return (
    <div className="min-h-screen bg-linear-to-br from-blue-50 to-indigo-50 p-4 md:p-6">
      {/* HEADER */}
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-gray-900 flex items-center gap-3 mb-2">
          <FileText className="w-10 h-10 text-blue-600" />
          Relatórios Profissionais de Ponto
        </h1>
        <p className="text-gray-600">Análise completa de presença, atrasos e frequência da equipe</p>
      </div>

      {/* SELETOR DE RELATÓRIO */}
      <div className="bg-white rounded-2xl shadow-xl p-6 mb-8">
        <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
          <Filter className="w-6 h-6 text-blue-600" />
          Tipo de Relatório
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {[
            { id: 'geral' as const, label: '📊 Relatório Geral', desc: 'Visão geral de presença' },
            { id: 'funcionario' as const, label: '👤 Por Funcionário', desc: 'Detalhado de um funcionário' },
            { id: 'atrasos' as const, label: '⚠️ Atrasos', desc: 'Análise de atrasos e faltas' }
          ].map((rel: TipoRelatorio) => (
            <button
              key={rel.id}
              onClick={() => setTipoRelatorio(rel.id)}
              className={`p-4 rounded-lg border-2 transition text-left ${
                tipoRelatorio === rel.id
                  ? 'border-blue-600 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <p className="font-bold text-gray-900">{rel.label}</p>
              <p className="text-sm text-gray-600 mt-1">{rel.desc}</p>
            </button>
          ))}
        </div>

        {/* FILTROS */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Data Início</label>
            <input
              type="date"
              value={dataInicio}
              onChange={(e) => setDataInicio(e.target.value)}
              className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Data Fim</label>
            <input
              type="date"
              value={dataFim}
              onChange={(e) => setDataFim(e.target.value)}
              className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
            />
          </div>

          {tipoRelatorio === 'funcionario' && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Funcionário</label>
              <select
                value={funcionarioSelecionado || ''}
                onChange={(e) => setFuncionarioSelecionado(e.target.value ? parseInt(e.target.value) : null)}
                className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
              >
                <option value="">Selecione...</option>
                {funcionarios.map(f => (
                  <option key={f.id} value={f.id}>{f.nome}</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-end gap-2">
            <button
              onClick={exportarPDF}
              disabled={!relatorioData}
              className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2 font-semibold"
            >
              <Download className="w-5 h-5" />
              PDF
            </button>
            <button
              onClick={exportarCSV}
              disabled={!relatorioData}
              className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2 font-semibold"
            >
              <Download className="w-5 h-5" />
              CSV
            </button>
          </div>
        </div>
      </div>

      {/* RELATÓRIO GERAL */}
      {tipoRelatorio === 'geral' && (
        <div id="relatorio-container" className="space-y-6">
          {/* KPIs */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-linear-to-br from-green-500 to-emerald-600 rounded-2xl p-6 text-white">
              <p className="text-sm opacity-90 font-semibold">Taxa de Presença</p>
              <p className="text-4xl font-bold mt-1">94%</p>
              <p className="text-sm mt-2 opacity-90">28 de 30 dias</p>
            </div>
            <div className="bg-linear-to-br from-red-500 to-orange-600 rounded-2xl p-6 text-white">
              <p className="text-sm opacity-90 font-semibold">Total de Atrasos</p>
              <p className="text-4xl font-bold mt-1">2</p>
              <p className="text-sm mt-2 opacity-90">15 minutos no total</p>
            </div>
            <div className="bg-linear-to-br from-blue-500 to-cyan-600 rounded-2xl p-6 text-white">
              <p className="text-sm opacity-90 font-semibold">Funcionários Ativos</p>
              <p className="text-4xl font-bold mt-1">3</p>
              <p className="text-sm mt-2 opacity-90">Registrados no sistema</p>
            </div>
            <div className="bg-linear-to-br from-purple-500 to-pink-600 rounded-2xl p-6 text-white">
              <p className="text-sm opacity-90 font-semibold">Registros Totais</p>
              <p className="text-4xl font-bold mt-1">84</p>
              <p className="text-sm mt-2 opacity-90">No período</p>
            </div>
          </div>

          {/* GRÁFICO DE PRESENÇA */}
          <div className="bg-white rounded-2xl shadow-xl p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4">📈 Tendência de Presença</h3>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={[
                  { data: '1', presentes: 3, atrasos: 0, ausentes: 0 },
                  { data: '2', presentes: 2, atrasos: 1, ausentes: 0 },
                  { data: '3', presentes: 3, atrasos: 0, ausentes: 0 },
                  { data: '4', presentes: 3, atrasos: 0, ausentes: 0 },
                  { data: '5', presentes: 3, atrasos: 0, ausentes: 0 },
                ]}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="data" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="presentes" stroke="#10B981" strokeWidth={2} name="Presentes" />
                  <Line type="monotone" dataKey="atrasos" stroke="#F59E0B" strokeWidth={2} name="Atrasos" />
                  <Line type="monotone" dataKey="ausentes" stroke="#EF4444" strokeWidth={2} name="Ausentes" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* RANKING */}
          <div className="bg-white rounded-2xl shadow-xl p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4">🏆 Ranking de Presença</h3>
            <div className="space-y-3">
              {[
                { nome: 'João Silva', presenca: 100, atrasos: 0, faltas: 0 },
                { nome: 'Maria Santos', presenca: 96, atrasos: 1, faltas: 0 },
                { nome: 'Pedro Costa', presenca: 86, atrasos: 1, faltas: 1 }
              ].map((func, idx) => (
                <div key={idx} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="flex items-center gap-3">
                    <span className="text-xl font-bold text-blue-600">#{idx + 1}</span>
                    <div>
                      <p className="font-semibold text-gray-900">{func.nome}</p>
                      <p className="text-xs text-gray-500">{func.atrasos} atrasos • {func.faltas} faltas</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-green-600">{func.presenca}%</p>
                    <div className="w-32 h-2 bg-gray-200 rounded-full mt-1 overflow-hidden">
                      <div className="h-full bg-green-500 rounded-full" style={{ width: `${func.presenca}%` }}></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* RELATÓRIO POR FUNCIONÁRIO */}
      {tipoRelatorio === 'funcionario' && funcionarioSelecionado && (
        <div id="relatorio-container" className="space-y-6">
          <div className="bg-white rounded-2xl shadow-xl p-6">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-16 h-16 bg-linear-to-br from-blue-400 to-blue-600 rounded-full flex items-center justify-center text-white text-2xl font-bold">
                {funcionarios.find(f => f.id === funcionarioSelecionado)?.nome[0]}
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900">
                  {funcionarios.find(f => f.id === funcionarioSelecionado)?.nome}
                </h2>
                <p className="text-gray-600 flex items-center gap-2">
                  <Briefcase className="w-4 h-4" />
                  {funcionarios.find(f => f.id === funcionarioSelecionado)?.funcao}
                </p>
              </div>
            </div>

            {/* KPIs INDIVIDUAIS */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="p-4 bg-green-50 rounded-lg border-l-4 border-green-600">
                <p className="text-xs text-green-600 font-semibold">Presença</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">100%</p>
              </div>
              <div className="p-4 bg-yellow-50 rounded-lg border-l-4 border-yellow-600">
                <p className="text-xs text-yellow-600 font-semibold">Atrasos</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">0</p>
              </div>
              <div className="p-4 bg-red-50 rounded-lg border-l-4 border-red-600">
                <p className="text-xs text-red-600 font-semibold">Faltas</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">0</p>
              </div>
              <div className="p-4 bg-blue-50 rounded-lg border-l-4 border-blue-600">
                <p className="text-xs text-blue-600 font-semibold">Registros</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">28</p>
              </div>
            </div>

            {/* GRÁFICO INDIVIDUAL */}
            <div className="h-[300px] mb-6">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={[
                  { dia: '1ª', entrada: 1, almoco: 2, saida: 1 },
                  { dia: '2ª', entrada: 1, almoco: 2, saida: 1 },
                  { dia: '3ª', entrada: 1, almoco: 2, saida: 1 },
                  { dia: '4ª', entrada: 1, almoco: 2, saida: 1 },
                  { dia: '5ª', entrada: 1, almoco: 2, saida: 1 },
                ]}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="dia" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="entrada" fill="#10B981" name="Entrada" />
                  <Bar dataKey="almoco" fill="#3B82F6" name="Almoço" />
                  <Bar dataKey="saida" fill="#8B5CF6" name="Saída" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* ÚLTIMO REGISTRO */}
            <div className="p-4 bg-blue-50 rounded-lg border border-blue-300">
              <p className="text-sm font-semibold text-blue-900 mb-3">📋 Último Registro</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-gray-500">Data</p>
                  <p className="font-bold text-gray-900">05/02/2026</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Hora</p>
                  <p className="font-bold text-gray-900">18:00</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Tipo</p>
                  <p className="font-bold text-gray-900">Saída</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Status</p>
                  <p className="font-bold text-green-600">✅ Normal</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* RELATÓRIO DE ATRASOS */}
      {tipoRelatorio === 'atrasos' && (
        <div id="relatorio-container" className="space-y-6">
          <div className="bg-white rounded-2xl shadow-xl p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
              <AlertTriangle className="w-6 h-6 text-red-600" />
              Análise Detalhada de Atrasos
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="p-4 bg-red-50 rounded-lg border-l-4 border-red-600">
                <p className="text-xs text-red-600 font-semibold">Total de Atrasos</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">2</p>
              </div>
              <div className="p-4 bg-orange-50 rounded-lg border-l-4 border-orange-600">
                <p className="text-xs text-orange-600 font-semibold">Minutos Totais</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">15min</p>
              </div>
              <div className="p-4 bg-yellow-50 rounded-lg border-l-4 border-yellow-600">
                <p className="text-xs text-yellow-600 font-semibold">Média por Atraso</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">7.5min</p>
              </div>
            </div>

            {/* LISTA DE ATRASOS */}
            <div className="space-y-3">
              {[
                { data: '02/02/2026', funcionario: 'Maria Santos', hora: '08:05', atraso: '5min' },
                { data: '01/02/2026', funcionario: 'Pedro Costa', hora: '12:10', atraso: '10min' }
              ].map((atraso, idx) => (
                <div key={idx} className="p-4 bg-red-50 rounded-lg border-l-4 border-red-500 hover:bg-red-100 transition">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-gray-900">{atraso.funcionario}</p>
                      <p className="text-sm text-gray-600">{atraso.data} às {atraso.hora}</p>
                    </div>
                    <AlertCircle className="w-6 h-6 text-red-600" />
                  </div>
                  <p className="text-lg font-bold text-red-600 mt-2">Atraso: {atraso.atraso}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="text-gray-600 mt-4">Gerando relatório...</p>
        </div>
      )}
    </div>
  );
};

export default RelatoriosPontoPage;
