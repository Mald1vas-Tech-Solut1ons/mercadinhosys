import { useCallback, useMemo, useRef, useState } from 'react';
import {
    AlertTriangle, ArrowRight, Check, Loader2, Package, ScanBarcode, Tag, Zap,
} from 'lucide-react';
import ResponsiveModal from '../../../components/ui/ResponsiveModal';
import { showToast } from '../../../utils/toast';
import { mensagemErro } from '../../../utils/mensagemErro';
import { formatCurrency } from '../../../utils/formatters';
import { cosmosService } from '../../../services/cosmosService';
import { viewSchemaService } from '../../../services/viewSchemaService';
import { dataLocalISO } from '../../../utils/dataLocal';
import { Produto } from '../../../types';
import { productsService } from '../productsService';

/**
 * ENTRADA RÁPIDA (PALLET) — o modo paralelo ao cadastro completo.
 *
 * Cenário real: 200 itens de pallet às 5h, cliente já entrando. O cadastro completo
 * (ProductFormModal) exige 5 campos por item e 6 seções de rolagem: 200 × 90s = 5h em pé —
 * na prática o dono cadastra 12 e desiste. Aqui o fluxo é: bipa → preço → quantidade → Enter
 * → próximo, com 2 campos obrigatórios e tudo o mais no default.
 *
 * Regras que este arquivo respeita (não são decoração):
 *  - O lookup é o MESMO do cadastro completo (`cosmosService.lookup`: catálogo local →
 *    BigDataCorp → bases abertas, com o fallback offline do backend). Nada é reimplementado.
 *  - Custo NÃO é pedido. O item vai com `modo_precificacao: 'venda'`, então o SERVIDOR estima o
 *    custo pela margem alvo da loja e grava `origem_custo = 'estimado'` — o campo que o backend
 *    já usa para marcar "custo a conferir quando a nota chegar" (o PDV e os relatórios leem ele).
 *  - A taxonomia oficial continua obrigatória no servidor. Quando a base não classifica o item,
 *    ele entra na categoria "Outros" da família (destino oficial do "não classificado", o mesmo
 *    usado pela importação) e a linha da lista avisa "sem categoria" para revisão depois.
 *  - Validade: o guardião do cadastro RECUSA entrada com estoque em famílias com
 *    `validade_obrigatoria` (mercearia, bebidas) sem a data. Por isso o campo de validade aparece
 *    só nessas famílias — no bazar/eletro o fluxo continua com 2 campos.
 *  - Nenhuma regra do guardião de cadastro é contornada: nome canônico, GTIN, unidade e estoque
 *    continuam sendo validados pelo backend — só paramos de PEDIR o que dá para inferir.
 */

type Categoria = { familia: string; subcategoria: string; semCategoria: boolean };

/** O que a família do item exige no cadastro (flags do View Schema) + a taxonomia dela. */
interface ContextoFamilia {
    familia: string;
    subcategoria: string;
    exigeValidade: boolean;
    exigeFabricacao: boolean;
}

/** O que a base devolveu para o código bipado (ou a ausência dela). */
interface ItemBipado {
    codigo: string;
    nome: string;
    marca: string;
    ncm: string;
    imagem: string;
    familia: string;
    subcategoria: string;
    precoReferencia: number | null;
}

interface ItemEntrada {
    id: string;
    nome: string;
    quantidade: number;
    preco: number;
    semCategoria: boolean;
}

interface Duplicado {
    id: number | null;
    nome: string;
    quantidade: number;
}

/** Payload do modo pallet: Partial<Produto> + o modo que faz o servidor estimar o custo. */
interface PayloadPallet extends Partial<Produto> {
    modo_precificacao: 'venda';
    /** O tipo Produto do front não carrega a flag (o backend sim): pallet entra sem validade. */
    controlar_validade?: boolean;
}

/** "1.234,56" e "9.99" viram número; vazio/inválido vira 0. */
const paraNumero = (texto: string): number => {
    const t = (texto || '').trim();
    if (!t) return 0;
    // Vírgula presente = padrão brasileiro: o ponto é separador de milhar.
    const normalizado = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
    const n = Number.parseFloat(normalizado);
    return Number.isFinite(n) ? n : 0;
};

/**
 * Payload do item: só o que o modo pallet sabe, com os defaults do cadastro.
 * Nunca manda `categoria`/`categoria_oficial` (o servidor deriva da subcategoria) nem
 * `preco_custo` (em modo "venda" o custo é estimado no servidor).
 */
function montarPayloadPallet(
    item: ItemBipado,
    preco: number,
    quantidade: number,
    categoria: Categoria,
    atributos: Record<string, unknown> = {},
    datas: { validade?: string; fabricacao?: string } = {},
): PayloadPallet {
    const payload: PayloadPallet = {
        nome: item.nome.trim().toUpperCase(),
        codigo_barras: item.codigo,
        unidade_medida: 'UN',
        // Sem data informada o item entra sem controle de validade; com data o próprio servidor
        // liga o controle e cria o lote inicial (comportamento do cadastro completo).
        controlar_validade: false,
        controlar_estoque: true,
        tipo_item: 'produto',
        quantidade,
        quantidade_minima: 10,
        preco_venda: preco,
        modo_precificacao: 'venda',
        familia_produto: categoria.familia,
        subcategoria: categoria.subcategoria,
        ativo: true,
    };
    if (item.marca) payload.marca = item.marca.toUpperCase();
    if (item.ncm) payload.ncm = item.ncm;
    if (item.imagem) payload.imagem_url = item.imagem;
    if (Object.keys(atributos).length > 0) payload.atributos = atributos;
    if (datas.validade) payload.data_validade = datas.validade;
    if (datas.fabricacao) payload.data_fabricacao = datas.fabricacao;
    return payload;
}

interface EntradaRapidaPalletProps {
    show: boolean;
    /** Fecha; recebe o total salvo para a página recarregar a lista só se mudou algo. */
    onClose: (totalSalvo: number) => void;
    /** Caso difícil: abre o cadastro completo já com o código bipado. */
    onAbrirCompleto: (codigo: string) => void;
}

const campoLabel = 'block text-[11px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1';
const campoGrande = 'w-full h-16 rounded-xl border-2 border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-2xl font-black tabular-nums outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/20 transition-all';

const EntradaRapidaPallet = ({ show, onClose, onAbrirCompleto }: EntradaRapidaPalletProps) => {
    const [codigo, setCodigo] = useState('');
    const [buscando, setBuscando] = useState(false);
    const [bipado, setBipado] = useState<ItemBipado | null>(null);
    const [nomeManual, setNomeManual] = useState('');
    const [preco, setPreco] = useState('');
    const [quantidade, setQuantidade] = useState('');
    const [atributos, setAtributos] = useState<Record<string, unknown>>({});
    const [erro, setErro] = useState<string | null>(null);
    const [aviso, setAviso] = useState<string | null>(null);
    const [duplicado, setDuplicado] = useState<Duplicado | null>(null);
    const [salvando, setSalvando] = useState(false);
    const [total, setTotal] = useState(0);
    const [itens, setItens] = useState<ItemEntrada[]>([]);
    const [ultimaQtd, setUltimaQtd] = useState(0);
    // Datas só aparecem quando a família do item exige (mercearia/bebida exigem validade).
    const [exigeValidade, setExigeValidade] = useState(false);
    const [exigeFabricacao, setExigeFabricacao] = useState(false);
    const [validade, setValidade] = useState('');
    const [fabricacao, setFabricacao] = useState('');
    const [ultimaValidade, setUltimaValidade] = useState('');

    const refCodigo = useRef<HTMLInputElement | null>(null);
    const refNome = useRef<HTMLInputElement | null>(null);
    const refPreco = useRef<HTMLInputElement | null>(null);
    const refQtd = useRef<HTMLInputElement | null>(null);
    const refValidade = useRef<HTMLInputElement | null>(null);
    // Contexto da família (taxonomia + flags de validade): 1 fetch por família, não por item.
    const contextoCache = useRef(new Map<string, ContextoFamilia | null>());
    // Sequência da lista curta (id estável para a key, sem depender de relógio/nome).
    const seqItens = useRef(0);

    const focar = (el: HTMLInputElement | null, atraso = 60) =>
        window.setTimeout(() => el?.focus(), atraso);

    // Cada abertura é uma entrada nova: zera contador e lista (o dono começa o pallet do zero).
    const ultimoShow = useRef(false);
    if (show !== ultimoShow.current) {
        ultimoShow.current = show;
        if (show) {
            setCodigo(''); setBipado(null); setNomeManual(''); setPreco(''); setQuantidade('');
            setAtributos({}); setErro(null); setAviso(null); setDuplicado(null);
            setTotal(0); setItens([]); setUltimaQtd(0);
            setValidade(''); setFabricacao(''); setUltimaValidade('');
            setExigeValidade(false); setExigeFabricacao(false);
        }
    }

    const digitos = codigo.replace(/\D/g, '');

    /**
     * Contexto da família do item: chaves da taxonomia ("Outros" quando a base não classificou) e
     * as flags de validade do segmento. Uma consulta por família, reaproveitada em todos os itens.
     */
    const carregarContexto = useCallback(async (familiaInformada?: string): Promise<ContextoFamilia | null> => {
        const chave = familiaInformada || '__padrao__';
        if (contextoCache.current.has(chave)) return contextoCache.current.get(chave) ?? null;
        try {
            const schema = await viewSchemaService.getSchemaForContext({
                familiaProduto: familiaInformada || undefined,
            });
            const familia = familiaInformada || schema.familia_produto?.chave
                || (schema.familias_disponiveis || []).find(f => f.chave !== 'servico')?.chave || '';
            const taxonomia = schema.taxonomia || [];
            // "Outros" existe em toda família: destino oficial do item que a base não classificou.
            const outros = taxonomia.find(c => /^outros?$/i.test((c.nome || '').trim()))
                || taxonomia.find(c => /outros/i.test(c.chave.split('.').pop() || ''));
            const contexto: ContextoFamilia | null = familia ? {
                familia,
                subcategoria: outros?.subcategorias?.[0]?.chave || '',
                exigeValidade: !!schema.flags?.validade_obrigatoria,
                exigeFabricacao: !!schema.flags?.exige_fabricacao,
            } : null;
            contextoCache.current.set(chave, contexto);
            return contexto;
        } catch {
            contextoCache.current.set(chave, null);
            return null;
        }
    }, []);

    /** Aplica as flags da família do item (exigência de validade/fabricação) no formulário. */
    const aplicarRegrasDaFamilia = useCallback(async (familia?: string) => {
        const contexto = await carregarContexto(familia);
        if (!contexto) return;
        setExigeValidade(contexto.exigeValidade);
        setExigeFabricacao(contexto.exigeFabricacao);
    }, [carregarContexto]);

    const buscar = useCallback(async (bruto?: string) => {
        const alvo = (bruto ?? codigo).replace(/\D/g, '');
        if (alvo.length < 8) {
            setErro('Bipe o código de barras completo (8 a 14 números).');
            focar(refCodigo.current);
            return;
        }
        setBuscando(true); setErro(null); setAviso(null); setDuplicado(null);
        setBipado(null); setNomeManual('');
        try {
            const res = await cosmosService.lookup(alvo);
            if (res.success && res.data) {
                const d = res.data;
                // `sugestoes` é calculado por loja (família do mix dela + subcategoria oficial).
                const sug = (d.sugestoes || {}) as {
                    familia_produto?: string | null;
                    subcategoria?: string | null;
                    atributos?: Record<string, unknown>;
                };
                setBipado({
                    codigo: alvo,
                    nome: d.nome || '',
                    marca: d.marca || '',
                    ncm: d.ncm || '',
                    imagem: d.imagem_url || '',
                    familia: sug.familia_produto || '',
                    subcategoria: sug.subcategoria || '',
                    precoReferencia: d.preco_referencia && d.preco_referencia > 0 ? d.preco_referencia : null,
                });
                setAtributos(sug.atributos || {});
                setCodigo(alvo);
                // Família de mercearia/bebida exige validade: o campo aparece junto com o preço,
                // então o dono já sabe o que falta antes de tentar salvar.
                void aplicarRegrasDaFamilia(sug.familia_produto || '');
                if (!(d.nome || '').trim()) {
                    setAviso('A base não trouxe o nome deste item. Digite o nome do produto.');
                    focar(refNome.current, 90);
                    return;
                }
                // O próximo campo que exige decisão é o preço: o cursor já vai para ele.
                focar(refPreco.current, 90);
                return;
            }
            // Três caminhos sem dados da base (código interno 20…, EAN desconhecido, base fora):
            // todos seguem salvando — o nome é digitado aqui mesmo, sem sair do fluxo.
            setBipado({
                codigo: alvo, nome: '', marca: '', ncm: '', imagem: '',
                familia: '', subcategoria: '', precoReferencia: null,
            });
            setAtributos({});
            setCodigo(alvo);
            // Sem família conhecida, valem as flags da família padrão da loja.
            void aplicarRegrasDaFamilia('');
            const interno = res.code === 'interno';
            setAviso(interno
                ? 'Código interno da loja (não tem EAN). Digite o nome do produto.'
                : res.code === 'nao_encontrado'
                    ? 'A base não conheceu este código. Digite o nome do produto.'
                    : (res.message || 'Não foi possível consultar a base agora. Digite o nome e siga.'));
            focar(refNome.current, 90);
        } catch {
            setErro('Falha ao consultar a base. Bipe de novo.');
            focar(refCodigo.current);
        } finally {
            setBuscando(false);
        }
    }, [codigo, aplicarRegrasDaFamilia]);

    const registrar = (item: Omit<ItemEntrada, 'id'>) => {
        const id = String(++seqItens.current);
        // Lista curta: basta ver o que acabou de entrar (o contador guarda o total do pallet).
        setItens(prev => [{ id, ...item }, ...prev].slice(0, 5));
        setTotal(prev => prev + 1);
        setUltimaQtd(item.quantidade);
    };

    const limparParaProximo = useCallback(() => {
        setCodigo(''); setBipado(null); setNomeManual(''); setPreco(''); setQuantidade('');
        setAtributos({}); setErro(null); setAviso(null); setDuplicado(null);
        // A validade do item anterior fica no chip "repetir" — o campo volta limpo.
        setValidade(''); setFabricacao(''); setExigeValidade(false); setExigeFabricacao(false);
        focar(refCodigo.current, 80);
    }, []);

    const salvar = useCallback(async () => {
        if (!bipado) {
            setErro('Bipe o código e busque o produto antes de salvar.');
            focar(refCodigo.current);
            return;
        }
        const nome = (bipado.nome || nomeManual).trim();
        if (!nome) {
            setErro('Digite o nome do produto.');
            focar(refNome.current);
            return;
        }
        const precoNum = paraNumero(preco);
        if (!(precoNum > 0)) {
            setErro('Informe o preço de venda.');
            focar(refPreco.current);
            return;
        }
        const qtdNum = paraNumero(quantidade);
        if (!(qtdNum > 0)) {
            setErro('Informe a quantidade que chegou.');
            focar(refQtd.current);
            return;
        }
        if (exigeValidade && !validade) {
            setErro('Informe a validade: nesta família ela é obrigatória quando entra estoque.');
            focar(refValidade.current);
            return;
        }
        if (exigeFabricacao && !fabricacao) {
            setErro('Informe a data de fabricação: nesta família ela é obrigatória.');
            return;
        }
        if (fabricacao && validade && fabricacao >= validade) {
            setErro('A data de fabricação precisa ser anterior à validade.');
            return;
        }

        setSalvando(true); setErro(null);
        try {
            // Família + taxonomia + flags: a base manda quando soube; senão, "Outros" da família.
            const contexto = await carregarContexto(bipado.familia || '');
            if (!contexto) {
                setErro('Não foi possível classificar o item. Use "Abrir completo" e escolha a categoria.');
                return;
            }
            setExigeValidade(contexto.exigeValidade);
            setExigeFabricacao(contexto.exigeFabricacao);
            const categoria: Categoria = bipado.subcategoria
                ? { familia: bipado.familia || contexto.familia, subcategoria: bipado.subcategoria, semCategoria: false }
                : { familia: contexto.familia, subcategoria: contexto.subcategoria, semCategoria: true };

            const payload = montarPayloadPallet(
                { ...bipado, nome }, precoNum, qtdNum, categoria, atributos,
                { validade, fabricacao },
            );
            const res = await productsService.create(payload);

            if (!res.success) {
                if (res.code === 'PRODUTO_DUPLICADO_EAN' || res.code === 'PRODUTO_DUPLICADO_CODIGO') {
                    // Pallet que chega de novo para um item já cadastrado: a ação certa é somar
                    // ao estoque existente — oferecida com um toque, nunca feita sozinha.
                    setDuplicado({
                        id: res.produto_existente?.id ?? null,
                        nome: res.produto_existente?.nome || nome,
                        quantidade: qtdNum,
                    });
                    setErro(`Este código já está cadastrado como "${res.produto_existente?.nome || nome}".`);
                    return;
                }
                const motivos = (res as { errors?: string[] }).errors;
                const mensagem = motivos?.[0] || res.message || 'Não foi possível salvar o item.';
                // Backend recusou por data (família que exige e a tela não previu): mostra o
                // campo na hora em vez de deixar o dono sem saída.
                if (/validade/i.test(mensagem)) { setExigeValidade(true); focar(refValidade.current, 120); }
                if (/fabrica/i.test(mensagem)) setExigeFabricacao(true);
                setErro(mensagem);
                return;
            }

            if (validade) setUltimaValidade(validade);
            registrar({ nome, quantidade: qtdNum, preco: precoNum, semCategoria: categoria.semCategoria });
            limparParaProximo();
        } catch (e) {
            setErro(mensagemErro(e, 'Não foi possível salvar o item.'));
        } finally {
            setSalvando(false);
        }
    }, [bipado, nomeManual, preco, quantidade, atributos, validade, fabricacao,
        exigeValidade, exigeFabricacao, carregarContexto, limparParaProximo]);

    const somarAoEstoque = async () => {
        if (!duplicado?.id) return;
        setSalvando(true); setErro(null);
        try {
            await productsService.ajustarEstoque(
                duplicado.id, duplicado.quantidade, 'entrada', 'Entrada rápida (pallet)',
            );
            registrar({ nome: duplicado.nome, quantidade: duplicado.quantidade, preco: paraNumero(preco), semCategoria: false });
            limparParaProximo();
            showToast.success(`Estoque de "${duplicado.nome}" atualizado.`);
        } catch (e) {
            setErro(mensagemErro(e, 'Não foi possível somar ao estoque.'));
        } finally {
            setSalvando(false);
        }
    };

    const subtitulo = useMemo(
        () => (total === 0 ? 'Bipe o primeiro item do pallet' : `Itens desta entrada: ${total}`),
        [total],
    );

    const codigoParaCompleto = (bipado?.codigo || digitos);

    return (
        <ResponsiveModal
            isOpen={show}
            onClose={() => onClose(total)}
            title="Entrada rápida (pallet)"
            subtitle={subtitulo}
            headerIcon={<Zap className="w-6 h-6" />}
            headerColor="green"
            size="lg"
            footer={
                <button
                    type="button"
                    onClick={salvar}
                    disabled={salvando}
                    className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 text-base font-black uppercase tracking-wide text-white shadow-lg shadow-emerald-600/25 transition-all hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
                >
                    {salvando ? <Loader2 className="h-5 w-5 animate-spin" /> : <Zap className="h-5 w-5" />}
                    {salvando ? 'Salvando...' : 'Salvar e próximo (Enter)'}
                </button>
            }
        >
            <div className="space-y-3">
                {/* 1. Código: campo gigante, foco permanente, Enter do leitor USB dispara a busca. */}
                <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-900/60 dark:bg-emerald-900/10">
                    <label htmlFor="pallet-codigo" className={`${campoLabel} flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300`}>
                        <ScanBarcode className="h-4 w-4" />
                        Código de barras
                    </label>
                    <div className="flex gap-2">
                        <input
                            id="pallet-codigo"
                            ref={refCodigo}
                            value={codigo}
                            autoFocus
                            autoComplete="off"
                            inputMode="numeric"
                            enterKeyHint="search"
                            placeholder="Bipe ou digite o código"
                            onChange={e => { setCodigo(e.target.value.replace(/[^\d]/g, '')); setErro(null); }}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void buscar(); } }}
                            className="h-16 min-w-0 flex-1 rounded-xl border-2 border-emerald-300 bg-white px-3 text-center font-mono text-2xl font-bold tracking-wider text-slate-900 outline-none transition-all focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/20 dark:border-emerald-800 dark:bg-slate-900 dark:text-white"
                        />
                        <button
                            type="button"
                            onClick={() => void buscar()}
                            disabled={buscando}
                            aria-label="Buscar produto pelo código"
                            className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-emerald-600 text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
                        >
                            {buscando ? <Loader2 className="h-6 w-6 animate-spin" /> : <ScanBarcode className="h-6 w-6" />}
                        </button>
                    </div>
                </div>

                {/* 2. Produto: a base preencheu nome/marca/NCM/foto. Quando ela não conhece o
                    código, o único campo extra do fluxo aparece aqui (o servidor exige nome). */}
                {bipado && (
                    <div className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
                        <div className="flex items-start gap-3">
                            {bipado.imagem ? (
                                <img
                                    src={bipado.imagem}
                                    alt=""
                                    loading="lazy"
                                    className="h-14 w-14 shrink-0 rounded-xl bg-white object-contain"
                                />
                            ) : (
                                <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-500">
                                    <Package className="h-7 w-7" />
                                </span>
                            )}
                            <div className="min-w-0 flex-1">
                                {bipado.nome ? (
                                    <p className="text-sm font-bold leading-snug text-slate-900 dark:text-white">{bipado.nome}</p>
                                ) : (
                                    <input
                                        ref={refNome}
                                        value={nomeManual}
                                        onChange={e => setNomeManual(e.target.value)}
                                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); focar(refPreco.current); } }}
                                        placeholder="Nome do produto"
                                        autoComplete="off"
                                        className="w-full rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-sm font-bold text-slate-900 outline-none focus:border-amber-500 dark:border-amber-700 dark:bg-amber-900/20 dark:text-white"
                                    />
                                )}
                                <p className="mt-0.5 truncate text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                                    {bipado.marca && `${bipado.marca} · `}EAN {bipado.codigo}
                                    {bipado.ncm && ` · NCM ${bipado.ncm}`}
                                </p>
                                <div className="mt-1 flex flex-wrap items-center gap-1">
                                    {bipado.subcategoria ? (
                                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                                            <Tag className="h-3 w-3" />
                                            {bipado.subcategoria.split('.').slice(-1)[0]?.replace(/_/g, ' ')}
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                                            <AlertTriangle className="h-3 w-3" />
                                            Sem categoria · vai para Outros
                                        </span>
                                    )}
                                    {bipado.precoReferencia !== null && (
                                        <button
                                            type="button"
                                            onClick={() => { setPreco(bipado.precoReferencia!.toFixed(2).replace('.', ',')); focar(refQtd.current, 40); }}
                                            className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                                        >
                                            Usar referência {formatCurrency(bipado.precoReferencia)}
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* 3. Os DOIS campos obrigatórios. Enter no preço vai para a quantidade; Enter na
                    quantidade salva e volta o foco ao código — o ciclo inteiro pelo teclado. */}
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label htmlFor="pallet-preco" className={campoLabel}>Preço de venda *</label>
                        <div className="relative">
                            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base font-black text-slate-400">R$</span>
                            <input
                                id="pallet-preco"
                                ref={refPreco}
                                value={preco}
                                inputMode="decimal"
                                enterKeyHint="next"
                                placeholder="0,00"
                                onChange={e => { setPreco(e.target.value.replace(/[^\d.,]/g, '')); setErro(null); }}
                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); focar(refQtd.current, 20); } }}
                                className={`${campoGrande} pl-10 pr-3 text-right`}
                            />
                        </div>
                    </div>
                    <div>
                        <label htmlFor="pallet-qtd" className={campoLabel}>Quantidade *</label>
                        <input
                            id="pallet-qtd"
                            ref={refQtd}
                            value={quantidade}
                            inputMode="decimal"
                            enterKeyHint="done"
                            placeholder="0"
                            onChange={e => { setQuantidade(e.target.value.replace(/[^\d.,]/g, '')); setErro(null); }}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void salvar(); } }}
                            className={`${campoGrande} px-3 text-right`}
                        />
                    </div>
                </div>

                {ultimaQtd > 0 && (
                    <button
                        type="button"
                        onClick={() => setQuantidade(String(ultimaQtd))}
                        className="-mt-1 w-full rounded-xl border border-slate-200 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                        Repetir a última quantidade ({ultimaQtd})
                    </button>
                )}

                {/* Datas só aparecem quando a família exige (mercearia/bebida exigem validade para
                    entrar com estoque). Fora delas o fluxo fica com os 2 campos. */}
                {(exigeValidade || exigeFabricacao) && (
                    <div className="grid grid-cols-2 gap-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900/60 dark:bg-amber-900/10">
                        {exigeValidade && (
                            <div>
                                <label htmlFor="pallet-validade" className={campoLabel}>Validade *</label>
                                <input
                                    id="pallet-validade"
                                    ref={refValidade}
                                    type="date"
                                    value={validade}
                                    min={dataLocalISO(new Date())}
                                    onChange={e => { setValidade(e.target.value); setErro(null); }}
                                    className="h-14 w-full rounded-xl border-2 border-amber-300 bg-white px-2 text-base font-bold text-slate-900 outline-none focus:border-amber-500 dark:border-amber-800 dark:bg-slate-900 dark:text-white"
                                />
                                {ultimaValidade && !validade && (
                                    <button
                                        type="button"
                                        onClick={() => setValidade(ultimaValidade)}
                                        className="mt-1 w-full rounded-lg border border-amber-300 px-2 py-1 text-[11px] font-bold text-amber-800 dark:border-amber-800 dark:text-amber-300"
                                    >
                                        Mesma do item anterior ({ultimaValidade.split('-').reverse().join('/')})
                                    </button>
                                )}
                            </div>
                        )}
                        {exigeFabricacao && (
                            <div>
                                <label htmlFor="pallet-fabricacao" className={campoLabel}>Fabricação *</label>
                                <input
                                    id="pallet-fabricacao"
                                    type="date"
                                    value={fabricacao}
                                    max={dataLocalISO(new Date())}
                                    onChange={e => { setFabricacao(e.target.value); setErro(null); }}
                                    className="h-14 w-full rounded-xl border-2 border-amber-300 bg-white px-2 text-base font-bold text-slate-900 outline-none focus:border-amber-500 dark:border-amber-800 dark:bg-slate-900 dark:text-white"
                                />
                            </div>
                        )}
                    </div>
                )}

                {aviso && (
                    <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{aviso}</span>
                    </div>
                )}

                {erro && (
                    <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{erro}</span>
                    </div>
                )}

                {duplicado && duplicado.id && (
                    <button
                        type="button"
                        onClick={() => void somarAoEstoque()}
                        disabled={salvando}
                        className="w-full rounded-xl bg-indigo-600 px-3 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-60"
                    >
                        Somar {duplicado.quantidade} ao estoque de "{duplicado.nome}"
                    </button>
                )}

                {/* 4. Caso difícil: o cadastro completo continua a um toque, já com o código. */}
                <div className="flex items-center justify-between gap-2 rounded-xl border border-dashed border-slate-300 px-3 py-2 dark:border-slate-600">
                    <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                        Precisa de validade, categoria ou custo?
                    </p>
                    <button
                        type="button"
                        onClick={() => onAbrirCompleto(codigoParaCompleto)}
                        disabled={!codigoParaCompleto}
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                        Abrir completo
                        <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                </div>

                {/* 5. Últimos 5 salvos: prova visual de que o item entrou (e o que ficou pendente). */}
                {itens.length > 0 && (
                    <div>
                        <p className={`${campoLabel} mt-1`}>Últimos salvos</p>
                        <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800">
                            {itens.map(item => (
                                <li key={item.id} className="flex items-center gap-2 px-3 py-2">
                                    <Check className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                                    <span className="min-w-0 flex-1 truncate text-xs font-bold text-slate-800 dark:text-slate-100">
                                        {item.nome}
                                    </span>
                                    {item.semCategoria && (
                                        <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                                            sem categoria
                                        </span>
                                    )}
                                    <span className="shrink-0 whitespace-nowrap text-[11px] font-bold tabular-nums text-slate-500 dark:text-slate-400">
                                        {item.quantidade} un × {formatCurrency(item.preco)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        </ResponsiveModal>
    );
};

export default EntradaRapidaPallet;
