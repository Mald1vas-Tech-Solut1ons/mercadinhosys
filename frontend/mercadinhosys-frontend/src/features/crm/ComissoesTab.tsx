import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { formatCurrency } from '../../utils/formatters';
import { showToast } from '../../utils/toast';
import { crmApi, erroApi, ExtratoComissao } from './crmApi';
import { Kpi, Rotulo, Selo, Vazio } from './crmUi';
import { campo, dataHora } from './crmFormat';

const competenciaAtual = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const ComissoesTab: React.FC<{ gestor: boolean; usuarioId?: number; responsaveis: { id: number; nome: string }[] }> =
    ({ gestor, usuarioId, responsaveis }) => {
        const [competencia, setCompetencia] = useState(competenciaAtual());
        const [resumo, setResumo] = useState<ExtratoComissao[]>([]);
        const [extrato, setExtrato] = useState<ExtratoComissao | null>(null);
        const [vendedor, setVendedor] = useState<number | undefined>(gestor ? undefined : usuarioId);
        const [regras, setRegras] = useState<Awaited<ReturnType<typeof crmApi.regras>>>([]);
        const [regra, setRegra] = useState({ vendedor_id: '', percentual: '' });

        const carregar = useCallback(() => {
            if (gestor) {
                crmApi.resumoComissoes(competencia).then(setResumo).catch(e => showToast.error(erroApi(e)));
                crmApi.regras().then(setRegras).catch(() => setRegras([]));
            }
            const alvo = gestor ? vendedor : usuarioId;
            if (alvo || !gestor) {
                crmApi.extrato({ competencia, ...(alvo ? { vendedor_id: String(alvo) } : {}) }).then(setExtrato)
                    .catch(e => showToast.error(erroApi(e)));
            }
        }, [competencia, gestor, vendedor, usuarioId]);
        useEffect(() => { carregar(); }, [carregar]);

        const salvarRegra = async () => {
            try { await crmApi.definirRegra({ percentual: Number(regra.percentual), vendedor_id: regra.vendedor_id || null }); showToast.update('Regra salva'); carregar(); }
            catch (e) { showToast.error(erroApi(e)); }
        };
        const fechar = async (id: number) => {
            if (!window.confirm(`Fechar a comissão de ${competencia}? Depois de fechada ela não muda; cancelamentos e devoluções posteriores entram no mês em que acontecerem.`)) return;
            try { await crmApi.fecharComissao(id, competencia); showToast.success('Competência fechada'); carregar(); }
            catch (e) { showToast.error(erroApi(e)); }
        };

        return (
            <div className="space-y-4">
                <div className="flex flex-wrap items-end gap-3">
                    <Rotulo texto="Competência"><input className={campo} type="month" value={competencia} onChange={e => setCompetencia(e.target.value)} /></Rotulo>
                    <p className="max-w-xl text-xs text-muted-foreground">
                        Base = vendas do mês − cancelamentos do mês − devoluções do mês, pela data em que cada fato aconteceu.
                        Pedido B2B conta para o vendedor que tirou o pedido.
                    </p>
                </div>

                {gestor && (
                    <div className="grid gap-4 lg:grid-cols-3">
                        <div className="lg:col-span-2 overflow-x-auto rounded-lg border">
                            {resumo.length === 0 ? <div className="p-4"><Vazio texto="Sem vendas nem regras nesta competência." /></div> : (
                                <table className="w-full text-sm">
                                    <thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr>
                                        <th className="p-2">Vendedor</th><th className="p-2 text-right">Base líquida</th><th className="p-2 text-right">%</th>
                                        <th className="p-2 text-right">Comissão</th><th className="p-2" /></tr></thead>
                                    <tbody>
                                        {resumo.map(l => (
                                            <tr key={l.vendedor_id} className="border-t">
                                                <td className="p-2"><button className="text-left hover:underline" onClick={() => setVendedor(l.vendedor_id)}>{l.vendedor_nome}</button></td>
                                                <td className="p-2 text-right tabular-nums">{formatCurrency(l.base_liquida)}</td>
                                                <td className="p-2 text-right tabular-nums">{l.percentual ?? '—'}</td>
                                                <td className="p-2 text-right font-semibold tabular-nums">{formatCurrency(l.valor_comissao)}</td>
                                                <td className="p-2 text-right">{l.fechada ? <Selo tom="verde">fechada</Selo>
                                                    : l.percentual !== null && competencia < competenciaAtual() ? <Button size="sm" variant="outline" onClick={() => fechar(l.vendedor_id)}>Fechar</Button> : null}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                        <div className="space-y-3 rounded-lg border bg-card p-4">
                            <h4 className="text-sm font-semibold">Regras</h4>
                            <ul className="space-y-1 text-sm">
                                {regras.map(r => <li key={r.id} className="flex justify-between"><span>{r.vendedor_nome}</span><span className="tabular-nums">{r.percentual}%{!r.ativo ? ' (inativa)' : ''}</span></li>)}
                                {regras.length === 0 && <li className="text-muted-foreground">Nenhuma regra. Sem regra não há comissão.</li>}
                            </ul>
                            <Rotulo texto="Vendedor"><select className={campo} value={regra.vendedor_id} onChange={e => setRegra({ ...regra, vendedor_id: e.target.value })}>
                                <option value="">Padrão (todo vendedor sem regra própria)</option>
                                {responsaveis.map(r => <option key={r.id} value={r.id}>{r.nome}</option>)}</select></Rotulo>
                            <Rotulo texto="Percentual"><input className={campo} type="number" step="0.01" min="0" max="100" value={regra.percentual}
                                                              onChange={e => setRegra({ ...regra, percentual: e.target.value })} /></Rotulo>
                            <Button onClick={salvarRegra}>Salvar regra</Button>
                        </div>
                    </div>
                )}

                {extrato && (!gestor || vendedor) && (
                    <div className="space-y-3">
                        <h3 className="text-sm font-semibold">Extrato · {extrato.vendedor_nome} {extrato.fechada && <Selo tom="verde">fechada em {dataHora(extrato.fechado_em)}</Selo>}</h3>
                        {extrato.aviso && <p className="text-sm text-amber-700 dark:text-amber-300">{extrato.aviso}</p>}
                        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                            <Kpi titulo="Vendas" valor={formatCurrency(extrato.base_vendas)} />
                            <Kpi titulo="Cancelamentos" valor={formatCurrency(extrato.base_cancelamentos)} />
                            <Kpi titulo="Devoluções" valor={formatCurrency(extrato.base_devolucoes)} />
                            <Kpi titulo="Base líquida" valor={formatCurrency(extrato.base_liquida)} />
                            <Kpi titulo={`Comissão${extrato.percentual !== null ? ` (${extrato.percentual}%)` : ''}`} valor={formatCurrency(extrato.valor_comissao)} />
                        </div>
                        {(extrato.eventos || []).length > 0 && (
                            <div className="max-h-80 overflow-auto rounded-lg border">
                                <table className="w-full text-sm">
                                    <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground"><tr>
                                        <th className="p-2">Data</th><th className="p-2">Fato</th><th className="p-2">Venda</th><th className="p-2 text-right">Valor</th></tr></thead>
                                    <tbody>{extrato.eventos!.map((e, i) => (
                                        <tr key={i} className="border-t"><td className="p-2">{dataHora(e.data)}</td><td className="p-2">{e.tipo}</td>
                                            <td className="p-2 font-mono text-xs">{e.codigo}</td><td className="p-2 text-right tabular-nums">{formatCurrency(e.valor)}</td></tr>))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    };

export default ComissoesTab;
