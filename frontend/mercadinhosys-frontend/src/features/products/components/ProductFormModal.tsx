import { useState, useEffect, useMemo, useRef } from 'react';
import { Camera, Sparkles, Package, Wrench, HelpCircle } from 'lucide-react';
import ResponsiveModal from '../../../components/ui/ResponsiveModal';
import SchemaField from '../../../components/schema/SchemaField';
import { showToast } from '../../../utils/toast';
import { Produto } from '../../../types';
import { TipoItem } from '../../../types/viewSchema';
import { productsService } from '../productsService';
import { cosmosService } from '../../../services/cosmosService';
import { useViewSchema, schemaHelpers } from '../../../services/viewSchemaService';
import BarcodeScanner from '../../pdv/components/BarcodeScanner';

interface ProductFormModalProps {
    show: boolean;
    editMode: boolean;
    produto: Produto | null;
    categorias: string[];
    onClose: () => void;
    onSuccess: () => void;
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

const emptyForm = {
    nome: '',
    codigo_barras: '',
    descricao: '',
    categoria: '',
    marca: '',
    fabricante: '',
    familia_produto: '',
    ncm: '',
    cest: '',
    cfop_padrao: '',
    csosn: '',
    tipo: '',
    tipo_item: 'produto' as TipoItem,
    unidade_medida: 'un',
    preco_custo: 0,
    preco_venda: 0,
    margem_lucro: 30,
    quantidade: 0,
    quantidade_minima: 10,
    ativo: true,
    imagem_url: '',
    atributos: {} as Record<string, any>,
};

const ProductFormModal = ({
    show,
    editMode,
    produto,
    categorias,
    onClose,
    onSuccess,
}: ProductFormModalProps) => {
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({ ...emptyForm });
    const [showScanner, setShowScanner] = useState(false);
    const [isSearchingCosmos, setIsSearchingCosmos] = useState(false);
    const [showForceSync, setShowForceSync] = useState(false);

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
        if (produto && editMode) {
            setFormData({
                nome: produto.nome || '',
                codigo_barras: produto.codigo_barras || '',
                descricao: produto.descricao || '',
                categoria: produto.categoria || '',
                marca: produto.marca || '',
                fabricante: produto.fabricante || '',
                familia_produto: produto.familia_produto || '',
                ncm: (produto as any).ncm || '',
                cest: (produto as any).cest || '',
                cfop_padrao: (produto as any).cfop_padrao || '',
                csosn: (produto as any).csosn || '',
                tipo: produto.tipo || '',
                tipo_item: (produto.tipo_item as TipoItem) || 'produto',
                unidade_medida: produto.unidade_medida || 'un',
                preco_custo: produto.preco_custo || 0,
                preco_venda: produto.preco_venda || 0,
                margem_lucro: produto.margem_lucro || 30,
                quantidade: produto.quantidade || 0,
                quantidade_minima: produto.quantidade_minima || 10,
                ativo: produto.ativo ?? true,
                imagem_url: produto.imagem_url || '',
                atributos: produto.atributos || {},
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

    const handleScanCodigo = async (codigo: string, force: boolean = false) => {
        setShowScanner(false);
        setFormData(prev => ({ ...prev, codigo_barras: codigo }));
        setIsSearchingCosmos(true);
        setShowForceSync(false);
        const toastId = showToast.loading(force ? 'Forçando busca na Sefaz/Cosmos...' : 'Consultando banco de dados de produtos...');
        try {
            const res = await cosmosService.lookup(codigo, force);
            if (res.success && res.data) {
                const d = res.data;
                setFormData(prev => ({
                    ...prev,
                    nome: d.nome || prev.nome,
                    descricao: d.categoria || prev.descricao,
                    marca: d.marca || prev.marca,
                    ncm: d.ncm || prev.ncm,
                    cest: d.cest || prev.cest,
                    imagem_url: d.imagem_url || prev.imagem_url,
                }));
                const origem = res.source === 'catalogo' ? 'catálogo local' : 'Cosmos';
                const temNcm = d.ncm ? ` NCM ${d.ncm} preenchido.` : ' (sem NCM — preencha manualmente).';
                showToast.success(`Dados preenchidos (${origem}).${temNcm}`, { id: toastId });
            } else {
                // Mensagem verdadeira conforme a causa (não mais "não encontrado" genérico)
                const msg = res.message || 'Não foi possível consultar o produto.';
                if (res.code === 'nao_encontrado') {
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

    const calcularPrecoVenda = () => {
        const preco = formData.preco_custo * (1 + formData.margem_lucro / 100);
        setFormData(prev => ({ ...prev, preco_venda: parseFloat(preco.toFixed(2)) }));
    };

    const calcularMargem = () => {
        if (formData.preco_custo > 0) {
            const margem = ((formData.preco_venda - formData.preco_custo) / formData.preco_custo) * 100;
            setFormData(prev => ({ ...prev, margem_lucro: parseFloat(margem.toFixed(2)) }));
        }
    };

    const field = (key: keyof typeof emptyForm, value: any) =>
        setFormData(prev => ({ ...prev, [key]: value }));

    const setAtributo = (chave: string, valor: any) =>
        setFormData(prev => ({ ...prev, atributos: { ...prev.atributos, [chave]: valor } }));

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // Validações obrigatórias
        if (!formData.nome.trim()) { showToast.error(ehServico ? 'Nome do serviço é obrigatório' : 'Nome do produto é obrigatório'); return; }
        if (!formData.categoria.trim()) { showToast.error('Categoria é obrigatória'); return; }
        if (!ehServico && (!formData.preco_custo || formData.preco_custo <= 0)) { showToast.error('Preço de custo inválido'); return; }
        if (!formData.preco_venda || formData.preco_venda <= 0) { showToast.error('Preço de venda inválido'); return; }

        const payload: any = {
            ...formData,
            controlar_estoque: !ehServico,
        };
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
                    showToast.error(result.message || 'Erro ao salvar');
                    return;
                }

                showToast.success(ehServico ? 'Serviço cadastrado com sucesso!' : 'Produto cadastrado com sucesso!');
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
                        className="flex-1 sm:flex-none px-6 py-3 text-gray-600 dark:text-gray-400 font-bold hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-all">
                        Cancelar
                    </button>
                    <button onClick={handleSubmit} disabled={loading || isSearchingCosmos}
                        className="flex-1 sm:flex-none px-8 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 disabled:opacity-50 shadow-lg shadow-blue-500/20 active:scale-95 transition-all">
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
                                        onChange={e => field('familia_produto', e.target.value)}
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
                                <input type="text" value={formData.nome} required
                                    onChange={e => field('nome', e.target.value)}
                                    className={inputClass}
                                    placeholder={ehServico ? exemplos.nome_servico : exemplos.nome} />
                            </div>
                            {!ehServico && visivel('codigo_barras') && (
                                <div>
                                    <label className={labelClass}>Código de Barras</label>
                                    <div className="flex gap-2">
                                        <input type="text" value={formData.codigo_barras}
                                            onChange={e => {
                                                field('codigo_barras', e.target.value);
                                                setShowForceSync(false);
                                            }}
                                            className={`${inputClass} font-mono`} placeholder="EAN-13 / EAN-8" />
                                        <button type="button" onClick={() => setShowScanner(true)}
                                            className="p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 text-blue-600 shadow-sm">
                                            <Camera className="w-5 h-5" />
                                        </button>
                                    </div>
                                    {showForceSync && formData.codigo_barras && (
                                        <button type="button" onClick={() => handleScanCodigo(formData.codigo_barras, true)}
                                            className="mt-2 w-full py-2 px-3 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg flex items-center justify-center gap-2 transition-colors">
                                            <Sparkles className="w-4 h-4" />
                                            Forçar Busca na API Cosmos
                                        </button>
                                    )}
                                </div>
                            )}
                            <div>
                                <label className={labelClass}>Categoria *</label>
                                <input type="text" list="cat-list" value={formData.categoria} required
                                    onChange={e => field('categoria', e.target.value)}
                                    className={inputClass}
                                    placeholder={ehServico ? exemplos.categoria_servico : exemplos.categoria} />
                                <datalist id="cat-list">{categorias.map(c => <option key={c} value={c} />)}</datalist>
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
                                        <CampoAjuda texto="Código fiscal de 8 dígitos que classifica o produto perante a Receita (Nomenclatura Comum do Mercosul). Se você escaneou o código de barras, geralmente já vem preenchido pela Cosmos. Sem ele, a nota fiscal não pode ser emitida." />
                                    </label>
                                    <input type="text" inputMode="numeric" maxLength={8} value={formData.ncm}
                                        onChange={e => field('ncm', e.target.value.replace(/\D/g, '').slice(0, 8))}
                                        className={`${inputClass} ${formData.ncm && formData.ncm.length !== 8 ? 'border-amber-400' : ''}`}
                                        placeholder="8 dígitos" />
                                    {formData.ncm && formData.ncm.length !== 8 && (
                                        <p className="text-xs text-amber-600 mt-1">Deve ter 8 dígitos.</p>
                                    )}
                                </div>
                                <div>
                                    <label className={`${labelClass} flex items-center gap-1`}>
                                        CEST
                                        <CampoAjuda texto="Código Especificador da Substituição Tributária — só é obrigatório se o seu produto está sujeito a ICMS-ST (o aviso acima indica quando isso é comum). Se não souber, deixe em branco e confirme com seu contador." />
                                    </label>
                                    <input type="text" inputMode="numeric" maxLength={7} value={formData.cest}
                                        onChange={e => field('cest', e.target.value.replace(/\D/g, '').slice(0, 7))}
                                        className={inputClass} placeholder="7 dígitos" />
                                </div>
                                <div>
                                    <label className={`${labelClass} flex items-center gap-1`}>
                                        CFOP Padrão
                                        <CampoAjuda texto="Código Fiscal de Operações e Prestações — identifica o tipo de operação na nota (ex.: 5102 = venda de mercadoria comprada de terceiros dentro do seu estado). Já vem sugerido pela família do item; normalmente não precisa mudar." />
                                    </label>
                                    <input type="text" inputMode="numeric" maxLength={4} value={formData.cfop_padrao}
                                        onChange={e => field('cfop_padrao', e.target.value.replace(/\D/g, '').slice(0, 4))}
                                        className={inputClass} placeholder="Ex: 5102" />
                                </div>
                                <div>
                                    <label className={`${labelClass} flex items-center gap-1`}>
                                        CSOSN (Simples)
                                        <CampoAjuda texto="Código de Situação da Operação no Simples Nacional — define como o ICMS é tratado na nota para quem está no Simples. Se seu regime tributário não é Simples Nacional, o sistema usa o CST em vez deste campo (configurável em Configurações → Fiscal)." />
                                    </label>
                                    <input type="text" inputMode="numeric" maxLength={3} value={formData.csosn}
                                        onChange={e => field('csosn', e.target.value.replace(/\D/g, '').slice(0, 3))}
                                        className={inputClass} placeholder="Ex: 102" />
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* ── Seção 3: Precificação ── */}
                <div>
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Precificação e Lucro</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 p-6 bg-blue-50/50 dark:bg-blue-900/10 rounded-2xl border border-blue-100/50 dark:border-blue-900/30">
                        <div>
                            <label className="block text-sm font-semibold text-blue-800 dark:text-blue-300 mb-1">
                                {ehServico ? 'Custo do Serviço (R$)' : 'Preço de Custo (R$) *'}
                            </label>
                            <input type="number" step="0.01" min={ehServico ? '0' : '0.01'} required={!ehServico}
                                value={formData.preco_custo}
                                onChange={e => field('preco_custo', parseFloat(e.target.value) || 0)}
                                onBlur={calcularPrecoVenda}
                                className={`${inputClass} text-lg font-semibold border-blue-200 dark:border-blue-800`} />
                            {ehServico && <p className="text-xs text-blue-500 mt-1">Peças/insumos consumidos. Pode ser zero.</p>}
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-blue-800 dark:text-blue-300 mb-1">Margem de Lucro (%)</label>
                            <input type="number" step="0.1" min="0"
                                value={formData.margem_lucro}
                                onChange={e => field('margem_lucro', parseFloat(e.target.value) || 0)}
                                onBlur={calcularPrecoVenda}
                                className={`${inputClass} text-lg font-semibold border-blue-200 dark:border-blue-800`} />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-blue-800 dark:text-blue-300 mb-1">
                                {ehServico ? 'Preço Cobrado (R$) *' : 'Preço de Venda (R$) *'}
                            </label>
                            <input type="number" step="0.01" min="0.01" required
                                value={formData.preco_venda}
                                onChange={e => field('preco_venda', parseFloat(e.target.value) || 0)}
                                onBlur={calcularMargem}
                                className="w-full px-4 py-3 bg-blue-600 text-white border-transparent rounded-xl outline-none focus:ring-4 focus:ring-blue-500/30 text-lg font-bold shadow-lg shadow-blue-500/20" />
                        </div>
                    </div>
                </div>

                {/* ── Seção 4: Estoque — serviço não controla estoque ── */}
                {!ehServico && (
                    <div>
                        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Controle de Estoque</h4>
                        <div className={sectionClass}>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {visivel('quantidade_minima') && (
                                    <div>
                                        <label className={labelClass}>Qtd. Mínima (Alerta)</label>
                                        <input type="number" min="0" value={formData.quantidade_minima}
                                            onChange={e => field('quantidade_minima', parseFloat(e.target.value) || 0)}
                                            className={inputClass} />
                                    </div>
                                )}
                            </div>
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
                                    <label className={labelClass}>URL da Imagem</label>
                                    <input type="url" value={formData.imagem_url}
                                        onChange={e => field('imagem_url', e.target.value)}
                                        className={inputClass} placeholder="https://..." />
                                    {formData.imagem_url && (
                                        <img src={formData.imagem_url} alt="preview"
                                            className="mt-2 h-20 w-20 object-cover rounded-xl border border-gray-200 dark:border-gray-700"
                                            onError={e => (e.currentTarget.style.display = 'none')} />
                                    )}
                                </div>
                            )}
                            <div>
                                <label className={labelClass}>Descrição / Observações</label>
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
                <BarcodeScanner onScan={handleScanCodigo} onClose={() => setShowScanner(false)} />
            )}
        </ResponsiveModal>
    );
};

export default ProductFormModal;
