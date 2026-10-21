import React, { useCallback, useEffect, useState } from 'react';
import ResponsiveModal from '../../components/ui/ResponsiveModal';
import { Button } from '../../components/ui/button';
import { formatCurrency } from '../../utils/formatters';
import { showToast } from '../../utils/toast';
import { Campanha, crmApi, erroApi, PreviaCampanha } from './crmApi';
import { Kpi, Rotulo, Selo, Vazio } from './crmUi';
import { campo, dataHora } from './crmFormat';

const CampanhasTab: React.FC<{ responsaveis: { id: number; nome: string }[] }> = ({ responsaveis }) => {
    const [lista, setLista] = useState<Campanha[]>([]);
    const [nova, setNova] = useState(false);
    const [aberta, setAberta] = useState<number | null>(null);
    const carregar = useCallback(() => { crmApi.campanhas().then(setLista).catch(e => showToast.error(erroApi(e))); }, []);
    useEffect(() => { carregar(); }, [carregar]);
    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
                <p className="max-w-2xl text-sm text-muted-foreground">
                    A campanha só alcança quem autorizou contato no canal (LGPD). Ao iniciar, o público fica congelado; quem revogar depois é bloqueado no envio.
                </p>
                <Button onClick={() => setNova(true)}>Nova campanha</Button>
            </div>
            {lista.length === 0 ? <Vazio texto="Nenhuma campanha ainda." /> : (
                <ul className="divide-y rounded-lg border bg-card">
                    {lista.map(c => (
                        <li key={c.id}>
                            <button className="flex w-full items-center gap-3 p-3 text-left hover:bg-muted/40" onClick={() => setAberta(c.id)}>
                                <Selo tom={c.status === 'ativa' ? 'verde' : c.status === 'rascunho' ? 'amarelo' : 'cinza'}>{c.status}</Selo>
                                <span className="flex-1 truncate text-sm font-medium">{c.nome}</span>
                                <span className="text-xs text-muted-foreground">{c.canal} · {dataHora(c.created_at)}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {nova && <NovaCampanha responsaveis={responsaveis} onFechar={() => setNova(false)} onSalvo={id => { setNova(false); carregar(); setAberta(id); }} />}
            {aberta && <DetalheCampanha id={aberta} onFechar={() => { setAberta(null); carregar(); }} />}
        </div>
    );
};

const NovaCampanha: React.FC<{ responsaveis: { id: number; nome: string }[]; onFechar: () => void; onSalvo: (id: number) => void }> =
    ({ responsaveis, onFechar, onSalvo }) => {
        const [f, setF] = useState({ nome: '', canal: 'whatsapp', mensagem: 'Olá {nome}! ', janela_conversao_dias: '7' });
        const [filtros, setFiltros] = useState<Record<string, string | boolean>>({ excluir_inadimplentes: true });
        const [previa, setPrevia] = useState<PreviaCampanha | null>(null);
        const filtrosLimpos = () => Object.fromEntries(Object.entries(filtros).filter(([, v]) => v !== '' && v !== false));
        const verPrevia = async () => {
            try { setPrevia(await crmApi.previa(f.canal, filtrosLimpos())); } catch (e) { showToast.error(erroApi(e)); }
        };
        const salvar = async () => {
            try {
                const c = await crmApi.criarCampanha({ ...f, janela_conversao_dias: Number(f.janela_conversao_dias), filtros: filtrosLimpos() });
                showToast.create('Rascunho salvo');
                onSalvo(c.id);
            } catch (e) { showToast.error(erroApi(e)); }
        };
        const filtro = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setFiltros({ ...filtros, [k]: e.target.value });
        return (
            <ResponsiveModal isOpen onClose={onFechar} title="Nova campanha" size="xl" footer={<Button onClick={salvar}>Salvar rascunho</Button>}>
                <div className="grid gap-4 lg:grid-cols-2">
                    <div className="space-y-3">
                        <Rotulo texto="Nome"><input className={campo} value={f.nome} onChange={e => setF({ ...f, nome: e.target.value })} /></Rotulo>
                        <div className="grid grid-cols-2 gap-3">
                            <Rotulo texto="Canal"><select className={campo} value={f.canal} onChange={e => { setF({ ...f, canal: e.target.value }); setPrevia(null); }}>
                                {['whatsapp', 'email', 'sms'].map(c => <option key={c}>{c}</option>)}</select></Rotulo>
                            <Rotulo texto="Janela de conversão (dias)" dica="Venda do cliente até N dias após o envio conta como resultado.">
                                <input className={campo} type="number" min={1} max={90} value={f.janela_conversao_dias}
                                       onChange={e => setF({ ...f, janela_conversao_dias: e.target.value })} /></Rotulo>
                        </div>
                        <Rotulo texto="Mensagem" dica="Use {nome} para o primeiro nome do contato e {empresa} para o nome do cliente.">
                            <textarea className={campo} rows={5} value={f.mensagem} onChange={e => setF({ ...f, mensagem: e.target.value })} /></Rotulo>
                    </div>
                    <div className="space-y-3">
                        <h4 className="text-sm font-semibold">Público</h4>
                        <div className="grid grid-cols-2 gap-3">
                            <Rotulo texto="Vendedor"><select className={campo} value={String(filtros.vendedor_id || '')} onChange={filtro('vendedor_id')}>
                                <option value="">Todos</option>{responsaveis.map(r => <option key={r.id} value={r.id}>{r.nome}</option>)}</select></Rotulo>
                            <Rotulo texto="Tipo"><select className={campo} value={String(filtros.tipo_pessoa || '')} onChange={filtro('tipo_pessoa')}>
                                <option value="">PF e PJ</option><option value="PJ">Só PJ</option><option value="PF">Só PF</option></select></Rotulo>
                            <Rotulo texto="Sem comprar há (dias)"><input className={campo} type="number" value={String(filtros.sem_compra_dias || '')} onChange={filtro('sem_compra_dias')} /></Rotulo>
                            <Rotulo texto="Comprou nos últimos (dias)"><input className={campo} type="number" value={String(filtros.comprou_ultimos_dias || '')} onChange={filtro('comprou_ultimos_dias')} /></Rotulo>
                            <Rotulo texto="Cidade"><input className={campo} value={String(filtros.cidade || '')} onChange={filtro('cidade')} /></Rotulo>
                            <Rotulo texto="Gasto total mínimo (R$)"><input className={campo} type="number" value={String(filtros.valor_minimo_gasto || '')} onChange={filtro('valor_minimo_gasto')} /></Rotulo>
                        </div>
                        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!filtros.excluir_inadimplentes}
                                                                                 onChange={e => setFiltros({ ...filtros, excluir_inadimplentes: e.target.checked })} />
                            Excluir clientes com título vencido</label>
                        <Button variant="outline" onClick={verPrevia}>Ver público</Button>
                        {previa && (
                            <div className="rounded-md border p-3 text-sm">
                                <p><b>{previa.aptos}</b> apto(s) de {previa.publico_filtrado} filtrado(s)</p>
                                <p className="text-xs text-muted-foreground">{previa.sem_consentimento} sem autorização no canal · {previa.sem_destino} sem contato válido</p>
                                <ul className="mt-2 max-h-32 overflow-auto text-xs">{previa.amostra.map(a => <li key={a.cliente_id}>{a.nome} · {a.destino}</li>)}</ul>
                            </div>
                        )}
                    </div>
                </div>
            </ResponsiveModal>
        );
    };

const DetalheCampanha: React.FC<{ id: number; onFechar: () => void }> = ({ id, onFechar }) => {
    const [c, setC] = useState<Campanha | null>(null);
    const carregar = useCallback(() => { crmApi.campanha(id).then(setC).catch(e => showToast.error(erroApi(e))); }, [id]);
    useEffect(() => { carregar(); }, [carregar]);
    if (!c) return null;
    const acao = async (fn: () => Promise<unknown>, ok: string) => {
        try { await fn(); showToast.success(ok); carregar(); } catch (e) { showToast.error(erroApi(e)); carregar(); }
    };
    const r = c.resultado;
    return (
        <ResponsiveModal isOpen onClose={onFechar} title={c.nome} subtitle={`${c.canal} · ${c.status}`} size="full"
                         footer={c.status === 'rascunho' ? <Button onClick={() => acao(() => crmApi.iniciarCampanha(id), 'Campanha iniciada')}>Iniciar (congelar público)</Button>
                             : c.status === 'ativa' ? <Button variant="outline" onClick={() => acao(() => crmApi.encerrarCampanha(id), 'Encerrada')}>Encerrar</Button> : undefined}>
            <div className="space-y-4">
                <p className="whitespace-pre-line rounded-md bg-muted p-3 text-sm">{c.mensagem}</p>
                {r && (
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                        <Kpi titulo="Público" valor={r.publico} />
                        <Kpi titulo="Enviados" valor={r.enviados} />
                        <Kpi titulo="Responderam" valor={r.respondidos} />
                        <Kpi titulo="Compraram" valor={r.convertidos} detalhe={r.taxa_conversao !== null ? `${r.taxa_conversao}% dos enviados` : undefined} />
                        <Kpi titulo="Receita atribuída" valor={formatCurrency(r.receita_atribuida)} detalhe={r.criterio} />
                    </div>
                )}
                {c.status !== 'rascunho' && (c.envios || []).length === 0 && <Vazio texto="Sem destinatários." />}
                {(c.envios || []).length > 0 && (
                    <div className="overflow-x-auto rounded-lg border">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr>
                                <th className="p-2">Cliente</th><th className="p-2">Contato</th><th className="p-2">Situação</th><th className="p-2 text-right">Registrar</th></tr></thead>
                            <tbody>
                                {c.envios!.map(e => (
                                    <tr key={e.id} className="border-t">
                                        <td className="p-2">{e.cliente_nome}</td>
                                        <td className="p-2 text-xs">{e.destino}</td>
                                        <td className="p-2"><Selo tom={e.status === 'respondido' ? 'verde' : e.status === 'enviado' ? 'azul' : e.status === 'pendente' ? 'amarelo' : 'cinza'}>{e.status}</Selo>
                                            {e.observacao && <span className="ml-1 text-xs text-muted-foreground">{e.observacao}</span>}</td>
                                        <td className="p-2">
                                            {c.status === 'ativa' && (
                                                <div className="flex flex-wrap justify-end gap-1">
                                                    {e.link && ['pendente', 'falhou'].includes(e.status) && (
                                                        <a className="inline-flex h-8 items-center rounded-md border px-2 text-xs hover:bg-muted" href={e.link} target="_blank" rel="noreferrer">Abrir WhatsApp</a>
                                                    )}
                                                    {['pendente', 'falhou'].includes(e.status) && <Button size="sm" variant="outline" onClick={() => acao(() => crmApi.registrarEnvio(id, e.id, 'enviado'), 'Envio registrado')}>Enviado</Button>}
                                                    {e.status === 'enviado' && <Button size="sm" variant="outline" onClick={() => acao(() => crmApi.registrarEnvio(id, e.id, 'respondido'), 'Resposta registrada')}>Respondeu</Button>}
                                                    {e.status !== 'descadastrado' && <Button size="sm" variant="ghost" onClick={() => acao(() => crmApi.registrarEnvio(id, e.id, 'descadastrado'), 'Descadastrado: consentimento revogado')}>Pediu para sair</Button>}
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </ResponsiveModal>
    );
};

export default CampanhasTab;
