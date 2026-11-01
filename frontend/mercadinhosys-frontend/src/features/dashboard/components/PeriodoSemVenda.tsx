import { CalendarClock, ArrowRight } from 'lucide-react';
import { formatCurrency, formatDate } from '../../../utils/formatters';
import { ultimoMovimentoDoPayload, type DiaComVenda } from '../../../utils/ultimoMovimento';

interface PeriodoSemVendaProps {
    data: any;
    /** Rótulo do período que o dono escolheu (ex.: "31/10/2026"). */
    periodo?: string;
    /** Troca o período do painel (ex.: 30 dias). */
    onVerPeriodo?: (dias: number) => void;
    /** "completo" substitui os cards zerados; "banner" é a faixa no topo da página. */
    variante?: 'completo' | 'banner';
}

/**
 * Período sem venda não é sinônimo de R$ 0,00 em seis cards: é ausência de dado.
 * Mostra o que aconteceu, quando foi o último movimento e o atalho para o período
 * que tem número — sem inventar valor nem esconder a lacuna.
 */
export default function PeriodoSemVenda({ data, periodo, onVerPeriodo, variante = 'completo' }: PeriodoSemVendaProps) {
    const ultimo: DiaComVenda | null = ultimoMovimentoDoPayload(data);
    const quando = periodo ? `em ${periodo}` : 'neste período';

    const botao = onVerPeriodo ? (
        <button
            type="button"
            onClick={() => onVerPeriodo(30)}
            className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
        >
            Ver os últimos 30 dias
            <ArrowRight className="h-4 w-4" />
        </button>
    ) : null;

    if (variante === 'banner') {
        return (
            <section
                aria-label="Período sem venda"
                className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
            >
                <CalendarClock className="h-5 w-5 shrink-0" aria-hidden="true" />
                <p className="font-semibold">
                    Nenhuma venda registrada {quando}.
                    {ultimo && (
                        <span className="font-normal">
                            {' '}Último movimento: {formatDate(ultimo.data)} — {formatCurrency(ultimo.valor)}.
                        </span>
                    )}
                </p>
                {botao}
            </section>
        );
    }

    return (
        <section
            aria-label="Período sem venda"
            className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-slate-700/60 dark:bg-slate-800/80"
        >
            <div className="flex items-start gap-3">
                <span className="rounded-xl bg-amber-100 p-2 dark:bg-amber-500/20">
                    <CalendarClock className="h-5 w-5 text-amber-700 dark:text-amber-400" aria-hidden="true" />
                </span>
                <div>
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">Nenhuma venda registrada {quando}</h2>
                    <p className="mt-1 text-sm text-gray-600 dark:text-slate-300">
                        Não houve venda finalizada neste recorte — por isso os indicadores não têm o que mostrar.
                        Isso não é falha de cálculo nem perda de dado.
                    </p>
                    {ultimo ? (
                        <p className="mt-3 text-sm text-gray-700 dark:text-slate-200">
                            Último movimento: <strong>{formatDate(ultimo.data)}</strong> —{' '}
                            <strong className="tabular-nums">{formatCurrency(ultimo.valor)}</strong>
                            {ultimo.qtd > 0 && <span className="text-gray-500 dark:text-slate-400"> ({ultimo.qtd} vendas)</span>}
                        </p>
                    ) : (
                        <p className="mt-3 text-sm text-gray-500 dark:text-slate-400">
                            Nenhuma venda registrada nos últimos 90 dias.
                        </p>
                    )}
                    {botao}
                </div>
            </div>
        </section>
    );
}
