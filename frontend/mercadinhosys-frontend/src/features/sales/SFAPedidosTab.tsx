import { useState, useEffect } from 'react';
import { apiClient } from '../../api/apiClient';
import { showToast } from '../../utils/toast';
import { Check, X, Search, Clock, MapPin, PackageCheck, Truck, ClipboardList } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Input } from '../../components/ui/input';

const numero = (valor: any) => Number(valor ?? 0);
const qtd = (valor: any) => numero(valor).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const moeda = (valor: any) => `R$ ${numero(valor).toFixed(2)}`;

const ROTULO_STATUS: Record<string, { texto: string; classe: string }> = {
    pendente: { texto: 'Avaliação', classe: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
    aprovado: { texto: 'Reservado', classe: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
    parcial: { texto: 'Entrega parcial', classe: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400' },
};

export default function SFAPedidosTab() {
    const [pedidos, setPedidos] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [busca, setBusca] = useState('');
    const [detalhe, setDetalhe] = useState<any>(null);
    const [quantidades, setQuantidades] = useState<Record<number, string>>({});
    const [faltas, setFaltas] = useState<any[]>([]);
    const [ocupado, setOcupado] = useState(false);

    const carregarPedidos = async () => {
        setLoading(true);
        try {
            // Gerente/admin recebe a fila da loja inteira, com itens e andamento.
            const res = await apiClient.get('/sfa/pedidos', { params: { status: 'pendente,aprovado,parcial' } });
            setPedidos(res.data?.status === 'success' ? res.data.data : []);
        } catch (error: any) {
            console.error('Erro ao buscar pedidos SFA:', error);
            // Sem pedido inventado: a fila fica vazia e o motivo aparece.
            setPedidos([]);
            showToast.error(error?.response?.data?.message || 'Não foi possível carregar os pedidos do SFA');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        carregarPedidos();
    }, []);

    const abrir = (pedido: any) => {
        setDetalhe(pedido);
        setFaltas([]);
        // Sugestão de expedição: tudo que já está reservado.
        setQuantidades(Object.fromEntries((pedido.itens || []).map((it: any) => [it.item_id, String(numero(it.quantidade_reservada))])));
    };

    const termo = busca.trim().toLowerCase();
    const pedidosFiltrados = termo
        ? pedidos.filter(p => `${p.cliente_nome || ''} ${p.codigo || ''} ${p.vendedor_nome || ''}`.toLowerCase().includes(termo))
        : pedidos;
    const aguardando = pedidosFiltrados.filter(p => p.status === 'pendente');
    const emAtendimento = pedidosFiltrados.filter(p => p.status !== 'pendente');

    // Uma ação do pedido: o servidor recusa estoque, crédito e quantidades inválidas e o motivo real aparece.
    const executar = async (caminho: string, corpo: any, sucesso: string, fechar = true) => {
        if (!detalhe || ocupado) return;
        setOcupado(true);
        try {
            await apiClient.post(`/sfa/pedidos/${detalhe.id}/${caminho}`, corpo || {});
            showToast.success(sucesso);
            if (fechar) setDetalhe(null);
            await carregarPedidos();
        } catch (error: any) {
            const dados = error?.response?.data;
            setFaltas(dados?.faltas || []);
            showToast.error(dados?.message || 'Não foi possível concluir a operação');
        } finally {
            setOcupado(false);
        }
    };

    const expedir = () => {
        const itens = (detalhe.itens || [])
            .map((it: any) => ({ item_id: it.item_id, quantidade: numero(quantidades[it.item_id]) }))
            .filter((linha: any) => linha.quantidade > 0);
        if (!itens.length) {
            showToast.error('Informe a quantidade de pelo menos um item');
            return;
        }
        executar('expedir', { itens }, 'Expedição registrada: venda e títulos gerados.');
    };

    const imprimirSeparacao = async () => {
        try {
            const res = await apiClient.get(`/sfa/pedidos/${detalhe.id}/separacao`);
            const linhas: any[] = res.data?.data?.itens || [];
            const corpo = linhas.map(l => `<tr><td>${l.produto_nome ?? ''}</td><td>${l.codigo_barras ?? ''}</td>
                <td style="text-align:right">${qtd(l.reservado)} ${l.unidade ?? ''}</td>
                <td>${(l.lotes || []).map((x: any) => `${x.lote} (${qtd(x.quantidade)}${x.validade ? ' · val. ' + x.validade : ''})`).join('<br>') || '-'}</td>
                <td style="text-align:right">${qtd(l.em_falta)}</td></tr>`).join('');
            const janela = window.open('', '_blank');
            if (!janela) {
                showToast.error('O navegador bloqueou a janela de impressão');
                return;
            }
            janela.document.write(`<html><head><title>Separação ${detalhe.codigo}</title>
                <style>body{font-family:sans-serif;padding:16px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:6px;font-size:13px;text-align:left}</style></head>
                <body><h2>Separação · ${detalhe.codigo}</h2><p>${detalhe.cliente_nome ?? ''}</p>
                <table><thead><tr><th>Produto</th><th>Código</th><th>Separar</th><th>Lotes (validade mais curta primeiro)</th><th>Em falta</th></tr></thead><tbody>${corpo}</tbody></table></body></html>`);
            janela.document.close();
            janela.print();
        } catch (error: any) {
            showToast.error(error?.response?.data?.message || 'Não foi possível montar a lista de separação');
        }
    };

    const andamento = (pedido: any) => {
        const itens: any[] = pedido.itens || [];
        const pedido_qtd = itens.reduce((s, i) => s + numero(i.quantidade), 0);
        const atendido = itens.reduce((s, i) => s + numero(i.quantidade_atendida), 0);
        const reservado = itens.reduce((s, i) => s + numero(i.quantidade_reservada), 0);
        return { pedido_qtd, atendido, reservado, pct: pedido_qtd ? Math.round((atendido / pedido_qtd) * 100) : 0 };
    };

    const cartao = (p: any) => {
        const rotulo = ROTULO_STATUS[p.status] || ROTULO_STATUS.pendente;
        const prog = andamento(p);
        return (
            <Card key={p.id} className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition">
                <CardContent className="p-4 flex flex-col h-full justify-between">
                    <div>
                        <div className="flex justify-between items-start mb-2">
                            <h3 className="font-bold text-slate-800 dark:text-slate-100 truncate flex-1 pr-2">{p.cliente_nome || 'Cliente não identificado'}</h3>
                            <span className={`${rotulo.classe} text-[10px] font-bold px-2 py-1 rounded-full uppercase flex items-center`}>
                                <Clock className="w-3 h-3 mr-1" /> {rotulo.texto}
                            </span>
                        </div>
                        <p className="text-sm text-slate-500 mb-4">{p.condicao_pagamento}</p>
                        <div className="flex items-center gap-2 mb-2">
                            <MapPin className="w-4 h-4 text-slate-400" />
                            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{p.vendedor_nome || 'Vendedor'} · {p.codigo}</span>
                        </div>
                        {p.status !== 'pendente' && (
                            <div className="mt-3">
                                <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                    <div className="h-full bg-emerald-500" style={{ width: `${prog.pct}%` }} />
                                </div>
                                <p className="text-[11px] text-slate-500 mt-1">
                                    {qtd(prog.atendido)} de {qtd(prog.pedido_qtd)} expedidos · {qtd(prog.reservado)} reservados
                                </p>
                            </div>
                        )}
                    </div>
                    <div className="border-t border-slate-100 dark:border-slate-800 pt-4 flex items-center justify-between mt-4">
                        <div className="font-black text-lg text-slate-900 dark:text-white">{moeda(p.total)}</div>
                        <Button size="sm" variant="outline" className="text-blue-600 border-blue-200 hover:bg-blue-50" onClick={() => abrir(p)}>
                            {p.status === 'pendente' ? 'Analisar' : 'Atender'}
                        </Button>
                    </div>
                </CardContent>
            </Card>
        );
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-col sm:flex-row justify-between gap-4 items-center">
                <div className="relative w-full sm:w-96">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <Input
                        placeholder="Buscar pedido ou cliente..."
                        className="pl-9 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800"
                        value={busca}
                        onChange={(e) => setBusca(e.target.value)}
                    />
                </div>
                <Button variant="outline" onClick={carregarPedidos} disabled={loading}>
                    Atualizar Lista
                </Button>
            </div>

            {loading ? (
                <div className="flex justify-center p-8"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div></div>
            ) : pedidosFiltrados.length === 0 ? (
                <Card className="bg-white dark:bg-slate-900 border-dashed border-2">
                    <CardContent className="flex flex-col items-center justify-center py-12 text-slate-500">
                        <Check className="w-12 h-12 text-slate-300 mb-4" />
                        <p className="text-lg font-medium text-slate-700 dark:text-slate-300">Tudo limpo!</p>
                        <p>Nenhum pedido do SFA aguardando análise ou expedição.</p>
                    </CardContent>
                </Card>
            ) : (
                <>
                    {aguardando.length > 0 && (
                        <section className="space-y-3">
                            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500">Aguardando análise ({aguardando.length})</h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{aguardando.map(cartao)}</div>
                        </section>
                    )}
                    {emAtendimento.length > 0 && (
                        <section className="space-y-3">
                            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500">Em atendimento: reservados e entregas parciais ({emAtendimento.length})</h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{emAtendimento.map(cartao)}</div>
                        </section>
                    )}
                </>
            )}

            {detalhe && (
                <div className="fixed inset-0 z-100 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))', paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}>
                    <Card className="w-full max-w-3xl bg-white dark:bg-slate-900 shadow-2xl border-0 overflow-hidden flex flex-col max-h-[90dvh]">
                        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50">
                            <h2 className="font-bold text-lg text-slate-800 dark:text-white">
                                {detalhe.status === 'pendente' ? 'Aprovação de Pedido' : 'Atendimento do Pedido'} · {detalhe.codigo}
                            </h2>
                            <Button variant="ghost" size="icon" onClick={() => setDetalhe(null)} className="rounded-full h-8 w-8">
                                <X className="w-4 h-4" />
                            </Button>
                        </div>

                        <div className="p-6 overflow-y-auto flex-1 space-y-6">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Cliente</p>
                                    <p className="font-bold text-slate-900 dark:text-white">{detalhe.cliente_nome}</p>
                                </div>
                                <div>
                                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Valor Total</p>
                                    <p className="font-bold text-slate-900 dark:text-white text-xl">{moeda(detalhe.total)}</p>
                                </div>
                                <div>
                                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Condição</p>
                                    <p className="font-semibold text-slate-700 dark:text-slate-300">{detalhe.condicao_pagamento}</p>
                                </div>
                            </div>

                            <div>
                                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">Itens do Pedido</p>
                                <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                                    {detalhe.status === 'pendente' ? (
                                        <>
                                            <div className="bg-slate-50 dark:bg-slate-800/50 px-4 py-2 text-xs font-medium text-slate-500 grid grid-cols-12">
                                                <div className="col-span-6">Produto</div>
                                                <div className="col-span-2 text-center">Qtd</div>
                                                <div className="col-span-4 text-right">Subtotal</div>
                                            </div>
                                            <div className="divide-y divide-slate-100 dark:divide-slate-800">
                                                {(detalhe.itens || []).map((it: any, i: number) => (
                                                    <div key={i} className="px-4 py-3 text-sm grid grid-cols-12 items-center">
                                                        <div className="col-span-6 font-medium text-slate-800 dark:text-slate-200 truncate pr-2">{it.produto_nome}</div>
                                                        <div className="col-span-2 text-center text-slate-600 dark:text-slate-400">{qtd(it.quantidade)}</div>
                                                        <div className="col-span-4 text-right font-semibold">{moeda(it.total_item)}</div>
                                                    </div>
                                                ))}
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            <div className="bg-slate-50 dark:bg-slate-800/50 px-4 py-2 text-xs font-medium text-slate-500 grid grid-cols-12 gap-2">
                                                <div className="col-span-4">Produto</div>
                                                <div className="col-span-1 text-center">Pedido</div>
                                                <div className="col-span-1 text-center">Saiu</div>
                                                <div className="col-span-2 text-center">Reservado</div>
                                                <div className="col-span-1 text-center">Falta</div>
                                                <div className="col-span-3 text-right">Expedir agora</div>
                                            </div>
                                            <div className="divide-y divide-slate-100 dark:divide-slate-800">
                                                {(detalhe.itens || []).map((it: any) => {
                                                    const saldo = numero(it.quantidade) - numero(it.quantidade_atendida) - numero(it.quantidade_cancelada);
                                                    const falta = Math.max(0, saldo - numero(it.quantidade_reservada));
                                                    return (
                                                        <div key={it.item_id} className="px-4 py-3 text-sm grid grid-cols-12 items-center gap-2">
                                                            <div className="col-span-4 font-medium text-slate-800 dark:text-slate-200 truncate">{it.produto_nome}</div>
                                                            <div className="col-span-1 text-center">{qtd(it.quantidade)}</div>
                                                            <div className="col-span-1 text-center">{qtd(it.quantidade_atendida)}</div>
                                                            <div className="col-span-2 text-center text-blue-600 dark:text-blue-400 font-semibold">{qtd(it.quantidade_reservada)}</div>
                                                            <div className={`col-span-1 text-center ${falta > 0 ? 'text-rose-600 font-semibold' : 'text-slate-400'}`}>{qtd(falta)}</div>
                                                            <div className="col-span-3">
                                                                <Input
                                                                    type="number"
                                                                    min="0"
                                                                    step="any"
                                                                    max={numero(it.quantidade_reservada)}
                                                                    disabled={numero(it.quantidade_reservada) <= 0}
                                                                    value={quantidades[it.item_id] ?? ''}
                                                                    onChange={(e) => setQuantidades({ ...quantidades, [it.item_id]: e.target.value })}
                                                                    className="h-8 text-right"
                                                                />
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>

                            {faltas.length > 0 && (
                                <div className="rounded-lg border border-rose-200 bg-rose-50 dark:bg-rose-900/20 dark:border-rose-800 p-4 text-sm text-rose-700 dark:text-rose-300">
                                    <p className="font-semibold mb-2">Estoque livre insuficiente para reservar tudo:</p>
                                    <ul className="list-disc pl-5 space-y-1">
                                        {faltas.map((f: any) => (
                                            <li key={f.item_id}>{f.produto_nome}: precisa {f.precisa}, livre {f.livre}</li>
                                        ))}
                                    </ul>
                                    <p className="mt-2 text-xs">Você pode reservar só o que existe; o restante fica em carteira até chegar mercadoria.</p>
                                </div>
                            )}
                        </div>

                        <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex flex-wrap justify-end gap-3">
                            {detalhe.status === 'pendente' ? (
                                <>
                                    <Button variant="outline" className="border-red-200 text-red-600 hover:bg-red-50" disabled={ocupado}
                                        onClick={() => executar('rejeitar', {}, 'Pedido rejeitado.')}>
                                        Rejeitar
                                    </Button>
                                    {faltas.length > 0 && (
                                        <Button variant="outline" disabled={ocupado}
                                            onClick={() => executar('reservar', { permitir_falta: true }, 'Reserva parcial feita; o restante ficou em carteira.')}>
                                            Reservar só o que existe
                                        </Button>
                                    )}
                                    <Button variant="outline" className="border-blue-200 text-blue-600 hover:bg-blue-50" disabled={ocupado}
                                        onClick={() => executar('reservar', {}, 'Estoque reservado para o pedido.')}>
                                        <PackageCheck className="w-4 h-4 mr-2" /> Aprovar e reservar
                                    </Button>
                                    <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" disabled={ocupado}
                                        onClick={() => executar('aprovar', {}, 'Pedido aprovado e faturado!')}>
                                        Aprovar e Faturar tudo
                                    </Button>
                                </>
                            ) : (
                                <>
                                    <Button variant="outline" onClick={imprimirSeparacao} disabled={ocupado}>
                                        <ClipboardList className="w-4 h-4 mr-2" /> Separação
                                    </Button>
                                    <Button variant="outline" className="border-red-200 text-red-600 hover:bg-red-50" disabled={ocupado}
                                        onClick={() => executar('cancelar-saldo', { motivo: 'Saldo cancelado pelo gestor' }, 'Saldo cancelado e reserva liberada.')}>
                                        Cancelar saldo
                                    </Button>
                                    <Button variant="outline" disabled={ocupado}
                                        onClick={() => executar('reservar', { permitir_falta: true }, 'Reserva atualizada com o estoque disponível.', false)}>
                                        Reservar o que falta
                                    </Button>
                                    <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" disabled={ocupado} onClick={expedir}>
                                        <Truck className="w-4 h-4 mr-2" /> Expedir
                                    </Button>
                                </>
                            )}
                        </div>
                    </Card>
                </div>
            )}
        </div>
    );
}
