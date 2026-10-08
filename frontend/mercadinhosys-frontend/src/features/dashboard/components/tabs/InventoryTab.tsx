import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Package, AlertTriangle, ArrowDownRight, ChartBar, PieChart as PieChartIcon, BarChart3 } from 'lucide-react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { formatCurrency } from '../../../../utils/formatters';

interface InventoryTabProps {
  data: any;
}

export default function InventoryTab({ data }: InventoryTabProps) {
  const navigate = useNavigate();
  const inventoryValue = data?.inventory?.total_value?.value || data?.inventory?.valor_total || 0;
  const abc = data?.inventory?.abc_analysis || data?.abc || {};

  // Normaliza os produtos vindos do backend (campos: classificacao, id, faturamento)
  // para os nomes que a tabela usa. Sem isso, classe/id/faturamento vinham vazios.
  const produtosNormalizados = (abc?.produtos || abc?.itens || []).map((p: any) => ({
    id: p.id ?? p.produto_id,
    nome: p.nome,
    classe: p.classificacao ?? p.classe ?? 'C',
    faturamento: p.faturamento ?? p.valor_total ?? 0,
    percentual_acumulado: p.percentual_acumulado ?? 0,
  }));



  const [selectedABC, setSelectedABC] = useState<'all' | 'A' | 'B' | 'C'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState<{key: string, direction: 'asc' | 'desc'} | null>(null);

  // Aplica filtros de pesquisa e aba
  let filteredProducts = selectedABC === 'all'
    ? [...produtosNormalizados]
    : produtosNormalizados.filter((p: any) => p.classe === selectedABC);

  if (searchTerm) {
    filteredProducts = filteredProducts.filter((p: any) => 
      p.nome?.toLowerCase().includes(searchTerm.toLowerCase()) || 
      p.id?.toString().includes(searchTerm)
    );
  }

  // Cálculos dinâmicos baseados APENAS no que está visível na tela
  const dynamicAbcResumo = {
    A: { faturamento_total: 0, quantidade: 0 },
    B: { faturamento_total: 0, quantidade: 0 },
    C: { faturamento_total: 0, quantidade: 0 },
  };

  filteredProducts.forEach((p: any) => {
    const c = (p.classe || 'C') as 'A' | 'B' | 'C';
    if (dynamicAbcResumo[c]) {
      dynamicAbcResumo[c].faturamento_total += (p.faturamento || 0);
      dynamicAbcResumo[c].quantidade += 1;
    }
  });

  const dynamicTotalABC = dynamicAbcResumo.A.faturamento_total + dynamicAbcResumo.B.faturamento_total + dynamicAbcResumo.C.faturamento_total;

  if (sortConfig) {
    filteredProducts.sort((a: any, b: any) => {
      if (a[sortConfig.key] < b[sortConfig.key]) {
        return sortConfig.direction === 'asc' ? -1 : 1;
      }
      if (a[sortConfig.key] > b[sortConfig.key]) {
        return sortConfig.direction === 'asc' ? 1 : -1;
      }
      return 0;
    });
  }

  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      
      {/* Resumo Estoque - KPIs Globais (Reativos ao Filtro) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-slate-800/80 backdrop-blur-xl rounded-3xl p-6 border border-gray-200 dark:border-slate-700/60 shadow-xl relative overflow-hidden group hover:border-blue-500/30 transition-colors">
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl group-hover:bg-blue-500/20 transition-all"></div>
          <div className="flex items-center gap-3 mb-4">
             <div className="p-3 bg-blue-500/10 rounded-xl border border-blue-500/20 text-blue-400">
               <Package className="w-5 h-5" />
             </div>
             <h3 className="text-gray-600 dark:text-slate-300 font-bold tracking-wide">{searchTerm || selectedABC !== 'all' ? 'Faturamento Filtrado' : 'Capital Imobilizado'}</h3>
          </div>
          <div className="text-4xl font-black text-gray-900 dark:text-white tracking-tight mb-2">
            {formatCurrency(searchTerm || selectedABC !== 'all' ? dynamicTotalABC : inventoryValue)}
          </div>
          <p className="text-sm text-gray-500 dark:text-slate-400 font-medium">{searchTerm || selectedABC !== 'all' ? 'Geração de caixa dos produtos listados' : 'Valor total alocado em mercadorias globais'}</p>
        </div>
        
        <div
          onClick={() => navigate('/products?filtro=baixo')}
          title="Ver produtos com estoque baixo"
          className="bg-white dark:bg-slate-800/80 backdrop-blur-xl rounded-3xl p-6 border border-gray-200 dark:border-slate-700/60 shadow-xl relative overflow-hidden group hover:border-amber-500/30 transition-colors cursor-pointer">
          <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/10 rounded-full blur-3xl group-hover:bg-amber-500/20 transition-all"></div>
          <div className="flex items-center gap-3 mb-4">
             <div className="p-3 bg-amber-500/10 rounded-xl border border-amber-500/20 text-amber-400">
               <AlertTriangle className="w-5 h-5" />
             </div>
             <h3 className="text-gray-600 dark:text-slate-300 font-bold tracking-wide">{searchTerm || selectedABC !== 'all' ? 'Produtos Encontrados' : 'Risco de Ruptura'}</h3>
          </div>
          <div className="text-4xl font-black text-amber-400 tracking-tight mb-2">
            {searchTerm || selectedABC !== 'all' ? filteredProducts.length : (data?.inventory?.low_stock_alert?.value || 0)} <span className="text-xl text-amber-500/70 font-medium">itens</span>
          </div>
          <p className="text-sm text-amber-400/80 font-medium group-hover:text-amber-300 flex items-center gap-1">{searchTerm || selectedABC !== 'all' ? 'Quantidade visível no filtro' : 'Ver estoque baixo globais →'}</p>
        </div>

        <div
          onClick={() => navigate('/products?filtro=classe_c')}
          title="Ver produtos Classe C (baixo giro)"
          className="bg-white dark:bg-slate-800/80 backdrop-blur-xl rounded-3xl p-6 border border-gray-200 dark:border-slate-700/60 shadow-xl relative overflow-hidden group hover:border-red-500/30 transition-colors cursor-pointer">
          <div className="absolute top-0 right-0 w-32 h-32 bg-red-500/10 rounded-full blur-3xl group-hover:bg-red-500/20 transition-all"></div>
          <div className="flex items-center gap-3 mb-4">
             <div className="p-3 bg-red-500/10 rounded-xl border border-red-500/20 text-red-400">
               <ArrowDownRight className="w-5 h-5" />
             </div>
             <h3 className="text-gray-600 dark:text-slate-300 font-bold tracking-wide">Curva C {searchTerm || selectedABC !== 'all' ? 'Filtrada' : '(Lentidão)'}</h3>
          </div>
          <div className="text-4xl font-black text-gray-900 dark:text-white tracking-tight mb-2">
            {formatCurrency(dynamicAbcResumo.C.faturamento_total)}
          </div>
          <p className="text-sm text-red-400/80 font-medium group-hover:text-red-300">Faturamento gerado pela Classe C listada →</p>
        </div>
      </div>

      {/* Curva ABC de Pareto - Reconstrução Detalhada */}
      <div className="bg-white dark:bg-slate-800/80 backdrop-blur-xl rounded-3xl border border-gray-200 dark:border-slate-700/60 shadow-2xl overflow-hidden">
        
        {/* Header ABC */}
        <div className="p-6 border-b border-gray-200 dark:border-slate-700/60 bg-white dark:bg-slate-800/90 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
             <div className="p-3 bg-linear-to-br from-indigo-400 to-indigo-600 rounded-2xl shadow-lg shadow-indigo-500/20">
               <ChartBar className="w-6 h-6 text-gray-900 dark:text-white" />
             </div>
             <div>
               <h2 className="text-xl font-black text-gray-900 dark:text-white tracking-tight">Curva ABC de Pareto</h2>
               <p className="text-sm text-gray-500 dark:text-slate-400 font-medium mt-1">
                 Análise 80/20 do Estoque • {abc?.pareto_80_20 ? <span className="text-emerald-400 font-bold">Lei Confirmada</span> : <span className="text-amber-400 font-bold">Distribuição Atípica</span>}
               </p>
             </div>
          </div>
          
          {/* Filtros ABC e Busca */}
          <div className="flex flex-col md:flex-row gap-4 items-center">
            <input 
              type="text" 
              placeholder="Buscar produto..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-gray-50 dark:bg-slate-900/50 border border-gray-200 dark:border-slate-700/50 text-gray-900 dark:text-white text-sm rounded-xl px-4 py-2 w-full md:w-64 focus:outline-none focus:border-blue-500/50 placeholder-slate-500"
            />
            <div className="flex bg-gray-50 dark:bg-slate-900/50 p-1 rounded-xl border border-gray-200 dark:border-slate-700/50">
             {(['all', 'A', 'B', 'C'] as const).map((classe) => (
               <button
                 key={classe}
                 onClick={() => setSelectedABC(classe)}
                 className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                   selectedABC === classe 
                     ? classe === 'A' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                     : classe === 'B' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                     : classe === 'C' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                     : 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'
                     : 'text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:text-white border border-transparent'
                 }`}
               >
                 {classe === 'all' ? 'Todos' : `Curva ${classe}`}
               </button>
             ))}
           </div>
          </div>
        </div>

        {/* Resumo Estatístico das 3 Classes Dinâmicas */}
        <div className="grid grid-cols-1 md:grid-cols-3 border-b border-gray-200 dark:border-slate-700/60">
          {(['A', 'B', 'C'] as const).map((classe) => {
             const dados = dynamicAbcResumo[classe];
             const percentual = dynamicTotalABC > 0 ? (dados.faturamento_total || 0) / dynamicTotalABC * 100 : 0;
             const isA = classe === 'A';
             const isB = classe === 'B';
             
             const ativo = selectedABC === classe;
             return (
               <div
                 key={classe}
                 onClick={() => setSelectedABC(ativo ? 'all' : classe)}
                 title={`Filtrar a lista pela Curva ${classe}`}
                 className={`p-6 cursor-pointer transition-colors ${classe !== 'C' ? 'border-b md:border-b-0 md:border-r border-gray-200 dark:border-slate-700/60' : ''} ${ativo ? 'bg-indigo-500/10 ring-1 ring-inset ring-indigo-500/40' : 'bg-white dark:bg-slate-800/30 hover:bg-gray-100 dark:hover:bg-slate-700/30'}`}>
                 <div className="flex items-center justify-between mb-4">
                   <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-lg shadow-inner ${
                     isA ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                     isB ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' :
                     'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                   }`}>
                     {classe}
                   </div>
                   <span className={`text-xs font-bold px-3 py-1 rounded-full ${
                     isA ? 'bg-emerald-500/10 text-emerald-400' :
                     isB ? 'bg-blue-500/10 text-blue-400' :
                     'bg-amber-500/10 text-amber-400'
                   }`}>
                     {percentual.toFixed(1)}% do Faturamento (Filtrado)
                   </span>
                 </div>
                 
                 <div className="space-y-1">
                   <p className="text-2xl font-black text-gray-900 dark:text-white">{formatCurrency(dados.faturamento_total)}</p>
                   <p className="text-sm text-gray-500 dark:text-slate-400 font-medium">Geração de Caixa Absoluta</p>
                 </div>
                 
                 <div className="mt-4 pt-4 border-t border-gray-200 dark:border-slate-700/40 flex justify-between text-sm">
                   <span className="text-gray-500 dark:text-slate-400">Total de Itens:</span>
                   <span className="text-gray-900 dark:text-white font-bold">{dados.quantidade} produtos</span>
                 </div>
               </div>
             );
          })}
        </div>

        {/* Gráficos Recharts Dinâmicos */}
        {filteredProducts.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6 border-b border-gray-200 dark:border-slate-700/60 bg-gray-50 dark:bg-slate-900/20">
            {/* Gráfico 1: Distribuição ABC */}
            <div className="bg-white dark:bg-slate-800/50 rounded-2xl p-4 border border-gray-200 dark:border-slate-700/50">
              <div className="flex items-center gap-2 mb-4">
                <PieChartIcon className="w-5 h-5 text-indigo-400" />
                <h3 className="text-gray-600 dark:text-slate-300 font-bold text-sm">Distribuição do Faturamento</h3>
              </div>
              <div className="h-[250px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', borderRadius: '0.75rem', color: '#f1f5f9' }}
                      itemStyle={{ fontWeight: 'bold', color: '#f8fafc' }}
                      labelStyle={{ color: '#94a3b8' }}
                      formatter={(value: number) => formatCurrency(value)}
                    />
                    <Pie
                      data={[
                        { name: 'Curva A', value: dynamicAbcResumo.A.faturamento_total, color: '#10b981' },
                        { name: 'Curva B', value: dynamicAbcResumo.B.faturamento_total, color: '#3b82f6' },
                        { name: 'Curva C', value: dynamicAbcResumo.C.faturamento_total, color: '#f59e0b' }
                      ].filter(d => d.value > 0)}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={5}
                    >
                      {[{ color: '#10b981' }, { color: '#3b82f6' }, { color: '#f59e0b' }].map((entry: any, index: number) => (
                        <Cell key={`cell-${index}`} fill={entry.color} stroke="rgba(0,0,0,0)" />
                      ))}
                    </Pie>
                    <Legend verticalAlign="bottom" height={36} wrapperStyle={{ fontSize: '12px', color: '#64748b' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Gráfico 2: Top 10 Produtos */}
            <div className="bg-white dark:bg-slate-800/50 rounded-2xl p-4 border border-gray-200 dark:border-slate-700/50">
              <div className="flex items-center gap-2 mb-4">
                <BarChart3 className="w-5 h-5 text-indigo-400" />
                <h3 className="text-gray-600 dark:text-slate-300 font-bold text-sm">Maiores Ofensores do Filtro (Top 10)</h3>
              </div>
              <div className="h-[250px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    layout="vertical"
                    data={[...filteredProducts].sort((a, b) => (b.faturamento || 0) - (a.faturamento || 0)).slice(0, 10).map(p => ({
                      nome: p.nome.length > 20 ? p.nome.substring(0, 20) + '...' : p.nome,
                      faturamento: p.faturamento || 0,
                      color: p.classe === 'A' ? '#10b981' : p.classe === 'B' ? '#3b82f6' : '#f59e0b'
                    }))}
                    margin={{ top: 0, right: 20, left: 20, bottom: 0 }}
                  >
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="nome" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} width={120} />
                    <Tooltip 
                      cursor={{ fill: 'rgba(255, 255, 255, 0.05)' }}
                      contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', borderRadius: '0.75rem', color: '#f1f5f9', fontSize: '12px' }}
                      itemStyle={{ fontWeight: 'bold', color: '#f8fafc' }}
                      labelStyle={{ color: '#94a3b8', fontWeight: 'bold', marginBottom: '4px' }}
                      formatter={(value: number) => [formatCurrency(value), 'Faturamento']}
                    />
                    <Bar dataKey="faturamento" radius={[0, 4, 4, 0]} maxBarSize={20}>
                      {
                        [...filteredProducts].sort((a, b) => (b.faturamento || 0) - (a.faturamento || 0)).slice(0, 10).map((entry: any, index) => (
                          <Cell key={`cell-${index}`} fill={entry.classe === 'A' ? '#10b981' : entry.classe === 'B' ? '#3b82f6' : '#f59e0b'} />
                        ))
                      }
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {/* Tabela de Produtos Detalhada */}
        <div className="p-0 overflow-x-auto max-h-[400px] overflow-y-auto custom-scrollbar">
          {filteredProducts.length === 0 ? (
             <div className="p-12 text-center flex flex-col items-center">
               <Package className="w-12 h-12 text-gray-400 dark:text-slate-600 mb-4" />
               <h3 className="text-lg font-bold text-gray-600 dark:text-slate-300">Nenhum produto analisado</h3>
               <p className="text-gray-400 dark:text-slate-500 mt-2">Sem histórico suficiente para processar a Curva ABC neste período.</p>
             </div>
          ) : (
            <table className="w-full text-left whitespace-nowrap">
              <thead className="sticky top-0 bg-gray-50 dark:bg-slate-900/90 backdrop-blur z-10">
                <tr className="text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700/60 text-xs uppercase tracking-wider font-bold">
                  <th className="px-6 py-4 cursor-pointer hover:text-gray-900 dark:text-white transition-colors select-none" onClick={() => handleSort('nome')}>
                    Produto {sortConfig?.key === 'nome' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                  </th>
                  <th className="px-6 py-4 cursor-pointer hover:text-gray-900 dark:text-white transition-colors select-none" onClick={() => handleSort('classe')}>
                    Classe {sortConfig?.key === 'classe' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                  </th>
                  <th className="px-6 py-4 text-right cursor-pointer hover:text-gray-900 dark:text-white transition-colors select-none" onClick={() => handleSort('faturamento')}>
                    Faturamento {sortConfig?.key === 'faturamento' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                  </th>
                  <th className="px-6 py-4 text-right cursor-pointer hover:text-gray-900 dark:text-white transition-colors select-none" onClick={() => handleSort('percentual_acumulado')}>
                    Acumulado {sortConfig?.key === 'percentual_acumulado' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700/50">
                {filteredProducts.map((p: any, idx: number) => {
                  const isA = p.classe === 'A';
                  const isB = p.classe === 'B';
                  const podeAbrir = !!p.id;
                  return (
                    <tr
                      key={idx}
                      onClick={() => podeAbrir && navigate(`/products/${p.id}`)}
                      className={`hover:bg-gray-100 dark:hover:bg-slate-700/20 transition-colors group ${podeAbrir ? 'cursor-pointer' : ''}`}
                      title={podeAbrir ? 'Abrir hub do produto' : undefined}
                    >
                      <td className="px-6 py-4">
                        <div className="font-bold text-gray-900 dark:text-white group-hover:text-indigo-400 transition-colors">{p.nome}</div>
                        <div className="text-xs text-gray-400 dark:text-slate-500 font-medium">ID: {p.id || '-'}</div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg font-bold shadow-inner ${
                          isA ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                          isB ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' :
                          'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        }`}>
                          {p.classe}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right font-black text-gray-900 dark:text-white">
                        {formatCurrency(p.faturamento)}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex flex-col items-end gap-1">
                           <span className="font-bold text-gray-600 dark:text-slate-300">{(p.percentual_acumulado || 0).toFixed(1)}%</span>
                           <div className="w-24 bg-white dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                             <div 
                               className={`h-full rounded-full ${
                                 isA ? 'bg-emerald-500' : isB ? 'bg-blue-500' : 'bg-amber-500'
                               }`}
                               style={{ width: `${Math.min(p.percentual_acumulado || 0, 100)}%` }}
                             ></div>
                           </div>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

    </div>
  );
}
