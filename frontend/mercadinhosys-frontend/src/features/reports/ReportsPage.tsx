import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    BarChart3,
    FileSpreadsheet,
    FileText,
    Calendar as CalendarIcon,
    TrendingUp,
    Users,
    Package,
    Archive,
    Loader2,
    X,
    Search,
    Clock,
    Target,
    Zap,
    Brain,
    Truck,
    UserCheck,
    DollarSign,
    AlertTriangle,
    ArrowDownRight,
    Filter,
    Eye,
    EyeOff,
    Trophy,
    AlertOctagon,
    ChevronDown,
    Download,
    ChevronLeft,
    ChevronRight,
    Layers,
    ListOrdered,
    ArrowUp,
    ArrowDown,
    ArrowUpDown
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { showToast } from '../../utils/toast';
import { salesService } from '../sales/salesService';
import { productsService } from '../products/productsService';
import { pontoService } from '../ponto/pontoService';
import { apiClient } from '../../api/apiClient';

// ==================== INTERFACES ====================

interface DateRange {
    startDate: string;
    endDate: string;
}

interface ReportCardProps {
    title: string;
    description: string;
    icon: React.ElementType;
    color: string;
    loading: boolean;
    onOpen: () => void;
    badge?: string;
}

type ModalType = 'vendas' | 'produtos' | 'financeiro' | 'equipe' | 'ponto' | 'rfm' | 'abc' | 'previsao' | 'fornecedores' | 'clientes' | null;

// ==================== COMPONENTE CARD ====================

const ReportCard: React.FC<ReportCardProps> = ({
    title, description, icon: Icon, color, loading, onOpen, badge
}) => (
    <button onClick={onOpen} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 hover:shadow-md transition-all duration-200 group text-left relative">
        {badge && (
            <span className="absolute top-3 right-3 px-2 py-0.5 bg-indigo-100 text-indigo-700 text-[10px] font-bold rounded-full uppercase tracking-wide">
                {badge}
            </span>
        )}
        <div className="flex items-start justify-between mb-4">
            <div className={`p-3 rounded-lg ${color} group-hover:scale-110 transition-transform duration-200`}>
                <Icon className="w-6 h-6 text-white" />
            </div>
            {loading && <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />}
        </div>
        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">{title}</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-2 min-h-[40px]">{description}</p>
        <span className="text-xs text-indigo-600 dark:text-indigo-400 font-medium">Ver detalhes</span>
    </button>
);

// ==================== HELPER: formatar moeda ====================
const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// ==================== COMPONENTE PRINCIPAL ====================

const ReportsPage: React.FC = () => {
    const navigate = useNavigate();

    const [dateRange, setDateRange] = useState<DateRange>({
        startDate: new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0]
    });

    const [loadingReport, setLoadingReport] = useState<string | null>(null);
    const [loadingBackup, setLoadingBackup] = useState(false);
    const [modalType, setModalType] = useState<ModalType>(null);
    const [modalOpen, setModalOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState<string>('');

    // State de dados
    const [vendasData, setVendasData] = useState<any[]>([]);
    const [produtosData, setProdutosData] = useState<any[]>([]);
    const [financeiroData, setFinanceiroData] = useState<any>(null);
    const [equipeData, setEquipeData] = useState<any[]>([]);
    const [pontoData, setPontoData] = useState<any[]>([]);
    const [rfmData, setRfmData] = useState<any[]>([]);
    const [abcData, setAbcData] = useState<any[]>([]);
    const [previsaoData, setPrevisaoData] = useState<any[]>([]);
    const [fornecedoresData, setFornecedoresData] = useState<any[]>([]);
    const [clientesData, setClientesData] = useState<any[]>([]);

    // State de Paginação

    const [paginationInfo, setPaginationInfo] = useState<any>(null);

    // Tabela avançada: sort, filtros por coluna, colunas visíveis
    const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
    const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
    const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
    const [showColumnPicker, setShowColumnPicker] = useState(false);
    const [showColumnFilters, setShowColumnFilters] = useState(false);

    // FIX: Limpar cache quando datas mudam
    useEffect(() => {
        setVendasData([]);
        setFinanceiroData(null);
        setEquipeData([]);
        setPontoData([]);
        setFornecedoresData([]);
        setClientesData([]);

    }, [dateRange.startDate, dateRange.endDate]);

    const filterRow = (row: any) => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return true;
        return Object.values(row).some((v) => String(v ?? '').toLowerCase().includes(q));
    };

    const displayPeriodLabel = `${format(new Date(dateRange.startDate + 'T12:00:00'), 'dd/MM/yyyy')} a ${format(new Date(dateRange.endDate + 'T12:00:00'), 'dd/MM/yyyy')}`;

    const ActiveFilterBanner = () => (
        <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800/50 rounded-lg p-3 mb-4 flex items-center justify-between animate-in fade-in slide-in-from-top-2">
            <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-100 dark:bg-indigo-800 rounded-md">
                    <CalendarIcon className="w-4 h-4 text-indigo-600 dark:text-indigo-300" />
                </div>
                <div>
                    <p className="text-[10px] text-indigo-500 dark:text-indigo-400 font-bold uppercase tracking-wider">Período Ativo</p>
                    <p className="text-sm font-semibold text-indigo-900 dark:text-indigo-100">{displayPeriodLabel}</p>
                </div>
            </div>
            <div className="text-right">
                <p className="text-[10px] text-indigo-500 dark:text-indigo-400 font-bold uppercase tracking-wider">Status</p>
                <div className="flex items-center gap-1.5 justify-end">
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                    <p className="text-sm font-semibold text-indigo-900 dark:text-indigo-100">
                        {loadingReport ? 'Atualizando...' : 'Filtro Aplicado'}
                    </p>
                </div>
            </div>
        </div>
    );

    // ==================== MODAIS ====================

    const openModal = async (type: ModalType) => {
        if (type === 'ponto') { navigate('/ponto-relatorios'); return; }
        setModalType(type);
        setModalOpen(true);
        setSearchQuery('');
        setSortConfig(null);
        setColumnFilters({});
        setHiddenColumns(new Set());
        setShowColumnPicker(false);
        setShowColumnFilters(false);
        setPaginationInfo(null); // Resetar paginação para evitar "paginação fantasma" em outros relatórios

        try {
            if (type === 'vendas' && vendasData.length === 0) await fetchVendasData(1);
            else if (type === 'produtos' && produtosData.length === 0) await fetchProdutosData();
            else if (type === 'financeiro' && !financeiroData) await fetchFinanceiroData();
            else if (type === 'equipe' && equipeData.length === 0) await fetchEquipeData();
            else if (type === 'rfm' && rfmData.length === 0) await fetchRFMData();
            else if (type === 'abc' && abcData.length === 0) await fetchABCData();
            else if (type === 'previsao' && previsaoData.length === 0) await fetchPrevisaoData();
            else if (type === 'fornecedores' && fornecedoresData.length === 0) await fetchFornecedoresData();
            else if (type === 'clientes' && clientesData.length === 0) await fetchClientesData();
        } catch { /* erros já tratados dentro dos fetchers */ }
    };

    const closeModal = () => { setModalOpen(false); setModalType(null); };

    // ==================== UTILITÁRIOS DE EXPORTAÇÃO ====================

    const exportToCSV = (data: any[], filename: string) => {
        const ws = XLSX.utils.json_to_sheet(data);
        const csv = XLSX.utils.sheet_to_csv(ws);
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${filename}.csv`;
        link.click();
    };

    const exportToExcel = (data: any[], filename: string, sheetName: string) => {
        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
        XLSX.writeFile(wb, `${filename}.xlsx`);
    };

    const generatePDFHeader = (doc: jsPDF, title: string, period?: string) => {
        const reportDate = format(new Date(), "dd/MM/yyyy HH:mm", { locale: ptBR });
        doc.setFillColor(63, 81, 181);
        doc.rect(0, 0, doc.internal.pageSize.width, 40, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(22);
        doc.setFont("helvetica", "bold");
        doc.text("MERCADINHO SYS", 14, 20);
        doc.setFontSize(16);
        doc.setFont("helvetica", "normal");
        doc.text(title, 14, 32);
        doc.setFontSize(10);
        doc.text(`Gerado em: ${reportDate}`, doc.internal.pageSize.width - 14, 20, { align: 'right' });
        if (period) doc.text(`Período: ${period}`, doc.internal.pageSize.width - 14, 32, { align: 'right' });
    };

    // ==================== GERADORES GENÉRICOS DE PDF ====================

    const generateGenericPDF = (
        data: any[],
        title: string,
        columns: { header: string; key: string; format?: (v: any) => string }[],
        filename: string,
        headColor: [number, number, number],
        period?: string
    ) => {
        const doc = new jsPDF(columns.length > 5 ? 'landscape' : 'portrait');
        generatePDFHeader(doc, title, period);
        autoTable(doc, {
            startY: 50,
            head: [columns.map(c => c.header)],
            body: data.map(row => columns.map(c => c.format ? c.format(row[c.key]) : String(row[c.key] ?? ''))),
            theme: 'grid',
            headStyles: { fillColor: headColor, fontSize: 9 },
            bodyStyles: { fontSize: 8 },
            styles: { cellPadding: 2 }
        });
        doc.save(`${filename}.pdf`);
    };

    const handleGenericExport = (
        data: any[], type: 'pdf' | 'excel' | 'csv',
        title: string, filename: string, sheetName: string,
        columns: { header: string; key: string; format?: (v: any) => string }[],
        headColor: [number, number, number],
        period?: string
    ) => {
        if (type === 'csv') exportToCSV(data, filename);
        else if (type === 'excel') exportToExcel(data, filename, sheetName);
        else generateGenericPDF(data, title, columns, filename, headColor, period);
        showToast.info('Relatório gerado com sucesso!');
    };

    // ==================== BACKUP ====================

    const handleBackupExport = async () => {
        setLoadingBackup(true);
        try {
            const promise = apiClient.get('/relatorios/backup/exportar', { responseType: 'blob' }).then(res => {
                const blob = new Blob([res.data], { type: 'application/zip' });
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `backup_local_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.zip`;
                a.click();
                window.URL.revokeObjectURL(url);
                return res;
            });

            await showToast.promise(promise, {
                loading: 'Gerando backup do sistema...',
                success: 'Backup baixado com sucesso!',
                error: 'Erro ao exportar backup'
            });
        } catch (error) {
            console.error(error);
        } finally {
            setLoadingBackup(false);
        }
    };

    // ==================== FETCH: VENDAS ====================

    const fetchVendasData = async (targetPage = 1) => {
        setLoadingReport('vendas');
        try {
            const response = await apiClient.get('/vendas/', {
                params: {
                    data_inicio: dateRange.startDate,
                    data_fim: dateRange.endDate,
                    page: targetPage,
                    per_page: 50, // Lote profissional
                    status: 'finalizada'
                }
            });
            setPaginationInfo(response.data.paginacao);

            const data = response.data.vendas.map((venda: any) => {
                let dataFormatada = '';
                try {
                    dataFormatada = venda.data_formatada || (venda.data_venda ? format(new Date(venda.data_venda), 'dd/MM/yyyy HH:mm') : format(new Date(venda.data), 'dd/MM/yyyy HH:mm'));
                } catch { dataFormatada = 'Data inválida'; }
                return {
                    'Código': venda.codigo || '-',
                    'Data/Hora': dataFormatada,
                    'Cliente': venda.cliente?.nome || 'Consumidor Final',
                    'Funcionário': venda.funcionario?.nome || 'Não Informado',
                    'Subtotal (R$)': parseFloat(venda.subtotal || 0),
                    'Desconto (R$)': parseFloat(venda.desconto || 0),
                    'Total (R$)': parseFloat(venda.total || 0),
                    'Forma Pagamento': venda.forma_pagamento?.replace(/_/g, ' ').toUpperCase() || '-',
                    'Qtd Itens': venda.quantidade_itens || 0,
                    'Status': venda.status?.toUpperCase() || '-'
                };
            }).sort((a: any, b: any) => {
                try {
                    const dateA = a['Data/Hora'].split(' ')[0].split('/').reverse().join('-');
                    const dateB = b['Data/Hora'].split(' ')[0].split('/').reverse().join('-');
                    return dateB.localeCompare(dateA);
                } catch { return 0; }
            });
            if (data.length === 0) showToast.error('Nenhuma venda encontrada no período');
            setVendasData(data);
        } catch (error) {
            console.error(error);
            showToast.error('Erro ao carregar vendas');
        } finally { setLoadingReport(null); }
    };

    const handleVendasExport = async (type: 'pdf' | 'excel' | 'csv') => {
        setLoadingReport('vendas');
        try {
            if (vendasData.length === 0) await fetchVendasData();
            const filename = `Relatorio_Vendas_${dateRange.startDate}_${dateRange.endDate}`;
            const cols = [
                { header: 'Código', key: 'Código' },
                { header: 'Data/Hora', key: 'Data/Hora' },
                { header: 'Cliente', key: 'Cliente' },
                { header: 'Funcionário', key: 'Funcionário' },
                { header: 'Total', key: 'Total (R$)', format: (v: number) => fmtBRL(v) },
                { header: 'Desconto', key: 'Desconto (R$)', format: (v: number) => fmtBRL(v) },
                { header: 'Forma Pgto', key: 'Forma Pagamento' },
            ];
            handleGenericExport(vendasData, type, 'Relatório Detalhado de Vendas', filename, 'Vendas', cols, [63, 81, 181], displayPeriodLabel);
        } catch {
            showToast.error('Erro ao gerar relatório de vendas');
        } finally { setLoadingReport(null); }
    };

    // ==================== FETCH: PRODUTOS (MELHORADO COM MARGEM) ====================

    const fetchProdutosData = async () => {
        setLoadingReport('produtos');
        try {
            const response = await productsService.getAllEstoque(1, 1000);
            const produtos = response.produtos;
            const data = produtos.map((p: any) => {
                const margem = p.preco_venda > 0 && p.preco_custo > 0
                    ? (((p.preco_venda - p.preco_custo) / p.preco_venda) * 100).toFixed(1)
                    : '0.0';
                return {
                    'Código': p.codigo_barras || p.id,
                    'Nome': p.nome,
                    'Categoria': p.categoria || 'N/A',
                    'Preço Venda (R$)': p.preco_venda,
                    'Preço Custo (R$)': p.preco_custo,
                    'Margem (%)': parseFloat(margem),
                    'Estoque': p.quantidade ?? 0,
                    'Estoque Mínimo': p.estoque_minimo ?? 0,
                    'Classificação ABC': p.classificacao_abc || '-',
                    'Status': (p.quantidade || 0) <= (p.estoque_minimo || 0) ? 'CRÍTICO' : 'OK'
                };
            });
            setProdutosData(data);
        } catch (error) {
            console.error(error);
            showToast.error('Erro ao carregar produtos');
        } finally { setLoadingReport(null); }
    };

    const handleProdutosExport = async (type: 'pdf' | 'excel' | 'csv') => {
        setLoadingReport('produtos');
        try {
            if (produtosData.length === 0) await fetchProdutosData();
            const filename = `Relatorio_Estoque_${format(new Date(), 'yyyy-MM-dd')}`;
            const cols = [
                { header: 'Nome', key: 'Nome' },
                { header: 'Categoria', key: 'Categoria' },
                { header: 'Preço Venda', key: 'Preço Venda (R$)', format: (v: number) => fmtBRL(v) },
                { header: 'Preço Custo', key: 'Preço Custo (R$)', format: (v: number) => fmtBRL(v) },
                { header: 'Margem %', key: 'Margem (%)', format: (v: number) => v + '%' },
                { header: 'Estoque', key: 'Estoque' },
                { header: 'ABC', key: 'Classificação ABC' },
                { header: 'Status', key: 'Status' },
            ];
            handleGenericExport(produtosData, type, 'Relatório de Estoque e Inventário', filename, 'Estoque', cols, [16, 185, 129]);
        } catch {
            showToast.error('Erro ao gerar relatório de estoque');
        } finally { setLoadingReport(null); }
    };

    // ==================== FETCH: FINANCEIRO DRE ====================

    const fetchFinanceiroData = async () => {
        setLoadingReport('financeiro');
        try {
            const [resumo, vendasStats, analytics] = await Promise.all([
                apiClient.get('/despesas/resumo-financeiro/', {
                    params: { data_inicio: dateRange.startDate, data_fim: dateRange.endDate }
                }),
                apiClient.get('/vendas/estatisticas', {
                    params: { data_inicio: dateRange.startDate, data_fim: dateRange.endDate }
                }),
                salesService.getAnalytics({ data_inicio: dateRange.startDate, data_fim: dateRange.endDate })
            ]);

            const stats = vendasStats.data?.estatisticas_gerais || {};
            // 🔥 DRE Consolidado vindo do Backend (Alinhado com Dashboard)
            const dreBackend = resumo.data?.dre_consolidado || {};

            // Priorizar dados consolidados do backend se disponíveis
            const faturamento = dreBackend.receita_bruta !== undefined ? parseFloat(dreBackend.receita_bruta) : parseFloat(stats.total_valor || 0);
            const lucroBruto = dreBackend.lucro_bruto !== undefined ? parseFloat(dreBackend.lucro_bruto) : parseFloat(stats.total_lucro || 0);
            const custoMercadoria = dreBackend.custo_mercadoria !== undefined ? parseFloat(dreBackend.custo_mercadoria) : (faturamento - lucroBruto);
            const despesasOperacionais = dreBackend.despesas_operacionais !== undefined ? parseFloat(dreBackend.despesas_operacionais) : parseFloat(resumo.data?.despesas_mes?.total || 0);
            const despesasPessoal = dreBackend.despesas_pessoal !== undefined ? parseFloat(dreBackend.despesas_pessoal) : 0;
            const despesasTotal = dreBackend.total_despesas !== undefined ? parseFloat(dreBackend.total_despesas) : (despesasOperacionais + despesasPessoal);

            // Lucro Liquido = Lucro Bruto - Despesas Totais
            const lucroLiquido = lucroBruto - despesasTotal;

            const totalVendas = stats.total_vendas || 0;

            setFinanceiroData({
                faturamento,
                custo_mercadoria: custoMercadoria,
                lucro_bruto: lucroBruto,
                lucro_liquido: lucroLiquido,
                despesas_total: despesasTotal,
                despesas_pessoal: despesasPessoal,
                despesas_operacionais: despesasOperacionais,
                total_vendas: totalVendas,
                formas_pagamento: (analytics.formasPagamento || []).map((f: any) => ({
                    'Forma de Pagamento': f.forma.toUpperCase(),
                    'Qtd. Transações': f.quantidade,
                    'Total (R$)': f.total,
                    'Percentual (%)': f.percentual.toFixed(2)
                })),
                contas_pagar: resumo.data?.contas_pagar || {},

                despesas_mes: resumo.data?.despesas_mes || {},
                fluxo_caixa: resumo.data?.fluxo_caixa_real || {},
                alertas: resumo.data?.alertas || [],
            });
        } catch (error) {
            console.error(error);
            showToast.error('Erro ao carregar dados financeiros');
        } finally { setLoadingReport(null); }
    };

    // ==================== FETCH: EQUIPE ====================

    const fetchEquipeData = async () => {
        setLoadingReport('equipe');
        try {
            const analytics = await salesService.getAnalytics({ data_inicio: dateRange.startDate, data_fim: dateRange.endDate });
            const data = analytics.topFuncionarios.map((f: any) => ({
                'Funcionário': f.funcionario,
                'Vendas Realizadas': f.quantidade,
                'Total Vendido (R$)': f.total,
                'Ticket Médio (R$)': (f.total / f.quantidade).toFixed(2)
            }));
            setEquipeData(data);
        } catch (error) {
            console.error(error);
            showToast.error('Erro ao carregar equipe');
        } finally { setLoadingReport(null); }
    };

    const handleEquipeExport = async (type: 'pdf' | 'excel' | 'csv') => {
        setLoadingReport('equipe');
        try {
            if (equipeData.length === 0) await fetchEquipeData();
            const filename = `Performance_Equipe_${dateRange.startDate}`;
            const cols = [
                { header: 'Nome', key: 'Funcionário' },
                { header: 'Vendas', key: 'Vendas Realizadas' },
                { header: 'Total', key: 'Total Vendido (R$)', format: (v: number) => fmtBRL(v) },
                { header: 'Ticket Médio', key: 'Ticket Médio (R$)', format: (v: string) => fmtBRL(parseFloat(v)) },
            ];
            handleGenericExport(equipeData, type, 'Performance da Equipe', filename, 'Equipe', cols, [236, 72, 153], displayPeriodLabel);
        } catch {
            showToast.error('Erro ao gerar relatório de equipe');
        } finally { setLoadingReport(null); }
    };

    // ==================== FETCH: PONTO ====================

    const fetchPontoData = async () => {
        setLoadingReport('ponto');
        try {
            const response = await pontoService.obterRelatorioFuncionarios({ data_inicio: dateRange.startDate, data_fim: dateRange.endDate });
            if (response.success && response.data) {
                setPontoData(response.data.map((f: any) => ({
                    'Funcionário': f.funcionario_nome,
                    'Dias Trabalhados': f.dias_trabalhados,
                    'Taxa Presença (%)': f.taxa_presenca.toFixed(1),
                    'Total Atrasos': f.total_atrasos,
                    'Minutos Atraso': f.minutos_atraso_total
                })));
            }
        } catch (error) {
            console.error(error);
            showToast.error('Erro ao carregar relatório de ponto');
        } finally { setLoadingReport(null); }
    };

    const handlePontoExport = async (type: 'pdf' | 'excel' | 'csv') => {
        setLoadingReport('ponto');
        try {
            if (pontoData.length === 0) await fetchPontoData();
            const filename = `Relatorio_Ponto_${dateRange.startDate}`;
            const cols = [
                { header: 'Funcionário', key: 'Funcionário' },
                { header: 'Dias Trab.', key: 'Dias Trabalhados' },
                { header: 'Presença %', key: 'Taxa Presença (%)', format: (v: string) => v + '%' },
                { header: 'Atrasos', key: 'Total Atrasos' },
                { header: 'Min. Atraso', key: 'Minutos Atraso' },
            ];
            handleGenericExport(pontoData, type, 'Relatório de Controle de Ponto', filename, 'Ponto', cols, [99, 102, 241], displayPeriodLabel);
        } catch {
            showToast.error('Erro ao gerar relatório de ponto');
        } finally { setLoadingReport(null); }
    };

    // ==================== FETCH: RFM ====================

    const fetchRFMData = async () => {
        setLoadingReport('rfm');
        try {
            const response = await apiClient.get('/relatorios/rfm/clientes', {
                params: {
                    data_inicio: dateRange.startDate,
                    data_fim: dateRange.endDate
                }
            });
            if (response.data.success) {
                setRfmData(response.data.clientes.map((c: any) => ({
                    'Nome': c.nome, 'Email': c.email || 'N/A', 'Celular': c.celular || 'N/A',
                    'Segmento': c.segmento, 'Recência (dias)': c.recency_days, 'Frequência': c.frequency,
                    'Valor Total (R$)': c.monetary, 'Score RFM': c.rfm_score,
                    'Em Risco': c.em_risco ? 'SIM' : 'NÃO',
                    'Última Compra': c.ultima_compra ? new Date(c.ultima_compra).toLocaleDateString('pt-BR') : 'N/A'
                })));
            }
        } catch (error) { console.error(error); showToast.error('Erro ao carregar análise RFM'); }
        finally { setLoadingReport(null); }
    };

    // ==================== FETCH: ABC ====================

    const fetchABCData = async () => {
        setLoadingReport('abc');
        try {
            const response = await apiClient.get('/relatorios/rentabilidade/abc', {
                params: {
                    data_inicio: dateRange.startDate,
                    data_fim: dateRange.endDate
                }
            });
            if (response.data.success) {
                setAbcData(response.data.produtos.map((p: any) => ({
                    'Produto': p.produto_nome, 'Classe ABC': p.classe_abc,
                    'Quantidade Vendida': p.quantidade_vendida, 'Faturamento (R$)': p.faturamento,
                    'Lucro Real (R$)': p.lucro_real, 'Margem Real (%)': p.margem_real.toFixed(2),
                    'Estoque Atual': p.estoque_atual, '% Faturamento': p.percentual_faturamento.toFixed(2)
                })));
            }
        } catch (error) { console.error(error); showToast.error('Erro ao carregar análise ABC'); }
        finally { setLoadingReport(null); }
    };

    // ==================== FETCH: PREVISÃO ====================

    const fetchPrevisaoData = async () => {
        setLoadingReport('previsao');
        try {
            const response = await apiClient.get('/relatorios/estoque/previsao-esgotamento');
            if (response.data.success) {
                setPrevisaoData(response.data.previsoes.filter((p: any) => p.status !== 'SEM_MOVIMENTO').map((p: any) => ({
                    'Produto': p.produto_nome, 'Estoque Atual': p.estoque_atual,
                    'Média Vendas/Dia': p.media_vendas_diarias,
                    'Dias até Esgotamento': p.dias_ate_esgotamento || 'N/A',
                    'Data Prevista': p.data_esgotamento_prevista ? new Date(p.data_esgotamento_prevista).toLocaleDateString('pt-BR') : 'N/A',
                    'Status': p.status
                })));
            }
        } catch (error) { console.error(error); showToast.error('Erro ao carregar previsão'); }
        finally { setLoadingReport(null); }
    };

    // ==================== FETCH: FORNECEDORES (NOVO) ====================

    const fetchFornecedoresData = async () => {
        setLoadingReport('fornecedores');
        try {
            const response = await apiClient.get('/fornecedores/relatorio/analitico', {
                params: { data_inicio: dateRange.startDate, data_fim: dateRange.endDate }
            });
            if (response.data.success !== false) {
                const lista = response.data.relatorio || response.data.fornecedores || [];
                setFornecedoresData(lista.map((item: any) => ({
                    'Fornecedor': item.fornecedor?.nome || item.nome || 'N/A',
                    'CNPJ': item.fornecedor?.cnpj || item.cnpj || 'N/A',
                    'Classificação': item.fornecedor?.classificacao || item.classificacao || '-',
                    'Total Pedidos': item.metricas?.total_pedidos ?? 0,
                    'Valor Compras (R$)': item.metricas?.valor_total ?? item.metricas?.valor_total_comprado ?? 0,
                    'Ped. Pendentes': item.metricas?.pedidos_pendentes ?? 0,
                    'Ped. Concluídos': item.metricas?.pedidos_concluidos ?? 0,
                    'Taxa Conclusão (%)': item.metricas?.taxa_conclusao ?? 0,
                    'OTD (%)': item.metricas?.taxa_otd ?? null, // null = sem entrega avaliada (não é 100%)
                    'Atraso Médio (dias)': item.metricas?.media_atraso ?? 0,
                    'Score': item.fornecedor?.score ?? 0,
                    'Entrega (dias)': item.metricas?.media_entrega_dias ?? item.metricas?.media_tempo_entrega ?? 0,
                    'Produtos': item.metricas?.total_produtos ?? 0,
                    'Boletos Abertos': item.boletos?.total_abertos ?? 0,
                    'Valor Aberto (R$)': item.boletos?.valor_aberto ?? 0,
                    'Boletos Vencidos': item.boletos?.total_vencidos ?? 0,
                    'Valor Vencido (R$)': item.boletos?.valor_vencido ?? 0,
                    'Total Pago (R$)': item.boletos?.valor_pago ?? 0,
                })));
            }
        } catch (error) { console.error(error); showToast.error('Erro ao carregar relatório de fornecedores'); }
        finally { setLoadingReport(null); }
    };

    // ==================== FETCH: CLIENTES (NOVO) ====================

    const fetchClientesData = async () => {
        setLoadingReport('clientes');
        try {
            const response = await apiClient.get('/clientes/relatorio/analitico', {
                params: { data_inicio: dateRange.startDate, data_fim: dateRange.endDate }
            });
            if (response.data.success !== false) {
                const lista = response.data.relatorio || response.data.clientes || [];
                setClientesData(lista.map((item: any) => {
                    const ultimaCompra = item.comportamento?.ultima_compra || item.metricas?.ultima_compra || item.ultima_compra;
                    return {
                        'Cliente': item.cliente?.nome || item.nome || 'N/A',
                        'CPF': item.cliente?.documento || item.cliente?.cpf || item.cpf || 'N/A',
                        'Total Compras': item.metricas?.total_vendas ?? item.total_compras ?? 0,
                        'Valor Total (R$)': item.metricas?.valor_total_gasto ?? item.metricas?.valor_total ?? item.valor_total ?? 0,
                        'Ticket Médio (R$)': item.metricas?.ticket_medio ?? item.ticket_medio ?? 0,
                        'Última Compra': ultimaCompra ? new Date(ultimaCompra).toLocaleDateString('pt-BR') : 'N/A',
                        'Frequência (dias)': item.metricas?.frequencia_media_dias ?? item.metricas?.frequencia_media ?? item.frequencia_media ?? '-',
                    };
                }));
            }
        } catch (error) { console.error(error); showToast.error('Erro ao carregar relatório de clientes'); }
        finally { setLoadingReport(null); }
    };

    // ==================== EXPORT HANDLERS PARA INTELIGÊNCIA (COM PDF) ====================

    const handleRFMExport = (type: 'pdf' | 'excel' | 'csv') => {
        const cols = [
            { header: 'Cliente', key: 'Nome' },
            { header: 'Segmento', key: 'Segmento' },
            { header: 'Recência', key: 'Recência (dias)', format: (v: number) => v + ' dias' },
            { header: 'Frequência', key: 'Frequência' },
            { header: 'Valor Total', key: 'Valor Total (R$)', format: (v: number) => fmtBRL(v) },
            { header: 'Score', key: 'Score RFM' },
            { header: 'Em Risco', key: 'Em Risco' },
        ];
        handleGenericExport(rfmData, type, 'Análise RFM de Clientes', 'Analise_RFM', 'RFM', cols, [147, 51, 234]);
    };

    const handleABCExport = (type: 'pdf' | 'excel' | 'csv') => {
        const cols = [
            { header: 'Produto', key: 'Produto' },
            { header: 'Classe', key: 'Classe ABC' },
            { header: 'Qtd Vendida', key: 'Quantidade Vendida' },
            { header: 'Faturamento', key: 'Faturamento (R$)', format: (v: number) => fmtBRL(v) },
            { header: 'Lucro Real', key: 'Lucro Real (R$)', format: (v: number) => fmtBRL(v) },
            { header: 'Margem %', key: 'Margem Real (%)', format: (v: string) => v + '%' },
            { header: '% Fat.', key: '% Faturamento', format: (v: string) => v + '%' },
        ];
        handleGenericExport(abcData, type, 'Rentabilidade ABC - Curva Pareto', 'Rentabilidade_ABC', 'ABC', cols, [225, 29, 72]);
    };

    const handlePrevisaoExport = (type: 'pdf' | 'excel' | 'csv') => {
        const cols = [
            { header: 'Produto', key: 'Produto' },
            { header: 'Estoque', key: 'Estoque Atual' },
            { header: 'Média/Dia', key: 'Média Vendas/Dia' },
            { header: 'Dias Restantes', key: 'Dias até Esgotamento' },
            { header: 'Data Prevista', key: 'Data Prevista' },
            { header: 'Status', key: 'Status' },
        ];
        handleGenericExport(previsaoData, type, 'Previsão de Esgotamento de Estoque', 'Previsao_Esgotamento', 'Previsão', cols, [234, 88, 12]);
    };

    const handleFornecedoresExport = (type: 'pdf' | 'excel' | 'csv') => {
        const cols = [
            { header: 'Fornecedor', key: 'Fornecedor' },
            { header: 'CNPJ', key: 'CNPJ' },
            { header: 'Class.', key: 'Classificação' },
            { header: 'Pedidos', key: 'Total Pedidos' },
            { header: 'Valor Compras', key: 'Valor Compras (R$)', format: (v: number) => fmtBRL(v) },
            { header: 'Pendentes', key: 'Ped. Pendentes' },
            { header: 'Concluídos', key: 'Ped. Concluídos' },
            { header: 'Taxa %', key: 'Taxa Conclusão (%)' },
            { header: 'Entrega', key: 'Entrega (dias)' },
            { header: 'Produtos', key: 'Produtos' },
            { header: 'Bol. Abertos', key: 'Boletos Abertos' },
            { header: 'V. Aberto', key: 'Valor Aberto (R$)', format: (v: number) => fmtBRL(v) },
            { header: 'Vencidos', key: 'Boletos Vencidos' },
            { header: 'V. Vencido', key: 'Valor Vencido (R$)', format: (v: number) => fmtBRL(v) },
            { header: 'Pago', key: 'Total Pago (R$)', format: (v: number) => fmtBRL(v) },
        ];
        handleGenericExport(fornecedoresData, type, 'Relatório Analítico de Fornecedores', 'Relatorio_Fornecedores', 'Fornecedores', cols, [20, 120, 170], displayPeriodLabel);
    };

    const handleClientesExport = (type: 'pdf' | 'excel' | 'csv') => {
        const cols = [
            { header: 'Cliente', key: 'Cliente' },
            { header: 'CPF', key: 'CPF' },
            { header: 'Compras', key: 'Total Compras' },
            { header: 'Valor Total', key: 'Valor Total (R$)', format: (v: number) => fmtBRL(v) },
            { header: 'Ticket Médio', key: 'Ticket Médio (R$)', format: (v: number) => fmtBRL(v) },
            { header: 'Última Compra', key: 'Última Compra' },
            { header: 'Freq. (dias)', key: 'Frequência (dias)' },
        ];
        handleGenericExport(clientesData, type, 'Relatório Analítico de Clientes', 'Relatorio_Clientes', 'Clientes', cols, [16, 150, 100], displayPeriodLabel);
    };

    // ==================== EXPORT: DRE FINANCEIRO ====================

    const handleFinanceiroExport = (type: 'pdf' | 'excel' | 'csv') => {
        if (!financeiroData) { showToast.error('Carregue o relatório financeiro primeiro'); return; }
        const dreRows = [
            { 'Descrição': '(+) Receita Bruta (Faturamento)', 'Valor (R$)': financeiroData.faturamento, 'Observação': `${financeiroData.total_vendas} vendas no período` },
            { 'Descrição': '(-) Custo da Mercadoria Vendida (CMV)', 'Valor (R$)': financeiroData.custo_mercadoria, 'Observação': '' },
            { 'Descrição': '(=) LUCRO BRUTO', 'Valor (R$)': financeiroData.lucro_bruto, 'Observação': `Margem: ${financeiroData.faturamento > 0 ? ((financeiroData.lucro_bruto / financeiroData.faturamento) * 100).toFixed(1) : '0'}%` },
            { 'Descrição': '(-) Despesas com Pessoal', 'Valor (R$)': financeiroData.despesas_pessoal, 'Observação': 'Salários, encargos, provisões e rescisões' },
            { 'Descrição': '(-) Despesas Operacionais', 'Valor (R$)': financeiroData.despesas_operacionais, 'Observação': `Fixas: ${fmtBRL(financeiroData.despesas_mes?.recorrentes || 0)} | Variáveis: ${fmtBRL(financeiroData.despesas_mes?.variaveis || 0)}` },
            { 'Descrição': '(=) LUCRO LÍQUIDO', 'Valor (R$)': financeiroData.lucro_liquido, 'Observação': `Margem: ${financeiroData.faturamento > 0 ? ((financeiroData.lucro_liquido / financeiroData.faturamento) * 100).toFixed(1) : '0'}%` },
            { 'Descrição': '', 'Valor (R$)': '', 'Observação': '' },
            { 'Descrição': '--- CONTAS A PAGAR ---', 'Valor (R$)': '', 'Observação': '' },
            { 'Descrição': 'Total em Aberto', 'Valor (R$)': financeiroData.contas_pagar?.total_aberto || 0, 'Observação': '' },
            { 'Descrição': 'Vencido', 'Valor (R$)': financeiroData.contas_pagar?.total_vencido || 0, 'Observação': '' },
            { 'Descrição': 'Vence em 7 dias', 'Valor (R$)': financeiroData.contas_pagar?.vence_7_dias || 0, 'Observação': '' },
            { 'Descrição': 'Pago no Mês', 'Valor (R$)': financeiroData.contas_pagar?.pago_no_mes || 0, 'Observação': '' },
            { 'Descrição': '', 'Valor (R$)': '', 'Observação': '' },
        ];

        if (financeiroData.formas_pagamento?.length > 0) {
            dreRows.push({ 'Descrição': '', 'Valor (R$)': '', 'Observação': '' });
            dreRows.push({ 'Descrição': '--- RECEITA POR FORMA DE PAGAMENTO ---', 'Valor (R$)': '', 'Observação': '' });
            financeiroData.formas_pagamento.forEach((f: any) => {
                dreRows.push({
                    'Descrição': f['Forma de Pagamento'],
                    'Valor (R$)': f['Total (R$)'],
                    'Observação': `${f['Qtd. Transações']} transações (${f['Percentual (%)']}%)`
                });
            });
        }

        if (type === 'pdf') {
            const doc = new jsPDF('portrait');
            generatePDFHeader(doc, 'DRE - Demonstrativo de Resultado', displayPeriodLabel);
            autoTable(doc, {
                startY: 50,
                head: [['Descrição', 'Valor (R$)', 'Observação']],
                body: dreRows.map(r => [
                    r['Descrição'],
                    typeof r['Valor (R$)'] === 'number' ? fmtBRL(r['Valor (R$)']) : String(r['Valor (R$)']),
                    r['Observação']
                ]),
                theme: 'grid',
                headStyles: { fillColor: [30, 64, 175], fontSize: 9 },
                bodyStyles: { fontSize: 8 },
                styles: { cellPadding: 2 },
                didParseCell: (data: any) => {
                    const desc = String(data.row.raw?.[0] || '');
                    if (desc.includes('LUCRO BRUTO')) {
                        data.cell.styles.fillColor = [220, 252, 231];
                        data.cell.styles.fontStyle = 'bold';
                    } else if (desc.includes('LUCRO LÍQUIDO')) {
                        const isPositive = financeiroData.lucro_liquido >= 0;
                        data.cell.styles.fillColor = isPositive ? [209, 250, 229] : [254, 226, 226];
                        data.cell.styles.fontStyle = 'bold';
                    } else if (desc.startsWith('---')) {
                        data.cell.styles.fillColor = [243, 244, 246];
                        data.cell.styles.fontStyle = 'bold';
                    }
                }
            });
            doc.save(`DRE_Financeiro_${dateRange.startDate}.pdf`);
            showToast.info('DRE exportado em PDF com sucesso!');
        } else if (type === 'excel') {
            const formattedRows = dreRows.map(r => ({
                ...r,
                'Valor (R$)': typeof r['Valor (R$)'] === 'number' ? r['Valor (R$)'] : r['Valor (R$)']
            }));
            exportToExcel(formattedRows, `DRE_Financeiro_${dateRange.startDate}`, 'DRE');
        } else {
            exportToCSV(dreRows, `DRE_Financeiro_${dateRange.startDate}`);
        }
    };

    // ==================== EXPORT DISPATCHER ====================

    const getExportHandler = (type: 'pdf' | 'excel' | 'csv') => {
        switch (modalType) {
            case 'vendas': return () => handleVendasExport(type);
            case 'produtos': return () => handleProdutosExport(type);
            case 'financeiro': return () => handleFinanceiroExport(type);
            case 'equipe': return () => handleEquipeExport(type);
            case 'ponto': return () => handlePontoExport(type);
            case 'rfm': return () => handleRFMExport(type);
            case 'abc': return () => handleABCExport(type);
            case 'previsao': return () => handlePrevisaoExport(type);
            case 'fornecedores': return () => handleFornecedoresExport(type);
            case 'clientes': return () => handleClientesExport(type);
            default: return undefined;
        }
    };

    // ==================== MODAL TITLES ====================
    const modalTitles: Record<string, string> = {
        vendas: 'Vendas Detalhadas',
        produtos: 'Estoque & Produtos',
        financeiro: 'DRE - Demonstrativo Financeiro',
        equipe: 'Performance da Equipe',
        ponto: 'Controle de Ponto',
        rfm: 'Análise RFM de Clientes',
        abc: 'Rentabilidade ABC',
        previsao: 'Previsão de Esgotamento',
        fornecedores: 'Relatório de Fornecedores',
        clientes: 'Relatório de Clientes',
    };

    // ==================== RENDER HELPERS ====================

    const renderExportButtons = () => {
        const pdfHandler = getExportHandler('pdf');
        const excelHandler = getExportHandler('excel');
        const csvHandler = getExportHandler('csv');
        return (
            <>
                {pdfHandler && (
                    <button onClick={pdfHandler} disabled={loadingReport !== null} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-red-50 text-gray-700 hover:text-red-700 transition-colors border border-gray-100 hover:border-red-200">
                        <FileText className="w-4 h-4" />
                        <span className="text-xs font-medium">PDF</span>
                    </button>
                )}
                {excelHandler && (
                    <button onClick={excelHandler} disabled={loadingReport !== null} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-green-50 text-gray-700 hover:text-green-700 transition-colors border border-gray-100 hover:border-green-200">
                        <FileSpreadsheet className="w-4 h-4" />
                        <span className="text-xs font-medium">Excel</span>
                    </button>
                )}
                {csvHandler && (
                    <button onClick={csvHandler} disabled={loadingReport !== null} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-blue-50 text-gray-700 hover:text-blue-700 transition-colors border border-gray-100 hover:border-blue-200">
                        <Download className="w-4 h-4" />
                        <span className="text-xs font-medium">CSV</span>
                    </button>
                )}
            </>
        );
    };

    const handleSort = (key: string) => {
        setSortConfig(prev => {
            if (prev?.key === key) {
                if (prev.direction === 'asc') return { key, direction: 'desc' };
                return null;
            }
            return { key, direction: 'asc' };
        });
    };

    const handleColumnFilter = (key: string, value: string) => {
        setColumnFilters(prev => {
            const next = { ...prev };
            if (value === '') delete next[key];
            else next[key] = value;
            return next;
        });
    };

    const toggleColumnVisibility = (key: string) => {
        setHiddenColumns(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const renderDataTable = (
        data: any[],
        columns: { key: string; label: string; align?: string; render?: (v: any, row: any) => React.ReactNode }[],
        onPageChange?: (page: number) => void
    ) => {
        const visibleCols = columns.filter(c => !hiddenColumns.has(c.key));

        let processedData = data.filter(filterRow);

        // Filtros por coluna
        Object.entries(columnFilters).forEach(([key, filterVal]) => {
            if (filterVal) {
                const lowerFilter = filterVal.toLowerCase();
                processedData = processedData.filter(row =>
                    String(row[key] ?? '').toLowerCase().includes(lowerFilter)
                );
            }
        });

        // Ordenação
        if (sortConfig) {
            processedData = [...processedData].sort((a, b) => {
                const aVal = a[sortConfig.key];
                const bVal = b[sortConfig.key];
                const aNum = typeof aVal === 'number' ? aVal : parseFloat(String(aVal));
                const bNum = typeof bVal === 'number' ? bVal : parseFloat(String(bVal));

                if (!isNaN(aNum) && !isNaN(bNum)) {
                    return sortConfig.direction === 'asc' ? aNum - bNum : bNum - aNum;
                }
                const aStr = String(aVal ?? '').toLowerCase();
                const bStr = String(bVal ?? '').toLowerCase();
                return sortConfig.direction === 'asc' ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
            });
        }

        const isPaginated = paginationInfo && (paginationInfo.total_paginas > 1 || paginationInfo.total_itens > data.length);

        return (
            <div className="flex flex-col h-full">
                {/* Visual Feedback Banner: Sempre no topo da tabela */}
                <ActiveFilterBanner />

                {/* Toolbar da tabela */}
                <div className="flex flex-wrap items-center gap-2 mb-3 px-1">
                    <button
                        onClick={() => setShowColumnFilters(p => !p)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${showColumnFilters ? 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-200 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                    >
                        <Filter className="w-3.5 h-3.5" />
                        Filtros por Coluna
                    </button>

                    <div className="relative">
                        <button
                            onClick={() => setShowColumnPicker(p => !p)}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${showColumnPicker ? 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-200 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                        >
                            <Eye className="w-3.5 h-3.5" />
                            Colunas
                            <ChevronDown className="w-3 h-3" />
                        </button>
                        {showColumnPicker && (
                            <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-20 p-2 min-w-[200px] max-h-[300px] overflow-y-auto">
                                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1 px-1">Mostrar/Ocultar</p>
                                {columns.map(col => (
                                    <label key={col.key} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer text-xs">
                                        <input
                                            type="checkbox"
                                            checked={!hiddenColumns.has(col.key)}
                                            onChange={() => toggleColumnVisibility(col.key)}
                                            className="rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500 bg-white dark:bg-gray-700 h-3.5 w-3.5"
                                        />
                                        <span className="text-gray-700 dark:text-gray-300">{col.label}</span>
                                    </label>
                                ))}
                                {hiddenColumns.size > 0 && (
                                    <button onClick={() => setHiddenColumns(new Set())} className="w-full mt-1 text-[10px] text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-medium py-1">
                                        Mostrar todas
                                    </button>
                                )}
                            </div>
                        )}
                    </div>

                    {sortConfig && (
                        <button onClick={() => setSortConfig(null)} className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700/50 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors">
                            Ordenando: {columns.find(c => c.key === sortConfig.key)?.label} {sortConfig.direction === 'asc' ? '↑' : '↓'}
                            <X className="w-3 h-3" />
                        </button>
                    )}

                    {Object.keys(columnFilters).length > 0 && (
                        <button onClick={() => setColumnFilters({})} className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-700/50 text-rose-700 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/50 transition-colors">
                            {Object.keys(columnFilters).length} filtro(s) ativos
                            <X className="w-3 h-3" />
                        </button>
                    )}

                    {hiddenColumns.size > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                            <EyeOff className="w-3 h-3" /> {hiddenColumns.size} coluna(s) oculta(s)
                        </span>
                    )}

                    <div className="ml-auto flex items-center gap-2 bg-gray-100 dark:bg-gray-800/80 px-2.5 py-1 rounded-full border border-gray-200 dark:border-gray-700">
                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></div>
                        <span className="text-[10px] text-gray-600 dark:text-gray-400 font-bold uppercase tracking-tight">
                            {processedData.length} <span className="font-normal opacity-70">Exibidos</span>
                        </span>
                    </div>
                </div>

                {/* Tabela */}
                <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-800 sticky top-0 z-10">
                        <tr>
                            {visibleCols.map(col => (
                                <th
                                    key={col.key}
                                    onClick={() => handleSort(col.key)}
                                    className={`px-3 py-2 font-medium text-gray-700 dark:text-gray-300 cursor-pointer select-none hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                                >
                                    <div className={`flex items-center gap-1 ${col.align === 'right' ? 'justify-end' : ''}`}>
                                        <span className="text-xs">{col.label}</span>
                                        {sortConfig?.key === col.key ? (
                                            sortConfig.direction === 'asc' ? <ArrowUp className="w-3 h-3 text-indigo-600 dark:text-indigo-400" /> : <ArrowDown className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
                                        ) : (
                                            <ArrowUpDown className="w-3 h-3 text-gray-300 dark:text-gray-600" />
                                        )}
                                    </div>
                                </th>
                            ))}
                        </tr>
                        {showColumnFilters && (
                            <tr className="bg-gray-25 dark:bg-gray-800/50">
                                {visibleCols.map(col => (
                                    <th key={`filter-${col.key}`} className="px-2 py-1">
                                        <input
                                            type="text"
                                            value={columnFilters[col.key] || ''}
                                            onChange={(e) => handleColumnFilter(col.key, e.target.value)}
                                            placeholder={`Filtrar ${col.label}...`}
                                            className="w-full text-xs font-normal px-2 py-1 border border-gray-200 dark:border-gray-700 rounded focus:outline-none focus:ring-1 focus:ring-indigo-300 focus:border-indigo-300 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 placeholder-gray-400"
                                        />
                                    </th>
                                ))}
                            </tr>
                        )}
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {processedData.length === 0 ? (
                            <tr>
                                <td colSpan={visibleCols.length} className="px-4 py-8 text-center text-gray-400 text-sm">
                                    Nenhum registro encontrado
                                </td>
                            </tr>
                        ) : (
                            processedData.map((row, idx) => (
                                <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
                                    {visibleCols.map(col => (
                                        <td key={col.key} className={`px-3 py-2 text-xs text-gray-600 dark:text-gray-300 ${col.align === 'right' ? 'text-right' : ''}`}>
                                            {col.render ? col.render(row[col.key], row) : String(row[col.key] ?? '')}
                                        </td>
                                    ))}
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
                {/* Paginação Premium UX */}
                {isPaginated && onPageChange && (
                    <div className="flex items-center justify-between mt-6 px-4 py-3 bg-white/50 dark:bg-gray-800/40 backdrop-blur-sm rounded-xl border border-indigo-100/50 dark:border-indigo-900/20 shadow-sm">
                        <div className="flex items-center gap-6">
                            <div className="flex flex-col">
                                <span className="text-[10px] text-indigo-500 dark:text-indigo-400 font-bold uppercase tracking-wider mb-0.5">Navegação</span>
                                <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
                                    Página <span className="text-indigo-600 dark:text-indigo-400 font-bold">{paginationInfo.pagina_atual}</span> de <span className="text-gray-900 dark:text-gray-100 font-bold">{paginationInfo.total_paginas}</span>
                                </span>
                            </div>
                            <div className="h-8 w-px bg-gray-200 dark:bg-gray-700 hidden sm:block"></div>
                            <div className="flex flex-col hidden sm:flex">
                                <span className="text-[10px] text-indigo-500 dark:text-indigo-400 font-bold uppercase tracking-wider mb-0.5">Volume Total</span>
                                <div className="flex items-center gap-1.5">
                                    <Layers className="w-3 h-3 text-indigo-400" />
                                    <span className="text-xs font-bold text-gray-900 dark:text-gray-100">{paginationInfo.total_itens.toLocaleString('pt-BR')} registros</span>
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => onPageChange(paginationInfo.pagina_atual - 1)}
                                disabled={!paginationInfo.tem_anterior || loadingReport !== null}
                                className="group flex items-center gap-2 px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-indigo-300 dark:hover:border-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/40 text-gray-600 dark:text-gray-300 hover:text-indigo-600 dark:hover:text-indigo-400 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-sm"
                            >
                                <ChevronLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
                                <span className="text-xs font-bold hidden xs:inline">Anterior</span>
                            </button>
                            <button
                                onClick={() => onPageChange(paginationInfo.pagina_atual + 1)}
                                disabled={!paginationInfo.tem_proxima || loadingReport !== null}
                                className="group flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-600 dark:bg-indigo-500 text-white hover:bg-indigo-700 dark:hover:bg-indigo-400 transition-all shadow-md shadow-indigo-200 dark:shadow-indigo-900/20 disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                                <span className="text-xs font-bold hidden xs:inline">Próxima</span>
                                <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                            </button>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    // ==================== RENDER: FINANCEIRO DRE ====================

    const renderFinanceiroDRE = () => {
        if (!financeiroData) return <div className="text-center py-12 text-gray-400"><Loader2 className="w-8 h-8 animate-spin mx-auto" /></div>;
        const cp = financeiroData.contas_pagar;

        const desp = financeiroData.despesas_mes;
        const fluxo = financeiroData.fluxo_caixa;
        const alertas = financeiroData.alertas || [];

        return (
            <div className="space-y-6">
                <ActiveFilterBanner />
                {/* DRE Simplificado */}
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 mb-2">
                    <h4 className="font-bold text-gray-800 dark:text-gray-100 mb-4 text-sm uppercase tracking-wide">DRE - Demonstrativo de Resultado</h4>
                    <div className="space-y-1 text-sm">
                        <div className="flex justify-between py-2 border-b border-gray-100 dark:border-gray-700">
                            <span className="font-medium text-gray-700 dark:text-gray-300">( + ) Receita Bruta (Faturamento)</span>
                            <span className="font-bold text-blue-700 dark:text-blue-400 text-base">{fmtBRL(financeiroData.faturamento)}</span>
                        </div>
                        <div className="flex justify-between py-2 border-b border-gray-100 dark:border-gray-700">
                            <span className="text-gray-500 dark:text-gray-400 pl-4">( - ) Custo da Mercadoria Vendida (CMV)</span>
                            <span className="text-red-600 dark:text-red-400 font-medium">{fmtBRL(financeiroData.custo_mercadoria)}</span>
                        </div>
                        <div className="flex justify-between py-2 border-b-2 border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 px-3 rounded">
                            <span className="font-bold text-green-800 dark:text-green-300">( = ) Lucro Bruto</span>
                            <span className="font-bold text-green-700 dark:text-green-400 text-base">{fmtBRL(financeiroData.lucro_bruto)}</span>
                        </div>
                        <div className="flex justify-between py-1 text-xs text-green-600 dark:text-green-400 pl-6">
                            <span>Margem bruta</span>
                            <span>{financeiroData.faturamento > 0 ? ((financeiroData.lucro_bruto / financeiroData.faturamento) * 100).toFixed(1) : '0'}%</span>
                        </div>
                        <div className="flex justify-between py-2 border-b border-gray-100 dark:border-gray-700">
                            <span className="text-gray-500 dark:text-gray-400 pl-4">( - ) Despesas com Pessoal</span>
                            <span className="text-red-600 dark:text-red-400 font-medium">{fmtBRL(financeiroData.despesas_pessoal || 0)}</span>
                        </div>
                        <div className="flex justify-between py-1 text-xs text-gray-400 dark:text-gray-500 pl-8 mb-2">
                            <span>Salários, rescisões e provisões</span>
                        </div>
                        <div className="flex justify-between py-2 border-b border-gray-100 dark:border-gray-700">
                            <span className="text-gray-500 dark:text-gray-400 pl-4">( - ) Despesas Operacionais (mês)</span>
                            <span className="text-red-600 dark:text-red-400 font-medium">{fmtBRL(desp.total || 0)}</span>
                        </div>
                        <div className="flex justify-between py-1 text-xs text-gray-400 dark:text-gray-500 pl-8">
                            <span>Fixas (recorrentes): {fmtBRL(desp.recorrentes || 0)}</span>
                            <span>Variáveis: {fmtBRL(desp.variaveis || 0)}</span>
                        </div>
                        <div className={`flex justify-between py-2 px-3 rounded ${financeiroData.lucro_liquido >= 0 ? 'bg-emerald-50 dark:bg-emerald-900/20 border-2 border-emerald-300 dark:border-emerald-700' : 'bg-red-50 dark:bg-red-900/20 border-2 border-red-300 dark:border-red-700'}`}>
                            <span className={`font-bold ${financeiroData.lucro_liquido >= 0 ? 'text-emerald-800 dark:text-emerald-300' : 'text-red-800 dark:text-red-300'}`}>( = ) Lucro Líquido</span>
                            <span className={`font-bold text-lg ${financeiroData.lucro_liquido >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>{fmtBRL(financeiroData.lucro_liquido)}</span>
                        </div>
                        <div className={`flex justify-between py-1 text-xs pl-6 ${financeiroData.lucro_liquido >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                            <span>Margem líquida</span>
                            <span>{financeiroData.faturamento > 0 ? ((financeiroData.lucro_liquido / financeiroData.faturamento) * 100).toFixed(1) : '0'}%</span>
                        </div>
                    </div>
                </div>

                {/* KPIs resumo */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 border border-blue-100 dark:border-blue-800">
                        <p className="text-xs text-blue-600 dark:text-blue-400 font-medium mb-1">Faturamento</p>
                        <p className="text-xl font-bold text-blue-900 dark:text-blue-200">{fmtBRL(financeiroData.faturamento)}</p>
                        <p className="text-[10px] text-blue-500 dark:text-blue-400/70 mt-1">{financeiroData.total_vendas} vendas</p>
                    </div>
                    <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-4 border border-green-100 dark:border-green-800">
                        <p className="text-xs text-green-600 dark:text-green-400 font-medium mb-1">Lucro Bruto</p>
                        <p className="text-xl font-bold text-green-900 dark:text-green-200">{fmtBRL(financeiroData.lucro_bruto)}</p>
                        <p className="text-[10px] text-green-500 dark:text-green-400/70 mt-1">Margem: {financeiroData.faturamento > 0 ? ((financeiroData.lucro_bruto / financeiroData.faturamento) * 100).toFixed(1) : '0'}%</p>
                    </div>
                    <div className={`rounded-xl p-4 border ${financeiroData.lucro_liquido >= 0 ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-100 dark:border-emerald-800' : 'bg-red-50 dark:bg-red-900/20 border-red-100 dark:border-red-800'}`}>
                        <p className={`text-xs font-medium mb-1 ${financeiroData.lucro_liquido >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>Lucro Líquido</p>
                        <p className={`text-xl font-bold ${financeiroData.lucro_liquido >= 0 ? 'text-emerald-900 dark:text-emerald-200' : 'text-red-900 dark:text-red-200'}`}>{fmtBRL(financeiroData.lucro_liquido)}</p>
                        <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">Margem: {financeiroData.faturamento > 0 ? ((financeiroData.lucro_liquido / financeiroData.faturamento) * 100).toFixed(1) : '0'}%</p>
                    </div>
                    <div className={`rounded-xl p-4 border ${(fluxo.saldo ?? 0) >= 0 ? 'bg-sky-50 dark:bg-sky-900/20 border-sky-100 dark:border-sky-800' : 'bg-orange-50 dark:bg-orange-900/20 border-orange-100 dark:border-orange-800'}`}>
                        <p className={`text-xs font-medium mb-1 ${(fluxo.saldo ?? 0) >= 0 ? 'text-sky-600 dark:text-sky-400' : 'text-orange-600 dark:text-orange-400'}`}>Fluxo Caixa (Real)</p>
                        <p className={`text-xl font-bold ${(fluxo.saldo ?? 0) >= 0 ? 'text-sky-900 dark:text-sky-200' : 'text-orange-900 dark:text-orange-200'}`}>{fmtBRL(fluxo.saldo ?? 0)}</p>
                        <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
                            <span className="text-green-600 dark:text-green-400">+{fmtBRL(fluxo.entradas ?? 0)}</span> / <span className="text-red-600 dark:text-red-400">-{fmtBRL(fluxo.saidas ?? 0)}</span>
                        </p>
                    </div>
                </div>

                {/* Contas a Pagar */}
                <div className="grid grid-cols-1 gap-4">
                    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
                        <h4 className="font-bold text-gray-800 dark:text-gray-100 mb-3 flex items-center gap-2">
                            <ArrowDownRight className="w-4 h-4 text-red-500" /> Contas a Pagar
                        </h4>
                        <div className="space-y-2 text-sm">
                            <div className="flex justify-between"><span className="text-gray-500">Total em aberto</span><span className="font-semibold text-red-600">{fmtBRL(cp.total_aberto ?? 0)}</span></div>
                            <div className="flex justify-between"><span className="text-gray-500">Vencido</span><span className="font-semibold text-red-700">{fmtBRL(cp.total_vencido ?? 0)}</span></div>
                            <div className="flex justify-between"><span className="text-gray-500">Vence em 7 dias</span><span className="font-medium text-orange-600">{fmtBRL(cp.vence_7_dias ?? 0)}</span></div>
                            <div className="flex justify-between"><span className="text-gray-500">Vence em 30 dias</span><span className="text-gray-700">{fmtBRL(cp.vence_30_dias ?? 0)}</span></div>
                            <hr />
                            <div className="flex justify-between"><span className="text-gray-500">Pago no mês</span><span className="font-medium text-green-600">{fmtBRL(cp.pago_no_mes ?? 0)}</span></div>
                        </div>
                    </div>
                </div>

                {/* Formas de pagamento */}
                {
                    financeiroData.formas_pagamento.length > 0 && (
                        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
                            <h4 className="font-bold text-gray-800 dark:text-gray-100 mb-3">Receita por Forma de Pagamento</h4>
                            <table className="min-w-full text-sm">
                                <thead className="bg-gray-50 dark:bg-gray-700">
                                    <tr>
                                        <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-300">Forma</th>
                                        <th className="px-3 py-2 text-right font-medium text-gray-700 dark:text-gray-300">Transações</th>
                                        <th className="px-3 py-2 text-right font-medium text-gray-700 dark:text-gray-300">Total</th>
                                        <th className="px-3 py-2 text-right font-medium text-gray-700 dark:text-gray-300">%</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                    {financeiroData.formas_pagamento.map((f: any, i: number) => (
                                        <tr key={i} className="border-t border-gray-100 dark:border-gray-700">
                                            <td className="px-3 py-2 text-gray-800 dark:text-gray-200">{f['Forma de Pagamento']}</td>
                                            <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{f['Qtd. Transações']}</td>
                                            <td className="px-3 py-2 text-right font-semibold text-gray-900 dark:text-gray-100">{fmtBRL(f['Total (R$)'])}</td>
                                            <td className="px-3 py-2 text-right text-gray-500 dark:text-gray-400">{f['Percentual (%)']}%</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )
                }

                {/* Alertas */}
                {
                    alertas.length > 0 && (
                        <div className="space-y-2">
                            <h4 className="font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4 text-amber-500" /> Alertas Financeiros
                            </h4>
                            {alertas.map((alerta: any, i: number) => (
                                <div key={i} className={`p-3 rounded-lg border text-sm ${alerta.severidade === 'critica' ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300' :
                                    alerta.severidade === 'alta' ? 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800 text-orange-800 dark:text-orange-300' :
                                        'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-300'
                                    }`}>
                                    <p className="font-semibold">{alerta.titulo}</p>
                                    <p className="text-xs mt-0.5 opacity-80">{alerta.descricao}</p>
                                    <p className="text-xs mt-1 font-medium opacity-70">Ação: {alerta.acao}</p>
                                </div>
                            ))}
                        </div>
                    )
                }
            </div >
        );
    };

    // ==================== RENDER: VENDAS ====================

    const renderVendas = () => (
        <>
            <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="group bg-linear-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-2xl p-4 border border-blue-100 dark:border-blue-800/50 shadow-sm hover:shadow-md transition-all">
                    <div className="flex justify-between items-start mb-2">
                        <div className="p-2 bg-blue-100 dark:bg-blue-800 rounded-lg text-blue-600 dark:text-blue-300">
                            <TrendingUp className="w-4 h-4" />
                        </div>
                        <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">Volume</span>
                    </div>
                    <p className="text-2xl font-black text-gray-900 dark:text-gray-100 tracking-tight">
                        {paginationInfo?.total_itens || vendasData.length}
                    </p>
                    <p className="text-xs text-blue-600 dark:text-blue-400 font-medium mt-1">Vendas Totais</p>
                </div>

                <div className="group bg-linear-to-br from-emerald-50 to-teal-50 dark:from-emerald-900/20 dark:to-teal-900/20 rounded-2xl p-4 border border-emerald-100 dark:border-emerald-800/50 shadow-sm hover:shadow-md transition-all">
                    <div className="flex justify-between items-start mb-2">
                        <div className="p-2 bg-emerald-100 dark:bg-emerald-800 rounded-lg text-emerald-600 dark:text-emerald-300">
                            <DollarSign className="w-4 h-4" />
                        </div>
                        <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">Receita</span>
                    </div>
                    <p className="text-2xl font-black text-gray-900 dark:text-gray-100 tracking-tight">
                        {paginationInfo?.estatisticas?.total_valor ? fmtBRL(paginationInfo.estatisticas.total_valor) : fmtBRL(vendasData.reduce((s, v) => s + v['Total (R$)'], 0))}
                    </p>
                    <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium mt-1">Faturamento Geral</p>
                </div>

                <div className="group bg-linear-to-br from-rose-50 to-orange-50 dark:from-rose-900/20 dark:to-orange-900/20 rounded-2xl p-4 border border-rose-100 dark:border-rose-800/50 shadow-sm hover:shadow-md transition-all">
                    <div className="flex justify-between items-start mb-2">
                        <div className="p-2 bg-rose-100 dark:bg-rose-800 rounded-lg text-rose-600 dark:text-rose-300">
                            <Trophy className="w-4 h-4" />
                        </div>
                        <span className="text-[10px] font-bold text-rose-400 uppercase tracking-wider">Lucro</span>
                    </div>
                    <p className="text-2xl font-black text-gray-900 dark:text-gray-100 tracking-tight">
                        {paginationInfo?.estatisticas?.total_lucro ? fmtBRL(paginationInfo.estatisticas.total_lucro) : 'R$ 0,00'}
                    </p>
                    <p className="text-xs text-rose-600 dark:text-rose-400 font-medium mt-1">Lucro Real Estimado</p>
                </div>

                <div className="group bg-linear-to-br from-purple-50 to-violet-50 dark:from-purple-900/20 dark:to-violet-900/20 rounded-2xl p-4 border border-purple-100 dark:border-purple-800/50 shadow-sm hover:shadow-md transition-all">
                    <div className="flex justify-between items-start mb-2">
                        <div className="p-2 bg-purple-100 dark:bg-purple-800 rounded-lg text-purple-600 dark:text-purple-300">
                            <Zap className="w-4 h-4" />
                        </div>
                        <span className="text-[10px] font-bold text-purple-400 uppercase tracking-wider">Média</span>
                    </div>
                    <p className="text-2xl font-black text-gray-900 dark:text-gray-100 tracking-tight">
                        {paginationInfo?.estatisticas?.ticket_medio
                            ? fmtBRL(paginationInfo.estatisticas.ticket_medio)
                            : (paginationInfo?.estatisticas?.quantidade_vendas && paginationInfo?.estatisticas?.total_valor)
                                ? fmtBRL(paginationInfo.estatisticas.total_valor / paginationInfo.estatisticas.quantidade_vendas)
                                : 'R$ 0,00'}
                    </p>
                    <p className="text-xs text-purple-600 dark:text-purple-400 font-medium mt-1">Ticket Médio</p>
                </div>
            </div>
            {renderDataTable(vendasData, [
                { key: 'Código', label: 'Código', render: (v) => <span className="font-mono text-blue-600">{v}</span> },
                { key: 'Data/Hora', label: 'Data/Hora' },
                { key: 'Cliente', label: 'Cliente' },
                { key: 'Funcionário', label: 'Funcionário' },
                { key: 'Total (R$)', label: 'Total', align: 'right', render: (v) => <span className="font-bold text-green-600">{fmtBRL(v)}</span> },
                { key: 'Desconto (R$)', label: 'Desconto', align: 'right', render: (v) => <span className="text-red-600">{fmtBRL(v)}</span> },
                { key: 'Forma Pagamento', label: 'Forma Pgto', render: (v) => <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs">{v}</span> },
                {
                    key: 'Qtd Itens', label: 'Itens', render: (v) => (
                        <div className="flex items-center gap-1.5 px-2 py-1 bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 rounded-lg text-[11px] font-bold border border-indigo-100/50 dark:border-indigo-800/30">
                            <ListOrdered className="w-3 h-3" />
                            {v}
                        </div>
                    )
                },
            ], fetchVendasData)}
            {vendasData.filter(filterRow).length === 0 && (
                <div className="text-center py-12 text-gray-500">
                    <p className="text-lg">Nenhuma venda encontrada</p>
                    <p className="text-sm mt-2">Ajuste os filtros de data ou busca</p>
                </div>
            )}
        </>
    );

    // ==================== RENDER: PRODUTOS (MELHORADO) ====================

    const renderProdutos = () => renderDataTable(produtosData, [
        { key: 'Nome', label: 'Nome', render: (v) => <span className="font-medium">{v}</span> },
        { key: 'Categoria', label: 'Categoria' },
        { key: 'Preço Venda (R$)', label: 'Preço Venda', align: 'right', render: (v) => fmtBRL(v) },
        { key: 'Preço Custo (R$)', label: 'Preço Custo', align: 'right', render: (v) => fmtBRL(v) },
        {
            key: 'Margem (%)', label: 'Margem', align: 'right', render: (v) => (
                <span className={`font-semibold ${v < 10 ? 'text-red-600' : v < 30 ? 'text-orange-600' : 'text-green-600'}`}>{v}%</span>
            )
        },
        { key: 'Estoque', label: 'Estoque', render: (v) => String(v) },
        {
            key: 'Classificação ABC', label: 'ABC', render: (v) => (
                <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${v === 'A' ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' : v === 'B' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300' : v === 'C' ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}>{v}</span>
            )
        },
        {
            key: 'Status', label: 'Status', render: (v) => (
                <span className={v === 'CRÍTICO' ? 'text-red-600 font-bold' : 'text-emerald-600'}>{v}</span>
            )
        },
    ]);

    // ==================== RENDER TABELAS GENÉRICAS ====================

    const renderEquipe = () => renderDataTable(equipeData, [
        { key: 'Funcionário', label: 'Nome', render: (v) => <span className="font-medium">{v}</span> },
        { key: 'Vendas Realizadas', label: 'Vendas' },
        { key: 'Total Vendido (R$)', label: 'Total', align: 'right', render: (v) => <span className="font-semibold">{fmtBRL(v)}</span> },
        { key: 'Ticket Médio (R$)', label: 'Ticket Médio', align: 'right', render: (v) => fmtBRL(parseFloat(v)) },
    ]);

    const renderRFM = () => renderDataTable(rfmData, [
        { key: 'Nome', label: 'Cliente', render: (v) => <span className="font-medium">{v}</span> },
        {
            key: 'Segmento', label: 'Segmento', render: (v) => (
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${v === 'Campeão' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300' : v === 'Fiel' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' : v === 'Em Risco' ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300' : v === 'Perdido' ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'}`}>{v}</span>
            )
        },
        { key: 'Recência (dias)', label: 'Recência', render: (v) => v + ' dias' },
        { key: 'Frequência', label: 'Freq.' },
        { key: 'Valor Total (R$)', label: 'Valor', align: 'right', render: (v) => <span className="font-semibold text-green-600">{fmtBRL(v)}</span> },
        { key: 'Score RFM', label: 'Score', render: (v) => <span className="font-mono text-xs">{v}</span> },
        {
            key: 'Em Risco', label: 'Status', render: (v) => (
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${v === 'SIM' ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
                    {v === 'SIM' ? 'Em Risco' : 'OK'}
                </span>
            )
        },
    ]);

    const renderABC = () => renderDataTable(abcData, [
        { key: 'Produto', label: 'Produto', render: (v) => <span className="font-medium">{v}</span> },
        {
            key: 'Classe ABC', label: 'Classe', render: (v) => (
                <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${v === 'A' ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' : v === 'B' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300' : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'}`}>{v}</span>
            )
        },
        { key: 'Quantidade Vendida', label: 'Qtd' },
        { key: 'Faturamento (R$)', label: 'Faturamento', align: 'right', render: (v) => <span className="font-semibold">{fmtBRL(v)}</span> },
        { key: 'Lucro Real (R$)', label: 'Lucro', align: 'right', render: (v) => <span className="font-semibold text-green-600">{fmtBRL(v)}</span> },
        {
            key: 'Margem Real (%)', label: 'Margem', render: (v) => (
                <span className={`font-semibold ${parseFloat(v) < 0 ? 'text-red-600' : parseFloat(v) < 20 ? 'text-orange-600' : 'text-green-600'}`}>{v}%</span>
            )
        },
        { key: '% Faturamento', label: '% Fat.', render: (v) => v + '%' },
    ]);

    const renderPrevisao = () => renderDataTable(previsaoData, [
        { key: 'Produto', label: 'Produto', render: (v) => <span className="font-medium">{v}</span> },
        { key: 'Estoque Atual', label: 'Estoque', render: (v) => v + ' un' },
        { key: 'Média Vendas/Dia', label: 'Média/Dia' },
        { key: 'Dias até Esgotamento', label: 'Dias Restantes', render: (v) => <span className="font-semibold">{v}</span> },
        { key: 'Data Prevista', label: 'Data Prevista' },
        {
            key: 'Status', label: 'Status', render: (v) => (
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${v === 'CRÍTICO' ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 animate-pulse' : v === 'ATENÇÃO' ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300' : v === 'ESGOTADO' ? 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300' : 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'}`}>{v}</span>
            )
        },
    ]);

    const renderFornecedores = () => {
        const topFornecedor = fornecedoresData.length > 0 ? fornecedoresData.reduce((prev: any, current: any) => (prev.Score > current.Score) ? prev : current) : {};
        const atencaoFornecedor = fornecedoresData.length > 0 ? fornecedoresData.reduce((prev: any, current: any) => (prev.Score < current.Score) ? prev : current) : {};

        return (
            <div className="space-y-6">
                {/* Visual Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Top Supplier */}
                    <div className="bg-linear-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 p-4 rounded-xl border border-green-100 dark:border-green-800 flex items-center justify-between shadow-sm">
                        <div>
                            <p className="text-xs font-semibold text-green-600 dark:text-green-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                                <Trophy className="w-3 h-3" /> Melhor Fornecedor
                            </p>
                            <p className="text-lg font-bold text-gray-800 dark:text-gray-100">{topFornecedor['Fornecedor'] || '-'}</p>
                            <div className="flex items-center gap-2 mt-2">
                                <span className="text-xs bg-green-200 dark:bg-green-800/50 text-green-800 dark:text-green-200 px-2 py-0.5 rounded-full font-bold border border-green-300 dark:border-green-700">
                                    Score: {topFornecedor['Score']?.toFixed(1) || 0}
                                </span>
                                <span className="text-[10px] text-gray-600 dark:text-gray-400">
                                    OTD: <span className="font-medium text-gray-800 dark:text-gray-200">{topFornecedor['OTD (%)'] == null ? '—' : `${topFornecedor['OTD (%)'].toFixed(1)}%`}</span>
                                </span>
                            </div>
                        </div>
                        <div className="p-3 bg-white dark:bg-gray-800 rounded-full text-green-600 dark:text-green-400 shadow-sm border border-green-100 dark:border-green-900">
                            <Trophy className="w-6 h-6" />
                        </div>
                    </div>

                    {/* Attention Needed */}
                    <div className="bg-linear-to-br from-red-50 to-orange-50 dark:from-red-900/20 dark:to-orange-900/20 p-4 rounded-xl border border-red-100 dark:border-red-800 flex items-center justify-between shadow-sm">
                        <div>
                            <p className="text-xs font-semibold text-red-600 dark:text-red-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                                <AlertOctagon className="w-3 h-3" /> Atenção Necessária
                            </p>
                            <p className="text-lg font-bold text-gray-800 dark:text-gray-100">{atencaoFornecedor['Fornecedor'] || '-'}</p>
                            <div className="flex items-center gap-2 mt-2">
                                <span className="text-xs bg-red-200 dark:bg-red-800/50 text-red-800 dark:text-red-200 px-2 py-0.5 rounded-full font-bold border border-red-300 dark:border-red-700">
                                    Score: {atencaoFornecedor['Score']?.toFixed(1) || 0}
                                </span>
                                <span className="text-[10px] text-gray-600 dark:text-gray-400">
                                    Atraso Médio: <span className="font-medium text-gray-800 dark:text-gray-200">{atencaoFornecedor['Atraso Médio (dias)']?.toFixed(1) || 0} dias</span>
                                </span>
                            </div>
                        </div>
                        <div className="p-3 bg-white dark:bg-gray-800 rounded-full text-red-600 dark:text-red-400 shadow-sm border border-red-100 dark:border-red-900">
                            <AlertOctagon className="w-6 h-6" />
                        </div>
                    </div>
                </div>

                {renderDataTable(fornecedoresData, [
                    { key: 'Fornecedor', label: 'Fornecedor', render: (v) => <span className="font-medium text-gray-900 dark:text-gray-100">{v}</span> },
                    {
                        key: 'Score', label: 'Score', align: 'center', render: (v) => (
                            <div className="w-full max-w-[80px] mx-auto">
                                <div className="h-2 w-full bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                    <div
                                        className={`h-full ${v >= 80 ? 'bg-green-500' : v >= 60 ? 'bg-yellow-500' : 'bg-red-500'}`}
                                        style={{ width: `${Math.min(100, Math.max(0, v))}%` }}
                                    ></div>
                                </div>
                                <div className="text-[10px] text-center mt-0.5 font-bold text-gray-600 dark:text-gray-400">{v?.toFixed(1)}</div>
                            </div>
                        )
                    },
                    {
                        key: 'OTD (%)', label: 'OTD', align: 'right', render: (v) => (
                            <span className={`font-bold ${v >= 90 ? 'text-green-600 dark:text-green-400' : v >= 75 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>
                                {v == null ? '—' : `${v.toFixed(1)}%`}
                            </span>
                        )
                    },
                    {
                        key: 'Classificação', label: 'Class.', render: (v) => (
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${v === 'PREMIUM' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300' : v === 'REGULAR' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'}`}>{v}</span>
                        )
                    },
                    { key: 'Total Pedidos', label: 'Pedidos', align: 'center' },
                    { key: 'Valor Compras (R$)', label: 'Valor Compras', align: 'right', render: (v) => <span className="font-semibold text-gray-700 dark:text-gray-300">{fmtBRL(v)}</span> },
                    {
                        key: 'Taxa Conclusão (%)', label: 'Conclusão', align: 'right', render: (v) => (
                            <span className={`font-medium ${v >= 80 ? 'text-green-600 dark:text-green-400' : v >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>{v?.toFixed(0)}%</span>
                        )
                    },
                    {
                        key: 'Atraso Médio (dias)', label: 'Atraso Méd.', align: 'right', render: (v) => (
                            <span className={v > 0 ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-400 dark:text-gray-500'}>{v > 0 ? `${v.toFixed(1)} dias` : '-'}</span>
                        )
                    },
                    { key: 'Entrega (dias)', label: 'Lead Time', align: 'right', render: (v) => v > 0 ? <span className="text-gray-600 dark:text-gray-400">{v} dias</span> : <span className="text-gray-300 dark:text-gray-600">-</span> },
                    {
                        key: 'Boletos Abertos', label: 'Bol. Abertos', align: 'center', render: (v) => (
                            <span className={v > 0 ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 px-1.5 py-0.5 rounded-full text-[10px] font-bold' : 'text-gray-300 dark:text-gray-600'}>{v}</span>
                        )
                    },
                    {
                        key: 'Boletos Vencidos', label: 'Vencidos', align: 'center', render: (v) => (
                            <span className={v > 0 ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 px-1.5 py-0.5 rounded-full text-[10px] font-bold' : 'text-gray-300 dark:text-gray-600'}>{v}</span>
                        )
                    },
                ])}
            </div>
        );
    };

    const renderClientes = () => renderDataTable(clientesData, [
        { key: 'Cliente', label: 'Cliente', render: (v) => <span className="font-medium">{v}</span> },
        { key: 'CPF', label: 'CPF', render: (v) => <span className="font-mono text-xs">{v}</span> },
        { key: 'Total Compras', label: 'Compras' },
        { key: 'Valor Total (R$)', label: 'Valor Total', align: 'right', render: (v) => <span className="font-semibold text-green-600">{fmtBRL(v)}</span> },
        { key: 'Ticket Médio (R$)', label: 'Ticket Médio', align: 'right', render: (v) => fmtBRL(v) },
        { key: 'Última Compra', label: 'Última Compra' },
        { key: 'Frequência (dias)', label: 'Freq. (dias)' },
    ]);

    // ==================== MODAL CONTENT DISPATCHER ====================

    const renderModalContent = () => {
        switch (modalType) {
            case 'vendas': return renderVendas();
            case 'produtos': return renderProdutos();
            case 'financeiro': return renderFinanceiroDRE();
            case 'equipe': return renderEquipe();
            case 'rfm': return renderRFM();
            case 'abc': return renderABC();
            case 'previsao': return renderPrevisao();
            case 'fornecedores': return renderFornecedores();
            case 'clientes': return renderClientes();
            default: return null;
        }
    };

    // ==================== RENDER PRINCIPAL ====================

    return (
        <div className="space-y-8 max-w-7xl mx-auto pb-10">
            {/* Header com Filtros */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 flex flex-col md:flex-row justify-between items-center gap-4">
                <div className="flex items-center space-x-4">
                    <div className="p-3 bg-indigo-600 rounded-lg shadow-lg shadow-indigo-200">
                        <BarChart3 className="w-8 h-8 text-white" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 tour-relatorios-visao">Central de Inteligência</h1>
                        <p className="text-gray-500 dark:text-gray-400">Extraia insights valiosos para tomada de decisão</p>
                    </div>
                </div>
                <div className="flex items-center gap-3 bg-gray-50 dark:bg-gray-700 p-2 rounded-lg border border-gray-200 dark:border-gray-600">
                    <CalendarIcon className="w-5 h-5 text-gray-500 dark:text-gray-400 ml-2" />
                    <div className="flex items-center gap-2">
                        <input type="date" value={dateRange.startDate} onChange={(e) => setDateRange({ ...dateRange, startDate: e.target.value })} className="bg-transparent border-none text-sm font-medium text-gray-700 dark:text-gray-200 focus:ring-0" />
                        <span className="text-gray-400 dark:text-gray-500">até</span>
                        <input type="date" value={dateRange.endDate} onChange={(e) => setDateRange({ ...dateRange, endDate: e.target.value })} className="bg-transparent border-none text-sm font-medium text-gray-700 dark:text-gray-200 focus:ring-0" />
                    </div>
                </div>
            </div>

            {/* Seção: Relatórios Operacionais */}
            <div>
                <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-4 flex items-center gap-2">
                    <BarChart3 className="w-5 h-5 text-indigo-500" /> Relatórios Operacionais
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                    <ReportCard title="Vendas Detalhadas" description="Análise cronológica, totais diários e volume por período." icon={TrendingUp} color="bg-blue-500" loading={loadingReport === 'vendas'} onOpen={() => openModal('vendas')} />
                    <ReportCard title="Estoque & Produtos" description="Inventário com margem, classificação ABC e status de estoque." icon={Package} color="bg-emerald-500" loading={loadingReport === 'produtos'} onOpen={() => openModal('produtos')} />
                    <ReportCard title="DRE Financeiro" description="Faturamento, lucro bruto, contas a pagar, fluxo de caixa e alertas." icon={DollarSign} color="bg-amber-500" loading={loadingReport === 'financeiro'} onOpen={() => openModal('financeiro')} badge="DRE" />
                    <ReportCard title="Performance Equipe" description="Ranking de vendedores, ticket médio e produtividade por funcionário." icon={Users} color="bg-pink-500" loading={loadingReport === 'equipe'} onOpen={() => openModal('equipe')} />
                    <ReportCard title="Controle de Ponto" description="Frequência, atrasos, taxa de presença e horas por funcionário." icon={Clock} color="bg-indigo-600" loading={loadingReport === 'ponto'} onOpen={() => openModal('ponto')} />
                </div>
            </div>

            {/* Seção: Relatórios Analíticos */}
            <div>
                <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-4 flex items-center gap-2">
                    <Truck className="w-5 h-5 text-teal-500" /> Relatórios de Cadastros
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                    <ReportCard title="Fornecedores" description="Ranking de fornecedores, volume de pedidos, prazo de entrega e pendências." icon={Truck} color="bg-teal-500" loading={loadingReport === 'fornecedores'} onOpen={() => openModal('fornecedores')} badge="Novo" />
                    <ReportCard title="Clientes" description="Top clientes, ticket médio, frequência de compras e última visita." icon={UserCheck} color="bg-cyan-500" loading={loadingReport === 'clientes'} onOpen={() => openModal('clientes')} badge="Novo" />
                </div>
            </div>

            {/* Seção: Inteligência de Negócios */}
            <div>
                <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-4 flex items-center gap-2">
                    <Brain className="w-5 h-5 text-purple-500" /> Inteligência de Negócios
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                    <ReportCard title="Análise RFM de Clientes" description="Segmentação: Campeões, Fiéis, Em Risco e Perdidos. Identifique clientes para campanhas." icon={Brain} color="bg-purple-600" loading={loadingReport === 'rfm'} onOpen={() => openModal('rfm')} />
                    <ReportCard title="Rentabilidade ABC" description="Pareto 80/20, margem por produto, CMP em tempo real." icon={Target} color="bg-rose-600" loading={loadingReport === 'abc'} onOpen={() => openModal('abc')} />
                    <ReportCard title="Previsão de Esgotamento" description="Previsão baseada em média móvel. Produtos críticos e em atenção." icon={Zap} color="bg-orange-600" loading={loadingReport === 'previsao'} onOpen={() => openModal('previsao')} />
                </div>
            </div>

            {/* Seção: Backup */}
            <div>
                <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-4 flex items-center gap-2">
                    <Archive className="w-5 h-5 text-slate-500" /> Exportação & Backup
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                    <ReportCard title="Backup Completo (Power BI)" description="Exportação multi-abas com dicionário de dados, Excel e JSON." icon={Archive} color="bg-slate-600" loading={loadingBackup} onOpen={handleBackupExport} />
                </div>
            </div>

            {/* Modal */}
            {modalOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-100 p-4 backdrop-blur-sm overflow-y-auto" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))', paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}>
                    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-5xl max-h-[90dvh] overflow-y-auto my-auto border border-gray-200 dark:border-gray-800 transition-colors duration-200">
                        <div className="sticky top-0 bg-white/95 dark:bg-gray-900/95 backdrop-blur border-b border-gray-200 dark:border-gray-800 px-6 py-4 flex justify-between items-center z-10">
                            <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">{modalTitles[modalType || ''] || ''}</h2>
                            <button onClick={closeModal} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"><X className="w-6 h-6" /></button>
                        </div>
                        <div className="px-6 py-4">
                            {/* Toolbar */}
                            <div className="flex flex-wrap items-center gap-2 mb-4">
                                {renderExportButtons()}
                                <div className="ml-auto flex items-center gap-2 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800/50">
                                    <Search className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                                    <input
                                        type="text"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        placeholder="Buscar..."
                                        className="bg-transparent text-sm focus:outline-none w-32 text-gray-700 dark:text-gray-200 placeholder-gray-400"
                                    />
                                </div>
                            </div>
                            {/* Conteúdo */}
                            <div className="rounded-lg border border-gray-100 dark:border-gray-800 max-h-[70vh] overflow-auto bg-white dark:bg-gray-900">
                                {renderModalContent()}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Dica */}
            <div className="bg-linear-to-r from-indigo-50 to-blue-50 dark:from-indigo-900/20 dark:to-blue-900/20 border border-indigo-100 dark:border-indigo-800 rounded-xl p-6 flex items-start gap-4">
                <div className="p-2 bg-white dark:bg-gray-800 rounded-full shadow-sm"><span className="text-xl">💡</span></div>
                <div>
                    <h4 className="font-bold text-indigo-900 dark:text-indigo-300">Dica do Especialista</h4>
                    <p className="text-indigo-700 dark:text-indigo-400 text-sm mt-1">
                        Use o <strong>DRE Financeiro</strong> para reuniões semanais. Combine com a <strong>Análise RFM</strong> para identificar clientes em risco
                        e a <strong>Rentabilidade ABC</strong> para priorizar produtos de alto giro. O relatório de <strong>Fornecedores</strong> ajuda a renegociar prazos.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default ReportsPage;
