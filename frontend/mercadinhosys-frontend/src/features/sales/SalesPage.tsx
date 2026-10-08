import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { Bar, Line, Doughnut } from "react-chartjs-2";
import {
    Chart as ChartJS, BarElement, CategoryScale, LinearScale,
    PointElement, LineElement, ArcElement, Tooltip, Legend, Filler,
} from "chart.js";
import {
    Search, Download, RefreshCw, TrendingUp, TrendingDown, ShoppingBag, Receipt,
    DollarSign, Eye, X, Calendar, CreditCard, ChevronLeft, ChevronRight,
    Ban, Clock, Crown, Users, Sparkles, AlertTriangle, Percent, Lightbulb,
} from "lucide-react";
import { apiClient } from "../../api/apiClient";
import { showToast } from "../../utils/toast";
import { fiscalService } from "../fiscal/fiscalService";
import SFAPedidosTab from "./SFAPedidosTab";
import { InsightCard as ConsultorInsightCard } from "../../components/consultor/InsightCard";

ChartJS.register(BarElement, CategoryScale, LinearScale, PointElement, LineElement, ArcElement, Tooltip, Legend, Filler);

// ──────────────────────────────────────────────────────────────
// Tipos
// ──────────────────────────────────────────────────────────────
interface Venda {
    id: number; codigo: string;
    cliente?: { nome: string } | null;
    funcionario?: { nome: string } | null;
    total: number; desconto: number;
    forma_pagamento?: string; data?: string; data_venda?: string; created_at?: string;
    status: string; quantidade_itens?: number;
    itens?: Array<{ produto_nome: string; quantidade: number; preco_unitario: number; total_item: number }>;
    pagamentos?: Array<{ forma_pagamento: string; valor: number }>;
}
interface Analytics {
    estatisticas_gerais: { quantidade_vendas: number; total_valor: number; total_lucro: number; ticket_medio: number; total_itens: number; itens_por_venda: number };
    vendas_por_dia: Array<{ data: string; total: number; quantidade: number }>;
    previsao_vendas: Array<{ data: string; total: number; tipo: string }>;
    formas_pagamento: Array<{ forma: string; total: number; quantidade: number; percentual: number }>;
    produtos_mais_vendidos: Array<{ nome: string; quantidade: number; total: number }>;
    vendas_por_hora: Array<{ hora: number; quantidade: number; total: number }>;
    vendas_por_cliente: Array<{ cliente: string; quantidade: number; total: number }>;
}

// ──────────────────────────────────────────────────────────────
// Utils
// ──────────────────────────────────────────────────────────────
const brl = (v: unknown) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const num = (v: unknown) => Number(v || 0).toLocaleString("pt-BR");
const isoDate = (d = new Date()) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().split("T")[0]; };
const fmtDateTime = (s?: string) => { if (!s) return "—"; try { return new Date(s).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }); } catch { return "—"; } };
const fmtDM = (s: string) => { try { const x = new Date(s.includes("T") ? s : s + "T00:00:00"); return `${String(x.getDate()).padStart(2, "0")}/${String(x.getMonth() + 1).padStart(2, "0")}`; } catch { return s; } };
const statusChip = (s = "") => { const k = s.toLowerCase(); if (k === "finalizada") return "bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-300"; if (k === "cancelada") return "bg-error-100 text-error-700 dark:bg-error-900/30 dark:text-error-300"; return "bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-300"; };
const statusLabel = (s = "") => ({ finalizada: "Finalizada", cancelada: "Cancelada", em_andamento: "Em andamento" }[s.toLowerCase()] || s || "—");
const formaLabel = (f = "") => f.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// Normaliza variantes ("cartao_debito", "cartão de débito", "debito"...) num rótulo único
const canonicalForma = (f = "") => {
    const s = f.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[_\s]+/g, " ").trim();
    if (s.includes("debito")) return "Cartão Débito";
    if (s.includes("credito")) return "Cartão Crédito";
    if (s.includes("dinheiro") || s === "cash" || s === "especie") return "Dinheiro";
    if (s.includes("pix")) return "PIX";
    if (s.includes("fiado") || s.includes("crediario") || s.includes("a prazo")) return "Fiado";
    if (s.includes("vale alimentacao")) return "Vale Alimentação";
    if (s.includes("vale refeicao")) return "Vale Refeição";
    if (s.includes("voucher") || s.includes("vale") || s.includes("ticket")) return "Outros / Voucher";
    if (s.includes("transfer")) return "Transferência";
    if (s.includes("boleto")) return "Boleto";
    return f ? formaLabel(f) : "Outros";
};

function Kpi({ titulo, valor, sub, Icon, cor }: { titulo: string; valor: string; sub?: string; Icon: React.ElementType; cor: string }) {
    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-sm flex flex-col justify-between">
            <div className="flex items-center gap-3 mb-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${cor}`}>
                    <Icon className="w-5 h-5" />
                </div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400 leading-tight">{titulo}</p>
            </div>
            <div>
                <p className="text-xl lg:text-xl xl:text-3xl font-black text-slate-900 dark:text-white tabular-nums wrap-break-word leading-none">{valor}</p>
                {sub && <p className="mt-2 text-xs font-medium text-slate-500">{sub}</p>}
            </div>
        </div>
    );
}

function InsightCard({ Icon, cor, titulo, valor, desc }: { Icon: React.ElementType; cor: string; titulo: string; valor: string; desc: string }) {
    return (
        <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
            <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${cor}`}>
                    <Icon className="w-5 h-5" />
                </div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 leading-tight">{titulo}</p>
            </div>
            <div>
                <p className="text-lg sm:text-xl font-black text-slate-900 dark:text-white wrap-break-word leading-tight">{valor}</p>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">{desc}</p>
            </div>
        </div>
    );
}

// ──────────────────────────────────────────────────────────────
export default function SalesPage() {
    const [vendas, setVendas] = useState<Venda[]>([]);
    const [analytics, setAnalytics] = useState<Analytics | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadingA, setLoadingA] = useState(true);
    const [paginacao, setPaginacao] = useState<{ pagina: number; total_paginas: number; total: number } | null>(null);
    const [detalhe, setDetalhe] = useState<Venda | null>(null);
    const [cancelar, setCancelar] = useState<Venda | null>(null);
    const [motivo, setMotivo] = useState("");
    const [cancelando, setCancelando] = useState(false);
    const [motivosEstorno, setMotivosEstorno] = useState<string[]>([]);
    const [emitindoNFCe, setEmitindoNFCe] = useState(false);
    const [activeTab, setActiveTab] = useState<'vendas' | 'sfa'>('vendas');

    const emitirNFCe = async (vendaId: number) => {
        setEmitindoNFCe(true);
        try {
            const r = await fiscalService.emitirNFCe(vendaId);
            const doc = r.documento;
            if (doc?.status === "autorizado") {
                const aviso = (doc.ambiente === "homologacao" || doc.gateway === "simulado") ? " (homologação/sem valor fiscal)" : "";
                showToast.success(`NFC-e autorizada${aviso}. Nº ${doc.numero}.`);
            } else if (doc?.status === "rejeitado") {
                showToast.error(`Rejeitada: ${doc.motivo_rejeicao || "verifique os dados fiscais"}`);
            } else {
                showToast.update(r.message || "NFC-e em processamento");
            }
        } catch (e: any) {
            showToast.error(e?.response?.data?.error || "Falha ao emitir NFC-e");
        } finally {
            setEmitindoNFCe(false);
        }
    };

    useEffect(() => {
        let ativo = true;
        apiClient.get("/configuracao/")
            .then(({ data }) => {
                if (ativo) setMotivosEstorno(data?.config?.motivos_estorno || []);
            })
            .catch(() => { /* mantém lista vazia; usuário ainda pode digitar */ });
        return () => { ativo = false; };
    }, []);

    const [filtros, setFiltros] = useState({
        data_inicio: isoDate(new Date(Date.now() - 30 * 86400000)), data_fim: isoDate(),
        search: "", status: "", forma_pagamento: "", page: 1,
    });

    const setQuickDate = (dias: number) => {
        const data_fim = isoDate();
        const data_inicio = isoDate(new Date(Date.now() - dias * 86400000));
        aplicar({ data_inicio, data_fim });
    };
    const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

    const carregarVendas = useCallback(async (f = filtros) => {
        setLoading(true);
        try {
            const params: Record<string, unknown> = { page: f.page, per_page: 50 };
            if (f.search) params.search = f.search;
            if (f.data_inicio) params.data_inicio = f.data_inicio;
            if (f.data_fim) params.data_fim = f.data_fim;
            if (f.status) params.status = f.status;
            if (f.forma_pagamento) params.forma_pagamento = f.forma_pagamento;
            const { data } = await apiClient.get("/vendas", { params });
            setVendas((data.vendas || []).map((v: Venda) => ({ ...v, status: v.status || "finalizada" })));
            setPaginacao(data.paginacao || null);
        } catch { showToast.error("Erro ao carregar vendas"); }
        finally { setLoading(false); }
    }, [filtros]);

    const carregarAnalytics = useCallback(async (f = filtros) => {
        setLoadingA(true);
        try {
            // Os cards/indicadores precisam refletir os MESMOS filtros da lista de
            // vendas — antes só mandava data_inicio/data_fim, então filtrar por
            // forma de pagamento (ou status) refiltrava a lista mas os cards
            // ficavam parados mostrando o total geral (bug "cards não reagem").
            const params: Record<string, unknown> = { data_inicio: f.data_inicio, data_fim: f.data_fim };
            if (f.forma_pagamento) params.forma_pagamento = f.forma_pagamento;
            if (f.status) params.status = f.status;
            if (f.search) params.search = f.search;
            const { data } = await apiClient.get("/vendas/estatisticas", { params });
            setAnalytics(data);
        } catch { setAnalytics(null); }
        finally { setLoadingA(false); }
    }, [filtros]);

    useEffect(() => { carregarVendas(); carregarAnalytics(); /* eslint-disable-next-line */ }, []);

    const onSearch = (val: string) => {
        const novo = { ...filtros, search: val, page: 1 }; setFiltros(novo);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => { carregarVendas(novo); carregarAnalytics(novo); }, 400);
    };
    const aplicar = (patch: Partial<typeof filtros>) => {
        const novo = { ...filtros, ...patch, page: 1 }; setFiltros(novo);
        carregarVendas(novo);
        // Cards/indicadores reagem a QUALQUER mudança de filtro, não só data.
        carregarAnalytics(novo);
    };
    const irPara = (page: number) => { const novo = { ...filtros, page }; setFiltros(novo); carregarVendas(novo); };

    const [pinCancelamento, setPinCancelamento] = useState("");
    
    const confirmarCancelamento = async () => {
        if (!cancelar) return;
        setCancelando(true);
        try {
            const payload = { 
                motivo: motivo || "Cancelamento via painel de vendas",
                pin_cancelamento: pinCancelamento || undefined
            };
            const { data } = await apiClient.post(`/vendas/${cancelar.id}/cancelar`, payload);
            if (data.success !== false) {
                showToast.success("Venda cancelada e produtos estornados ao estoque");
                setCancelar(null); setMotivo(""); setPinCancelamento("");
                carregarVendas(); carregarAnalytics();
            } else { showToast.error(data.error || "Não foi possível cancelar"); }
        } catch (e: any) {
            showToast.error(e?.response?.data?.error || "Erro ao cancelar venda");
        } finally { setCancelando(false); }
    };

    const abrirDetalhe = async (v: Venda) => {
        setDetalhe(v);
        try { const { data } = await apiClient.get(`/vendas/${v.id}`); setDetalhe(data.venda ? { ...v, ...data.venda } : { ...v, ...data }); } catch { /* básico */ }
    };

    const stats = analytics?.estatisticas_gerais;

    // ── Gráfico: faturamento real + previsão (linha tracejada) ──
    const chartFaturamento = useMemo(() => {
        const reais = (analytics?.vendas_por_dia || []).slice(-14);
        const prev = (analytics?.previsao_vendas || []).slice(0, 5);
        const labels = [...reais.map((d) => fmtDM(d.data)), ...prev.map((d) => fmtDM(d.data))];
        const realData = [...reais.map((d) => Number(d.total || 0)), ...prev.map(() => null as any)];
        // emenda: último ponto real conecta na previsão
        const prevData = [...reais.map(() => null as any), ...prev.map((d) => Number(d.total || 0))];
        if (reais.length && prev.length) prevData[reais.length - 1] = Number(reais[reais.length - 1].total || 0);
        return {
            labels,
            datasets: [
                { label: "Faturamento", data: realData, borderColor: "#2563eb", backgroundColor: "rgba(37,99,235,0.12)", fill: true, tension: 0.4, pointRadius: 3, pointBackgroundColor: "#2563eb", borderWidth: 2.5, spanGaps: false },
                { label: "Previsão", data: prevData, borderColor: "#8b5cf6", borderDash: [6, 5], fill: false, tension: 0.4, pointRadius: 3, pointBackgroundColor: "#8b5cf6", borderWidth: 2, spanGaps: true },
            ],
        };
    }, [analytics]);

    const chartFormas = useMemo(() => {
        const fp = analytics?.formas_pagamento || [];
        // Mescla variantes do mesmo método (ex: "cartao_debito" + "Cartão de Débito") somando os totais
        const merged = new Map<string, number>();
        for (const f of fp) merged.set(canonicalForma(f.forma), (merged.get(canonicalForma(f.forma)) || 0) + Number(f.total || 0));
        const ordenado = [...merged.entries()].sort((a, b) => b[1] - a[1]);
        return { 
            labels: ordenado.map(([k]) => k), 
            datasets: [{ 
                label: "Total", 
                data: ordenado.map(([, v]) => v), 
                backgroundColor: ["#2563eb", "#16a34a", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#14b8a6"], 
                borderWidth: 2, 
                borderColor: "#ffffff",
                hoverOffset: 4
            }] 
        };
    }, [analytics]);

    const chartHoras = useMemo(() => {
        const h = analytics?.vendas_por_hora || [];
        return { labels: h.map((x) => `${x.hora}h`), datasets: [{ label: "Vendas", data: h.map((x) => Number(x.quantidade || 0)), backgroundColor: "#06b6d4", borderRadius: 6, borderWidth: 0 }] };
    }, [analytics]);

    const chartClientes = useMemo(() => {
        const c = (analytics?.vendas_por_cliente || []).slice(0, 5);
        return { labels: c.map(x => x.cliente || "Avulso"), datasets: [{ label: "Faturamento", data: c.map(x => Number(x.total || 0)), backgroundColor: "#8b5cf6", borderRadius: 4, borderWidth: 0 }] };
    }, [analytics]);

    const chartTicketMedio = useMemo(() => {
        const dias = (analytics?.vendas_por_dia || []).slice(-14);
        return {
            labels: dias.map(d => fmtDM(d.data)),
            datasets: [{
                label: "Ticket Médio",
                data: dias.map(d => d.quantidade > 0 ? (d.total / d.quantidade) : 0),
                borderColor: "#10b981",
                backgroundColor: "rgba(16, 185, 129, 0.1)",
                fill: true,
                tension: 0.4,
                pointRadius: 3,
                pointBackgroundColor: "#10b981",
                borderWidth: 2,
            }]
        };
    }, [analytics]);

    const opts = (money = true) => ({
        responsive: true, maintainAspectRatio: false, animation: false as const,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c: { dataset: { label?: string }; raw: unknown }) => `${c.dataset.label}: ${money ? brl(c.raw) : num(c.raw)}` } } },
        scales: { y: { beginAtZero: true, grid: { color: "rgba(100,116,139,0.12)" }, ticks: { callback: (v: unknown) => money ? `R$ ${num(v)}` : num(v) } }, x: { grid: { display: false } } },
    });

    const horizontalOpts = {
        indexAxis: 'y' as const,
        responsive: true, maintainAspectRatio: false, animation: false as const,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c: { dataset: { label?: string }; raw: unknown }) => `${c.dataset.label}: ${brl(c.raw)}` } } },
        scales: { x: { beginAtZero: true, grid: { color: "rgba(100,116,139,0.12)" }, ticks: { callback: (v: unknown) => `R$ ${num(v)}` } }, y: { grid: { display: false } } },
    };

    // ── Insights data-driven ──
    const insights = useMemo(() => {
        if (!analytics) return [];
        const out: Array<{ Icon: React.ElementType; cor: string; titulo: string; valor: string; desc: string }> = [];
        const dias = analytics.vendas_por_dia || [];
        if (dias.length) {
            const melhor = [...dias].sort((a, b) => b.total - a.total)[0];
            out.push({ Icon: Crown, cor: "bg-warning-50 text-warning-600 dark:bg-warning-900/20", titulo: "Melhor dia", valor: fmtDM(melhor.data), desc: `${brl(melhor.total)} faturados` });
        }
        const horas = analytics.vendas_por_hora || [];
        if (horas.length) {
            const pico = [...horas].sort((a, b) => b.quantidade - a.quantidade)[0];
            out.push({ Icon: Clock, cor: "bg-cyan-50 text-cyan-600 dark:bg-cyan-900/20", titulo: "Horário de pico", valor: `${pico.hora}h`, desc: `${num(pico.quantidade)} vendas nesse horário` });
        }
        const prod = analytics.produtos_mais_vendidos || [];
        if (prod.length) out.push({ Icon: Sparkles, cor: "bg-primary-50 text-primary-600 dark:bg-primary-900/20", titulo: "Produto campeão", valor: prod[0].nome, desc: `${num(prod[0].quantidade)} un · ${brl(prod[0].total)}` });
        const cli = analytics.vendas_por_cliente || [];
        if (cli.length && cli[0].cliente) out.push({ Icon: Users, cor: "bg-violet-50 text-violet-600 dark:bg-violet-900/20", titulo: "Melhor cliente", valor: cli[0].cliente, desc: `${brl(cli[0].total)} em compras` });
        if (stats && stats.total_valor > 0) {
            const margem = (stats.total_lucro / stats.total_valor) * 100;
            out.push({ Icon: Percent, cor: "bg-success-50 text-success-600 dark:bg-success-900/20", titulo: "Margem de lucro", valor: `${margem.toFixed(1)}%`, desc: `${brl(stats.total_lucro)} de lucro estimado` });
        }
        // Tendência: média prevista vs média real recente
        const prev = analytics.previsao_vendas || [];
        if (dias.length >= 3 && prev.length) {
            const mediaReal = dias.slice(-7).reduce((s, d) => s + d.total, 0) / Math.min(7, dias.length);
            const mediaPrev = prev.reduce((s, d) => s + d.total, 0) / prev.length;
            const delta = mediaReal > 0 ? ((mediaPrev - mediaReal) / mediaReal) * 100 : 0;
            const up = delta >= 0;
            out.push({ Icon: up ? TrendingUp : TrendingDown, cor: up ? "bg-success-50 text-success-600 dark:bg-success-900/20" : "bg-error-50 text-error-600 dark:bg-error-900/20", titulo: "Tendência (5 dias)", valor: `${up ? "+" : ""}${delta.toFixed(1)}%`, desc: up ? "Projeção de crescimento no faturamento" : "Projeção de queda — atenção" });
        }
        return out;
    }, [analytics, stats]);

    const exportarCSV = () => {
        if (!vendas.length) return showToast.error("Nada para exportar");
        const head = ["Código", "Data", "Cliente", "Operador", "Itens", "Total", "Pagamento", "Status"];
        const rows = vendas.map((v) => [v.codigo, fmtDateTime(v.data_venda || v.created_at), v.cliente?.nome || "Avulso", v.funcionario?.nome || "—", v.quantidade_itens || 0, Number(v.total || 0).toFixed(2), canonicalForma(v.forma_pagamento || (v.pagamentos?.[0]?.forma_pagamento ?? "")), statusLabel(v.status)]);
        const csv = [head, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
        const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" })); a.download = `vendas-${isoDate()}.csv`; a.click();
        showToast.success("CSV exportado");
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 md:p-4 sm:p-6 space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white dark:bg-slate-900 p-4 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800">
                <div>
                    <h1 className="text-xl md:text-2xl font-black text-slate-900 dark:text-white tour-vendas-historico">Gestão de Vendas</h1>
                    <p className="text-sm text-slate-500">Faturamento, aprovações e decisões baseadas em dados</p>
                </div>
                <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
                    <button 
                        className={`px-4 py-2 rounded-md text-sm font-bold transition-all ${activeTab === 'vendas' ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                        onClick={() => setActiveTab('vendas')}
                    >
                        Vendas & Inteligência
                    </button>
                    <button 
                        className={`px-4 py-2 rounded-md text-sm font-bold transition-all flex items-center gap-2 ${activeTab === 'sfa' ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                        onClick={() => setActiveTab('sfa')}
                    >
                        Pedidos SFA <span className="bg-blue-600 text-white text-[10px] px-1.5 py-0.5 rounded-full">Novo</span>
                    </button>
                </div>
            </div>

            {activeTab === 'sfa' ? (
                <SFAPedidosTab />
            ) : (
                <>
                <div className="flex items-center justify-end gap-2">
                    <button onClick={() => { carregarVendas(); carregarAnalytics(); }} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 font-semibold text-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition">
                        <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Atualizar
                    </button>
                    <button onClick={exportarCSV} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary-600 text-white font-semibold text-sm hover:bg-primary-700 shadow-sm transition">
                        <Download className="w-4 h-4" /> Exportar
                    </button>
                </div>

                <ConsultorInsightCard especialista="vendas" titulo="Consultor IA - Inteligência de Vendas" className="mb-2" />

            {/* KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Kpi titulo="Faturamento" valor={brl(stats?.total_valor)} sub={`${num(stats?.quantidade_vendas)} vendas`} Icon={DollarSign} cor="bg-primary-50 text-primary-600 dark:bg-primary-900/20" />
                <Kpi titulo="Ticket Médio" valor={brl(stats?.ticket_medio)} sub={`${Number(stats?.itens_por_venda || 0).toFixed(1)} itens/venda`} Icon={Receipt} cor="bg-violet-50 text-violet-600 dark:bg-violet-900/20" />
                <Kpi titulo="Lucro Estimado" valor={brl(stats?.total_lucro)} sub={stats && stats.total_valor > 0 ? `margem ${((stats.total_lucro / stats.total_valor) * 100).toFixed(1)}%` : undefined} Icon={TrendingUp} cor="bg-success-50 text-success-600 dark:bg-success-900/20" />
                <Kpi titulo="Itens Vendidos" valor={num(stats?.total_itens)} Icon={ShoppingBag} cor="bg-warning-50 text-warning-600 dark:bg-warning-900/20" />
            </div>

            {/* Filtros */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-2 mb-4 pb-4 border-b border-slate-100 dark:border-slate-800">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-400 mr-2">Filtros Rápidos:</span>
                    <button onClick={() => setQuickDate(0)} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-100 text-slate-600 hover:bg-primary-50 hover:text-primary-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-primary-900/30 transition-colors">Hoje</button>
                    <button onClick={() => setQuickDate(1)} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-100 text-slate-600 hover:bg-primary-50 hover:text-primary-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-primary-900/30 transition-colors">Últimas 24h</button>
                    <button onClick={() => setQuickDate(7)} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-100 text-slate-600 hover:bg-primary-50 hover:text-primary-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-primary-900/30 transition-colors">7 Dias</button>
                    <button onClick={() => setQuickDate(30)} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-100 text-slate-600 hover:bg-primary-50 hover:text-primary-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-primary-900/30 transition-colors">30 Dias</button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3">
                    <div className="lg:col-span-2 relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input defaultValue={filtros.search} onChange={(e) => onSearch(e.target.value)} placeholder="Buscar por código ou cliente..." className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm outline-none focus:ring-2 focus:ring-primary-500" />
                    </div>
                    <input type="date" value={filtros.data_inicio} onChange={(e) => aplicar({ data_inicio: e.target.value })} className="px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm outline-none focus:ring-2 focus:ring-primary-500" />
                    <input type="date" value={filtros.data_fim} onChange={(e) => aplicar({ data_fim: e.target.value })} className="px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm outline-none focus:ring-2 focus:ring-primary-500" />
                    <select value={filtros.status} onChange={(e) => aplicar({ status: e.target.value })} className="px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm outline-none focus:ring-2 focus:ring-primary-500">
                        <option value="">Todos os status</option><option value="finalizada">Finalizada</option><option value="cancelada">Cancelada</option>
                    </select>
                    <select value={filtros.forma_pagamento} onChange={(e) => aplicar({ forma_pagamento: e.target.value })} className="px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm outline-none focus:ring-2 focus:ring-primary-500">
                        <option value="">Todas as Formas</option>
                        <option value="dinheiro">Dinheiro</option>
                        <option value="pix">PIX</option>
                        <option value="cartao_credito">Cartão de Crédito</option>
                        <option value="cartao_debito">Cartão de Débito</option>
                        <option value="vale_alimentacao">Vale Alimentação</option>
                        <option value="vale_refeicao">Vale Refeição</option>
                        <option value="fiado">Fiado</option>
                    </select>
                </div>
            </div>



            {/* Insights */}
            {!loadingA && insights.length > 0 && (
                <div>
                    <div className="flex items-center gap-2 mb-3">
                        <Lightbulb className="w-4 h-4 text-amber-500" />
                        <h2 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Insights inteligentes</h2>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {insights.map((i, idx) => <InsightCard key={idx} {...i} />)}
                    </div>
                </div>
            )}

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">Faturamento + Previsão</h3>
                        <div className="flex items-center gap-3 text-xs">
                            <span className="flex items-center gap-1.5 text-slate-500"><span className="w-3 h-0.5 bg-primary-600 inline-block" /> Real</span>
                            <span className="flex items-center gap-1.5 text-slate-500"><span className="w-3 h-0.5 bg-violet-500 inline-block" style={{ borderTop: "2px dashed #8b5cf6" }} /> Previsão</span>
                        </div>
                    </div>
                    {loadingA ? <div className="h-56 flex items-center justify-center text-slate-400"><RefreshCw className="w-5 h-5 animate-spin" /></div>
                        : chartFaturamento.labels.length ? <div className="relative h-56 w-full overflow-hidden"><Line data={chartFaturamento} options={opts(true)} /></div>
                            : <div className="h-56 flex items-center justify-center text-slate-400 text-sm">Sem dados no período</div>}
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm">
                    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-4">Distribuição de Pagamentos</h3>
                    {loadingA ? <div className="h-56 flex items-center justify-center text-slate-400"><RefreshCw className="w-5 h-5 animate-spin" /></div>
                        : chartFormas.labels.length ? <div className="relative h-56 w-full overflow-hidden flex justify-center"><Doughnut data={chartFormas} options={{ ...opts(true), maintainAspectRatio: false, plugins: { ...opts(true).plugins, legend: { display: true, position: 'right', labels: { boxWidth: 12, font: { size: 10 } } } } }} /></div>
                            : <div className="h-56 flex items-center justify-center text-slate-400 text-sm">Sem dados</div>}
                </div>
            </div>

            {/* Gráficos Secundários */}
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm xl:col-span-1">
                    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-4">Vendas por horário</h3>
                    {loadingA ? <div className="h-52 flex items-center justify-center text-slate-400"><RefreshCw className="w-5 h-5 animate-spin" /></div>
                        : chartHoras.labels.length ? <div className="relative h-52 w-full overflow-hidden"><Bar data={chartHoras} options={opts(false)} /></div>
                            : <div className="h-52 flex items-center justify-center text-slate-400 text-sm">Sem dados</div>}
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm xl:col-span-1">
                    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-4">Evolução do Ticket Médio</h3>
                    {loadingA ? <div className="h-52 flex items-center justify-center text-slate-400"><RefreshCw className="w-5 h-5 animate-spin" /></div>
                        : chartTicketMedio.labels.length ? <div className="relative h-52 w-full overflow-hidden"><Line data={chartTicketMedio} options={opts(true)} /></div>
                            : <div className="h-52 flex items-center justify-center text-slate-400 text-sm">Sem dados</div>}
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm xl:col-span-1">
                    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-4">Top Clientes</h3>
                    {loadingA ? <div className="h-52 flex items-center justify-center text-slate-400"><RefreshCw className="w-5 h-5 animate-spin" /></div>
                        : chartClientes.labels.length ? <div className="relative h-52 w-full overflow-hidden"><Bar data={chartClientes} options={horizontalOpts} /></div>
                            : <div className="h-52 flex items-center justify-center text-slate-400 text-sm">Sem dados</div>}
                </div>
            </div>

            {/* Top Produtos Lista */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-3 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm">
                    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-4">Ranking de Produtos Mais Vendidos</h3>
                    <div className="space-y-3 max-h-60 overflow-y-auto pr-2">
                        {(analytics?.produtos_mais_vendidos || []).slice(0, 7).map((p, i) => (
                            <div key={i} className="flex items-center justify-between gap-3 text-sm">
                                <div className="flex items-center gap-2 min-w-0">
                                    <span className="w-6 h-6 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                                    <span className="truncate text-slate-700 dark:text-slate-200">{p.nome}</span>
                                </div>
                                <div className="text-right shrink-0">
                                    <span className="font-bold text-slate-900 dark:text-white">{brl(p.total)}</span>
                                    <span className="block text-[11px] text-slate-400">{num(p.quantidade)} un</span>
                                </div>
                            </div>
                        ))}
                        {(!analytics?.produtos_mais_vendidos || analytics.produtos_mais_vendidos.length === 0) && <div className="h-40 flex items-center justify-center text-slate-400 text-sm">Sem dados</div>}
                    </div>
                </div>
            </div>

            {/* Tabela */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm whitespace-nowrap min-w-[800px]">
                        <thead>
                            <tr className="text-left text-xs font-bold uppercase tracking-wider text-slate-400 border-b border-slate-200 dark:border-slate-800">
                                <th className="px-4 py-3">Código</th><th className="px-4 py-3">Data</th><th className="px-4 py-3">Cliente</th>
                                <th className="px-4 py-3 hidden md:table-cell">Pagamento</th><th className="px-4 py-3 text-right">Total</th>
                                <th className="px-4 py-3 text-center">Status</th><th className="px-4 py-3 text-right">Ações</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {loading ? Array(8).fill(0).map((_, i) => <tr key={i}><td colSpan={7} className="px-4 py-3"><div className="h-6 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" /></td></tr>)
                                : vendas.length === 0 ? <tr><td colSpan={7} className="px-4 py-16 text-center text-slate-400"><ShoppingBag className="w-10 h-10 mx-auto mb-3 opacity-30" />Nenhuma venda encontrada no período</td></tr>
                                    : vendas.map((v) => (
                                        <tr key={v.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition">
                                            <td className="px-4 py-3 font-mono font-semibold text-slate-700 dark:text-slate-200">{v.codigo}</td>
                                            <td className="px-4 py-3 text-slate-500">{fmtDateTime(v.data_venda || v.created_at)}</td>
                                            <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{v.cliente?.nome || "Avulso"}</td>
                                            <td className="px-4 py-3 hidden md:table-cell text-slate-500">{canonicalForma(v.forma_pagamento || (v.pagamentos?.[0]?.forma_pagamento ?? "—"))}</td>
                                            <td className="px-4 py-3 text-right font-black text-slate-900 dark:text-white tabular-nums">{brl(v.total)}</td>
                                            <td className="px-4 py-3 text-center"><span className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-bold ${statusChip(v.status)}`}>{statusLabel(v.status)}</span></td>
                                            <td className="px-4 py-3">
                                                <div className="flex items-center justify-end gap-1">
                                                    <button onClick={() => abrirDetalhe(v)} title="Ver detalhes" className="p-3 md:p-2 min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 flex items-center justify-center rounded-lg text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/20"><Eye className="w-4 h-4" /></button>
                                                    {v.status !== "cancelada" && (
                                                        <button onClick={() => { setCancelar(v); setMotivo(""); }} title="Cancelar e estornar" className="p-3 md:p-2 min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 flex items-center justify-center rounded-lg text-error-600 hover:bg-error-50 dark:hover:bg-error-900/20"><Ban className="w-4 h-4" /></button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                        </tbody>
                    </table>
                </div>
                {paginacao && paginacao.total_paginas > 1 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 dark:border-slate-800">
                        <span className="text-xs text-slate-500">{num(paginacao.total)} vendas · página {paginacao.pagina} de {paginacao.total_paginas}</span>
                        <div className="flex gap-1">
                            <button disabled={filtros.page <= 1} onClick={() => irPara(filtros.page - 1)} className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-50"><ChevronLeft className="w-4 h-4" /></button>
                            <button disabled={filtros.page >= paginacao.total_paginas} onClick={() => irPara(filtros.page + 1)} className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-50"><ChevronRight className="w-4 h-4" /></button>
                        </div>
                    </div>
                )}
            </div>

                </>
            )}

            {/* Modal detalhe */}
            {detalhe && (
                <div className="fixed inset-0 z-100 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))', paddingTop: 'calc(1rem + env(safe-area-inset-top))' }} onClick={(e) => e.target === e.currentTarget && setDetalhe(null)}>
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90dvh] flex flex-col overflow-hidden">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
                            <div><h3 className="font-black text-slate-900 dark:text-white">Venda {detalhe.codigo}</h3><p className="text-xs text-slate-500 flex items-center gap-1"><Calendar className="w-3 h-3" />{fmtDateTime(detalhe.data_venda || detalhe.created_at)}</p></div>
                            <button onClick={() => setDetalhe(null)} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"><X className="w-5 h-5" /></button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <div className="rounded-xl bg-slate-50 dark:bg-slate-800 p-3"><p className="text-[10px] font-bold uppercase text-slate-400">Cliente</p><p className="font-semibold text-slate-800 dark:text-slate-100">{detalhe.cliente?.nome || "Avulso"}</p></div>
                                <div className="rounded-xl bg-slate-50 dark:bg-slate-800 p-3"><p className="text-[10px] font-bold uppercase text-slate-400">Operador</p><p className="font-semibold text-slate-800 dark:text-slate-100">{detalhe.funcionario?.nome || "—"}</p></div>
                            </div>
                            <div>
                                <p className="text-xs font-bold uppercase text-slate-400 mb-2">Itens</p>
                                <div className="rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
                                    {(detalhe.itens || []).map((it, i) => <div key={i} className="flex justify-between px-3 py-2 text-sm"><span className="text-slate-700 dark:text-slate-200">{it.quantidade}× {it.produto_nome}</span><span className="font-semibold tabular-nums">{brl(it.total_item)}</span></div>)}
                                    {(!detalhe.itens || detalhe.itens.length === 0) && <div className="px-3 py-4 text-center text-slate-400 text-sm">Sem itens detalhados</div>}
                                </div>
                            </div>
                            <div className="flex items-center justify-between rounded-xl bg-primary-50 dark:bg-primary-900/20 px-4 py-3"><span className="flex items-center gap-2 font-bold text-primary-700 dark:text-primary-300"><CreditCard className="w-4 h-4" /> Total</span><span className="text-xl font-black text-primary-700 dark:text-primary-300">{brl(detalhe.total)}</span></div>
                        </div>
                        {detalhe.status === "finalizada" && (
                            <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800">
                                <button onClick={() => emitirNFCe(detalhe.id)} disabled={emitindoNFCe} className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-sm hover:bg-emerald-700 disabled:opacity-60">
                                    {emitindoNFCe ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Receipt className="w-4 h-4" />} Emitir NFC-e
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Modal cancelar/estornar */}
            {cancelar && (
                <div className="fixed inset-0 z-100 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))', paddingTop: 'calc(1rem + env(safe-area-inset-top))' }} onClick={(e) => e.target === e.currentTarget && !cancelando && setCancelar(null)}>
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden my-auto">
                        <div className="flex items-start gap-3 px-6 pt-6">
                            <div className="w-11 h-11 rounded-xl bg-error-50 text-error-600 dark:bg-error-900/20 flex items-center justify-center shrink-0"><AlertTriangle className="w-6 h-6" /></div>
                            <div>
                                <h3 className="font-black text-slate-900 dark:text-white">Cancelar venda {cancelar.codigo}?</h3>
                                <p className="text-sm text-slate-500 mt-0.5">Os produtos serão <strong>estornados ao estoque</strong> automaticamente. Esta ação não pode ser desfeita.</p>
                            </div>
                        </div>
                        <div className="px-6 py-4 space-y-4">
                            <div>
                                <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Motivo do estorno</label>
                                {motivosEstorno.length > 0 ? (
                                    <select value={motivo} onChange={(e) => setMotivo(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm outline-none focus:ring-2 focus:ring-error-500">
                                        <option value="">Selecione um motivo...</option>
                                        {motivosEstorno.map((m) => <option key={m} value={m}>{m}</option>)}
                                        <option value="Outro">Outro (especificar abaixo)</option>
                                    </select>
                                ) : (
                                    <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} placeholder="Ex: cliente desistiu, erro de digitação..." className="mt-1 w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm outline-none focus:ring-2 focus:ring-error-500 resize-none" />
                                )}
                            </div>
                            <div>
                                <label className="text-xs font-bold uppercase tracking-wider text-slate-400">PIN de Cancelamento (Obrigatório)</label>
                                <input type="password" inputMode="numeric" autoComplete="off" value={pinCancelamento} onChange={(e) => setPinCancelamento(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="Digite seu PIN..." className="mt-1 w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm outline-none focus:ring-2 focus:ring-error-500" maxLength={6} />
                            </div>
                        </div>
                        <div className="flex gap-2 px-6 pb-6">
                            <button onClick={() => setCancelar(null)} disabled={cancelando} className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 font-semibold text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50">Voltar</button>
                            <button onClick={confirmarCancelamento} disabled={cancelando || pinCancelamento.length < 4} className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-error-600 text-white font-bold text-sm hover:bg-error-700 disabled:opacity-60 disabled:cursor-not-allowed">
                                {cancelando ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />} Cancelar e estornar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
