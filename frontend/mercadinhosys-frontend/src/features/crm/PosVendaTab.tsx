import React, { useCallback, useEffect, useState } from 'react';
import ResponsiveModal from '../../components/ui/ResponsiveModal';
import { Button } from '../../components/ui/button';
import { formatCurrency } from '../../utils/formatters';
import { showToast } from '../../utils/toast';
import { Chamado, crmApi, erroApi, ResumoDevolucao } from './crmApi';
import { ClienteBusca, Kpi, Rotulo, Selo, Vazio } from './crmUi';
import { campo, dataHora } from './crmFormat';

const TIPOS = ['reclamacao', 'avaria', 'troca', 'devolucao', 'garantia', 'duvida', 'entrega'];
const STATUS_LABEL: Record<string, string> = {
    aberto: 'Aberto', em_atendimento: 'Em atendimento', aguardando_cliente: 'Aguardando cliente', resolvido: 'Resolvido', fechado: 'Fechado',
};
const PROXIMOS: Record<string, string[]> = {
    aberto: ['em_atendimento', 'aguardando_cliente', 'resolvido'], em_atendimento: ['aguardando_cliente', 'resolvido'],
    aguardando_cliente: ['em_atendimento', 'resolvido'], resolvido: ['fechado', 'em_atendimento'], fechado: [],
};

const PosVendaTab: React.FC<{ podeDevolver: boolean }> = ({ podeDevolver }) => {
    const [chamados, setChamados] = useState<Chamado[]>([]);
    const [painel, setPainel] = useState<Awaited<ReturnType<typeof crmApi.painelChamados>> | null>(null);
    const [filtro, setFiltro] = useState<'abertos' | 'atrasados' | 'todos'>('abertos');
    const [abrir, setAbrir] = useState(false);
    const [detalhe, setDetalhe] = useState<number | null>(null);
    const [devolver, setDevolver] = useState<{ vendaId: number; chamadoId?: number } | null>(null);

    const carregar = useCallback(() => {
        const params: Record<string, string> = filtro === 'todos' ? {} : { [filtro]: '1' };
        Promise.all([crmApi.chamados(params), crmApi.painelChamados()])
            .then(([c, p]) => { setChamados(c); setPainel(p); })
            .catch(e => showToast.error(erroApi(e, 'Erro ao carregar chamados')));
    }, [filtro]);
    useEffect(() => { carregar(); }, [carregar]);

    return (
        <div className="space-y-4">
            {painel && (
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <Kpi titulo="Chamados abertos" valor={painel.abertos} />
                    <Kpi titulo="Fora do prazo" valor={painel.atrasados} alerta={painel.atrasados > 0} />
                    <Kpi titulo="Resolvidos no mês" valor={painel.resolvidos_periodo}
                         detalhe={painel.tempo_medio_resolucao_horas !== null ? `média ${painel.tempo_medio_resolucao_horas} h` : undefined} />
                    <Kpi titulo="Dentro do prazo" valor={painel.sla_cumprido_percentual !== null ? `${painel.sla_cumprido_percentual}%` : '—'}
                         detalhe="alta 24 h · média 72 h · baixa 120 h" />
                </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
                {(['abertos', 'atrasados', 'todos'] as const).map(f => (
                    <Button key={f} size="sm" variant={filtro === f ? 'default' : 'outline'} onClick={() => setFiltro(f)}>
                        {f === 'abertos' ? 'Em aberto' : f === 'atrasados' ? 'Fora do prazo' : 'Todos'}</Button>
                ))}
                <div className="ml-auto flex gap-2">
                    {podeDevolver && <Button variant="outline" onClick={() => setDevolver({ vendaId: 0 })}>Devolução / troca</Button>}
                    <Button onClick={() => setAbrir(true)}>Abrir chamado</Button>
                </div>
            </div>
            {chamados.length === 0 ? <Vazio texto="Nenhum chamado neste filtro." /> : (
                <ul className="divide-y rounded-lg border bg-card">
                    {chamados.map(c => (
                        <li key={c.id}>
                            <button className="flex w-full flex-wrap items-center gap-3 p-3 text-left hover:bg-muted/40" onClick={() => setDetalhe(c.id)}>
                                <span className="font-mono text-xs text-muted-foreground">{c.numero}</span>
                                <Selo tom={c.prioridade === 'alta' ? 'vermelho' : c.prioridade === 'media' ? 'amarelo' : 'cinza'}>{c.prioridade}</Selo>
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium">{c.assunto}</p>
                                    <p className="text-xs text-muted-foreground">{c.cliente_nome} · {c.tipo} · aberto {dataHora(c.created_at)}</p>
                                </div>
                                <Selo tom={c.atrasado ? 'vermelho' : ['resolvido', 'fechado'].includes(c.status) ? 'verde' : 'azul'}>
                                    {c.atrasado ? 'Fora do prazo' : STATUS_LABEL[c.status]}</Selo>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {abrir && <AbrirChamado onFechar={() => setAbrir(false)} onSalvo={() => { setAbrir(false); carregar(); }} />}
            {detalhe && <DetalheChamado id={detalhe} podeDevolver={podeDevolver} onFechar={() => setDetalhe(null)} onMudou={carregar}
                                        onDevolver={(vendaId, chamadoId) => { setDetalhe(null); setDevolver({ vendaId, chamadoId }); }} />}
            {devolver && <Devolucao {...devolver} onFechar={() => setDevolver(null)} onSalvo={() => { setDevolver(null); carregar(); }} />}
        </div>
    );
};

const VendaDoCliente: React.FC<{ clienteId?: number; valor: number | null; onChange: (id: number | null) => void }> = ({ clienteId, valor, onChange }) => {
    const [codigo, setCodigo] = useState('');
    const [vendas, setVendas] = useState<Awaited<ReturnType<typeof crmApi.buscarVendas>>>([]);
    useEffect(() => {
        const params: Record<string, string> = {};
        if (clienteId) params.cliente_id = String(clienteId);
        if (codigo.trim()) params.codigo = codigo.trim();
        if (!clienteId && !codigo.trim()) return;
        const t = setTimeout(() => crmApi.buscarVendas(params).then(setVendas).catch(() => setVendas([])), 250);
        return () => clearTimeout(t);
    }, [clienteId, codigo]);
    const visiveis = clienteId || codigo.trim() ? vendas : [];
    return (
        <div className="space-y-2">
            <input className={campo} placeholder="Código da venda (opcional)" value={codigo} onChange={e => setCodigo(e.target.value)} />
            <select className={campo} value={valor ?? ''} onChange={e => onChange(e.target.value ? Number(e.target.value) : null)}>
                <option value="">{visiveis.length ? 'Escolha a venda' : 'Nenhuma venda encontrada'}</option>
                {visiveis.map(v => <option key={v.id} value={v.id}>{v.codigo} · {dataHora(v.data)} · {formatCurrency(v.total)}{v.cliente_nome ? ` · ${v.cliente_nome}` : ''}</option>)}
            </select>
        </div>
    );
};

const AbrirChamado: React.FC<{ onFechar: () => void; onSalvo: () => void }> = ({ onFechar, onSalvo }) => {
    const [cliente, setCliente] = useState<{ id: number; nome: string } | null>(null);
    const [venda, setVenda] = useState<number | null>(null);
    const [f, setF] = useState({ tipo: 'reclamacao', prioridade: 'media', assunto: '', descricao: '' });
    const salvar = async () => {
        if (!cliente) { showToast.error('Escolha o cliente'); return; }
        try { await crmApi.abrirChamado({ ...f, cliente_id: cliente.id, venda_id: venda }); showToast.create('Chamado aberto'); onSalvo(); }
        catch (e) { showToast.error(erroApi(e)); }
    };
    return (
        <ResponsiveModal isOpen onClose={onFechar} title="Abrir chamado" size="md" footer={<Button onClick={salvar}>Abrir</Button>}>
            <div className="space-y-3">
                <Rotulo texto="Cliente"><ClienteBusca valor={cliente} onChange={c => { setCliente(c); setVenda(null); }} /></Rotulo>
                {cliente && <Rotulo texto="Venda relacionada (opcional)"><VendaDoCliente clienteId={cliente.id} valor={venda} onChange={setVenda} /></Rotulo>}
                <div className="grid grid-cols-2 gap-3">
                    <Rotulo texto="Tipo"><select className={campo} value={f.tipo} onChange={e => setF({ ...f, tipo: e.target.value })}>
                        {TIPOS.map(t => <option key={t}>{t}</option>)}</select></Rotulo>
                    <Rotulo texto="Prioridade"><select className={campo} value={f.prioridade} onChange={e => setF({ ...f, prioridade: e.target.value })}>
                        <option value="alta">Alta (24 h)</option><option value="media">Média (72 h)</option><option value="baixa">Baixa (120 h)</option></select></Rotulo>
                </div>
                <Rotulo texto="Assunto"><input className={campo} value={f.assunto} onChange={e => setF({ ...f, assunto: e.target.value })} /></Rotulo>
                <Rotulo texto="Descrição"><textarea className={campo} rows={4} value={f.descricao} onChange={e => setF({ ...f, descricao: e.target.value })} /></Rotulo>
            </div>
        </ResponsiveModal>
    );
};

const DetalheChamado: React.FC<{ id: number; podeDevolver: boolean; onFechar: () => void; onMudou: () => void;
                                  onDevolver: (vendaId: number, chamadoId: number) => void }> = ({ id, podeDevolver, onFechar, onMudou, onDevolver }) => {
    const [c, setC] = useState<Awaited<ReturnType<typeof crmApi.chamado>> | null>(null);
    const [resolucao, setResolucao] = useState('');
    const [nota, setNota] = useState('');
    const carregar = useCallback(() => { crmApi.chamado(id).then(setC).catch(e => showToast.error(erroApi(e))); }, [id]);
    useEffect(() => { carregar(); }, [carregar]);
    if (!c) return null;
    const mudar = async (status: string) => {
        try { await crmApi.atualizarChamado(id, { status, resolucao }); carregar(); onMudou(); }
        catch (e) { showToast.error(erroApi(e)); }
    };
    const registrarNota = async () => {
        if (!nota.trim()) return;
        try { await crmApi.criarAtividade({ chamado_id: id, tipo: 'ligacao', assunto: nota }); setNota(''); carregar(); }
        catch (e) { showToast.error(erroApi(e)); }
    };
    return (
        <ResponsiveModal isOpen onClose={onFechar} title={`${c.numero} · ${c.assunto}`} subtitle={`${c.cliente_nome} · ${c.tipo}`} size="lg">
            <div className="space-y-4 text-sm">
                <div className="flex flex-wrap gap-2">
                    <Selo tom="azul">{STATUS_LABEL[c.status]}</Selo>
                    <Selo tom={c.atrasado || c.sla_estourado ? 'vermelho' : 'verde'}>Prazo {dataHora(c.sla_vencimento)}</Selo>
                    {c.primeira_resposta_em && <Selo>1ª resposta {dataHora(c.primeira_resposta_em)}</Selo>}
                </div>
                {c.descricao && <p className="whitespace-pre-line">{c.descricao}</p>}
                {c.resolucao && <p className="rounded-md bg-muted p-2"><b>Resolução:</b> {c.resolucao}</p>}
                <div>
                    <h4 className="mb-1 font-semibold">Histórico</h4>
                    {c.atividades.length === 0 ? <p className="text-muted-foreground">Sem registros.</p> : (
                        <ul className="space-y-1">{c.atividades.map(a => <li key={a.id}>{dataHora(a.created_at)} · {a.assunto}{a.resultado ? ` → ${a.resultado}` : ''}</li>)}</ul>
                    )}
                    {c.status !== 'fechado' && (
                        <div className="mt-2 flex gap-2"><input className={campo} placeholder="Registrar contato com o cliente" value={nota} onChange={e => setNota(e.target.value)} />
                            <Button variant="outline" onClick={registrarNota}>Registrar</Button></div>
                    )}
                </div>
                {c.devolucoes.length > 0 && (
                    <div><h4 className="mb-1 font-semibold">Devoluções e trocas</h4>
                        <ul className="space-y-1">{c.devolucoes.map(d => <li key={d.id}>{d.tipo} · {d.destino} · {d.forma_reembolso} · {formatCurrency(d.valor_total)}</li>)}</ul></div>
                )}
                {c.status !== 'fechado' && (
                    <div className="space-y-2 border-t pt-3">
                        {PROXIMOS[c.status].includes('resolvido') && (
                            <Rotulo texto="Resolução (obrigatória para resolver)"><input className={campo} value={resolucao} onChange={e => setResolucao(e.target.value)} /></Rotulo>
                        )}
                        <div className="flex flex-wrap gap-2">
                            {PROXIMOS[c.status].map(s => <Button key={s} size="sm" variant={s === 'resolvido' ? 'default' : 'outline'} onClick={() => mudar(s)}>{STATUS_LABEL[s]}</Button>)}
                            {podeDevolver && c.venda_id && <Button size="sm" variant="secondary" onClick={() => onDevolver(c.venda_id!, c.id)}>Devolução / troca desta venda</Button>}
                        </div>
                    </div>
                )}
            </div>
        </ResponsiveModal>
    );
};

const Devolucao: React.FC<{ vendaId: number; chamadoId?: number; onFechar: () => void; onSalvo: () => void }> = ({ vendaId, chamadoId, onFechar, onSalvo }) => {
    const [venda, setVenda] = useState<number | null>(vendaId || null);
    const [resumo, setResumo] = useState<ResumoDevolucao | null>(null);
    const [qtds, setQtds] = useState<Record<number, string>>({});
    const [lotes, setLotes] = useState<Record<number, string>>({});
    const [f, setF] = useState({ tipo: 'devolucao', destino: 'reintegrar', forma_reembolso: 'abater_titulo', motivo: '' });
    const [chave] = useState(() => `dev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    const [salvando, setSalvando] = useState(false);
    useEffect(() => {
        if (!venda) return;
        crmApi.resumoDevolucao(venda).then(r => {
            setResumo(r);
            setF(atual => ({ ...atual, forma_reembolso: r.titulos_em_aberto > 0 ? 'abater_titulo' : 'dinheiro' }));
        }).catch(e => showToast.error(erroApi(e)));
    }, [venda]);
    const atual = venda ? resumo : null;
    const total = atual ? atual.itens.reduce((s, i) => s + Number(qtds[i.venda_item_id] || 0) * i.valor_unitario_liquido, 0) : 0;
    const salvar = async () => {
        if (!venda || !atual) return;
        const itens = atual.itens.filter(i => Number(qtds[i.venda_item_id] || 0) > 0).map(i => ({
            venda_item_id: i.venda_item_id, quantidade: Number(qtds[i.venda_item_id]),
            ...(lotes[i.venda_item_id] ? { lote_id: Number(lotes[i.venda_item_id]) } : {}) }));
        if (!itens.length) { showToast.error('Informe a quantidade de pelo menos um item'); return; }
        setSalvando(true);
        try {
            await crmApi.registrarDevolucao(venda, { ...f, itens, chamado_id: chamadoId, idempotency_key: chave });
            showToast.success(f.tipo === 'troca' ? 'Troca registrada' : 'Devolução registrada');
            onSalvo();
        } catch (e) { showToast.error(erroApi(e)); } finally { setSalvando(false); }
    };
    return (
        <ResponsiveModal isOpen onClose={onFechar} title="Devolução ou troca" size="xl"
                         footer={<Button disabled={salvando || !atual} onClick={salvar}>Confirmar {f.tipo === 'troca' ? 'troca' : `devolução de ${formatCurrency(total)}`}</Button>}>
            <div className="space-y-4 text-sm">
                {!vendaId && <Rotulo texto="Venda"><VendaDoCliente valor={venda} onChange={setVenda} /></Rotulo>}
                {atual && (
                    <>
                        <p className="text-muted-foreground">Venda {atual.codigo} · total {formatCurrency(atual.total)} · já devolvido {formatCurrency(atual.valor_devolvido)}
                            · títulos em aberto {formatCurrency(atual.titulos_em_aberto)}</p>
                        <div className="overflow-x-auto rounded-md border">
                            <table className="w-full">
                                <thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr>
                                    <th className="p-2">Produto</th><th className="p-2">Vendido</th><th className="p-2">Pode voltar</th><th className="p-2">Lote</th><th className="p-2">Quantidade</th></tr></thead>
                                <tbody>
                                    {atual.itens.map(i => (
                                        <tr key={i.venda_item_id} className="border-t">
                                            <td className="p-2">{i.produto_nome}<br /><span className="text-xs text-muted-foreground">{formatCurrency(i.valor_unitario_liquido)} / un. líquido</span></td>
                                            <td className="p-2 tabular-nums">{i.quantidade}</td>
                                            <td className="p-2 tabular-nums">{i.restante}</td>
                                            <td className="p-2">
                                                {i.lotes.length ? (
                                                    <select className={`${campo} py-1`} value={lotes[i.venda_item_id] || ''} onChange={e => setLotes({ ...lotes, [i.venda_item_id]: e.target.value })}>
                                                        <option value="">Automático (ordem de saída)</option>
                                                        {i.lotes.map(l => <option key={l.lote_id} value={l.lote_id} disabled={l.restante <= 0}>
                                                            {l.numero_lote || `#${l.lote_id}`} · val. {l.data_validade?.slice(0, 10) || '—'} · resta {l.restante}</option>)}
                                                    </select>
                                                ) : <span className="text-xs text-muted-foreground">sem lote</span>}
                                            </td>
                                            <td className="p-2"><input className={`${campo} w-24 py-1`} type="number" min="0" max={i.restante} step="any"
                                                                       value={qtds[i.venda_item_id] || ''} disabled={i.restante <= 0}
                                                                       onChange={e => setQtds({ ...qtds, [i.venda_item_id]: e.target.value })} /></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-3">
                            <Rotulo texto="Operação"><select className={campo} value={f.tipo} onChange={e => setF({ ...f, tipo: e.target.value })}>
                                <option value="devolucao">Devolução (reembolsa)</option><option value="troca">Troca pelo mesmo produto</option></select></Rotulo>
                            <Rotulo texto="A mercadoria" dica="Avaria não volta para o estoque vendável.">
                                <select className={campo} value={f.destino} onChange={e => setF({ ...f, destino: e.target.value })}>
                                    <option value="reintegrar">Volta para o estoque</option><option value="avaria">Avariada</option></select></Rotulo>
                            {f.tipo === 'devolucao' && (
                                <Rotulo texto="Reembolso" dica="Dinheiro sai da sua gaveta aberta. Pix/transferência ficam só registrados.">
                                    <select className={campo} value={f.forma_reembolso} onChange={e => setF({ ...f, forma_reembolso: e.target.value })}>
                                        <option value="abater_titulo">Abater do título em aberto</option><option value="dinheiro">Dinheiro (caixa)</option>
                                        <option value="pix">Pix</option><option value="transferencia">Transferência</option><option value="estorno_cartao">Estorno no cartão</option>
                                    </select></Rotulo>
                            )}
                        </div>
                        <Rotulo texto="Motivo"><input className={campo} value={f.motivo} onChange={e => setF({ ...f, motivo: e.target.value })} /></Rotulo>
                        {atual.devolucoes.length > 0 && (
                            <p className="text-xs text-muted-foreground">Já registradas: {atual.devolucoes.map(d => `${d.tipo} ${formatCurrency(d.valor_total)}`).join(' · ')}.
                                Venda com devolução não pode mais ser cancelada; devolva o restante por aqui.</p>
                        )}
                    </>
                )}
            </div>
        </ResponsiveModal>
    );
};

export default PosVendaTab;
