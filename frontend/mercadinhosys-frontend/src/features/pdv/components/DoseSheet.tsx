import { useEffect, useMemo, useRef, useState } from 'react';
import { GlassWater, Lock, X } from 'lucide-react';
import { formatCurrency } from '../../../utils/formatters';
import { showToast } from '../../../utils/toast';
import { dosesService, erroDoses } from '../../products/dosesService';
import {
    DoseDaLinha, LinhaCarrinho, OfertaDose, ProdutoPdv, chaveDaLinha, chaveDe, formatarMlPdv, maxDaLinha,
    maxGarrafasInteiras, opcaoInicial, precoDoseLivre, salvarUltimaEscolha, validarMlLivre,
} from '../utils/dosesPdv';

export type EscolhaDose =
    | { tipo: 'garrafa' }
    | { tipo: 'dose'; dose: DoseDaLinha; preco: number };

interface DoseSheetProps {
    produto: ProdutoPdv & OfertaDose;
    estoqueFechado: number;
    carrinho: LinhaCarrinho[];
    /** Dose livre fica fora do modo offline (pede PIN de gerente no servidor). */
    offline: boolean;
    permitirSemEstoque: boolean;
    onEscolher: (escolha: EscolhaDose) => void;
    onFechar: () => void;
    /** Depois de "terminou a garrafa": o pai recarrega o saldo. */
    onGarrafaEncerrada?: () => void;
}

interface Opcao {
    id: string;                  // 'garrafa' | 'd<id>'
    rotulo: string;
    preco: number;
    restam: number;
    escolha: EscolhaDose;
}

const virgula = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');

/**
 * Escolha rápida no caixa de bar: o que serve deste produto — garrafa inteira ou uma das doses que o lojista
 * cadastrou (ml e preço dele). A última escolha vem realçada, 1-9 escolhem e Enter confirma. "Outra quantidade"
 * serve um ml fora da tabela (o servidor pede o PIN de gerente quando o caixa não pode).
 */
const DoseSheet = ({
    produto, estoqueFechado, carrinho, offline, permitirSemEstoque, onEscolher, onFechar, onGarrafaEncerrada,
}: DoseSheetProps) => {
    const opcoes = useMemo<Opcao[]>(() => {
        const naLinha = (chave: string) => carrinho.filter(l => chaveDe(l) === chave).reduce((s, l) => s + l.quantidade, 0);
        const doses: Opcao[] = produto.doses.map(d => {
            const dose: DoseDaLinha = { id: d.id, nome: d.nome, volumeMl: d.volume_ml };
            return {
                id: `d${d.id}`, rotulo: `${d.nome} · ${formatarMlPdv(d.volume_ml)}`, preco: d.preco_venda,
                restam: maxDaLinha(carrinho, produto, estoqueFechado, dose) - naLinha(chaveDaLinha(produto.id, dose)),
                escolha: { tipo: 'dose', dose, preco: d.preco_venda },
            };
        });
        const inteira: Opcao = {
            id: 'garrafa', rotulo: `Garrafa inteira · ${formatarMlPdv(produto.volume_embalagem_ml)}`,
            preco: Number((produto as any).preco_venda_efetivo ?? produto.preco_venda) || 0,
            restam: maxGarrafasInteiras(carrinho, produto, estoqueFechado) - naLinha(chaveDaLinha(produto.id)),
            escolha: { tipo: 'garrafa' },
        };
        return [...doses, inteira];
    }, [produto, estoqueFechado, carrinho]);

    const [ativa, setAtiva] = useState(() => opcaoInicial(produto));
    const [livreAberto, setLivreAberto] = useState(false);
    const [mlTexto, setMlTexto] = useState('');
    const [encerrando, setEncerrando] = useState(false);
    const livreRef = useRef<HTMLInputElement>(null);
    const sheetRef = useRef<HTMLDivElement>(null);

    const mlLivre = Number(mlTexto.replace(',', '.'));
    const erroLivre = mlTexto ? validarMlLivre(produto, Number.isFinite(mlLivre) ? mlLivre : null) : null;
    const precoLivre = !erroLivre && mlTexto ? precoDoseLivre(produto, mlLivre) : null;

    const disponivel = (o: Opcao) => permitirSemEstoque || o.restam > 0;

    const escolher = (o: Opcao) => {
        if (!disponivel(o)) {
            showToast.error(o.id === 'garrafa' ? 'Sem garrafa fechada em estoque.' : `Sem ml suficiente para ${o.rotulo}.`);
            return;
        }
        salvarUltimaEscolha(produto.id, o.id);
        onEscolher(o.escolha);
    };

    const escolherLivre = () => {
        if (erroLivre || precoLivre === null) {
            showToast.error(erroLivre || 'Informe quantos ml vão no copo.');
            return;
        }
        const dose: DoseDaLinha = { id: null, nome: 'Dose livre', volumeMl: mlLivre, livre: true };
        if (!permitirSemEstoque && maxDaLinha(carrinho, produto, estoqueFechado, dose) <= 0) {
            showToast.error(`Sem ml suficiente para ${formatarMlPdv(mlLivre)}.`);
            return;
        }
        onEscolher({ tipo: 'dose', dose, preco: precoLivre });
    };

    useEffect(() => { sheetRef.current?.focus(); }, []);
    useEffect(() => { if (livreAberto) livreRef.current?.focus(); }, [livreAberto]);

    const aoTeclar = (e: KeyboardEvent) => {
        const digitando = ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement | null)?.tagName || '');
        if (livreAberto || digitando) {
            if (e.key === 'Escape') { setLivreAberto(false); e.stopPropagation(); }
            return;
        }
        if (e.key === 'Escape') { onFechar(); return; }
        const posicao = opcoes.findIndex(o => o.id === ativa);
        if (e.key === 'ArrowDown') { e.preventDefault(); setAtiva(opcoes[(posicao + 1) % opcoes.length].id); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); setAtiva(opcoes[(posicao - 1 + opcoes.length) % opcoes.length].id); return; }
        if (e.key === 'Enter') { e.preventDefault(); const o = opcoes[posicao]; if (o) escolher(o); return; }
        if (/^[1-9]$/.test(e.key)) {
            const o = opcoes[Number(e.key) - 1];
            if (o) { e.preventDefault(); setAtiva(o.id); escolher(o); }
        }
    };

    // No documento (não no div): depois do clique na busca o foco pode estar em outro campo.
    const aoTeclarRef = useRef(aoTeclar);
    aoTeclarRef.current = aoTeclar;
    useEffect(() => {
        const ouvir = (e: KeyboardEvent) => aoTeclarRef.current(e);
        document.addEventListener('keydown', ouvir);
        return () => document.removeEventListener('keydown', ouvir);
    }, []);

    const saldo = Number(produto.saldo_aberto_ml) || 0;
    const base = produto.doses.find(d => d.padrao) || produto.doses[0];
    const dosesNaAberta = base ? Math.floor(saldo / base.volume_ml + 1e-9) : 0;
    const aberta = (produto.garrafas_abertas || [])[0];

    const terminouGarrafa = async () => {
        if (!aberta) return;
        setEncerrando(true);
        try {
            const r = await dosesService.encerrarGarrafa(aberta.id);
            showToast.success(r.desvio_ml > 0
                ? `Garrafa encerrada. Faltaram ${virgula(r.desvio_ml)} ml no controle.`
                : 'Garrafa encerrada.');
            onGarrafaEncerrada?.();
        } catch (e) {
            showToast.error(erroDoses(e, 'Não foi possível encerrar a garrafa'));
        } finally {
            setEncerrando(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[205] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
            onMouseDown={onFechar} data-testid="dose-sheet">
            <div ref={sheetRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`Servir ${produto.nome}`}
                onMouseDown={e => e.stopPropagation()}
                className="w-full sm:max-w-md max-h-[92vh] overflow-y-auto outline-none rounded-t-3xl sm:rounded-3xl bg-white dark:bg-slate-900 shadow-2xl p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <p className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-blue-600">
                            <GlassWater className="w-3.5 h-3.5" /> Servir
                        </p>
                        <h3 className="mt-0.5 text-lg font-black text-slate-900 dark:text-white leading-tight break-words">{produto.nome}</h3>
                        <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400" data-testid="dose-aberta">
                            {saldo > 0
                                ? `Garrafa aberta: ${formatarMlPdv(saldo)}${base ? ` ≈ ${dosesNaAberta} doses de ${formatarMlPdv(base.volume_ml)}` : ''}`
                                : 'Nenhuma garrafa aberta: a próxima dose abre uma.'}
                        </p>
                    </div>
                    <button type="button" onClick={onFechar} aria-label="Fechar"
                        className="shrink-0 w-11 h-11 flex items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="mt-4 space-y-2" role="listbox" aria-label="O que servir">
                    {opcoes.map((o, i) => {
                        const marcada = o.id === ativa;
                        const ok = disponivel(o);
                        return (
                            <button key={o.id} type="button" role="option" aria-selected={marcada} onClick={() => escolher(o)}
                                onMouseEnter={() => setAtiva(o.id)}
                                className={`w-full min-h-14 flex items-center justify-between gap-3 rounded-2xl border-2 px-4 py-3 text-left transition-colors ${marcada
                                    ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/20'
                                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'} ${ok ? '' : 'opacity-50'}`}>
                                <span className="min-w-0">
                                    <span className="block text-sm font-black text-slate-900 dark:text-white">
                                        <span className="mr-2 inline-flex w-5 h-5 items-center justify-center rounded-md bg-slate-200 dark:bg-slate-700 text-[10px] font-black text-slate-600 dark:text-slate-300">{i + 1}</span>
                                        {o.rotulo}
                                    </span>
                                    <span className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                                        {ok ? `restam ${Math.max(0, o.restam)}` : 'indisponível'}
                                    </span>
                                </span>
                                <span className="text-base font-black tabular-nums text-slate-900 dark:text-white">{formatCurrency(o.preco)}</span>
                            </button>
                        );
                    })}
                </div>

                {!offline ? (
                    <div className="mt-3">
                        {!livreAberto ? (
                            <button type="button" onClick={() => setLivreAberto(true)}
                                className="w-full min-h-12 rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-600 px-4 py-2.5 text-sm font-bold text-slate-600 dark:text-slate-300 hover:border-blue-400 hover:text-blue-600">
                                Outra quantidade (ml)
                            </button>
                        ) : (
                            <div className="rounded-2xl border-2 border-blue-200 dark:border-blue-800 p-3 space-y-2">
                                <label htmlFor="dose-livre-ml" className="block text-xs font-bold text-slate-600 dark:text-slate-300">
                                    Quantos ml vão no copo?
                                </label>
                                <div className="flex items-center gap-2">
                                    <input id="dose-livre-ml" ref={livreRef} inputMode="decimal" placeholder="Ex.: 45" value={mlTexto}
                                        onChange={e => setMlTexto(e.target.value.replace(/[^\d.,]/g, ''))}
                                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); escolherLivre(); } }}
                                        className="flex-1 min-w-0 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2.5 text-base font-bold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500" />
                                    <button type="button" onClick={escolherLivre} disabled={!precoLivre}
                                        className="min-h-11 rounded-xl bg-blue-600 px-4 text-sm font-black text-white disabled:opacity-40">
                                        Adicionar {precoLivre ? formatCurrency(precoLivre) : ''}
                                    </button>
                                </div>
                                {erroLivre && <p className="text-xs font-semibold text-red-600">{erroLivre}</p>}
                                <p className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                                    <Lock className="w-3 h-3" /> Pode pedir o PIN de um gerente ao fechar a venda.
                                </p>
                            </div>
                        )}
                    </div>
                ) : (
                    <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">
                        Sem internet: só as doses cadastradas. Ml livre volta quando o sinal voltar.
                    </p>
                )}

                {aberta && !offline && (
                    <button type="button" onClick={terminouGarrafa} disabled={encerrando}
                        className="mt-4 w-full min-h-11 rounded-xl text-xs font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50">
                        {encerrando ? 'Encerrando…' : 'Terminou a garrafa'}
                    </button>
                )}
            </div>
        </div>
    );
};

export default DoseSheet;
