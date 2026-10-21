import React, { useCallback, useEffect, useState } from 'react';
import ResponsiveModal from '../../components/ui/ResponsiveModal';
import { Button } from '../../components/ui/button';
import { showToast } from '../../utils/toast';
import { Atividade, crmApi, erroApi, Funil } from './crmApi';
import { ClienteBusca, Kpi, Rotulo, Selo, Vazio } from './crmUi';
import { campo, dataHora } from './crmFormat';

const TIPOS = ['ligacao', 'visita', 'whatsapp', 'email', 'reuniao', 'tarefa'];
const SITUACOES = [{ k: 'atrasadas', t: 'Atrasadas' }, { k: 'hoje', t: 'Hoje' }, { k: 'abertas', t: 'Todas abertas' }, { k: 'concluidas', t: 'Concluídas' }];

const AtividadesTab: React.FC<{ gestor: boolean }> = ({ gestor }) => {
    const [situacao, setSituacao] = useState('abertas');
    const [itens, setItens] = useState<Atividade[]>([]);
    const [resumo, setResumo] = useState<Funil['atividades'] | null>(null);
    const [nova, setNova] = useState(false);
    const [concluir, setConcluir] = useState<Atividade | null>(null);

    const carregar = useCallback(() => {
        crmApi.atividades({ situacao }).then(r => { setItens(r.itens); setResumo(r.resumo); })
            .catch(e => showToast.error(erroApi(e, 'Erro ao carregar a agenda')));
    }, [situacao]);
    useEffect(() => { carregar(); }, [carregar]);

    return (
        <div className="space-y-4">
            {resumo && (
                <div className="grid grid-cols-3 gap-3">
                    <Kpi titulo="Atrasadas" valor={resumo.atrasadas} alerta={resumo.atrasadas > 0} />
                    <Kpi titulo="Para hoje" valor={resumo.hoje} />
                    <Kpi titulo="Abertas" valor={resumo.abertas} />
                </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
                {SITUACOES.map(s => (
                    <Button key={s.k} size="sm" variant={situacao === s.k ? 'default' : 'outline'} onClick={() => setSituacao(s.k)}>{s.t}</Button>
                ))}
                <div className="ml-auto"><Button onClick={() => setNova(true)}>Agendar</Button></div>
            </div>
            {itens.length === 0 ? <Vazio texto="Nada na agenda com este filtro." /> : (
                <ul className="divide-y rounded-lg border bg-card">
                    {itens.map(a => (
                        <li key={a.id} className="flex flex-wrap items-center gap-3 p-3">
                            <Selo tom={a.concluida_em ? 'verde' : a.atrasada ? 'vermelho' : 'azul'}>{a.tipo}</Selo>
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium">{a.assunto}</p>
                                <p className="text-xs text-muted-foreground">
                                    {a.concluida_em ? `Concluída ${dataHora(a.concluida_em)} · ${a.resultado}` : `Vence ${dataHora(a.vencimento)}`}
                                    {gestor && a.responsavel_nome ? ` · ${a.responsavel_nome}` : ''}
                                    {a.chamado_id ? ' · chamado' : a.oportunidade_id ? ' · oportunidade' : a.lead_id && !a.cliente_id ? ' · lead' : ''}
                                </p>
                            </div>
                            {!a.concluida_em && <Button size="sm" variant="outline" onClick={() => setConcluir(a)}>Concluir</Button>}
                        </li>
                    ))}
                </ul>
            )}
            {nova && <NovaAtividade onFechar={() => setNova(false)} onSalvo={() => { setNova(false); carregar(); }} />}
            {concluir && <ConcluirAtividade atividade={concluir} onFechar={() => setConcluir(null)} onSalvo={() => { setConcluir(null); carregar(); }} />}
        </div>
    );
};

const NovaAtividade: React.FC<{ onFechar: () => void; onSalvo: () => void }> = ({ onFechar, onSalvo }) => {
    const [cliente, setCliente] = useState<{ id: number; nome: string } | null>(null);
    const [f, setF] = useState({ tipo: 'ligacao', assunto: '', vencimento: '', descricao: '' });
    const salvar = async () => {
        if (!cliente) { showToast.error('Escolha o cliente'); return; }
        try { await crmApi.criarAtividade({ ...f, cliente_id: cliente.id }); showToast.create('Agendado'); onSalvo(); }
        catch (e) { showToast.error(erroApi(e)); }
    };
    return (
        <ResponsiveModal isOpen onClose={onFechar} title="Agendar atividade" size="md" footer={<Button onClick={salvar}>Salvar</Button>}>
            <div className="space-y-3">
                <Rotulo texto="Cliente"><ClienteBusca valor={cliente} onChange={setCliente} /></Rotulo>
                <div className="grid grid-cols-2 gap-3">
                    <Rotulo texto="Tipo"><select className={campo} value={f.tipo} onChange={e => setF({ ...f, tipo: e.target.value })}>
                        {TIPOS.map(t => <option key={t}>{t}</option>)}</select></Rotulo>
                    <Rotulo texto="Quando"><input className={campo} type="datetime-local" value={f.vencimento}
                                                  onChange={e => setF({ ...f, vencimento: e.target.value })} /></Rotulo>
                </div>
                <Rotulo texto="Assunto"><input className={campo} value={f.assunto} onChange={e => setF({ ...f, assunto: e.target.value })} /></Rotulo>
                <Rotulo texto="Detalhes"><textarea className={campo} rows={3} value={f.descricao} onChange={e => setF({ ...f, descricao: e.target.value })} /></Rotulo>
            </div>
        </ResponsiveModal>
    );
};

export const ConcluirAtividade: React.FC<{ atividade: Atividade; onFechar: () => void; onSalvo: () => void }> = ({ atividade, onFechar, onSalvo }) => {
    const [resultado, setResultado] = useState('');
    const [seguir, setSeguir] = useState(false);
    const [prox, setProx] = useState({ tipo: 'ligacao', assunto: '', vencimento: '' });
    const salvar = async () => {
        try {
            await crmApi.concluirAtividade(atividade.id, { resultado, ...(seguir ? { proxima: prox } : {}) });
            showToast.success(seguir ? 'Concluída e próximo passo agendado' : 'Concluída');
            onSalvo();
        } catch (e) { showToast.error(erroApi(e)); }
    };
    return (
        <ResponsiveModal isOpen onClose={onFechar} title="Concluir atividade" subtitle={atividade.assunto} size="md"
                         footer={<Button onClick={salvar}>Concluir</Button>}>
            <div className="space-y-3">
                <Rotulo texto="Resultado"><input className={campo} value={resultado} onChange={e => setResultado(e.target.value)}
                                                 placeholder="Ex.: pediu proposta até sexta" /></Rotulo>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={seguir} onChange={e => setSeguir(e.target.checked)} />
                    Agendar o próximo passo</label>
                {seguir && (
                    <div className="grid gap-3 sm:grid-cols-3">
                        <Rotulo texto="Tipo"><select className={campo} value={prox.tipo} onChange={e => setProx({ ...prox, tipo: e.target.value })}>
                            {TIPOS.map(t => <option key={t}>{t}</option>)}</select></Rotulo>
                        <Rotulo texto="Quando"><input className={campo} type="datetime-local" value={prox.vencimento}
                                                      onChange={e => setProx({ ...prox, vencimento: e.target.value })} /></Rotulo>
                        <Rotulo texto="Assunto"><input className={campo} value={prox.assunto} onChange={e => setProx({ ...prox, assunto: e.target.value })} /></Rotulo>
                    </div>
                )}
            </div>
        </ResponsiveModal>
    );
};

export default AtividadesTab;
