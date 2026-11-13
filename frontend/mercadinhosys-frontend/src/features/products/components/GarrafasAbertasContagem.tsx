import { useState } from 'react';
import { GlassWater } from 'lucide-react';
import { showToast } from '../../../utils/toast';
import { dosesService, erroDoses } from '../dosesService';
import { mlTexto } from '../utils/estoqueDose';
import { numero } from '../utils/doses';

export interface ItemComAberta {
    produto_id: number;
    nome: string;
    garrafas: Array<{ id: number; saldo_ml: number; volume_inicial_ml: number }>;
}

/**
 * Contagem cíclica de bebida que vende por dose: o bip conta as garrafas FECHADAS; a aberta não está na prateleira e
 * se conta em ml (régua ou olho). Cada garrafa aberta ganha o campo para o dono dizer quanto tem agora.
 */
const GarrafasAbertasContagem = ({ itens }: { itens: ItemComAberta[] }) => {
    const [valores, setValores] = useState<Record<number, string>>({});
    const [feitas, setFeitas] = useState<Record<number, number>>({});
    const [ocupada, setOcupada] = useState<number | null>(null);

    if (itens.length === 0) return null;

    const registrar = async (garrafaId: number, volume: number) => {
        const fisico = numero(valores[garrafaId]);
        if (fisico === null || fisico < 0) { showToast.error('Informe quantos ml tem a garrafa agora.'); return; }
        if (fisico > volume) { showToast.error(`A garrafa tem no máximo ${mlTexto(volume)}.`); return; }
        setOcupada(garrafaId);
        try {
            const r = await dosesService.ajustarGarrafa(garrafaId, fisico, 'Contagem cíclica');
            setFeitas(f => ({ ...f, [garrafaId]: r.diferenca_ml }));
            showToast.success(r.diferenca_ml === 0 ? 'Confere com o controle.'
                : `Diferença de ${r.diferenca_ml > 0 ? '+' : ''}${String(r.diferenca_ml).replace('.', ',')} ml registrada.`);
        } catch (e) {
            showToast.error(erroDoses(e, 'Não foi possível registrar a contagem'));
        } finally {
            setOcupada(null);
        }
    };

    return (
        <section className="mt-6 rounded-2xl border border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-900/10 p-4"
            data-testid="garrafas-abertas-contagem">
            <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-blue-800 dark:text-blue-200">
                <GlassWater className="h-4 w-4" /> Garrafas abertas: conte em ml
            </h2>
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                O bip contou só as garrafas fechadas. A que está aberta no balcão se conta em ml.
            </p>
            <ul className="mt-3 space-y-3">
                {itens.map(item => item.garrafas.map(g => (
                    <li key={g.id} className="rounded-xl bg-white dark:bg-gray-800 p-3">
                        <p className="text-sm font-bold text-gray-900 dark:text-white">{item.nome}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">O controle diz {mlTexto(g.saldo_ml)} de {mlTexto(g.volume_inicial_ml)}</p>
                        {g.id in feitas ? (
                            <p className="mt-2 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                                Registrado{feitas[g.id] !== 0 ? `: diferença de ${feitas[g.id] > 0 ? '+' : ''}${String(feitas[g.id]).replace('.', ',')} ml` : ': confere'}
                            </p>
                        ) : (
                            <div className="mt-2 flex items-center gap-2">
                                <input aria-label={`ml na garrafa de ${item.nome}`} inputMode="decimal" placeholder="ml agora"
                                    value={valores[g.id] ?? ''}
                                    onChange={e => setValores(v => ({ ...v, [g.id]: e.target.value.replace(/[^\d.,]/g, '') }))}
                                    className="min-w-0 flex-1 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2.5 text-sm text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500" />
                                <button type="button" disabled={ocupada === g.id} onClick={() => void registrar(g.id, g.volume_inicial_ml)}
                                    className="min-h-11 rounded-xl bg-blue-600 px-4 text-xs font-black uppercase tracking-wide text-white hover:bg-blue-700 disabled:opacity-50">
                                    Registrar
                                </button>
                            </div>
                        )}
                    </li>
                )))}
            </ul>
        </section>
    );
};

export default GarrafasAbertasContagem;
