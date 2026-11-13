import { useEffect, useState } from 'react';
import { GlassWater, Layers, Plus, Save, Trash2 } from 'lucide-react';
import { showToast } from '../../utils/toast';
import { formatCurrency } from '../../utils/formatters';
import ResponsiveModal from '../../components/ui/ResponsiveModal';
import { useViewSchema } from '../../services/viewSchemaService';
import {
    LinhaAplicacao, ModeloDose, ResultadoAplicacao, dosesService, erroDoses,
} from '../products/dosesService';
import { ConfigDosesLoja, MAX_DOSES, PadraoDose, formatarMl, numero } from '../products/utils/doses';

const inputClass = 'w-full min-w-0 px-3 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl '
    + 'focus:ring-2 focus:ring-blue-500 outline-none text-gray-900 dark:text-white text-sm';
const labelClass = 'block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1';

interface PadraoLinha { chave: string; nome: string; ml: string }
let n = 0;
const chave = () => `p-${Date.now().toString(36)}-${++n}`;
const virgula = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v).replace('.', ','));

/**
 * Padrões de venda por dose da loja: os ml que ela costuma trabalhar (atalhos no cadastro — nada é fixo, cada
 * produto pode ter qualquer ml), a margem alvo, a perda esperada e os alertas. E o atalho para aplicar o mesmo
 * conjunto de doses a vários produtos de uma vez.
 */
const DosesSettings = () => {
    const [carregando, setCarregando] = useState(true);
    const [salvando, setSalvando] = useState(false);
    const [padroes, setPadroes] = useState<PadraoLinha[]>([]);
    const [margem, setMargem] = useState('');
    const [perda, setPerda] = useState('');
    const [diasAberta, setDiasAberta] = useState('');
    const [rendimento, setRendimento] = useState('');
    const [definidas, setDefinidas] = useState(false);
    const [mostrarLote, setMostrarLote] = useState(false);

    const carregar = (c: ConfigDosesLoja) => {
        setPadroes(c.doses_padrao.map(p => ({ chave: chave(), nome: p.nome, ml: virgula(p.volume_ml) })));
        setMargem(c.margem_alvo_definida ? virgula(c.margem_alvo_dose_pct) : '');
        setPerda(virgula(c.perda_esperada_pct));
        setDiasAberta(virgula(c.alerta_garrafa_aberta_dias));
        setRendimento(virgula(c.alerta_rendimento_pct));
        setDefinidas(c.doses_padrao_definidas);
    };

    useEffect(() => {
        dosesService.config().then(carregar).catch(() => showToast.error('Erro ao carregar os padrões de dose'))
            .finally(() => setCarregando(false));
    }, []);

    const salvar = async () => {
        const doses_padrao: PadraoDose[] = [];
        for (const p of padroes) {
            const ml = numero(p.ml);
            if (ml === null || ml <= 0) { showToast.error('Informe quantos ml tem cada dose padrão.'); return; }
            doses_padrao.push({ nome: p.nome.trim() || `Dose ${formatarMl(ml)}`, volume_ml: ml });
        }
        if (!doses_padrao.length) { showToast.error('Deixe ao menos uma dose padrão.'); return; }
        setSalvando(true);
        try {
            const nova = await dosesService.salvarConfig({
                doses_padrao,
                margem_alvo_dose_pct: numero(margem),
                perda_esperada_pct: numero(perda) ?? 0,
                alerta_garrafa_aberta_dias: numero(diasAberta),
                alerta_rendimento_pct: numero(rendimento),
            });
            carregar(nova);
            showToast.success('Padrões de dose salvos');
        } catch (e) {
            showToast.error(erroDoses(e, 'Erro ao salvar os padrões de dose'));
        } finally {
            setSalvando(false);
        }
    };

    if (carregando) return null;

    return (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 space-y-5 animate-fadeIn" data-testid="doses-settings">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div>
                    <h3 className="flex items-center gap-2 text-lg font-bold text-gray-900 dark:text-white">
                        <GlassWater className="w-5 h-5 text-blue-500" /> Venda por dose
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        Os ml que a sua loja trabalha viram atalhos no cadastro de cada bebida. Em cada produto você pode usar
                        qualquer ml e qualquer preço.
                    </p>
                </div>
                <button type="button" onClick={() => setMostrarLote(true)}
                    className="shrink-0 w-full sm:w-auto justify-center inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-200 text-sm font-bold hover:bg-blue-100">
                    <Layers className="w-4 h-4" /> Aplicar a vários produtos
                </button>
            </div>

            <div>
                <p className={labelClass}>Doses que a loja trabalha {!definidas && <span className="font-normal text-gray-400">(sugestão inicial: ajuste ao seu jeito)</span>}</p>
                <div className="space-y-2">
                    {padroes.map(p => (
                        <div key={p.chave} className="grid grid-cols-12 gap-2 items-center">
                            <input className={`${inputClass} col-span-6 sm:col-span-7`} aria-label="Nome da dose padrão" maxLength={60}
                                placeholder="Ex.: Dose, Dupla, Taça" value={p.nome}
                                onChange={e => setPadroes(l => l.map(x => x.chave === p.chave ? { ...x, nome: e.target.value } : x))} />
                            <input className={`${inputClass} col-span-4 sm:col-span-4`} aria-label="ml da dose padrão" inputMode="decimal"
                                placeholder="ml" value={p.ml}
                                onChange={e => setPadroes(l => l.map(x => x.chave === p.chave ? { ...x, ml: e.target.value } : x))} />
                            <button type="button" aria-label="Remover dose padrão" title="Remover"
                                onClick={() => setPadroes(l => l.filter(x => x.chave !== p.chave))}
                                className="col-span-2 sm:col-span-1 p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 justify-self-end">
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    ))}
                </div>
                <button type="button" disabled={padroes.length >= MAX_DOSES}
                    onClick={() => setPadroes(l => [...l, { chave: chave(), nome: '', ml: '' }])}
                    className="mt-2 inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold border border-gray-200 dark:border-gray-700 hover:border-blue-400 hover:text-blue-600">
                    <Plus className="w-3.5 h-3.5" /> Adicionar dose
                </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label className={labelClass} htmlFor="cfg-margem">Margem alvo da dose (%)</label>
                    <input id="cfg-margem" className={inputClass} inputMode="decimal" placeholder="Ex.: 60" value={margem}
                        onChange={e => setMargem(e.target.value)} />
                    <p className="mt-1 text-[11px] text-gray-500">Sugere o preço de cada dose e avisa quando a margem fica abaixo.</p>
                </div>
                <div>
                    <label className={labelClass} htmlFor="cfg-perda">Perda esperada por garrafa (%)</label>
                    <input id="cfg-perda" className={inputClass} inputMode="decimal" placeholder="0" value={perda}
                        onChange={e => setPerda(e.target.value)} />
                    <p className="mt-1 text-[11px] text-gray-500">Derramou ou sobrou no fundo. Cada produto pode ter a sua.</p>
                </div>
                <div>
                    <label className={labelClass} htmlFor="cfg-aberta">Alertar garrafa aberta há mais de (dias)</label>
                    <input id="cfg-aberta" className={inputClass} inputMode="numeric" placeholder="Ex.: 15" value={diasAberta}
                        onChange={e => setDiasAberta(e.target.value)} />
                </div>
                <div>
                    <label className={labelClass} htmlFor="cfg-rend">Alertar rendimento abaixo de (%)</label>
                    <input id="cfg-rend" className={inputClass} inputMode="decimal" placeholder="Ex.: 92" value={rendimento}
                        onChange={e => setRendimento(e.target.value)} />
                    <p className="mt-1 text-[11px] text-gray-500">Doses vendidas contra o que a garrafa deveria render.</p>
                </div>
            </div>

            <div className="flex justify-end">
                <button type="button" onClick={salvar} disabled={salvando}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:opacity-50">
                    <Save className="w-4 h-4" /> {salvando ? 'Salvando...' : 'Salvar padrões de dose'}
                </button>
            </div>

            {mostrarLote && <AplicarEmLote padroes={padroes} margemLoja={numero(margem)} onFechar={() => setMostrarLote(false)} />}
        </div>
    );
};

interface AplicarProps { padroes: PadraoLinha[]; margemLoja: number | null; onFechar: () => void }

/** Mesmo conjunto de doses em vários produtos, com pré-visualização antes de gravar. */
export const AplicarEmLote = ({ padroes, margemLoja, onFechar }: AplicarProps) => {
    const [marca, setMarca] = useState('');
    const [subcategoria, setSubcategoria] = useState('');          // chave da subcategoria ou "cat:<chave>" (categoria inteira)
    const { schema } = useViewSchema('bebida');
    const taxonomia = (schema?.taxonomia || []).filter(c => c.subcategorias?.length);
    const [modo, setModo] = useState<'substituir' | 'acrescentar'>('substituir');
    const [margem, setMargem] = useState(margemLoja !== null ? virgula(margemLoja) : '60');
    const [volumePadrao, setVolumePadrao] = useState('');
    const [resultado, setResultado] = useState<ResultadoAplicacao | null>(null);
    const [ocupado, setOcupado] = useState(false);

    const modelo = (): ModeloDose[] | null => {
        const m = numero(margem);
        if (m === null || m < 1 || m >= 100) { showToast.error('Informe a margem alvo (entre 1% e 99%).'); return null; }
        const itens: ModeloDose[] = [];
        for (const [i, p] of padroes.entries()) {
            const ml = numero(p.ml);
            if (ml === null || ml <= 0) { showToast.error('Há dose padrão sem ml: corrija antes de aplicar.'); return null; }
            itens.push({ nome: p.nome.trim() || `Dose ${formatarMl(ml)}`, volume_ml: ml, margem_alvo_pct: m, padrao: i === 0 });
        }
        if (!itens.length) { showToast.error('Cadastre ao menos uma dose padrão.'); return null; }
        return itens;
    };

    const rodar = async (gravar: boolean) => {
        const itens = modelo();
        if (!itens) return;
        const categoriaInteira = subcategoria.startsWith('cat:');
        const selecao = {
            marca: marca.trim() || undefined,
            subcategoria_oficial: !categoriaInteira && subcategoria ? subcategoria : undefined,
            categoria_oficial: categoriaInteira ? subcategoria.slice(4) : undefined,
        };
        if (!selecao.marca && !selecao.subcategoria_oficial && !selecao.categoria_oficial) {
            showToast.error('Escolha os produtos: uma subcategoria de bebida ou uma marca.');
            return;
        }
        setOcupado(true);
        try {
            const r = await dosesService.aplicar({
                modelo: itens, selecao, modo, dry_run: !gravar, volume_padrao_ml: numero(volumePadrao),
            });
            setResultado(r);
            if (gravar) showToast.success(`Doses aplicadas em ${r.aplicados} produto(s)`);
        } catch (e) {
            showToast.error(erroDoses(e, 'Erro ao aplicar as doses'));
        } finally {
            setOcupado(false);
        }
    };

    const podeGravar = !!resultado && resultado.dry_run && resultado.aplicados > 0;
    const rotuloStatus = (l: LinhaAplicacao) => l.status === 'ignorado' ? 'Ignorado' : l.status === 'aplicado' ? 'Aplicado' : 'Será aplicado';

    return (
        <ResponsiveModal isOpen onClose={onFechar} title="Aplicar doses a vários produtos"
            subtitle="Os preços saem do custo de cada produto e da margem alvo; você confere antes de gravar."
            headerIcon={<Layers className="w-6 h-6" />} headerColor="blue" size="xl"
            footer={
                <div className="flex w-full sm:w-auto gap-3">
                    <button type="button" onClick={onFechar} className="flex-1 sm:flex-none px-4 py-3 font-bold text-gray-600 dark:text-gray-300 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700">
                        Fechar
                    </button>
                    <button type="button" disabled={ocupado} onClick={() => rodar(false)}
                        className="flex-1 sm:flex-none px-5 py-3 rounded-xl font-bold bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100 hover:bg-gray-200">
                        Pré-visualizar
                    </button>
                    <button type="button" disabled={ocupado || !podeGravar} onClick={() => rodar(true)}
                        className="flex-[2] sm:flex-none px-6 py-3 rounded-xl font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">
                        Gravar nos {resultado?.aplicados ?? 0} produtos
                    </button>
                </div>
            }>
            <div className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label className={labelClass} htmlFor="lote-marca">Marca</label>
                        <input id="lote-marca" className={inputClass} placeholder="Ex.: Jack Daniel's" value={marca}
                            onChange={e => { setMarca(e.target.value); setResultado(null); }} />
                    </div>
                    <div>
                        <label className={labelClass} htmlFor="lote-sub">Tipo de bebida</label>
                        <select id="lote-sub" className={inputClass} value={subcategoria}
                            onChange={e => { setSubcategoria(e.target.value); setResultado(null); }}>
                            <option value="">Escolha…</option>
                            {taxonomia.map(c => (
                                <optgroup key={c.chave} label={c.nome}>
                                    <option value={`cat:${c.chave}`}>Toda a categoria {c.nome}</option>
                                    {c.subcategorias.map(sub => <option key={sub.chave} value={sub.chave}>{sub.nome}</option>)}
                                </optgroup>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className={labelClass} htmlFor="lote-margem">Margem alvo (%)</label>
                        <input id="lote-margem" className={inputClass} inputMode="decimal" value={margem}
                            onChange={e => { setMargem(e.target.value); setResultado(null); }} />
                    </div>
                    <div>
                        <label className={labelClass} htmlFor="lote-volume">Volume da garrafa quando o produto não tem (ml)</label>
                        <input id="lote-volume" className={inputClass} inputMode="decimal" placeholder="Ex.: 1000" value={volumePadrao}
                            onChange={e => { setVolumePadrao(e.target.value); setResultado(null); }} />
                        <p className="mt-1 text-[11px] text-gray-500">Usado só se o volume não estiver cadastrado nem no nome ("... 1L").</p>
                    </div>
                </div>

                <div className="flex flex-wrap gap-4 text-sm">
                    <label className="inline-flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="modo" checked={modo === 'substituir'} onChange={() => { setModo('substituir'); setResultado(null); }} />
                        Substituir as doses do produto
                    </label>
                    <label className="inline-flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="modo" checked={modo === 'acrescentar'} onChange={() => { setModo('acrescentar'); setResultado(null); }} />
                        Só acrescentar as que faltam
                    </label>
                </div>

                <p className="text-xs text-gray-500 dark:text-gray-400">
                    Doses aplicadas: {padroes.filter(p => numero(p.ml)).map(p => `${p.nome.trim() || 'Dose'} ${formatarMl(numero(p.ml))}`).join(' · ') || '—'}
                </p>

                {resultado && (
                    <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden" data-testid="lote-resultado">
                        <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800 text-sm font-bold">
                            {resultado.dry_run ? 'Pré-visualização' : 'Gravado'}: {resultado.aplicados} para aplicar, {resultado.ignorados} ignorado(s)
                        </div>
                        <ul className="divide-y divide-gray-100 dark:divide-gray-700 max-h-72 overflow-auto">
                            {resultado.linhas.map(l => (
                                <li key={l.produto_id} className="px-4 py-2 text-sm">
                                    <div className="flex justify-between gap-3">
                                        <span className="font-semibold">{l.nome}</span>
                                        <span className={l.status === 'ignorado' ? 'text-amber-600' : 'text-green-600'}>{rotuloStatus(l)}</span>
                                    </div>
                                    {l.doses.length > 0 && (
                                        <p className="text-xs text-gray-500">
                                            Garrafa {formatarMl(l.volume_embalagem_ml)}{l.origem_volume && l.origem_volume !== 'cadastro' ? ` (${l.origem_volume === 'nome' ? 'do nome' : 'volume padrão'})` : ''}:{' '}
                                            {l.doses.map(d => `${d.nome} ${formatarMl(d.volume_ml)} ${formatCurrency(d.preco_venda)}${d.margem_pct !== null ? ` (${String(d.margem_pct).replace('.', ',')}%)` : ''}`).join(' · ')}
                                        </p>
                                    )}
                                    {l.motivo && <p className="text-xs text-amber-600">{l.motivo}</p>}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        </ResponsiveModal>
    );
};

export default DosesSettings;
