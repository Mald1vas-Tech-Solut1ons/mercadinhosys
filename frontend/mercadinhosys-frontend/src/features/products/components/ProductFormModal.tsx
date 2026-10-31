import { useState, useEffect, useMemo, useRef } from 'react';
import { confirmar } from '../../../components/ui/Confirmacao';
import { Camera, Sparkles, Package, Wrench, HelpCircle, Wand2, Loader2, Search } from 'lucide-react';
import ResponsiveModal from '../../../components/ui/ResponsiveModal';
import FotoUpload from '../../../components/ui/FotoUpload';
import SchemaField from '../../../components/schema/SchemaField';
import CategoriaPicker from '../../../components/schema/CategoriaPicker';
import { showToast } from '../../../utils/toast';
import { Produto } from '../../../types';
import { RegrasFiscais, TipoItem } from '../../../types/viewSchema';
import { productsService } from '../productsService';
import {
    calcularModoMercado, calcularModoVenda,
    validarDescontoMercadoPct, validarMargemAlvoVendaPct,
} from '../utils/precificacaoReversa';
import { cosmosService, CatalogoBuscaItem } from '../../../services/cosmosService';
import { useViewSchema, schemaHelpers } from '../../../services/viewSchemaService';
import BarcodeScanner from '../../pdv/components/BarcodeScanner';

interface ProductFormModalProps {
    show: boolean;
    editMode: boolean;
    produto: Produto | null;
    categorias?: string[];
    onClose: () => void;
    onSuccess: () => void;
    /** Quando informado, o toast de cadastro oferece "Imprimir etiqueta" do produto criado. */
    onPrintLabel?: (produto: Produto) => void;
}

// Fallback exibido só no instante antes do schema do tenant carregar (evita
// "piscar" texto genérico) — depois disso quem manda são os exemplos do segmento.
const EXEMPLOS_FALLBACK = {
    nome: 'Ex: Nome do produto',
    categoria: 'Ex: Categoria do produto',
    marca: 'Ex: Marca / Fabricante',
    nome_servico: 'Ex: Nome do serviço',
    categoria_servico: 'Ex: Categoria do serviço',
};

// Rótulos amigáveis p/ unidades vindas do schema (fallback = a própria sigla)
const LABEL_UNIDADE: Record<string, string> = {
    un: 'Unidade (un)', kg: 'Quilograma (kg)', g: 'Grama (g)', l: 'Litro (l)', ml: 'Mililitro (ml)',
    cx: 'Caixa (cx)', pct: 'Pacote (pct)', fardo: 'Fardo', duzia: 'Dúzia', bandeja: 'Bandeja',
    par: 'Par', conjunto: 'Conjunto', kit: 'Kit', jogo: 'Jogo', tonel: 'Tonel', barrica: 'Barrica',
    saco: 'Saco', lata: 'Lata', galao: 'Galão', balde: 'Balde', rolo: 'Rolo', barra: 'Barra',
    m: 'Metro (m)', m2: 'Metro² (m²)', m3: 'Metro³ (m³)', t: 'Tonelada (t)', milheiro: 'Milheiro',
};

/**
 * Ícone de ajuda contextual (?) ao lado de labels — sobretudo nos campos
 * fiscais, onde o lojista raramente sabe de cor o que é NCM/CFOP/CSOSN.
 * Tooltip próprio (não usa `title` nativo: aparece com atraso e não é
 * estilizável, o que destoa do resto do formulário).
 */
const CampoAjuda = ({ texto }: { texto: string }) => (
    <span className="relative inline-flex group/ajuda align-middle">
        <button
            type="button"
            tabIndex={-1}
            className="text-gray-400 hover:text-blue-500 dark:text-gray-500 dark:hover:text-blue-400 transition-colors"
            aria-label="Ajuda sobre este campo"
        >
            <HelpCircle className="w-3.5 h-3.5" />
        </button>
        <span
            className="pointer-events-none absolute z-20 bottom-full left-1/2 -translate-x-1/2 mb-2 w-56
                       rounded-lg bg-gray-900 dark:bg-gray-700 px-3 py-2 text-[11px] leading-snug text-white
                       opacity-0 scale-95 origin-bottom transition-all duration-150
                       group-hover/ajuda:opacity-100 group-hover/ajuda:scale-100 shadow-xl"
        >
            {texto}
            <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900 dark:border-t-gray-700" />
        </span>
    </span>
);

/** GTIN (EAN-8/UPC-A/EAN-13/GTIN-14) completo e com dígito verificador válido. */
export const gtinValido = (codigo: string): boolean => {
    const d = (codigo || '').replace(/\D/g, '');
    if (![8, 12, 13, 14].includes(d.length) || /^0+$/.test(d)) return false;
    const corpo = d.slice(0, -1).split('').reverse();
    const soma = corpo.reduce((acc, ch, i) => acc + Number(ch) * (i % 2 === 0 ? 3 : 1), 0);
    return (10 - (soma % 10)) % 10 === Number(d[d.length - 1]);
};

// O servidor grava estes campos em MAIÚSCULAS (guardião do cadastro): o formulário mostra igual.
const CAMPOS_MAIUSCULOS = new Set<string>(['nome', 'marca', 'fabricante']);
const maiusculas = (t?: string | null) => (t || '').toUpperCase();

// Espelha services/fiscal/tributacao.py (Lei 10.147/2000): as listas vêm do schema.
const ncmMonofasico = (ncm: string, regras?: RegrasFiscais): boolean => {
    const digitos = (ncm || '').replace(/\D/g, '');
    if (!regras || digitos.length !== 8) return false;
    const { posicoes, codigos } = regras.pis_cofins_monofasico;
    return codigos.includes(digitos) || posicoes.includes(digitos.slice(0, 4));
};

const formatarNcm = (ncm: string) =>
    ncm.length === 8 ? `${ncm.slice(0, 4)}.${ncm.slice(4, 6)}.${ncm.slice(6)}` : ncm;

const emptyForm = {
    nome: '',
    codigo_barras: '',
    descricao: '',
    categoria: '',      // nome de exibição (descrição por IA / legado)
    subcategoria: '',   // chave oficial da subcategoria (nível 3) — é o que o servidor grava
    categoria_oficial: '', // chave oficial da categoria (nível 2), dona da subcategoria
    marca: '',
    fabricante: '',
    familia_produto: '',
    ncm: '',
    cest: '',
    cfop_padrao: '',
    csosn: '',
    icms_st: false,
    tipo: '',
    tipo_item: 'produto' as TipoItem,
    unidade_medida: 'un',
    preco_custo: 0,
    preco_venda: 0,
    margem_lucro: 30,
    // Precificação reversa (Fase A): 'custo' é o modo padrão; 'mercado'/'venda'
    // estimam o custo no servidor — o campo custo vira somente leitura com selo.
    modo_precificacao: 'custo' as 'custo' | 'mercado' | 'venda',
    preco_referencia_mercado: 0,
    desconto_mercado_pct: null as number | null,   // null = usa default da loja
    margem_alvo_venda_pct: null as number | null,  // null = usa default da loja
    fonte_referencia_mercado: 'outro' as 'shopee' | 'mercado_livre' | 'outro',
    quantidade: 0,
    quantidade_minima: 10,
    // Validade/fabricação/lote do estoque inicial (famílias que vencem): o servidor cria o lote.
    data_validade: '',
    data_fabricacao: '',
    lote: '',
    ativo: true,
    imagem_url: '',
    atributos: {} as Record<string, any>,
};

const ProductFormModal = ({
    show,
    editMode,
    produto,
    onClose,
    onSuccess,
    onPrintLabel,
}: ProductFormModalProps) => {
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({ ...emptyForm });
    const [showScanner, setShowScanner] = useState(false);
    const [isSearchingCosmos, setIsSearchingCosmos] = useState(false);
    const [showForceSync, setShowForceSync] = useState(false);
    const [gerandoDescricao, setGerandoDescricao] = useState(false);
    const [buscandoNome, setBuscandoNome] = useState(false);
    const [resultadosNome, setResultadosNome] = useState<CatalogoBuscaItem[]>([]);
    // true quando o preço de venda foi digitado pelo usuário (ou veio do produto
    // em edição): mexer no custo passa a recalcular a MARGEM, não o preço.
    const precoVendaManual = useRef(false);

    // Motor de Renderização Contextual: o schema decide campos, unidades e grupos
    const { schema } = useViewSchema(formData.familia_produto || undefined, formData.tipo_item);
    const ehServico = formData.tipo_item === 'servico';
    const visivel = (chave: string) => schemaHelpers.campoVisivel(schema, chave);

    const unidades = useMemo(() => {
        const lista = schema?.unidades?.length ? schema.unidades : ['un', 'kg', 'g', 'l', 'ml', 'cx', 'pct', 'fardo', 'duzia'];
        return lista.map(u => ({ value: u, label: LABEL_UNIDADE[u] || u.toUpperCase() }));
    }, [schema]);

    // Placeholders contextuais: o dono de loja de roupas não deve ver "Ex: Arroz Tio João"
    const exemplos = schema?.segmento?.exemplos || EXEMPLOS_FALLBACK;
    const familiasDisponiveis = useMemo(() => {
        const familias = schema?.familias_disponiveis || [];
        if (ehServico) return familias.filter(f => f.chave === 'servico');
        return familias.filter(f => f.chave !== 'servico');
    }, [schema, ehServico]);

    const gruposAtributos = useMemo(() => {
        if (!schema) return [];
        return ['atributos', 'dimensoes', 'servico']
            .map(grupo => ({
                grupo,
                label: schema.grupos.find(g => g.chave === grupo)?.label || grupo,
                campos: schemaHelpers.camposDoGrupo(schema, grupo, formData.tipo_item),
            }))
            .filter(g => g.campos.length > 0);
    }, [schema, formData.tipo_item]);

    useEffect(() => {
        if (!show) return;
        precoVendaManual.current = Boolean(produto && editMode && produto.preco_venda);
        if (produto && editMode) {
            setFormData({
                nome: produto.nome || '',
                codigo_barras: produto.codigo_barras || '',
                descricao: produto.descricao || '',
                categoria: produto.categoria || '',
                subcategoria: (produto as any).subcategoria_oficial || '',
                categoria_oficial: (produto as any).categoria_oficial || '',
                marca: produto.marca || '',
                fabricante: produto.fabricante || '',
                familia_produto: produto.familia_produto || '',
                ncm: (produto as any).ncm || '',
                cest: (produto as any).cest || '',
                cfop_padrao: (produto as any).cfop_padrao || '',
                csosn: (produto as any).csosn || '',
                icms_st: Boolean((produto as any).icms_st),
                tipo: produto.tipo || '',
                tipo_item: (produto.tipo_item as TipoItem) || 'produto',
                unidade_medida: produto.unidade_medida || 'un',
                preco_custo: produto.preco_custo || 0,
                preco_venda: produto.preco_venda || 0,
                margem_lucro: produto.margem_lucro || 30,
                modo_precificacao: 'custo',
                preco_referencia_mercado: (produto as any).preco_referencia_mercado || 0,
                desconto_mercado_pct: null,   // em edição recalcula de novo a partir do ref salvo
                margem_alvo_venda_pct: null,  // null = usa default da loja de novo
                fonte_referencia_mercado: ((produto as any).fonte_referencia_mercado || 'outro'),
                quantidade: produto.quantidade || 0,
                quantidade_minima: produto.quantidade_minima || 10,
                ativo: produto.ativo ?? true,
                imagem_url: produto.imagem_url || '',
                atributos: produto.atributos || {},
                // Na edição a validade é dos lotes (tela de lotes); o formulário não envia datas.
                data_validade: '',
                data_fabricacao: '',
                lote: '',
            });
        } else {
            setFormData({ ...emptyForm });
        }
    }, [show, editMode, produto]);

    useEffect(() => {
        if (!show || !schema) return;
        const familiaAtual = formData.familia_produto;
        const familiaSchema = schema.familia_produto?.chave;
        if (ehServico) {
            if (familiaAtual !== 'servico') {
                setFormData(prev => ({ ...prev, familia_produto: 'servico' }));
            }
            return;
        }
        if (!familiaAtual && familiaSchema) {
            setFormData(prev => ({ ...prev, familia_produto: familiaSchema }));
        }
    }, [show, schema, ehServico, formData.familia_produto]);

    // Cada família mostra só os campos dela: ao trocar de família (ou receber a sugestão da busca),
    // atributos que não existem no formulário novo saem do cadastro.
    useEffect(() => {
        if (!show || !schema) return;
        const validas = new Set(schema.campos.filter(c => c.origem === 'atributo').map(c => c.chave));
        setFormData(prev => {
            const chaves = Object.keys(prev.atributos || {});
            if (chaves.every(k => validas.has(k))) return prev;
            return { ...prev, atributos: Object.fromEntries(Object.entries(prev.atributos).filter(([k]) => validas.has(k))) };
        });
    }, [show, schema]);

    // Sugestão fiscal por família: preenche/atualiza CFOP e CSOSN enquanto o
    // valor em tela ainda for exatamente o que a própria sugestão colocou lá
    // (rastreado em ultimaSugestaoAplicada). No instante em que o usuário
    // digita algo diferente, o campo "sai do modo automático" e passa a ser
    // preservado mesmo trocando de família de novo.
    const ultimaSugestaoAplicada = useRef<{ cfop: string; csosn: string } | null>(null);
    useEffect(() => {
        if (!show || !schema?.sugestao_fiscal) return;
        const sugestao = schema.sugestao_fiscal;
        setFormData(prev => {
            const aindaAuto = ultimaSugestaoAplicada.current;
            const cfopAuto = !prev.cfop_padrao || prev.cfop_padrao === aindaAuto?.cfop;
            const csosnAuto = !prev.csosn || prev.csosn === aindaAuto?.csosn;
            if (!cfopAuto && !csosnAuto) return prev;
            return {
                ...prev,
                cfop_padrao: cfopAuto ? sugestao.cfop_padrao_sugerido : prev.cfop_padrao,
                csosn: csosnAuto ? sugestao.csosn_sugerido : prev.csosn,
            };
        });
        ultimaSugestaoAplicada.current = { cfop: sugestao.cfop_padrao_sugerido, csosn: sugestao.csosn_sugerido };
    }, [show, schema]);

    // Família é a 1ª decisão do cadastro: se o operador já escolheu, a busca respeita e preenche os campos dela.
    const familiaEscolhida = useRef(false);
    useEffect(() => { if (show) familiaEscolhida.current = !!produto; }, [show, produto]);

    const ultimoEanAuto = useRef<string>('');  // último EAN consultado (não repete a consulta)
    const handleScanCodigo = async (codigo: string, force: boolean = false) => {
        ultimoEanAuto.current = codigo.replace(/\D/g, '');
        setShowScanner(false);
        setFormData(prev => ({ ...prev, codigo_barras: codigo }));
        setIsSearchingCosmos(true);
        setShowForceSync(false);
        const toastId = showToast.loading(force ? 'Buscando dados do produto…' : 'Consultando banco de dados de produtos...');
        try {
            const res = await cosmosService.lookup(codigo, force,
                familiaEscolhida.current ? formData.familia_produto || undefined : undefined);
            if (res.success && res.data) {
                const d = res.data;
                const s = d.sugestoes;
                // Produto novo recebe a família identificada (NCM → tipo → IA, só do mix da loja);
                // na edição a família já gravada não muda.
                const familiaNova = !produto && !familiaEscolhida.current && s?.familia_produto ? s.familia_produto : null;
                setFormData(prev => ({
                    ...prev,
                    nome: maiusculas(d.nome) || prev.nome,
                    // Não sobrescreve o que o usuário já escolheu; categoria casa com as da loja.
                    categoria: prev.categoria || maiusculas(s?.categoria || d.categoria),
                    // A sugestão já traz a SUBCATEGORIA oficial resolvida (ou nada): o servidor
                    // recusa texto livre, então só entra o que veio da lista.
                    subcategoria: prev.subcategoria || (s as any)?.subcategoria || '',
                    marca: maiusculas(d.marca) || prev.marca,
                    fabricante: prev.fabricante || maiusculas(d.fabricante),
                    descricao: prev.descricao || s?.descricao || '',
                    ncm: d.ncm || prev.ncm,
                    cest: d.cest || prev.cest,
                    imagem_url: prev.imagem_url || d.imagem_url || '',
                    familia_produto: familiaNova || prev.familia_produto,
                    preco_referencia_mercado: prev.preco_referencia_mercado || d.preco_referencia || 0,
                    // O que o lojista já digitou vale mais que a base.
                    atributos: { ...(s?.atributos || {}), ...prev.atributos },
                }));
                const preenchidos = [
                    d.nome && 'nome', d.marca && 'marca', d.ncm && 'NCM', familiaNova && 'família',
                    d.preco_referencia && 'preço de mercado', d.imagem_url && 'foto',
                    s && Object.keys(s.atributos || {}).length > 0 && `${Object.keys(s.atributos).length} atributo(s)`,
                ].filter(Boolean).join(', ');
                const origem = res.source === 'catalogo' ? 'catálogo' : 'base de produtos';
                const semNcm = d.ncm ? '' : ' Sem NCM: confira com a nota do fornecedor.';
                showToast.success(`Preenchido (${origem}): ${preenchidos}.${semNcm}`, { id: toastId });
            } else {
                // Mensagem verdadeira conforme a causa (não mais "não encontrado" genérico)
                const msg = res.message || 'Não foi possível consultar o produto.';
                if (res.code === 'interno') {
                    showToast.success('Código interno da loja: preencha nome e preço.', { id: toastId });
                } else if (res.code === 'nao_encontrado') {
                    showToast.error(msg, { id: toastId });
                    if (!force) setShowForceSync(true);
                } else {
                    // quota/token/conexão/api: alerta diferenciado — o problema NÃO é o produto
                    showToast.error(msg, { id: toastId, duration: 6000 });
                }
            }
        } catch {
            showToast.error('Falha inesperada ao consultar o produto.', { id: toastId });
        } finally {
            setIsSearchingCosmos(false);
        }
    };

    // Busca por nome (produto sem EAN ou que a base não conhece pelo código): lista para o operador escolher.
    const refResultadosNome = useRef<HTMLDivElement | null>(null);
    const buscarPorNome = async (termoInformado?: string) => {
        const termo = (termoInformado ?? formData.nome).trim();
        if (termo.length < 3) {
            showToast.error('Digite pelo menos 3 letras do nome para buscar.');
            return;
        }
        setBuscandoNome(true);
        setResultadosNome([]);
        try {
            const res = await cosmosService.buscarPorNome(termo);
            if (res.success && res.data?.length) {
                setResultadosNome(res.data);
                setTimeout(() => refResultadosNome.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
            } else {
                showToast.error(res.message || 'Nenhum produto encontrado com esse nome.');
            }
        } finally {
            setBuscandoNome(false);
        }
    };

    const escolherResultadoNome = (item: CatalogoBuscaItem) => {
        setResultadosNome([]);
        setFormData(prev => ({ ...prev, nome: maiusculas(item.nome) }));
        handleScanCodigo(item.ean);
    };

    // EAN digitado à mão (sem câmera) também consulta a base.
    const buscarEanDigitado = () => {
        const ean = formData.codigo_barras.replace(/\D/g, '');
        if (ean.length < 8) {
            showToast.error('Digite o código de barras completo (8 a 14 números).');
            return;
        }
        handleScanCodigo(ean);
    };

    // Código completo e válido no campo (leitor USB ou digitado) consulta sozinho, sem Enter nem lupa.
    useEffect(() => {
        if (!show || ehServico) return;
        const ean = formData.codigo_barras.replace(/\D/g, '');
        if (!gtinValido(ean) || ean === ultimoEanAuto.current || isSearchingCosmos) return;
        if (editMode && ean === (produto?.codigo_barras || '').replace(/\D/g, '')) return;
        const t = setTimeout(() => {
            ultimoEanAuto.current = ean;
            handleScanCodigo(ean);
        }, 600);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [formData.codigo_barras, show]);
    useEffect(() => { if (!show) ultimoEanAuto.current = ''; }, [show]);

    const gerarCodigoInterno = async () => {
        try {
            const codigo = await productsService.proximoCodigoBarras();
            setFormData(prev => ({ ...prev, codigo_barras: codigo }));
            setShowForceSync(false);
            showToast.success('Código interno gerado. Ele já sai na etiqueta e passa no leitor do PDV.');
        } catch {
            showToast.error('Não foi possível gerar o código agora.');
        }
    };

    // O que o lojista já escreveu na descrição vai junto: a IA aproveita e melhora.
    const gerarDescricaoIA = async () => {
        if (formData.nome.trim().length < 3) {
            showToast.error(ehServico ? 'Preencha o nome do serviço primeiro.' : 'Preencha o nome do produto primeiro.');
            return;
        }
        setGerandoDescricao(true);
        try {
            const descricao = await productsService.gerarDescricaoIA({
                nome: formData.nome,
                categoria: formData.categoria,
                marca: formData.marca,
                unidade_medida: formData.unidade_medida,
                tipo_item: formData.tipo_item,
                descricao_atual: formData.descricao,
            });
            setFormData(prev => ({ ...prev, descricao }));
            showToast.success('Descrição gerada pela IA. Revise antes de salvar.');
        } catch (err: any) {
            showToast.error(err?.response?.data?.message || 'Não foi possível gerar a descrição agora.');
        } finally {
            setGerandoDescricao(false);
        }
    };

    const calcularPrecoVenda = () => {
        const preco = formData.preco_custo * (1 + formData.margem_lucro / 100);
        setFormData(prev => ({ ...prev, preco_venda: parseFloat(preco.toFixed(2)) }));
    };

    // Blur do custo: com preço já digitado, preserva o preço e ajusta a margem.
    const aoSairDoCusto = () => {
        if (precoVendaManual.current && formData.preco_venda > 0) calcularMargem();
        else calcularPrecoVenda();
    };

    const calcularMargem = () => {
        if (formData.preco_custo > 0) {
            const margem = ((formData.preco_venda - formData.preco_custo) / formData.preco_custo) * 100;
            setFormData(prev => ({ ...prev, margem_lucro: parseFloat(margem.toFixed(2)) }));
        }
    };

    const field = (key: keyof typeof emptyForm, value: any) =>
        setFormData(prev => ({ ...prev, [key]: CAMPOS_MAIUSCULOS.has(key) && typeof value === 'string' ? value.toUpperCase() : value }));

    // Auto-focus: o cursor sempre no próximo campo que exige decisão.
    // EAN ao abrir; preço de custo assim que o lookup preenche; nome quando
    // ninguém conhece o produto (caminho manual orientado).
    const refEan = useRef<HTMLInputElement | null>(null);
    const refNome = useRef<HTMLInputElement | null>(null);
    const refPrecoCusto = useRef<HTMLInputElement | null>(null);
    const focoComAtraso = (el: HTMLInputElement | null) =>
        setTimeout(() => el?.focus(), 60);
    useEffect(() => {
        if (show && !produto) setTimeout(() => refEan.current?.focus(), 120);
    }, [show, produto]);
    useEffect(() => {
        if (show && !produto && !isSearchingCosmos) {
            if (formData.nome && !formData.preco_custo) {
                focoComAtraso(refPrecoCusto.current);
            } else if (!formData.nome) {
                focoComAtraso(refNome.current);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isSearchingCosmos]);

    // Pré-visualização do custo estimado (modos mercado/venda): mesma matemática
    // do servidor (precificacao_reversa.py) — só para exibição; o servidor
    // recalcula com Decimal no salvar. Zerado para serviço e modo custo.
    const ehModoEstimado = !ehServico && formData.modo_precificacao !== 'custo';
    const preview = useMemo(
        () => ehModoEstimado
            ? (formData.modo_precificacao === 'mercado'
                ? calcularModoMercado({
                    precoReferencia: formData.preco_referencia_mercado || null,
                    descontoPct: formData.desconto_mercado_pct,
                    margemAlvoVendaPct: formData.margem_alvo_venda_pct,
                })
                : calcularModoVenda(formData.preco_venda || null, formData.margem_alvo_venda_pct))
            : { venda: 0, custo: 0, markup: 0, erro: null },
        [ehModoEstimado, formData.modo_precificacao, formData.preco_referencia_mercado,
         formData.desconto_mercado_pct, formData.margem_alvo_venda_pct, formData.preco_venda],
    );

    const setAtributo = (chave: string, valor: any) =>
        setFormData(prev => ({ ...prev, atributos: { ...prev.atributos, [chave]: valor } }));

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // Validações obrigatórias
        if (!formData.nome.trim()) { showToast.error(ehServico ? 'Nome do serviço é obrigatório' : 'Nome do produto é obrigatório'); return; }
        if (!formData.subcategoria.trim()) {
            showToast.error('Escolha a subcategoria oficial da família antes de salvar');
            return;
        }
        // Modos mercado/venda: o custo é ESTIMADO no servidor — não exigir custo
        // digitado; exigir os insumos do modo em vez disso.
        const custoEstimado = !ehServico && formData.modo_precificacao !== 'custo';
        if (!ehServico && !custoEstimado && (!formData.preco_custo || formData.preco_custo <= 0)) { showToast.error('Preço de custo inválido'); return; }
        if (custoEstimado && formData.modo_precificacao === 'mercado') {
            if (!formData.preco_referencia_mercado || formData.preco_referencia_mercado <= 0) {
                showToast.error('Informe o preço de referência do mercado');
                return;
            }
            const erroMargem = validarMargemAlvoVendaPct(formData.margem_alvo_venda_pct);
            if (formData.margem_alvo_venda_pct !== null && erroMargem) {
                showToast.error(erroMargem);
                return;
            }
            const erroDesconto = validarDescontoMercadoPct(formData.desconto_mercado_pct);
            if (formData.desconto_mercado_pct !== null && erroDesconto) {
                showToast.error(erroDesconto);
                return;
            }
        }
        if (custoEstimado && formData.modo_precificacao === 'venda') {
            if (!formData.preco_venda || formData.preco_venda <= 0) { showToast.error('Preço de venda inválido'); return; }
            const erroMargem = validarMargemAlvoVendaPct(formData.margem_alvo_venda_pct);
            if (formData.margem_alvo_venda_pct !== null && erroMargem) {
                showToast.error(erroMargem);
                return;
            }
        }
        if (!ehServico && !custoEstimado && (!formData.preco_venda || formData.preco_venda <= 0)) { showToast.error('Preço de venda inválido'); return; }
        if (!ehServico && formData.icms_st && formData.cest.length !== 7) {
            showToast.error('Produto com ICMS por substituição tributária (ST) precisa do CEST com 7 dígitos. Peça ao contador ou veja na nota do fornecedor.');
            return;
        }

        // Validade da família (só no cadastro novo com estoque; na edição a validade é dos lotes).
        const flagsFamilia = schema?.flags;
        const pedeValidade = !editMode && !ehServico && !!flagsFamilia?.usa_validade;
        if (pedeValidade && Number(formData.quantidade) > 0) {
            const nomeFamilia = schema?.familia_produto?.nome || 'esta família';
            if (flagsFamilia?.validade_obrigatoria && !formData.data_validade) {
                showToast.error(`Informe a data de validade: em ${nomeFamilia} ela é obrigatória quando entra estoque.`);
                return;
            }
            if (flagsFamilia?.exige_fabricacao && !formData.data_fabricacao) {
                showToast.error(`Informe a data de fabricação: em ${nomeFamilia} ela é obrigatória quando entra estoque.`);
                return;
            }
        }
        if (pedeValidade && formData.data_fabricacao && formData.data_validade
            && formData.data_fabricacao >= formData.data_validade) {
            showToast.error('A data de fabricação precisa ser anterior à validade.');
            return;
        }

        // Guardião: produto físico novo com estoque zero só entra por exceção consciente
        // (vai para a Lista de Revisão do dono). Sem isso o servidor recusa o cadastro.
        let entrarSemEstoque = false;
        if (!editMode && !ehServico && !(Number(formData.quantidade) > 0)) {
            entrarSemEstoque = await confirmar({
                titulo: 'Cadastrar sem estoque?',
                mensagem: 'Com estoque zero o PDV não vende este produto. Ele entra na Lista de Revisão para você dar entrada quando a mercadoria chegar.',
                acao: 'Entrar sem estoque agora',
                cancelar: 'Informar a quantidade',
            });
            if (!entrarSemEstoque) return;
        }

        const payload: any = {
            ...formData,
            // Só a CHAVE oficial vai para o servidor; o nome da categoria fica no formulário.
            subcategoria: formData.subcategoria,
            controlar_estoque: !ehServico,
            ...(entrarSemEstoque ? { entrar_sem_estoque: true } : {}),
        };
        // `categoria` era o texto livre antigo: o servidor não aceita mais (PLANO §3.3).
        delete payload.categoria;
        // A categoria oficial é DERIVADA da subcategoria no servidor: mandar as duas abriria
        // a porta para um par incoerente (subcategoria de uma árvore, categoria de outra).
        delete payload.categoria_oficial;
        if (!pedeValidade) {
            // Edição (validade vive nos lotes) ou família que não vence: nada de datas no payload.
            delete payload.data_validade;
            delete payload.data_fabricacao;
            delete payload.lote;
        } else {
            for (const chave of ['data_validade', 'data_fabricacao', 'lote']) {
                if (!payload[chave]) delete payload[chave];
            }
        }
        // Modo custo: insumos dos modos estimados fora do payload (servidor
        // grava informado; payload com origem_custo é ignorado de qualquer jeito).
        if (ehServico || formData.modo_precificacao === 'custo') {
            delete payload.modo_precificacao;
            delete payload.preco_referencia_mercado;
            delete payload.desconto_mercado_pct;
            delete payload.margem_alvo_venda_pct;
            delete payload.fonte_referencia_mercado;
        }
        if (ehServico) {
            payload.quantidade = 0;
            payload.quantidade_minima = 0;
            // Serviço pode ter custo zero (mão de obra pura)
            payload.preco_custo = formData.preco_custo || 0;
        }

        setLoading(true);
        try {
            if (editMode && produto) {
                await showToast.promise(productsService.update(produto.id, payload), {
                    loading: 'Atualizando...',
                    success: ehServico ? 'Serviço atualizado!' : 'Produto atualizado!',
                    error: 'Erro ao atualizar',
                }, { theme: 'warning' });
                onSuccess();
            } else {
                // Criar produto — tratando 409 (EAN duplicado) explicitamente
                const result = await productsService.create(payload);

                if (!result.success && (result.code === 'PRODUTO_DUPLICADO_EAN' || result.code === 'PRODUTO_DUPLICADO_CODIGO')) {
                    const existente = result.produto_existente;
                    const msg = existente
                        ? `Este produto já está cadastrado como "${existente.nome}" (id ${existente.id}). Edite o produto existente para atualizar estoque ou preço.`
                        : result.message || 'Produto já cadastrado com este EAN.';
                    showToast.error(msg, { duration: 8000 });
                    return; // Não chama onSuccess, não fecha o modal
                }

                if (!result.success) {
                    // Guardião devolve os motivos em `errors`: mostra o primeiro, que ensina o que corrigir.
                    const motivos = (result as any).errors as string[] | undefined;
                    showToast.error(motivos?.[0] || result.message || 'Erro ao salvar', { duration: 8000 });
                    return;
                }

                const criado = result.produto;
                if (!ehServico && criado && onPrintLabel) {
                    showToast.successAction('Produto cadastrado com sucesso!', 'Imprimir etiqueta', () => onPrintLabel(criado));
                } else {
                    showToast.success(ehServico ? 'Serviço cadastrado com sucesso!' : 'Produto cadastrado com sucesso!');
                }
                onSuccess();
            }
        } catch (err: any) {
            showToast.error(err?.response?.data?.message || 'Erro ao salvar');
        } finally {
            setLoading(false);
        }
    };

    if (!show) return null;

    const inputClass = 'w-full px-4 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-gray-900 dark:text-white';
    const labelClass = 'block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1';
    const sectionClass = 'p-5 bg-gray-50 dark:bg-gray-900/50 rounded-2xl border border-gray-100 dark:border-gray-800 space-y-4';

    const regrasFiscais = schema?.regras_fiscais;
    const regrasSt = regrasFiscais?.icms_st;
    const itemMonofasico = ncmMonofasico(formData.ncm, regrasFiscais);
    const cestFaltando = formData.icms_st && formData.cest.length !== 7;
    const ncmExemplos = schema?.sugestao_fiscal?.ncm_exemplos || [];

    const titulo = editMode
        ? (ehServico ? 'Editar Serviço' : 'Editar Produto')
        : (ehServico ? 'Novo Serviço' : 'Novo Produto');

    return (
        <ResponsiveModal
            isOpen={show}
            onClose={onClose}
            title={titulo}
            subtitle={editMode ? `ID: ${produto?.id}` : 'Preencha todos os campos obrigatórios (*)'}
            headerIcon={<Sparkles className="w-6 h-6" />}
            headerColor="blue"
            size="xl"
            footer={
                <div className="flex w-full sm:w-auto gap-3">
                    <button type="button" onClick={onClose}
                        className="flex-1 sm:flex-none px-4 sm:px-6 py-3 text-gray-600 dark:text-gray-400 font-bold whitespace-nowrap hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-all">
                        Cancelar
                    </button>
                    <button onClick={handleSubmit} disabled={loading || isSearchingCosmos}
                        className="flex-[2] sm:flex-none px-5 sm:px-8 py-3 bg-blue-600 text-white rounded-xl font-bold whitespace-nowrap hover:bg-blue-700 disabled:opacity-50 shadow-lg shadow-blue-500/20 active:scale-95 transition-all">
                        {loading ? 'Salvando...' : (ehServico ? 'Salvar Serviço' : 'Salvar Produto')}
                    </button>
                </div>
            }
        >
            <form onSubmit={handleSubmit} className="space-y-8">

                {/* Toggle Produto/Serviço — só aparece se o segmento habilita serviços */}
                {schemaHelpers.usaServicos(schema) && (
                    <div className="grid grid-cols-2 gap-3">
                        {(schema?.tipos_item || ['produto']).map(t => {
                            const ativo = formData.tipo_item === t;
                            const Icone = t === 'servico' ? Wrench : Package;
                            return (
                                <button key={t} type="button" disabled={editMode}
                                    onClick={() => setFormData(prev => ({
                                        ...prev,
                                        tipo_item: t,
                                        familia_produto: t === 'servico'
                                            ? 'servico'
                                            : (prev.familia_produto && prev.familia_produto !== 'servico'
                                                ? prev.familia_produto
                                                : (schema?.familias_disponiveis?.find(f => f.chave !== 'servico')?.chave || '')),
                                    }))}
                                    className={`flex items-center justify-center gap-3 p-4 rounded-2xl border-2 font-bold transition-all ${ativo
                                        ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                                        : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:border-blue-300'
                                        } ${editMode ? 'opacity-60 cursor-not-allowed' : ''}`}>
                                    <Icone className="w-5 h-5" />
                                    {t === 'servico' ? 'Serviço' : 'Produto'}
                                </button>
                            );
                        })}
                    </div>
                )}

                {/* Banner cadastro inteligente — só p/ produto físico com código de barras */}
                {!editMode && !ehServico && visivel('codigo_barras') && (
                    <button type="button" onClick={() => setShowScanner(true)}
                        className="w-full flex items-center justify-between p-4 bg-linear-to-r from-blue-600 to-indigo-700 text-white rounded-2xl shadow-md hover:shadow-xl transition-all group relative overflow-hidden">
                        <div className="flex items-center gap-4 z-10">
                            <div className="p-3 bg-white/20 rounded-xl backdrop-blur-md">
                                <Camera className="w-6 h-6" />
                            </div>
                            <div className="text-left">
                                <h4 className="font-bold text-lg">Cadastro Inteligente</h4>
                                <p className="text-xs text-blue-100">Escanear código de barras e buscar dados automaticamente</p>
                            </div>
                        </div>
                        <Sparkles className="w-8 h-8 opacity-20 group-hover:scale-125 transition-transform duration-500" />
                    </button>
                )}

                {/* ── Seção 1: Identificação ── */}
                <div>
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Identificação</h4>
                    <div className={sectionClass}>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {/* Família vem primeiro: é ela que decide os campos, exemplos e
                                sugestão fiscal do resto do formulário — faz sentido perguntar
                                antes do nome, não depois. Só aparece quando há 2+ famílias no
                                mix do tenant; com 1 só, fica fixa pelo segmento (sem escolha). */}
                            {familiasDisponiveis.length > 1 && (
                                <div className="sm:col-span-2">
                                    <label className={`${labelClass} flex items-center gap-1`}>
                                        Família do Item *
                                        <CampoAjuda texto="Define que tipo de item é este (alimento, bebida, peça, etc). A partir daqui o formulário se adapta: campos, exemplos e até a sugestão fiscal (CFOP/CSOSN) mudam de acordo com a família escolhida." />
                                    </label>
                                    <select
                                        value={formData.familia_produto}
                                        onChange={e => {
                                            familiaEscolhida.current = true;
                                            const familiaNova = e.target.value;
                                            // Troca de família limpa a subcategoria que não pertence à nova
                                            // (PLANO §4 item 2 / regra 7 do §1) e avisa por toast.
                                            setFormData(prev => {
                                                const pertence = !prev.subcategoria
                                                    || prev.subcategoria.startsWith(`${familiaNova}.`);
                                                if (!pertence) {
                                                    showToast.error('A subcategoria escolhida é de outra família. Escolha uma da lista nova.');
                                                    return { ...prev, familia_produto: familiaNova, subcategoria: '', categoria: '', categoria_oficial: '' };
                                                }
                                                return { ...prev, familia_produto: familiaNova };
                                            });
                                        }}
                                        className={inputClass}
                                        disabled={editMode && ehServico}
                                    >
                                        {familiasDisponiveis.map(familia => (
                                            <option key={familia.chave} value={familia.chave}>
                                                {familia.nome}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}
                            <div className="sm:col-span-2">
                                <label className={labelClass}>{ehServico ? 'Nome do Serviço *' : 'Nome do Produto *'}</label>
                                <div className="flex gap-2">
                                    <input type="text" value={formData.nome} required
                                        ref={refNome}
                                        onChange={e => field('nome', e.target.value)}
                                        onKeyDown={e => {
                                            // No cadastro novo, Enter/"Ir" do teclado do celular busca em vez de salvar pela metade.
                                            if (e.key === 'Enter' && !ehServico && !editMode) { e.preventDefault(); buscarPorNome(); }
                                        }}
                                        enterKeyHint={!ehServico && !editMode ? 'search' : undefined}
                                        className={inputClass}
                                        placeholder={ehServico ? exemplos.nome_servico : exemplos.nome} />
                                    {!ehServico && (
                                        <button type="button" onClick={() => buscarPorNome()} disabled={buscandoNome}
                                            aria-label="Buscar produto pelo nome"
                                            title="Buscar pelo nome na base de produtos"
                                            className="shrink-0 px-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 text-blue-600 shadow-sm flex items-center gap-1.5 text-xs font-bold disabled:opacity-60 disabled:cursor-wait">
                                            {buscandoNome ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
                                            <span className="hidden sm:inline">Buscar</span>
                                        </button>
                                    )}
                                </div>
                                {resultadosNome.length > 0 && (
                                    <div ref={refResultadosNome} className="mt-2 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 shadow-sm divide-y divide-gray-100 dark:divide-gray-700 max-h-72 overflow-y-auto overscroll-contain">
                                        <div className="flex items-center justify-between px-3 py-2">
                                            <span className="text-xs font-bold text-gray-500 dark:text-gray-400">Toque no produto certo</span>
                                            <button type="button" onClick={() => setResultadosNome([])}
                                                className="text-xs font-bold text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1">
                                                Fechar
                                            </button>
                                        </div>
                                        {resultadosNome.map(item => (
                                            <button type="button" key={item.ean} onClick={() => escolherResultadoNome(item)}
                                                className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-blue-50 dark:hover:bg-blue-900/20 active:bg-blue-100 dark:active:bg-blue-900/40">
                                                {item.imagem_url
                                                    ? <img src={item.imagem_url} alt="" loading="lazy" className="w-10 h-10 rounded-lg object-contain bg-white shrink-0" />
                                                    : <span className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center shrink-0"><Package className="w-5 h-5 text-gray-400" /></span>}
                                                <span className="min-w-0 flex-1">
                                                    <span className="block text-sm font-semibold text-gray-900 dark:text-white leading-snug">{item.nome}</span>
                                                    <span className="block text-xs text-gray-500 dark:text-gray-400 font-mono">
                                                        {item.marca ? `${item.marca} · ` : ''}{item.ean}
                                                    </span>
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                                {!ehServico && /^[0-9]{7,14}$/.test(formData.nome.trim()) && (
                                    <p className="mt-1 text-xs font-medium text-amber-600 dark:text-amber-400 flex items-center gap-1">
                                        ⚠ Isso parece um código de barras, não um nome. Escaneie o EAN ou busque que o sistema preenche os dados para você.
                                    </p>
                                )}
                                {!ehServico && formData.codigo_barras && formData.nome.trim() && formData.nome.replace(/\D/g, '') === formData.codigo_barras.replace(/\D/g, '') && (
                                    <p className="mt-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                                        ⚠ O nome não pode ser igual ao código de barras — o servidor recusará. Use o botão de câmera para buscar os dados reais.
                                    </p>
                                )}
                            </div>
                            {!ehServico && visivel('codigo_barras') && (
                                <div>
                                    <label className={labelClass}>Código de Barras</label>
                                    <div className="flex gap-2">
                                        <input type="text" value={formData.codigo_barras}
                                                ref={(el) => { refEan.current = el; }}
                                                onChange={e => {
                                                field('codigo_barras', e.target.value);
                                                setShowForceSync(false);
                                            }}
                                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); buscarEanDigitado(); } }}
                                            inputMode="numeric" enterKeyHint="search"
                                            className={`${inputClass} font-mono`} placeholder="EAN-13 / EAN-8" />
                                        {formData.codigo_barras.replace(/\D/g, '').length >= 8 && (
                                            <button type="button" onClick={buscarEanDigitado} disabled={isSearchingCosmos}
                                                aria-label="Buscar dados pelo código de barras"
                                                className="p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 text-blue-600 shadow-sm dark:hover:bg-gray-700 disabled:opacity-60">
                                                {isSearchingCosmos ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
                                            </button>
                                        )}
                                        <button type="button" onClick={() => setShowScanner(true)}
                                            className="p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 text-blue-600 shadow-sm dark:hover:bg-gray-700">
                                            <Camera className="w-5 h-5" />
                                        </button>
                                    </div>
                                    {!formData.codigo_barras.trim() && (
                                        <button type="button" onClick={gerarCodigoInterno}
                                            className="mt-2 w-full py-2 px-3 text-xs font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 border border-emerald-200 dark:border-emerald-800 rounded-lg flex items-center justify-center gap-2 transition-colors">
                                            <Wand2 className="w-4 h-4" />
                                            Sem código? Gerar código interno
                                        </button>
                                    )}
                                    {showForceSync && formData.codigo_barras && (
                                        <button type="button" onClick={() => handleScanCodigo(formData.codigo_barras, true)}
                                            className="mt-2 w-full py-2 px-3 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg flex items-center justify-center gap-2 transition-colors">
                                            <Sparkles className="w-4 h-4" />
                                            Buscar novamente na base de produtos
                                        </button>
                                    )}
                                </div>
                            )}
                            <div className="min-w-0">
                                <CategoriaPicker
                                    taxonomia={schema?.taxonomia || []}
                                    value={formData.subcategoria}
                                    onChange={(escolha) => setFormData(prev => ({
                                        ...prev,
                                        // Os DOIS níveis da taxonomia: a subcategoria manda, a categoria
                                        // é a dona dela na árvore (o servidor grava as duas chaves).
                                        subcategoria: escolha.subcategoria.chave,
                                        categoria_oficial: escolha.categoria.chave,
                                        categoria: escolha.subcategoria.nome,
                                    }))}
                                    erro={editMode && produto && !(produto as any).subcategoria_oficial
                                        ? 'Produto antigo sem subcategoria oficial: escolha categoria e subcategoria antes de salvar.'
                                        : null}
                                />
                            </div>
                            {visivel('marca') && !ehServico && (
                                <div>
                                    <label className={labelClass}>Marca / Fabricante</label>
                                    <input type="text" value={formData.marca}
                                        onChange={e => field('marca', e.target.value)}
                                        className={inputClass} placeholder={exemplos.marca} />
                                </div>
                            )}
                            {!ehServico && visivel('unidade_medida') && (
                                <div>
                                    <label className={labelClass}>Unidade de Medida</label>
                                    <select value={formData.unidade_medida}
                                        onChange={e => field('unidade_medida', e.target.value)}
                                        className={inputClass}>
                                        {unidades.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
                                    </select>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* ── Atributos do Segmento (100% dirigido pelo View Schema) ── */}
                {gruposAtributos.map(({ grupo, label, campos }) => (
                    <div key={grupo}>
                        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">{label}</h4>
                        <div className={sectionClass}>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {campos.map(campo => (
                                    <SchemaField
                                        key={campo.chave}
                                        campo={campo}
                                        value={formData.atributos[campo.chave]}
                                        onChange={v => setAtributo(campo.chave, v)}
                                        inputClass={inputClass}
                                        labelClass={labelClass}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>
                ))}

                {/* ── Seção Tributação — schema decide; serviço não emite NFC-e de produto ── */}
                {!ehServico && visivel('fiscal') && (
                    <div>
                        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Tributação (NFC-e / NF-e)</h4>
                        <div className={sectionClass}>
                            {schema?.sugestao_fiscal && (
                                <div className="mb-4 flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                                    <span className="font-bold shrink-0">⚠ Sugestão automática por segmento</span>
                                    <span>
                                        CFOP/CSOSN pré-preenchidos pela família do item — revise com seu contador antes
                                        de emitir em produção.
                                        {schema.sugestao_fiscal.observacao_fiscal ? ` ${schema.sugestao_fiscal.observacao_fiscal}` : ''}
                                    </span>
                                </div>
                            )}
                            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                                <div>
                                    <label className={`${labelClass} flex items-center gap-1`}>
                                        NCM
                                        <CampoAjuda texto="Código fiscal de 8 dígitos que classifica o produto perante a Receita (Nomenclatura Comum do Mercosul). Se você escaneou o código de barras, geralmente já vem preenchido pela base de produtos. Sem ele, a nota fiscal não pode ser emitida." />
                                    </label>
                                    <input type="text" inputMode="numeric" maxLength={8} value={formData.ncm}
                                        onChange={e => field('ncm', e.target.value.replace(/\D/g, '').slice(0, 8))}
                                        className={`${inputClass} ${formData.ncm && formData.ncm.length !== 8 ? 'border-amber-400' : ''}`}
                                        placeholder="8 dígitos" />
                                    {formData.ncm && formData.ncm.length !== 8 && (
                                        <p className="text-xs text-amber-600 mt-1">Deve ter 8 dígitos.</p>
                                    )}
                                    {itemMonofasico && (
                                        <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-1">
                                            PIS/COFINS monofásico: o imposto já foi pago pela fábrica. No Simples, essa venda é separada no PGDAS; no lucro presumido/real, a nota sai com CST 04.
                                        </p>
                                    )}
                                </div>
                                <div>
                                    <label className={`${labelClass} flex items-center gap-1`}>
                                        CEST
                                        <CampoAjuda texto="Código Especificador da Substituição Tributária — só é obrigatório se o seu produto está sujeito a ICMS-ST (o aviso acima indica quando isso é comum). Se não souber, deixe em branco e confirme com seu contador." />
                                    </label>
                                    <input type="text" inputMode="numeric" maxLength={7} value={formData.cest}
                                        onChange={e => field('cest', e.target.value.replace(/\D/g, '').slice(0, 7))}
                                        className={`${inputClass} ${cestFaltando ? 'border-red-400' : ''}`}
                                        placeholder={formData.icms_st ? 'Obrigatório com ST' : '7 dígitos'} />
                                    {cestFaltando && (
                                        <p className="text-xs text-red-600 mt-1">Com ST o CEST é obrigatório (7 dígitos).</p>
                                    )}
                                </div>
                                <div>
                                    <label className={`${labelClass} flex items-center gap-1`}>
                                        CFOP Padrão
                                        <CampoAjuda texto="Código Fiscal de Operações e Prestações — identifica o tipo de operação na nota (ex.: 5102 = venda de mercadoria comprada de terceiros dentro do seu estado). Já vem sugerido pela família do item; normalmente não precisa mudar." />
                                    </label>
                                    <input type="text" inputMode="numeric" maxLength={4}
                                        value={formData.icms_st ? (regrasSt?.cfop || '5405') : formData.cfop_padrao}
                                        disabled={formData.icms_st}
                                        onChange={e => field('cfop_padrao', e.target.value.replace(/\D/g, '').slice(0, 4))}
                                        className={`${inputClass} disabled:opacity-60`} placeholder="Ex: 5102" />
                                </div>
                                <div>
                                    <label className={`${labelClass} flex items-center gap-1`}>
                                        CSOSN (Simples)
                                        <CampoAjuda texto="Código de Situação da Operação no Simples Nacional — define como o ICMS é tratado na nota para quem está no Simples. Se seu regime tributário não é Simples Nacional, o sistema usa o CST em vez deste campo (configurável em Configurações → Fiscal)." />
                                    </label>
                                    <input type="text" inputMode="numeric" maxLength={3}
                                        value={formData.icms_st ? (regrasSt?.csosn || '500') : formData.csosn}
                                        disabled={formData.icms_st}
                                        onChange={e => field('csosn', e.target.value.replace(/\D/g, '').slice(0, 3))}
                                        className={`${inputClass} disabled:opacity-60`} placeholder="Ex: 102" />
                                </div>
                            </div>
                            {ncmExemplos.length > 0 && (
                                <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                                    NCM comuns nesta família (confira na embalagem ou na nota do fornecedor):{' '}
                                    {ncmExemplos.map(ex => `${ex.descricao} ${formatarNcm(ex.ncm)}`).join(' · ')}
                                </p>
                            )}
                            <div className={`mt-4 rounded-lg border px-3 py-3 ${schema?.sugestao_fiscal?.icms_st_a_confirmar && !formData.icms_st
                                ? 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/20'
                                : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'}`}>
                                <label htmlFor="icms-st-check" className="flex items-start gap-3 cursor-pointer">
                                    <input type="checkbox" id="icms-st-check" checked={formData.icms_st}
                                        onChange={e => field('icms_st', e.target.checked)}
                                        className="mt-0.5 w-4 h-4 text-blue-600 rounded" />
                                    <span className="text-sm text-gray-800 dark:text-gray-200">
                                        <span className="font-semibold">ICMS recolhido por substituição tributária (ST)</span>
                                        <span className="block text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                                            {formData.icms_st
                                                ? `A nota sai com CSOSN ${regrasSt?.csosn || '500'} (Simples) ou CST ${regrasSt?.cst_icms || '60'} (regime normal) e CFOP ${regrasSt?.cfop || '5405'}. O CEST é obrigatório.`
                                                : schema?.sugestao_fiscal?.icms_st_a_confirmar
                                                    ? 'Este item tem ST no seu estado? Confirme com o contador se este NCM tem ST e, se tiver, marque aqui.'
                                                    : 'Marque só se o contador confirmar que este produto tem ST no seu estado.'}
                                        </span>
                                    </span>
                                </label>
                            </div>
                        </div>
                    </div>
                )}

                {/* ── Seção 3: Precificação ── */}
                <div>
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Precificação e Lucro</h4>
                    {/* Seletor de modo (precificação reversa, Fase A): só p/ produto físico.
                        'custo' = tradicional (custo → margem → venda); 'mercado'/'venda' =
                        a venda vem primeiro e o SERVIDOR estima o custo (nunca confiável). */}
                    {!ehServico && (
                        <div className="grid grid-cols-3 gap-3 mb-4">
                            {([
                                { chave: 'custo', label: 'Tenho o custo', desc: 'Custo → venda' },
                                { chave: 'venda', label: 'Defino a venda', desc: 'Venda → custo estimado' },
                                { chave: 'mercado', label: 'Pelo mercado', desc: 'Referência → custo estimado' },
                            ] as const).map(m => {
                                const ativo = formData.modo_precificacao === m.chave;
                                return (
                                    <button key={m.chave} type="button"
                                        onClick={() => setFormData(prev => ({ ...prev, modo_precificacao: m.chave }))}
                                        className={`p-3 rounded-2xl border-2 text-left transition-all ${ativo
                                            ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/20'
                                            : 'border-gray-200 dark:border-gray-700 hover:border-blue-300'}`}>
                                        <span className={`block text-sm font-bold ${ativo ? 'text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'}`}>{m.label}</span>
                                        <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">{m.desc}</span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 p-6 bg-blue-50/50 dark:bg-blue-900/10 rounded-2xl border border-blue-100/50 dark:border-blue-900/30">
                    {formData.modo_precificacao === 'mercado' && !ehServico ? (
                        <>
                            <div>
                                <label className="block text-sm font-semibold text-blue-800 dark:text-blue-300 mb-1">
                                    Preço de referência no mercado (R$) *
                                </label>
                                <input type="number" step="0.01" min="0.01" required
                                    value={formData.preco_referencia_mercado}
                                    onChange={e => field('preco_referencia_mercado', parseFloat(e.target.value) || 0)}
                                    className={`${inputClass} text-lg font-semibold border-blue-200 dark:border-blue-800`}
                                    placeholder="Ex: 100,00 (Shopee/ML)" />
                                <div className="mt-1">
                                    <label className="block text-xs text-blue-700 dark:text-blue-400 mb-1">Onde viu esse preço</label>
                                    <select value={formData.fonte_referencia_mercado}
                                        onChange={e => field('fonte_referencia_mercado', e.target.value)}
                                        className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white">
                                        <option value="shopee">Shopee</option>
                                        <option value="mercado_livre">Mercado Livre</option>
                                        <option value="outro">Outro</option>
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-blue-800 dark:text-blue-300 mb-1">
                                    Desconto vs. mercado (%)
                                </label>
                                <input type="number" step="0.01" min="0" max="99.99"
                                    value={formData.desconto_mercado_pct ?? ''}
                                    onChange={e => field('desconto_mercado_pct', e.target.value === '' ? null : parseFloat(e.target.value))}
                                    className={`${inputClass} text-lg font-semibold border-blue-200 dark:border-blue-800`}
                                    placeholder="Padrão da loja" />
                                <p className="text-xs text-blue-500 mt-1">Vazio = usa o padrão da loja (Configurações).</p>
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-blue-800 dark:text-blue-300 mb-1">
                                    Margem alvo sobre a venda (%)
                                </label>
                                <input type="number" step="0.01" min="0.01" max="99.99"
                                    value={formData.margem_alvo_venda_pct ?? ''}
                                    onChange={e => field('margem_alvo_venda_pct', e.target.value === '' ? null : parseFloat(e.target.value))}
                                    className={`${inputClass} text-lg font-semibold border-blue-200 dark:border-blue-800`}
                                    placeholder="Padrão da loja" />
                                <p className="text-xs text-blue-500 mt-1">Vazio = usa o padrão da loja (Configurações).</p>
                            </div>
                            <div className="sm:col-span-3 flex items-center justify-between p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl">
                                <span className="text-sm text-amber-800 dark:text-amber-300">
                                    <span className="font-bold">Previsão:</span> vender por{' '}
                                    <strong>{preview.venda > 0 ? `R$ ${preview.venda.toFixed(2)}` : '—'}</strong> com custo estimado de{' '}
                                    <strong>{preview.custo > 0 ? `R$ ${preview.custo.toFixed(2)}` : '—'}</strong>
                                    {preview.erro && <span className="block text-xs text-amber-700 dark:text-amber-400 mt-0.5">{preview.erro}</span>}
                                </span>
                                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-amber-200 dark:bg-amber-800 text-amber-900 dark:text-amber-200 whitespace-nowrap">Custo estimado</span>
                            </div>
                        </>
                    ) : formData.modo_precificacao === 'venda' && !ehServico ? (
                        <>
                            <div className="sm:col-span-3 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl text-sm text-amber-800 dark:text-amber-300">
                                Você define o preço de venda e o sistema <strong>estima</strong> o custo pela margem alvo. Quando chegar a nota do fornecedor, atualize o custo real (ele volta a ser "informado").
                            </div>
                            <div className="sm:col-span-2">
                                <label className="block text-sm font-semibold text-blue-800 dark:text-blue-300 mb-1">Margem alvo sobre a venda (%)</label>
                                <input type="number" step="0.01" min="0.01" max="99.99"
                                    value={formData.margem_alvo_venda_pct ?? ''}
                                    onChange={e => field('margem_alvo_venda_pct', e.target.value === '' ? null : parseFloat(e.target.value))}
                                    className={`${inputClass} text-lg font-semibold border-blue-200 dark:border-blue-800`}
                                    placeholder="Padrão da loja" />
                                <p className="text-xs text-blue-500 mt-1">Vazio = usa o padrão da loja (Configurações).</p>
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-blue-800 dark:text-blue-300 mb-1">Custo estimado</label>
                                <div className="w-full px-4 py-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl text-lg font-semibold text-amber-800 dark:text-amber-300">
                                    {preview.custo > 0 ? `R$ ${preview.custo.toFixed(2)}` : '—'}
                                </div>
                                {preview.erro && <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">{preview.erro}</p>}
                            </div>
                        </>
                    ) : (
                        <>
                        <div>
                            <label className="block text-sm font-semibold text-blue-800 dark:text-blue-300 mb-1">
                                {ehServico ? 'Custo do Serviço (R$)' : 'Preço de Custo (R$) *'}
                            </label>
                            <input type="number" step="0.01" min={ehServico ? '0' : '0.01'} required={!ehServico}
                                ref={refPrecoCusto}
                                value={formData.preco_custo || ''} placeholder="0"
                                onChange={e => {
                                    // Ao vivo: sem preço digitado, o preço acompanha custo × margem;
                                    // com preço digitado, o preço fica e a margem se ajusta.
                                    const custo = parseFloat(e.target.value) || 0;
                                    setFormData(prev => precoVendaManual.current && prev.preco_venda > 0
                                        ? { ...prev, preco_custo: custo, margem_lucro: custo > 0 ? parseFloat((((prev.preco_venda - custo) / custo) * 100).toFixed(2)) : prev.margem_lucro }
                                        : { ...prev, preco_custo: custo, preco_venda: parseFloat((custo * (1 + prev.margem_lucro / 100)).toFixed(2)) });
                                }}
                                onBlur={aoSairDoCusto}
                                className={`${inputClass} text-lg font-semibold border-blue-200 dark:border-blue-800`} />
                            {ehServico && <p className="text-xs text-blue-500 mt-1">Peças/insumos consumidos. Pode ser zero.</p>}
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-blue-800 dark:text-blue-300 mb-1">Margem de Lucro (%)</label>
                            <input type="number" step="0.1" min="0"
                                value={formData.margem_lucro}
                                onChange={e => {
                                    // Editar a margem é pedir preço calculado por ela.
                                    precoVendaManual.current = false;
                                    const margem = parseFloat(e.target.value) || 0;
                                    setFormData(prev => ({ ...prev, margem_lucro: margem,
                                        preco_venda: parseFloat((prev.preco_custo * (1 + margem / 100)).toFixed(2)) }));
                                }}
                                onBlur={() => { if (!precoVendaManual.current) calcularPrecoVenda(); }}
                                className={`${inputClass} text-lg font-semibold border-blue-200 dark:border-blue-800`} />
                        </div>
                        {ehServico || formData.modo_precificacao === 'custo' ? (
                        <div>
                            <label className="block text-sm font-semibold text-blue-800 dark:text-blue-300 mb-1">
                                {ehServico ? 'Preço Cobrado (R$) *' : 'Preço de Venda (R$) *'}
                            </label>
                            <input type="number" step="0.01" min="0.01" required
                                value={formData.preco_venda || ''} placeholder="0"
                                onChange={e => {
                                    precoVendaManual.current = true;
                                    const preco = parseFloat(e.target.value) || 0;
                                    setFormData(prev => ({ ...prev, preco_venda: preco,
                                        margem_lucro: prev.preco_custo > 0 ? parseFloat((((preco - prev.preco_custo) / prev.preco_custo) * 100).toFixed(2)) : prev.margem_lucro }));
                                }}
                                onBlur={calcularMargem}
                                className="w-full px-4 py-3 bg-blue-600 text-white border-transparent rounded-xl outline-none focus:ring-4 focus:ring-blue-500/30 text-lg font-bold shadow-lg shadow-blue-500/20" />
                        </div>
                        ) : null}
                        </>
                    )}
                    </div>
                </div>

                {/* ── Seção 4: Estoque — serviço não controla estoque ── */}
                {!ehServico && (
                    <div>
                        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Controle de Estoque</h4>
                        <div className={sectionClass}>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className={labelClass}>
                                        {editMode ? 'Estoque Atual' : 'Estoque inicial'}
                                    </label>
                                    <input type="number" min="0" step="any" value={formData.quantidade || ''} placeholder="0"
                                        onChange={e => field('quantidade', Math.max(0, parseFloat(e.target.value) || 0))}
                                        className={inputClass} />
                                    {!editMode && !formData.quantidade && (
                                        <p className="mt-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                                            ⚠ Estoque zero não vende no PDV. Informe a quantidade que chegou — ou será marcado para revisão.
                                        </p>
                                    )}
                                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                        {editMode
                                            ? 'Alterar aqui registra a diferença como movimentação de estoque (ajuste manual).'
                                            : 'Quanto já tem na loja agora. Com estoque zero o PDV não vende (salvo se a loja permitir venda sem estoque).'}
                                    </p>
                                </div>
                                {visivel('quantidade_minima') && (
                                    <div>
                                        <label className={labelClass}>Qtd. Mínima (Alerta)</label>
                                        <input type="number" min="0" value={formData.quantidade_minima || ''} placeholder="0"
                                            onChange={e => field('quantidade_minima', parseFloat(e.target.value) || 0)}
                                            className={inputClass} />
                                    </div>
                                )}
                            </div>
                            {!editMode && schema?.flags?.usa_validade && (
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                                    <div>
                                        <label className={labelClass}>
                                            Data de Validade{schema.flags.validade_obrigatoria && Number(formData.quantidade) > 0 ? ' *' : ''}
                                        </label>
                                        <input type="date" value={formData.data_validade}
                                            min={new Date().toISOString().slice(0, 10)}
                                            onChange={e => field('data_validade', e.target.value)}
                                            className={inputClass} />
                                    </div>
                                    <div>
                                        <label className={labelClass}>
                                            Data de Fabricação{schema.flags.exige_fabricacao && Number(formData.quantidade) > 0 ? ' *' : ''}
                                        </label>
                                        <input type="date" value={formData.data_fabricacao}
                                            max={new Date().toISOString().slice(0, 10)}
                                            onChange={e => field('data_fabricacao', e.target.value)}
                                            className={inputClass} />
                                    </div>
                                    <div>
                                        <label className={labelClass}>Lote</label>
                                        <input type="text" value={formData.lote} maxLength={50}
                                            onChange={e => field('lote', e.target.value.toUpperCase())}
                                            className={inputClass} placeholder="Da embalagem (ou automático)" />
                                    </div>
                                    <p className="sm:col-span-3 -mt-2 text-xs text-gray-500 dark:text-gray-400">
                                        O estoque inicial vira o primeiro lote com estas datas: entra no alerta de vencimento e o PDV vende o que vence antes.
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ── Seção 5: Imagem e descrição ── */}
                <div>
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Imagem e Detalhes</h4>
                    <div className={sectionClass}>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {visivel('imagem_url') && (
                                <div>
                                    <FotoUpload rotulo="Foto do produto" valor={formData.imagem_url}
                                        onChange={url => field('imagem_url', url)} pasta="produtos" />
                                </div>
                            )}
                            <div>
                                <div className="flex items-center justify-between gap-2 mb-1">
                                    <label className={`${labelClass} mb-0`}>Descrição / Observações</label>
                                    <button type="button" onClick={gerarDescricaoIA} disabled={gerandoDescricao}
                                        title="A IA escreve a descrição usando o nome, categoria e marca. Revise antes de salvar."
                                        className="shrink-0 py-1 px-2.5 text-xs font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/20 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 border border-indigo-200 dark:border-indigo-800 rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-60 disabled:cursor-wait">
                                        {gerandoDescricao
                                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                            : <Sparkles className="w-3.5 h-3.5" />}
                                        {gerandoDescricao ? 'Gerando...' : 'Gerar com IA'}
                                    </button>
                                </div>
                                <textarea value={formData.descricao} rows={3}
                                    onChange={e => field('descricao', e.target.value)}
                                    className={`${inputClass} resize-none`} placeholder="Informações adicionais..." />
                            </div>
                        </div>
                        <div className="flex items-center gap-3 pt-2">
                            <input type="checkbox" id="ativo-check" checked={formData.ativo}
                                onChange={e => field('ativo', e.target.checked)}
                                className="w-4 h-4 text-blue-600 rounded" />
                            <label htmlFor="ativo-check" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                {ehServico ? 'Serviço ativo (visível no PDV)' : 'Produto ativo (visível no PDV)'}
                            </label>
                        </div>
                    </div>
                </div>

            </form>

            {showScanner && (
                <BarcodeScanner onScan={handleScanCodigo} onClose={() => setShowScanner(false)}
                    onBuscarNome={ehServico ? undefined : (termo) => {
                        setShowScanner(false);
                        setFormData(prev => ({ ...prev, nome: maiusculas(termo) }));
                        buscarPorNome(termo);
                    }} />
            )}
        </ResponsiveModal>
    );
};

export default ProductFormModal;
