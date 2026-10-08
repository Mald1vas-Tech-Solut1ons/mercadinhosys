import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Truck, Plus, Search, Edit, Trash2, Phone, Mail, MapPin, Package, TrendingUp, AlertCircle, ChevronDown, FileSpreadsheet, FileText, ShoppingCart, MessageCircle, FileBarChart } from 'lucide-react';
import { Fornecedor } from '../../types';
import { apiClient } from '../../api/apiClient';
import { showToast } from '../../utils/toast';
import PurchaseOrderModal from '../products/components/PurchaseOrderModal';
import SupplierHistoryModal from './components/SupplierHistoryModal';
import { SupplierIntelligenceModal } from './components/SupplierIntelligenceModal';
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { buscarCep, formatCep, formatPhone } from '../../utils/cepUtils';
import PageContainer from '../../components/layout/PageContainer';
import PageHeader from '../../components/layout/PageHeader';
import PinDialog from '../../components/modals/PinDialog';
import { InsightCard as ConsultorInsightCard } from '../../components/consultor/InsightCard';

// Tipos atualizados - todas as propriedades do Fornecedor estão disponíveis

interface SupplierFormData {
    nome: string;
    cnpj: string;
    telefone: string;
    email: string;
    endereco: string;
    cidade: string;
    estado: string;
    cep: string;
    contato_principal: string;
    contato_comercial: string;
    celular_comercial: string;
    observacoes: string;
    ativo: boolean;
}

const SuppliersPage: React.FC = () => {
    const navigate = useNavigate();
    const [suppliers, setSuppliers] = useState<Fornecedor[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingCep, setLoadingCep] = useState(false);
    const [showModal, setShowModal] = useState(false);
    const [editMode, setEditMode] = useState(false);
    const [selectedSupplier, setSelectedSupplier] = useState<Fornecedor | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all');
    const [filterProdutos, setFilterProdutos] = useState<'all' | 'com' | 'sem'>('all');
    const [exportando, setExportando] = useState(false);
    const [showExportMenu, setShowExportMenu] = useState(false);
    const [showProdutosModal, setShowProdutosModal] = useState(false);
    const [produtosFornecedor, setProdutosFornecedor] = useState<any[]>([]);
    const [fornecedorSelecionado, setFornecedorSelecionado] = useState<Fornecedor | null>(null);
    const [loadingProdutos, setLoadingProdutos] = useState(false);
    const [showPurchaseOrderModal, setShowPurchaseOrderModal] = useState(false);
    const [selectedForPedido, setSelectedForPedido] = useState<number | null>(null);

    const [showDossieModal, setShowDossieModal] = useState(false);
    const [selectedForDossie, setSelectedForDossie] = useState<Fornecedor | null>(null);

    const [showIntelligenceModal, setShowIntelligenceModal] = useState(false);
    const [selectedForIntelligence, setSelectedForIntelligence] = useState<Fornecedor | null>(null);

    const [formData, setFormData] = useState<SupplierFormData>({
        nome: '',
        cnpj: '',
        telefone: '',
        email: '',
        endereco: '',
        cidade: '',
        estado: '',
        cep: '',
        contato_principal: '',
        contato_comercial: '',
        celular_comercial: '',
        observacoes: '',
        ativo: true,
    });

    // Gate de PIN para operações sensíveis
    const [pinAction, setPinAction] = useState<{ run: () => void; title: string; description: string } | null>(null);
    const requirePin = (run: () => void, title: string, description: string) =>
        setPinAction({ run, title, description });

    // Calcular estatísticas
    const stats = useMemo(() => {
        const total = suppliers.length;
        const ativos = suppliers.filter(s => s.ativo).length;
        const inativos = total - ativos;

        const por_estado: { [key: string]: number } = {};
        suppliers.forEach(s => {
            if (s.estado) {
                por_estado[s.estado] = (por_estado[s.estado] || 0) + 1;
            }
        });

        const com_produtos = suppliers.filter(s => (s.total_produtos || 0) > 0).length;
        const sem_produtos = total - com_produtos;

        // Top fornecedor por valor total comprado
        const topFornecedor = suppliers.reduce((max, s) =>
            (s.valor_total_comprado || 0) > (max.valor_total_comprado || 0) ? s : max
            , suppliers[0] || null);

        const totalProdutos = suppliers.reduce((sum, s) => sum + (s.total_produtos || 0), 0);

        return {
            total,
            ativos,
            inativos,
            por_estado,
            com_produtos,
            sem_produtos,
            topFornecedor,
            totalProdutos,
        };
    }, [suppliers]);

    const loadSuppliers = useCallback(async () => {
        try {
            setLoading(true);
            const response = await apiClient.get<{ fornecedores: Fornecedor[], success: boolean }>('/fornecedores/', {
                params: { por_pagina: 100 },
            });

            const fornecedoresFormatados = (response.data.fornecedores || []).map(f => ({
                ...f,
                nome: f.nome_fantasia || f.razao_social || (f as any).nome || '',
                total_produtos: (f as any).produtos_ativos || f.total_produtos || 0,
            }));

            setSuppliers(fornecedoresFormatados);
        } catch (error) {
            console.error('Erro ao carregar fornecedores:', error);
            showToast.error('Erro ao carregar fornecedores. Verifique sua conexão.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadSuppliers();
    }, [loadSuppliers]);

    const handleCepBlur = async () => {
        setLoadingCep(true);
        const dados = await buscarCep(formData.cep);
        setLoadingCep(false);
        if (dados) {
            setFormData(prev => ({
                ...prev,
                endereco: dados.logradouro,
                cidade: dados.localidade,
                estado: dados.uf
            }));
        }
    };

    const resetForm = () => {
        setFormData({
            nome: '',
            cnpj: '',
            telefone: '',
            email: '',
            endereco: '',
            cidade: '',
            estado: '',
            cep: '',
            contato_principal: '',
            contato_comercial: '',
            celular_comercial: '',
            observacoes: '',
            ativo: true,
        });
        setEditMode(false);
        setSelectedSupplier(null);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        try {
            // Mapear dados do frontend para o formato do backend
            const dadosBackend = {
                nome_fantasia: formData.nome,
                razao_social: formData.nome, // Usar o mesmo nome se não tiver razão social separada
                cnpj: formData.cnpj,
                telefone: formData.telefone,
                email: formData.email,
                contato_nome: formData.contato_principal,
                contato_telefone: formData.celular_comercial,
                prazo_entrega: 7,
                forma_pagamento: '30 DIAS',
                classificacao: 'REGULAR',
                cep: formData.cep,
                logradouro: formData.endereco,
                numero: '0',
                complemento: '',
                bairro: formData.cidade,
                cidade: formData.cidade,
                estado: formData.estado,
                pais: 'Brasil',
                ativo: formData.ativo,
            };

            const promise = editMode && selectedSupplier
                ? apiClient.put(`/fornecedores/${selectedSupplier.id}`, dadosBackend)
                : apiClient.post('/fornecedores', dadosBackend);

            await showToast.promise(promise, {
                loading: editMode ? 'Atualizando fornecedor...' : 'Cadastrando fornecedor...',
                success: editMode ? 'Fornecedor atualizado com sucesso!' : 'Fornecedor cadastrado com sucesso!',
                error: (err: any) => err.response?.data?.error || err.response?.data?.message || 'Erro ao salvar fornecedor',
            });

            setShowModal(false);
            resetForm();
            loadSuppliers();
        } catch (error: unknown) {
            console.error('Erro ao salvar fornecedor:', error);
            const apiError = error as { response?: { data?: { error?: string; message?: string } } };
            showToast.error(apiError.response?.data?.error || apiError.response?.data?.message || 'Erro ao salvar fornecedor');
        }
    };

    const handleEdit = (supplier: Fornecedor) => {
        setSelectedSupplier(supplier);
        setFormData({
            nome: supplier.nome_fantasia || supplier.razao_social || supplier.nome || '',
            cnpj: supplier.cnpj || '',
            telefone: supplier.telefone || '',
            email: supplier.email || '',
            endereco: supplier.logradouro || supplier.endereco || '',
            cidade: supplier.cidade || '',
            estado: supplier.estado || '',
            cep: supplier.cep || '',
            contato_principal: supplier.contato_nome || supplier.contato_principal || '',
            contato_comercial: supplier.contato_comercial || '',
            celular_comercial: supplier.contato_telefone || supplier.celular_comercial || '',
            observacoes: supplier.observacoes || '',
            ativo: supplier.ativo,
        });
        setEditMode(true);
        setShowModal(true);
    };

    const handleDelete = async (id: number, nome: string) => {
        requirePin(
            async () => {
                try {
                    // Usar PATCH para desativar ao invés de DELETE
                    await apiClient.patch(`/fornecedores/${id}/status`, { ativo: false });
                    showToast.success('Fornecedor desativado');
                    loadSuppliers();
                } catch (error: unknown) {
                    console.error('Erro ao desativar fornecedor:', error);
                    const apiError = error as { response?: { data?: { message?: string } } };
                    showToast.error(apiError.response?.data?.message || 'Erro ao desativar fornecedor');
                }
            },
            'Autorizar desativação',
            `Autorize com o PIN para desativar o fornecedor "${nome}".`
        );
    };

    const handleVerProdutos = async (fornecedor: Fornecedor) => {
        setFornecedorSelecionado(fornecedor);
        setShowProdutosModal(true);
        setLoadingProdutos(true);

        try {
            const response = await apiClient.get('/produtos/', {
                params: {
                    fornecedor_id: fornecedor.id,
                    por_pagina: 100,
                }
            });

            setProdutosFornecedor(response.data.produtos || []);
        } catch (error) {
            console.error('Erro ao carregar produtos:', error);
            showToast.error('Erro ao carregar produtos do fornecedor');
            setProdutosFornecedor([]);
        } finally {
            setLoadingProdutos(false);
        }
    };

    const filteredSuppliers = suppliers.filter(supplier => {
        const matchesSearch = supplier.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
            supplier.cnpj?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            supplier.cidade?.toLowerCase().includes(searchTerm.toLowerCase());

        const matchesStatus = filterStatus === 'all' ? true :
            filterStatus === 'active' ? supplier.ativo :
                !supplier.ativo;

        const matchesProdutos = filterProdutos === 'all' ? true :
            filterProdutos === 'com' ? (supplier.total_produtos || 0) > 0 :
                (supplier.total_produtos || 0) === 0;

        return matchesSearch && matchesStatus && matchesProdutos;
    });

    const handleCardClick = useCallback((type: string) => {
        // Filtros são visuais — sem toast para não poluir
        switch (type) {
            case 'all':
                setFilterStatus('all');
                setFilterProdutos('all');
                setSearchTerm('');
                break;
            case 'active':
                setFilterStatus('active');
                setFilterProdutos('all');
                setSearchTerm('');
                break;
            case 'inactive':
                setFilterStatus('inactive');
                setFilterProdutos('all');
                setSearchTerm('');
                break;
            case 'com_produtos':
                setFilterProdutos(filterProdutos === 'com' ? 'all' : 'com');
                setFilterStatus('all');
                setSearchTerm('');
                break;
            case 'sem_produtos':
                setFilterProdutos(filterProdutos === 'sem' ? 'all' : 'sem');
                setFilterStatus('all');
                setSearchTerm('');
                break;
        }
    }, [filterProdutos]);

    // Função para exportar para CSV
    const exportarCSV = useCallback(() => {
        setExportando(true);

        try {
            const headers = ['Nome', 'CNPJ', 'Telefone', 'Email', 'Cidade', 'Estado', 'Status', 'Produtos'];
            const rows = filteredSuppliers.map(s => [
                s.nome,
                s.cnpj || '',
                s.telefone || '',
                s.email || '',
                s.cidade || '',
                s.estado || '',
                s.ativo ? 'Ativo' : 'Inativo',
                s.total_produtos || 0
            ]);

            const csvContent = [
                headers.join(','),
                ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
            ].join('\n');

            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `fornecedores_${new Date().toISOString().split('T')[0]}.csv`;
            link.click();

            showToast.info('CSV exportado com sucesso');
            setShowExportMenu(false);
        } catch (error) {
            console.error('Erro ao exportar CSV:', error);
            showToast.error('Erro ao exportar CSV');
        } finally {
            setExportando(false);
        }
    }, [filteredSuppliers]);

    const exportarExcel = useCallback(() => {
        setExportando(true);
        try {
            const wsData = [
                ['Nome', 'CNPJ', 'Telefone', 'Email', 'Cidade', 'Estado', 'Status', 'Produtos'],
                ...filteredSuppliers.map(s => [
                    s.nome,
                    s.cnpj || '',
                    s.telefone || '',
                    s.email || '',
                    s.cidade || '',
                    s.estado || '',
                    s.ativo ? 'Ativo' : 'Inativo',
                    s.total_produtos || 0
                ])
            ];

            const ws = XLSX.utils.aoa_to_sheet(wsData);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Fornecedores");
            XLSX.writeFile(wb, `fornecedores_${new Date().toISOString().split('T')[0]}.xlsx`);

            showToast.success('Excel exportado com sucesso');
            setShowExportMenu(false);
        } catch (error) {
            console.error('Erro ao exportar Excel:', error);
            showToast.error('Erro ao exportar Excel');
        } finally {
            setExportando(false);
        }
    }, [filteredSuppliers]);

    const exportarPDF = useCallback(() => {
        setExportando(true);
        try {
            const doc = new jsPDF();

            // Cabeçalho
            doc.setFillColor(37, 99, 235); // Blue 600
            doc.rect(0, 0, 210, 40, 'F');

            doc.setTextColor(255, 255, 255);
            doc.setFontSize(22);
            doc.text("Relatório de Fornecedores", 105, 20, { align: "center" });

            doc.setFontSize(10);
            doc.text(`Gerado em: ${new Date().toLocaleDateString("pt-BR")} às ${new Date().toLocaleTimeString("pt-BR")}`, 105, 30, { align: "center" });

            // Tabela
            const headers = [['Nome', 'CNPJ', 'Telefone', 'Cidade', 'Status', 'Prods']];
            const data = filteredSuppliers.map(s => [
                s.nome,
                s.cnpj || '',
                s.telefone || '',
                s.cidade || '',
                s.ativo ? "Ativo" : "Inativo",
                (s.total_produtos || 0).toString()
            ]);

            autoTable(doc, {
                head: headers,
                body: data,
                startY: 50,
                theme: 'grid',
                styles: { fontSize: 8, cellPadding: 2 },
                headStyles: { fillColor: [37, 99, 235], textColor: [255, 255, 255] },
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

            doc.save(`fornecedores-${new Date().toISOString().split('T')[0]}.pdf`);

            showToast.success('PDF exportado com sucesso');
            setShowExportMenu(false);
        } catch (error) {
            console.error('Erro ao exportar PDF:', error);
            showToast.error('Erro ao exportar PDF');
        } finally {
            setExportando(false);
        }
    }, [filteredSuppliers]);

    return (
        <PageContainer>

            {/* Header (primitivo responsivo — empilha e vira full-width no mobile) */}
            <PageHeader
                title="Fornecedores"
                subtitle="Gerencie seus fornecedores e parcerias"
                actions={
                    <>
                        <div className="relative flex-1 sm:flex-none">
                            <button
                                onClick={() => setShowExportMenu(!showExportMenu)}
                                disabled={exportando || suppliers.length === 0}
                                className="w-full justify-center sm:w-auto px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {exportando ? (
                                    <>
                                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                                        <span>Exportando...</span>
                                    </>
                                ) : (
                                    <>
                                        <Package className="w-5 h-5" />
                                        <span>Exportar</span>
                                        <ChevronDown className="w-4 h-4 ml-1" />
                                    </>
                                )}
                            </button>

                            {showExportMenu && (
                                <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-xl z-50 border border-gray-100 dark:border-gray-700">
                                    <button
                                        onClick={exportarCSV}
                                        className="w-full px-4 py-3 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2 rounded-t-lg"
                                    >
                                        <FileText className="w-4 h-4 text-green-500" />
                                        CSV
                                    </button>
                                    <button
                                        onClick={exportarExcel}
                                        className="w-full px-4 py-3 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
                                    >
                                        <FileSpreadsheet className="w-4 h-4 text-green-600" />
                                        Excel
                                    </button>
                                    <button
                                        onClick={exportarPDF}
                                        className="w-full px-4 py-3 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2 rounded-b-lg"
                                    >
                                        <FileText className="w-4 h-4 text-red-500" />
                                        PDF
                                    </button>
                                </div>
                            )}
                        </div>
                        <button
                            onClick={() => {
                                resetForm();
                                setShowModal(true);
                            }}
                            className="justify-center px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 flex items-center gap-2 transition-colors whitespace-nowrap"
                        >
                            <Plus className="w-5 h-5" />
                            <span>Novo Fornecedor</span>
                        </button>
                    </>
                }
            />
            {filterStatus !== 'all' && (
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-sm">
                    <span>Filtro ativo: {filterStatus === 'active' ? 'Ativos' : 'Inativos'}</span>
                    <button
                        onClick={() => setFilterStatus('all')}
                        className="hover:bg-blue-200 dark:hover:bg-blue-800 rounded-full p-0.5"
                    >
                        ✕
                    </button>
                </div>
            )}

            <ConsultorInsightCard especialista="fornecedores" titulo="Consultor IA - Relação e Parcerias" className="mb-6 mt-4" />

            {/* Dashboard de Estatísticas */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                {/* Total de Fornecedores */}
                <div
                    onClick={() => handleCardClick('all')}
                    className={`bg-linear-to-br from-blue-500 to-blue-600 rounded-xl shadow-lg p-6 text-white cursor-pointer hover:shadow-2xl hover:scale-105 transition-all duration-200 ${filterStatus === 'all' ? 'ring-4 ring-blue-300 ring-offset-2' : ''
                        }`}
                >
                    <div className="flex items-center justify-between mb-2">
                        <Truck className="w-8 h-8 opacity-80" />
                        {filterStatus === 'all' && (
                            <span className="px-2 py-1 bg-white/20 rounded-full text-xs font-bold">
                                ✓ Ativo
                            </span>
                        )}
                    </div>
                    <p className="text-sm opacity-90 mb-1">Total Fornecedores</p>
                    <p className="text-3xl font-bold">{stats.total}</p>
                    <p className="text-xs opacity-75 mt-2">Clique para ver todos</p>
                </div>

                {/* Fornecedores Ativos */}
                <div
                    onClick={() => handleCardClick('active')}
                    className={`bg-linear-to-br from-green-500 to-green-600 rounded-xl shadow-lg p-6 text-white cursor-pointer hover:shadow-2xl hover:scale-105 transition-all duration-200 ${filterStatus === 'active' ? 'ring-4 ring-green-300 ring-offset-2' : ''
                        }`}
                >
                    <div className="flex items-center justify-between mb-2">
                        <TrendingUp className="w-8 h-8 opacity-80" />
                        {filterStatus === 'active' && (
                            <span className="px-2 py-1 bg-white/20 rounded-full text-xs font-bold">
                                ✓ Ativo
                            </span>
                        )}
                    </div>
                    <p className="text-sm opacity-90 mb-1">Fornecedores Ativos</p>
                    <p className="text-3xl font-bold">{stats.ativos}</p>
                    <p className="text-xs opacity-75 mt-2">
                        {((stats.ativos / stats.total) * 100).toFixed(0)}% do total
                    </p>
                </div>

                {/* Fornecedores Inativos */}
                <div
                    onClick={() => handleCardClick('inactive')}
                    className={`bg-linear-to-br from-red-500 to-red-600 rounded-xl shadow-lg p-6 text-white cursor-pointer hover:shadow-2xl hover:scale-105 transition-all duration-200 ${filterStatus === 'inactive' ? 'ring-4 ring-red-300 ring-offset-2' : ''
                        } ${stats.inativos > 0 ? 'animate-pulse' : ''}`}
                >
                    <div className="flex items-center justify-between mb-2">
                        <AlertCircle className="w-8 h-8 opacity-80" />
                        {filterStatus === 'inactive' && (
                            <span className="px-2 py-1 bg-white/20 rounded-full text-xs font-bold">
                                ✓ Ativo
                            </span>
                        )}
                    </div>
                    <p className="text-sm opacity-90 mb-1">Fornecedores Inativos</p>
                    <p className="text-3xl font-bold">{stats.inativos}</p>
                    <p className="text-xs opacity-75 mt-2">
                        {stats.inativos > 0 ? '⚠️ Requer atenção' : '✓ Tudo OK'}
                    </p>
                </div>

                {/* Fornecedores Com Produtos */}
                <div
                    onClick={() => handleCardClick('com_produtos')}
                    className={`bg-linear-to-br from-purple-500 to-purple-600 rounded-xl shadow-lg p-6 text-white cursor-pointer hover:shadow-2xl hover:scale-105 transition-all duration-200 ${filterProdutos === 'com' ? 'ring-4 ring-purple-300 ring-offset-2' : ''
                        }`}
                >
                    <div className="flex items-center justify-between mb-2">
                        <Package className="w-8 h-8 opacity-80" />
                        {filterProdutos === 'com' && (
                            <span className="px-2 py-1 bg-white/20 rounded-full text-xs font-bold">
                                ✓ Filtrado
                            </span>
                        )}
                    </div>
                    <p className="text-sm opacity-90 mb-1">Com Produtos Cadastrados</p>
                    <p className="text-3xl font-bold">{stats.com_produtos}</p>
                    <p className="text-xs opacity-75 mt-2 cursor-pointer hover:underline" onClick={(e) => {
                        e.stopPropagation();
                        handleCardClick('sem_produtos');
                    }}>
                        {stats.sem_produtos} sem produtos (clique aqui)
                    </p>
                </div>

                {/* Top Fornecedor */}
                <div
                    className="bg-linear-to-br from-yellow-500 to-orange-600 rounded-xl shadow-lg p-6 text-white"
                >
                    <div className="flex items-center justify-between mb-2">
                        <TrendingUp className="w-8 h-8 opacity-80" />
                        <span className="text-2xl">👑</span>
                    </div>
                    <p className="text-sm opacity-90 mb-1">Top Fornecedor</p>
                    {stats.topFornecedor ? (
                        <>
                            <p className="text-lg font-bold truncate">{stats.topFornecedor.nome}</p>
                            <p className="text-xs opacity-75 mt-2">
                                R$ {(stats.topFornecedor.valor_total_comprado || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </p>
                        </>
                    ) : (
                        <p className="text-sm opacity-75">Nenhuma compra ainda</p>
                    )}
                </div>
            </div>

            {/* Search */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Buscar por nome, CNPJ ou cidade..."
                        className="w-full pl-10 pr-4 py-2.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                </div>
            </div>

            {/* Grid de Fornecedores */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {loading ? (
                    <div className="col-span-full flex justify-center py-12">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
                    </div>
                ) : filteredSuppliers.length === 0 ? (
                    <div className="col-span-full text-center py-12">
                        <Truck className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                        <p className="text-gray-500 dark:text-gray-400 text-lg">
                            Nenhum fornecedor encontrado
                        </p>
                    </div>
                ) : (
                    filteredSuppliers.map((supplier) => (
                        <div
                            key={supplier.id}
                            className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 hover:shadow-2xl transition-all duration-200 border-2 border-transparent hover:border-blue-300"
                        >
                            <div className="flex items-start justify-between mb-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-12 h-12 bg-linear-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center">
                                        <Truck className="w-6 h-6 text-white" />
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-gray-900 dark:text-white">
                                            {supplier.nome}
                                        </h3>
                                        {supplier.cnpj && (
                                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                                {supplier.cnpj}
                                            </p>
                                        )}
                                    </div>
                                </div>
                                <span
                                    className={`px-2 py-1 text-xs rounded-full font-semibold ${supplier.ativo
                                        ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'
                                        : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'
                                        }`}
                                >
                                    {supplier.ativo ? '✓ Ativo' : '✕ Inativo'}
                                </span>
                            </div>

                            {/* Badge de Produtos e Compras */}
                            <div className="space-y-2 mb-3">
                                {supplier.total_produtos !== undefined && (
                                    <div
                                        onClick={() => handleVerProdutos(supplier)}
                                        className={`p-2 rounded-lg ${(supplier.total_produtos ?? 0) > 10
                                            ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
                                            : (supplier.total_produtos ?? 0) > 0
                                                ? 'bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800'
                                                : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
                                            } ${supplier.total_produtos > 0 ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}
                                    >
                                        <div className="flex items-center justify-between text-sm">
                                            <span className={`font-medium ${supplier.total_produtos > 10
                                                ? 'text-green-700 dark:text-green-300'
                                                : supplier.total_produtos > 0
                                                    ? 'text-yellow-700 dark:text-yellow-300'
                                                    : 'text-red-700 dark:text-red-300'
                                                }`}>
                                                📦 {supplier.total_produtos || 0} produtos
                                            </span>
                                            {supplier.total_produtos === 0 ? (
                                                <span className="text-xs text-red-600 dark:text-red-400">
                                                    ⚠️ Sem produtos
                                                </span>
                                            ) : (
                                                <span className="text-xs opacity-75">
                                                    👁️ Ver lista
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Informações de Compras */}
                                {supplier.valor_total_comprado !== undefined && supplier.valor_total_comprado > 0 && (
                                    <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                                        <div className="flex items-center justify-between text-sm">
                                            <span className="font-medium text-blue-700 dark:text-blue-300">
                                                💰 R$ {supplier.valor_total_comprado.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </span>
                                            <span className="text-xs text-blue-600 dark:text-blue-400">
                                                {supplier.total_compras || 0} compras
                                            </span>
                                        </div>
                                        {supplier.classificacao && (
                                            <div className="mt-1">
                                                <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${supplier.classificacao === 'PREMIUM' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300' :
                                                    supplier.classificacao === 'A' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300' :
                                                        supplier.classificacao === 'B' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300' :
                                                            'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                                                    }`}>
                                                    {supplier.classificacao === 'PREMIUM' ? '👑 ' : ''}Classe {supplier.classificacao}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            <div className="space-y-2 mb-4">
                                {supplier.telefone && (
                                    <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                                        <Phone className="w-4 h-4" />
                                        <span>{supplier.telefone}</span>
                                    </div>
                                )}
                                {supplier.email && (
                                    <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                                        <Mail className="w-4 h-4" />
                                        <span className="truncate">{supplier.email}</span>
                                    </div>
                                )}
                                {supplier.cidade && (
                                    <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                                        <MapPin className="w-4 h-4" />
                                        <span>{supplier.cidade} - {supplier.estado}</span>
                                    </div>
                                )}
                            </div>

                            <div className="flex flex-wrap gap-2 pt-4 border-t border-gray-200 dark:border-gray-700">
                                <button
                                    onClick={() => handleEdit(supplier)}
                                    className="flex-1 px-3 py-2 bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors flex items-center justify-center gap-2 font-medium text-sm"
                                >
                                    <Edit className="w-4 h-4" />
                                    Editar
                                </button>
                                <button
                                    onClick={() => {
                                        setSelectedForPedido(supplier.id);
                                        setShowPurchaseOrderModal(true);
                                    }}
                                    className="flex-1 px-3 py-2 bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-colors flex items-center justify-center gap-2 font-medium text-sm"
                                >
                                    <ShoppingCart className="w-4 h-4" />
                                    Fazer Pedido
                                </button>
                                <button
                                    onClick={() => {
                                        setSelectedForIntelligence(supplier);
                                        setShowIntelligenceModal(true);
                                    }}
                                    className="flex-1 px-3 py-2 bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors flex items-center justify-center gap-2 font-medium text-sm"
                                    title="Inteligência do Fornecedor"
                                >
                                    <TrendingUp className="w-4 h-4" />
                                    Métricas
                                </button>
                                <button
                                    onClick={() => {
                                        setSelectedForDossie(supplier);
                                        setShowDossieModal(true);
                                    }}
                                    className="flex-[0.5] px-3 py-2 bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400 rounded-lg hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors flex items-center justify-center gap-2 font-medium text-sm"
                                    title="Dossiê do Fornecedor"
                                >
                                    <FileBarChart className="w-4 h-4" />
                                </button>
                                {supplier.telefone && (
                                    <a
                                        href={`https://wa.me/55${supplier.telefone.replace(/\D/g, '')}?text=Olá%20${encodeURIComponent(supplier.nome)},%20falo%20da%20loja.%20Gostaria%20de%20falar%20sobre%20pedidos`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="px-3 py-2 bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400 rounded-lg hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors flex items-center justify-center"
                                        title="WhatsApp"
                                    >
                                        <MessageCircle className="w-4 h-4" />
                                    </a>
                                )}
                                {supplier.email && (
                                    <a
                                        href={`mailto:${supplier.email}`}
                                        className="px-3 py-2 bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400 rounded-lg hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors flex items-center justify-center"
                                        title="Enviar email"
                                    >
                                        <Mail className="w-4 h-4" />
                                    </a>
                                )}
                                <button
                                    onClick={() => handleDelete(supplier.id, supplier.nome)}
                                    className="flex-1 px-3 py-2 bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors flex items-center justify-center gap-2 font-medium text-sm"
                                >
                                    <Trash2 className="w-4 h-4" />
                                    Desativar
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Modal de Cadastro/Edição */}
            {showModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-100 p-4 overflow-y-auto" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))', paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}>
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-2xl w-full max-h-[90dvh] overflow-y-auto my-auto">
                        <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
                            <h2 className="text-2xl font-bold text-gray-800 dark:text-white">
                                {editMode ? 'Editar Fornecedor' : 'Novo Fornecedor'}
                            </h2>
                        </div>

                        <form onSubmit={handleSubmit} className="p-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                        Nome do Fornecedor *
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        value={formData.nome}
                                        onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                                        className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                        CNPJ
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.cnpj}
                                        onChange={(e) => setFormData({ ...formData, cnpj: e.target.value })}
                                        className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                        Telefone
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.telefone}
                                        onChange={(e) => setFormData({ ...formData, telefone: formatPhone(e.target.value) })}
                                        placeholder="(00) 00000-0000"
                                        className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>

                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                        E-mail
                                    </label>
                                    <input
                                        type="email"
                                        value={formData.email}
                                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                        className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>

                                {/* CEP - Primeiro para autocompletar endereço */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                        CEP {loadingCep && <span className="text-blue-500 text-xs">(carregando...)</span>}
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.cep}
                                        onChange={(e) => setFormData({ ...formData, cep: formatCep(e.target.value) })}
                                        onBlur={handleCepBlur}
                                        maxLength={9}
                                        placeholder="00000-000"
                                        className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>

                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                        Endereço
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.endereco}
                                        onChange={(e) => setFormData({ ...formData, endereco: e.target.value })}
                                        className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                        Cidade
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.cidade}
                                        onChange={(e) => setFormData({ ...formData, cidade: e.target.value })}
                                        className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                        Estado
                                    </label>
                                    <input
                                        type="text"
                                        maxLength={2}
                                        value={formData.estado}
                                        onChange={(e) => setFormData({ ...formData, estado: e.target.value.toUpperCase() })}
                                        className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                        Contato Principal
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.contato_principal}
                                        onChange={(e) => setFormData({ ...formData, contato_principal: e.target.value })}
                                        placeholder="Nome do responsável"
                                        className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                        Contato Comercial
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.contato_comercial}
                                        onChange={(e) => setFormData({ ...formData, contato_comercial: e.target.value })}
                                        placeholder="Nome do vendedor"
                                        className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                        Celular Comercial
                                    </label>
                                    <input
                                        type="tel"
                                        value={formData.celular_comercial}
                                        onChange={(e) => setFormData({ ...formData, celular_comercial: formatPhone(e.target.value) })}
                                        placeholder="(00) 00000-0000"
                                        className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>

                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                        Observações
                                    </label>
                                    <textarea
                                        rows={3}
                                        value={formData.observacoes}
                                        onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
                                        className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>

                                <div className="md:col-span-2">
                                    <label className="flex items-center space-x-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={formData.ativo}
                                            onChange={(e) => setFormData({ ...formData, ativo: e.target.checked })}
                                            className="w-5 h-5 text-blue-500 border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                                        />
                                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                            Fornecedor Ativo
                                        </span>
                                    </label>
                                </div>
                            </div>

                            <div className="mt-6 flex justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setShowModal(false);
                                        resetForm();
                                    }}
                                    className="px-6 py-2.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white text-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    className="px-6 py-2.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                                >
                                    {editMode ? 'Atualizar' : 'Cadastrar'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Modal de Produtos do Fornecedor */}
            {showProdutosModal && fornecedorSelecionado && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-100 p-4" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))', paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}>
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-4xl w-full max-h-[90dvh] overflow-hidden flex flex-col">
                        <div className="sticky top-0 bg-linear-to-r from-blue-500 to-blue-600 px-6 py-4 flex items-center justify-between">
                            <div>
                                <h2 className="text-2xl font-bold text-white">
                                    Produtos de {fornecedorSelecionado.nome}
                                </h2>
                                <p className="text-blue-100 text-sm mt-1">
                                    {produtosFornecedor.length} produtos cadastrados
                                </p>
                            </div>
                            <button
                                onClick={() => setShowProdutosModal(false)}
                                className="text-white hover:bg-white/20 rounded-lg p-2 transition-colors"
                            >
                                ✕
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6">
                            {loadingProdutos ? (
                                <div className="flex justify-center py-12">
                                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
                                </div>
                            ) : produtosFornecedor.length === 0 ? (
                                <div className="text-center py-12">
                                    <Package className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                                    <p className="text-gray-500 dark:text-gray-400 text-lg">
                                        Nenhum produto cadastrado para este fornecedor
                                    </p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {produtosFornecedor.map((produto) => (
                                        <div
                                            key={produto.id}
                                            onClick={() => {
                                                setShowProdutosModal(false);
                                                navigate(`/products/${produto.id}`);
                                            }}
                                            className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700 hover:shadow-md transition-shadow cursor-pointer hover:border-blue-300"
                                        >
                                            <div className="flex items-start justify-between mb-2">
                                                <div className="flex-1">
                                                    <h3 className="font-bold text-gray-900 dark:text-white">
                                                        {produto.nome}
                                                    </h3>
                                                    {produto.codigo_barras && (
                                                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                                            Cód: {produto.codigo_barras}
                                                        </p>
                                                    )}
                                                </div>
                                                <span
                                                    className={`px-2 py-1 text-xs rounded-full font-semibold ${produto.ativo
                                                        ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'
                                                        : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'
                                                        }`}
                                                >
                                                    {produto.ativo ? '✓' : '✕'}
                                                </span>
                                            </div>

                                            <div className="grid grid-cols-2 gap-2 mt-3 text-sm">
                                                <div>
                                                    <p className="text-gray-500 dark:text-gray-400 text-xs">Estoque</p>
                                                    <p className="font-bold text-gray-900 dark:text-white">
                                                        {produto.quantidade || 0} un
                                                    </p>
                                                </div>
                                                <div>
                                                    <p className="text-gray-500 dark:text-gray-400 text-xs">Preço Venda</p>
                                                    <p className="font-bold text-green-600 dark:text-green-400">
                                                        R$ {(produto.preco_venda || 0).toFixed(2)}
                                                    </p>
                                                </div>
                                                <div>
                                                    <p className="text-gray-500 dark:text-gray-400 text-xs">Preço Custo</p>
                                                    <p className="font-bold text-blue-600 dark:text-blue-400">
                                                        R$ {(produto.preco_custo || 0).toFixed(2)}
                                                    </p>
                                                </div>
                                                <div>
                                                    <p className="text-gray-500 dark:text-gray-400 text-xs">Margem</p>
                                                    <p className="font-bold text-purple-600 dark:text-purple-400">
                                                        {produto.preco_custo > 0
                                                            ? (((produto.preco_venda - produto.preco_custo) / produto.preco_custo) * 100).toFixed(1)
                                                            : 0}%
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] md:bottom-0 bg-gray-50 dark:bg-gray-700 px-6 py-4 border-t border-gray-200 dark:border-gray-600">
                            <button
                                onClick={() => setShowProdutosModal(false)}
                                className="w-full px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium"
                            >
                                Fechar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal de Pedido de Compra */}
            <PurchaseOrderModal
                isOpen={showPurchaseOrderModal}
                onClose={() => setShowPurchaseOrderModal(false)}
                onSuccess={() => {
                    loadSuppliers();
                }}
                fornecedores={suppliers}
                initialSupplierId={selectedForPedido || undefined}
            />

            {/* Dossiê do Fornecedor */}
            {showDossieModal && selectedForDossie && (
                <SupplierHistoryModal
                    fornecedor={selectedForDossie}
                    onClose={() => setShowDossieModal(false)}
                />
            )}

            {/* Inteligência de Fornecedores */}
            {selectedForIntelligence && (
                <SupplierIntelligenceModal
                    isOpen={showIntelligenceModal}
                    onClose={() => setShowIntelligenceModal(false)}
                    fornecedorId={selectedForIntelligence.id}
                    fornecedorNome={selectedForIntelligence.nome_fantasia || selectedForIntelligence.razao_social || selectedForIntelligence.nome || 'Fornecedor'}
                />
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
        </PageContainer>
    );
};

export default SuppliersPage;
