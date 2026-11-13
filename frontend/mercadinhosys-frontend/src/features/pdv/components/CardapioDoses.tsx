import { useCallback, useEffect, useState } from 'react';
import { GlassWater } from 'lucide-react';
import { formatCurrency } from '../../../utils/formatters';
import { dosesService } from '../../products/dosesService';
import { listarComDoses } from '../offlineCatalog';
import { DoseDaLinha, ProdutoPdv, formatarMlPdv, temDoses } from '../utils/dosesPdv';
import type { EscolhaDose } from './DoseSheet';

interface CardapioDosesProps {
    /** Muda quando o saldo pode ter mudado (venda concluída, garrafa encerrada): recarrega. */
    versao: number;
    offline: boolean;
    onEscolher: (produto: ProdutoPdv, escolha: EscolhaDose) => void;
}

/**
 * Cardápio do bar: um botão por dose (e a garrafa inteira) das bebidas que vendem por dose. Um toque adiciona ao
 * carrinho, sem abrir a folha de escolha. Sem internet usa o catálogo salvo no aparelho.
 */
const CardapioDoses = ({ versao, offline, onEscolher }: CardapioDosesProps) => {
    const [produtos, setProdutos] = useState<ProdutoPdv[] | null>(null);
    const [erro, setErro] = useState<string | null>(null);

    const carregar = useCallback(async () => {
        try {
            const lista = offline ? await listarComDoses() as unknown as ProdutoPdv[] : await dosesService.cardapio();
            setProdutos(lista.filter(temDoses));
            setErro(offline ? 'Sem internet: mostrando o catálogo salvo no aparelho.' : null);
        } catch {
            try {
                setProdutos((await listarComDoses() as unknown as ProdutoPdv[]).filter(temDoses));
                setErro('Sem conexão com o servidor: mostrando o catálogo salvo no aparelho.');
            } catch {
                setProdutos([]);
                setErro('Não foi possível carregar as doses.');
            }
        }
    }, [offline]);

    useEffect(() => { void carregar(); }, [carregar, versao]);

    if (produtos === null) return <p className="py-3 text-xs font-semibold text-slate-400">Carregando doses…</p>;
    if (produtos.length === 0) {
        return (
            <p className="py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">
                {erro || 'Nenhuma bebida com dose para servir agora. Configure no cadastro do produto → Venda por dose.'}
            </p>
        );
    }

    return (
        <div data-testid="cardapio-doses" className="space-y-2">
            {erro && <p className="text-[11px] font-semibold text-amber-600">{erro}</p>}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                {produtos.map(p => {
                    const doses = p.doses || [];
                    const saldo = Number(p.saldo_aberto_ml) || 0;
                    return (
                        <div key={p.id}
                            className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3">
                            <div className="flex items-start justify-between gap-2">
                                <p className="min-w-0 text-sm font-black text-slate-900 dark:text-white leading-tight break-words">{p.nome}</p>
                                {saldo > 0 && (
                                    <span className="shrink-0 rounded-full bg-emerald-50 dark:bg-emerald-900/20 px-2 py-0.5 text-[10px] font-black text-emerald-700 dark:text-emerald-300">
                                        aberta {formatarMlPdv(saldo)}
                                    </span>
                                )}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                                {doses.map(d => {
                                    const dose: DoseDaLinha = { id: d.id, nome: d.nome, volumeMl: d.volume_ml };
                                    return (
                                        <button key={d.id} type="button"
                                            aria-label={`${p.nome} ${d.nome} ${formatarMlPdv(d.volume_ml)}`}
                                            onClick={() => onEscolher(p, { tipo: 'dose', dose, preco: d.preco_venda })}
                                            className={`min-h-11 rounded-xl border px-3 py-1.5 text-left text-xs font-black transition-colors active:scale-95 ${d.padrao
                                                ? 'border-blue-600 bg-blue-600 text-white'
                                                : 'border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-slate-100 hover:border-blue-400'}`}>
                                            <span className="block">{d.nome} · {formatarMlPdv(d.volume_ml)}</span>
                                            <span className="block tabular-nums opacity-90">{formatCurrency(d.preco_venda)}</span>
                                        </button>
                                    );
                                })}
                                <button type="button" aria-label={`${p.nome} garrafa inteira`}
                                    onClick={() => onEscolher(p, { tipo: 'garrafa' })}
                                    className="min-h-11 rounded-xl border border-dashed border-slate-300 dark:border-slate-600 px-3 py-1.5 text-left text-xs font-black text-slate-600 dark:text-slate-300 hover:border-blue-400">
                                    <span className="flex items-center gap-1"><GlassWater className="w-3 h-3" /> Garrafa</span>
                                    <span className="block tabular-nums opacity-90">{formatCurrency(Number((p as any).preco_venda_efetivo ?? p.preco_venda) || 0)}</span>
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default CardapioDoses;
