import { useEffect, useMemo, useState, type FC } from 'react';
import { Printer, Search, Trash2, Barcode, Minus, Plus, Wand2 } from 'lucide-react';
import ResponsiveModal from '../../../components/ui/ResponsiveModal';
import { showToast } from '../../../utils/toast';
import { mensagemErro } from '../../../utils/mensagemErro';
import { Produto } from '../../../types';
import { productsService } from '../productsService';
import settingsService from '../../settings/settingsService';
import { LABEL_LAYOUTS, LabelItem, LabelLayoutId, LabelOptions, buildLabelsHtml, printLabels, precoBR } from './labelPrint';

interface LabelPrintModalProps {
    isOpen: boolean;
    onClose: () => void;
    produtosIniciais?: Produto[];
}

interface ItemEtiqueta {
    produto: Produto;
    copias: number;
}

interface ConfigSalva extends LabelOptions {
    layoutId: LabelLayoutId;
}

const CHAVE_CONFIG = 'mercadinhosys.etiquetas.config';
const CONFIG_PADRAO: ConfigSalva = {
    layoutId: 'termica-40x25', mostrarLoja: true, mostrarNome: true, mostrarPreco: true, ajusteTopoMm: 0, ajusteEsquerdaMm: 0,
};

const lerConfig = (): ConfigSalva => {
    try {
        const salvo = JSON.parse(localStorage.getItem(CHAVE_CONFIG) || '{}');
        const config = { ...CONFIG_PADRAO, ...salvo };
        return LABEL_LAYOUTS.some(l => l.id === config.layoutId) ? config : CONFIG_PADRAO;
    } catch {
        return CONFIG_PADRAO;
    }
};

const semCodigo = (p: Produto) => !p.codigo_barras?.trim();
const limitarCopias = (n: number) => Math.min(999, Math.max(1, Math.round(n) || 1));

const LabelPrintModal: FC<LabelPrintModalProps> = ({ isOpen, onClose, produtosIniciais }) => {
    const [itens, setItens] = useState<ItemEtiqueta[]>([]);
    const [busca, setBusca] = useState('');
    const [resultados, setResultados] = useState<Produto[]>([]);
    const [buscando, setBuscando] = useState(false);
    const [gerando, setGerando] = useState(false);
    const [config, setConfig] = useState<ConfigSalva>(lerConfig);
    const [nomeLoja, setNomeLoja] = useState('');

    useEffect(() => {
        if (!isOpen) return;
        let ativo = true;
        settingsService.getEstabelecimento()
            .then(est => {
                // Visão global (holding) não tem uma loja só para estampar na etiqueta
                const nome = String(est?.id) === 'all' ? '' : (est?.nome_fantasia || est?.razao_social || '');
                if (ativo) setNomeLoja(nome);
            })
            .catch(() => { /* etiqueta sai sem o nome da loja */ });
        return () => { ativo = false; };
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        const unicos = new Map<number, ItemEtiqueta>();
        (produtosIniciais || []).forEach(p => unicos.set(p.id, { produto: p, copias: 1 }));
        setItens([...unicos.values()]);
        setBusca('');
        setResultados([]);
    }, [isOpen, produtosIniciais]);

    useEffect(() => {
        try { localStorage.setItem(CHAVE_CONFIG, JSON.stringify(config)); } catch { /* modo privado */ }
    }, [config]);

    useEffect(() => {
        const termo = busca.trim();
        if (termo.length < 2) { setResultados([]); return; }
        let ativo = true;
        const timer = setTimeout(async () => {
            setBuscando(true);
            try {
                const encontrados = await productsService.search(termo, 8);
                if (ativo) setResultados((encontrados || []).slice(0, 8));
            } catch {
                if (ativo) setResultados([]);
            } finally {
                if (ativo) setBuscando(false);
            }
        }, 300);
        return () => { ativo = false; clearTimeout(timer); };
    }, [busca]);

    const layout = LABEL_LAYOUTS.find(l => l.id === config.layoutId) || LABEL_LAYOUTS[0];

    const adicionar = (produto: Produto) => {
        setItens(prev => prev.some(i => i.produto.id === produto.id)
            ? prev.map(i => i.produto.id === produto.id ? { ...i, copias: limitarCopias(i.copias + 1) } : i)
            : [...prev, { produto, copias: 1 }]);
        setBusca('');
        setResultados([]);
    };

    /**
     * Enter na busca (leitor USB manda o código + Enter de uma vez): não espera
     * o debounce. Código exato → adiciona na hora; nome com 1 resultado → adiciona.
     */
    const adicionarPorEnter = async () => {
        const termo = busca.trim();
        if (!termo) return;
        const exatoCarregado = resultados.find(p => p.codigo_barras?.trim() === termo);
        if (exatoCarregado) { adicionar(exatoCarregado); return; }
        const ehCodigo = /^\d{4,14}$/.test(termo);
        if (!ehCodigo && resultados.length === 1) { adicionar(resultados[0]); return; }

        setBuscando(true);
        try {
            if (ehCodigo) {
                try {
                    const porCodigo = await productsService.getByBarcode(termo);
                    if (porCodigo) { adicionar(porCodigo); return; }
                } catch { /* não achou pelo código: cai na busca geral */ }
            }
            const encontrados = (await productsService.search(termo, 8)) || [];
            const exato = encontrados.find(p => p.codigo_barras?.trim() === termo);
            if (exato) { adicionar(exato); return; }
            if (encontrados.length === 1) { adicionar(encontrados[0]); return; }
            setResultados(encontrados.slice(0, 8));
            if (!encontrados.length) showToast.error(`Nenhum produto encontrado para "${termo}".`);
        } catch (err) {
            showToast.error(mensagemErro(err, 'Não foi possível buscar o produto.'));
        } finally {
            setBuscando(false);
        }
    };

    const alterarCopias = (id: number, copias: number) =>
        setItens(prev => prev.map(i => i.produto.id === id ? { ...i, copias: limitarCopias(copias) } : i));

    const remover = (id: number) => setItens(prev => prev.filter(i => i.produto.id !== id));

    const etiquetas = useMemo<LabelItem[]>(() => itens.flatMap(({ produto, copias }) =>
        Array.from({ length: copias }, () => ({
            nome: produto.nome,
            preco: Number(produto.preco_venda) || 0,
            codigo: produto.codigo_barras?.trim() || '',
        }))), [itens]);

    const previa = useMemo(
        () => etiquetas.length ? buildLabelsHtml(etiquetas.slice(0, 3), layout, config, nomeLoja) : '',
        [etiquetas, layout, config, nomeLoja]);

    const faltandoCodigo = itens.filter(i => semCodigo(i.produto));
    const porFolha = layout.colunas * layout.linhas;

    const gerarCodigos = async () => {
        setGerando(true);
        try {
            const codigos = await productsService.gerarCodigosBarras(faltandoCodigo.map(i => i.produto.id));
            setItens(prev => prev.map(i => codigos[String(i.produto.id)]
                ? { ...i, produto: { ...i.produto, codigo_barras: codigos[String(i.produto.id)] } }
                : i));
            showToast.success('Códigos gerados e salvos nos produtos.');
        } catch (err: any) {
            showToast.error(mensagemErro(err, 'Não foi possível gerar os códigos.'));
        } finally {
            setGerando(false);
        }
    };

    const imprimir = () => {
        if (!etiquetas.length) return;
        if (etiquetas.some(e => !e.codigo)) {
            showToast.warning('Há produtos sem código: sairão marcados como SEM CÓDIGO.');
        }
        printLabels(etiquetas, layout, config, nomeLoja);
    };

    const inputClass = 'w-full px-4 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-gray-900 dark:text-white';
    const sectionClass = 'p-5 bg-gray-50 dark:bg-gray-900/50 rounded-2xl border border-gray-100 dark:border-gray-800 space-y-4';
    const tituloClass = 'text-xs font-bold text-gray-400 uppercase tracking-widest mb-3';
    const labelClass = 'block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1';

    return (
        <ResponsiveModal
            isOpen={isOpen}
            onClose={onClose}
            title="Imprimir etiquetas"
            subtitle="Código de barras com nome e preço para gôndola e produto"
            headerIcon={<Barcode className="w-6 h-6" />}
            headerColor="indigo"
            size="xl"
            footer={
                <div className="flex w-full flex-col-reverse sm:flex-row sm:items-center gap-3">
                    <span className="text-sm text-gray-500 dark:text-gray-400 sm:mr-auto">
                        {etiquetas.length} etiqueta{etiquetas.length === 1 ? '' : 's'}
                        {layout.folhaA4 && etiquetas.length > 0 && ` em ${Math.ceil(etiquetas.length / porFolha)} folha(s)`}
                    </span>
                    <button type="button" onClick={onClose}
                        className="px-6 py-3 text-gray-600 dark:text-gray-400 font-bold hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-all">
                        Fechar
                    </button>
                    <button type="button" onClick={imprimir} disabled={!etiquetas.length}
                        className="flex items-center justify-center gap-2 px-8 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 disabled:opacity-50 shadow-lg shadow-indigo-500/20 active:scale-95 transition-all">
                        <Printer className="w-5 h-5" /> Imprimir
                    </button>
                </div>
            }
        >
            <div className="space-y-8">
                <div>
                    <h4 className={tituloClass}>Produtos</h4>
                    <div className={sectionClass}>
                        <div className="relative">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                            <input type="text" value={busca} autoFocus
                                onChange={e => setBusca(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        adicionarPorEnter();
                                    }
                                }}
                                className={`${inputClass} pl-12`}
                                placeholder="Buscar produto por nome ou código de barras…" />
                            {(resultados.length > 0 || buscando) && (
                                <div className="absolute z-10 mt-2 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl overflow-hidden">
                                    {buscando && !resultados.length && (
                                        <div className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">Buscando…</div>
                                    )}
                                    {resultados.map(p => (
                                        <button key={p.id} type="button" onClick={() => adicionar(p)}
                                            className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-indigo-50 dark:hover:bg-gray-700 transition-colors">
                                            <div className="min-w-0">
                                                <div className="font-semibold text-gray-900 dark:text-white truncate">{p.nome}</div>
                                                {semCodigo(p)
                                                    ? <span className="text-xs font-semibold text-amber-600">sem código</span>
                                                    : <span className="text-xs font-mono text-gray-500 dark:text-gray-400">{p.codigo_barras}</span>}
                                            </div>
                                            <span className="font-bold text-gray-700 dark:text-gray-200 shrink-0">{precoBR(Number(p.preco_venda) || 0)}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {itens.length === 0 ? (
                            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">Adicione produtos pela busca acima.</p>
                        ) : (
                            <ul className="divide-y divide-gray-200 dark:divide-gray-800">
                                {itens.map(({ produto, copias }) => (
                                    <li key={produto.id} className="flex flex-wrap items-center gap-3 py-3">
                                        <div className="min-w-0 flex-1">
                                            <div className="font-semibold text-gray-900 dark:text-white truncate">{produto.nome}</div>
                                            <div className="flex items-center gap-2 text-xs">
                                                {semCodigo(produto)
                                                    ? <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 font-semibold">sem código</span>
                                                    : <span className="font-mono text-gray-500 dark:text-gray-400">{produto.codigo_barras}</span>}
                                                <span className="text-gray-500 dark:text-gray-400">· {precoBR(Number(produto.preco_venda) || 0)}</span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <button type="button" aria-label="Menos uma cópia" onClick={() => alterarCopias(produto.id, copias - 1)}
                                                className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300">
                                                <Minus className="w-4 h-4" />
                                            </button>
                                            <input type="number" min={1} max={999} value={copias} aria-label="Cópias"
                                                onChange={e => alterarCopias(produto.id, Number(e.target.value))}
                                                className="w-16 px-2 py-2 text-center bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white" />
                                            <button type="button" aria-label="Mais uma cópia" onClick={() => alterarCopias(produto.id, copias + 1)}
                                                className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300">
                                                <Plus className="w-4 h-4" />
                                            </button>
                                            <button type="button" aria-label="Remover" onClick={() => remover(produto.id)}
                                                className="p-2 ml-1 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20">
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}

                        {faltandoCodigo.length > 0 && (
                            <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                                <p className="text-sm text-amber-800 dark:text-amber-300 flex-1">
                                    Produto sem código de barras do fabricante (granel, padaria, fracionado) pode receber um código interno da loja.
                                </p>
                                <button type="button" onClick={gerarCodigos} disabled={gerando}
                                    className="flex items-center justify-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold text-sm disabled:opacity-50">
                                    <Wand2 className="w-4 h-4" />
                                    {gerando ? 'Gerando…' : `Gerar código interno para ${faltandoCodigo.length} produto(s)`}
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                <div>
                    <h4 className={tituloClass}>Papel e conteúdo</h4>
                    <div className={sectionClass}>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="sm:col-span-2">
                                <label className={labelClass}>Modelo de etiqueta</label>
                                <select value={config.layoutId} className={inputClass}
                                    onChange={e => setConfig(c => ({ ...c, layoutId: e.target.value as LabelLayoutId }))}>
                                    {LABEL_LAYOUTS.map(l => <option key={l.id} value={l.id}>{l.nome}</option>)}
                                </select>
                            </div>
                            <label className="flex items-center gap-3 text-sm font-medium text-gray-700 dark:text-gray-300">
                                <input type="checkbox" checked={config.mostrarLoja} className="w-4 h-4 rounded"
                                    onChange={e => setConfig(c => ({ ...c, mostrarLoja: e.target.checked }))} />
                                Mostrar nome da loja{nomeLoja && <span className="text-gray-400 truncate">({nomeLoja})</span>}
                            </label>
                            <label className="flex items-center gap-3 text-sm font-medium text-gray-700 dark:text-gray-300">
                                <input type="checkbox" checked={config.mostrarNome} className="w-4 h-4 rounded"
                                    onChange={e => setConfig(c => ({ ...c, mostrarNome: e.target.checked }))} />
                                Mostrar nome do produto
                            </label>
                            <label className="flex items-center gap-3 text-sm font-medium text-gray-700 dark:text-gray-300">
                                <input type="checkbox" checked={config.mostrarPreco} className="w-4 h-4 rounded"
                                    onChange={e => setConfig(c => ({ ...c, mostrarPreco: e.target.checked }))} />
                                Mostrar preço
                            </label>
                            <div>
                                <label className={labelClass}>Ajuste vertical (mm)</label>
                                <input type="number" step={0.5} value={config.ajusteTopoMm} className={inputClass}
                                    onChange={e => setConfig(c => ({ ...c, ajusteTopoMm: Number(e.target.value) || 0 }))} />
                            </div>
                            <div>
                                <label className={labelClass}>Ajuste horizontal (mm)</label>
                                <input type="number" step={0.5} value={config.ajusteEsquerdaMm} className={inputClass}
                                    onChange={e => setConfig(c => ({ ...c, ajusteEsquerdaMm: Number(e.target.value) || 0 }))} />
                            </div>
                            <p className="sm:col-span-2 text-xs text-gray-500 dark:text-gray-400">
                                Use os ajustes para alinhar com o papel se a impressão sair deslocada.
                            </p>
                        </div>
                    </div>
                </div>

                {previa && (
                    <div>
                        <h4 className={tituloClass}>Prévia</h4>
                        <iframe title="Prévia das etiquetas" srcDoc={previa}
                            className="w-full h-[220px] bg-white rounded-2xl border border-gray-200 dark:border-gray-700 dark:bg-gray-800" />
                    </div>
                )}
            </div>
        </ResponsiveModal>
    );
};

export default LabelPrintModal;
