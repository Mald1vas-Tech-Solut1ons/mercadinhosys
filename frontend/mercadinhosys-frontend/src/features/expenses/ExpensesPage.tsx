import React, { useEffect, useState, useCallback, useMemo } from "react";
import { Bar, Line, Doughnut } from "react-chartjs-2";
import {
    Chart as ChartJS, BarElement, CategoryScale, LinearScale,
    PointElement, LineElement, ArcElement, Tooltip, Legend, Filler,
} from "chart.js";
import { showToast } from "../../utils/toast";
import {
    Wallet, TrendingUp, TrendingDown, DollarSign, Calendar,
    Download, Plus, Edit2, Trash2, X,
    FileText, Clock, BarChart2, RefreshCw, ChevronLeft, ChevronRight,
    Tag, Search,
    ArrowUpRight, Lightbulb, Receipt, History,
    PieChart, BadgeAlert, CircleDollarSign,
    BadgeCheck, ChevronDown, ChevronUp,
} from "lucide-react";
import {
    expensesService, Despesa, Estatisticas, BoletosStatus, BoletoItem,
    HistoricoComparativo, VariacaoCategoria,
} from "./expensesService";
import BoletosAVencerPanel from "./components/BoletosAVencerPanel";
import ResumoFinanceiroPanel from "./components/ResumoFinanceiroPanel";
import PinDialog from "../../components/modals/PinDialog";
import { InsightCard as ConsultorInsightCard } from "../../components/consultor/InsightCard";

ChartJS.register(BarElement, CategoryScale, LinearScale, PointElement,
    LineElement, ArcElement, Tooltip, Legend, Filler);

// ─── Categorias ───────────────────────────────────────────────────────────────
const CATEGORIAS = [
    { value: "aluguel", label: "🏠 Aluguel", cor: "#6366f1", tipo: "fixa" },
    { value: "energia_eletrica", label: "⚡ Energia Elétrica", cor: "#f59e0b", tipo: "fixa" },
    { value: "agua", label: "💧 Água", cor: "#06b6d4", tipo: "fixa" },
    { value: "telefone", label: "📱 Telefone", cor: "#8b5cf6", tipo: "fixa" },
    { value: "internet", label: "🌐 Internet", cor: "#3b82f6", tipo: "fixa" },
    { value: "boleto_mercadoria", label: "📦 Boleto de Mercadoria", cor: "#ef4444", tipo: "variavel" },
    { value: "salarios", label: "👥 Salários", cor: "#10b981", tipo: "fixa" },
    { value: "beneficios", label: "🎁 Benefícios (VT/VA/Plano)", cor: "#14b8a6", tipo: "fixa" },
    { value: "marketing", label: "📣 Marketing / Campanhas", cor: "#f97316", tipo: "variavel" },
    { value: "material_escritorio", label: "🖊️ Material de Escritório", cor: "#a78bfa", tipo: "variavel" },
    { value: "manutencao", label: "🔧 Manutenção", cor: "#78716c", tipo: "variavel" },
    { value: "fiado", label: "📋 Fiado (Dívida Clientes)", cor: "#fb7185", tipo: "variavel" },
    { value: "impostos", label: "🏛️ Impostos / Taxas", cor: "#64748b", tipo: "fixa" },
    { value: "descarte_perda", label: "🗑️ Descarte / Perda Mercadoria", cor: "#dc2626", tipo: "variavel" },
    { value: "outros", label: "📌 Outros", cor: "#94a3b8", tipo: "variavel" },
];

const COR_POR_CATEGORIA: Record<string, string> = Object.fromEntries(
    CATEGORIAS.map(c => [c.value, c.cor])
);

// Aliases: nomes livres que usuários digitam → cor
const COR_ALIASES: Record<string, string> = {
    "folha": "#10b981", "folha de pagamento": "#10b981", "salario": "#10b981",
    "salário": "#10b981", "salários": "#10b981", "funcionarios": "#10b981",
    "funcionários": "#10b981", "pessoal": "#10b981", "salarios": "#10b981",
    "beneficio": "#14b8a6", "benefício": "#14b8a6", "benefícios": "#14b8a6",
    "vale transporte": "#14b8a6", "vale alimentacao": "#14b8a6", "plano de saude": "#14b8a6",
    "aluguel": "#6366f1", "aluguel comercial": "#6366f1", "locacao": "#6366f1", "locação": "#6366f1",
    "energia": "#f59e0b", "energia elétrica": "#f59e0b", "luz": "#f59e0b", "eletricidade": "#f59e0b",
    "agua": "#06b6d4", "água": "#06b6d4", "saneamento": "#06b6d4",
    "telefone": "#8b5cf6", "celular": "#8b5cf6",
    "internet": "#3b82f6", "provedor": "#3b82f6", "banda larga": "#3b82f6",
    "telecomunicacoes": "#8b5cf6", "telecomunicações": "#8b5cf6", "comunicacao": "#8b5cf6", "comunicação": "#8b5cf6",
    "fornecedor": "#ef4444", "fornecedores": "#ef4444", "mercadoria": "#ef4444",
    "boleto de mercadoria": "#ef4444", "boleto mercadoria": "#ef4444", "compras": "#ef4444", "estoque": "#ef4444", "boleto": "#ef4444",
    "marketing": "#f97316", "publicidade": "#f97316", "propaganda": "#f97316", "divulgacao": "#f97316",
    "manutencao": "#78716c", "manutenção": "#78716c", "reparo": "#78716c", "conserto": "#78716c",
    "imposto": "#64748b", "impostos": "#64748b", "taxa": "#64748b", "taxas": "#64748b",
    "simples": "#64748b", "das": "#64748b", "icms": "#64748b",
    "descarte": "#dc2626", "perda": "#dc2626", "prejuizo": "#dc2626", "prejuízo": "#dc2626",
    "perda mercadoria": "#dc2626", "prejuízo produtos": "#dc2626", "quebra": "#dc2626",
    "administrativo": "#a78bfa", "administrativa": "#a78bfa", "administracao": "#a78bfa",
    "administração": "#a78bfa", "escritorio": "#a78bfa", "escritório": "#a78bfa",
    "material escritorio": "#a78bfa", "material de escritorio": "#a78bfa",
    "utilidades": "#22d3ee", "utilidade": "#22d3ee", "diversos": "#22d3ee",
    "despesas gerais": "#22d3ee", "geral": "#22d3ee", "serviços": "#22d3ee", "servicos": "#22d3ee",
    "fiado": "#fb7185", "inadimplencia": "#fb7185", "inadimplência": "#fb7185",
    "outros": "#94a3b8",
};

// Paleta para fallback deterministico
const PALETTE_FALLBACK = [
    "#6366f1", "#f59e0b", "#10b981", "#ef4444", "#3b82f6",
    "#8b5cf6", "#14b8a6", "#f97316", "#06b6d4", "#ec4899",
    "#84cc16", "#a78bfa", "#fb7185", "#22d3ee", "#fbbf24",
    "#34d399", "#f472b6", "#60a5fa", "#c084fc", "#4ade80",
];

function hashStr(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    return Math.abs(h);
}

/** Resolve cor para qualquer nome de categoria — exato, alias, parcial ou hash. */
function getCor(cat: string): string {
    if (!cat) return "#94a3b8";
    // 1) match exato pela chave value
    if (COR_POR_CATEGORIA[cat]) return COR_POR_CATEGORIA[cat];
    const lower = cat.toLowerCase().trim();
    // 2) match exato no alias
    if (COR_ALIASES[lower]) return COR_ALIASES[lower];
    // 3) match parcial
    for (const [alias, cor] of Object.entries(COR_ALIASES)) {
        if (lower.includes(alias) || alias.includes(lower)) return cor;
    }
    // Tratamento especial para Folha de Pagamento
    if (lower === "folha de pagamento" || lower === "salarios") return "#10b981";
    // 4) fallback deterministico (mesma cor para mesma string)
    return PALETTE_FALLBACK[hashStr(lower) % PALETTE_FALLBACK.length];
}

const FORMAS_PAGAMENTO = ["Dinheiro", "PIX", "Cartão de Crédito", "Cartão de Débito", "Boleto", "Transferência", "Débito em Conta"];

// ─── Utilitários ──────────────────────────────────────────────────────────────
function fmt(v: number) {
    return (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmtDate(s: string) {
    if (!s) return "—";
    return new Date(s + "T00:00:00").toLocaleDateString("pt-BR");
}
function today() { return new Date().toISOString().split("T")[0]; }
function firstDayOfMonth(d = new Date()) {
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split("T")[0];
}
function daysAgo(n: number) {
    const d = new Date(); d.setDate(d.getDate() - n);
    return d.toISOString().split("T")[0];
}
function getPeriodoDates(v: string): { inicio: string; fim: string } {
    const t = today();
    const d = new Date();
    switch (v) {
        case "hoje": return { inicio: t, fim: t };
        case "7d": return { inicio: daysAgo(6), fim: t };
        case "mes": return { inicio: firstDayOfMonth(), fim: t };
        case "mes_ant": {
            const ant = new Date(d.getFullYear(), d.getMonth() - 1, 1);
            const ultAnt = new Date(d.getFullYear(), d.getMonth(), 0);
            return { inicio: ant.toISOString().split("T")[0], fim: ultAnt.toISOString().split("T")[0] };
        }
        case "90d": return { inicio: daysAgo(89), fim: t };
        default: return { inicio: firstDayOfMonth(), fim: t };
    }
}

// ─── Tipo de aba ──────────────────────────────────────────────────────────────
type TabId = "visao_geral" | "lancamentos" | "boletos" | "historico";

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: "visao_geral", label: "Visão Geral", icon: <PieChart className="w-4 h-4" /> },
    { id: "lancamentos", label: "Lançamentos", icon: <FileText className="w-4 h-4" /> },
    { id: "boletos", label: "Boletos & Contas", icon: <Receipt className="w-4 h-4" /> },
    { id: "historico", label: "Histórico & Análise", icon: <History className="w-4 h-4" /> },
];

const PERIODOS = [
    { label: "Hoje", value: "hoje" },
    { label: "7 dias", value: "7d" },
    { label: "Este mês", value: "mes" },
    { label: "Mês anterior", value: "mes_ant" },
    { label: "90 dias", value: "90d" },
];

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function Sk({ cls = "" }: { cls?: string }) {
    return <div className={`animate-pulse bg-slate-200 dark:bg-slate-700 rounded-lg ${cls}`} />;
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
interface KpiCardProps {
    label: string;
    value: string;
    sub?: string;
    trend?: number;
    icon: React.ReactNode;
    color?: string;
    loading?: boolean;
    onClick?: () => void;
}
function KpiCard({ label, value, sub, trend, icon, color = "blue", loading, onClick }: KpiCardProps) {
    const colorMap: Record<string, string> = {
        blue: "from-blue-500/10 to-blue-600/5 border-blue-200 dark:border-blue-800/50 text-blue-600 dark:text-blue-400",
        green: "from-emerald-500/10 to-emerald-600/5 border-emerald-200 dark:border-emerald-800/50 text-emerald-600 dark:text-emerald-400",
        amber: "from-amber-500/10 to-amber-600/5 border-amber-200 dark:border-amber-800/50 text-amber-600 dark:text-amber-400",
        red: "from-red-500/10 to-red-600/5 border-red-200 dark:border-red-800/50 text-red-600 dark:text-red-400",
        purple: "from-purple-500/10 to-purple-600/5 border-purple-200 dark:border-purple-800/50 text-purple-600 dark:text-purple-400",
    };
    return (
        <div 
            onClick={onClick}
            className={`relative bg-linear-to-br ${colorMap[color]} border rounded-2xl p-5 overflow-hidden transition-all ${onClick ? 'cursor-pointer hover:scale-[1.02] hover:shadow-md' : 'hover:scale-[1.01]'}`}
        >
            <div className="flex items-start justify-between mb-3">
                <div className="p-2.5 rounded-xl bg-white/60 dark:bg-slate-900/60">
                    {icon}
                </div>
                {trend !== undefined && (
                    <span className={`flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full ${trend >= 0 ? "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400" : "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"}`}>
                        {trend >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {Math.abs(trend).toFixed(1)}%
                    </span>
                )}
            </div>
            {loading ? (
                <><Sk cls="h-7 w-3/4 mb-1" /><Sk cls="h-4 w-1/2" /></>
            ) : (
                <>
                    <p className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{value}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-medium">{label}</p>
                    {sub && <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{sub}</p>}
                </>
            )}
        </div>
    );
}

// ─── Insight Card ─────────────────────────────────────────────────────────────
function InsightCard({ insight }: { insight: { tipo: string; severidade: string; titulo: string; descricao: string; acao: string } }) {
    const colors: Record<string, string> = {
        critica: "border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300",
        alta: "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300",
        media: "border-blue-500/30 bg-blue-500/5 text-blue-700 dark:text-blue-300",
        baixa: "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300",
    };
    const icons: Record<string, string> = { critica: "🔴", alta: "🟠", media: "🔵", baixa: "🟢" };
    const cls = colors[insight.severidade] || colors.media;
    return (
        <div className={`border rounded-xl p-4 ${cls}`}>
            <div className="flex items-start gap-3">
                <span className="text-lg">{icons[insight.severidade] || "💡"}</span>
                <div>
                    <p className="font-bold text-sm">{insight.titulo}</p>
                    <p className="text-xs opacity-80 mt-1">{insight.descricao}</p>
                    <p className="text-xs font-semibold mt-2 opacity-70">💡 {insight.acao}</p>
                </div>
            </div>
        </div>
    );
}

// ─── Boleto Card ─────────────────────────────────────────────────────────────
function BoletoCard({ item, variant }: { item: BoletoItem; variant: "vencido" | "a_vencer" | "pago" }) {
    const styles = {
        vencido: {
            border: "border-red-300 dark:border-red-800/60",
            bg: "bg-red-50 dark:bg-red-950/20",
            badge: "bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300",
            value: "text-red-700 dark:text-red-400",
            label: "VENCIDO",
        },
        a_vencer: {
            border: "border-amber-300 dark:border-amber-800/60",
            bg: "bg-amber-50 dark:bg-amber-950/20",
            badge: "bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300",
            value: "text-amber-700 dark:text-amber-400",
            label: item.dias_vencimento === 0 ? "VENCE HOJE" : `${item.dias_vencimento}d`,
        },
        pago: {
            border: "border-emerald-300 dark:border-emerald-800/60",
            bg: "bg-emerald-50 dark:bg-emerald-950/20",
            badge: "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300",
            value: "text-emerald-700 dark:text-emerald-400",
            label: "PAGO",
        },
    };
    const s = styles[variant];
    return (
        <div className={`rounded-xl border ${s.border} ${s.bg} p-4 flex items-center justify-between gap-4 transition-all hover:scale-[1.005]`}>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${s.badge}`}>{s.label}</span>
                    {item.numero_documento && (
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate">#{item.numero_documento}</span>
                    )}
                </div>
                <p className="font-semibold text-sm text-slate-800 dark:text-slate-200 truncate">{item.descricao}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{item.fornecedor_nome}</p>
                {item.data_vencimento && (
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                        Venc.: {fmtDate(item.data_vencimento)}
                        {item.data_pagamento && ` · Pago: ${fmtDate(item.data_pagamento)}`}
                    </p>
                )}
            </div>
            <div className="text-right shrink-0">
                <p className={`text-lg font-black ${s.value}`}>{fmt(item.valor_atual)}</p>
                {item.valor_original !== item.valor_atual && (
                    <p className="text-xs text-slate-400 line-through">{fmt(item.valor_original)}</p>
                )}
            </div>
        </div>
    );
}

// ══════════════════════════════════════════════════════════════════════════════
export default function ExpensesPage() {
    // ─── Tab ──────────────────────────────────────────────────────────────────
    const [activeTab, setActiveTab] = useState<TabId>("visao_geral");
    const [filtroBoletos, setFiltroBoletos] = useState<"todos" | "vencidos" | "a_vencer" | "pagos">("todos");
    const [secoesBoletosAbertas, setSecoesBoletosAbertas] = useState({ vencidos: true, a_vencer: true, pagos: false });
    const toggleSecaoBoletos = (secao: "vencidos" | "a_vencer" | "pagos") =>
        setSecoesBoletosAbertas(prev => ({ ...prev, [secao]: !prev[secao] }));

    // ─── Período / filtros gerais ─────────────────────────────────────────────
    const [periodo, setPeriodo] = useState("mes");
    const [filtros, setFiltros] = useState({
        inicio: firstDayOfMonth(),
        fim: today(),
        categoria: "",
        tipo: "",
        recorrente: "",
        busca: "",
        forma_pagamento: "",
        pagina: 1,
        por_pagina: 20,
    });

    // Busca com debounce: o input escrevia direto em filtros.busca e cada
    // tecla disparava uma requisição de listagem — igual ao bug corrigido em
    // Produtos. O guard de igualdade evita um fetch duplicado no mount.
    const [buscaLocal, setBuscaLocal] = useState("");
    useEffect(() => {
        const timer = setTimeout(() => {
            setFiltros(f => (f.busca === buscaLocal ? f : { ...f, busca: buscaLocal, pagina: 1 }));
        }, 500);
        return () => clearTimeout(timer);
    }, [buscaLocal]);

    // ─── Data ─────────────────────────────────────────────────────────────────
    const [despesas, setDespesas] = useState<Despesa[]>([]);
    const [stats, setStats] = useState<Estatisticas | null>(null);
    const [boletos, setBoletos] = useState<BoletosStatus | null>(null);
    const [historico, setHistorico] = useState<HistoricoComparativo | null>(null);
    const [paginacao, setPaginacao] = useState({ total: 0, paginas: 1 });
    // ─── Loading states ───────────────────────────────────────────────────────
    const [loadingDespesas, setLoadingDespesas] = useState(true);
    const [loadingStats, setLoadingStats] = useState(true);
    const [loadingBoletos, setLoadingBoletos] = useState(false);
    const [loadingHistorico, setLoadingHistorico] = useState(false);

    // ─── Modais ───────────────────────────────────────────────────────────────
    const [modalAberto, setModalAberto] = useState(false);
    const [despesaSel, setDespesaSel] = useState<Despesa | null>(null);
    const [modoEdicao, setModoEdicao] = useState(false);

    // Modal de Detalhes dos Cards
    const [detalhesCard, setDetalhesCard] = useState<{ titulo: string; inicio: string; fim: string; recorrente?: string } | null>(null);
    const [despesasModal, setDespesasModal] = useState<Despesa[]>([]);
    const [loadingModal, setLoadingModal] = useState(false);

    // Gate de PIN para operações sensíveis
    const [pinAction, setPinAction] = useState<{ run: () => void; title: string; description: string } | null>(null);
    const requirePin = (run: () => void, title: string, description: string) =>
        setPinAction({ run, title, description });

    // ─── Form ─────────────────────────────────────────────────────────────────
    const [formData, setFormData] = useState({
        descricao: "", categoria: "outros", tipo: "variavel" as "fixa" | "variavel",
        valor: "", data_despesa: today(), data_emissao: "", data_vencimento: "",
        forma_pagamento: "", recorrente: false, observacoes: "",
    });
    const [saving, setSaving] = useState(false);

    // ─── Loaders ──────────────────────────────────────────────────────────────
    const carregarDespesas = useCallback(async () => {
        setLoadingDespesas(true);
        try {
            const params: any = { pagina: filtros.pagina, por_pagina: filtros.por_pagina };
            if (filtros.busca) params.busca = filtros.busca;
            if (filtros.inicio) params.inicio = filtros.inicio;
            if (filtros.fim) params.fim = filtros.fim;
            if (filtros.categoria) params.categoria = filtros.categoria;
            if (filtros.tipo) params.tipo = filtros.tipo;
            if (filtros.recorrente) params.recorrente = filtros.recorrente;
            if (filtros.forma_pagamento) params.forma_pagamento = filtros.forma_pagamento;
            const res = await expensesService.listar(params);
            if (res.success) {
                setDespesas(res.data || []);
                setPaginacao({ total: res.paginacao?.total_itens ?? 0, paginas: res.paginacao?.total_paginas ?? 1 });
            }
        } catch (e: any) {
            showToast.error("Erro ao carregar despesas");
        } finally { setLoadingDespesas(false); }
    }, [filtros]);

    const carregarEstatisticas = useCallback(async () => {
        setLoadingStats(true);
        try {
            const data = await expensesService.obterEstatisticas({ inicio: filtros.inicio, fim: filtros.fim });
            setStats(data);
        } catch { } finally { setLoadingStats(false); }
    }, [filtros.inicio, filtros.fim]);

    const carregarBoletos = useCallback(async () => {
        setLoadingBoletos(true);
        try {
            const data = await expensesService.getBoletosStatus({ dias: 30 });
            setBoletos(data);
        } catch { showToast.error("Erro ao carregar boletos"); }
        finally { setLoadingBoletos(false); }
    }, []);

    const carregarHistorico = useCallback(async () => {
        setLoadingHistorico(true);
        try {
            const data = await expensesService.getHistoricoComparativo();
            setHistorico(data);
        } catch { showToast.error("Erro ao carregar histórico"); }
        finally { setLoadingHistorico(false); }
    }, []);

    useEffect(() => { carregarDespesas(); }, [carregarDespesas]);
    useEffect(() => { carregarEstatisticas(); }, [carregarEstatisticas]);
    useEffect(() => {
        if (activeTab === "boletos" && !boletos) carregarBoletos();
    }, [activeTab]);
    useEffect(() => {
        if (!historico) carregarHistorico();
    }, []);

    // ─── Período preset ───────────────────────────────────────────────────────
    function aplicarPeriodo(pre: string) {
        setPeriodo(pre);
        const { inicio, fim } = getPeriodoDates(pre);
        setFiltros(f => ({ ...f, inicio, fim, pagina: 1 }));
    }

    // ─── CRUD ─────────────────────────────────────────────────────────────────
    function abrirNova() {
        setDespesaSel(null);
        setModoEdicao(false);
        setFormData({ descricao: "", categoria: "outros", tipo: "variavel", valor: "", data_despesa: today(), data_emissao: "", data_vencimento: "", forma_pagamento: "", recorrente: false, observacoes: "" });
        setModalAberto(true);
    }
    function abrirEditar(d: Despesa) {
        setDespesaSel(d);
        setModoEdicao(true);
        setFormData({
            descricao: d.descricao, categoria: d.categoria, tipo: d.tipo,
            valor: String(d.valor), data_despesa: d.data_despesa,
            data_emissao: d.data_emissao || "", data_vencimento: d.data_vencimento || "",
            forma_pagamento: d.forma_pagamento || "", recorrente: d.recorrente, observacoes: d.observacoes || "",
        });
        setModalAberto(true);
    }

    async function abrirDetalhes(titulo: string, inicio: string, fim: string, recorrente?: string) {
        setDetalhesCard({ titulo, inicio, fim, recorrente });
        setLoadingModal(true);
        try {
            const params: any = { inicio, fim }; 
            if (recorrente) params.recorrente = recorrente;
            const res = await expensesService.listarUnificado(params);
            if (res.success) {
                setDespesasModal(res.data || []);
            }
        } catch {
            showToast.error("Erro ao carregar detalhes");
        } finally {
            setLoadingModal(false);
        }
    }

    async function salvar() {
        if (!formData.descricao.trim()) { showToast.error("Descrição é obrigatória"); return; }
        const valorNum = parseFloat(formData.valor.replace(",", "."));
        if (isNaN(valorNum) || valorNum < 0) { showToast.error("Valor inválido"); return; }
        setSaving(true);
        try {
            const payload: Partial<Despesa> = {
                descricao: formData.descricao.trim(),
                categoria: formData.categoria,
                tipo: formData.tipo,
                valor: valorNum,
                data_despesa: formData.data_despesa || today(),
                data_emissao: formData.data_emissao || undefined,
                data_vencimento: formData.data_vencimento || undefined,
                forma_pagamento: formData.forma_pagamento || undefined,
                recorrente: formData.recorrente,
                observacoes: formData.observacoes.trim() || undefined,
            };
            if (modoEdicao && despesaSel) {
                await expensesService.atualizar(despesaSel.id, payload);
                showToast.success("Despesa atualizada!");
            } else {
                await expensesService.criar(payload);
                showToast.success("Despesa lançada!");
            }
            setModalAberto(false);
            carregarDespesas();
            carregarEstatisticas();
        } catch (e: any) {
            showToast.error(e.response?.data?.error || "Erro ao salvar despesa");
        } finally { setSaving(false); }
    }

    async function excluir(d: Despesa) {
        requirePin(
            async () => {
                try {
                    await expensesService.excluir(d.id);
                    showToast.success("Despesa excluída");
                    carregarDespesas();
                    carregarEstatisticas();
                } catch {
                    showToast.error("Erro ao excluir despesa");
                }
            },
            'Autorizar exclusão',
            `Autorize com o PIN para excluir a despesa "${d.descricao}" no valor de ${fmt(d.valor)}.`
        );
    }

    // ─── Export CSV ──────────────────────────────────────────────────────────
    function exportarCSV() {
        const cols = ["ID", "Descrição", "Categoria", "Tipo", "Valor", "Data", "Recorrente", "Forma Pagamento"];
        const rows = despesas.map(d => [
            d.id, d.descricao, d.categoria, d.tipo, d.valor.toFixed(2),
            fmtDate(d.data_despesa), d.recorrente ? "Sim" : "Não", d.forma_pagamento || ""
        ]);
        const csv = [cols, ...rows].map(r => r.join(";")).join("\n");
        const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `despesas_${filtros.inicio}_${filtros.fim}.csv`;
        a.click(); URL.revokeObjectURL(url);
    }

    // ─── Gráfico Evolução ────────────────────────────────────────────────────
    const chartEvolucao = useMemo(() => {
        if (!stats?.evolucao_mensal?.length) return null;
        return {
            labels: stats.evolucao_mensal.map(e => e.mes_nome),
            datasets: [{
                label: "Despesas",
                data: stats.evolucao_mensal.map(e => e.total),
                borderColor: "#f97316",
                backgroundColor: "rgba(249,115,22,0.08)",
                fill: true,
                tension: 0.4,
                pointRadius: 4,
                pointBackgroundColor: "#f97316",
            }],
        };
    }, [stats]);

    const chartCategorias = useMemo(() => {
        if (!stats?.despesas_por_categoria?.length) return null;
        const top = stats.despesas_por_categoria.slice(0, 8);
        return {
            labels: top.map(c => c.categoria),
            datasets: [{
                data: top.map(c => c.total),
                backgroundColor: top.map(c => getCor(c.categoria)),
                borderWidth: 2,
                borderColor: "transparent",
            }],
        };
    }, [stats]);

    // ─── Gráfico Histórico (barras empilhadas) ────────────────────────────────
    const chartHistorico = useMemo(() => {
        if (!historico) return null;
        const cats = historico.categorias.slice(0, 6);
        return {
            labels: historico.meses_nomes.slice(-6),
            datasets: cats.map(cat => ({
                label: cat,
                data: (historico.evolucao_por_categoria[cat] || []).slice(-6).map(e => e.total),
                backgroundColor: getCor(cat),
                stack: "a",
                borderRadius: 3,
            })),
        };
    }, [historico]);

    const darkOpts = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { mode: "index" as const, intersect: false } },
        scales: {
            x: { grid: { display: false }, ticks: { color: "#94a3b8", font: { size: 11 } } },
            y: { grid: { color: "rgba(148,163,184,0.1)" }, ticks: { color: "#94a3b8", font: { size: 11 }, callback: (v: any) => `R$${(v / 1000).toFixed(0)}k` } },
        },
    };

    // ─────────────────────────────────────────────────────────────────────────
    // RENDER
    // ─────────────────────────────────────────────────────────────────────────
    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
            <div className="max-w-(--breakpoint-2xl) mx-auto px-4 py-6 space-y-6">

                {/* ── Header ───────────────────────────────────────────────── */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2">
                            <CircleDollarSign className="w-7 h-7 text-orange-500" />
                            Gestão de Despesas
                        </h1>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                            Análise completa de custos e comprometimento financeiro
                        </p>
                    </div>
                    <button
                        id="btn-nova-despesa"
                        onClick={abrirNova}
                        className="flex items-center gap-2 px-5 py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-xl font-bold text-sm shadow-lg shadow-orange-500/25 transition-all hover:scale-105 active:scale-95 tour-despesas-add"
                    >
                        <Plus className="w-4 h-4" />
                        Nova Despesa
                    </button>
                </div>

                {/* ── Filtros de Período ────────────────────────────────────── */}
                <div className="flex flex-wrap items-center gap-2">
                    {PERIODOS.map(p => (
                        <button
                            key={p.value}
                            onClick={() => aplicarPeriodo(p.value)}
                            className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-all ${periodo === p.value
                                ? "bg-orange-500 text-white shadow-md shadow-orange-500/25"
                                : "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-orange-400"
                                }`}
                        >
                            {p.label}
                        </button>
                    ))}
                    <div className="flex items-center gap-2 ml-auto">
                        <input type="date" value={filtros.inicio}
                            onChange={e => setFiltros(f => ({ ...f, inicio: e.target.value, pagina: 1 }))}
                            className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-300 focus:ring-2 ring-orange-400"
                        />
                        <span className="text-slate-400 text-sm">até</span>
                        <input type="date" value={filtros.fim}
                            onChange={e => setFiltros(f => ({ ...f, fim: e.target.value, pagina: 1 }))}
                            className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-300 focus:ring-2 ring-orange-400"
                        />
                    </div>
                </div>

                {/* ── Tabs ─────────────────────────────────────────────────── */}
                <div className="flex gap-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-1.5">
                    {TABS.map(tab => (
                        <button
                            key={tab.id}
                            id={`tab-${tab.id}`}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all ${activeTab === tab.id
                                ? "bg-orange-500 text-white shadow-md shadow-orange-500/25"
                                : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                                }`}
                        >
                            {tab.icon}
                            <span className="hidden sm:inline">{tab.label}</span>
                        </button>
                    ))}
                </div>

                {/* ════════════════════════════════════════════════════════════
                    ABA 1 — VISÃO GERAL
                ════════════════════════════════════════════════════════════ */}
                {activeTab === "visao_geral" && (
                    <div className="space-y-6">
                        <ConsultorInsightCard especialista="financeiro" titulo="Consultor IA - Inteligência Financeira" className="mb-2" />

                        {/* Insights inteligentes no topo da Visão Geral */}
                        {historico && historico.insights && historico.insights.length > 0 && (
                            <div className="bg-linear-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 p-5 rounded-2xl border border-blue-100 dark:border-blue-800/50">
                                <h3 className="font-bold text-blue-900 dark:text-blue-100 flex items-center gap-2 mb-4">
                                    <Lightbulb className="w-5 h-5 text-yellow-500" />
                                    Insights Inteligentes do seu Negócio
                                </h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {historico.insights.map((ins: any, i: number) => <InsightCard key={i} insight={ins} />)}
                                </div>
                            </div>
                        )}

                        {/* KPIs */}
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                            <KpiCard
                                label="Este mês"
                                value={fmt(stats?.despesas_mes_atual ?? 0)}
                                trend={stats?.variacao_percentual}
                                icon={<Wallet className="w-5 h-5 text-orange-500" />}
                                color="amber"
                                loading={loadingStats}
                                onClick={() => abrirDetalhes("Despesas Este Mês", firstDayOfMonth(), today())}
                            />
                            <KpiCard
                                label="Hoje"
                                value={fmt(stats?.despesas_hoje ?? 0)}
                                sub={`Ontem: ${fmt(stats?.despesas_ontem ?? 0)}`}
                                icon={<Calendar className="w-5 h-5 text-blue-500" />}
                                color="blue"
                                loading={loadingStats}
                                onClick={() => abrirDetalhes("Despesas de Hoje", today(), today())}
                            />
                            <KpiCard
                                label="Esta semana"
                                value={fmt(stats?.despesas_semana ?? 0)}
                                icon={<BarChart2 className="w-5 h-5 text-purple-500" />}
                                color="purple"
                                loading={loadingStats}
                                onClick={() => abrirDetalhes("Despesas Esta Semana", daysAgo(6), today())}
                            />
                            <KpiCard
                                label="Recorrentes"
                                value={fmt(stats?.despesas_recorrentes ?? 0)}
                                sub={`${stats?.total_despesas ?? 0} lançamentos`}
                                icon={<RefreshCw className="w-5 h-5 text-emerald-500" />}
                                color="green"
                                loading={loadingStats}
                                onClick={() => abrirDetalhes("Despesas Recorrentes (Este Mês)", firstDayOfMonth(), today(), "true")}
                            />
                        </div>

                        {/* Gráficos */}
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                            {/* Evolução */}
                            <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
                                <h3 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                                    <TrendingUp className="w-4 h-4 text-orange-500" />
                                    Evolução dos últimos 6 meses
                                </h3>
                                {loadingStats ? <Sk cls="h-48 w-full" /> : chartEvolucao ? (
                                    <div className="h-48">
                                        <Line data={chartEvolucao} options={darkOpts} />
                                    </div>
                                ) : (
                                    <div className="h-48 flex items-center justify-center text-slate-400 text-sm">Sem dados de evolução</div>
                                )}
                            </div>

                            {/* Categorias donut */}
                            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
                                <h3 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                                    <PieChart className="w-4 h-4 text-purple-500" />
                                    Por Categoria
                                </h3>
                                {loadingStats ? <Sk cls="h-48 w-full" /> : chartCategorias ? (
                                    <div className="h-48">
                                        <Doughnut data={chartCategorias} options={{ responsive: true, maintainAspectRatio: false, plugins: { tooltip: { intersect: false }, legend: { display: true, position: "bottom" as const, labels: { font: { size: 10 }, boxWidth: 12, color: "#94a3b8" } } } }} />
                                    </div>
                                ) : (
                                    <div className="h-48 flex items-center justify-center text-slate-400 text-sm">Sem dados</div>
                                )}
                            </div>
                        </div>

                        {/* Top Categorias */}
                        {stats?.despesas_por_categoria?.length ? (
                            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
                                <h3 className="font-bold text-slate-800 dark:text-white mb-4">📊 Gastos por Categoria</h3>
                                <div className="space-y-3">
                                    {stats.despesas_por_categoria.slice(0, 8).map(cat => (
                                        <div key={cat.categoria} className="flex items-center gap-3">
                                            <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 w-36 shrink-0 truncate">{cat.categoria}</span>
                                            <div className="flex-1 h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full rounded-full transition-all duration-700"
                                                    style={{ width: `${cat.percentual}%`, backgroundColor: getCor(cat.categoria) || "#94a3b8" }}
                                                />
                                            </div>
                                            <span className="text-xs font-bold text-slate-700 dark:text-slate-300 w-24 text-right shrink-0">{fmt(cat.total)}</span>
                                            <span className="text-xs text-slate-400 w-10 text-right shrink-0">{cat.percentual.toFixed(1)}%</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : null}

                        {/* Painel de Resumo Financeiro DRE */}
                        <ResumoFinanceiroPanel />
                    </div>
                )}

                {/* ════════════════════════════════════════════════════════════
                    ABA 2 — LANÇAMENTOS
                ════════════════════════════════════════════════════════════ */}
                {activeTab === "lancamentos" && (
                    <div className="space-y-4">
                        {/* Barra de filtros */}
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
                            <div className="flex flex-wrap gap-3 items-center">
                                {/* Busca */}
                                <div className="relative flex-1 min-w-48">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                    <input
                                        type="text"
                                        placeholder="Buscar despesa..."
                                        value={buscaLocal}
                                        onChange={e => setBuscaLocal(e.target.value)}
                                        className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm focus:ring-2 ring-orange-400 outline-none"
                                    />
                                </div>
                                {/* Categoria */}
                                <select
                                    value={filtros.categoria}
                                    onChange={e => setFiltros(f => ({ ...f, categoria: e.target.value, pagina: 1 }))}
                                    className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm text-slate-600 dark:text-slate-400 focus:ring-2 ring-orange-400 outline-none"
                                >
                                    <option value="">Todas as categorias</option>
                                    {CATEGORIAS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                                </select>
                                {/* Tipo */}
                                <select
                                    value={filtros.tipo}
                                    onChange={e => setFiltros(f => ({ ...f, tipo: e.target.value, pagina: 1 }))}
                                    className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm text-slate-600 dark:text-slate-400 focus:ring-2 ring-orange-400 outline-none"
                                >
                                    <option value="">Todos os tipos</option>
                                    <option value="fixa">Fixa</option>
                                    <option value="variavel">Variável</option>
                                </select>
                                {/* Recorrente */}
                                <select
                                    value={filtros.recorrente}
                                    onChange={e => setFiltros(f => ({ ...f, recorrente: e.target.value, pagina: 1 }))}
                                    className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm text-slate-600 dark:text-slate-400 focus:ring-2 ring-orange-400 outline-none"
                                >
                                    <option value="">Recorrência</option>
                                    <option value="true">Recorrente</option>
                                    <option value="false">Não recorrente</option>
                                </select>
                                {/* Forma de pagamento */}
                                <select
                                    value={filtros.forma_pagamento}
                                    onChange={e => setFiltros(f => ({ ...f, forma_pagamento: e.target.value, pagina: 1 }))}
                                    className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm text-slate-600 dark:text-slate-400 focus:ring-2 ring-orange-400 outline-none"
                                >
                                    <option value="">Pagamento</option>
                                    {FORMAS_PAGAMENTO.map(fp => <option key={fp} value={fp}>{fp}</option>)}
                                </select>
                                <div className="flex gap-2 ml-auto">
                                    <button
                                        onClick={() => { setBuscaLocal(""); setFiltros(f => ({ ...f, busca: "", categoria: "", tipo: "", recorrente: "", forma_pagamento: "", pagina: 1 })); }}
                                        className="px-3 py-2 text-xs font-semibold text-slate-500 hover:text-orange-500 transition-colors"
                                    >Limpar</button>
                                    <button
                                        onClick={exportarCSV}
                                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-semibold text-slate-600 dark:text-slate-400 hover:text-orange-500 transition-all"
                                    >
                                        <Download className="w-3.5 h-3.5" />
                                        CSV
                                    </button>
                                    <button
                                        onClick={abrirNova}
                                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold transition-all"
                                    >
                                        <Plus className="w-3.5 h-3.5" />
                                        Nova
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Total filtrado */}
                        <div className="flex items-center justify-between px-1">
                            <p className="text-sm text-slate-500 dark:text-slate-400">
                                <span className="font-bold text-slate-800 dark:text-white">{paginacao.total}</span> despesas encontradas
                            </p>
                            <p className="text-sm font-bold text-orange-600 dark:text-orange-400">
                                Total: {fmt(stats?.soma_periodo ?? 0)}
                            </p>
                        </div>

                        {/* Tabela */}
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
                            {loadingDespesas ? (
                                <div className="p-6 space-y-3">
                                    {[1, 2, 3, 4, 5].map(i => <Sk key={i} cls="h-12 w-full" />)}
                                </div>
                            ) : despesas.length === 0 ? (
                                <div className="py-16 text-center">
                                    <Wallet className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
                                    <p className="text-slate-500 dark:text-slate-400 font-medium">Nenhuma despesa encontrada</p>
                                    <button onClick={abrirNova} className="mt-3 text-orange-500 hover:underline text-sm font-semibold">Lançar primeira despesa</button>
                                </div>
                            ) : (
                                <>
                                    {/* Mobile Cards View */}
                                    <div className="lg:hidden flex flex-col divide-y divide-slate-100 dark:divide-slate-800">
                                        {despesas.map(d => (
                                            <div key={d.id} className="p-4 flex flex-col gap-3">
                                                <div className="flex justify-between items-start">
                                                    <div>
                                                        <p className="font-semibold text-slate-800 dark:text-slate-200 text-sm">{d.descricao}</p>
                                                        <p className="text-xs text-slate-500">{fmtDate(d.data_despesa)}</p>
                                                    </div>
                                                    <p className="font-bold text-slate-900 dark:text-white text-right">{fmt(d.valor)}</p>
                                                </div>
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: COR_POR_CATEGORIA[d.categoria] || "#94a3b8" }}>
                                                        {d.categoria}
                                                    </span>
                                                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${d.tipo === "fixa" ? "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400" : "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300"}`}>
                                                        {d.tipo === "fixa" ? "Fixa" : "Variável"}
                                                    </span>
                                                    {d.recorrente && <span className="text-[10px] bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded-full font-semibold">RECORRENTE</span>}
                                                    {d.forma_pagamento && (
                                                        <span className={d.forma_pagamento.includes("Pressão") 
                                                            ? "text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 border border-amber-200 dark:border-amber-800" 
                                                            : "text-[10px] bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-1.5 py-0.5 rounded-full"
                                                        }>
                                                            {d.forma_pagamento}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex justify-end gap-2 mt-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                                                    <button
                                                        onClick={() => abrirEditar(d)}
                                                        className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400 rounded-lg text-xs font-semibold hover:bg-blue-100 transition-colors"
                                                    >
                                                        <Edit2 className="w-3.5 h-3.5" /> Editar
                                                    </button>
                                                    <button
                                                        onClick={() => excluir(d)}
                                                        className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400 rounded-lg text-xs font-semibold hover:bg-red-100 transition-colors"
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" /> Excluir
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Desktop Table View */}
                                    <div className="hidden lg:block overflow-x-auto">
                                        <table className="w-full text-sm">
                                            <thead>
                                                <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/80">
                                                    <th className="text-left px-4 py-3 font-semibold text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wide">Data</th>
                                                    <th className="text-left px-4 py-3 font-semibold text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wide">Descrição</th>
                                                    <th className="text-left px-4 py-3 font-semibold text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wide">Categoria</th>
                                                    <th className="text-left px-4 py-3 font-semibold text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wide">Tipo</th>
                                                    <th className="text-right px-4 py-3 font-semibold text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wide">Valor</th>
                                                    <th className="text-left px-4 py-3 font-semibold text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wide">Pagamento</th>
                                                    <th className="text-center px-4 py-3 font-semibold text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wide">Ações</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                                {despesas.map(d => (
                                                    <tr key={d.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group">
                                                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                                                            {fmtDate(d.data_despesa)}
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <p className="font-semibold text-slate-800 dark:text-slate-200">{d.descricao}</p>
                                                            {d.recorrente && <span className="text-[10px] bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded-full font-semibold">RECORRENTE</span>}
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold text-white" style={{ backgroundColor: COR_POR_CATEGORIA[d.categoria] || "#94a3b8" }}>
                                                                {d.categoria}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${d.tipo === "fixa" ? "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400" : "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300"}`}>
                                                                {d.tipo === "fixa" ? "Fixa" : "Variável"}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-3 text-right font-bold text-slate-900 dark:text-white whitespace-nowrap">
                                                            {fmt(d.valor)}
                                                        </td>
                                                        <td className="px-4 py-3 text-slate-500 dark:text-slate-400 text-xs">
                                                            {d.forma_pagamento || "—"}
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                <button
                                                                    id={`btn-editar-${d.id}`}
                                                                    onClick={() => abrirEditar(d)}
                                                                    className="p-1.5 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 text-blue-500 transition-colors"
                                                                >
                                                                    <Edit2 className="w-3.5 h-3.5" />
                                                                </button>
                                                                <button
                                                                    id={`btn-excluir-${d.id}`}
                                                                    onClick={() => excluir(d)}
                                                                    className="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500 transition-colors"
                                                                >
                                                                    <Trash2 className="w-3.5 h-3.5" />
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Paginação */}
                        {paginacao.paginas > 1 && (
                            <div className="flex items-center justify-center gap-3">
                                <button
                                    disabled={filtros.pagina <= 1}
                                    onClick={() => setFiltros(f => ({ ...f, pagina: f.pagina - 1 }))}
                                    className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:border-orange-400 transition-colors"
                                >
                                    <ChevronLeft className="w-4 h-4" />
                                </button>
                                <span className="text-sm text-slate-600 dark:text-slate-400">
                                    Página <strong>{filtros.pagina}</strong> de <strong>{paginacao.paginas}</strong>
                                </span>
                                <button
                                    disabled={filtros.pagina >= paginacao.paginas}
                                    onClick={() => setFiltros(f => ({ ...f, pagina: f.pagina + 1 }))}
                                    className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:border-orange-400 transition-colors"
                                >
                                    <ChevronRight className="w-4 h-4" />
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* ════════════════════════════════════════════════════════════
                    ABA 3 — BOLETOS & CONTAS
                ════════════════════════════════════════════════════════════ */}
                {activeTab === "boletos" && (
                    <div className="space-y-6">
                        {loadingBoletos ? (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                {[1, 2, 3].map(i => <Sk key={i} cls="h-32 w-full rounded-2xl" />)}
                            </div>
                        ) : !boletos ? (
                            <div className="text-center py-16 text-slate-400">
                                <Receipt className="w-12 h-12 mx-auto mb-3" />
                                <p>Nenhum dado de boletos disponível</p>
                                <button onClick={carregarBoletos} className="mt-3 text-orange-500 text-sm font-semibold hover:underline">Tentar novamente</button>
                            </div>
                        ) : (
                            <>
                                {/* Resumo cards */}
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div
                                        onClick={() => { setFiltroBoletos(f => f === "vencidos" ? "todos" : "vencidos"); setSecoesBoletosAbertas(prev => ({ ...prev, vencidos: true })); }}
                                        className={`cursor-pointer transition-all hover:scale-[1.02] ${filtroBoletos === "vencidos" ? 'ring-2 ring-red-500 scale-[1.02]' : filtroBoletos !== 'todos' ? 'opacity-50 grayscale' : ''} bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/40 rounded-2xl p-5`}
                                    >
                                        <div className="flex items-center gap-3 mb-2">
                                            <BadgeAlert className="w-6 h-6 text-red-500" />
                                            <span className="font-bold text-red-700 dark:text-red-400">Vencidos</span>
                                        </div>
                                        <p className="text-2xl font-black text-red-700 dark:text-red-300">{fmt(boletos.resumo.total_vencidos)}</p>
                                        <p className="text-xs text-red-500 mt-1">{boletos.resumo.qtd_vencidos} boleto(s) — atenção urgente!</p>
                                    </div>
                                    <div
                                        onClick={() => { setFiltroBoletos(f => f === "a_vencer" ? "todos" : "a_vencer"); setSecoesBoletosAbertas(prev => ({ ...prev, a_vencer: true })); }}
                                        className={`cursor-pointer transition-all hover:scale-[1.02] ${filtroBoletos === "a_vencer" ? 'ring-2 ring-amber-500 scale-[1.02]' : filtroBoletos !== 'todos' ? 'opacity-50 grayscale' : ''} bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 rounded-2xl p-5`}
                                    >
                                        <div className="flex items-center gap-3 mb-2">
                                            <Clock className="w-6 h-6 text-amber-500" />
                                            <span className="font-bold text-amber-700 dark:text-amber-400">A Vencer (30 dias)</span>
                                        </div>
                                        <p className="text-2xl font-black text-amber-700 dark:text-amber-300">{fmt(boletos.resumo.total_a_vencer)}</p>
                                        <p className="text-xs text-amber-500 mt-1">{boletos.resumo.qtd_a_vencer} boleto(s) no horizonte</p>
                                    </div>
                                    <div
                                        onClick={() => { setFiltroBoletos(f => f === "pagos" ? "todos" : "pagos"); setSecoesBoletosAbertas(prev => ({ ...prev, pagos: true })); }}
                                        className={`cursor-pointer transition-all hover:scale-[1.02] ${filtroBoletos === "pagos" ? 'ring-2 ring-emerald-500 scale-[1.02]' : filtroBoletos !== 'todos' ? 'opacity-50 grayscale' : ''} bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/40 rounded-2xl p-5`}
                                    >
                                        <div className="flex items-center gap-3 mb-2">
                                            <BadgeCheck className="w-6 h-6 text-emerald-500" />
                                            <span className="font-bold text-emerald-700 dark:text-emerald-400">Pagos (30 dias)</span>
                                        </div>
                                        <p className="text-2xl font-black text-emerald-700 dark:text-emerald-300">{fmt(boletos.resumo.total_pago_periodo)}</p>
                                        <p className="text-xs text-emerald-500 mt-1">{boletos.resumo.qtd_pagos} boleto(s) quitados</p>
                                    </div>
                                </div>

                                {/* Vencidos */}
                                {(filtroBoletos === "todos" || filtroBoletos === "vencidos") && boletos.vencidos.items.length > 0 && (
                                    <div>
                                        <button
                                            onClick={() => toggleSecaoBoletos("vencidos")}
                                            className="w-full flex items-center justify-between gap-2 mb-3 group"
                                        >
                                            <h3 className="font-bold text-red-600 dark:text-red-400 flex items-center gap-2">
                                                <BadgeAlert className="w-5 h-5" />
                                                🔴 Boletos Vencidos ({boletos.vencidos.quantidade})
                                            </h3>
                                            {secoesBoletosAbertas.vencidos
                                                ? <ChevronUp className="w-5 h-5 text-red-400 group-hover:text-red-600" />
                                                : <ChevronDown className="w-5 h-5 text-red-400 group-hover:text-red-600" />}
                                        </button>
                                        {secoesBoletosAbertas.vencidos && (
                                            <div className="space-y-2">
                                                {boletos.vencidos.items.map(b => <BoletoCard key={b.id} item={b} variant="vencido" />)}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* A vencer */}
                                {(filtroBoletos === "todos" || filtroBoletos === "a_vencer") && boletos.a_vencer.items.length > 0 && (
                                    <div>
                                        <button
                                            onClick={() => toggleSecaoBoletos("a_vencer")}
                                            className="w-full flex items-center justify-between gap-2 mb-3 group"
                                        >
                                            <h3 className="font-bold text-amber-600 dark:text-amber-400 flex items-center gap-2">
                                                <Clock className="w-5 h-5" />
                                                🟡 A Vencer nos próximos 30 dias ({boletos.a_vencer.quantidade})
                                            </h3>
                                            {secoesBoletosAbertas.a_vencer
                                                ? <ChevronUp className="w-5 h-5 text-amber-400 group-hover:text-amber-600" />
                                                : <ChevronDown className="w-5 h-5 text-amber-400 group-hover:text-amber-600" />}
                                        </button>
                                        {secoesBoletosAbertas.a_vencer && (
                                            <div className="space-y-2">
                                                {boletos.a_vencer.items.map(b => <BoletoCard key={b.id} item={b} variant="a_vencer" />)}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Pagos */}
                                {(filtroBoletos === "todos" || filtroBoletos === "pagos") && boletos.pagos.items.length > 0 && (
                                    <div>
                                        <button
                                            onClick={() => toggleSecaoBoletos("pagos")}
                                            className="w-full flex items-center justify-between gap-2 mb-3 group"
                                        >
                                            <h3 className="font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                                                <BadgeCheck className="w-5 h-5" />
                                                🟢 Pagos no Período ({boletos.pagos.quantidade})
                                            </h3>
                                            {secoesBoletosAbertas.pagos
                                                ? <ChevronUp className="w-5 h-5 text-emerald-400 group-hover:text-emerald-600" />
                                                : <ChevronDown className="w-5 h-5 text-emerald-400 group-hover:text-emerald-600" />}
                                        </button>
                                        {secoesBoletosAbertas.pagos && (
                                            <div className="space-y-2">
                                                {boletos.pagos.items.map(b => <BoletoCard key={b.id} item={b} variant="pago" />)}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {boletos.vencidos.items.length === 0 && boletos.a_vencer.items.length === 0 && boletos.pagos.items.length === 0 && (
                                    <div className="text-center py-12 text-slate-400">
                                        <BadgeCheck className="w-12 h-12 mx-auto mb-3 text-emerald-400" />
                                        <p className="font-semibold">Nenhum boleto encontrado neste período</p>
                                    </div>
                                )}

                                {/* BoletosAVencerPanel legado para compatibilidade */}
                                <div className="mt-4">
                                    <BoletosAVencerPanel />
                                </div>
                            </>
                        )}
                    </div>
                )}

                {/* ════════════════════════════════════════════════════════════
                    ABA 4 — HISTÓRICO & ANÁLISE
                ════════════════════════════════════════════════════════════ */}
                {activeTab === "historico" && (
                    <div className="space-y-6">
                        {loadingHistorico ? (
                            <div className="space-y-4">
                                <Sk cls="h-12 w-full rounded-2xl" />
                                <Sk cls="h-64 w-full rounded-2xl" />
                            </div>
                        ) : !historico ? (
                            <div className="text-center py-16 text-slate-400">
                                <History className="w-12 h-12 mx-auto mb-3" />
                                <p>Histórico não disponível</p>
                                <button onClick={carregarHistorico} className="mt-3 text-orange-500 text-sm font-semibold hover:underline">Carregar</button>
                            </div>
                        ) : (
                            <>
                                {/* Resumo do Período */}
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    <KpiCard label="Total (12 meses)" value={fmt(historico.resumo_periodo.total_geral)} icon={<DollarSign className="w-5 h-5 text-orange-500" />} color="amber" />
                                    <KpiCard label="Média mensal" value={fmt(historico.resumo_periodo.media_mensal)} icon={<BarChart2 className="w-5 h-5 text-blue-500" />} color="blue" />
                                    <KpiCard label="Projeção próx. mês" value={fmt(historico.projecao_proximos_meses)} icon={<TrendingUp className="w-5 h-5 text-purple-500" />} color="purple" />
                                    <KpiCard label="Categorias" value={String(historico.categorias.length)} icon={<Tag className="w-5 h-5 text-emerald-500" />} color="green" />
                                </div>

                                {/* Insights inteligentes */}
                                {historico.insights.length > 0 && (
                                    <div>
                                        <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2 mb-3">
                                            <Lightbulb className="w-5 h-5 text-yellow-500" />
                                            Insights Automáticos
                                        </h3>
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                            {historico.insights.map((ins, i) => <InsightCard key={i} insight={ins} />)}
                                        </div>
                                    </div>
                                )}

                                {/* Gráfico de barras empilhadas */}
                                {chartHistorico && (
                                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
                                        <h3 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                                            <BarChart2 className="w-4 h-4 text-orange-500" />
                                            Evolução por Categoria (últimos 6 meses)
                                        </h3>
                                        <div className="h-64">
                                            <Bar data={chartHistorico} options={{ ...darkOpts, scales: { ...darkOpts.scales, x: { ...darkOpts.scales.x, stacked: true }, y: { ...darkOpts.scales.y, stacked: true } }, plugins: { ...darkOpts.plugins, legend: { display: true, position: "bottom" as const, labels: { font: { size: 10 }, boxWidth: 12, color: "#94a3b8" } } } }} />
                                        </div>
                                    </div>
                                )}

                                {/* Tabela de variações */}
                                {historico.variacoes_mes_atual.length > 0 && (
                                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
                                        <div className="p-5 border-b border-slate-100 dark:border-slate-800">
                                            <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
                                                <ArrowUpRight className="w-4 h-4 text-orange-500" />
                                                Variação Mês a Mês por Categoria
                                            </h3>
                                        </div>
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-sm">
                                                <thead>
                                                    <tr className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-100 dark:border-slate-800">
                                                        <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Categoria</th>
                                                        <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Mês Anterior</th>
                                                        <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Mês Atual</th>
                                                        <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Variação</th>
                                                        <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Tendência</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                                    {historico.variacoes_mes_atual.map((v: VariacaoCategoria) => (
                                                        <tr key={v.categoria} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                                            <td className="px-4 py-3">
                                                                <div className="flex items-center gap-2">
                                                                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: getCor(v.categoria) || "#94a3b8" }} />
                                                                    <span className="font-medium text-slate-800 dark:text-slate-200">{v.categoria}</span>
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400">{fmt(v.anterior)}</td>
                                                            <td className="px-4 py-3 text-right font-bold text-slate-900 dark:text-white">{fmt(v.atual)}</td>
                                                            <td className="px-4 py-3 text-right">
                                                                <span className={`font-bold text-sm ${v.cresceu ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                                                                    {v.cresceu ? "+" : ""}{v.delta_percentual.toFixed(1)}%
                                                                </span>
                                                            </td>
                                                            <td className="px-4 py-3">
                                                                <div className="flex items-center gap-1">
                                                                    {v.cresceu
                                                                        ? <TrendingUp className="w-4 h-4 text-red-500" />
                                                                        : v.delta_percentual < 0
                                                                            ? <TrendingDown className="w-4 h-4 text-emerald-500" />
                                                                            : <span className="w-4 h-0.5 bg-slate-300 rounded-full" />
                                                                    }
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* ════════════════════════════════════════════════════════════════
                MODAL — Nova / Editar Despesa
            ════════════════════════════════════════════════════════════════ */}
            {modalAberto && (
                <div className="fixed inset-0 z-100 flex items-center justify-center p-4 overflow-y-auto" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))', paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}>
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setModalAberto(false)} />
                    <div className="relative w-full max-w-lg bg-white dark:bg-slate-900 rounded-3xl shadow-2xl p-6 z-10 max-h-[90dvh] overflow-y-auto my-auto">
                        <div className="flex items-center justify-between mb-5">
                            <h2 className="text-xl font-black text-slate-800 dark:text-white">
                                {modoEdicao ? "✏️ Editar Despesa" : "➕ Nova Despesa"}
                            </h2>
                            <button onClick={() => setModalAberto(false)} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                                <X className="w-5 h-5 text-slate-500" />
                            </button>
                        </div>

                        <div className="space-y-4">
                            {/* Descrição */}
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">Descrição *</label>
                                <input
                                    id="input-descricao"
                                    type="text"
                                    value={formData.descricao}
                                    onChange={e => setFormData(f => ({ ...f, descricao: e.target.value }))}
                                    placeholder="Ex.: Conta de energia de junho"
                                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm focus:ring-2 ring-orange-400 outline-none"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                {/* Categoria */}
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">Categoria</label>
                                    <select
                                        value={formData.categoria}
                                        onChange={e => {
                                            const cat = CATEGORIAS.find(c => c.value === e.target.value);
                                            setFormData(f => ({ ...f, categoria: e.target.value, tipo: (cat?.tipo as "fixa" | "variavel") || f.tipo }));
                                        }}
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm focus:ring-2 ring-orange-400 outline-none"
                                    >
                                        {CATEGORIAS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                                    </select>
                                </div>
                                {/* Tipo */}
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">Tipo</label>
                                    <select
                                        value={formData.tipo}
                                        onChange={e => setFormData(f => ({ ...f, tipo: e.target.value as "fixa" | "variavel" }))}
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm focus:ring-2 ring-orange-400 outline-none"
                                    >
                                        <option value="fixa">Fixa</option>
                                        <option value="variavel">Variável</option>
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                {/* Valor */}
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">Valor R$ *</label>
                                    <input
                                        id="input-valor"
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={formData.valor}
                                        onChange={e => setFormData(f => ({ ...f, valor: e.target.value }))}
                                        placeholder="0,00"
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm focus:ring-2 ring-orange-400 outline-none"
                                    />
                                </div>
                                {/* Data despesa */}
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">Data da despesa</label>
                                    <input
                                        type="date"
                                        value={formData.data_despesa}
                                        onChange={e => setFormData(f => ({ ...f, data_despesa: e.target.value }))}
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm focus:ring-2 ring-orange-400 outline-none"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                {/* Data vencimento */}
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">Vencimento</label>
                                    <input
                                        type="date"
                                        value={formData.data_vencimento}
                                        onChange={e => setFormData(f => ({ ...f, data_vencimento: e.target.value }))}
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm focus:ring-2 ring-orange-400 outline-none"
                                    />
                                </div>
                                {/* Forma de pagamento */}
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">Forma de Pagamento</label>
                                    <select
                                        value={formData.forma_pagamento}
                                        onChange={e => setFormData(f => ({ ...f, forma_pagamento: e.target.value }))}
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm focus:ring-2 ring-orange-400 outline-none"
                                    >
                                        <option value="">Selecionar...</option>
                                        {FORMAS_PAGAMENTO.map(fp => <option key={fp} value={fp}>{fp}</option>)}
                                    </select>
                                </div>
                            </div>

                            {/* Recorrente */}
                            <label className="flex items-center gap-3 cursor-pointer">
                                <div className={`relative w-10 h-5 rounded-full transition-colors ${formData.recorrente ? "bg-orange-500" : "bg-slate-300 dark:bg-slate-600"}`}
                                    onClick={() => setFormData(f => ({ ...f, recorrente: !f.recorrente }))}>
                                    <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${formData.recorrente ? "translate-x-5" : "translate-x-0.5"}`} />
                                </div>
                                <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Despesa Recorrente</span>
                            </label>

                            {/* Observações */}
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">Observações</label>
                                <textarea
                                    rows={2}
                                    value={formData.observacoes}
                                    onChange={e => setFormData(f => ({ ...f, observacoes: e.target.value }))}
                                    placeholder="Informações adicionais..."
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm focus:ring-2 ring-orange-400 outline-none resize-none"
                                />
                            </div>
                        </div>

                        <div className="flex gap-3 mt-6">
                            <button
                                onClick={() => setModalAberto(false)}
                                className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 font-semibold text-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                id="btn-salvar-despesa"
                                onClick={salvar}
                                disabled={saving}
                                className="flex-1 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-sm disabled:opacity-60 transition-all"
                            >
                                {saving ? "Salvando..." : modoEdicao ? "Salvar alterações" : "Lançar despesa"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Modal de Detalhes dos Cards ────────────────────────────── */}
            {detalhesCard && (
                <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setDetalhesCard(null)} />
                    <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col relative z-10 animate-in fade-in zoom-in-95 duration-200">
                        <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                            <div>
                                <h2 className="text-xl font-black text-slate-800 dark:text-white flex items-center gap-2">
                                    <FileText className="w-6 h-6 text-orange-500" />
                                    {detalhesCard.titulo}
                                </h2>
                                <p className="text-sm text-slate-500 mt-1">Lista detalhada de todas as despesas que compõem este indicador.</p>
                            </div>
                            <button onClick={() => setDetalhesCard(null)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl text-slate-500 transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        
                        <div className="flex-1 overflow-y-auto p-6">
                            {loadingModal ? (
                                <div className="space-y-3">
                                    {[1, 2, 3, 4].map(i => <div key={i} className="h-16 bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse" />)}
                                </div>
                            ) : despesasModal.length === 0 ? (
                                <div className="text-center py-12 text-slate-400">
                                    <Wallet className="w-12 h-12 mx-auto mb-3 text-slate-300 dark:text-slate-700" />
                                    <p className="font-semibold">Nenhuma despesa encontrada para este filtro.</p>
                                </div>
                            ) : (
                                <div className="flex flex-col gap-3">
                                    {despesasModal.map(d => (
                                        <div key={d.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors gap-3">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <p className="font-bold text-slate-800 dark:text-slate-200">{d.descricao}</p>
                                                    {d.recorrente && <span className="text-[10px] bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded-full font-bold">RECORRENTE</span>}
                                                </div>
                                                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                                    <span className="flex items-center gap-1 font-medium text-slate-600 dark:text-slate-400">
                                                        <Calendar className="w-3.5 h-3.5" />
                                                        {fmtDate(d.data_despesa)}
                                                    </span>
                                                    <span>•</span>
                                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: COR_POR_CATEGORIA[d.categoria] || "#94a3b8" }}>
                                                        {d.categoria}
                                                    </span>
                                                    {d.forma_pagamento && (
                                                        <>
                                                            <span>•</span>
                                                            <span className={d.forma_pagamento.includes("Pressão") 
                                                                ? "px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 border border-amber-200 dark:border-amber-800" 
                                                                : ""
                                                            }>
                                                                {d.forma_pagamento}
                                                            </span>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="text-right shrink-0">
                                                <p className="text-lg font-black text-slate-900 dark:text-white">{fmt(d.valor)}</p>
                                                <p className="text-[10px] uppercase font-bold text-slate-400">{d.tipo === "fixa" ? "Fixa" : "Variável"}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 rounded-b-3xl flex justify-between items-center">
                            <p className="text-sm text-slate-500 font-semibold">{despesasModal.length} lançamentos listados</p>
                            <p className="text-lg font-black text-orange-600 dark:text-orange-400">
                                Total: {fmt(despesasModal.reduce((acc, curr) => acc + curr.valor, 0))}
                            </p>
                        </div>
                    </div>
                </div>
            )}

            <PinDialog
                open={!!pinAction}
                onClose={() => setPinAction(null)}
                onSuccess={() => {
                    pinAction?.run();
                    setPinAction(null);
                }}
                title={pinAction?.title || ''}
                description={pinAction?.description || ''}
            />
        </div>
    );
}
