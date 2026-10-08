import { useEffect, useMemo, useState } from 'react';
import {
    ShoppingBasket, Shirt, Hammer, Wrench, Store, Layers, Eye, EyeOff, BarChart3,
} from 'lucide-react';
import { showToast } from '../../components/elements/Toast';
import { SegmentoInfo, ViewSchema } from '../../types/viewSchema';
import { viewSchemaService } from '../../services/viewSchemaService';

const ICONE_SEGMENTO: Record<string, React.ComponentType<any>> = {
    'shopping-basket': ShoppingBasket, shirt: Shirt, hammer: Hammer, wrench: Wrench, store: Store,
};

/**
 * Nível Tenant da cascata do Motor de Renderização Contextual:
 * - escolhe o segmento do negócio (muda campos, unidades e KPIs do sistema inteiro)
 * - liga/desliga campos e métricas individualmente (overrides)
 */
const SegmentSettings = () => {
    const [segmentos, setSegmentos] = useState<SegmentoInfo[]>([]);
    const [schema, setSchema] = useState<ViewSchema | null>(null);
    const [salvando, setSalvando] = useState(false);
    const [carregando, setCarregando] = useState(true);
    // Overrides em edição (chaves ocultas localmente antes de salvar)
    const [camposOcultos, setCamposOcultos] = useState<string[]>([]);
    const [metricasOcultas, setMetricasOcultas] = useState<string[]>([]);
    const [mixProdutos, setMixProdutos] = useState<string[]>([]);

    // O painel edita sobre o schema-BASE do segmento (sem overrides aplicados):
    // assim um campo oculto continua listado e pode ser religado.
    const carregarBase = async () => {
        const { schema: base, overrides } = await viewSchemaService.getSchemaBase();
        setSchema(base);
        setCamposOcultos(overrides.campos_ocultos || []);
        setMetricasOcultas(overrides.metricas_ocultas || []);
        setMixProdutos(overrides.mix_produtos || base.mix_permitido || []);
    };

    useEffect(() => {
        Promise.all([viewSchemaService.getSegmentos(), carregarBase()])
            .then(([segs]) => setSegmentos(segs))
            .catch(() => showToast.error('Erro ao carregar segmentos'))
            .finally(() => setCarregando(false));
    }, []);

    const trocarSegmento = async (chave: string) => {
        if (!schema || chave === schema.segmento.chave || salvando) return;
        setSalvando(true);
        try {
            const novo = await viewSchemaService.setSegmento(chave);
            await carregarBase();
            showToast.success(`Segmento alterado para ${novo.segmento.nome}. Produtos e KPIs já refletem o novo perfil.`);
        } catch (e: any) {
            showToast.error(e?.response?.data?.error || 'Erro ao trocar segmento');
        } finally {
            setSalvando(false);
        }
    };

    const alternarCampo = (chave: string) => {
        setSalvo(false);
        setCamposOcultos(prev => prev.includes(chave) ? prev.filter(c => c !== chave) : [...prev, chave]);
    };

    const alternarMetrica = (chave: string) => {
        setSalvo(false);
        setMetricasOcultas(prev => prev.includes(chave) ? prev.filter(c => c !== chave) : [...prev, chave]);
    };

    const alternarFamilia = (chave: string) => {
        setSalvo(false);
        setMixProdutos(prev => {
            const existe = prev.includes(chave);
            if (existe) return prev.filter(item => item !== chave);
            return [...prev, chave];
        });
    };

    const [salvo, setSalvo] = useState(true);

    const salvarOverrides = async () => {
        setSalvando(true);
        try {
            await viewSchemaService.saveOverrides({
                campos_ocultos: camposOcultos,
                metricas_ocultas: metricasOcultas,
                mix_produtos: mixProdutos,
            });
            setSalvo(true);
            showToast.success('Preferências de exibição salvas.');
        } catch (e: any) {
            showToast.error(e?.response?.data?.error || 'Erro ao salvar exibição');
        } finally {
            setSalvando(false);
        }
    };

    // Campos configuráveis: os de atributo do segmento + campos núcleo opcionais
    const camposConfiguraveis = useMemo(
        () => (schema?.campos || []).filter(c => c.chave !== 'fiscal').sort((a, b) => a.ordem - b.ordem),
        [schema],
    );
    const familiasConfiguraveis = useMemo(
        () => schema?.familias_configuraveis || [],
        [schema],
    );

    if (carregando) {
        return (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 flex items-center justify-center h-40 text-gray-500">
                <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mr-3" />
                Carregando segmentos...
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-fadeIn">
            {/* Seletor de segmento */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6">
                <div className="flex items-center gap-2 mb-1">
                    <Layers className="w-5 h-5 text-blue-600" />
                    <h3 className="text-lg font-bold text-gray-800 dark:text-white">Segmento do Negócio</h3>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
                    O segmento define quais campos, unidades e indicadores o sistema exibe.
                    Cadastro de produtos, PDV e relatórios se adaptam automaticamente.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {segmentos.map(seg => {
                        const Icone = ICONE_SEGMENTO[seg.icone] || Store;
                        const ativo = schema?.segmento.chave === seg.chave;
                        return (
                            <button
                                key={seg.chave}
                                onClick={() => trocarSegmento(seg.chave)}
                                disabled={salvando}
                                className={`text-left p-4 rounded-xl border-2 transition-all ${ativo
                                    ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/20 shadow-md'
                                    : 'border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-700'
                                    }`}
                            >
                                <div className="flex items-center gap-3 mb-2">
                                    <div className={`p-2 rounded-lg ${ativo ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500'}`}>
                                        <Icone className="w-5 h-5" />
                                    </div>
                                    <span className={`font-bold ${ativo ? 'text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'}`}>
                                        {seg.nome}
                                    </span>
                                </div>
                                <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug">{seg.descricao}</p>
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6">
                <div className="flex items-center gap-2 mb-1">
                    <Layers className="w-5 h-5 text-blue-600" />
                    <h3 className="text-lg font-bold text-gray-800 dark:text-white">Mix de Produtos Permitido</h3>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                    Defina quais famílias podem ser cadastradas neste tenant. O formulário de produto e o schema contextual respeitam essa governança.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {familiasConfiguraveis.map(familia => {
                        const ativa = mixProdutos.includes(familia.chave);
                        return (
                            <button
                                key={familia.chave}
                                onClick={() => alternarFamilia(familia.chave)}
                                className={`flex items-center justify-between px-4 py-3 rounded-lg border transition-all text-left ${ativa
                                    ? 'border-blue-200 dark:border-blue-900 bg-blue-50/70 dark:bg-blue-900/10'
                                    : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 opacity-70'
                                    }`}
                            >
                                <div>
                                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">{familia.nome}</p>
                                    <p className="text-[11px] text-gray-400">{familia.descricao}</p>
                                </div>
                                <span className={`text-[11px] font-bold px-2 py-1 rounded-full ${ativa
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-300'
                                    }`}>
                                    {ativa ? 'Ativa' : 'Oculta'}
                                </span>
                            </button>
                        );
                    })}
                </div>
                {mixProdutos.length === 0 && (
                    <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
                        Nenhuma família selecionada. Ao salvar, o sistema volta automaticamente para o mix padrão do segmento.
                    </p>
                )}
            </div>

            {/* Campos exibidos (overrides do tenant) */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6">
                <div className="flex items-center gap-2 mb-1">
                    <Eye className="w-5 h-5 text-blue-600" />
                    <h3 className="text-lg font-bold text-gray-800 dark:text-white">Campos do Cadastro de Produtos</h3>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                    Campos ativos para o segmento <strong>{schema?.segmento.nome}</strong>. Desative o que sua loja não usa.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {camposConfiguraveis.map(campo => {
                        const oculto = camposOcultos.includes(campo.chave);
                        return (
                            <button
                                key={campo.chave}
                                onClick={() => alternarCampo(campo.chave)}
                                className={`flex items-center justify-between px-4 py-3 rounded-lg border transition-all text-left ${oculto
                                    ? 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 opacity-60'
                                    : 'border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-900/10'
                                    }`}
                            >
                                <div>
                                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">{campo.label}</p>
                                    <p className="text-[11px] text-gray-400 uppercase tracking-wide">{campo.grupo}{campo.unidade ? ` · ${campo.unidade}` : ''}</p>
                                </div>
                                {oculto
                                    ? <EyeOff className="w-4 h-4 text-gray-400 shrink-0" />
                                    : <Eye className="w-4 h-4 text-emerald-500 shrink-0" />}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Métricas / KPIs exibidos */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6">
                <div className="flex items-center gap-2 mb-1">
                    <BarChart3 className="w-5 h-5 text-blue-600" />
                    <h3 className="text-lg font-bold text-gray-800 dark:text-white">Indicadores (KPIs)</h3>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                    Cards e painéis exibidos na página de produtos, conforme o catálogo de métricas do segmento.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {(schema?.metricas || []).map(metrica => {
                        const oculta = metricasOcultas.includes(metrica.chave);
                        return (
                            <button
                                key={metrica.chave}
                                onClick={() => alternarMetrica(metrica.chave)}
                                className={`flex items-center justify-between px-4 py-3 rounded-lg border transition-all text-left ${oculta
                                    ? 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 opacity-60'
                                    : 'border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-900/10'
                                    }`}
                            >
                                <div>
                                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">{metrica.titulo}</p>
                                    <p className="text-[11px] text-gray-400 uppercase tracking-wide">{metrica.escopo_ui === 'card' ? 'Card' : 'Painel analítico'}</p>
                                </div>
                                {oculta
                                    ? <EyeOff className="w-4 h-4 text-gray-400 shrink-0" />
                                    : <Eye className="w-4 h-4 text-blue-500 shrink-0" />}
                            </button>
                        );
                    })}
                </div>

                {!salvo && (
                    <div className="mt-5 flex justify-end">
                        <button
                            onClick={salvarOverrides}
                            disabled={salvando}
                            className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 disabled:opacity-50 shadow-lg"
                        >
                            {salvando ? 'Salvando...' : 'Salvar Exibição'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default SegmentSettings;
