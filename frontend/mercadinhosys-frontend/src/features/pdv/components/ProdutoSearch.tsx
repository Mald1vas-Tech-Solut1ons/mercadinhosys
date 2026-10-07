import React, { useState, useEffect, useRef } from 'react';
import { Search, Package, Barcode, Camera, AlertCircle } from 'lucide-react';
import { Produto } from '../../../types';
import { pdvService } from '../pdvService';
import { buscarOffline } from '../offlineCatalog';
import { useConfig } from '../../../contexts/ConfigContext';
import BarcodeScanner from './BarcodeScanner';
import ImageZoomModal from '../../../components/ui/ImageZoomModal';

interface ProdutoSearchProps {
    onProdutoSelecionado: (produto: Produto) => void;
}

const UNIDADES_PESO = ['KG', 'G', 'GR', 'L', 'LT', 'ML'];

const ProdutoSearch: React.FC<ProdutoSearchProps> = ({ onProdutoSelecionado }) => {
    const [query, setQuery] = useState('');
    const [resultados, setResultados] = useState<Produto[]>([]);
    const [loading, setLoading] = useState(false);
    const [erro, setErro] = useState<string | null>(null);
    const [scannerAberto, setScannerAberto] = useState(false);
    const [fotosComErro, setFotosComErro] = useState<Set<number>>(new Set());
    const inputRef = useRef<HTMLInputElement>(null);

    const { config } = useConfig();
    const estoqueMinimo = config?.estoque_minimo_padrao ?? 10;
    const mostrarValidade = config?.controlar_validade ?? true;
    const mostrarAlertaEstoque = config?.alerta_estoque_minimo ?? true;
    const diasAlertaValidade = config?.dias_alerta_validade ?? 30;
    const mostrarFotoProduto = config?.mostrar_foto_produto_pdv ?? false;
    const [zoomSrc, setZoomSrc] = useState<{ src: string; alt: string } | null>(null);

    useEffect(() => {
        if (!query.trim()) {
            setResultados([]);
            setErro(null);
            return;
        }

        const buscarProdutos = async () => {
            setLoading(true);
            setErro(null);

            try {
                if (/^\d{8,14}$/.test(query.trim())) {
                    const produto = await pdvService.buscarPorCodigoBarras(query.trim());
                    if (produto) {
                        onProdutoSelecionado(produto);
                        setQuery('');
                        setResultados([]);
                    } else {
                        setErro('Código de barras não encontrado');
                    }
                } else {
                    const produtos = await pdvService.buscarProduto(query);
                    if (Array.isArray(produtos)) {
                        setResultados(produtos.slice(0, 20));
                    } else {
                        setErro('Erro ao processar resposta da API');
                        setResultados([]);
                    }
                }
            } catch (error: any) {
                const semRede = error.code === 'ERR_NETWORK' || !error.response;
                if (semRede) {
                    // FALLBACK OFFLINE: busca no catálogo cacheado no aparelho
                    try {
                        const offline = await buscarOffline(query.trim());
                        if (offline.length > 0) {
                            const mapped = offline.map((p) => ({
                                id: p.id, nome: p.nome, codigo_barras: p.codigo_barras,
                                codigo_interno: p.codigo_interno, preco_venda: p.preco_venda,
                                quantidade: p.quantidade, unidade_medida: p.unidade_medida,
                            })) as unknown as Produto[];
                            setResultados(mapped.slice(0, 20));
                            setErro('📴 Offline — usando catálogo salvo no aparelho');
                        } else {
                            setResultados([]);
                            setErro('📴 Offline — produto não está no catálogo salvo');
                        }
                    } catch {
                        setResultados([]);
                        setErro('⚠️ Sem catálogo offline. Conecte uma vez para baixá-lo.');
                    }
                } else if (error.response?.status === 401) {
                    setErro('🔒 Sessão expirada. Faça login novamente.');
                    setResultados([]);
                } else {
                    setErro(error.response?.data?.error || error.message || 'Erro ao buscar produtos');
                    setResultados([]);
                }
            } finally {
                setLoading(false);
            }
        };

        const debounce = setTimeout(buscarProdutos, 200);
        return () => clearTimeout(debounce);
    }, [query, onProdutoSelecionado]);

    const handleScanCodigo = async (codigo: string) => {
        setScannerAberto(false);
        setQuery(codigo);
    };

    const handleProdutoClick = (produto: Produto) => {
        setErro(null);
        onProdutoSelecionado(produto);
        setQuery('');
        setResultados([]);
        
        const un = ((produto as any).unidade_medida || 'UN').toUpperCase();
        const isPeso = UNIDADES_PESO.includes(un) || produto.tipo === 'granel';
        
        if (!isPeso) {
            setTimeout(() => {
                inputRef.current?.focus();
            }, 50);
        }
    };

    /** Calcula badge de validade */
    const getValidadeBadge = (dvStr: string | null | undefined): React.ReactNode => {
        if (!dvStr) return null;
        let y: number, m: number, d: number;
        let dateLabel = "";

        if (String(dvStr).includes('T')) {
            const dt = new Date(dvStr);
            y = dt.getFullYear(); m = dt.getMonth() + 1; d = dt.getDate();
            dateLabel = dt.toLocaleDateString('pt-BR');
        } else if (String(dvStr).includes('-')) {
            [y, m, d] = String(dvStr).split('-').map(Number);
            dateLabel = `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
        } else {
            [d, m, y] = String(dvStr).split('/').map(Number);
            dateLabel = `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
        }

        const dv = new Date(y, m - 1, d);
        const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
        const limite = new Date(hoje); limite.setDate(hoje.getDate() + diasAlertaValidade);

        if (dv < hoje) {
            return (
                <div className="flex items-center gap-1">
                    <span className="text-[10px] font-black px-1.5 py-0.5 rounded uppercase bg-red-500 text-white animate-pulse">
                        Vencido
                    </span>
                    <span className="text-[10px] font-bold text-red-600 dark:text-red-400">{dateLabel}</span>
                </div>
            );
        } else if (dv <= limite) {
            const dias = Math.round((dv.getTime() - hoje.getTime()) / 86400000);
            return (
                <div className="flex items-center gap-1">
                    <span className="text-[10px] font-black px-1.5 py-0.5 rounded uppercase bg-amber-500 text-white">
                        Vence em {dias}d
                    </span>
                    <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400">{dateLabel}</span>
                </div>
            );
        } else {
            return (
                <div className="flex items-center gap-1">
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                        Val. OK
                    </span>
                    <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">{dateLabel}</span>
                </div>
            );
        }
    };

    return (
        <div className="relative">
            {/* Barra de Busca */}
            <div className="flex items-center space-x-2 mb-4">
                <button
                    onClick={() => setScannerAberto(true)}
                    className="p-3 bg-linear-to-r from-blue-500 to-blue-600 text-white rounded-lg hover:from-blue-600 hover:to-blue-700 shadow-lg transition"
                    title="Abrir scanner de código de barras"
                >
                    <Camera className="w-5 h-5" />
                </button>

                <div className="flex-1 relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                        ref={inputRef}
                        id="produto-search-input"
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Buscar por nome, marca, código de barras..."
                        className="w-full pl-10 pr-4 py-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-800 dark:text-white"
                        autoFocus
                    />
                    {loading && (
                        <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500"></div>
                        </div>
                    )}
                </div>
            </div>

            {/* Mensagem de Erro */}
            {erro && (
                <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                    <div className="flex items-center space-x-2">
                        <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
                        <p className="text-sm text-red-700 dark:text-red-400">{erro}</p>
                    </div>
                </div>
            )}

            {/* Lista de Resultados */}
            {resultados.length > 0 && (
                <div
                    className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl overflow-hidden"
                    style={{ maxHeight: 'min(24rem, calc(100dvh - 14rem))' }}
                >
                    <div
                        className="overflow-y-auto overscroll-contain custom-scrollbar"
                        style={{ maxHeight: 'min(24rem, calc(100dvh - 14rem))', WebkitOverflowScrolling: 'touch' }}
                    >
                    {resultados.map((produto) => {
                        const un = ((produto as any).unidade_medida || 'UN').toUpperCase();
                        const isPeso = UNIDADES_PESO.includes(un);
                        const estq: number = (produto as any).quantidade_estoque ?? (produto as any).estoque_atual ?? 0;
                        const dvStr = (produto as any).data_validade || produto.data_validade;
                        const preco = (produto as any).preco_venda_efetivo ?? produto.preco_venda ?? 0;
                        const imagemUrl = (produto as any).imagem_url || produto.imagem_url;

                        return (
                            <div
                                key={produto.id}
                                onClick={() => handleProdutoClick(produto)}
                                className="p-3 hover:bg-blue-50 dark:hover:bg-blue-900/20 cursor-pointer border-b border-gray-100 dark:border-gray-700 last:border-b-0 transition-colors"
                            >
                                <div className="flex items-center gap-3">
                                    {mostrarFotoProduto && imagemUrl && !fotosComErro.has(produto.id) ? (
                                        <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); setZoomSrc({ src: imagemUrl, alt: produto.nome }); }}
                                            className="shrink-0"
                                            title="Ampliar foto"
                                        >
                                            <img
                                                src={imagemUrl}
                                                alt={produto.nome}
                                                loading="lazy"
                                                onError={() => setFotosComErro(prev => new Set(prev).add(produto.id))}
                                                className="w-14 h-14 rounded-xl object-cover border border-gray-200 dark:border-gray-700 bg-white"
                                            />
                                        </button>
                                    ) : (
                                        <div className={`w-14 h-14 shrink-0 rounded-xl flex items-center justify-center text-[11px] font-black ${isPeso
                                            ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300'
                                            : 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                                            }`}>
                                            {isPeso ? un : <Package className="w-5 h-5" />}
                                        </div>
                                    )}

                                    {/* Nome + badges */}
                                    <div className="flex-1 min-w-0">
                                        <h4 className="font-bold text-gray-800 dark:text-white text-sm leading-tight truncate">
                                            {produto.nome}
                                        </h4>
                                        <div className="flex items-center flex-wrap gap-1.5 mt-1">

                                            {/* A Granel */}
                                            {isPeso && (
                                                <span className="text-[10px] font-black px-1.5 py-0.5 rounded uppercase bg-orange-500 text-white">
                                                    A Granel · {un}
                                                </span>
                                            )}

                                            {/* Código de barras */}
                                            {(produto as any).codigo_barras && (
                                                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400">
                                                    Code: {(produto as any).codigo_barras}
                                                </span>
                                            )}

                                            {/* Lote */}
                                            {(produto as any).lote && (
                                                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-800">
                                                    Lote: {(produto as any).lote}
                                                </span>
                                            )}

                                            {/* Marca */}
                                            {produto.marca && (
                                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">
                                                    {produto.marca}
                                                </span>
                                            )}

                                            {/* Validade */}
                                            {mostrarValidade && getValidadeBadge(dvStr)}
                                        </div>
                                    </div>

                                    {/* Preço + Estoque */}
                                    <div className="text-right shrink-0 min-w-[90px]">
                                        <p className="font-black text-base text-gray-800 dark:text-white tabular-nums leading-tight">
                                            R$ {Number(preco).toFixed(2).replace('.', ',')}
                                            <span className="text-[10px] font-normal text-slate-400">/{un.toLowerCase()}</span>
                                        </p>
                                        {mostrarAlertaEstoque && (
                                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded mt-0.5 inline-block ${estq > estoqueMinimo
                                                ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                                                : estq > 0
                                                    ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
                                                    : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                                                }`}>
                                                Est: {estq} {un.toLowerCase()}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                    </div>
                </div>
            )}

            {/* Dica de Uso */}
            <div className="mt-3 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                <div className="flex items-center space-x-4">
                    <span className="flex items-center space-x-1">
                        <Search className="w-3 h-3" />
                        <span>Busca por nome, marca, categoria</span>
                    </span>
                    <span className="flex items-center space-x-1">
                        <Barcode className="w-3 h-3" />
                        <span>Código de barras automático</span>
                    </span>
                </div>
                <span className="flex items-center space-x-1">
                    <Camera className="w-3 h-3" />
                    <span>Scanner disponível</span>
                </span>
            </div>

            {/* Modal Scanner */}
            {scannerAberto && (
                <BarcodeScanner
                    onScan={handleScanCodigo}
                    onClose={() => setScannerAberto(false)}
                />
            )}
            <ImageZoomModal
                src={zoomSrc?.src ?? null}
                alt={zoomSrc?.alt}
                onClose={() => setZoomSrc(null)}
            />
        </div>
    );
};

export default ProdutoSearch;
