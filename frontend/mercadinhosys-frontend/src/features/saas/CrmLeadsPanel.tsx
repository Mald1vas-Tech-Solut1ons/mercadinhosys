import React, { useCallback, useEffect, useState } from 'react';
import { CalendarClock, MessageCircle, MessageSquareText, MousePointerClick, Phone, Plus, Search, StickyNote, Workflow, X, FileText } from 'lucide-react';
import { apiClient } from '../../api/apiClient';
import { showToast } from '../../utils/toast';
import { ROTULOS_ETAPA, ROTULOS_EVENTO, ROTULOS_ORIGEM, SEGMENTOS_CRM, formatarDuracao } from './siteRotulos';

/*
 * CRM de leads do super admin: do site (formulário), do cadastro de teste e do porta a porta.
 * Kanban por etapa; detalhe com edição, anotações, histórico e a jornada do visitante no site.
 */

type Etapa = 'novo' | 'contatado' | 'demonstracao' | 'implantacao' | 'teste' | 'cliente' | 'perdido';

interface Lead {
    id: number; nome: string; email: string; whatsapp: string; origem: string | null; observacao: string | null;
    data_cadastro: string | null; etapa: Etapa; nome_loja: string | null; segmento: string | null;
    cidade: string | null; bairro: string | null; valor_mensal: number | null; proximo_contato: string | null;
    motivo_perda: string | null; loja_criada_id: number | null; visitante_id: string | null;
    origem_primeira: Record<string, string> | null; origem_ultima: Record<string, string> | null; atualizado_em: string | null;
}

interface Historico { id: number; tipo: 'etapa' | 'nota' | 'contato' | 'sistema'; texto: string; autor: string | null; criado_em: string }
type PassoJornada =
    | { tipo: 'pagina'; rota: string; duracao_seg: number | null; rolagem_pct: number | null; origem: string | null; em: string }
    | { tipo: 'acao'; rota: string; evento: string; rotulo: string | null; em: string };

interface ListaResposta { etapas: Etapa[]; por_etapa: Record<Etapa, number>; contatos_hoje: number; data: Lead[] }

const ETAPAS: Etapa[] = ['novo', 'contatado', 'demonstracao', 'implantacao', 'teste', 'cliente', 'perdido'];
const hojeISO = () => new Date().toLocaleDateString('sv-SE');
const ddmm = (iso: string | null) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '');
const ddmmHHmm = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const linkWhats = (numero: string) => {
    const digitos = numero.replace(/\D/g, '');
    return digitos ? `https://wa.me/${digitos.startsWith('55') ? digitos : `55${digitos}`}` : null;
};
const origemDoLead = (l: Lead) => {
    const bruta = l.origem_primeira?.utm_source || l.origem || '';
    return ROTULOS_ORIGEM[bruta] ?? bruta;
};
const entrada = 'w-full min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white';
const rotulo = 'mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400';

function Campo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
    return <label className="block min-w-0"><span className={rotulo}>{titulo}</span>{children}</label>;
}

type CampoForm = 'nome_loja' | 'nome' | 'whatsapp' | 'email' | 'segmento' | 'bairro' | 'cidade'
    | 'proximo_contato' | 'valor_mensal' | 'motivo_perda' | 'observacao';
type Formulario = Record<CampoForm, string>;

const deLead = (l: Lead): Formulario => ({
    nome_loja: l.nome_loja ?? '', nome: l.nome ?? '', whatsapp: l.whatsapp ?? '', email: l.email ?? '',
    segmento: l.segmento ?? '', bairro: l.bairro ?? '', cidade: l.cidade ?? '', proximo_contato: l.proximo_contato ?? '',
    valor_mensal: l.valor_mensal != null ? String(l.valor_mensal) : '', motivo_perda: l.motivo_perda ?? '', observacao: l.observacao ?? '',
});

function CamposLead({ form, setForm, etapa }: { form: Formulario; setForm: (f: Formulario) => void; etapa: Etapa }) {
    const muda = (campo: CampoForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [campo]: e.target.value });
    return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Campo titulo="Nome da loja"><input className={entrada} value={form.nome_loja} onChange={muda('nome_loja')} /></Campo>
            <Campo titulo="Contato"><input className={entrada} value={form.nome} onChange={muda('nome')} /></Campo>
            <Campo titulo="WhatsApp"><input className={entrada} inputMode="tel" value={form.whatsapp} onChange={muda('whatsapp')} /></Campo>
            <Campo titulo="E-mail"><input className={entrada} type="email" value={form.email} onChange={muda('email')} /></Campo>
            <Campo titulo="Segmento">
                <select className={entrada} value={form.segmento} onChange={muda('segmento')}>
                    <option value="">—</option>
                    {SEGMENTOS_CRM.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
            </Campo>
            <Campo titulo="Bairro"><input className={entrada} value={form.bairro} onChange={muda('bairro')} /></Campo>
            <Campo titulo="Cidade"><input className={entrada} value={form.cidade} onChange={muda('cidade')} /></Campo>
            <Campo titulo="Próximo contato"><input className={entrada} type="date" value={form.proximo_contato} onChange={muda('proximo_contato')} /></Campo>
            <Campo titulo="Valor mensal (R$)"><input className={entrada} inputMode="decimal" value={form.valor_mensal} onChange={muda('valor_mensal')} placeholder="99,90" /></Campo>
            {etapa === 'perdido' && <Campo titulo="Motivo da perda"><input className={entrada} value={form.motivo_perda} onChange={muda('motivo_perda')} /></Campo>}
            <div className="sm:col-span-2"><Campo titulo="Observação"><textarea className={`${entrada} min-h-[80px]`} value={form.observacao} onChange={muda('observacao')} /></Campo></div>
        </div>
    );
}

function Detalhe({ leadId, onFechar, onMudou }: { leadId: number; onFechar: () => void; onMudou: () => void }) {
    const [lead, setLead] = useState<Lead | null>(null);
    const [form, setForm] = useState<Formulario | null>(null);
    const [historico, setHistorico] = useState<Historico[]>([]);
    const [jornada, setJornada] = useState<PassoJornada[]>([]);
    const [nota, setNota] = useState('');
    const [salvando, setSalvando] = useState(false);

    const carregar = useCallback(async () => {
        try {
            const r = await apiClient.get(`/saas/crm/leads/${leadId}`);
            setLead(r.data.data);
            setForm(deLead(r.data.data));
            setHistorico(r.data.historico ?? []);
            setJornada(r.data.jornada ?? []);
        } catch {
            showToast.error('Não foi possível abrir o lead.');
        }
    }, [leadId]);

    useEffect(() => { void carregar(); }, [carregar]);
    useEffect(() => {
        const aoTeclar = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar(); };
        document.addEventListener('keydown', aoTeclar);
        return () => document.removeEventListener('keydown', aoTeclar);
    }, [onFechar]);

    const salvar = async (extra: Partial<Record<string, string>> = {}) => {
        if (!form) return;
        setSalvando(true);
        try {
            await apiClient.patch(`/saas/crm/leads/${leadId}`, { ...form, ...extra });
            showToast.success('Lead atualizado.');
            await carregar();
            onMudou();
        } catch {
            showToast.error('Não foi possível salvar o lead.');
        } finally {
            setSalvando(false);
        }
    };

    const anotar = async (tipo: 'nota' | 'contato') => {
        if (!nota.trim()) return;
        try {
            await apiClient.post(`/saas/crm/leads/${leadId}/historico`, { tipo, texto: nota.trim() });
            setNota('');
            await carregar();
        } catch {
            showToast.error('Não foi possível registrar a anotação.');
        }
    };

    const iconeHistorico = (tipo: Historico['tipo']) => (tipo === 'contato' ? <Phone className="h-4 w-4" /> : tipo === 'etapa' ? <Workflow className="h-4 w-4" /> : tipo === 'nota' ? <StickyNote className="h-4 w-4" /> : <FileText className="h-4 w-4" />);
    const origem = (o: Record<string, string> | null) => (o ? ['utm_source', 'utm_campaign', 'referrer', 'entrada'].filter(k => o[k]).map(k => `${k}: ${o[k]}`).join(' · ') : '');
    const whats = lead ? linkWhats(lead.whatsapp) : null;

    return (
        <div className="fixed inset-0 z-[200] flex justify-end bg-black/50" onClick={onFechar}>
            <aside className="flex h-dvh w-full max-w-xl flex-col bg-white dark:bg-gray-900" onClick={e => e.stopPropagation()} role="dialog" aria-label="Detalhe do lead">
                <div className="flex items-center justify-between gap-3 border-b border-gray-200 p-4 dark:border-gray-700" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
                    <div className="min-w-0">
                        <p className="truncate text-lg font-bold text-gray-900 dark:text-white">{lead?.nome_loja || lead?.nome || 'Lead'}</p>
                        <p className="truncate text-sm text-gray-500 dark:text-gray-400">{lead?.nome}{lead?.data_cadastro ? ` · desde ${ddmm(lead.data_cadastro)}` : ''}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        {whats && <a href={whats} target="_blank" rel="noreferrer" className="rounded-xl bg-emerald-500 p-2.5 text-white" aria-label="Abrir WhatsApp"><MessageCircle className="h-5 w-5" /></a>}
                        <button type="button" onClick={onFechar} className="rounded-xl p-2.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="Fechar"><X className="h-5 w-5" /></button>
                    </div>
                </div>

                {!lead || !form ? <p className="p-6 text-sm text-gray-500">Carregando...</p> : (
                    <div className="flex-1 space-y-6 overflow-y-auto overscroll-contain p-4" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
                        <Campo titulo="Etapa">
                            <select className={entrada} value={lead.etapa} onChange={e => void salvar({ etapa: e.target.value })}>
                                {ETAPAS.map(et => <option key={et} value={et}>{ROTULOS_ETAPA[et]}</option>)}
                            </select>
                        </Campo>

                        <CamposLead form={form} setForm={setForm} etapa={lead.etapa} />
                        <button type="button" disabled={salvando} onClick={() => void salvar()} className="w-full rounded-xl bg-blue-600 py-3 font-bold text-white disabled:opacity-60">
                            {salvando ? 'Salvando...' : 'Salvar'}
                        </button>

                        <section className="rounded-2xl border border-gray-200 p-4 dark:border-gray-700">
                            <p className="mb-2 text-sm font-bold text-gray-900 dark:text-white">Origem</p>
                            {lead.origem_primeira || lead.origem_ultima ? (
                                <div className="space-y-1 text-sm text-gray-600 dark:text-gray-300 break-words">
                                    {lead.origem_primeira && <p><strong>Primeira:</strong> {origem(lead.origem_primeira)}</p>}
                                    {lead.origem_ultima && <p><strong>Última:</strong> {origem(lead.origem_ultima)}</p>}
                                </div>
                            ) : <p className="text-sm text-gray-500 dark:text-gray-400">Sem rastreio (não aceitou cookies ou veio por fora do site). Origem: {origemDoLead(lead) || '—'}.</p>}
                        </section>

                        <section>
                            <p className="mb-2 text-sm font-bold text-gray-900 dark:text-white">Anotar</p>
                            <textarea className={`${entrada} min-h-[70px]`} value={nota} onChange={e => setNota(e.target.value)} placeholder="Ex.: visitei a loja, pediu para voltar sexta" />
                            <div className="mt-2 flex gap-2">
                                <button type="button" onClick={() => void anotar('nota')} className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-bold text-gray-700 dark:border-gray-700 dark:text-gray-200">Anotar</button>
                                <button type="button" onClick={() => void anotar('contato')} className="flex-1 rounded-xl bg-gray-900 py-2.5 text-sm font-bold text-white dark:bg-white dark:text-gray-900">Registrar contato</button>
                            </div>
                        </section>

                        <section>
                            <p className="mb-2 text-sm font-bold text-gray-900 dark:text-white">Histórico</p>
                            {historico.length === 0 ? <p className="text-sm text-gray-500 dark:text-gray-400">Sem histórico.</p> : (
                                <ul className="space-y-2">
                                    {historico.map(h => (
                                        <li key={h.id} className="flex gap-3 rounded-xl bg-gray-50 p-3 text-sm dark:bg-gray-800">
                                            <span className="mt-0.5 shrink-0 text-gray-400">{iconeHistorico(h.tipo)}</span>
                                            <div className="min-w-0">
                                                <p className="text-gray-900 dark:text-white break-words">{h.texto}</p>
                                                <p className="text-xs text-gray-500 dark:text-gray-400">{ddmmHHmm(h.criado_em)}{h.autor ? ` · ${h.autor}` : ''}</p>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>

                        <section>
                            <p className="mb-2 text-sm font-bold text-gray-900 dark:text-white">Jornada no site</p>
                            {jornada.length === 0 ? <p className="text-sm text-gray-500 dark:text-gray-400">Sem jornada registrada.</p> : (
                                <ol className="relative space-y-2 border-l-2 border-gray-200 pl-4 dark:border-gray-700">
                                    {jornada.map((p, i) => (
                                        <li key={i} className="text-sm">
                                            <p className="flex items-center gap-1.5 text-gray-900 dark:text-white">
                                                {p.tipo === 'pagina'
                                                    ? <><FileText className="h-3.5 w-3.5 shrink-0 text-blue-500" /> <span className="break-all">{p.rota}</span></>
                                                    : <><MousePointerClick className="h-3.5 w-3.5 shrink-0 text-amber-500" /> {ROTULOS_EVENTO[p.evento] ?? p.evento}{p.rotulo ? ` (${p.rotulo})` : ''}</>}
                                            </p>
                                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                                {ddmmHHmm(p.em)}
                                                {p.tipo === 'pagina' && ` · ${formatarDuracao(p.duracao_seg)}${p.rolagem_pct != null ? ` · rolou ${p.rolagem_pct}%` : ''}${p.origem ? ` · ${p.origem}` : ''}`}
                                            </p>
                                        </li>
                                    ))}
                                </ol>
                            )}
                        </section>
                    </div>
                )}
            </aside>
        </div>
    );
}

function NovoLead({ onFechar, onCriou }: { onFechar: () => void; onCriou: () => void }) {
    const [form, setForm] = useState<Formulario>({ ...deLead({} as Lead), cidade: 'Guarulhos' });
    const [etapa, setEtapa] = useState<Etapa>('novo');
    const [salvando, setSalvando] = useState(false);

    const salvar = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.nome.trim() && !form.nome_loja.trim()) {
            showToast.error('Informe o nome da loja ou do contato.');
            return;
        }
        setSalvando(true);
        try {
            await apiClient.post('/saas/crm/leads', { ...form, etapa });
            showToast.success('Lead cadastrado.');
            onCriou();
        } catch {
            showToast.error('Não foi possível cadastrar o lead.');
        } finally {
            setSalvando(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={onFechar}>
            <form onSubmit={salvar} onClick={e => e.stopPropagation()} className="flex max-h-[92dvh] w-full max-w-2xl flex-col rounded-t-3xl bg-white dark:bg-gray-900 sm:rounded-3xl">
                <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
                    <p className="text-lg font-bold text-gray-900 dark:text-white">Novo lead (porta a porta)</p>
                    <button type="button" onClick={onFechar} className="rounded-xl p-2 text-gray-500" aria-label="Fechar"><X className="h-5 w-5" /></button>
                </div>
                <div className="space-y-3 overflow-y-auto overscroll-contain p-4">
                    <Campo titulo="Etapa">
                        <select className={entrada} value={etapa} onChange={e => setEtapa(e.target.value as Etapa)}>
                            {ETAPAS.map(et => <option key={et} value={et}>{ROTULOS_ETAPA[et]}</option>)}
                        </select>
                    </Campo>
                    <CamposLead form={form} setForm={setForm} etapa={etapa} />
                </div>
                <div className="border-t border-gray-200 p-4 dark:border-gray-700" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
                    <button type="submit" disabled={salvando} className="w-full rounded-xl bg-blue-600 py-3 font-bold text-white disabled:opacity-60">{salvando ? 'Salvando...' : 'Cadastrar lead'}</button>
                </div>
            </form>
        </div>
    );
}

export default function CrmLeadsPanel(): React.ReactElement {
    const [dados, setDados] = useState<ListaResposta | null>(null);
    const [busca, setBusca] = useState('');
    const [carregando, setCarregando] = useState(true);
    const [aberto, setAberto] = useState<number | null>(null);
    const [novo, setNovo] = useState(false);

    const carregar = useCallback(async (termo: string) => {
        setCarregando(true);
        try {
            const r = await apiClient.get(`/saas/crm/leads${termo ? `?busca=${encodeURIComponent(termo)}` : ''}`);
            setDados(r.data as ListaResposta);
        } catch {
            showToast.error('Não foi possível carregar os leads.');
        } finally {
            setCarregando(false);
        }
    }, []);

    useEffect(() => {
        const t = setTimeout(() => { void carregar(busca.trim()); }, 400);
        return () => clearTimeout(t);
    }, [busca, carregar]);

    const mudarEtapa = async (id: number, etapa: Etapa) => {
        try {
            await apiClient.patch(`/saas/crm/leads/${id}`, { etapa });
            await carregar(busca.trim());
        } catch {
            showToast.error('Não foi possível mudar a etapa.');
        }
    };

    const leads = dados?.data ?? [];
    const hoje = hojeISO();

    return (
        <div className="w-full max-w-full space-y-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                    <h1 className="text-xl font-bold text-gray-900 dark:text-white sm:text-2xl">CRM de leads</h1>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Do site, do cadastro de teste e do porta a porta.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {(dados?.contatos_hoje ?? 0) > 0 && (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-3 py-1.5 text-xs font-bold text-red-700 dark:bg-red-900/30 dark:text-red-300">
                            <CalendarClock className="h-4 w-4" /> {dados?.contatos_hoje} contato(s) para hoje
                        </span>
                    )}
                    <button type="button" onClick={() => setNovo(true)} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white">
                        <Plus className="h-4 w-4" /> Novo lead (porta a porta)
                    </button>
                </div>
            </div>

            <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input className={`${entrada} pl-9`} placeholder="Buscar por loja, contato, WhatsApp, bairro..." value={busca} onChange={e => setBusca(e.target.value)} />
            </div>

            <div className="-mx-4 overflow-x-auto px-4 pb-2 snap-x snap-mandatory sm:mx-0 sm:px-0">
                <div className="flex gap-3">
                    {ETAPAS.map(etapa => {
                        const daEtapa = leads.filter(l => l.etapa === etapa);
                        return (
                            <div key={etapa} className="w-[280px] shrink-0 snap-start rounded-2xl bg-gray-100 p-3 dark:bg-gray-800/60">
                                <p className="mb-3 flex items-center justify-between text-sm font-bold text-gray-700 dark:text-gray-200">
                                    {ROTULOS_ETAPA[etapa]} <span className="rounded-full bg-white px-2 py-0.5 text-xs dark:bg-gray-900">{dados?.por_etapa?.[etapa] ?? 0}</span>
                                </p>
                                <div className="space-y-2">
                                    {carregando && !dados ? <p className="text-xs text-gray-500">Carregando...</p> : daEtapa.length === 0 ? <p className="text-xs text-gray-400">Nenhum lead.</p> : daEtapa.map(l => {
                                        const whats = linkWhats(l.whatsapp);
                                        const atrasado = l.proximo_contato && l.proximo_contato <= hoje && !['cliente', 'perdido'].includes(l.etapa);
                                        return (
                                            <div key={l.id} role="button" tabIndex={0} onClick={() => setAberto(l.id)} onKeyDown={e => { if (e.key === 'Enter') setAberto(l.id); }}
                                                className="cursor-pointer rounded-xl border border-gray-200 bg-white p-3 text-sm shadow-sm hover:border-blue-400 dark:border-gray-700 dark:bg-gray-800">
                                                <div className="flex items-start justify-between gap-2">
                                                    <div className="min-w-0">
                                                        <p className="truncate font-bold text-gray-900 dark:text-white">{l.nome_loja || l.nome}</p>
                                                        {l.nome_loja && <p className="truncate text-xs text-gray-500 dark:text-gray-400">{l.nome}</p>}
                                                    </div>
                                                    {whats && (
                                                        <a href={whats} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="shrink-0 rounded-lg bg-emerald-500 p-1.5 text-white" aria-label="WhatsApp">
                                                            <MessageSquareText className="h-4 w-4" />
                                                        </a>
                                                    )}
                                                </div>
                                                <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">{[l.segmento, l.bairro || l.cidade].filter(Boolean).join(' · ') || '—'}</p>
                                                <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-gray-500 dark:text-gray-400">
                                                    <span className="truncate">{origemDoLead(l) || '—'} · {ddmm(l.data_cadastro)}</span>
                                                    {l.proximo_contato && <span className={atrasado ? 'font-bold text-red-600' : ''}>{ddmm(l.proximo_contato)}</span>}
                                                </div>
                                                <select value={l.etapa} onClick={e => e.stopPropagation()} onChange={e => void mudarEtapa(l.id, e.target.value as Etapa)}
                                                    className="mt-2 w-full rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200" aria-label="Mudar etapa">
                                                    {ETAPAS.map(et => <option key={et} value={et}>{ROTULOS_ETAPA[et]}</option>)}
                                                </select>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {aberto !== null && <Detalhe leadId={aberto} onFechar={() => setAberto(null)} onMudou={() => void carregar(busca.trim())} />}
            {novo && <NovoLead onFechar={() => setNovo(false)} onCriou={() => { setNovo(false); void carregar(busca.trim()); }} />}
        </div>
    );
}
