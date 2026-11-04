import React, { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../../api/apiClient';
import { showToast } from '../../utils/toast';
import { Activity, Clock, Eye, MessageCircle, RefreshCw, ScrollText, Users } from 'lucide-react';
import { ROTULOS_EVENTO, ROTULOS_ORIGEM, formatarDuracao } from './siteRotulos';

/*
 * Rastreio do site público (super admin): visitantes, origens, funil por sessão,
 * páginas e ações. Números contados no servidor (/api/saas/crm/site/resumo).
 */

interface Totais {
    visitantes: number;
    sessoes: number;
    paginas_vistas: number;
    duracao_media_seg: number | null;
    rolagem_media_pct: number | null;
    cliques_whatsapp: number;
    leads: number;
}

interface Resumo {
    success: boolean;
    dias: number;
    totais: Totais;
    funil: { etapa: string; sessoes: number }[];
    por_dia: { dia: string; acessos: number; visitantes: number }[];
    origens: { origem: string; sessoes: number }[];
    campanhas: { campanha: string; acessos: number }[];
    paginas: { rota: string; views: number; duracao_media_seg: number | null; rolagem_media_pct: number | null }[];
    eventos: { evento: string; total: number }[];
    segmentos_clicados: { segmento: string; total: number }[];
    dispositivos: { dispositivo: string; acessos: number }[];
    leads_por_origem: { origem: string; leads: number }[];
}

interface ItemRanking {
    rotulo: string;
    valor: number;
}

const PERIODOS: number[] = [7, 30, 90];
const NUMERO = new Intl.NumberFormat('pt-BR');

const percentual = (valor: number | null) => (valor === null || !Number.isFinite(valor) ? '—' : `${Math.round(valor)}%`);

function diaCurto(dia: string): string {
    const [ano, mes, d] = dia.split('T')[0].split('-');
    return ano && mes && d ? `${d}/${mes}` : dia;
}

const cartao = 'rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800 sm:p-5';
const vazio = (carregando: boolean, texto = 'Sem dados no período.') => (
    <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">{carregando ? 'Carregando...' : texto}</p>
);

function Kpi({ titulo, valor, icone, carregando }: { titulo: string; valor: string; icone: React.ReactNode; carregando: boolean }) {
    return (
        <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                <span className="shrink-0">{icone}</span>
                <span className="truncate text-[11px] font-semibold uppercase tracking-wide">{titulo}</span>
            </div>
            {carregando
                ? <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">Carregando...</p>
                : <p className="mt-2 text-xl font-bold text-gray-900 dark:text-white sm:text-2xl">{valor}</p>}
        </div>
    );
}

function Ranking({ titulo, itens, carregando }: { titulo: string; itens: ItemRanking[]; carregando: boolean }) {
    const maximo = itens.reduce((maior, item) => Math.max(maior, item.valor), 0);
    return (
        <div className={cartao}>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{titulo}</h2>
            {carregando || itens.length === 0 ? vazio(carregando) : (
                <ul className="mt-4 space-y-3">
                    {itens.map((item, i) => (
                        <li key={`${item.rotulo}-${i}`}>
                            <div className="flex items-center justify-between gap-2 text-xs sm:text-sm">
                                <span className="truncate text-gray-700 dark:text-gray-200" title={item.rotulo}>{item.rotulo}</span>
                                <span className="shrink-0 font-semibold text-gray-900 dark:text-white">{NUMERO.format(item.valor)}</span>
                            </div>
                            <div className="mt-1 h-2 w-full rounded-full bg-gray-100 dark:bg-gray-700">
                                <div className="h-2 rounded-full bg-indigo-500" style={{ width: `${maximo > 0 ? Math.max((item.valor / maximo) * 100, 2) : 0}%` }} />
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

export default function RastreioSitePanel(): React.ReactElement {
    const [dias, setDias] = useState<number>(30);
    const [dados, setDados] = useState<Resumo | null>(null);
    const [carregando, setCarregando] = useState<boolean>(true);

    const carregar = useCallback(async (): Promise<void> => {
        setCarregando(true);
        try {
            const resposta = await apiClient.get(`/saas/crm/site/resumo?dias=${dias}`);
            setDados(resposta.data as Resumo);
        } catch {
            showToast.error('Não foi possível carregar o rastreio do site.');
        } finally {
            setCarregando(false);
        }
    }, [dias]);

    useEffect(() => { void carregar(); }, [carregar]);

    const inicial = carregando && dados === null;
    const totais = dados?.totais ?? null;
    const funil = dados?.funil ?? [];
    const porDia = dados?.por_dia ?? [];
    const paginas = dados?.paginas ?? [];
    const baseFunil = funil[0]?.sessoes ?? 0;
    const maxAcessos = porDia.reduce((maior, item) => Math.max(maior, item.acessos), 0);
    const rotuloOrigem = (o: string) => ROTULOS_ORIGEM[o] ?? o;

    return (
        <div className="w-full max-w-full space-y-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                    <h1 className="text-xl font-bold text-gray-900 dark:text-white sm:text-2xl">Rastreio do site</h1>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Só conta quem aceitou cookies de medição. Robôs e a equipe (?interno=1) ficam de fora.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
                        {PERIODOS.map(periodo => (
                            <button key={periodo} type="button" onClick={() => setDias(periodo)}
                                className={`px-3 py-2 text-sm font-medium transition-colors ${dias === periodo ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'}`}>
                                {periodo} dias
                            </button>
                        ))}
                    </div>
                    <button type="button" onClick={() => { void carregar(); }} disabled={carregando}
                        className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700">
                        <RefreshCw className={`h-4 w-4 ${carregando ? 'animate-spin' : ''}`} /> Atualizar
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                <Kpi titulo="Visitantes" valor={NUMERO.format(totais?.visitantes ?? 0)} icone={<Users className="h-4 w-4" />} carregando={inicial} />
                <Kpi titulo="Sessões" valor={NUMERO.format(totais?.sessoes ?? 0)} icone={<Activity className="h-4 w-4" />} carregando={inicial} />
                <Kpi titulo="Páginas vistas" valor={NUMERO.format(totais?.paginas_vistas ?? 0)} icone={<Eye className="h-4 w-4" />} carregando={inicial} />
                <Kpi titulo="Tempo médio" valor={formatarDuracao(totais?.duracao_media_seg ?? null)} icone={<Clock className="h-4 w-4" />} carregando={inicial} />
                <Kpi titulo="Rolagem média" valor={percentual(totais?.rolagem_media_pct ?? null)} icone={<ScrollText className="h-4 w-4" />} carregando={inicial} />
                <Kpi titulo="Cliques no WhatsApp" valor={NUMERO.format(totais?.cliques_whatsapp ?? 0)} icone={<MessageCircle className="h-4 w-4" />} carregando={inicial} />
            </div>

            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">
                Leads no período: <strong className="font-bold">{inicial ? 'Carregando...' : NUMERO.format(totais?.leads ?? 0)}</strong>
            </div>

            <div className={cartao}>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Funil (por sessão)</h2>
                {inicial || funil.length === 0 ? vazio(inicial) : (
                    <div className="mt-4 space-y-4">
                        {funil.map((etapa, i) => {
                            const anterior = i > 0 ? funil[i - 1] : undefined;
                            const taxa = !anterior ? '—' : anterior.sessoes > 0 ? `${Math.round((etapa.sessoes / anterior.sessoes) * 100)}%` : '—';
                            return (
                                <div key={etapa.etapa}>
                                    <div className="flex items-center justify-between gap-2 text-sm">
                                        <span className="truncate text-gray-700 dark:text-gray-200">{etapa.etapa}</span>
                                        <span className="shrink-0 font-semibold text-gray-900 dark:text-white">
                                            {NUMERO.format(etapa.sessoes)}
                                            <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">{taxa}</span>
                                        </span>
                                    </div>
                                    <div className="mt-1 h-2.5 w-full rounded-full bg-gray-100 dark:bg-gray-700">
                                        <div className="h-2.5 rounded-full bg-indigo-500" style={{ width: `${baseFunil > 0 ? Math.min(100, Math.max((etapa.sessoes / baseFunil) * 100, etapa.sessoes > 0 ? 2 : 0)) : 0}%` }} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            <div className={cartao}>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Acessos por dia</h2>
                {inicial || porDia.length === 0 ? vazio(inicial) : (
                    <div className="mt-4 overflow-x-auto">
                        <div className="flex items-end gap-2">
                            {porDia.map(item => (
                                <div key={item.dia} className="flex min-w-[28px] flex-col items-center gap-1"
                                    title={`${diaCurto(item.dia)}: ${NUMERO.format(item.acessos)} acessos, ${NUMERO.format(item.visitantes)} visitantes`}>
                                    <div className="flex h-40 w-full items-end justify-center">
                                        <div className="w-4 rounded-t bg-indigo-500 sm:w-6" style={{ height: `${maxAcessos > 0 ? Math.max((item.acessos / maxAcessos) * 100, 3) : 0}%` }} />
                                    </div>
                                    <span className="text-[10px] text-gray-500 dark:text-gray-400">{diaCurto(item.dia)}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Ranking titulo="De onde vêm (sessões)" itens={(dados?.origens ?? []).map(o => ({ rotulo: rotuloOrigem(o.origem), valor: o.sessoes }))} carregando={inicial} />
                <Ranking titulo="Campanhas (UTM)" itens={(dados?.campanhas ?? []).map(c => ({ rotulo: c.campanha, valor: c.acessos }))} carregando={inicial} />
                <Ranking titulo="Segmentos mais clicados" itens={(dados?.segmentos_clicados ?? []).map(s => ({ rotulo: s.segmento, valor: s.total }))} carregando={inicial} />
                <Ranking titulo="Aparelhos" itens={(dados?.dispositivos ?? []).map(d => ({ rotulo: d.dispositivo, valor: d.acessos }))} carregando={inicial} />
                <Ranking titulo="O que as pessoas fazem" itens={(dados?.eventos ?? []).map(e => ({ rotulo: ROTULOS_EVENTO[e.evento] ?? e.evento, valor: e.total }))} carregando={inicial} />
                <Ranking titulo="Leads por origem" itens={(dados?.leads_por_origem ?? []).map(l => ({ rotulo: rotuloOrigem(l.origem), valor: l.leads }))} carregando={inicial} />
            </div>

            <div className={cartao}>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Páginas</h2>
                {inicial || paginas.length === 0 ? vazio(inicial) : (
                    <div className="mt-3 overflow-x-auto">
                        <table className="w-full min-w-[520px] text-left text-sm">
                            <thead>
                                <tr className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                    <th className="py-2 pr-3 font-semibold">Rota</th>
                                    <th className="py-2 pr-3 text-right font-semibold">Visitas</th>
                                    <th className="py-2 pr-3 text-right font-semibold">Tempo médio</th>
                                    <th className="py-2 text-right font-semibold">Rolagem</th>
                                </tr>
                            </thead>
                            <tbody>
                                {paginas.map(p => (
                                    <tr key={p.rota} className="border-t border-gray-100 dark:border-gray-700">
                                        <td className="max-w-[240px] truncate py-2 pr-3 text-gray-700 dark:text-gray-200" title={p.rota}>{p.rota}</td>
                                        <td className="py-2 pr-3 text-right text-gray-900 dark:text-white">{NUMERO.format(p.views)}</td>
                                        <td className="py-2 pr-3 text-right text-gray-700 dark:text-gray-200">{formatarDuracao(p.duracao_media_seg)}</td>
                                        <td className="py-2 text-right text-gray-700 dark:text-gray-200">{percentual(p.rolagem_media_pct)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
