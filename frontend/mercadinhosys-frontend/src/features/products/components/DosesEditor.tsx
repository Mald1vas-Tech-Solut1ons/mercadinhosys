import { useMemo, useState } from 'react';
import { AlertTriangle, GlassWater, Plus, Star, Trash2, Wand2 } from 'lucide-react';
import { formatCurrency } from '../../../utils/formatters';
import {
    ConfigDosesLoja, DosesEstado, DoseLinha, MAX_DOSES, VOLUMES_COMUNS_ML, avisosDasDoses, calcularDose,
    custoDaDose, detectarVolumeMl, formatarMl, novaDose, numero, precoDaMargem, sugerirPreco,
} from '../utils/doses';

interface DosesEditorProps {
    valor: DosesEstado;
    onChange: (novo: DosesEstado) => void;
    /** Custo e preço da garrafa NO FORMULÁRIO (mudam ao vivo enquanto o lojista digita). */
    custoGarrafa: number;
    precoGarrafa: number;
    nomeProduto: string;
    /** Padrões da loja: atalhos de ml e a margem alvo. */
    loja: ConfigDosesLoja | null;
    /** Volume que o servidor detectou (edição); no cadastro novo o editor detecta pelo nome. */
    volumeSugeridoMl?: number | null;
    garrafasAbertas?: number;
    disabled?: boolean;
}

const inputClass = 'w-full min-w-0 px-3 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl '
    + 'focus:ring-2 focus:ring-blue-500 outline-none text-gray-900 dark:text-white text-sm disabled:opacity-60';
const labelClass = 'block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1';
const chipClass = 'px-3 py-1.5 rounded-full text-xs font-bold border border-gray-200 dark:border-gray-700 '
    + 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:border-blue-400 hover:text-blue-600 transition-colors';

const virgula = (n: number | null) => (n === null ? '' : String(n).replace('.', ','));

/**
 * Venda por dose no cadastro do produto. O lojista define o ml e o preço de cada dose (nada fixo);
 * o editor mostra na hora custo, margem e quanto a garrafa rende. Quem grava é o pai (junto do produto).
 */
const DosesEditor = ({
    valor, onChange, custoGarrafa, precoGarrafa, nomeProduto, loja, volumeSugeridoMl, garrafasAbertas = 0, disabled,
}: DosesEditorProps) => {
    // Margem em edição: o texto digitado manda enquanto o campo está com foco (senão a conta reescreve o que se digita).
    const [margemEditando, setMargemEditando] = useState<{ chave: string; texto: string } | null>(null);

    const volume = numero(valor.volume_embalagem_ml);
    const perda = numero(valor.perda_esperada_pct) ?? loja?.perda_esperada_pct ?? 0;
    const meta = loja?.margem_alvo_dose_pct ?? null;
    const detectado = useMemo(() => volumeSugeridoMl ?? detectarVolumeMl(nomeProduto), [volumeSugeridoMl, nomeProduto]);

    const atualizar = (parcial: Partial<DosesEstado>) => onChange({ ...valor, ...parcial });
    const atualizarDose = (chave: string, parcial: Partial<DoseLinha>) =>
        atualizar({ doses: valor.doses.map(d => (d.chave === chave ? { ...d, ...parcial } : d)) });

    const calcs = valor.doses.map(d => ({
        dose: d,
        calc: calcularDose({
            custoGarrafa, volumeMl: volume, ml: numero(d.volume_ml), preco: numero(d.preco_venda),
            perdaPct: perda, precoGarrafa,
        }),
    }));
    const avisos = avisosDasDoses({
        doses: calcs.map(({ dose, calc }) => ({ nome: dose.nome.trim() || `Dose ${formatarMl(numero(dose.volume_ml))}`, calc })),
        metaMargemPct: meta,
    });

    const adicionar = (nome: string, ml: number | null) => {
        if (valor.doses.length >= MAX_DOSES) return;
        const linha = novaDose({
            nome, ml, custoGarrafa, volumeMl: volume, metaMargemPct: meta, perdaPct: perda,
            jaTemPadrao: valor.doses.some(d => d.padrao),
        });
        atualizar({ doses: [...valor.doses, linha] });
    };

    const alternar = (ligado: boolean) => {
        if (!ligado) return atualizar({ vende_por_dose: false });
        const proximo: Partial<DosesEstado> = { vende_por_dose: true };
        if (!valor.volume_embalagem_ml && detectado) proximo.volume_embalagem_ml = virgula(detectado);
        onChange({ ...valor, ...proximo });
    };

    const mudarMargem = (dose: DoseLinha, texto: string) => {
        setMargemEditando({ chave: dose.chave, texto });
        const margem = numero(texto);
        const custo = volume ? custoDaDose(custoGarrafa, volume, numero(dose.volume_ml) ?? 0, perda) : null;
        if (margem === null || custo === null || custo <= 0) return;
        const preco = precoDaMargem(custo, margem);
        if (Number.isFinite(preco) && preco > 0) atualizarDose(dose.chave, { preco_venda: virgula(preco) });
    };

    const sugerir = (dose: DoseLinha) => {
        const custo = volume ? custoDaDose(custoGarrafa, volume, numero(dose.volume_ml) ?? 0, perda) : null;
        if (custo === null || custo <= 0 || !meta) return;
        atualizarDose(dose.chave, { preco_venda: virgula(sugerirPreco(custo, meta)) });
    };

    const remover = (chave: string) => {
        const restantes = valor.doses.filter(d => d.chave !== chave);
        if (restantes.length && !restantes.some(d => d.padrao)) restantes[0] = { ...restantes[0], padrao: true };
        atualizar({ doses: restantes });
    };

    const tornarPadrao = (chave: string) =>
        atualizar({ doses: valor.doses.map(d => ({ ...d, padrao: d.chave === chave })) });

    const atalhos = (loja?.doses_padrao || []).filter(p => !valor.doses.some(d => numero(d.volume_ml) === p.volume_ml));
    const padrao = calcs.find(c => c.dose.padrao) || calcs[0];
    const mlPadrao = padrao ? numero(padrao.dose.volume_ml) : null;

    return (
        <div className="space-y-4" data-testid="doses-editor">
            <label className="flex items-start gap-3 cursor-pointer select-none">
                <input type="checkbox" className="mt-1 w-5 h-5 accent-blue-600" checked={valor.vende_por_dose}
                    disabled={disabled} onChange={e => alternar(e.target.checked)} aria-label="Vender também por dose" />
                <span>
                    <span className="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-100">
                        <GlassWater className="w-4 h-4 text-blue-500" /> Vender também por dose
                    </span>
                    <span className="block text-xs text-gray-500 dark:text-gray-400">
                        A garrafa continua no estoque; cada dose vendida tira o ml dela. Você define os ml e o preço.
                    </span>
                </span>
            </label>

            {valor.vende_por_dose && (
                <>
                    <div>
                        <label className={labelClass} htmlFor="dose-volume">Quanto tem a garrafa (ml) *</label>
                        <div className="flex flex-wrap items-center gap-2">
                            <input id="dose-volume" data-campo="volume_embalagem_ml" inputMode="decimal" disabled={disabled}
                                className={`${inputClass} max-w-[10rem]`} placeholder="Ex.: 1000" value={valor.volume_embalagem_ml}
                                onChange={e => atualizar({ volume_embalagem_ml: e.target.value })} />
                            {VOLUMES_COMUNS_ML.map(ml => (
                                <button key={ml} type="button" className={chipClass} disabled={disabled}
                                    onClick={() => atualizar({ volume_embalagem_ml: String(ml) })}>
                                    {formatarMl(ml)}
                                </button>
                            ))}
                        </div>
                        {detectado && volume !== detectado && (
                            <button type="button" className="mt-2 text-xs font-semibold text-blue-600 hover:underline" disabled={disabled}
                                onClick={() => atualizar({ volume_embalagem_ml: virgula(detectado) })}>
                                Detectado no nome: {formatarMl(detectado)} — usar
                            </button>
                        )}
                    </div>

                    <div className="space-y-3">
                        {calcs.map(({ dose, calc }) => {
                            const margemTexto = margemEditando?.chave === dose.chave
                                ? margemEditando.texto : virgula(calc.margemPct);
                            return (
                                <div key={dose.chave} data-testid="dose-linha"
                                    className="p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60">
                                    <div className="grid grid-cols-2 sm:grid-cols-12 gap-2 items-end">
                                        <div className="col-span-2 sm:col-span-4">
                                            <label className={labelClass}>Nome</label>
                                            <input className={inputClass} placeholder="Ex.: Dose, Dupla, Taça" maxLength={60}
                                                aria-label="Nome da dose" disabled={disabled} value={dose.nome}
                                                onChange={e => atualizarDose(dose.chave, { nome: e.target.value })} />
                                        </div>
                                        <div className="sm:col-span-2">
                                            <label className={labelClass}>ml da dose</label>
                                            <input className={inputClass} inputMode="decimal" placeholder="50" aria-label="ml da dose"
                                                disabled={disabled} value={dose.volume_ml}
                                                onChange={e => atualizarDose(dose.chave, { volume_ml: e.target.value })} />
                                        </div>
                                        <div className="sm:col-span-2">
                                            <label className={labelClass}>Preço (R$)</label>
                                            <input className={inputClass} inputMode="decimal" placeholder="0,00" aria-label="Preço da dose"
                                                disabled={disabled} value={dose.preco_venda}
                                                onChange={e => atualizarDose(dose.chave, { preco_venda: e.target.value })} />
                                        </div>
                                        <div className="sm:col-span-2">
                                            <label className={labelClass}>Margem (%)</label>
                                            <input className={inputClass} inputMode="decimal" placeholder="—" aria-label="Margem da dose"
                                                disabled={disabled || calc.custoDose === null || custoGarrafa <= 0} value={margemTexto}
                                                onFocus={() => setMargemEditando({ chave: dose.chave, texto: virgula(calc.margemPct) })}
                                                onBlur={() => setMargemEditando(null)}
                                                onChange={e => mudarMargem(dose, e.target.value)} />
                                        </div>
                                        <div className="col-span-2 sm:col-span-2 flex items-center justify-end gap-1">
                                            {meta && calc.custoDose !== null && custoGarrafa > 0 && (
                                                <button type="button" title={`Sugerir preço para ${meta}% de margem`} disabled={disabled}
                                                    aria-label="Sugerir preço" onClick={() => sugerir(dose)}
                                                    className="p-2 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20">
                                                    <Wand2 className="w-4 h-4" />
                                                </button>
                                            )}
                                            <button type="button" title="Dose padrão (a que o caixa oferece primeiro)" disabled={disabled}
                                                aria-label="Tornar padrão" aria-pressed={dose.padrao} onClick={() => tornarPadrao(dose.chave)}
                                                className={`p-2 rounded-lg ${dose.padrao ? 'text-amber-500' : 'text-gray-300 hover:text-amber-500'}`}>
                                                <Star className="w-4 h-4" fill={dose.padrao ? 'currentColor' : 'none'} />
                                            </button>
                                            <button type="button" title="Remover dose" aria-label="Remover dose" disabled={disabled}
                                                onClick={() => remover(dose.chave)}
                                                className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                    <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                                        {calc.custoDose !== null
                                            ? <>Custo {formatCurrency(calc.custoDose)} por dose · {String(calc.dosesPorGarrafa).replace('.', ',')} doses por garrafa
                                                {calc.margemValor !== null && <> · lucro {formatCurrency(calc.margemValor)}</>}</>
                                            : 'Informe o volume da garrafa e o ml da dose para ver custo e margem.'}
                                    </p>
                                </div>
                            );
                        })}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        {atalhos.map(p => (
                            <button key={`${p.nome}-${p.volume_ml}`} type="button" className={chipClass}
                                disabled={disabled || valor.doses.length >= MAX_DOSES} onClick={() => adicionar(p.nome, p.volume_ml)}>
                                + {p.nome} · {formatarMl(p.volume_ml)}
                            </button>
                        ))}
                        <button type="button" disabled={disabled || valor.doses.length >= MAX_DOSES}
                            className={`${chipClass} inline-flex items-center gap-1`} onClick={() => adicionar('', null)}>
                            <Plus className="w-3.5 h-3.5" /> Outra dose
                        </button>
                    </div>

                    {padrao && padrao.calc.receitaGarrafa !== null && mlPadrao && (
                        <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 text-sm text-blue-900 dark:text-blue-100" data-testid="doses-resumo">
                            Uma garrafa de {formatarMl(volume)} rende {String(padrao.calc.dosesVendaveis).replace('.', ',')} doses de{' '}
                            {formatarMl(mlPadrao)}: <strong>{formatCurrency(padrao.calc.receitaGarrafa)}</strong>
                            {padrao.calc.multiploDaGarrafa !== null && <> ({String(padrao.calc.multiploDaGarrafa).replace('.', ',')}× o preço da garrafa de {formatCurrency(precoGarrafa)})</>}.
                        </div>
                    )}

                    {avisos.length > 0 && (
                        <ul className="space-y-1" data-testid="doses-avisos">
                            {avisos.map(a => (
                                <li key={`${a.dose}-${a.tipo}`} className="flex items-start gap-2 text-xs font-medium text-amber-700 dark:text-amber-400">
                                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {a.mensagem}
                                </li>
                            ))}
                        </ul>
                    )}

                    <details className="group">
                        <summary className="cursor-pointer text-xs font-bold text-gray-500 dark:text-gray-400 select-none">
                            Avançado: perda e validade depois de aberta
                        </summary>
                        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                                <label className={labelClass} htmlFor="dose-perda">Perda esperada por garrafa (%)</label>
                                <input id="dose-perda" className={inputClass} inputMode="decimal" disabled={disabled}
                                    placeholder={loja ? `Padrão da loja: ${String(loja.perda_esperada_pct).replace('.', ',')}` : '0'}
                                    value={valor.perda_esperada_pct} onChange={e => atualizar({ perda_esperada_pct: e.target.value })} />
                                <p className="mt-1 text-[11px] text-gray-500">Derramou, sobrou no fundo: encarece cada dose no cálculo.</p>
                            </div>
                            <div>
                                <label className={labelClass} htmlFor="dose-validade">Validade depois de aberta (dias)</label>
                                <input id="dose-validade" className={inputClass} inputMode="numeric" disabled={disabled}
                                    placeholder="Ex.: 5 (vinho), vazio = não vence" value={valor.validade_aberta_dias}
                                    onChange={e => atualizar({ validade_aberta_dias: e.target.value })} />
                                <p className="mt-1 text-[11px] text-gray-500">Depois disso a garrafa aberta deixa de vender e vai para descarte.</p>
                            </div>
                        </div>
                    </details>

                    {garrafasAbertas > 0 && (
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                            Há {garrafasAbertas} garrafa(s) aberta(s) agora. Mudar o volume só vale para as próximas aberturas.
                        </p>
                    )}
                </>
            )}
        </div>
    );
};

export default DosesEditor;
