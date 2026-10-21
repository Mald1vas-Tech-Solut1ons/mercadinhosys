import { useState, useRef } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle, Loader2, Download, HelpCircle, XCircle } from 'lucide-react';
import { productsService } from '../productsService';
import { showToast } from '../../../utils/toast';
import ResponsiveModal from '../../../components/ui/ResponsiveModal';

interface ProductImportModalProps {
    show: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

interface ImportResult {
    success: boolean;
    message: string;
    total_importados: number;
    total_erros: number;
    erros: string[];
}

// Modelo baixado pelo modal. O backend aceita ';' ou ',', UTF-8 (com ou sem BOM) ou o CSV
// do Excel pt-BR, e números com vírgula. Uma linha por item vendável: roupa vai uma linha
// por tamanho/cor. Sem código de barras (granel, roupa), o código interno 20... é gerado depois.
const MODELO_CABECALHO = 'nome;categoria;preco_custo;preco_venda;codigo_barras;codigo_interno;marca;unidade;estoque;lote;data_validade;ncm';
const MODELO_LINHAS = [
    'Leite Condensado Moça 395g;Mercearia;5,49;8,90;7891000100103;;Nestlé;UN;24;;30/06/2027;04029900',
    'Refrigerante Coca-Cola 2L;Bebidas;6,80;10,99;7894900011517;;Coca-Cola;UN;36;;10/02/2027;22021000',
    'Pão Francês;Padaria;9,00;16,90;;;;KG;8,5;;;',
    'Queijo Mussarela Fatiado;Frios;32,00;49,90;;;;KG;4,2;;;',
    'Camiseta Básica Algodão Preta M;Moda;18,00;39,90;;;;UN;8;;;',
    'Calça Jeans Masculina Azul 40;Moda;55,00;119,90;;;;UN;4;;;',
];

const ProductImportModal = ({ show, onClose, onSuccess }: ProductImportModalProps) => {
    const [file, setFile] = useState<File | null>(null);
    const [importing, setImporting] = useState(false);
    const [result, setResult] = useState<ImportResult | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleDownloadTemplate = () => {
        const csvContent = [MODELO_CABECALHO, ...MODELO_LINHAS].join('\r\n') + '\r\n';
        // BOM para o Excel abrir os acentos corretamente (o backend aceita com ou sem BOM)
        const BOM = '﻿';
        const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', 'modelo_importacao_mercadinho.csv');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        showToast.success('Modelo baixado com sucesso!');
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const selectedFile = e.target.files[0];
            if (!selectedFile.name.toLowerCase().endsWith('.csv')) {
                showToast.error('Selecione um arquivo .csv (no Excel: Salvar como → CSV UTF-8).');
                e.target.value = '';
                return;
            }
            setFile(selectedFile);
            setResult(null);
        }
        e.target.value = '';
    };

    const handleImport = async () => {
        if (!file) return;

        setImporting(true);
        try {
            const response = await productsService.importarCSV(file);
            setResult({
                success: response.success !== false,
                message: response.message || '',
                total_importados: response.total_importados || 0,
                total_erros: response.total_erros || 0,
                erros: response.erros || [],
            });

            if (response.total_importados > 0) {
                onSuccess();
                if (response.total_erros > 0) {
                    showToast.warning(`${response.total_importados} produto(s) importado(s); ${response.total_erros} linha(s) com problema.`);
                } else {
                    showToast.success(`${response.total_importados} produto(s) importado(s)!`);
                }
            } else {
                showToast.error('Nenhum produto foi importado. Veja as linhas com problema.');
            }
        } catch (error: any) {
            console.error('Erro na importação:', error);
            const mensagem = error?.response?.data?.message
                || (error?.response
                    ? 'Não foi possível processar a planilha. Nenhum produto foi gravado.'
                    : 'Não foi possível enviar a planilha. Verifique sua conexão e tente novamente.');
            setResult({ success: false, message: mensagem, total_importados: 0, total_erros: 0, erros: [] });
            showToast.error(mensagem);
        } finally {
            setImporting(false);
        }
    };

    const resetForm = () => {
        setFile(null);
        setResult(null);
        setImporting(false);
    };

    const semErros = result?.success && result.total_erros === 0 && result.total_importados > 0;

    return (
        <ResponsiveModal
            isOpen={show}
            onClose={onClose}
            title="Importar Planilha"
            subtitle="Cadastre seus produtos de forma rápida e fácil"
            headerIcon={<Upload className="w-6 h-6" />}
            headerColor="blue"
            size="xl"
            footer={
                <div className="flex justify-end gap-3 w-full">
                    <button
                        disabled={importing}
                        onClick={onClose}
                        className="flex-1 sm:flex-none px-6 py-3 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-500 font-bold hover:bg-gray-100 transition-all font-bold"
                    >
                        {result ? 'Sair' : 'Cancelar'}
                    </button>

                    {!result && (
                        <button
                            onClick={handleImport}
                            disabled={!file || importing}
                            className={`flex-1 sm:flex-none px-8 py-3 rounded-xl flex items-center justify-center gap-2 font-bold transition-all shadow-lg ${!file || importing
                                ? 'bg-gray-200 dark:bg-gray-800 text-gray-400 shadow-none'
                                : 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-500/20 active:scale-95'
                                }`}
                        >
                            {importing ? (
                                <>
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                    <span>Importando...</span>
                                </>
                            ) : (
                                <>
                                    <CheckCircle className="w-5 h-5" />
                                    <span>Importar Produtos</span>
                                </>
                            )}
                        </button>
                    )}
                </div>
            }
        >

            {/* Content */}
            <div className="p-6 overflow-y-auto max-h-[70vh]">
                {!result ? (
                    <div className="space-y-6">
                        {/* Instructions Guide */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="p-4 bg-blue-50 dark:bg-blue-900/10 rounded-xl border border-blue-100 dark:border-blue-900/30 flex flex-col items-center text-center">
                                <span className="w-7 h-7 bg-blue-500 text-white rounded-full flex items-center justify-center font-bold text-sm mb-2 shadow-sm">1</span>
                                <h4 className="font-bold text-sm text-blue-900 dark:text-blue-300">Baixe o Modelo</h4>
                                <p className="text-[11px] text-blue-700 dark:text-blue-400 mt-1 mb-3">Use nossa planilha pronta para evitar erros.</p>
                                <button
                                    onClick={handleDownloadTemplate}
                                    className="flex items-center gap-1 text-[11px] font-bold bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 px-3 py-1.5 rounded-full hover:bg-blue-600 hover:text-white transition-all shadow-sm"
                                >
                                    <Download className="w-3 h-3" /> Baixar Planilha
                                </button>
                            </div>

                            <div className="p-4 bg-indigo-50 dark:bg-indigo-900/10 rounded-xl border border-indigo-100 dark:border-indigo-900/30 flex flex-col items-center text-center">
                                <span className="w-7 h-7 bg-indigo-500 text-white rounded-full flex items-center justify-center font-bold text-sm mb-2 shadow-sm">2</span>
                                <h4 className="font-bold text-sm text-indigo-900 dark:text-indigo-300">Preencha no Excel</h4>
                                <p className="text-[11px] text-indigo-700 dark:text-indigo-400 mt-1">Uma linha por item vendável (roupa: uma linha por tamanho e cor). Preço com vírgula pode.</p>
                                <div className="mt-2 flex flex-col items-center gap-1 text-[10px] text-indigo-500 opacity-80 italic font-medium">
                                    <span className="flex items-center gap-1"><HelpCircle className="w-3 h-3" /> Não altere a 1ª linha.</span>
                                    <span>Formate a coluna codigo_barras como Texto.</span>
                                </div>
                            </div>

                            <div className="p-4 bg-purple-50 dark:bg-purple-900/10 rounded-xl border border-purple-100 dark:border-purple-900/30 flex flex-col items-center text-center">
                                <span className="w-7 h-7 bg-purple-500 text-white rounded-full flex items-center justify-center font-bold text-sm mb-2 shadow-sm">3</span>
                                <h4 className="font-bold text-sm text-purple-900 dark:text-purple-300">Envie Aqui</h4>
                                <p className="text-[11px] text-purple-700 dark:text-purple-400 mt-1">Salve como CSV e envie. Até 2.000 produtos por arquivo.</p>
                            </div>
                        </div>

                        {/* Upload Dropzone */}
                        <div
                            className={`border-3 border-dashed rounded-2xl p-8 text-center transition-all cursor-pointer group ${file ? 'border-green-400 bg-green-50 dark:bg-green-900/10' : 'border-gray-200 dark:border-gray-700 hover:border-blue-400 hover:bg-blue-50/30'
                                }`}
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <input
                                type="file"
                                ref={fileInputRef}
                                onChange={handleFileChange}
                                accept=".csv,.CSV,text/csv"
                                className="hidden"
                            />

                            {file ? (
                                <div className="flex flex-col items-center gap-3 animate-in fade-in slide-in-from-bottom-2">
                                    <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
                                        <FileText className="w-8 h-8 text-green-500" />
                                    </div>
                                    <div>
                                        <p className="font-bold text-lg text-gray-800 dark:text-white line-clamp-1">{file.name}</p>
                                        <p className="text-sm text-gray-400 uppercase font-black tracking-widest mt-1">{(file.size / 1024).toFixed(1)} KB</p>
                                    </div>
                                    <button
                                        className="text-xs text-red-500 hover:text-red-700 font-bold border-b border-red-500/20 pb-0.5 mt-2"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setFile(null);
                                        }}
                                    >
                                        Remover e escolher outro
                                    </button>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center gap-4 py-4">
                                    <div className="w-16 h-16 bg-gray-50 dark:bg-gray-700/50 rounded-full flex items-center justify-center group-hover:bg-blue-100 dark:group-hover:bg-blue-900/30 transition-colors">
                                        <Upload className="w-8 h-8 text-gray-300 group-hover:text-blue-500 transition-colors" />
                                    </div>
                                    <div>
                                        <p className="font-bold text-lg text-gray-700 dark:text-gray-200">
                                            Clique aqui para escolher o arquivo
                                        </p>
                                        <p className="text-sm text-gray-400 mt-1 max-w-sm mx-auto">
                                            Selecione a planilha que você preencheu para cadastrar os produtos.
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                ) : !result.success ? (
                    <div className="space-y-6 animate-in fade-in duration-500">
                        <div className="p-5 rounded-2xl flex items-start gap-4 shadow-sm border bg-red-50 dark:bg-red-900/20 border-red-100 dark:border-red-900/50">
                            <div className="p-2 rounded-full bg-red-500">
                                <XCircle className="w-6 h-6 text-white" />
                            </div>
                            <div>
                                <h4 className="text-lg font-bold text-red-800 dark:text-red-300">A planilha não foi importada</h4>
                                <p className="text-sm text-red-700 dark:text-red-300 mt-2 leading-relaxed">{result.message}</p>
                            </div>
                        </div>
                        <div className="text-center pt-2">
                            <button
                                onClick={resetForm}
                                className="px-6 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 font-bold rounded-xl hover:bg-gray-200 dark:hover:bg-gray-600 transition-all active:scale-95"
                            >
                                Tentar outro arquivo
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-6 animate-in fade-in duration-500">
                        <div className={`p-5 rounded-2xl flex items-start gap-4 shadow-sm border ${semErros
                            ? 'bg-green-50 dark:bg-green-900/20 border-green-100 dark:border-green-900/50'
                            : 'bg-orange-50 dark:bg-orange-900/20 border-orange-100 dark:border-orange-900/50'
                            }`}>
                            <div className={`p-2 rounded-full ${semErros ? 'bg-green-500' : 'bg-orange-500'}`}>
                                {semErros ? (
                                    <CheckCircle className="w-6 h-6 text-white" />
                                ) : (
                                    <AlertCircle className="w-6 h-6 text-white" />
                                )}
                            </div>
                            <div>
                                <h4 className={`text-lg font-bold ${semErros ? 'text-green-800 dark:text-green-300' : 'text-orange-800 dark:text-orange-300'}`}>
                                    {semErros
                                        ? 'Importação concluída com sucesso!'
                                        : result.total_importados > 0
                                            ? 'Concluído com algumas linhas a corrigir'
                                            : 'Nenhum produto foi importado'}
                                </h4>
                                {result.message && (
                                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">{result.message}</p>
                                )}
                                <div className="flex gap-6 mt-3">
                                    <div className="flex flex-col">
                                        <span className="text-[10px] text-gray-500 uppercase font-black">Importados</span>
                                        <span className="text-2xl font-black text-gray-800 dark:text-white">{result.total_importados}</span>
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-[10px] text-gray-500 uppercase font-black">Com problema</span>
                                        <span className={`text-2xl font-black ${result.total_erros > 0 ? 'text-red-500' : 'text-gray-400'}`}>{result.total_erros}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {result.erros.length > 0 && (
                            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-red-100 dark:border-red-900/30 overflow-hidden shadow-sm">
                                <div className="bg-red-50 dark:bg-red-900/40 p-3 flex justify-between items-center border-b border-red-100 dark:border-red-900/20">
                                    <span className="text-xs font-black text-red-800 dark:text-red-400 uppercase tracking-widest">Linhas a corrigir (número da linha no Excel)</span>
                                    <span className="px-2 py-0.5 bg-red-100 dark:bg-red-900 text-red-600 rounded text-[10px] font-bold">Total: {result.erros.length}</span>
                                </div>
                                <ul className="max-h-64 overflow-y-auto p-4 space-y-2">
                                    {result.erros.map((err, i) => (
                                        <li key={i} className="flex gap-3 items-start">
                                            <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                                            <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed font-medium">{err}</p>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        <div className="text-center pt-2">
                            <button
                                onClick={resetForm}
                                className="px-6 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 font-bold rounded-xl hover:bg-gray-200 dark:hover:bg-gray-600 transition-all active:scale-95"
                            >
                                Fazer outra importação
                            </button>
                        </div>
                    </div>
                )}
            </div>

        </ResponsiveModal>
    );
};

export default ProductImportModal;
