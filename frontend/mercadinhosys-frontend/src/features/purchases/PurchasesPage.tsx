import React, { useState, useEffect, useCallback } from 'react';
import {
  ShoppingBag, Plus, Eye, CheckCircle, Clock, AlertCircle,
  Filter, Search, AlertTriangle, Truck,
  Package, DollarSign, RefreshCw, ChevronDown,
  FileCheck2, XCircle, Inbox,
  ArrowUpRight, Loader2, X, CalendarDays,
  ChevronUp
} from 'lucide-react';
import { PedidoCompra, purchaseOrderService } from '../products/purchaseOrderService';
import { Fornecedor } from '../../types';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { showToast } from '../../utils/toast';
import { apiClient } from '../../api/apiClient';

import PurchaseOrderModal from '../products/components/PurchaseOrderModal';
import ReceivePurchaseModal from '../products/components/ReceivePurchaseModal';
import PurchaseOrderDetailsModal from '../products/components/PurchaseOrderDetailsModal';
import { InsightCard as ConsultorInsightCard } from '../../components/consultor/InsightCard';

// ── Tipos ─────────────────────────────────────────────────────────────────
interface DashboardStats {
  pendentes: number;
  recebidos_mes: number;
  valor_pendente: number;
  valor_recebido_mes: number;
  atrasados: number;
  chegando_hoje: number;
}

// ── Utils ─────────────────────────────────────────────────────────────────
const getDaysLate = (previsao?: string): number => {
  if (!previsao) return 0;
  const diff = Math.floor((Date.now() - new Date(previsao).getTime()) / 86400000);
  return diff > 0 ? diff : 0;
};

const isToday = (dateStr?: string): boolean => {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const t = new Date();
  return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
};

// ── KPI Card ─────────────────────────────────────────────────────────────
// Layout centrado, altura fixa, font adaptável. Nunca vaza, nunca corta.
const KpiCard = ({
  icon: Icon, label, value, sub, color, pulse
}: {
  icon: React.ElementType; label: string; value: string | number;
  sub?: string; color: 'blue' | 'green' | 'amber' | 'red' | 'purple'; pulse?: boolean;
}) => {
  const palette: Record<string, { card: string; icon: string; val: string }> = {
    blue:   { card: 'bg-blue-50 dark:bg-blue-950/60 border-blue-200 dark:border-blue-800',     icon: 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300',     val: 'text-blue-700 dark:text-blue-200' },
    green:  { card: 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800', icon: 'bg-emerald-100 dark:bg-emerald-900 text-emerald-600 dark:text-emerald-300', val: 'text-emerald-700 dark:text-emerald-200' },
    amber:  { card: 'bg-amber-50 dark:bg-amber-950/60 border-amber-200 dark:border-amber-800', icon: 'bg-amber-100 dark:bg-amber-900 text-amber-600 dark:text-amber-300',   val: 'text-amber-700 dark:text-amber-200' },
    red:    { card: 'bg-red-50 dark:bg-red-950/60 border-red-200 dark:border-red-800',         icon: 'bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-300',         val: 'text-red-700 dark:text-red-200' },
    purple: { card: 'bg-purple-50 dark:bg-purple-950/60 border-purple-200 dark:border-purple-800', icon: 'bg-purple-100 dark:bg-purple-900 text-purple-600 dark:text-purple-300', val: 'text-purple-700 dark:text-purple-200' },
  };
  const p = palette[color];
  // Detecta se value é um número curto (1–5 chars) ou string longa (moeda)
  const strVal = String(value);
  // 4 níveis: nº curto → grande; moeda longa → pequeno mas legível
  const valueFontSize =
    strVal.length <= 4  ? 'text-3xl' :
    strVal.length <= 7  ? 'text-2xl' :
    strVal.length <= 10 ? 'text-lg'  : 'text-sm';

  return (
    <div className={`relative border rounded-2xl p-3 flex flex-col items-center text-center overflow-hidden shrink-0 w-[168px] sm:w-auto ${p.card}`}>
      {pulse && (
        <span className="absolute top-2 right-2">
          <span className="absolute inline-flex h-2 w-2 rounded-full bg-red-400 opacity-75 animate-ping" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
        </span>
      )}
      <div className={`p-2 rounded-xl mb-2 ${p.icon}`}>
        <Icon className="w-4 h-4" />
      </div>
      <p className={`font-black leading-none ${valueFontSize} ${p.val} w-full text-center`} title={strVal}>
        {value}
      </p>
      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mt-1.5 leading-tight line-clamp-2 px-1">{label}</p>
      {sub && <p className="text-[9px] text-gray-400 dark:text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
};

// ── Status Badge ───────────────────────────────────────────────────────────
const StatusBadge = ({ status, sm }: { status: string; sm?: boolean }) => {
  const map: Record<string, { label: string; cls: string; Icon: React.ElementType }> = {
    pendente:  { label: 'Aguardando', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',   Icon: Clock },
    recebido:  { label: 'Recebido',   cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300', Icon: CheckCircle },
    cancelado: { label: 'Cancelado',  cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',           Icon: XCircle },
    devolvido: { label: 'Devolvido',  cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',          Icon: AlertCircle },
  };
  const s = map[status] ?? map.pendente;
  const sz = sm ? 'w-2.5 h-2.5' : 'w-3 h-3';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${s.cls}`}>
      <s.Icon className={sz} />
      {s.label}
    </span>
  );
};

// ── Card Mobile de Pedido ──────────────────────────────────────────────────
const PedidoCardMobile = ({
  pedido, onReceive, onDetails
}: { pedido: PedidoCompra; onReceive: () => void; onDetails: () => void }) => {
  const [open, setOpen] = useState(false);
  const daysLate = pedido.status === 'pendente' ? getDaysLate(pedido.data_previsao_entrega) : 0;
  const isLate = daysLate > 0;
  const comingToday = pedido.status === 'pendente' && isToday(pedido.data_previsao_entrega);

  const accent =
    isLate ? 'border-l-red-500' :
    comingToday ? 'border-l-purple-500' :
    pedido.status === 'recebido' ? 'border-l-emerald-500' :
    'border-l-amber-400';

  return (
    <div className={`border-l-[3px] ${accent} bg-white dark:bg-gray-800 rounded-r-xl shadow-sm border border-l-0 border-gray-100 dark:border-gray-700 overflow-hidden`}>
      {/* sempre visível */}
      <button className="w-full text-left px-3.5 py-3 flex items-start gap-2" onClick={() => setOpen(o => !o)}>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-black text-gray-900 dark:text-white text-xs font-mono">#{pedido.numero_pedido}</span>
            <StatusBadge status={pedido.status} sm />
            {pedido.financeiro && (
              <span className={`px-1.5 py-0.5 text-[9px] rounded-full font-black ${
                pedido.financeiro.status === 'pago' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' :
                pedido.financeiro.vencido ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' :
                'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
              }`}>
                {pedido.financeiro.status_display}
              </span>
            )}
            {isLate && <span className="px-1.5 py-0.5 text-[9px] bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded-full font-black">{daysLate}d atraso</span>}
            {comingToday && <span className="px-1.5 py-0.5 text-[9px] bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded-full font-black">Hoje!</span>}
          </div>
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 truncate">{pedido.fornecedor_nome || '—'}</p>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-black text-blue-700 dark:text-blue-300 text-sm">{formatCurrency(pedido.total)}</span>
            <span className="flex items-center gap-1 text-xs text-gray-400">
              <CalendarDays className="w-3 h-3" />{formatDate(pedido.data_pedido)}
            </span>
            {pedido.total_itens > 0 && <span className="flex items-center gap-1 text-xs text-gray-400"><Package className="w-3 h-3" />{pedido.total_itens} itens</span>}
          </div>
        </div>
        <div className="shrink-0 mt-0.5 text-gray-400">
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {/* painel expansível */}
      {open && (
        <div className="border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40">
          {(pedido.data_previsao_entrega || pedido.condicao_pagamento) && (
          <div className="px-3.5 py-2.5 grid grid-cols-2 gap-2.5">
              {/* Data de recebimento ou previsão — sempre aparece se existir */}
              {(pedido.status === 'recebido' ? pedido.data_recebimento : pedido.data_previsao_entrega) && (
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase">
                    {pedido.status === 'recebido' ? 'Recebido em' : 'Previsão entrega'}
                  </p>
                  <p className={`text-xs font-bold mt-0.5 ${
                    isLate ? 'text-red-600 dark:text-red-400' :
                    pedido.status === 'recebido' ? 'text-emerald-600 dark:text-emerald-400' :
                    'text-gray-800 dark:text-white'
                  }`}>
                    {formatDate(pedido.status === 'recebido' ? pedido.data_recebimento : pedido.data_previsao_entrega)}
                  </p>
                </div>
              )}
              {pedido.condicao_pagamento && (
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase">Pagamento</p>
                  <p className="text-xs font-semibold text-gray-800 dark:text-white mt-0.5 truncate">{pedido.condicao_pagamento}</p>
                </div>
              )}
            </div>
          )}
          <div className="px-3.5 pb-3.5 flex flex-col gap-2">
            {pedido.status === 'pendente' && (
              <button onClick={onReceive} className="w-full py-2.5 bg-linear-to-r from-emerald-600 to-green-600 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 active:opacity-80 transition-opacity">
                <CheckCircle className="w-4 h-4 shrink-0" />
                Confirmar Recebimento
              </button>
            )}
            <button onClick={onDetails} className="w-full py-2.5 border-2 border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-xl font-bold text-sm flex items-center justify-center gap-2 bg-white dark:bg-gray-800 active:opacity-80 transition-opacity">
              <Eye className="w-4 h-4 shrink-0" />
              Ver Detalhes
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Linha Desktop de Pedido ────────────────────────────────────────────────
const PedidoRowDesktop = ({
  pedido, onReceive, onDetails
}: { pedido: PedidoCompra; onReceive: () => void; onDetails: () => void }) => {
  const daysLate = pedido.status === 'pendente' ? getDaysLate(pedido.data_previsao_entrega) : 0;
  const isLate = daysLate > 0;
  const comingToday = pedido.status === 'pendente' && isToday(pedido.data_previsao_entrega);

  const rowBg =
    isLate ? 'bg-red-50/50 dark:bg-red-900/10 hover:bg-red-50 dark:hover:bg-red-900/20' :
    comingToday ? 'bg-purple-50/50 dark:bg-purple-900/10 hover:bg-purple-50 dark:hover:bg-purple-900/20' :
    'hover:bg-gray-50 dark:hover:bg-gray-700/30';

  return (
    <tr className={`border-b border-gray-100 dark:border-gray-700 transition-colors ${rowBg}`}>
      <td className="px-4 py-3 w-1.5">
        <div className={`w-1 h-8 rounded-full ${isLate ? 'bg-red-500' : comingToday ? 'bg-purple-500' : pedido.status === 'recebido' ? 'bg-emerald-500' : 'bg-amber-400'}`} />
      </td>
      <td className="px-3 py-3">
        <span className="font-black text-gray-900 dark:text-white text-sm font-mono">#{pedido.numero_pedido}</span>
      </td>
      <td className="px-3 py-3 max-w-[200px]">
        <p className="font-semibold text-gray-800 dark:text-white text-sm truncate">{pedido.fornecedor_nome || '—'}</p>
        {pedido.condicao_pagamento && <p className="text-xs text-gray-400 truncate">{pedido.condicao_pagamento}</p>}
      </td>
      <td className="px-3 py-3 text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">{formatDate(pedido.data_pedido)}</td>
      <td className="px-3 py-3">
        {(() => {
          const isRecebido = pedido.status === 'recebido';
          const dataExibir = isRecebido ? pedido.data_recebimento : pedido.data_previsao_entrega;
          if (!dataExibir) return <span className="text-gray-400 text-sm">—</span>;
          return (
            <div>
              {isRecebido && (
                <p className="text-[10px] font-bold text-emerald-500 dark:text-emerald-400 uppercase tracking-wide">Recebido</p>
              )}
              <span className={`text-sm font-medium whitespace-nowrap ${
                isLate ? 'text-red-600 dark:text-red-400 font-bold' :
                comingToday ? 'text-purple-600 dark:text-purple-400 font-bold' :
                isRecebido ? 'text-emerald-700 dark:text-emerald-300 font-semibold' :
                'text-gray-700 dark:text-gray-300'
              }`}>
                {formatDate(dataExibir)}
              </span>
              {isLate && <span className="ml-1.5 px-1.5 py-0.5 text-[9px] bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded-full font-black">{daysLate}d</span>}
              {comingToday && <span className="ml-1.5 px-1.5 py-0.5 text-[9px] bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded-full font-black">Hoje</span>}
            </div>
          );
        })()}
      </td>
      <td className="px-3 py-3 text-center text-sm text-gray-500 dark:text-gray-400">{pedido.total_itens ?? '—'}</td>
      <td className="px-3 py-3 text-right">
        <span className="font-black text-blue-700 dark:text-blue-300 text-sm whitespace-nowrap">{formatCurrency(pedido.total)}</span>
      </td>
      <td className="px-3 py-3">
        {pedido.financeiro ? (
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${
            pedido.financeiro.status === 'pago' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' :
            pedido.financeiro.vencido ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' :
            'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
          }`}>
            {pedido.financeiro.status_display}
          </span>
        ) : (
          <span className="text-gray-400 text-xs">—</span>
        )}
      </td>
      <td className="px-3 py-3">
        <StatusBadge status={pedido.status} />
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {pedido.status === 'pendente' && (
            <button onClick={onReceive} className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 transition-colors whitespace-nowrap">
              <CheckCircle className="w-3.5 h-3.5" />
              Receber
            </button>
          )}
          <button onClick={onDetails} className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg text-xs font-bold hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors whitespace-nowrap">
            <Eye className="w-3.5 h-3.5" />
            Detalhes
          </button>
        </div>
      </td>
    </tr>
  );
};

// ── Página ─────────────────────────────────────────────────────────────────
const PurchasesPage: React.FC = () => {
  const [pedidos, setPedidos] = useState<PedidoCompra[]>([]);
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filtros, setFiltros] = useState({ status: 'pendente', fornecedor_id: '', busca: '' });
  const [activeTab, setActiveTab] = useState<'pendentes' | 'todos' | 'historico'>('pendentes');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItens, setTotalItens] = useState(0);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedPedido, setSelectedPedido] = useState<PedidoCompra | null>(null);
  const [stats, setStats] = useState<DashboardStats>({ pendentes: 0, recebidos_mes: 0, valor_pendente: 0, valor_recebido_mes: 0, atrasados: 0, chegando_hoje: 0 });

  const carregarFornecedores = useCallback(async () => {
    try {
      const res = await apiClient.get('/fornecedores', { params: { por_pagina: 200 } });
      setFornecedores(res.data.data || res.data.fornecedores || []);
    } catch { /* silencioso */ }
  }, []);

  const carregarPedidos = useCallback(async (silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true);
    try {
      const params: Record<string, unknown> = { page, per_page: 20 };
      if (filtros.status) params.status = filtros.status;
      if (filtros.fornecedor_id) params.fornecedor_id = filtros.fornecedor_id;
      const res = await purchaseOrderService.listarPedidos(params);
      let lista = res.pedidos;
      if (filtros.busca) {
        const q = filtros.busca.toLowerCase();
        lista = lista.filter(p => p.numero_pedido.toLowerCase().includes(q) || (p.fornecedor_nome || '').toLowerCase().includes(q));
      }
      setPedidos(lista);
      setTotalPages(res.paginacao.total_paginas);
      setTotalItens(res.paginacao.total_itens);
    } catch { showToast.error('Erro ao carregar pedidos'); }
    finally { setLoading(false); setRefreshing(false); }
  }, [page, filtros]);

  const carregarStats = useCallback(async () => {
    try {
      const [resPend, resRec] = await Promise.all([
        purchaseOrderService.listarPedidos({ status: 'pendente', per_page: 100 }),
        purchaseOrderService.listarPedidos({ status: 'recebido', per_page: 100 }),
      ]);
      const now = new Date();
      const startMes = new Date(now.getFullYear(), now.getMonth(), 1);
      const recMes = resRec.pedidos.filter(p => p.data_recebimento && new Date(p.data_recebimento) >= startMes);
      setStats({
        pendentes: resPend.paginacao.total_itens,
        recebidos_mes: recMes.length,
        valor_pendente: resPend.pedidos.reduce((s, p) => s + (p.total || 0), 0),
        valor_recebido_mes: recMes.reduce((s, p) => s + (p.total || 0), 0),
        atrasados: resPend.pedidos.filter(p => p.data_previsao_entrega && new Date(p.data_previsao_entrega) < now).length,
        chegando_hoje: resPend.pedidos.filter(p => isToday(p.data_previsao_entrega)).length,
      });
    } catch { /* silencioso */ }
  }, []);

  useEffect(() => { carregarFornecedores(); carregarStats(); }, [carregarFornecedores, carregarStats]);
  useEffect(() => { carregarPedidos(); }, [carregarPedidos]);

  const handleTabChange = (tab: typeof activeTab) => {
    setActiveTab(tab); setPage(1);
    if (tab === 'pendentes') setFiltros(f => ({ ...f, status: 'pendente' }));
    else if (tab === 'todos') setFiltros(f => ({ ...f, status: '' }));
    else setFiltros(f => ({ ...f, status: 'recebido' }));
  };

  const handleSuccess = () => { carregarPedidos(true); carregarStats(); };
  const openReceive = (p: PedidoCompra) => { setSelectedPedido(p); setShowReceiveModal(true); };
  const openDetails = (p: PedidoCompra) => { setSelectedPedido(p); setShowDetailsModal(true); };

  const tabs = [
    { key: 'pendentes' as const, label: 'Aguardando', Icon: Clock, count: stats.pendentes },
    { key: 'todos' as const, label: 'Todos', Icon: Package, count: null },
    { key: 'historico' as const, label: 'Recebidos', Icon: FileCheck2, count: null },
  ];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 pb-24 md:pb-8">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8 space-y-4 sm:space-y-5">

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg sm:text-2xl lg:text-3xl font-black text-gray-900 dark:text-white flex items-center gap-2 sm:gap-3 tour-compras-visao">
              <div className="p-1.5 sm:p-2 bg-linear-to-br from-blue-600 to-indigo-600 rounded-xl shadow-md shrink-0">
                <ShoppingBag className="w-4 h-4 sm:w-6 sm:h-6 text-white" />
              </div>
              <span className="truncate">Compras & Doca</span>
            </h1>
            <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-0.5 hidden sm:block">
              Central de pedidos, recebimentos e entrada de estoque
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => carregarPedidos(true)}
              disabled={refreshing}
              className="p-2 sm:p-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 shadow-sm active:scale-95 transition-transform"
              title="Atualizar"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-blue-500' : ''}`} />
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-1.5 px-3 sm:px-5 py-2 sm:py-2.5 bg-linear-to-r from-blue-600 to-indigo-600 text-white rounded-xl font-bold shadow-md text-sm active:scale-95 transition-transform"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Novo Pedido</span>
              <span className="sm:hidden">Novo</span>
            </button>
          </div>
        </div>

        <ConsultorInsightCard especialista="compras" titulo="Consultor IA - Compras & Abastecimento" className="mb-2" />

        {/* ── KPIs ──────────────────────────────────────────────────── */}
        {/* Mobile: scroll horizontal com largura fixa por card
             Desktop (lg+): grid 6 colunas com largura auto */}
        <div className="-mx-3 sm:mx-0">
          <div className="flex gap-2.5 overflow-x-auto px-3 pb-1 sm:px-0 sm:overflow-visible lg:grid lg:grid-cols-6 lg:gap-3">
            <KpiCard icon={Clock}         color="blue"   label="Aguardando"    value={stats.pendentes}                        sub="pedidos em aberto" />
            <KpiCard icon={Truck}         color="purple" label="Chegam Hoje"   value={stats.chegando_hoje}                    sub="previsão p/ hoje" />
            <KpiCard icon={AlertTriangle} color="red"    label="Atrasados"     value={stats.atrasados}                        sub="além do prazo" pulse={stats.atrasados > 0} />
            <KpiCard icon={CheckCircle}   color="green"  label="Rec. no Mês"  value={stats.recebidos_mes}                    sub="este mês" />
            <KpiCard icon={DollarSign}    color="amber"  label="Val. Pendente" value={formatCurrency(stats.valor_pendente)}    sub="em aberto" />
            <KpiCard icon={DollarSign}    color="green"  label="Entrada Mês"  value={formatCurrency(stats.valor_recebido_mes)} sub="mercadoria" />
          </div>
        </div>

        {/* ── Alertas ───────────────────────────────────────────────── */}
        {stats.atrasados > 0 && (
          <div className="flex items-start gap-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-3 sm:p-4">
            <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-bold text-red-800 dark:text-red-300 text-sm">{stats.atrasados} entrega{stats.atrasados > 1 ? 's' : ''} atrasada{stats.atrasados > 1 ? 's' : ''}</p>
              <p className="text-xs text-red-600 dark:text-red-400 mt-0.5 hidden sm:block">Verifique os pedidos pendentes e contate o fornecedor.</p>
            </div>
            <button onClick={() => handleTabChange('pendentes')} className="shrink-0 flex items-center gap-1 text-xs font-bold text-red-700 dark:text-red-300 whitespace-nowrap">
              Ver <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {stats.chegando_hoje > 0 && (
          <div className="flex items-center gap-3 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-2xl p-3 sm:p-4">
            <Inbox className="w-4 h-4 sm:w-5 sm:h-5 text-purple-600 dark:text-purple-400 shrink-0" />
            <p className="text-sm font-semibold text-purple-800 dark:text-purple-300">
              📦 {stats.chegando_hoje} entrega{stats.chegando_hoje > 1 ? 's' : ''} prevista{stats.chegando_hoje > 1 ? 's' : ''} para <strong>hoje</strong>. Prepare a doca!
            </p>
          </div>
        )}

        {/* ── Painel principal ──────────────────────────────────────── */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">

          {/* Tabs */}
          <div className="border-b border-gray-200 dark:border-gray-700 flex overflow-x-auto">
            {tabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => handleTabChange(tab.key)}
                className={`flex items-center gap-1.5 px-4 sm:px-5 py-3.5 text-sm font-bold whitespace-nowrap border-b-2 transition-all shrink-0 ${
                  activeTab === tab.key
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-900/10'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                <tab.Icon className="w-4 h-4" />
                {tab.label}
                {tab.count !== null && tab.count > 0 && (
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-black ${
                    activeTab === tab.key ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200'
                  }`}>{tab.count}</span>
                )}
              </button>
            ))}
            <div className="flex-1" />
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-1.5 px-4 py-3.5 text-sm font-medium shrink-0 border-b-2 transition-all ${
                showFilters ? 'border-blue-600 text-blue-600 dark:text-blue-400' : 'border-transparent text-gray-500 dark:text-gray-400'
              }`}
            >
              <Filter className="w-4 h-4" />
              <span className="hidden sm:inline">Filtros</span>
            </button>
          </div>

          {/* Filtros */}
          {showFilters && (
            <div className="p-3 sm:p-4 bg-gray-50 dark:bg-gray-900/40 border-b border-gray-100 dark:border-gray-700 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5">Status</label>
                <select value={filtros.status} onChange={e => { setFiltros(f => ({ ...f, status: e.target.value })); setPage(1); }}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white bg-white">
                  <option value="">Todos</option>
                  <option value="pendente">Aguardando</option>
                  <option value="recebido">Recebidos</option>
                  <option value="cancelado">Cancelados</option>
                  <option value="devolvido">Devolvidos</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5">Fornecedor</label>
                <select value={filtros.fornecedor_id} onChange={e => { setFiltros(f => ({ ...f, fornecedor_id: e.target.value })); setPage(1); }}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white bg-white">
                  <option value="">Todos</option>
                  {fornecedores.map(f => <option key={f.id} value={f.id}>{f.nome_fantasia || f.razao_social}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5">Busca</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input type="text" value={filtros.busca} onChange={e => { setFiltros(f => ({ ...f, busca: e.target.value })); setPage(1); }}
                    placeholder="Nº pedido ou fornecedor..."
                    className="w-full pl-9 pr-8 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white bg-white" />
                  {filtros.busca && (
                    <button onClick={() => setFiltros(f => ({ ...f, busca: '' }))} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Conteúdo */}
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 sm:py-24 gap-3">
              <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Carregando pedidos...</p>
            </div>
          ) : pedidos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 sm:py-24 text-center px-6">
              <div className="w-14 h-14 sm:w-20 sm:h-20 bg-gray-100 dark:bg-gray-700 rounded-2xl flex items-center justify-center mb-4">
                <ShoppingBag className="w-7 h-7 sm:w-10 sm:h-10 text-gray-400" />
              </div>
              <h3 className="text-base sm:text-lg font-bold text-gray-900 dark:text-white mb-2">
                {filtros.status === 'pendente' ? 'Doca livre — sem entregas pendentes' : 'Nenhum pedido encontrado'}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 max-w-xs mb-5">
                {filtros.status === 'pendente' ? 'Faça um pedido para abastecer o estoque.' : 'Ajuste os filtros ou crie um novo pedido.'}
              </p>
              <button onClick={() => setShowCreateModal(true)}
                className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 shadow-sm active:scale-95 transition-transform">
                <Plus className="w-4 h-4" />
                Novo Pedido
              </button>
            </div>
          ) : (
            <>
              {/* MOBILE: cards */}
              <div className="sm:hidden p-3 space-y-2">
                {pedidos.map(p => (
                  <PedidoCardMobile
                    key={p.id}
                    pedido={p}
                    onReceive={() => openReceive(p)}
                    onDetails={() => openDetails(p)}
                  />
                ))}
              </div>

              {/* DESKTOP: tabela */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40">
                      <th className="w-1.5" />
                      <th className="px-3 py-3 text-xs font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider">Nº Pedido</th>
                      <th className="px-3 py-3 text-xs font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider">Fornecedor</th>
                      <th className="px-3 py-3 text-xs font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Emissão</th>
                      <th className="px-3 py-3 text-xs font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Entrega</th>
                      <th className="px-3 py-3 text-center text-xs font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider">Itens</th>
                      <th className="px-3 py-3 text-right text-xs font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider">Total</th>
                      <th className="px-3 py-3 text-xs font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider">Pagamento</th>
                      <th className="px-3 py-3 text-xs font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                      <th className="px-4 py-3 text-xs font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pedidos.map(p => (
                      <PedidoRowDesktop
                        key={p.id}
                        pedido={p}
                        onReceive={() => openReceive(p)}
                        onDetails={() => openDetails(p)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Paginação */}
          {!loading && totalPages > 1 && (
            <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between gap-3">
              <p className="text-xs text-gray-500 dark:text-gray-400">{totalItens} pedidos</p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}
                  className="px-3 py-1.5 text-xs font-medium border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-40">
                  ← Anterior
                </button>
                <span className="text-xs font-bold text-gray-600 dark:text-gray-300">{page}/{totalPages}</span>
                <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages}
                  className="px-3 py-1.5 text-xs font-medium border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-40">
                  Próxima →
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Legenda */}
        <div className="flex flex-wrap gap-3 text-[10px] sm:text-xs text-gray-400 dark:text-gray-500">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" />Atrasado</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-purple-500 inline-block" />Chega hoje</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />Aguardando</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />Recebido</span>
        </div>
      </div>

      {/* ── Modais ──────────────────────────────────────────────────── */}
      <PurchaseOrderModal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)}
        onSuccess={() => { handleSuccess(); setShowCreateModal(false); }} fornecedores={fornecedores} />

      {selectedPedido && (
        <ReceivePurchaseModal isOpen={showReceiveModal} onClose={() => { setShowReceiveModal(false); setSelectedPedido(null); }}
          pedido={selectedPedido} onSuccess={() => { handleSuccess(); setShowReceiveModal(false); setSelectedPedido(null); }} />
      )}

      {selectedPedido && (
        <PurchaseOrderDetailsModal isOpen={showDetailsModal} onClose={() => { setShowDetailsModal(false); setSelectedPedido(null); }}
          pedido={selectedPedido} />
      )}
    </div>
  );
};

export default PurchasesPage;
