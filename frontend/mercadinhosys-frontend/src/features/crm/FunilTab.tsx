import React, { useCallback, useEffect, useState } from 'react';
import ResponsiveModal from '../../components/ui/ResponsiveModal';
import { Button } from '../../components/ui/button';
import { formatCurrency } from '../../utils/formatters';
import { showToast } from '../../utils/toast';
import { crmApi, erroApi, ETAPA_LABEL, ETAPAS_ABERTAS, Etapa, Funil, Oportunidade } from './crmApi';
import { ClienteBusca, Kpi, Rotulo, Selo } from './crmUi';
import { campo, dataCurta } from './crmFormat';

interface Props { gestor: boolean; responsaveis: { id: number; nome: string }[] }

const FunilTab: React.FC<Props> = ({ gestor, responsaveis }) => {
    const [funil, setFunil] = useState<Funil | null>(null);
    const [ops, setOps] = useState<Oportunidade[]>([]);
    const [responsavel, setResponsavel] = useState('');
    const [nova, setNova] = useState(false);
    const [fechar, setFechar] = useState<{ op: Oportunidade; etapa: 'ganha' | 'perdida' } | null>(null);

    const carregar = useCallback(() => {
        const params: Record<string, string> = responsavel ? { responsavel_id: responsavel } : {};
        Promise.all([crmApi.funil(params), crmApi.oportunidades({ ...params, abertas: '1' })])
            .then(([f, lista]) => { setFunil(f); setOps(lista); })
            .catch(e => showToast.error(erroApi(e, 'Erro ao carregar o funil')));
    }, [responsavel]);
    useEffect(() => { carregar(); }, [carregar]);

    const mover = async (op: Oportunidade, etapa: Etapa) => {
        if (etapa === 'ganha' || etapa === 'perdida') { setFechar({ op, etapa }); return; }
        try { await crmApi.atualizarOportunidade(op.id, { etapa }); carregar(); }
        catch (e) { showToast.error(erroApi(e)); }
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
                {gestor ? (
                    <Rotulo texto="Vendedor">
                        <select className={campo} value={responsavel} onChange={e => setResponsavel(e.target.value)}>
                            <option value="">Toda a equipe</option>
                            {responsaveis.map(r => <option key={r.id} value={r.id}>{r.nome}</option>)}
                        </select>
                    </Rotulo>
                ) : <span />}
                <Button onClick={() => setNova(true)}>Nova oportunidade</Button>
            </div>

            {funil && (
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <Kpi titulo="Pipeline aberto" valor={formatCurrency(funil.pipeline.valor_total)}
                         detalhe={`${funil.pipeline.quantidade} oportunidade(s)`} />
                    <Kpi titulo="Previsão ponderada" valor={formatCurrency(funil.pipeline.valor_ponderado)}
                         detalhe="valor × probabilidade da etapa" />
                    <Kpi titulo="Ganhas no mês" valor={formatCurrency(funil.periodo.valor_ganho)}
                         detalhe={`${funil.periodo.ganhas} ganha(s) · ${funil.periodo.perdidas} perdida(s)` +
                                  (funil.periodo.taxa_conversao !== null ? ` · ${funil.periodo.taxa_conversao}%` : '')} />
                    <Kpi titulo="Follow-ups atrasados" valor={funil.atividades.atrasadas} alerta={funil.atividades.atrasadas > 0}
                         detalhe={`${funil.atividades.hoje} para hoje · ${funil.pipeline.previsao_vencida} previsão vencida`} />
                </div>
            )}

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {ETAPAS_ABERTAS.map(etapa => {
                    const resumo = funil?.pipeline.etapas.find(e => e.etapa === etapa);
                    const daEtapa = ops.filter(o => o.etapa === etapa);
                    return (
                        <section key={etapa} className="rounded-lg border bg-muted/30 p-3">
                            <header className="mb-2 flex items-baseline justify-between">
                                <h3 className="text-sm font-semibold">{ETAPA_LABEL[etapa]}</h3>
                                <span className="text-xs text-muted-foreground tabular-nums">
                                    {resumo?.quantidade || 0} · {formatCurrency(resumo?.valor || 0)}
                                </span>
                            </header>
                            <div className="space-y-2">
                                {daEtapa.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">Nada aqui</p>}
                                {daEtapa.map(op => (
                                    <article key={op.id} className="rounded-md border bg-card p-3 shadow-sm">
                                        <p className="text-sm font-medium leading-tight">{op.titulo}</p>
                                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                            {op.cliente_nome || `Lead: ${op.lead_nome}`}{gestor && op.responsavel_nome ? ` · ${op.responsavel_nome}` : ''}
                                        </p>
                                        <div className="mt-2 flex items-center justify-between text-xs">
                                            <span className="font-semibold tabular-nums">{formatCurrency(op.valor_estimado)}</span>
                                            <Selo tom="azul">{op.probabilidade}%</Selo>
                                        </div>
                                        {op.data_prevista_fechamento && (
                                            <p className="mt-1 text-[11px] text-muted-foreground">Fecha em {dataCurta(op.data_prevista_fechamento)}</p>
                                        )}
                                        <select className={`${campo} mt-2 py-1 text-xs`} value={op.etapa}
                                                aria-label="Mover etapa" onChange={e => mover(op, e.target.value as Etapa)}>
                                            {(Object.keys(ETAPA_LABEL) as Etapa[]).map(e => <option key={e} value={e}>{ETAPA_LABEL[e]}</option>)}
                                        </select>
                                    </article>
                                ))}
                            </div>
                        </section>
                    );
                })}
            </div>

            {funil && funil.periodo.motivos_perda.length > 0 && (
                <div className="rounded-lg border bg-card p-4">
                    <h3 className="mb-2 text-sm font-semibold">Por que perdemos neste mês</h3>
                    <ul className="space-y-1 text-sm">
                        {funil.periodo.motivos_perda.map(m => (
                            <li key={m.motivo} className="flex justify-between"><span>{m.motivo}</span><span className="tabular-nums">{m.quantidade}</span></li>
                        ))}
                    </ul>
                </div>
            )}

            {nova && <NovaOportunidade onFechar={() => setNova(false)} onSalvo={() => { setNova(false); carregar(); }} />}
            {fechar && <FecharOportunidade {...fechar} onFechar={() => setFechar(null)} onSalvo={() => { setFechar(null); carregar(); }} />}
        </div>
    );
};

const NovaOportunidade: React.FC<{ onFechar: () => void; onSalvo: () => void }> = ({ onFechar, onSalvo }) => {
    const [cliente, setCliente] = useState<{ id: number; nome: string } | null>(null);
    const [form, setForm] = useState({ titulo: '', valor_estimado: '', etapa: 'prospeccao', data_prevista_fechamento: '' });
    const [salvando, setSalvando] = useState(false);
    const salvar = async () => {
        if (!cliente) { showToast.error('Escolha o cliente (para lead, crie a oportunidade na aba Leads)'); return; }
        setSalvando(true);
        try {
            await crmApi.criarOportunidade({ ...form, cliente_id: cliente.id, valor_estimado: Number(form.valor_estimado || 0) });
            showToast.create('Oportunidade criada');
            onSalvo();
        } catch (e) { showToast.error(erroApi(e)); } finally { setSalvando(false); }
    };
    return (
        <ResponsiveModal isOpen onClose={onFechar} title="Nova oportunidade" size="md"
                         footer={<Button disabled={salvando} onClick={salvar}>Salvar</Button>}>
            <div className="space-y-3">
                <Rotulo texto="Cliente"><ClienteBusca valor={cliente} onChange={setCliente} /></Rotulo>
                <Rotulo texto="Título"><input className={campo} value={form.titulo} onChange={e => setForm({ ...form, titulo: e.target.value })}
                                              placeholder="Ex.: Mix de bebidas para o verão" /></Rotulo>
                <div className="grid grid-cols-2 gap-3">
                    <Rotulo texto="Valor estimado (R$)"><input className={campo} type="number" min="0" step="0.01" value={form.valor_estimado}
                                                              onChange={e => setForm({ ...form, valor_estimado: e.target.value })} /></Rotulo>
                    <Rotulo texto="Etapa">
                        <select className={campo} value={form.etapa} onChange={e => setForm({ ...form, etapa: e.target.value })}>
                            {ETAPAS_ABERTAS.map(e => <option key={e} value={e}>{ETAPA_LABEL[e]}</option>)}
                        </select>
                    </Rotulo>
                </div>
                <Rotulo texto="Previsão de fechamento"><input className={campo} type="date" value={form.data_prevista_fechamento}
                                                            onChange={e => setForm({ ...form, data_prevista_fechamento: e.target.value })} /></Rotulo>
            </div>
        </ResponsiveModal>
    );
};

const FecharOportunidade: React.FC<{ op: Oportunidade; etapa: 'ganha' | 'perdida'; onFechar: () => void; onSalvo: () => void }> =
    ({ op, etapa, onFechar, onSalvo }) => {
        const [pedido, setPedido] = useState('');
        const [valor, setValor] = useState(String(op.valor_estimado || ''));
        const [motivo, setMotivo] = useState('');
        const [concorrente, setConcorrente] = useState('');
        const salvar = async () => {
            const corpo: Record<string, unknown> = { etapa };
            if (etapa === 'ganha') {
                if (pedido) corpo.pedido_venda_id = Number(pedido); else corpo.valor_ganho = Number(valor || 0);
            } else { corpo.motivo_perda = motivo; corpo.concorrente = concorrente; }
            try { await crmApi.atualizarOportunidade(op.id, corpo); showToast.update(etapa === 'ganha' ? 'Negócio ganho' : 'Perda registrada'); onSalvo(); }
            catch (e) { showToast.error(erroApi(e)); }
        };
        return (
            <ResponsiveModal isOpen onClose={onFechar} size="md" title={etapa === 'ganha' ? 'Registrar ganho' : 'Registrar perda'}
                             headerColor={etapa === 'ganha' ? 'green' : 'red'} footer={<Button onClick={salvar}>Confirmar</Button>}>
                <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">{op.titulo} — {op.cliente_nome || op.lead_nome}</p>
                    {etapa === 'ganha' ? (
                        <>
                            <Rotulo texto="Nº do pedido B2B (opcional)" dica="Com o pedido, o valor ganho é o total do pedido.">
                                <input className={campo} type="number" value={pedido} onChange={e => setPedido(e.target.value)} />
                            </Rotulo>
                            {!pedido && <Rotulo texto="Valor ganho (R$)"><input className={campo} type="number" step="0.01" value={valor}
                                                                               onChange={e => setValor(e.target.value)} /></Rotulo>}
                        </>
                    ) : (
                        <>
                            <Rotulo texto="Motivo da perda">
                                <input className={campo} list="motivos-perda" value={motivo} onChange={e => setMotivo(e.target.value)} />
                                <datalist id="motivos-perda">
                                    {['Preço', 'Prazo de pagamento', 'Prazo de entrega', 'Sem estoque', 'Cliente desistiu', 'Concorrente'].map(m => <option key={m} value={m} />)}
                                </datalist>
                            </Rotulo>
                            <Rotulo texto="Concorrente (opcional)"><input className={campo} value={concorrente} onChange={e => setConcorrente(e.target.value)} /></Rotulo>
                        </>
                    )}
                </div>
            </ResponsiveModal>
        );
    };

export default FunilTab;
