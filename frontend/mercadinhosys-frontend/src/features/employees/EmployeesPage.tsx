import React, { useEffect, useState } from "react";
import { Bar, Line, Doughnut } from "react-chartjs-2";
import {
    Chart as ChartJS,
    BarElement,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    ArcElement,
    Tooltip,
    Legend,
    Filler,
} from "chart.js";
import {
    UserCog, Users, TrendingUp, DollarSign,
    Filter, Download, Plus, Edit2, Trash2, Eye, X, AlertCircle,
    UserCheck, UserX, Award, Clock
} from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { employeesService, Funcionario, EstatisticasFuncionarios } from "./employeesService";
import { buscarCep, formatCep, formatCpf, formatPhone } from "../../utils/cepUtils";
import { useLocation } from "react-router-dom";
import { showToast } from "../../utils/toast";
import PinDialog from "../../components/modals/PinDialog";

ChartJS.register(
    BarElement,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    ArcElement,
    Tooltip,
    Legend,
    Filler
);

const CARGOS = [
    "Gerente",
    "Supervisor",
    "Atendente",
    "Caixa",
    "Estoquista",
    "Auxiliar",
    "Vendedor",
    "Outros"
];

// Cargos canônicos das Regras de Acesso (1=Admin … 6=Entregador)
const NIVEIS_ACESSO = [
    { value: "ADMIN", label: "Administrador (acesso total)" },
    { value: "GERENTE", label: "Gerente" },
    { value: "RH", label: "RH" },
    { value: "CAIXA", label: "Estoque/Caixa" },
    { value: "VENDEDOR", label: "Vendedor Externo (SFA)" },
    { value: "ENTREGADOR", label: "Entregador" },
];

function formatCurrency(value: number) {
    return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(dateString: string) {
    if (!dateString) return "-";
    const date = new Date(dateString);
    return date.toLocaleDateString("pt-BR");
}

function formatCPF(cpf: string) {
    if (!cpf) return "-";
    return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}

export default function EmployeesPage() {
    const [funcionarios, setFuncionarios] = useState<Funcionario[]>([]);
    const [loading, setLoading] = useState(true);
    const [erro, setErro] = useState<string | null>(null);
    const [estatisticas, setEstatisticas] = useState<EstatisticasFuncionarios | null>(null);

    // Filtros
    const [filtros, setFiltros] = useState({
        busca: "",
        cargo: "",
        nivel_acesso: "",
        ativos: "true",
        data_admissao_inicio: "",
        data_admissao_fim: "",
        salario_min: "",
        salario_max: "",
        ordenar_por: "nome",
        ordem: "asc",
        pagina: 1,
        por_pagina: 20,
    });

    // Modais
    const [modalAberto, setModalAberto] = useState(false);
    const [modalDetalhesAberto, setModalDetalhesAberto] = useState(false);
    const [funcionarioSelecionado, setFuncionarioSelecionado] = useState<Funcionario | null>(null);
    const [modoEdicao, setModoEdicao] = useState(false);

    // Gate de PIN para operações sensíveis
    const [pinAction, setPinAction] = useState<{ run: () => void; title: string; description: string } | null>(null);
    const requirePin = (run: () => void, title: string, description: string) =>
        setPinAction({ run, title, description });

    // Form
    const [formData, setFormData] = useState({
        nome: "",
        cpf: "",
        rg: "",
        data_nascimento: "",
        telefone: "",
        celular: "",
        email: "",
        cep: "",
        logradouro: "",
        numero: "",
        complemento: "",
        bairro: "",
        cidade: "",
        estado: "",
        cargo: "Atendente",
        salario: "",
        data_admissao: new Date().toISOString().split('T')[0],
        usuario: "",
        senha: "",
        nivel_acesso: "CAIXA",
        ativo: true,
        pin_cancelamento: "",
    });

    const location = useLocation();

    const [mostrarAnalises, setMostrarAnalises] = useState(true);
    const [menuExportarAberto, setMenuExportarAberto] = useState(false);
    const [loadingCep, setLoadingCep] = useState(false);

    // Local toast notification removed

    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const analyticsParam = params.get("analytics");
        if (analyticsParam === "0" || analyticsParam === "false") {
            setMostrarAnalises(false);
        }
        if (analyticsParam === "1" || analyticsParam === "true") {
            setMostrarAnalises(true);
        }
    }, [location.search]);

    /* Timer effect removed */

    /* Local showToast removed */

    useEffect(() => {
        carregarFuncionarios();
        carregarEstatisticas();
    }, [filtros]);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            const target = event.target as HTMLElement;
            if (menuExportarAberto && !target.closest('.export-menu-container')) {
                setMenuExportarAberto(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [menuExportarAberto]);

    async function carregarFuncionarios() {
        setLoading(true);
        setErro(null);

        try {
            const params: Record<string, string | number> = {
                pagina: filtros.pagina,
                por_pagina: filtros.por_pagina,
                ordenar_por: filtros.ordenar_por,
                ordem: filtros.ordem,
            };

            if (filtros.busca) params.busca = filtros.busca;
            if (filtros.cargo) params.cargo = filtros.cargo;
            if (filtros.nivel_acesso) params.nivel_acesso = filtros.nivel_acesso;
            if (filtros.ativos) params.ativos = filtros.ativos;
            if (filtros.data_admissao_inicio) params.data_admissao_inicio = filtros.data_admissao_inicio;
            if (filtros.data_admissao_fim) params.data_admissao_fim = filtros.data_admissao_fim;
            if (filtros.salario_min) params.salario_min = filtros.salario_min;
            if (filtros.salario_max) params.salario_max = filtros.salario_max;

            const response = await employeesService.listar(params);

            if (response.success) {
                setFuncionarios(response.data || []);
            } else {
                setFuncionarios([]);
            }
        } catch (err: unknown) {
            console.error("❌ Erro ao carregar funcionários:", err);
            let errorMessage = "Erro ao carregar funcionários: ";
            if (err instanceof Error) {
                errorMessage += err.message;
            } else if (typeof err === 'object' && err !== null && 'response' in err) {
                const axiosError = err as any;
                errorMessage += axiosError.response?.data?.error || axiosError.message || "Erro desconhecido";
            } else {
                errorMessage += "Erro desconhecido";
            }
            setErro(errorMessage);
        } finally {
            setLoading(false);
        }
    }

    async function carregarEstatisticas() {
        try {
            const response = await employeesService.obterEstatisticas();

            if (response.success && response.estatisticas) {
                setEstatisticas(response.estatisticas);
            } else {
                setEstatisticas(null);
            }
        } catch (err: unknown) {
            console.error("❌ Erro ao carregar estatísticas:", err);
        }
    }

    const handleCepBlur = async () => {
        setLoadingCep(true);
        const dados = await buscarCep(formData.cep);
        setLoadingCep(false);
        if (dados) {
            setFormData(prev => ({
                ...prev,
                logradouro: dados.logradouro,
                bairro: dados.bairro || prev.bairro,
                cidade: dados.localidade,
                estado: dados.uf
            }));
        }
    };

    function handleFiltroChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
        setFiltros((prev) => ({
            ...prev,
            [e.target.name]: e.target.value,
            pagina: 1,
        }));
    }

    function limparFiltros() {
        setFiltros({
            busca: "",
            cargo: "",
            nivel_acesso: "",
            ativos: "true",
            data_admissao_inicio: "",
            data_admissao_fim: "",
            salario_min: "",
            salario_max: "",
            ordenar_por: "nome",
            ordem: "asc",
            pagina: 1,
            por_pagina: 20,
        });
    }

    function abrirModalNovo() {
        setModoEdicao(false);
        setFuncionarioSelecionado(null);
        setFormData({
            nome: "",
            cpf: "",
            rg: "",
            data_nascimento: "",
            telefone: "",
            celular: "",
            email: "",
            cep: "",
            logradouro: "",
            numero: "",
            complemento: "",
            bairro: "",
            cidade: "",
            estado: "",
            cargo: "Atendente",
            salario: "",
            data_admissao: new Date().toISOString().split('T')[0],
            usuario: "",
            senha: "",
            nivel_acesso: "CAIXA",
            ativo: true,
            pin_cancelamento: "",
        });
        setModalAberto(true);
    }

    function abrirModalEdicao(funcionario: Funcionario) {
        setModoEdicao(true);
        setFuncionarioSelecionado(funcionario);
        setFormData({
            nome: funcionario.nome,
            cpf: funcionario.cpf,
            rg: funcionario.rg || "",
            data_nascimento: funcionario.data_nascimento || "",
            telefone: funcionario.telefone,
            celular: funcionario.celular || "",
            email: funcionario.email,
            cep: funcionario.cep || "",
            logradouro: funcionario.logradouro || "",
            numero: funcionario.numero || "",
            complemento: funcionario.complemento || "",
            bairro: funcionario.bairro || "",
            cidade: funcionario.cidade || "",
            estado: funcionario.estado || "",
            cargo: funcionario.cargo,
            salario: funcionario.salario?.toString() || "",
            data_admissao: funcionario.data_admissao,
            usuario: funcionario.usuario,
            senha: "",
            nivel_acesso: funcionario.nivel_acesso,
            ativo: funcionario.ativo,
            pin_cancelamento: "", // nunca expomos o hash; em branco mantém o PIN atual
        });
        setModalAberto(true);
    }

    async function abrirDetalhes(funcionario: Funcionario) {
        try {
            const promise = employeesService.obterDetalhes(funcionario.id);
            const response = await showToast.promise(promise, {
                loading: 'Carregando detalhes...',
                success: 'Detalhes carregados!',
                error: 'Erro ao carregar detalhes'
            });

            if (response.success) {
                setFuncionarioSelecionado(response.data);
                setModalDetalhesAberto(true);
            }
        } catch (err: any) {
            console.error("❌ Erro ao carregar detalhes:", err);
        }
    }

    async function salvarFuncionario() {
        try {
            const dados: Record<string, string | number | boolean> = {
                ...formData,
                salario: formData.salario ? parseFloat(formData.salario) : 0,
            };

            const promise = modoEdicao && funcionarioSelecionado
                ? employeesService.atualizar(funcionarioSelecionado.id, dados)
                : employeesService.criar(dados);

            await showToast.promise(promise, {
                loading: modoEdicao ? 'Atualizando funcionário...' : 'Criando funcionário...',
                success: modoEdicao ? 'Funcionário atualizado com sucesso!' : 'Funcionário criado com sucesso!',
                error: 'Erro ao salvar funcionário'
            }, {
                theme: modoEdicao ? 'warning' : 'success'
            });

            setModalAberto(false);
            carregarFuncionarios();
            carregarEstatisticas();
        } catch (err: any) {
            console.error("❌ Erro ao salvar funcionário:", err);
        }
    }

    async function excluirFuncionario(id: number) {
        const funcionario = funcionarios.find(f => f.id === id);
        if (!funcionario) return;
        requirePin(
            async () => {
                try {
                    await showToast.promise(employeesService.excluir(id), {
                        loading: 'Desativando funcionário...',
                        success: 'Funcionário desativado com sucesso!',
                        error: 'Erro ao desativar funcionário'
                    }, {
                        theme: 'error'
                    });
                    carregarFuncionarios();
                    carregarEstatisticas();
                } catch (err: any) {
                    console.error("❌ Erro ao excluir funcionário:", err);
                }
            },
            'Autorizar desativação',
            `Autorize com o PIN para desativar o funcionário "${funcionario.nome}".`
        );
    }

    function exportarCSV() {
        try {
            const headers = ["Nome", "CPF", "Cargo", "Salário", "Data Admissão", "Status", "Nível Acesso"];
            const rows = funcionarios.map(f => [
                f.nome,
                formatCPF(f.cpf),
                f.cargo,
                f.salario?.toFixed(2) || "0.00",
                formatDate(f.data_admissao),
                f.ativo ? "Ativo" : "Inativo",
                f.nivel_acesso
            ]);

            const csvContent = [
                headers.join(","),
                ...rows.map(row => row.map(cell => `"${cell}"`).join(","))
            ].join("\n");

            const blob = new Blob(["\ufeff" + csvContent], { type: "text/csv;charset=utf-8;" });
            const link = document.createElement("a");
            const url = URL.createObjectURL(blob);
            link.setAttribute("href", url);
            link.setAttribute("download", `funcionarios-${new Date().toISOString().split('T')[0]}.csv`);
            link.style.visibility = "hidden";
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            setMenuExportarAberto(false);
            showToast.info("CSV exportado com sucesso!");
        } catch (err: any) {
            console.error("❌ Erro ao exportar CSV:", err);
            showToast.error(`Erro ao exportar CSV: ${err.message}`);
        }
    }

    function exportarExcel() {
        try {
            const dados = funcionarios.map(f => ({
                "Nome": f.nome,
                "CPF": formatCPF(f.cpf),
                "Cargo": f.cargo,
                "Salário": f.salario || 0,
                "Data Admissão": formatDate(f.data_admissao),
                "Telefone": f.telefone,
                "Email": f.email,
                "Status": f.ativo ? "Ativo" : "Inativo",
                "Nível Acesso": f.nivel_acesso
            }));

            const ws_data = [
                Object.keys(dados[0] || {}),
                ...dados.map(obj => Object.values(obj))
            ];

            const csvContent = ws_data.map(row =>
                row.map(cell => `"${cell}"`).join(",")
            ).join("\n");

            const blob = new Blob(["\ufeff" + csvContent], { type: "application/vnd.ms-excel;charset=utf-8;" });
            const link = document.createElement("a");
            const url = URL.createObjectURL(blob);
            link.setAttribute("href", url);
            link.setAttribute("download", `funcionarios-${new Date().toISOString().split('T')[0]}.xls`);
            link.style.visibility = "hidden";
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            setMenuExportarAberto(false);
            showToast.info("Excel exportado com sucesso!");
        } catch (err: any) {
            console.error("❌ Erro ao exportar Excel:", err);
            showToast.error(`Erro ao exportar Excel: ${err.message}`);
        }
    }

    function exportarPDF() {
        try {
            const doc = new jsPDF();

            // Cabeçalho
            doc.setFillColor(63, 81, 181); // Cor primária (Indigo)
            doc.rect(0, 0, 210, 40, 'F');

            doc.setTextColor(255, 255, 255);
            doc.setFontSize(22);
            doc.text("Relatório de Funcionários", 105, 20, { align: "center" });

            doc.setFontSize(10);
            doc.text(`Gerado em: ${new Date().toLocaleDateString("pt-BR")} às ${new Date().toLocaleTimeString("pt-BR")}`, 105, 30, { align: "center" });

            // Tabela
            const headers = [["Nome", "CPF", "Cargo", "Salário", "Data Admissão", "Status", "Nível Acesso"]];
            const data = funcionarios.map(f => [
                f.nome,
                formatCPF(f.cpf),
                f.cargo,
                f.salario?.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) || "R$ 0,00",
                formatDate(f.data_admissao),
                f.ativo ? "Ativo" : "Inativo",
                f.nivel_acesso
            ]);

            autoTable(doc, {
                head: headers,
                body: data,
                startY: 50,
                theme: 'grid',
                styles: { fontSize: 8, cellPadding: 2 },
                headStyles: { fillColor: [63, 81, 181], textColor: [255, 255, 255] },
                alternateRowStyles: { fillColor: [245, 245, 245] }
            });

            // Rodapé
            const pageCount = doc.getNumberOfPages();
            doc.setFontSize(8);
            doc.setTextColor(100, 100, 100);
            for (let i = 1; i <= pageCount; i++) {
                doc.setPage(i);
                doc.text(`Página ${i} de ${pageCount} - MercadinhoSys`, 105, 290, { align: "center" });
            }

            doc.save(`funcionarios-${new Date().toISOString().split('T')[0]}.pdf`);

            setMenuExportarAberto(false);
            showToast.info("PDF exportado com sucesso!");
        } catch (err: any) {
            console.error("❌ Erro ao exportar PDF:", err);
            showToast.error(`Erro ao exportar PDF: ${err.message}`);
        }
    }

    return (
        <div className="p-6 max-w-7xl mx-auto bg-gray-50 dark:bg-gray-900 min-h-screen">
            {/* Header */}

            {/* Header */}
            <div className="mb-8">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div className="flex items-center space-x-4">
                        <div className="p-3 bg-linear-to-br from-purple-500 to-purple-600 rounded-xl shadow-lg">
                            <UserCog className="w-8 h-8 text-white" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
                                Gestão de Funcionários
                            </h1>
                            <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">
                                Controle completo da equipe e recursos humanos
                            </p>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-3">
                        <button
                            onClick={() => setMostrarAnalises(!mostrarAnalises)}
                            className={`px-4 py-2.5 rounded-lg transition-all flex items-center gap-2 shadow-md font-medium ${mostrarAnalises
                                ? "bg-blue-500 text-white hover:bg-blue-600"
                                : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
                                }`}
                        >
                            <TrendingUp className="w-5 h-5" />
                            {mostrarAnalises ? "Ocultar Análises" : "Mostrar Análises"}
                        </button>

                        {/* Menu Exportar */}
                        <div className="relative export-menu-container">
                            <button
                                onClick={() => setMenuExportarAberto(!menuExportarAberto)}
                                className="bg-green-500 text-white px-4 py-2.5 rounded-lg hover:bg-green-600 transition-all flex items-center gap-2 shadow-md font-medium"
                            >
                                <Download className="w-5 h-5" />
                                Exportar
                            </button>

                            {menuExportarAberto && (
                                <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 z-50 overflow-hidden">
                                    <div className="py-1">
                                        <button
                                            onClick={exportarPDF}
                                            className="w-full text-left px-4 py-3 hover:bg-red-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-3 text-gray-700 dark:text-gray-300"
                                        >
                                            <Users className="w-5 h-5 text-red-600" />
                                            <div>
                                                <div className="font-medium">PDF (.pdf)</div>
                                                <div className="text-xs text-gray-800 dark:text-gray-200">Documento pronto para impressão</div>
                                            </div>
                                        </button>

                                        <button
                                            onClick={exportarExcel}
                                            className="w-full text-left px-4 py-3 hover:bg-green-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-3 text-gray-700 dark:text-gray-300"
                                        >
                                            <Users className="w-5 h-5 text-green-600" />
                                            <div>
                                                <div className="font-medium">Excel (.xls)</div>
                                                <div className="text-xs text-gray-800 dark:text-gray-200">Planilha editável</div>
                                            </div>
                                        </button>

                                        <button
                                            onClick={exportarCSV}
                                            className="w-full text-left px-4 py-3 hover:bg-blue-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-3 text-gray-700 dark:text-gray-300"
                                        >
                                            <Users className="w-5 h-5 text-blue-600" />
                                            <div>
                                                <div className="font-medium">CSV (.csv)</div>
                                                <div className="text-xs text-gray-800 dark:text-gray-200">Dados separados</div>
                                            </div>
                                        </button>
                                    </div>

                                    <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-2 bg-gray-50 dark:bg-gray-900">
                                        <p className="text-xs text-gray-700 dark:text-gray-300">
                                            👥 {funcionarios.length} funcionários
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>

                        <button
                            onClick={abrirModalNovo}
                            className="bg-linear-to-r from-blue-500 to-blue-600 text-white px-6 py-2.5 rounded-lg hover:from-blue-600 hover:to-blue-700 transition-all flex items-center gap-2 shadow-lg font-medium"
                        >
                            <Plus className="w-5 h-5" />
                            Novo Funcionário
                        </button>
                    </div>
                </div>
            </div>

            {/* Métricas KPI */}
            {estatisticas && (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                    <div className="bg-linear-to-br from-purple-50 to-purple-100 dark:from-purple-900/20 dark:to-purple-800/20 p-6 rounded-xl shadow-md border border-purple-200 dark:border-purple-800">
                        <div className="flex items-center justify-between mb-2">
                            <div className="text-sm text-purple-700 dark:text-purple-300 font-medium">Total Funcionários</div>
                            <Users className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                        </div>
                        <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">{estatisticas.totais.total_funcionarios}</div>
                        <div className="text-xs text-purple-600 dark:text-purple-400 mt-1">
                            {estatisticas.totais.total_ativos} ativos • {estatisticas.totais.total_inativos} inativos
                        </div>
                    </div>

                    <div className="bg-linear-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/20 p-6 rounded-xl shadow-md border border-green-200 dark:border-green-800">
                        <div className="flex items-center justify-between mb-2">
                            <div className="text-sm text-green-700 dark:text-green-300 font-medium">Funcionários Ativos</div>
                            <UserCheck className="w-5 h-5 text-green-600 dark:text-green-400" />
                        </div>
                        <div className="text-2xl font-bold text-green-600 dark:text-green-400">{estatisticas.totais.total_ativos}</div>
                        <div className="text-xs text-green-600 dark:text-green-400 mt-1">
                            {estatisticas.totais.taxa_atividade.toFixed(1)}% taxa de atividade
                        </div>
                    </div>

                    <div className="bg-linear-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 p-6 rounded-xl shadow-md border border-blue-200 dark:border-blue-800">
                        <div className="flex items-center justify-between mb-2">
                            <div className="text-sm text-blue-700 dark:text-blue-300 font-medium">Folha de Pagamento</div>
                            <DollarSign className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{formatCurrency(estatisticas.salarios.soma_total)}</div>
                        <div className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                            Média: {formatCurrency(estatisticas.salarios.medio)}
                        </div>
                    </div>

                    <div className="bg-linear-to-br from-orange-50 to-orange-100 dark:from-orange-900/20 dark:to-orange-800/20 p-6 rounded-xl shadow-md border border-orange-200 dark:border-orange-800">
                        <div className="flex items-center justify-between mb-2">
                            <div className="text-sm text-orange-700 dark:text-orange-300 font-medium">Tempo Médio</div>
                            <Clock className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                        </div>
                        <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                            {estatisticas.tempo_empresa.medio_anos.toFixed(1)} anos
                        </div>
                        <div className="text-xs text-orange-600 dark:text-orange-400 mt-1">
                            {estatisticas.tempo_empresa.medio_meses.toFixed(0)} meses de empresa
                        </div>
                    </div>
                </div>
            )}

            {/* Análises e Gráficos */}
            {mostrarAnalises && estatisticas && (
                <div className="space-y-6 mb-6">
                    {/* Evolução de Admissões e Demissões */}
                    {estatisticas.admissoes_demissoes && estatisticas.admissoes_demissoes.por_mes.length > 0 && (
                        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md border border-gray-200 dark:border-gray-700">
                            <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white flex items-center gap-2">
                                <span>📈</span> Evolução de Admissões e Demissões
                            </h3>
                            <div className="h-80">
                                <Line
                                    data={{
                                        labels: estatisticas.admissoes_demissoes.por_mes.map(e => e.mes_nome),
                                        datasets: [
                                            {
                                                label: "Admissões",
                                                data: estatisticas.admissoes_demissoes.por_mes.map(e => e.admissoes),
                                                borderColor: "rgb(34, 197, 94)",
                                                backgroundColor: "rgba(34, 197, 94, 0.1)",
                                                fill: true,
                                                tension: 0.4,
                                                pointRadius: 6,
                                                pointHoverRadius: 8,
                                            },
                                            {
                                                label: "Demissões",
                                                data: estatisticas.admissoes_demissoes.por_mes.map(e => e.demissoes),
                                                borderColor: "rgb(239, 68, 68)",
                                                backgroundColor: "rgba(239, 68, 68, 0.1)",
                                                fill: true,
                                                tension: 0.4,
                                                pointRadius: 6,
                                                pointHoverRadius: 8,
                                            },
                                        ],
                                    }}
                                    options={{
                                        responsive: true,
                                        maintainAspectRatio: false,
                                        plugins: {
                                            legend: { display: true, position: 'top' },
                                            tooltip: {
                                                callbacks: {
                                                    label: (context: any) => `${context.dataset.label}: ${context.parsed.y}`,
                                                }
                                            },
                                        },
                                        scales: {
                                            y: {
                                                beginAtZero: true,
                                                ticks: {
                                                    stepSize: 1,
                                                },
                                            },
                                        },
                                    }}
                                />
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Distribuição por Cargo */}
                        {estatisticas.distribuicao_cargo && estatisticas.distribuicao_cargo.length > 0 && (
                            <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md border border-gray-200 dark:border-gray-700">
                                <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white flex items-center gap-2">
                                    <span>📊</span> Distribuição por Cargo
                                </h3>
                                <div className="h-80">
                                    <Bar
                                        data={{
                                            labels: estatisticas.distribuicao_cargo.map(c => c.cargo),
                                            datasets: [
                                                {
                                                    label: "Quantidade",
                                                    data: estatisticas.distribuicao_cargo.map(c => c.quantidade),
                                                    backgroundColor: "rgba(147, 51, 234, 0.7)",
                                                    borderColor: "rgb(147, 51, 234)",
                                                    borderWidth: 2,
                                                },
                                            ],
                                        }}
                                        options={{
                                            responsive: true,
                                            maintainAspectRatio: false,
                                            plugins: {
                                                legend: { display: false },
                                            },
                                            scales: {
                                                y: {
                                                    beginAtZero: true,
                                                    ticks: {
                                                        stepSize: 1,
                                                    },
                                                },
                                            },
                                        }}
                                    />
                                </div>
                            </div>
                        )}

                        {/* Distribuição por Nível de Acesso */}
                        {estatisticas.distribuicao_nivel_acesso && estatisticas.distribuicao_nivel_acesso.length > 0 && (
                            <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md border border-gray-200 dark:border-gray-700">
                                <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white flex items-center gap-2">
                                    <span>🔐</span> Distribuição por Nível de Acesso
                                </h3>
                                <div className="h-80 flex items-center justify-center">
                                    <Doughnut
                                        data={{
                                            labels: estatisticas.distribuicao_nivel_acesso.map(n => n.nivel),
                                            datasets: [
                                                {
                                                    data: estatisticas.distribuicao_nivel_acesso.map(n => n.quantidade),
                                                    backgroundColor: [
                                                        "rgba(147, 51, 234, 0.7)",
                                                        "rgba(59, 130, 246, 0.7)",
                                                        "rgba(34, 197, 94, 0.7)",
                                                        "rgba(251, 146, 60, 0.7)",
                                                    ],
                                                    borderColor: [
                                                        "rgb(147, 51, 234)",
                                                        "rgb(59, 130, 246)",
                                                        "rgb(34, 197, 94)",
                                                        "rgb(251, 146, 60)",
                                                    ],
                                                    borderWidth: 2,
                                                },
                                            ],
                                        }}
                                        options={{
                                            responsive: true,
                                            maintainAspectRatio: false,
                                            plugins: {
                                                legend: { position: 'bottom' },
                                                tooltip: {
                                                    callbacks: {
                                                        label: (context: any) => {
                                                            const label = context.label || '';
                                                            const value = context.parsed || 0;
                                                            const total = context.dataset.data.reduce((a: number, b: number) => a + b, 0);
                                                            const percentage = ((value / total) * 100).toFixed(1);
                                                            return `${label}: ${value} (${percentage}%)`;
                                                        }
                                                    }
                                                },
                                            },
                                        }}
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Top Vendedores */}
                    {estatisticas.top_vendedores && estatisticas.top_vendedores.length > 0 && (
                        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md border border-gray-200 dark:border-gray-700">
                            <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white flex items-center gap-2">
                                <Award className="w-5 h-5 text-yellow-500" />
                                Top 5 Vendedores
                            </h3>
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead>
                                        <tr className="border-b border-gray-200 dark:border-gray-700">
                                            <th className="text-left py-3 px-4 text-sm font-semibold text-gray-900 dark:text-white">Posição</th>
                                            <th className="text-left py-3 px-4 text-sm font-semibold text-gray-900 dark:text-white">Nome</th>
                                            <th className="text-left py-3 px-4 text-sm font-semibold text-gray-900 dark:text-white">Cargo</th>
                                            <th className="text-right py-3 px-4 text-sm font-semibold text-gray-900 dark:text-white">Vendas</th>
                                            <th className="text-right py-3 px-4 text-sm font-semibold text-gray-900 dark:text-white">Valor Total</th>
                                            <th className="text-right py-3 px-4 text-sm font-semibold text-gray-900 dark:text-white">Ticket Médio</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {estatisticas.top_vendedores.map((vendedor, index) => (
                                            <tr key={vendedor.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                                                <td className="py-3 px-4">
                                                    <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full font-bold ${index === 0 ? 'bg-yellow-100 text-yellow-700' :
                                                        index === 1 ? 'bg-gray-100 text-gray-700' :
                                                            index === 2 ? 'bg-orange-100 text-orange-700' :
                                                                'bg-blue-100 text-blue-700'
                                                        }`}>
                                                        {index + 1}
                                                    </span>
                                                </td>
                                                <td className="py-3 px-4 text-sm text-gray-900 dark:text-white font-medium">{vendedor.nome}</td>
                                                <td className="py-3 px-4 text-sm text-gray-700 dark:text-gray-300">{vendedor.cargo}</td>
                                                <td className="py-3 px-4 text-sm text-gray-900 dark:text-white text-right font-semibold">{vendedor.total_vendas}</td>
                                                <td className="py-3 px-4 text-sm text-green-600 dark:text-green-400 text-right font-semibold">{formatCurrency(vendedor.valor_total_vendas)}</td>
                                                <td className="py-3 px-4 text-sm text-blue-600 dark:text-blue-400 text-right font-semibold">{formatCurrency(vendedor.ticket_medio)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Filtros */}
            <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 mb-6">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                        <Filter className="w-5 h-5" />
                        Filtros
                    </h3>
                    <button
                        onClick={limparFiltros}
                        className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
                    >
                        Limpar Filtros
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div>
                        <label className="block text-sm font-bold text-black dark:text-white mb-2">
                            Buscar
                        </label>
                        <input
                            type="text"
                            name="busca"
                            value={filtros.busca}
                            onChange={handleFiltroChange}
                            placeholder="Nome, CPF, usuário..."
                            className="w-full px-3 py-2 border-2 border-gray-400 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white text-black dark:bg-gray-700 dark:text-white placeholder-gray-500 font-medium"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2">
                            Cargo
                        </label>
                        <select
                            name="cargo"
                            value={filtros.cargo}
                            onChange={handleFiltroChange}
                            className="w-full px-3 py-2 border-2 border-gray-400 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white text-black dark:bg-gray-700 dark:text-white font-medium"
                        >
                            <option value="">Todos os cargos</option>
                            {CARGOS.map(cargo => (
                                <option key={cargo} value={cargo}>{cargo}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2">
                            Nível de Acesso
                        </label>
                        <select
                            name="nivel_acesso"
                            value={filtros.nivel_acesso}
                            onChange={handleFiltroChange}
                            className="w-full px-3 py-2 border-2 border-gray-400 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white text-black dark:bg-gray-700 dark:text-white font-medium"
                        >
                            <option value="">Todos os níveis</option>
                            {NIVEIS_ACESSO.map(nivel => (
                                <option key={nivel.value} value={nivel.value}>{nivel.label}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2">
                            Status
                        </label>
                        <select
                            name="ativos"
                            value={filtros.ativos}
                            onChange={handleFiltroChange}
                            className="w-full px-3 py-2 border-2 border-gray-400 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white text-black dark:bg-gray-700 dark:text-white font-medium"
                        >
                            <option value="true">Ativos</option>
                            <option value="false">Inativos</option>
                            <option value="">Todos</option>
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2">
                            Data Admissão (Início)
                        </label>
                        <input
                            type="date"
                            name="data_admissao_inicio"
                            value={filtros.data_admissao_inicio}
                            onChange={handleFiltroChange}
                            className="w-full px-3 py-2 border-2 border-gray-400 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white text-black dark:bg-gray-700 dark:text-white font-medium shadow-sm"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2">
                            Data Admissão (Fim)
                        </label>
                        <input
                            type="date"
                            name="data_admissao_fim"
                            value={filtros.data_admissao_fim}
                            onChange={handleFiltroChange}
                            className="w-full px-3 py-2 border-2 border-gray-400 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white text-black dark:bg-gray-700 dark:text-white font-medium shadow-sm"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2">
                            Salário Mínimo
                        </label>
                        <input
                            type="number"
                            name="salario_min"
                            value={filtros.salario_min}
                            onChange={handleFiltroChange}
                            placeholder="R$ 0,00"
                            className="w-full px-3 py-2 border-2 border-gray-400 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white text-black dark:bg-gray-700 dark:text-white font-medium shadow-sm"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2">
                            Salário Máximo
                        </label>
                        <input
                            type="number"
                            name="salario_max"
                            value={filtros.salario_max}
                            onChange={handleFiltroChange}
                            placeholder="R$ 0,00"
                            className="w-full px-3 py-2 border-2 border-gray-400 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white text-black dark:bg-gray-700 dark:text-white font-medium shadow-sm"
                        />
                    </div>
                </div>
            </div>

            {/* Tabela de Funcionários */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="overflow-x-auto">
                    {loading ? (
                        <div className="p-12 text-center">
                            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mb-4"></div>
                            <p className="text-gray-700 dark:text-gray-300">Carregando funcionários...</p>
                        </div>
                    ) : erro ? (
                        <div className="p-12 text-center">
                            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
                            <p className="text-red-600 dark:text-red-400">{erro}</p>
                        </div>
                    ) : funcionarios.length === 0 ? (
                        <div className="p-12 text-center">
                            <UserX className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                            <p className="text-gray-700 dark:text-gray-300">Nenhum funcionário encontrado</p>
                        </div>
                    ) : (
                        <>
                            {/* Mobile Cards View */}
                            <div className="lg:hidden flex flex-col divide-y divide-gray-200 dark:divide-gray-700">
                                {funcionarios.map((funcionario) => (
                                    <div key={funcionario.id} className="p-4 flex flex-col gap-3">
                                        <div className="flex justify-between items-start">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                                                    <UserCog className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                                                </div>
                                                <div>
                                                    <div className="font-bold text-gray-900 dark:text-white">{funcionario.nome}</div>
                                                    <div className="text-xs text-gray-500">{funcionario.usuario} • {formatCPF(funcionario.cpf)}</div>
                                                </div>
                                            </div>
                                            {funcionario.ativo ? (
                                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                                                    Ativo
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                                                    Inativo
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                                                {funcionario.cargo}
                                            </span>
                                            {funcionario.salario && (
                                                <span className="text-[10px] bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-1.5 py-0.5 rounded-full">
                                                    {formatCurrency(funcionario.salario)}
                                                </span>
                                            )}
                                            <span className="text-[10px] bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-1.5 py-0.5 rounded-full">
                                                Adm: {formatDate(funcionario.data_admissao)}
                                            </span>
                                        </div>
                                        <div className="flex justify-end gap-2 mt-2 pt-3 border-t border-gray-100 dark:border-gray-800">
                                            <button
                                                onClick={() => abrirDetalhes(funcionario)}
                                                className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400 rounded-lg text-xs font-semibold hover:bg-blue-100 transition-colors"
                                            >
                                                <Eye className="w-3.5 h-3.5" /> Detalhes
                                            </button>
                                            <button
                                                onClick={() => abrirModalEdicao(funcionario)}
                                                className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400 rounded-lg text-xs font-semibold hover:bg-green-100 transition-colors"
                                            >
                                                <Edit2 className="w-3.5 h-3.5" /> Editar
                                            </button>
                                            {funcionario.ativo && (
                                                <button
                                                    onClick={() => excluirFuncionario(funcionario.id)}
                                                    className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400 rounded-lg text-xs font-semibold hover:bg-red-100 transition-colors"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" /> Desativar
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Desktop Table View */}
                            <div className="hidden lg:block overflow-x-auto">
                                <table className="w-full">
                                    <thead className="bg-gray-200 dark:bg-gray-700 border-b-2 border-gray-400">
                                        <tr>
                                            <th className="text-left py-4 px-6 text-sm font-black text-black dark:text-white uppercase tracking-tight">Nome</th>
                                            <th className="text-left py-4 px-6 text-sm font-black text-black dark:text-white uppercase tracking-tight">CPF</th>
                                            <th className="text-left py-4 px-6 text-sm font-black text-black dark:text-white uppercase tracking-tight">Cargo</th>
                                            <th className="text-left py-4 px-6 text-sm font-black text-black dark:text-white uppercase tracking-tight">Salário</th>
                                            <th className="text-left py-4 px-6 text-sm font-black text-black dark:text-white uppercase tracking-tight">Admissão</th>
                                            <th className="text-left py-4 px-6 text-sm font-black text-black dark:text-white uppercase tracking-tight">Status</th>
                                            <th className="text-center py-4 px-6 text-sm font-black text-black dark:text-white uppercase tracking-tight">Ações</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                        {funcionarios.map((funcionario) => (
                                            <tr key={funcionario.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                                                <td className="py-4 px-6">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-10 h-10 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                                                            <UserCog className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                                                        </div>
                                                        <div>
                                                            <div className="font-medium text-black dark:text-white font-black">{funcionario.nome}</div>
                                                            <div className="text-xs text-gray-800 dark:text-gray-200">{funcionario.usuario}</div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="py-4 px-6 text-sm text-black dark:text-gray-100 font-black">{formatCPF(funcionario.cpf)}</td>
                                                <td className="py-4 px-6">
                                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                                                        {funcionario.cargo}
                                                    </span>
                                                </td>
                                                <td className="py-4 px-6 text-sm font-semibold text-black dark:text-white font-black">
                                                    {funcionario.salario ? formatCurrency(funcionario.salario) : "-"}
                                                </td>
                                                <td className="py-4 px-6 text-sm text-black dark:text-gray-100 font-black">{formatDate(funcionario.data_admissao)}</td>
                                                <td className="py-4 px-6">
                                                    {funcionario.ativo ? (
                                                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                                                            <UserCheck className="w-3 h-3" />
                                                            Ativo
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                                                            <UserX className="w-3 h-3" />
                                                            Inativo
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="py-4 px-6">
                                                    <div className="flex items-center justify-center gap-2">
                                                        <button
                                                            onClick={() => abrirDetalhes(funcionario)}
                                                            className="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
                                                            title="Ver detalhes"
                                                        >
                                                            <Eye className="w-4 h-4" />
                                                        </button>
                                                        <button
                                                            onClick={() => abrirModalEdicao(funcionario)}
                                                            className="p-2 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30 rounded-lg transition-colors"
                                                            title="Editar"
                                                        >
                                                            <Edit2 className="w-4 h-4" />
                                                        </button>
                                                        {funcionario.ativo && (
                                                            <button
                                                                onClick={() => excluirFuncionario(funcionario.id)}
                                                                className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                                                                title="Desativar"
                                                            >
                                                                <Trash2 className="w-4 h-4" />
                                                            </button>
                                                        )}
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
            </div>

            {/* Modal Criar/Editar Funcionário */}
            {modalAberto && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-100 p-4 overflow-y-auto" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))', paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}>
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-4xl w-full max-h-[90dvh] overflow-y-auto my-auto">
                        <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between">
                            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                                {modoEdicao ? "Editar Funcionário" : "Novo Funcionário"}
                            </h2>
                            <button
                                onClick={() => setModalAberto(false)}
                                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                            >
                                <X className="w-6 h-6 text-gray-700 dark:text-gray-300" />
                            </button>
                        </div>

                        <div className="p-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2">
                                        Nome Completo *
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.nome}
                                        onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white text-gray-900 dark:bg-gray-700 dark:text-white"
                                        required
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2">
                                        CPF *
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.cpf}
                                        onChange={(e) => setFormData({ ...formData, cpf: formatCpf(e.target.value) })}
                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white text-gray-900 dark:bg-gray-700 dark:text-white"
                                        placeholder="000.000.000-00"
                                        maxLength={14}
                                        required
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2">
                                        RG
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.rg}
                                        onChange={(e) => setFormData({ ...formData, rg: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white text-gray-900 dark:bg-gray-700 dark:text-white"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2">
                                        Data de Nascimento
                                    </label>
                                    <input
                                        type="date"
                                        value={formData.data_nascimento}
                                        onChange={(e) => setFormData({ ...formData, data_nascimento: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white text-gray-900 dark:bg-gray-700 dark:text-white"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2">
                                        Telefone
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.telefone}
                                        onChange={(e) => setFormData({ ...formData, telefone: formatPhone(e.target.value) })}
                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white text-gray-900 dark:bg-gray-700 dark:text-white"
                                        placeholder="(00) 00000-0000"
                                        maxLength={15}
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2">
                                        Celular *
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.celular}
                                        onChange={(e) => setFormData({ ...formData, celular: formatPhone(e.target.value) })}
                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white text-gray-900 dark:bg-gray-700 dark:text-white"
                                        placeholder="(00) 00000-0000"
                                        maxLength={15}
                                        required
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2">
                                        Email *
                                    </label>
                                    <input
                                        type="email"
                                        value={formData.email}
                                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white text-gray-900 dark:bg-gray-700 dark:text-white"
                                        required
                                    />
                                </div>

                                <div className="col-span-1 md:col-span-2 mt-4 mb-2">
                                    <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700 pb-1">
                                        Endereço
                                    </h4>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2">
                                        CEP
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.cep}
                                        onChange={(e) => setFormData({ ...formData, cep: formatCep(e.target.value) })}
                                        onBlur={handleCepBlur}
                                        placeholder="00000-000"
                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 dark:bg-gray-700 dark:text-white disabled:opacity-50"
                                        maxLength={9}
                                        disabled={loadingCep}
                                    />
                                    {loadingCep && (
                                        <p className="text-xs text-blue-500 mt-1">Buscando endereço...</p>
                                    )}
                                </div>

                                <div className="col-span-1 md:col-span-2">
                                    <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2">
                                        Logradouro
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.logradouro}
                                        onChange={(e) => setFormData({ ...formData, logradouro: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white text-gray-900 dark:bg-gray-700 dark:text-white"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2">
                                        Número
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.numero}
                                        onChange={(e) => setFormData({ ...formData, numero: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white text-gray-900 dark:bg-gray-700 dark:text-white"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2">
                                        Complemento
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.complemento}
                                        onChange={(e) => setFormData({ ...formData, complemento: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white text-gray-900 dark:bg-gray-700 dark:text-white"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2">
                                        Bairro
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.bairro}
                                        onChange={(e) => setFormData({ ...formData, bairro: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white text-gray-900 dark:bg-gray-700 dark:text-white"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2">
                                        Cidade
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.cidade}
                                        onChange={(e) => setFormData({ ...formData, cidade: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white text-gray-900 dark:bg-gray-700 dark:text-white"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2">
                                        Estado (UF)
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.estado}
                                        onChange={(e) => setFormData({ ...formData, estado: e.target.value.toUpperCase().slice(0, 2) })}
                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white text-gray-900 dark:bg-gray-700 dark:text-white"
                                        maxLength={2}
                                    />
                                </div>

                                <div className="col-span-1 md:col-span-2 mt-4 mb-2">
                                    <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700 pb-1">
                                        Dados Contratuais
                                    </h4>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2">
                                        Cargo *
                                    </label>
                                    <select
                                        value={formData.cargo}
                                        onChange={(e) => setFormData({ ...formData, cargo: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white text-gray-900 dark:bg-gray-700 dark:text-white"
                                        required
                                    >
                                        {CARGOS.map(cargo => (
                                            <option key={cargo} value={cargo}>{cargo}</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2">
                                        Salário *
                                    </label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        value={formData.salario}
                                        onChange={(e) => setFormData({ ...formData, salario: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white text-gray-900 dark:bg-gray-700 dark:text-white"
                                        required
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2">
                                        Data de Admissão *
                                    </label>
                                    <input
                                        type="date"
                                        value={formData.data_admissao}
                                        onChange={(e) => setFormData({ ...formData, data_admissao: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white text-gray-900 dark:bg-gray-700 dark:text-white"
                                        required
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2">
                                        Usuário *
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.usuario}
                                        onChange={(e) => setFormData({ ...formData, usuario: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white text-gray-900 dark:bg-gray-700 dark:text-white"
                                        required
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2">
                                        Senha {modoEdicao && "(deixe em branco para manter)"}
                                    </label>
                                    <input
                                        type="password"
                                        value={formData.senha}
                                        onChange={(e) => setFormData({ ...formData, senha: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white text-gray-900 dark:bg-gray-700 dark:text-white"
                                        required={!modoEdicao}
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2">
                                        PIN Estorno {modoEdicao && (funcionarioSelecionado?.tem_pin ? "(deixe em branco p/ manter)" : "(opcional)")}
                                    </label>
                                    <input
                                        type="password"
                                        inputMode="numeric"
                                        autoComplete="new-password"
                                        value={formData.pin_cancelamento}
                                        onChange={(e) => setFormData({ ...formData, pin_cancelamento: e.target.value.replace(/\D/g, "").slice(0, 6) })}
                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white text-gray-900 dark:bg-gray-700 dark:text-white"
                                        maxLength={6}
                                        placeholder="Numérico (4 a 6 dígitos)"
                                    />
                                    {formData.pin_cancelamento && formData.pin_cancelamento.length < 4 && (
                                        <p className="mt-1 text-xs text-red-500">O PIN deve ter de 4 a 6 dígitos.</p>
                                    )}
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2">
                                        Nível de Acesso *
                                    </label>
                                    <select
                                        value={formData.nivel_acesso}
                                        onChange={(e) => setFormData({ ...formData, nivel_acesso: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white text-gray-900 dark:bg-gray-700 dark:text-white"
                                        required
                                    >
                                        {NIVEIS_ACESSO.map(nivel => (
                                            <option key={nivel.value} value={nivel.value}>{nivel.label}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="flex items-center">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={formData.ativo}
                                            onChange={(e) => setFormData({ ...formData, ativo: e.target.checked })}
                                            className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                                        />
                                        <span className="text-sm font-medium text-gray-900 dark:text-white">
                                            Funcionário Ativo
                                        </span>
                                    </label>
                                </div>
                            </div>

                            <div className="flex justify-end gap-3 mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
                                <button
                                    onClick={() => setModalAberto(false)}
                                    className="px-6 py-2.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-medium"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={salvarFuncionario}
                                    className="px-6 py-2.5 bg-linear-to-r from-purple-500 to-purple-600 text-white rounded-lg hover:from-purple-600 hover:to-purple-700 transition-all shadow-lg font-medium"
                                >
                                    {modoEdicao ? "Atualizar" : "Criar"} Funcionário
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal Detalhes do Funcionário */}
            {modalDetalhesAberto && funcionarioSelecionado && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-100 p-4 overflow-y-auto" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))', paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}>
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-3xl w-full max-h-[90dvh] overflow-y-auto my-auto">
                        <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between">
                            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                                Detalhes do Funcionário
                            </h2>
                            <button
                                onClick={() => setModalDetalhesAberto(false)}
                                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                            >
                                <X className="w-6 h-6 text-gray-700 dark:text-gray-300" />
                            </button>
                        </div>

                        <div className="p-6">
                            <div className="space-y-6">
                                {/* Informações Pessoais */}
                                <div>
                                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                                        <UserCog className="w-5 h-5" />
                                        Informações Pessoais
                                    </h3>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <p className="text-sm text-gray-700 dark:text-gray-300">Nome</p>
                                            <p className="font-medium text-gray-900 dark:text-white">{funcionarioSelecionado.nome}</p>
                                        </div>
                                        <div>
                                            <p className="text-sm text-gray-700 dark:text-gray-300">CPF</p>
                                            <p className="font-medium text-gray-900 dark:text-white">{formatCPF(funcionarioSelecionado.cpf)}</p>
                                        </div>
                                        <div>
                                            <p className="text-sm text-gray-700 dark:text-gray-300">RG</p>
                                            <p className="font-medium text-gray-900 dark:text-white">{funcionarioSelecionado.rg || "-"}</p>
                                        </div>
                                        <div>
                                            <p className="text-sm text-gray-700 dark:text-gray-300">Data de Nascimento</p>
                                            <p className="font-medium text-gray-900 dark:text-white">{funcionarioSelecionado.data_nascimento ? formatDate(funcionarioSelecionado.data_nascimento) : "-"}</p>
                                        </div>
                                    </div>
                                </div>

                                {/* Contato */}
                                <div>
                                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Contato</h3>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <p className="text-sm text-gray-700 dark:text-gray-300">Telefone</p>
                                            <p className="font-medium text-gray-900 dark:text-white">{funcionarioSelecionado.telefone}</p>
                                        </div>
                                        <div>
                                            <p className="text-sm text-gray-700 dark:text-gray-300">Celular</p>
                                            <p className="font-medium text-gray-900 dark:text-white">{funcionarioSelecionado.celular || "-"}</p>
                                        </div>
                                        <div className="col-span-2">
                                            <p className="text-sm text-gray-700 dark:text-gray-300">Email</p>
                                            <p className="font-medium text-gray-900 dark:text-white">{funcionarioSelecionado.email}</p>
                                        </div>
                                    </div>
                                </div>

                                {/* Endereço */}
                                <div>
                                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Endereço</h3>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="col-span-2">
                                            <p className="text-sm text-gray-700 dark:text-gray-300">Logradouro</p>
                                            <p className="font-medium text-gray-900 dark:text-white">
                                                {funcionarioSelecionado.logradouro ? `${funcionarioSelecionado.logradouro}, ${funcionarioSelecionado.numero || 'S/N'}` : "-"}
                                                {funcionarioSelecionado.complemento ? ` - ${funcionarioSelecionado.complemento}` : ""}
                                            </p>
                                        </div>
                                        <div>
                                            <p className="text-sm text-gray-700 dark:text-gray-300">Bairro</p>
                                            <p className="font-medium text-gray-900 dark:text-white">{funcionarioSelecionado.bairro || "-"}</p>
                                        </div>
                                        <div>
                                            <p className="text-sm text-gray-700 dark:text-gray-300">CEP</p>
                                            <p className="font-medium text-gray-900 dark:text-white">{funcionarioSelecionado.cep || "-"}</p>
                                        </div>
                                        <div>
                                            <p className="text-sm text-gray-700 dark:text-gray-300">Cidade/UF</p>
                                            <p className="font-medium text-gray-900 dark:text-white">
                                                {funcionarioSelecionado.cidade ? `${funcionarioSelecionado.cidade}/${funcionarioSelecionado.estado}` : "-"}
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                {/* Informações Profissionais */}
                                <div>
                                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Informações Profissionais</h3>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <p className="text-sm text-gray-700 dark:text-gray-300">Cargo</p>
                                            <p className="font-medium text-gray-900 dark:text-white">{funcionarioSelecionado.cargo}</p>
                                        </div>
                                        <div>
                                            <p className="text-sm text-gray-700 dark:text-gray-300">Salário</p>
                                            <p className="font-medium text-gray-900 dark:text-white">
                                                {funcionarioSelecionado.salario ? formatCurrency(funcionarioSelecionado.salario) : "-"}
                                            </p>
                                        </div>
                                        <div>
                                            <p className="text-sm text-gray-700 dark:text-gray-300">Data de Admissão</p>
                                            <p className="font-medium text-gray-900 dark:text-white">{formatDate(funcionarioSelecionado.data_admissao)}</p>
                                        </div>
                                        <div>
                                            <p className="text-sm text-gray-700 dark:text-gray-300">Status</p>
                                            <p className="font-medium text-gray-900 dark:text-white">
                                                {funcionarioSelecionado.ativo ? (
                                                    <span className="text-green-600 dark:text-green-400">Ativo</span>
                                                ) : (
                                                    <span className="text-red-600 dark:text-red-400">Inativo</span>
                                                )}
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                {/* Acesso ao Sistema */}
                                <div>
                                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Acesso ao Sistema</h3>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <p className="text-sm text-gray-700 dark:text-gray-300">Usuário</p>
                                            <p className="font-medium text-gray-900 dark:text-white">{funcionarioSelecionado.usuario}</p>
                                        </div>
                                        <div>
                                            <p className="text-sm text-gray-700 dark:text-gray-300">Nível de Acesso</p>
                                            <p className="font-medium text-gray-900 dark:text-white capitalize">{funcionarioSelecionado.nivel_acesso}</p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="flex justify-end gap-3 mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
                                <button
                                    onClick={() => setModalDetalhesAberto(false)}
                                    className="px-6 py-2.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-medium"
                                >
                                    Fechar
                                </button>
                                <button
                                    onClick={() => {
                                        setModalDetalhesAberto(false);
                                        abrirModalEdicao(funcionarioSelecionado);
                                    }}
                                    className="px-6 py-2.5 bg-linear-to-r from-purple-500 to-purple-600 text-white rounded-lg hover:from-purple-600 hover:to-purple-700 transition-all shadow-lg font-medium"
                                >
                                    Editar
                                </button>
                            </div>
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
