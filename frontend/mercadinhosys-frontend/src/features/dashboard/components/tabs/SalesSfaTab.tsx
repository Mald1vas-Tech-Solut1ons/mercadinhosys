import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Target, TrendingUp, Users, Award, AlertTriangle, PieChart as PieChartIcon, BarChart3, Activity, DollarSign, Package, ShoppingCart, Truck, CreditCard, Clock, Star } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell, CartesianGrid, AreaChart, Area } from 'recharts';
import { formatCurrency } from '../../../../utils/formatters';
import DetailsModal from '../DetailsModal';

interface SalesSfaTabProps {
  data: any;
}

export default function SalesSfaTab({ data }: SalesSfaTabProps) {
  const navigate = useNavigate();
  // O centro das atenções agora é o PDV (Vendas de Loja/Varejo)
  const [activeSubTab, setActiveSubTab] = useState<'pdv' | 'produtos' | 'clientes' | 'fornecedores' | 'sfa'>('pdv');
  const [selectedRfmSegment, setSelectedRfmSegment] = useState<string | null>(null);
  const [selectedCustomerDetails, setSelectedCustomerDetails] = useState<any | null>(null);
  const [selectedProductDetails, setSelectedProductDetails] = useState<any | null>(null);
  const [selectedCategoryDetails, setSelectedCategoryDetails] = useState<any | null>(null);

  // --- DADOS GERAIS (PDV / DASHBOARD) ---
  const vendasMes = data?.financials?.revenue || data?.summary?.revenue?.value || 0;
  const ticketMedio = data?.summary?.avg_ticket?.value || 0;
  const quantidadeVendas = data?.financials?.count || data?.summary?.revenue?.sample_size || 0;
  const vendasPorHora = data?.sales_by_hour || [];
  const vendasHistoricas = data?.timeseries || [];
  
  // Formas de pagamento — SEMPRE dados reais do backend (sem fallback fictício).
  // Rótulos legíveis para as chaves internas do PDV.
  const LABEL_PGTO: Record<string, string> = {
    pix: 'PIX', dinheiro: 'Dinheiro', cartao_credito: 'Cartão de Crédito',
    cartao_debito: 'Cartão de Débito', vale_alimentacao: 'Vale Alimentação',
    vale_refeicao: 'Vale Refeição', fiado: 'Fiado', boleto: 'Boleto',
  };
  const paymentMetrics = data?.payment_methods?.metricas || [];
  const formasPagamento = paymentMetrics.map((p: any) => ({
    name: LABEL_PGTO[p.forma_pagamento] || p.forma_pagamento || 'Outro',
    value: Number(p.total_valor || 0),
  }));

  // --- DADOS PRODUTOS ---
  const abcProdutos = data?.abc?.produtos || data?.analise_produtos?.curva_abc?.produtos || [];
  const [selectedClasseAbc, setSelectedClasseAbc] = useState<'A' | 'B' | 'C' | null>(null);
  const filteredAbcProdutos = selectedClasseAbc 
    ? abcProdutos.filter((p: any) => p.classificacao === selectedClasseAbc).slice(0, 15)
    : abcProdutos.slice(0, 10);
  const abcResumo = data?.abc?.resumo || data?.analise_produtos?.curva_abc?.resumo || { A: { faturamento_total: 0 }, B: { faturamento_total: 0 }, C: { faturamento_total: 0 } };

  // --- DADOS CLIENTES ---
  const rfmCustomers = data?.rfm?.customers || [];
  const filteredRfmCustomers = selectedRfmSegment 
    ? rfmCustomers.filter((c: any) => c.segmento === selectedRfmSegment || c.segment === selectedRfmSegment)
    : rfmCustomers;

  const uniqueCustomers = selectedRfmSegment 
    ? filteredRfmCustomers.length 
    : (data?.summary?.unique_customers || rfmCustomers.length || 0);

  const ticketMedioCliente = selectedRfmSegment
    ? (filteredRfmCustomers.length > 0 ? filteredRfmCustomers.reduce((acc: number, c: any) => acc + (c.monetary || 0), 0) / filteredRfmCustomers.length : 0)
    : (data?.summary?.avg_ticket?.value || 0);

  const rfmSegments = data?.rfm?.segments || {};
  const rfmChartData = Object.entries(rfmSegments).map(([name, value]) => ({ name, value: Number(value) || 0 }));
  
  const paymentMetricsForFiado = data?.payment_methods?.metricas || [];
  const fiadoPayment = paymentMetricsForFiado.find((p: any) => p.forma_pagamento?.toLowerCase() === 'fiado' || p.metodo?.toLowerCase() === 'fiado');
  const fiadoValueFromPayments = fiadoPayment ? Number(fiadoPayment.total_valor || fiadoPayment.total || 0) : 0;
  
  const totalFiado = (data?.fiado?.total_aberto && data?.fiado?.total_aberto > 0) ? data.fiado.total_aberto : fiadoValueFromPayments;
  
  const maiorDevedorNome = data?.fiado?.maior_devedor_nome || 'N/A';
  const maiorDevedorValor = data?.fiado?.maior_devedor_valor || 0;
  const bonsPagadores = data?.fiado?.bons_pagadores || [];

  // --- DADOS POR CATEGORIA (real, sem fallback fictício) ---
  const categoriasVendas = data?.hourly_sales_by_category
    ? Object.entries(data.hourly_sales_by_category).map(([cat, hours]: [string, any]) => {
        const total = Object.values(hours).reduce((acc: number, val: any) => acc + (val.faturamento || 0), 0);
        return { categoria: cat, total };
      }).sort((a, b) => b.total - a.total).slice(0, 8)
    : [];

  // --- DADOS FORNECEDORES (reais: faturamento gerado, compras, condição própria) ---
  const fornecedores = data?.fornecedores_performance || [];
  const fornTotalComprado = fornecedores.reduce((a: number, f: any) => a + (f.total_comprado || 0), 0);
  const fornSaldoAberto = fornecedores.reduce((a: number, f: any) => a + (f.saldo_aberto || 0), 0);
  const fornTotalPedidos = fornecedores.reduce((a: number, f: any) => a + (f.num_pedidos || 0), 0);

  // --- DADOS OPERADORES DE CAIXA (Vendedores / SFA) ---
  const vendedoresRaw = data?.sfa?.vendedores || [];
  const [selectedVendedorId, setSelectedVendedorId] = useState<number | string | null>(null);
  const selectedVendedor = useMemo(() => {
    return vendedoresRaw.find((v: any) => v.id === selectedVendedorId || v.nome === selectedVendedorId);
  }, [vendedoresRaw, selectedVendedorId]);

  const globalAlcancado = vendedoresRaw.reduce((acc: number, v: any) => acc + (v.alcancado || 0), 0);
  const globalMeta = vendedoresRaw.reduce((acc: number, v: any) => acc + (v.meta || 0), 0);
  const avgTendencia = vendedoresRaw.length > 0 ? vendedoresRaw.reduce((acc: number, v: any) => acc + (v.tendencia || 0), 0) / vendedoresRaw.length : 0;
  const totalVendasGlobal = vendedoresRaw.reduce((acc: number, v: any) => acc + (v.vendas_count || 0), 0);
  const ticketMedioGlobal = totalVendasGlobal > 0 ? globalAlcancado / totalVendasGlobal : 0;

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f43f5e'];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      
      {/* Cabeçalho Principal e Navegação */}
      <div className="bg-white dark:bg-slate-800/80 backdrop-blur-xl rounded-3xl p-6 border border-gray-200 dark:border-slate-700/60 shadow-xl flex flex-col gap-6">
        <div>
          <h2 className="text-2xl font-black text-gray-900 dark:text-white flex items-center gap-2">
            <ShoppingCart className="text-emerald-400" /> Central de Vendas (PDV)
          </h2>
          <p className="text-gray-500 dark:text-slate-400 text-sm mt-1 max-w-3xl">
            Acompanhe o desempenho de vendas da loja (Frente de Caixa), giro de produtos, comportamento de clientes e indicadores de fornecedores.
          </p>
        </div>

        {/* Sub-Navegação (Abas) */}
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setActiveSubTab('pdv')} className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm transition-all ${activeSubTab === 'pdv' ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/20' : 'bg-gray-50 dark:bg-slate-900/50 text-gray-500 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-800 hover:text-gray-900 dark:text-white border border-gray-200 dark:border-slate-700/50'}`}>
            <ShoppingCart size={16} /> Visão Geral PDV
          </button>
          <button onClick={() => setActiveSubTab('produtos')} className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm transition-all ${activeSubTab === 'produtos' ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'bg-gray-50 dark:bg-slate-900/50 text-gray-500 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-800 hover:text-gray-900 dark:text-white border border-gray-200 dark:border-slate-700/50'}`}>
            <Package size={16} /> Produtos (ABC)
          </button>
          <button onClick={() => setActiveSubTab('clientes')} className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm transition-all ${activeSubTab === 'clientes' ? 'bg-purple-600 text-white shadow-lg shadow-purple-500/20' : 'bg-gray-50 dark:bg-slate-900/50 text-gray-500 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-800 hover:text-gray-900 dark:text-white border border-gray-200 dark:border-slate-700/50'}`}>
            <Users size={16} /> Clientes & Fiado
          </button>
          <button onClick={() => setActiveSubTab('fornecedores')} className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm transition-all ${activeSubTab === 'fornecedores' ? 'bg-amber-600 text-white shadow-lg shadow-amber-500/20' : 'bg-gray-50 dark:bg-slate-900/50 text-gray-500 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-800 hover:text-gray-900 dark:text-white border border-gray-200 dark:border-slate-700/50'}`}>
            <Truck size={16} /> Fornecedores & Marcas
          </button>
          <button onClick={() => setActiveSubTab('sfa')} className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm transition-all ${activeSubTab === 'sfa' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' : 'bg-gray-50 dark:bg-slate-900/50 text-gray-500 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-800 hover:text-gray-900 dark:text-white border border-gray-200 dark:border-slate-700/50'}`}>
            <Award size={16} /> Vendedores & SFA
          </button>
        </div>
      </div>

      {/* =========================================================================================
          ABA PDV (VISÃO GERAL DO VAREJO)
      ========================================================================================= */}
      {activeSubTab === 'pdv' && (
        <div className="space-y-6 animate-in fade-in duration-500">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-white dark:bg-slate-800/80 rounded-3xl p-6 border border-gray-200 dark:border-slate-700/60 shadow-xl">
              <div className="flex items-center gap-3 mb-4"><div className="p-2 bg-emerald-500/10 rounded-xl text-emerald-400"><DollarSign className="w-5 h-5" /></div><h3 className="text-gray-600 dark:text-slate-300 font-bold text-sm">Faturamento PDV</h3></div>
              <div className="text-2xl xl:text-3xl font-black text-gray-900 dark:text-white tracking-tighter wrap-break-word">{formatCurrency(vendasMes)}</div>
            </div>
            <div className="bg-white dark:bg-slate-800/80 rounded-3xl p-6 border border-gray-200 dark:border-slate-700/60 shadow-xl">
              <div className="flex items-center gap-3 mb-4"><div className="p-2 bg-blue-500/10 rounded-xl text-blue-400"><ShoppingCart className="w-5 h-5" /></div><h3 className="text-gray-600 dark:text-slate-300 font-bold text-sm">Cupons Emitidos</h3></div>
              <div className="text-3xl xl:text-4xl font-black text-gray-900 dark:text-white tracking-tighter">{quantidadeVendas}</div>
            </div>
            <div className="bg-white dark:bg-slate-800/80 rounded-3xl p-6 border border-gray-200 dark:border-slate-700/60 shadow-xl">
              <div className="flex items-center gap-3 mb-4"><div className="p-2 bg-purple-500/10 rounded-xl text-purple-400"><Activity className="w-5 h-5" /></div><h3 className="text-gray-600 dark:text-slate-300 font-bold text-sm">Ticket Médio</h3></div>
              <div className="text-2xl xl:text-3xl font-black text-gray-900 dark:text-white tracking-tighter wrap-break-word">{formatCurrency(ticketMedio)}</div>
            </div>
            <div className="bg-white dark:bg-slate-800/80 rounded-3xl p-6 border border-gray-200 dark:border-slate-700/60 shadow-xl">
              <div className="flex items-center gap-3 mb-4"><div className="p-2 bg-amber-500/10 rounded-xl text-amber-400"><Clock className="w-5 h-5" /></div><h3 className="text-gray-600 dark:text-slate-300 font-bold text-sm">Pico de Movimento</h3></div>
              <div className="text-2xl xl:text-3xl font-black text-gray-900 dark:text-white tracking-tighter wrap-break-word">
                {vendasPorHora.length > 0 ? `${[...vendasPorHora].sort((a,b) => b.total - a.total)[0].hora}h` : '--'}
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800/80 rounded-3xl p-6 border border-gray-200 dark:border-slate-700/60 shadow-xl flex flex-col mb-6">
            <h3 className="text-gray-600 dark:text-slate-300 font-bold mb-6 flex items-center gap-2"><TrendingUp className="text-blue-400" /> Evolução de Faturamento (Histórico)</h3>
            <div className="h-[320px] w-full">
              {vendasHistoricas.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={vendasHistoricas} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorHistorico" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="data" stroke="#64748b" fontSize={11} tickFormatter={(d) => { if(!d) return ''; const parts = d.split('-'); return parts.length === 3 ? `${parts[2]}/${parts[1]}` : d; }} />
                    <YAxis stroke="#64748b" fontSize={11} tickFormatter={(val) => `R$${(val/1000).toFixed(0)}k`} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', borderRadius: '0.75rem' }} 
                      itemStyle={{ color: '#f8fafc', fontWeight: 'bold' }}
                      labelStyle={{ color: '#94a3b8' }}
                      formatter={(value: number) => formatCurrency(value)} 
                    />
                    <Area type="monotone" dataKey="valor" name="Faturamento" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorHistorico)" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-gray-400 dark:text-slate-500">Sem dados históricos de faturamento.</div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white dark:bg-slate-800/80 rounded-3xl p-6 border border-gray-200 dark:border-slate-700/60 shadow-xl flex flex-col">
              <h3 className="text-gray-600 dark:text-slate-300 font-bold mb-6 flex items-center gap-2"><BarChart3 className="text-emerald-400" /> Fluxo de Vendas por Horário</h3>
              <div className="h-[320px] w-full">
                {vendasPorHora.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={vendasPorHora} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="hora" stroke="#64748b" fontSize={11} tickFormatter={(h) => `${h}h`} />
                      <YAxis stroke="#64748b" fontSize={11} tickFormatter={(val) => `R$${(val/1000).toFixed(0)}k`} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', borderRadius: '0.75rem' }} 
                        itemStyle={{ color: '#f8fafc', fontWeight: 'bold' }}
                        labelStyle={{ color: '#94a3b8' }}
                        formatter={(value: number) => formatCurrency(value)} 
                      />
                      <Area type="monotone" dataKey="total" name="Faturamento" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorSales)" />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-gray-400 dark:text-slate-500">Sem dados de vendas por hora.</div>
                )}
              </div>
            </div>

            <div className="bg-white dark:bg-slate-800/80 rounded-3xl p-6 border border-gray-200 dark:border-slate-700/60 shadow-xl flex flex-col">
              <h3 className="text-gray-600 dark:text-slate-300 font-bold mb-2 flex items-center gap-2"><CreditCard className="text-blue-400" /> Formas de Pagamento</h3>
              <div className="h-[280px] w-full flex items-center justify-center mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', borderRadius: '0.75rem' }} 
                      itemStyle={{ color: '#f8fafc', fontWeight: 'bold' }}
                      labelStyle={{ color: '#94a3b8' }}
                      formatter={(value: number) => formatCurrency(value)} 
                    />
                    <Pie data={formasPagamento} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius="50%" outerRadius="80%" paddingAngle={2}>
                      {formasPagamento.map((_entry: any, index: number) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================================
          ABA PRODUTOS
      ========================================================================================= */}
      {activeSubTab === 'produtos' && (
        <div className="space-y-6 animate-in fade-in duration-500">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div onClick={() => setSelectedClasseAbc(null)} className={`bg-white dark:bg-slate-800/80 rounded-3xl p-6 border shadow-xl cursor-pointer transition-all ${selectedClasseAbc === null ? 'border-white ring-2 ring-white/20' : 'border-gray-200 dark:border-slate-700/60 hover:border-white/50'}`}>
              <h3 className="text-gray-500 dark:text-slate-400 font-bold text-sm mb-2">Total Acumulado (ABC)</h3>
              <div className="text-3xl font-black text-gray-900 dark:text-white">{formatCurrency((abcResumo?.A?.faturamento_total || 0) + (abcResumo?.B?.faturamento_total || 0) + (abcResumo?.C?.faturamento_total || 0))}</div>
            </div>
            <div onClick={() => setSelectedClasseAbc(selectedClasseAbc === 'A' ? null : 'A')} className={`bg-white dark:bg-slate-800/80 rounded-3xl p-6 border shadow-xl cursor-pointer transition-all ${selectedClasseAbc === 'A' ? 'border-emerald-500 ring-2 ring-emerald-500/20' : 'border-gray-200 dark:border-slate-700/60 hover:border-emerald-500/50'}`}>
              <h3 className="text-gray-500 dark:text-slate-400 font-bold text-sm mb-2">Classe A (80%)</h3>
              <div className="text-3xl font-black text-emerald-400">{formatCurrency(abcResumo?.A?.faturamento_total || 0)}</div>
            </div>
            <div onClick={() => setSelectedClasseAbc(selectedClasseAbc === 'B' ? null : 'B')} className={`bg-white dark:bg-slate-800/80 rounded-3xl p-6 border shadow-xl cursor-pointer transition-all ${selectedClasseAbc === 'B' ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-gray-200 dark:border-slate-700/60 hover:border-blue-500/50'}`}>
              <h3 className="text-gray-500 dark:text-slate-400 font-bold text-sm mb-2">Classe B (15%)</h3>
              <div className="text-3xl font-black text-blue-400">{formatCurrency(abcResumo?.B?.faturamento_total || 0)}</div>
            </div>
            <div onClick={() => setSelectedClasseAbc(selectedClasseAbc === 'C' ? null : 'C')} className={`bg-white dark:bg-slate-800/80 rounded-3xl p-6 border shadow-xl cursor-pointer transition-all ${selectedClasseAbc === 'C' ? 'border-amber-500 ring-2 ring-amber-500/20' : 'border-gray-200 dark:border-slate-700/60 hover:border-amber-500/50'}`}>
              <h3 className="text-gray-500 dark:text-slate-400 font-bold text-sm mb-2">Classe C (5%)</h3>
              <div className="text-3xl font-black text-amber-400">{formatCurrency(abcResumo?.C?.faturamento_total || 0)}</div>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800/80 rounded-3xl border border-gray-200 dark:border-slate-700/60 shadow-2xl p-6 flex flex-col">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-black text-gray-900 dark:text-white flex items-center gap-2">
                <Package className={selectedClasseAbc === 'A' ? 'text-emerald-400' : selectedClasseAbc === 'B' ? 'text-blue-400' : selectedClasseAbc === 'C' ? 'text-amber-400' : 'text-emerald-400'} /> 
                Curva ABC - Top Produtos {selectedClasseAbc ? `(Classe ${selectedClasseAbc})` : '(Visão Geral)'}
              </h3>
              {selectedClasseAbc && (
                <button onClick={() => setSelectedClasseAbc(null)} className="text-xs font-bold text-gray-600 dark:text-slate-300 bg-gray-100 dark:bg-slate-700/50 px-3 py-1 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors">
                  Limpar Filtro
                </button>
              )}
            </div>
            <div className="h-[400px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={filteredAbcProdutos} layout="vertical" margin={{ top: 0, right: 30, left: 100, bottom: 0 }}>
                  <XAxis type="number" stroke="#64748b" fontSize={12} tickFormatter={(val) => `R$${(val/1000).toFixed(0)}k`} />
                  <YAxis dataKey="nome" type="category" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} width={150} />
                  <Tooltip 
                    cursor={{ fill: 'rgba(255, 255, 255, 0.05)' }} 
                    contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', borderRadius: '0.75rem' }} 
                    itemStyle={{ color: '#f8fafc', fontWeight: 'bold' }}
                    labelStyle={{ color: '#94a3b8' }}
                    formatter={(value: number) => formatCurrency(value)} 
                  />
                  <Bar 
                    dataKey="faturamento" 
                    name="Faturamento" 
                    radius={[0, 4, 4, 0]} 
                    barSize={20}
                    onClick={(entry) => setSelectedProductDetails({ ...entry, tipo: 'produto' })}
                  >
                    {filteredAbcProdutos.map((entry: any, index: number) => {
                      const baseColor = entry.classificacao === 'A' ? '#10b981' : entry.classificacao === 'B' ? '#3b82f6' : '#f59e0b';
                      const isSelected = selectedProductDetails?.nome === entry.nome;
                      const opacity = selectedProductDetails && !isSelected ? 0.4 : 1;
                      return <Cell key={`cell-${index}`} fill={baseColor} opacity={opacity} className="cursor-pointer transition-opacity duration-300" />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800/80 rounded-3xl border border-gray-200 dark:border-slate-700/60 shadow-2xl p-6 flex flex-col mt-6">
            <h3 className="text-xl font-black text-gray-900 dark:text-white flex items-center gap-2 mb-6">
              <PieChartIcon className="text-purple-400" /> 
              Vendas por Categoria (Top 5)
            </h3>
            <div className="h-[300px] w-full">
              {categoriasVendas && categoriasVendas.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={categoriasVendas} margin={{ top: 0, right: 30, left: 20, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" vertical={false} />
                    <XAxis dataKey="categoria" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => `R$${(val/1000).toFixed(0)}k`} />
                    <Tooltip 
                      cursor={{ fill: 'rgba(255, 255, 255, 0.05)' }} 
                      contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', borderRadius: '0.75rem' }} 
                      itemStyle={{ color: '#f8fafc', fontWeight: 'bold' }}
                      labelStyle={{ color: '#94a3b8' }}
                      formatter={(value: number) => formatCurrency(value)} 
                    />
                    <Bar 
                      dataKey="total" 
                      name="Faturamento" 
                      radius={[4, 4, 0, 0]} 
                      barSize={40}
                      onClick={(entry) => setSelectedCategoryDetails({ ...entry, tipo: 'categoria' })}
                    >
                      {categoriasVendas.map((entry: any, index: number) => {
                        const isSelected = selectedCategoryDetails?.categoria === entry.categoria;
                        const opacity = selectedCategoryDetails && !isSelected ? 0.4 : 1;
                        return <Cell key={`cell-${index}`} fill={COLORS[(index + 3) % COLORS.length]} opacity={opacity} className="cursor-pointer transition-opacity duration-300" />;
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-gray-400 dark:text-slate-500">Sem dados de categorias.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================================
          ABA CLIENTES (RFM & FIADO)
      ========================================================================================= */}
      {activeSubTab === 'clientes' && (
        <div className="space-y-6 animate-in fade-in duration-500">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="bg-white dark:bg-slate-800/80 rounded-3xl p-6 border border-gray-200 dark:border-slate-700/60 shadow-xl">
              <h3 className="text-gray-500 dark:text-slate-400 font-bold text-sm mb-2">Clientes Identificados {selectedRfmSegment && `(${selectedRfmSegment})`}</h3>
              <div className="text-3xl font-black text-gray-900 dark:text-white truncate">{uniqueCustomers}</div>
            </div>
            <div className="bg-white dark:bg-slate-800/80 rounded-3xl p-6 border border-gray-200 dark:border-slate-700/60 shadow-xl">
              <h3 className="text-gray-500 dark:text-slate-400 font-bold text-sm mb-2">Ticket Médio {selectedRfmSegment && `(${selectedRfmSegment})`}</h3>
              <div className="text-3xl font-black text-purple-400 truncate">{formatCurrency(ticketMedioCliente)}</div>
            </div>
            <div className="bg-white dark:bg-slate-800/80 rounded-3xl p-6 border border-gray-200 dark:border-slate-700/60 shadow-xl border-l-4 border-l-rose-500">
              <h3 className="text-gray-500 dark:text-slate-400 font-bold text-sm mb-2 flex items-center gap-1"><AlertTriangle size={14} className="text-rose-400"/> Fiado em Aberto</h3>
              <div className="text-2xl lg:text-3xl font-black text-rose-400 truncate">{formatCurrency(totalFiado)}</div>
            </div>
            <div onClick={() => setSelectedCustomerDetails({ nome: maiorDevedorNome, valor: maiorDevedorValor, tipo: 'devedor' })} className="bg-white dark:bg-slate-800/80 rounded-3xl p-6 border border-gray-200 dark:border-slate-700/60 shadow-xl cursor-pointer hover:bg-white dark:hover:bg-slate-800 hover:border-rose-500/50 transition-colors">
              <h3 className="text-gray-500 dark:text-slate-400 font-bold text-sm mb-2">Maior Devedor (Fiado)</h3>
              <div className="text-2xl font-black text-rose-300 truncate">{maiorDevedorNome}</div>
              <div className="text-sm text-rose-500 font-medium truncate">{formatCurrency(maiorDevedorValor)} pendente</div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-slate-800/80 rounded-3xl border border-gray-200 dark:border-slate-700/60 shadow-2xl p-6">
              <h3 className="text-xl font-black text-gray-900 dark:text-white mb-6 flex items-center gap-2"><Users className="text-purple-400" /> Segmentação de Fidelidade (RFM)</h3>
              <div className="h-[350px] w-full flex justify-center">
                {rfmChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', borderRadius: '0.75rem' }} 
                        itemStyle={{ color: '#f8fafc', fontWeight: 'bold' }}
                        labelStyle={{ color: '#94a3b8' }}
                      />
                      <Legend wrapperStyle={{ fontSize: '12px' }} />
                      <Pie 
                        data={rfmChartData} 
                        dataKey="value" 
                        nameKey="name" 
                        cx="50%" 
                        cy="50%" 
                        innerRadius="40%" 
                        outerRadius="80%" 
                        paddingAngle={2}
                        onClick={(entry) => {
                          setSelectedRfmSegment(selectedRfmSegment === entry.name ? null : entry.name);
                        }}
                      >
                        {rfmChartData.map((entry: any, index: number) => {
                          const rfmColors: Record<string, string> = { 'Campeão': '#10b981', 'Fiel': '#3b82f6', 'Promissor': '#8b5cf6', 'Risco': '#f59e0b', 'Perdido': '#ef4444' };
                          const isSelected = selectedRfmSegment === entry.name;
                          const opacity = selectedRfmSegment && !isSelected ? 0.3 : 1;
                          return <Cell key={`cell-${index}`} fill={rfmColors[entry.name] || COLORS[index % COLORS.length]} stroke="rgba(0,0,0,0)" opacity={opacity} className="cursor-pointer transition-opacity duration-300" />;
                        })}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center text-gray-400 dark:text-slate-500">Sem dados de RFM disponíveis.</div>
                )}
              </div>
              {selectedRfmSegment && (
                <div className="mt-4 flex justify-end">
                  <button onClick={() => setSelectedRfmSegment(null)} className="text-xs font-bold text-gray-600 dark:text-slate-300 bg-gray-100 dark:bg-slate-700/50 px-3 py-1 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors">
                    Limpar Filtro
                  </button>
                </div>
              )}
            </div>

            <div className="bg-white dark:bg-slate-800/80 rounded-3xl border border-gray-200 dark:border-slate-700/60 shadow-2xl p-6">
              <h3 className="text-xl font-black text-gray-900 dark:text-white mb-6 flex items-center gap-2"><Star className="text-yellow-400" /> Bons Pagadores (Fiado Quitado)</h3>
              <div className="h-[350px] w-full overflow-y-auto pr-2 space-y-3">
                {bonsPagadores.length > 0 ? (
                  bonsPagadores.map((cliente: any, idx: number) => (
                    <div 
                      key={idx} 
                      onClick={() => setSelectedCustomerDetails({ nome: cliente.nome, valor: cliente.volume_credito, celular: cliente.celular, tipo: 'bom_pagador' })}
                      className="flex items-center justify-between p-4 bg-gray-100 dark:bg-slate-700/30 rounded-2xl border border-gray-200 dark:border-slate-700 hover:bg-gray-100 dark:hover:bg-slate-700/60 hover:border-emerald-500/30 cursor-pointer transition-all"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-slate-600 flex items-center justify-center font-bold text-gray-600 dark:text-slate-300">
                          {cliente.nome ? cliente.nome.charAt(0).toUpperCase() : '?'}
                        </div>
                        <div>
                          <div className="font-bold text-gray-900 dark:text-white">{cliente.nome || 'Desconhecido'}</div>
                          <div className="text-xs text-gray-500 dark:text-slate-400">{cliente.celular || 'Sem número'}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-black text-emerald-400">{formatCurrency(cliente.volume_credito || 0)}</div>
                        <div className="text-xs text-gray-500 dark:text-slate-400">Pago</div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="flex h-full items-center justify-center text-gray-400 dark:text-slate-500">Nenhum histórico de bons pagadores.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================================
          ABA FORNECEDORES
      ========================================================================================= */}
      {activeSubTab === 'fornecedores' && (
        <div className="space-y-6 animate-in fade-in duration-500">
          {/* KPIs reais de compras */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-slate-800/80 rounded-2xl border border-gray-200 dark:border-slate-700/60 p-5">
              <p className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Parceiros ativos</p>
              <p className="text-3xl font-black text-gray-900 dark:text-white mt-1">{fornecedores.length}</p>
            </div>
            <div className="bg-white dark:bg-slate-800/80 rounded-2xl border border-gray-200 dark:border-slate-700/60 p-5">
              <p className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Total comprado (período)</p>
              <p className="text-3xl font-black text-amber-400 mt-1">{formatCurrency(fornTotalComprado)}</p>
            </div>
            <div className="bg-white dark:bg-slate-800/80 rounded-2xl border border-gray-200 dark:border-slate-700/60 p-5">
              <p className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">A pagar (em aberto)</p>
              <p className="text-3xl font-black text-red-400 mt-1">{formatCurrency(fornSaldoAberto)}</p>
            </div>
            <div className="bg-white dark:bg-slate-800/80 rounded-2xl border border-gray-200 dark:border-slate-700/60 p-5">
              <p className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Pedidos no período</p>
              <p className="text-3xl font-black text-gray-900 dark:text-white mt-1">{fornTotalPedidos}</p>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800/80 rounded-3xl border border-gray-200 dark:border-slate-700/60 shadow-2xl p-6">
            <h3 className="text-xl font-black text-gray-900 dark:text-white mb-2 flex items-center gap-2"><Truck className="text-amber-400" /> Faturamento gerado por fornecedor</h3>
            <p className="text-sm text-gray-500 dark:text-slate-400 mb-6">Quanto cada parceiro faz girar no seu PDV — identifica seus fornecedores estratégicos.</p>
            <div className="h-[340px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={fornecedores} margin={{ top: 20, right: 30, left: 20, bottom: 50 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" vertical={false} />
                  <XAxis dataKey="fornecedor" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} angle={-45} textAnchor="end" height={60} />
                  <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => `R$${(val/1000).toFixed(0)}k`} />
                  <Tooltip
                    cursor={{ fill: 'rgba(255, 255, 255, 0.05)' }}
                    contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', borderRadius: '0.75rem' }}
                    itemStyle={{ color: '#f8fafc', fontWeight: 'bold' }}
                    labelStyle={{ color: '#94a3b8' }}
                    formatter={(value: number) => formatCurrency(value)}
                  />
                  <Bar dataKey="total" name="Faturamento gerado" radius={[6, 6, 0, 0]} maxBarSize={60}>
                    {fornecedores.map((_f: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Tabela real: condição de pagamento POR fornecedor + ação de pedido */}
          <div className="bg-white dark:bg-slate-800/80 rounded-3xl border border-gray-200 dark:border-slate-700/60 shadow-2xl p-6 overflow-x-auto">
            <h3 className="text-lg font-black text-gray-900 dark:text-white mb-4">Detalhe por fornecedor</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
                  <th className="py-3 pr-4 font-bold">Fornecedor</th>
                  <th className="py-3 px-3 font-bold text-right">Comprado</th>
                  <th className="py-3 px-3 font-bold text-right">A pagar</th>
                  <th className="py-3 px-3 font-bold text-center">Pedidos</th>
                  <th className="py-3 px-3 font-bold">Condição</th>
                  <th className="py-3 px-3 font-bold text-center">Prazo</th>
                  <th className="py-3 px-3 font-bold text-center">Pontualidade</th>
                  <th className="py-3 pl-3 font-bold text-right">Ação</th>
                </tr>
              </thead>
              <tbody>
                {fornecedores.length > 0 ? fornecedores.map((f: any) => (
                  <tr key={f.id} className="border-b border-gray-200 dark:border-slate-800 hover:bg-gray-100 dark:hover:bg-slate-700/20 transition-colors">
                    <td className="py-3 pr-4 font-bold text-gray-900 dark:text-white">{f.fornecedor}</td>
                    <td className="py-3 px-3 text-right text-gray-700 dark:text-slate-200">{formatCurrency(f.total_comprado)}</td>
                    <td className={`py-3 px-3 text-right font-bold ${f.saldo_aberto > 0 ? 'text-red-400' : 'text-emerald-400'}`}>{formatCurrency(f.saldo_aberto)}</td>
                    <td className="py-3 px-3 text-center text-gray-600 dark:text-slate-300">{f.num_pedidos}</td>
                    <td className="py-3 px-3">
                      <span className="text-xs font-bold text-blue-300 bg-blue-500/15 px-2 py-1 rounded-lg whitespace-nowrap">{f.condicao_pagamento}</span>
                    </td>
                    <td className="py-3 px-3 text-center text-gray-600 dark:text-slate-300">{f.prazo_entrega_dias}d</td>
                    <td className="py-3 px-3 text-center">
                      <span className={`font-bold ${f.pontualidade_pagamento >= 90 ? 'text-emerald-400' : f.pontualidade_pagamento >= 70 ? 'text-amber-400' : 'text-red-400'}`}>{f.pontualidade_pagamento}%</span>
                    </td>
                    <td className="py-3 pl-3 text-right">
                      <button
                        onClick={() => navigate('/produtos', { state: { abrirPedido: true, fornecedorId: f.id, fornecedorNome: f.fornecedor, condicaoPagamento: f.condicao_pagamento } })}
                        className="px-3 py-1.5 bg-amber-500/20 text-amber-300 rounded-lg text-xs font-bold hover:bg-amber-500/40 transition-colors whitespace-nowrap"
                      >
                        Fazer Pedido
                      </button>
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={8} className="py-8 text-center text-gray-400 dark:text-slate-500">Nenhum fornecedor com movimentação no período.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =========================================================================================
          ABA OPERADORES DE CAIXA (CAIXAS/VENDEDORES)
      ========================================================================================= */}
      {activeSubTab === 'sfa' && (
        <div className="space-y-6 animate-in fade-in duration-500">
          <div className="bg-white dark:bg-slate-800/80 rounded-3xl p-6 border border-gray-200 dark:border-slate-700/60 shadow-xl mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h3 className="text-xl font-black text-gray-900 dark:text-white mb-2 flex items-center gap-2"><Award className="text-indigo-400" /> Desempenho por Operador de Caixa</h3>
              <p className="text-sm text-gray-500 dark:text-slate-400">Análise de vendas, ticket médio e volume de cupons emitidos por funcionário no PDV.</p>
            </div>
            {selectedVendedor && (
               <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-xl px-4 py-2">
                 <p className="text-indigo-400 font-bold text-sm">Visualizando: {selectedVendedor.nome}</p>
               </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className={`bg-white dark:bg-slate-800/80 rounded-3xl p-6 border shadow-xl ${selectedVendedor ? 'border-blue-500/50 ring-2 ring-blue-500/20' : 'border-gray-200 dark:border-slate-700/60'}`}>
              <div className="flex items-center gap-3 mb-4"><div className="p-2 bg-blue-500/10 rounded-xl text-blue-400"><Target className="w-5 h-5" /></div><h3 className="text-gray-600 dark:text-slate-300 font-bold text-sm">Realizado vs Meta</h3></div>
              <div className="text-2xl xl:text-3xl font-black text-gray-900 dark:text-white tracking-tighter wrap-break-word">{formatCurrency(selectedVendedor ? selectedVendedor.alcancado : globalAlcancado)}</div>
              <p className="text-xs text-gray-500 dark:text-slate-400 font-medium mb-3">de {formatCurrency(selectedVendedor ? selectedVendedor.meta : globalMeta)}</p>
            </div>
            <div className={`bg-white dark:bg-slate-800/80 rounded-3xl p-6 border shadow-xl ${selectedVendedor ? 'border-emerald-500/50 ring-2 ring-emerald-500/20' : 'border-gray-200 dark:border-slate-700/60'}`}>
              <div className="flex items-center gap-3 mb-4"><div className="p-2 bg-emerald-500/10 rounded-xl text-emerald-400"><TrendingUp className="w-5 h-5" /></div><h3 className="text-gray-600 dark:text-slate-300 font-bold text-sm">Tendência de Fechamento</h3></div>
              <div className={`text-3xl xl:text-4xl font-black tracking-tighter ${(selectedVendedor ? selectedVendedor.tendencia : avgTendencia) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {(selectedVendedor ? selectedVendedor.tendencia : avgTendencia) > 0 ? '+' : ''}{(selectedVendedor ? selectedVendedor.tendencia : avgTendencia).toFixed(1)}%
              </div>
            </div>
            <div className={`bg-white dark:bg-slate-800/80 rounded-3xl p-6 border shadow-xl ${selectedVendedor ? 'border-purple-500/50 ring-2 ring-purple-500/20' : 'border-gray-200 dark:border-slate-700/60'}`}>
              <div className="flex items-center gap-3 mb-4"><div className="p-2 bg-purple-500/10 rounded-xl text-purple-400"><ShoppingCart className="w-5 h-5" /></div><h3 className="text-gray-600 dark:text-slate-300 font-bold text-sm">Volume de Pedidos</h3></div>
              <div className="text-3xl xl:text-4xl font-black text-gray-900 dark:text-white tracking-tighter">{selectedVendedor ? selectedVendedor.vendas_count : totalVendasGlobal} <span className="text-lg text-gray-400 dark:text-slate-500 font-medium">pedidos</span></div>
            </div>
            <div className={`bg-white dark:bg-slate-800/80 rounded-3xl p-6 border shadow-xl ${selectedVendedor ? 'border-amber-500/50 ring-2 ring-amber-500/20' : 'border-gray-200 dark:border-slate-700/60'}`}>
              <div className="flex items-center gap-3 mb-4"><div className="p-2 bg-amber-500/10 rounded-xl text-amber-400"><DollarSign className="w-5 h-5" /></div><h3 className="text-gray-600 dark:text-slate-300 font-bold text-sm">Ticket Médio (Operador)</h3></div>
              <div className="text-2xl xl:text-3xl font-black text-gray-900 dark:text-white tracking-tighter wrap-break-word">{formatCurrency(selectedVendedor ? (selectedVendedor.vendas_count > 0 ? selectedVendedor.alcancado/selectedVendedor.vendas_count : 0) : ticketMedioGlobal)}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white dark:bg-slate-800/80 rounded-3xl p-6 border border-gray-200 dark:border-slate-700/60 shadow-xl flex flex-col">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-gray-600 dark:text-slate-300 font-bold flex items-center gap-2"><BarChart3 className="text-blue-400" /> Faturamento por Operador (Clique para filtrar)</h3>
                {selectedVendedorId && <button onClick={() => setSelectedVendedorId(null)} className="text-xs font-bold text-rose-400 bg-rose-500/10 px-3 py-1 rounded-lg hover:bg-rose-500/20 transition-colors">Limpar Filtro</button>}
              </div>
              <div className="h-[320px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={vendedoresRaw} margin={{ top: 10, right: 10, left: -20, bottom: 0 }} onClick={(d) => d?.activePayload && setSelectedVendedorId(d.activePayload[0].payload.id)}>
                    <XAxis dataKey="nome" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(value) => `R$${(value / 1000).toFixed(0)}k`} />
                    <Tooltip 
                      cursor={{ fill: 'rgba(59, 130, 246, 0.1)' }} 
                      contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', borderRadius: '0.75rem' }} 
                      itemStyle={{ color: '#f8fafc', fontWeight: 'bold' }}
                      labelStyle={{ color: '#94a3b8' }}
                      formatter={(value: number) => formatCurrency(value)} 
                    />
                    <Legend wrapperStyle={{ paddingTop: '10px', fontSize: '12px' }} />
                    <Bar dataKey="meta" name="Meta" fill="#334155" radius={[4, 4, 0, 0]} maxBarSize={60} />
                    <Bar dataKey="alcancado" name="Realizado" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={60}>
                      {vendedoresRaw.map((entry: any, index: number) => (
                        <Cell key={`cell-${index}`} fill={entry.alcancado >= entry.meta ? '#10b981' : '#3b82f6'} opacity={selectedVendedorId ? (entry.id === selectedVendedorId ? 1 : 0.2) : 1} className="cursor-pointer hover:opacity-80 transition-opacity" />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            
            <div className="bg-white dark:bg-slate-800/80 rounded-3xl p-6 border border-gray-200 dark:border-slate-700/60 shadow-xl flex flex-col">
              <h3 className="text-gray-600 dark:text-slate-300 font-bold mb-2 flex items-center gap-2"><PieChartIcon className="text-purple-400" /> Distribuição de Vendas no PDV</h3>
              <div className="h-[280px] w-full flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', borderRadius: '0.75rem' }} 
                      itemStyle={{ color: '#f8fafc', fontWeight: 'bold' }}
                      labelStyle={{ color: '#94a3b8' }}
                      formatter={(value: number) => formatCurrency(value)} 
                    />
                    <Pie data={vendedoresRaw} dataKey="alcancado" nameKey="nome" cx="50%" cy="50%" innerRadius="50%" outerRadius="75%" paddingAngle={3} onClick={(d) => setSelectedVendedorId(d.id)} className="cursor-pointer">
                      {vendedoresRaw.map((entry: any, index: number) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="rgba(0,0,0,0)" opacity={selectedVendedorId ? (entry.id === selectedVendedorId ? 1 : 0.2) : 1} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================================
          MODAIS UNIFICADOS (DETALHAMENTO INTERATIVO)
      ========================================================================================= */}
      
      {/* Modal: Cliente (Devedor ou Bom Pagador) */}
      <DetailsModal 
        isOpen={!!selectedCustomerDetails} 
        onClose={() => setSelectedCustomerDetails(null)} 
        title={`Ficha de Cliente: ${selectedCustomerDetails?.nome}`}
      >
        <div className="space-y-4">
          <div className="bg-gray-50 dark:bg-slate-900/50 p-6 rounded-xl border border-gray-200 dark:border-slate-700/50">
            <h4 className="text-sm font-bold text-gray-500 dark:text-slate-400 mb-4">Informações de Fiado</h4>
            <div className="flex justify-between items-center mb-2">
              <span className="text-gray-500 dark:text-slate-400">Cliente</span>
              <span className="font-bold text-gray-900 dark:text-white">{selectedCustomerDetails?.nome}</span>
            </div>
            {selectedCustomerDetails?.celular && (
              <div className="flex justify-between items-center mb-2">
                <span className="text-gray-500 dark:text-slate-400">Contato</span>
                <span className="font-bold text-gray-900 dark:text-white">{selectedCustomerDetails?.celular}</span>
              </div>
            )}
            <div className="flex justify-between items-center mt-4 pt-4 border-t border-gray-200 dark:border-slate-700/50">
              <span className="text-gray-500 dark:text-slate-400">{selectedCustomerDetails?.tipo === 'devedor' ? 'Dívida em Aberto' : 'Volume Quitado'}</span>
              <span className={`font-black text-xl ${selectedCustomerDetails?.tipo === 'devedor' ? 'text-rose-400' : 'text-emerald-400'}`}>
                {formatCurrency(selectedCustomerDetails?.valor || 0)}
              </span>
            </div>
          </div>
          <div className="flex gap-4 mt-6">
            <button className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-xl transition-colors">
              Abrir Cadastro
            </button>
            <button className="flex-1 bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-900 dark:text-white font-bold py-2 px-4 rounded-xl transition-colors">
              Histórico de Vendas
            </button>
          </div>
        </div>
      </DetailsModal>

      {/* Modal: Produto (Curva ABC) */}
      <DetailsModal 
        isOpen={!!selectedProductDetails} 
        onClose={() => setSelectedProductDetails(null)} 
        title={`Detalhes do Produto (ABC)`}
      >
        <div className="space-y-4 text-gray-600 dark:text-slate-300 p-2">
          <p className="text-lg">Produto selecionado: <strong className="text-gray-900 dark:text-white">{selectedProductDetails?.nome}</strong></p>
          <div className="grid grid-cols-2 gap-4 mt-4">
            <div className="bg-gray-50 dark:bg-slate-900/50 p-4 rounded-xl border border-gray-200 dark:border-slate-700/50">
              <span className="text-xs text-gray-500 dark:text-slate-400 font-bold">Faturamento (Período)</span>
              <div className="text-xl font-black text-blue-400 mt-1">{formatCurrency(selectedProductDetails?.faturamento || 0)}</div>
            </div>
            <div className="bg-gray-50 dark:bg-slate-900/50 p-4 rounded-xl border border-gray-200 dark:border-slate-700/50">
              <span className="text-xs text-gray-500 dark:text-slate-400 font-bold">Classificação ABC</span>
              <div className={`text-xl font-black mt-1 ${selectedProductDetails?.classificacao === 'A' ? 'text-emerald-400' : selectedProductDetails?.classificacao === 'B' ? 'text-blue-400' : 'text-amber-400'}`}>
                Classe {selectedProductDetails?.classificacao}
              </div>
            </div>
          </div>
          <p className="text-sm mt-4">Essa visão permite analisar giro de estoque, margem de contribuição e prever quebras. O botão abaixo abriria o inventário completo do item.</p>
          <button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-4 rounded-xl transition-colors mt-4">
            Analisar Estoque
          </button>
        </div>
      </DetailsModal>

      {/* Modal: Categoria */}
      <DetailsModal 
        isOpen={!!selectedCategoryDetails} 
        onClose={() => setSelectedCategoryDetails(null)} 
        title={`Análise de Categoria`}
      >
        <div className="space-y-4 text-gray-600 dark:text-slate-300 p-2">
          <p className="text-lg">Categoria selecionada: <strong className="text-gray-900 dark:text-white">{selectedCategoryDetails?.categoria}</strong></p>
          <div className="bg-gray-50 dark:bg-slate-900/50 p-4 rounded-xl border border-gray-200 dark:border-slate-700/50 mt-4">
            <span className="text-xs text-gray-500 dark:text-slate-400 font-bold">Total Arrecadado</span>
            <div className="text-2xl font-black text-purple-400 mt-1">{formatCurrency(selectedCategoryDetails?.total || 0)}</div>
          </div>
          <p className="text-sm mt-4">Use este atalho para consultar o sub-relatório de vendas por segmento e entender os produtos líderes desta categoria.</p>
          <button className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded-xl transition-colors mt-4">
            Explorar Sub-Categoria
          </button>
        </div>
      </DetailsModal>

    </div>
  );
}
