import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, GlassWater, Loader2 } from 'lucide-react';
import { confirmar } from '../../../components/ui/Confirmacao';
import { formatCurrency, formatDateTime } from '../../../utils/formatters';
import { showToast } from '../../../utils/toast';
import {
    GarrafaAbertaDto, RespostaRazao, TipoBaixa, dosesService, erroDoses,
} from '../dosesService';
import { TIPOS_RAZAO, diasAberta, mlTexto } from '../utils/estoqueDose';
import { numero } from '../utils/doses';

interface DosesPainelProps {
    produtoId: number;
    /** Quem chama recarrega o que depende do saldo (cards, KPIs). */
    onMudou?: () => void;
}

const ROTULO_BAIXA: Record<TipoBaixa, string> = {
    perda: 'Perda / derramou', cortesia: 'Cortesia', degustacao: 'Degustação',
};

const campo = 'w-full min-w-0 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm '
    + 'text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500';
const botao = 'min-h-11 rounded-xl px-4 text-xs font-black uppercase tracking-wide transition-colors disabled:opacity-50';

type Acao = { garrafaId: number; tipo: 'ajustar' | 'descartar' } | null;

/**
 * Venda por dose no detalhe do produto: garrafas abertas (saldo, idade, validade), saída de ml (perda, cortesia,
 * degustação), contagem da aberta, descarte e o razão de ml. Caixa comum pode pedir; o servidor exige o PIN de
 * gerente (o app já pede sozinho) e registra quem fez.
 */
const DosesPainel = ({ produtoId, onMudou }: DosesPainelProps) => {
    const [dados, setDados] = useState<RespostaRazao | null>(null);
    const [erro, setErro] = useState<string | null>(null);
    const [ocupado, setOcupado] = useState(false);
    const [acao, setAcao] = useState<Acao>(null);
    const [valor, setValor] = useState('');
    const [motivoAcao, setMotivoAcao] = useState('');
    const [tipo, setTipo] = useState<TipoBaixa>('perda');
    const [ml, setMl] = useState('');
    const [motivo, setMotivo] = useState('');

    const carregar = useCallback(async () => {
        try {
            setDados(await dosesService.razao(produtoId));
            setErro(null);
        } catch (e) {
            setErro(erroDoses(e, 'Não foi possível carregar as doses deste produto'));
        }
    }, [produtoId]);

    useEffect(() => { void carregar(); }, [carregar]);

    const executar = async (tarefa: () => Promise<string>) => {
        setOcupado(true);
        try {
            showToast.success(await tarefa());
            setAcao(null); setValor(''); setMotivoAcao('');
            await carregar();
            onMudou?.();
        } catch (e) {
            showToast.error(erroDoses(e, 'Não foi possível concluir'));
        } finally {
            setOcupado(false);
        }
    };

    const registrarSaida = () => {
        const quantidade = numero(ml);
        if (quantidade === null || quantidade <= 0) { showToast.error('Informe quantos ml.'); return; }
        if (tipo === 'perda' && !motivo.trim()) { showToast.error('Diga o que aconteceu (derramou, quebrou...).'); return; }
        void executar(async () => {
            const r = await dosesService.baixar(produtoId, { tipo, ml: quantidade, motivo: motivo.trim() || undefined });
            setMl(''); setMotivo('');
            return `${ROTULO_BAIXA[tipo]}: ${mlTexto(r.ml)} registrados (${formatCurrency(r.custo)}).`;
        });
    };

    const terminou = async (g: GarrafaAbertaDto) => {
        const sim = await confirmar({
            titulo: 'Encerrar esta garrafa?',
            mensagem: `O controle ainda mostra ${mlTexto(g.saldo_ml)}. O que faltar vira diferença no controle (para ver quem serve generoso).`,
            acao: 'Terminou a garrafa', cancelar: 'Voltar',
        });
        if (!sim) return;
        void executar(async () => {
            const r = await dosesService.encerrarGarrafa(g.id);
            return r.desvio_ml > 0 ? `Garrafa encerrada. Faltaram ${mlTexto(r.desvio_ml)} no controle.` : 'Garrafa encerrada.';
        });
    };

    const confirmarAcao = (g: GarrafaAbertaDto) => {
        if (!acao) return;
        if (acao.tipo === 'ajustar') {
            const fisico = numero(valor);
            if (fisico === null || fisico < 0) { showToast.error('Informe quantos ml tem a garrafa agora.'); return; }
            if (fisico > g.volume_inicial_ml) { showToast.error(`A garrafa tem no máximo ${mlTexto(g.volume_inicial_ml)}.`); return; }
            void executar(async () => {
                const r = await dosesService.ajustarGarrafa(g.id, fisico, motivoAcao.trim() || undefined);
                return r.diferenca_ml === 0 ? 'Contagem confere com o controle.'
                    : `Diferença de ${r.diferenca_ml > 0 ? '+' : ''}${String(r.diferenca_ml).replace('.', ',')} ml registrada.`;
            });
        } else {
            void executar(async () => {
                const r = await dosesService.descartarGarrafa(g.id, motivoAcao.trim() || undefined);
                return `Garrafa descartada: ${mlTexto(r.perdido_ml)} (${formatCurrency(r.custo)}) como perda.`;
            });
        }
    };

    if (erro) return <p className="p-4 text-sm font-semibold text-red-600">{erro}</p>;
    if (!dados) return <p className="flex items-center gap-2 p-4 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Carregando doses…</p>;

    const { garrafas_abertas: abertas, razao } = dados;
    return (
        <div className="space-y-6" data-testid="doses-painel">
            <section aria-label="Garrafas abertas" className="space-y-3">
                <h4 className="text-xs font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">Garrafas abertas</h4>
                {abertas.length === 0 && (
                    <p className="text-sm text-gray-500 dark:text-gray-400">Nenhuma garrafa aberta: a próxima dose vendida abre uma.</p>
                )}
                {abertas.map(g => {
                    const pct = Math.max(0, Math.min(100, (g.saldo_ml / g.volume_inicial_ml) * 100));
                    const dias = diasAberta(g.aberta_em);
                    const vencida = !!g.validade_aberta && g.validade_aberta < new Date().toISOString().slice(0, 10);
                    const aqui = acao?.garrafaId === g.id ? acao : null;
                    return (
                        <div key={g.id} data-testid="garrafa-aberta"
                            className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 p-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-sm font-black text-gray-900 dark:text-white">
                                    {mlTexto(g.saldo_ml)} <span className="font-semibold text-gray-500">de {mlTexto(g.volume_inicial_ml)}</span>
                                </p>
                                <p className="flex items-center gap-2 text-xs font-semibold text-gray-500 dark:text-gray-400">
                                    {dias !== null && <span>aberta há {dias === 0 ? 'menos de 1 dia' : `${dias} dia${dias > 1 ? 's' : ''}`}</span>}
                                    {vencida && (
                                        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 dark:bg-red-900/30 px-2 py-0.5 text-red-700 dark:text-red-300">
                                            <AlertTriangle className="h-3 w-3" /> vencida depois de aberta
                                        </span>
                                    )}
                                </p>
                            </div>
                            <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700" aria-hidden>
                                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                                <button type="button" disabled={ocupado} className={`${botao} bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-200 hover:bg-blue-100`}
                                    onClick={() => { setAcao({ garrafaId: g.id, tipo: 'ajustar' }); setValor(''); setMotivoAcao(''); }}>
                                    Contei a garrafa
                                </button>
                                <button type="button" disabled={ocupado} className={`${botao} bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200`}
                                    onClick={() => void terminou(g)}>
                                    Terminou
                                </button>
                                <button type="button" disabled={ocupado} className={`${botao} bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 hover:bg-red-100`}
                                    onClick={() => { setAcao({ garrafaId: g.id, tipo: 'descartar' }); setValor(''); setMotivoAcao(''); }}>
                                    Descartar
                                </button>
                            </div>
                            {aqui && (
                                <div className="mt-3 space-y-2 rounded-xl bg-gray-50 dark:bg-gray-900/50 p-3">
                                    {aqui.tipo === 'ajustar' ? (
                                        <>
                                            <label className="block text-xs font-bold text-gray-600 dark:text-gray-300" htmlFor={`fisico-${g.id}`}>
                                                Quantos ml tem a garrafa agora? (o controle diz {mlTexto(g.saldo_ml)})
                                            </label>
                                            <input id={`fisico-${g.id}`} className={campo} inputMode="decimal" placeholder="Ex.: 620" value={valor}
                                                onChange={e => setValor(e.target.value.replace(/[^\d.,]/g, ''))} />
                                        </>
                                    ) : (
                                        <p className="text-xs font-semibold text-red-700 dark:text-red-300">
                                            Os {mlTexto(g.saldo_ml)} que restam viram perda no relatório. Não dá para desfazer.
                                        </p>
                                    )}
                                    <input className={campo} aria-label="Motivo" placeholder="Motivo (opcional)" value={motivoAcao}
                                        onChange={e => setMotivoAcao(e.target.value)} maxLength={120} />
                                    <div className="flex gap-2">
                                        <button type="button" disabled={ocupado} onClick={() => confirmarAcao(g)}
                                            className={`${botao} ${aqui.tipo === 'descartar' ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
                                            {aqui.tipo === 'ajustar' ? 'Registrar contagem' : 'Descartar garrafa'}
                                        </button>
                                        <button type="button" disabled={ocupado} onClick={() => setAcao(null)}
                                            className={`${botao} text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700`}>
                                            Voltar
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </section>

            <section aria-label="Registrar saída de ml" className="space-y-2">
                <h4 className="text-xs font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">Registrar saída de ml</h4>
                <div className="grid grid-cols-2 gap-2 xl:grid-cols-12">
                    <select aria-label="Tipo de saída" className={`${campo} col-span-2 xl:col-span-3`} value={tipo}
                        onChange={e => setTipo(e.target.value as TipoBaixa)}>
                        {(Object.keys(ROTULO_BAIXA) as TipoBaixa[]).map(t => <option key={t} value={t}>{ROTULO_BAIXA[t]}</option>)}
                    </select>
                    <input aria-label="ml" className={`${campo} col-span-2 sm:col-span-1 xl:col-span-2`} inputMode="decimal" placeholder="ml" value={ml}
                        onChange={e => setMl(e.target.value.replace(/[^\d.,]/g, ''))} />
                    <input aria-label="O que aconteceu" className={`${campo} col-span-2 sm:col-span-1 xl:col-span-5`} maxLength={120}
                        placeholder={tipo === 'perda' ? 'O que aconteceu? (obrigatório)' : 'Para quem / motivo (opcional)'}
                        value={motivo} onChange={e => setMotivo(e.target.value)} />
                    <button type="button" disabled={ocupado} onClick={registrarSaida}
                        className={`${botao} col-span-2 xl:col-span-2 bg-gray-900 dark:bg-white text-white dark:text-gray-900`}>
                        Registrar
                    </button>
                </div>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                    Sai da garrafa aberta (se não houver, abre uma). Caixa comum precisa do PIN de um gerente.
                </p>
            </section>

            <section aria-label="Movimentos de ml" className="space-y-2">
                <h4 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">
                    <GlassWater className="h-3.5 w-3.5" /> Movimentos de ml
                </h4>
                {razao.length === 0 ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400">Ainda não houve venda por dose deste produto.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs" data-testid="razao-ml">
                            <thead>
                                <tr className="border-b border-gray-200 dark:border-gray-700 text-gray-500">
                                    <th className="py-2 pr-3">Quando</th><th className="pr-3">O quê</th>
                                    <th className="pr-3 text-right">ml</th><th className="pr-3">Detalhe</th>
                                    <th className="pr-3">Quem</th><th className="text-right">Custo</th>
                                </tr>
                            </thead>
                            <tbody>
                                {razao.map(l => (
                                    <tr key={l.id} className="border-b border-gray-100 dark:border-gray-800">
                                        <td className="py-2 pr-3 whitespace-nowrap">{l.em ? formatDateTime(l.em) : '—'}</td>
                                        <td className="pr-3 font-semibold">{TIPOS_RAZAO[l.tipo] || l.tipo}</td>
                                        <td className={`pr-3 text-right tabular-nums font-bold ${l.ml < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                                            {l.ml > 0 ? '+' : ''}{String(l.ml).replace('.', ',')}
                                        </td>
                                        <td className="pr-3">{[l.dose, l.venda, l.motivo].filter(Boolean).join(' · ') || '—'}</td>
                                        <td className="pr-3">{l.funcionario || '—'}</td>
                                        <td className="text-right tabular-nums">{l.custo !== null ? formatCurrency(l.custo) : '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>
        </div>
    );
};

export default DosesPainel;
