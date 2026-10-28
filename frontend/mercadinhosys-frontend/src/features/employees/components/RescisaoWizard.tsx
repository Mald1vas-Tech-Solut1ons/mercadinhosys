import { useEffect, useState } from 'react';
import { UserMinus, ArrowRight, ArrowLeft, Download, Save, AlertTriangle, CheckCircle2, FileText, History, Search, RotateCcw, Wallet } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { apiClient } from '../../../api/apiClient';
import { showToast } from '../../../components/elements/Toast';
import folhaService, { RescisaoData, TipoRescisao, RescisaoRegistro } from '../folhaService';
import { dataDoDia } from '../../../utils/dataLocal';
import { confirmar } from '../../../components/ui/Confirmacao';

/**
 * Wizard de Demissão (Rescisão) — Admin/Gerente/RH.
 * 3 passos: (1) funcionário, (2) motivo + datas + dados, (3) revisão com a
 * memória de cálculo das verbas e exportação de relatório para o contador.
 * Todos os valores vêm do motor de folha (CLT) no backend.
 */

interface FuncionarioLite { id: number; nome: string; cargo?: string; salario_base?: number; data_admissao?: string; }

interface Estabelecimento {
    razao_social?: string; cnpj?: string; logradouro?: string; numero?: string;
    bairro?: string; cidade?: string; estado?: string;
}

const TIPOS: { valor: TipoRescisao; titulo: string; desc: string; cor: string }[] = [
    { valor: 'S_JUSTA', titulo: 'Dispensa sem justa causa', desc: 'Empresa demite. Aviso, 13º, férias e multa 40% FGTS.', cor: 'border-rose-300 bg-rose-50 dark:bg-rose-500/10' },
    { valor: 'PEDIDO', titulo: 'Pedido de demissão', desc: 'Funcionário pede. 13º e férias proporcionais, sem multa.', cor: 'border-blue-300 bg-blue-50 dark:bg-blue-500/10' },
    { valor: 'ACORDO', titulo: 'Acordo (distrato 484-A)', desc: 'Metade do aviso e multa 20% FGTS.', cor: 'border-amber-300 bg-amber-50 dark:bg-amber-500/10' },
    { valor: 'C_JUSTA', titulo: 'Com justa causa', desc: 'Apenas saldo de salário e férias vencidas.', cor: 'border-gray-300 bg-gray-50 dark:bg-gray-700/40 dark:border-gray-700' },
];

const fmtMoeda = (n: number) => (n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function RescisaoWizard() {
    const [modo, setModo] = useState<'nova' | 'historico'>('nova');
    const [historico, setHistorico] = useState<RescisaoRegistro[]>([]);
    const [carregandoHist, setCarregandoHist] = useState(false);
    const [filtroFuncHist, setFiltroFuncHist] = useState<number | ''>('');
    const [filtroTipoHist, setFiltroTipoHist] = useState<TipoRescisao | ''>('');
    const [passo, setPasso] = useState(1);
    const [funcionarios, setFuncionarios] = useState<FuncionarioLite[]>([]);
    const [funcionarioId, setFuncionarioId] = useState<number | ''>('');
    const [tipo, setTipo] = useState<TipoRescisao | ''>('');
    const [dataDemissao, setDataDemissao] = useState('');
    const [saldoFgts, setSaldoFgts] = useState('');
    const [feriasVencidas, setFeriasVencidas] = useState('');
    const [formaPagamento, setFormaPagamento] = useState('PIX');
    const [avisoCumprido, setAvisoCumprido] = useState(false);
    const [descontosAdicionais, setDescontosAdicionais] = useState('');
    const [resultado, setResultado] = useState<RescisaoData | null>(null);
    const [calculando, setCalculando] = useState(false);
    const [registrando, setRegistrando] = useState(false);
    const [registrada, setRegistrada] = useState(false);
    const [estab, setEstab] = useState<Estabelecimento | null>(null);

    const carregarFuncionarios = async () => {
        try {
            const r = await apiClient.get('/funcionarios', { params: { simples: true, por_pagina: 200, incluir_estatisticas: false, ativos: true } });
            setFuncionarios(r.data?.data || r.data?.funcionarios || []);
        } catch {
            setFuncionarios([]);
        }
    };

    useEffect(() => {
        carregarFuncionarios();
        apiClient.get('/configuracao/estabelecimento')
            .then(r => setEstab(r.data?.estabelecimento || null))
            .catch(() => { });
    }, []);

    const funcionarioSel = funcionarios.find(f => f.id === funcionarioId);

    const simular = async () => {
        if (!funcionarioId || !tipo || !dataDemissao) { showToast.error('Preencha funcionário, motivo e data'); return; }
        setCalculando(true);
        setRegistrada(false);
        try {
            const r = await folhaService.simularRescisao({
                funcionario_id: Number(funcionarioId),
                data_demissao: dataDemissao,
                tipo_rescisao: tipo,
                saldo_fgts: saldoFgts ? Number(saldoFgts) : null,
                ferias_vencidas_dias: feriasVencidas ? Number(feriasVencidas) : 0,
                forma_pagamento: formaPagamento,
                aviso_cumprido: avisoCumprido,
                descontos_adicionais: descontosAdicionais ? Number(descontosAdicionais) : 0,
            });
            setResultado(r);
            setPasso(3);
        } catch (e: any) {
            showToast.error(e?.response?.data?.message || 'Erro ao calcular rescisão');
        } finally {
            setCalculando(false);
        }
    };

    const registrar = async () => {
        if (!funcionarioId || !tipo || !dataDemissao) return;
        setRegistrando(true);
        try {
            await folhaService.registrarRescisao({
                funcionario_id: Number(funcionarioId),
                data_demissao: dataDemissao,
                tipo_rescisao: tipo,
                saldo_fgts: saldoFgts ? Number(saldoFgts) : null,
                ferias_vencidas_dias: feriasVencidas ? Number(feriasVencidas) : 0,
                forma_pagamento: formaPagamento,
                aviso_cumprido: avisoCumprido,
                descontos_adicionais: descontosAdicionais ? Number(descontosAdicionais) : 0,
            });
            setRegistrada(true);
            showToast.success('Rescisão registrada e funcionário desligado com sucesso');
            carregarFuncionarios();
        } catch (e: any) {
            showToast.error(e?.response?.data?.message || 'Erro ao registrar rescisão');
        } finally {
            setRegistrando(false);
        }
    };

    const carregarHistorico = async () => {
        setCarregandoHist(true);
        try {
            const lista = await folhaService.listarRescisoes({
                funcionario_id: filtroFuncHist ? Number(filtroFuncHist) : undefined,
                tipo_rescisao: filtroTipoHist || undefined,
            });
            setHistorico(lista);
        } catch (e: any) {
            showToast.error(e?.response?.data?.message || 'Erro ao carregar histórico');
        } finally {
            setCarregandoHist(false);
        }
    };

    const reverterRescisao = async (r: RescisaoRegistro) => {
        const nome = nomeHist(r);
        if (!(await confirmar({ titulo: `Cancelar a demissão de ${nome}?`, mensagem: 'O colaborador volta a ficar ativo.', acao: 'Cancelar demissão' }))) return;
        try {
            await folhaService.cancelarRescisao(r.id);
            showToast.success(`Demissão de ${nome} cancelada com sucesso. Colaborador reativado!`);
            carregarHistorico();
            carregarFuncionarios();
        } catch (e: any) {
            showToast.error(e?.response?.data?.message || 'Erro ao cancelar demissão');
        }
    };

    useEffect(() => {
        if (modo === 'historico') carregarHistorico();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [modo, filtroFuncHist, filtroTipoHist]);

    const gerarPDF = (res: RescisaoData, nome: string, cargo: string) => {
        const doc = new jsPDF();
        const tipoLabel = TIPOS.find(t => t.valor === res.tipo_rescisao)?.titulo || res.tipo_rescisao;

        doc.setFillColor(31, 41, 55);
        doc.rect(0, 0, 210, 40, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(20); doc.setFont('helvetica', 'bold');
        doc.text('DEMONSTRATIVO DE VERBAS RESCISÓRIAS', 105, 18, { align: 'center' });
        doc.setFontSize(10); doc.setFont('helvetica', 'normal');
        doc.text('Estimativa para conferência do contador — não substitui o TRCT oficial', 105, 28, { align: 'center' });

        doc.setTextColor(17, 24, 39);
        let y = 50;
        doc.setFontSize(12); doc.setFont('helvetica', 'bold');
        doc.text(estab?.razao_social || 'Empregador', 14, y);
        doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(75, 85, 99);
        doc.text(`CNPJ: ${estab?.cnpj || '—'}`, 14, y + 6);
        y += 16;
        doc.setTextColor(17, 24, 39); doc.setFontSize(10); doc.setFont('helvetica', 'bold');
        doc.text(`Colaborador: ${nome}`, 14, y);
        doc.setFont('helvetica', 'normal');
        doc.text(`Cargo: ${cargo || '—'}`, 14, y + 6);
        doc.text(`Admissão: ${dataDoDia(res.data_admissao).toLocaleDateString('pt-BR')}`, 14, y + 12);
        doc.text(`Demissão: ${dataDoDia(res.data_demissao).toLocaleDateString('pt-BR')}   |   Motivo: ${tipoLabel}`, 14, y + 18);
        y += 26;

        autoTable(doc, {
            startY: y,
            head: [['Verba', 'Referência', 'Valor (R$)']],
            body: res.proventos.map(p => [p.descricao, p.referencia, fmtMoeda(p.valor)]),
            theme: 'grid',
            headStyles: { fillColor: [31, 41, 55], textColor: [255, 255, 255], fontSize: 9 },
            styles: { fontSize: 9, cellPadding: 3 },
            columnStyles: { 2: { halign: 'right' } },
        });
        let fy = (doc as any).lastAutoTable.finalY + 8;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
        doc.text(`TOTAL BRUTO ESTIMADO: ${fmtMoeda(res.total_proventos)}`, 196, fy, { align: 'right' });

        fy += 12;
        doc.setFontSize(10); doc.text('Memória de cálculo', 14, fy);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(55, 65, 81);
        res.memoria_calculo.forEach((m, i) => { doc.text(`• ${m}`, 14, fy + 6 + i * 5, { maxWidth: 182 }); });
        fy = fy + 6 + res.memoria_calculo.length * 5 + 6;
        doc.setTextColor(120, 53, 15); doc.setFontSize(8);
        doc.text(doc.splitTextToSize(res.aviso_legal, 182), 14, fy);

        doc.save(`Rescisao_${nome.split(' ')[0]}_${res.data_demissao}.pdf`);
    };

    const exportarPDF = () => {
        if (!resultado || !funcionarioSel) return;
        gerarPDF(resultado, funcionarioSel.nome, funcionarioSel.cargo || '');
    };

    const reiniciar = () => {
        setPasso(1); setFuncionarioId(''); setTipo(''); setDataDemissao('');
        setSaldoFgts(''); setFeriasVencidas(''); setResultado(null); setRegistrada(false);
    };

    const nomeHist = (r: RescisaoRegistro) => r.funcionario_nome || `Funcionário #${r.funcionario_id}`;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                    <div className="p-3 rounded-2xl bg-rose-100 dark:bg-rose-500/20 text-rose-600 dark:text-rose-400"><UserMinus className="w-6 h-6" /></div>
                    <div>
                        <h2 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">Demissão</h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Calcule as verbas rescisórias e gere o relatório para o contador</p>
                    </div>
                </div>
                {/* Toggle Nova / Histórico */}
                <div className="inline-flex rounded-xl bg-gray-100 dark:bg-gray-800 p-1">
                    <button onClick={() => setModo('nova')}
                        className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${modo === 'nova' ? 'bg-white dark:bg-gray-700 text-indigo-600 dark:text-white shadow' : 'text-gray-500'}`}>
                        Nova rescisão
                    </button>
                    <button onClick={() => setModo('historico')}
                        className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors inline-flex items-center gap-1.5 ${modo === 'historico' ? 'bg-white dark:bg-gray-700 text-indigo-600 dark:text-white shadow' : 'text-gray-500'}`}>
                        <History className="w-4 h-4" /> Histórico
                    </button>
                </div>
            </div>

            {/* ===== HISTÓRICO ===== */}
            {modo === 'historico' && (
                <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-3">
                        <div className="relative flex-1 min-w-[200px]">
                            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                            <select value={filtroFuncHist} onChange={e => setFiltroFuncHist(e.target.value ? Number(e.target.value) : '')}
                                className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm bg-white dark:bg-gray-900/50 text-gray-900 dark:text-white">
                                <option value="">Todos os funcionários</option>
                                {funcionarios.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
                            </select>
                        </div>
                        <select value={filtroTipoHist} onChange={e => setFiltroTipoHist(e.target.value as TipoRescisao | '')}
                            className="px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm bg-white dark:bg-gray-900/50 text-gray-900 dark:text-white">
                            <option value="">Todos os motivos</option>
                            {TIPOS.map(t => <option key={t.valor} value={t.valor}>{t.titulo}</option>)}
                        </select>
                    </div>

                    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700/50 overflow-hidden">
                        {carregandoHist ? (
                            <div className="py-12 text-center text-gray-500 text-sm dark:text-gray-400">Carregando histórico…</div>
                        ) : historico.length === 0 ? (
                            <div className="py-12 text-center text-gray-500 text-sm dark:text-gray-400">Nenhuma rescisão registrada com os filtros atuais</div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-gray-50/50 dark:bg-gray-900/50 text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                                        <tr>
                                            <th className="text-left px-4 py-3 font-bold uppercase text-xs">Funcionário</th>
                                            <th className="text-left px-4 py-3 font-bold uppercase text-xs">Demissão</th>
                                            <th className="text-left px-4 py-3 font-bold uppercase text-xs">Motivo</th>
                                            <th className="text-right px-4 py-3 font-bold uppercase text-xs">Total bruto</th>
                                            <th className="text-right px-4 py-3 font-bold uppercase text-xs">Ações</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                        {historico.map(r => (
                                            <tr key={r.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/60">
                                                <td className="px-4 py-3 font-semibold text-gray-900 dark:text-white">{nomeHist(r)}{r.cargo ? <span className="block text-xs font-normal text-gray-400">{r.cargo}</span> : null}</td>
                                                <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{dataDoDia(r.data_demissao).toLocaleDateString('pt-BR')}</td>
                                                <td className="px-4 py-3"><span className="px-2.5 py-1 text-xs font-bold rounded-md bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200">{TIPOS.find(t => t.valor === r.tipo_rescisao)?.titulo || r.tipo_rescisao}</span></td>
                                                <td className="px-4 py-3 text-right font-black text-emerald-600 dark:text-emerald-400">{fmtMoeda(r.total_liquido)}</td>
                                                <td className="px-4 py-3 text-right">
                                                    <div className="flex items-center justify-end gap-2">
                                                        <button onClick={() => r.detalhe && gerarPDF(r.detalhe, nomeHist(r), r.cargo || '')}
                                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 dark:bg-gray-700 hover:bg-black text-white text-xs font-bold transition-colors">
                                                            <Download className="w-3.5 h-3.5" /> PDF
                                                        </button>
                                                        <button onClick={() => reverterRescisao(r)} title="Cancelar demissão e reativar funcionário"
                                                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-500/20 text-xs font-bold transition-colors">
                                                            <RotateCcw className="w-3.5 h-3.5" /> Reverter
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ===== NOVA RESCISÃO (wizard) ===== */}
            {modo === 'nova' && (<>
            {/* Stepper */}
            <div className="flex items-center gap-2">
                {['Funcionário', 'Motivo & Datas', 'Revisão'].map((label, i) => {
                    const n = i + 1;
                    const ativo = passo === n, feito = passo > n;
                    return (
                        <div key={label} className="flex items-center gap-2 flex-1">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-sm ${feito ? 'bg-emerald-500 text-white' : ativo ? 'bg-indigo-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-500'} dark:text-gray-400`}>
                                {feito ? <CheckCircle2 className="w-5 h-5" /> : n}
                            </div>
                            <span className={`text-sm font-semibold hidden sm:block ${ativo ? 'text-gray-900 dark:text-white' : 'text-gray-400'}`}>{label}</span>
                            {n < 3 && <div className="flex-1 h-0.5 bg-gray-200 dark:bg-gray-700" />}
                        </div>
                    );
                })}
            </div>

            <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-2xl shadow-sm p-6 border border-gray-200/50 dark:border-gray-700/50">
                {/* PASSO 1 */}
                {passo === 1 && (
                    <div className="space-y-4">
                        <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Funcionário a desligar</label>
                        <select
                            value={funcionarioId}
                            onChange={e => setFuncionarioId(e.target.value ? Number(e.target.value) : '')}
                            className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 text-sm bg-white dark:bg-gray-900/50 text-gray-900 dark:text-white"
                        >
                            <option value="">Selecione...</option>
                            {funcionarios.map(f => <option key={f.id} value={f.id}>{f.nome}{f.cargo ? ` — ${f.cargo}` : ''}</option>)}
                        </select>
                        {funcionarioSel && (
                            <div className="text-sm text-gray-500 dark:text-gray-400">
                                Admissão: {funcionarioSel.data_admissao ? dataDoDia(funcionarioSel.data_admissao).toLocaleDateString('pt-BR') : '—'}
                                {funcionarioSel.salario_base != null && ` · Salário base: ${fmtMoeda(Number(funcionarioSel.salario_base))}`}
                            </div>
                        )}
                        <div className="flex justify-end">
                            <button onClick={() => setPasso(2)} disabled={!funcionarioId}
                                className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-sm disabled:opacity-50">
                                Continuar <ArrowRight className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                )}

                {/* PASSO 2 */}
                {passo === 2 && (
                    <div className="space-y-5">
                        <div>
                            <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Motivo da rescisão</label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {TIPOS.map(t => (
                                    <button key={t.valor} onClick={() => setTipo(t.valor)}
                                        className={`text-left p-4 rounded-xl border-2 transition-all ${tipo === t.valor ? `${t.cor} ring-2 ring-indigo-400` : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'}`}>
                                        <p className="font-bold text-gray-900 dark:text-white text-sm">{t.titulo}</p>
                                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t.desc}</p>
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Data da demissão *</label>
                                <input type="date" value={dataDemissao} onChange={e => setDataDemissao(e.target.value)}
                                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm bg-white dark:bg-gray-900/50 text-gray-900 dark:text-white" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Saldo FGTS (opcional)</label>
                                <input type="number" min={0} step="0.01" value={saldoFgts} onChange={e => setSaldoFgts(e.target.value)} placeholder="estima 8%/mês"
                                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm bg-white dark:bg-gray-900/50 text-gray-900 dark:text-white" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Férias vencidas (dias)</label>
                                <input type="number" min={0} value={feriasVencidas} onChange={e => setFeriasVencidas(e.target.value)} placeholder="0"
                                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm bg-white dark:bg-gray-900/50 text-gray-900 dark:text-white" />
                            </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Forma de Pagamento *</label>
                                <select value={formaPagamento} onChange={e => setFormaPagamento(e.target.value)}
                                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm bg-white dark:bg-gray-900/50 text-gray-900 dark:text-white">
                                    <option value="PIX">PIX</option>
                                    <option value="Transferência">Transferência Bancária</option>
                                    <option value="Dinheiro">Dinheiro em Espécie</option>
                                    <option value="Cheque">Cheque Bancário</option>
                                    <option value="Débito em Conta">Débito em Conta</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Aviso Prévio Cumprido?</label>
                                <select value={avisoCumprido ? 'sim' : 'nao'} onChange={e => setAvisoCumprido(e.target.value === 'sim')}
                                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm bg-white dark:bg-gray-900/50 text-gray-900 dark:text-white">
                                    <option value="nao">Não (Indenizado / Descontado)</option>
                                    <option value="sim">Sim (Trabalhado)</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Descontos / Adiantamentos (R$)</label>
                                <input type="number" min={0} step="0.01" value={descontosAdicionais} onChange={e => setDescontosAdicionais(e.target.value)} placeholder="0.00"
                                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm bg-white dark:bg-gray-900/50 text-gray-900 dark:text-white" />
                            </div>
                        </div>
                        <div className="flex justify-between">
                            <button onClick={() => setPasso(1)} className="inline-flex items-center gap-2 px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl font-bold text-sm text-gray-600 dark:text-gray-300">
                                <ArrowLeft className="w-4 h-4" /> Voltar
                            </button>
                            <button onClick={simular} disabled={!tipo || !dataDemissao || calculando}
                                className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-sm disabled:opacity-50">
                                {calculando ? 'Calculando…' : 'Calcular verbas'} <ArrowRight className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                )}

                {/* PASSO 3 */}
                {passo === 3 && resultado && (
                    <div className="space-y-5">
                        <div className="flex items-center justify-between flex-wrap gap-3">
                            <div>
                                <h3 className="font-bold text-gray-900 dark:text-white">{funcionarioSel?.nome}</h3>
                                <p className="text-sm text-gray-500 dark:text-gray-400">{TIPOS.find(t => t.valor === resultado.tipo_rescisao)?.titulo} · demissão em {dataDoDia(resultado.data_demissao).toLocaleDateString('pt-BR')}</p>
                            </div>
                            {registrada && <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 rounded-lg text-xs font-bold"><CheckCircle2 className="w-4 h-4" /> Registrada</span>}
                        </div>

                        <div className="border border-gray-100 dark:border-gray-800 rounded-xl overflow-hidden">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50 dark:bg-gray-900/50 text-gray-500 dark:text-gray-400">
                                    <tr><th className="text-left px-4 py-2 font-bold uppercase text-xs">Verba</th><th className="text-left px-4 py-2 font-bold uppercase text-xs">Ref.</th><th className="text-right px-4 py-2 font-bold uppercase text-xs">Valor</th></tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                    {resultado.proventos.map(p => (
                                        <tr key={p.codigo}>
                                            <td className="px-4 py-2.5 font-semibold text-gray-800 dark:text-gray-200">{p.descricao}</td>
                                            <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400">{p.referencia}</td>
                                            <td className="px-4 py-2.5 text-right font-bold text-emerald-600 dark:text-emerald-400">{fmtMoeda(p.valor)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot className="bg-gray-50 dark:bg-gray-900/50 border-t-2 border-gray-200 dark:border-gray-700">
                                    <tr><td colSpan={2} className="px-4 py-3 font-black text-gray-700 dark:text-gray-200 uppercase text-xs">Total bruto estimado</td>
                                        <td className="px-4 py-3 text-right font-black text-lg text-gray-900 dark:text-white">{fmtMoeda(resultado.total_proventos)}</td></tr>
                                </tfoot>
                            </table>
                        </div>

                        <details className="bg-gray-50 dark:bg-gray-900/40 rounded-xl p-4">
                            <summary className="cursor-pointer font-bold text-sm text-gray-700 dark:text-gray-200 flex items-center gap-2"><FileText className="w-4 h-4" /> Memória de cálculo</summary>
                            <ul className="mt-3 space-y-1.5 text-xs text-gray-600 dark:text-gray-400 list-disc pl-5">
                                {resultado.memoria_calculo.map((m, i) => <li key={i}>{m}</li>)}
                            </ul>
                        </details>

                        <div className="flex items-start gap-3 text-xs text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 rounded-xl p-3.5 border border-emerald-200 dark:border-emerald-500/20">
                            <Wallet className="w-5 h-5 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
                            <div>
                                <span className="font-bold block text-sm text-emerald-900 dark:text-emerald-200">Impacto Financeiro Automático</span>
                                <span>Ao registrar a rescisão, o valor de <strong>{fmtMoeda(resultado.total_liquido_estimado || resultado.total_proventos)}</strong> será automaticamente lançado no módulo de <strong>Despesas (Rescisão Trabalhista)</strong> com data de vencimento em {dataDoDia(resultado.data_demissao).toLocaleDateString('pt-BR')}.</span>
                            </div>
                        </div>

                        <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 rounded-lg p-3">
                            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {resultado.aviso_legal}
                        </div>

                        <div className="flex flex-wrap justify-between gap-3">
                            <button onClick={() => setPasso(2)} className="inline-flex items-center gap-2 px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl font-bold text-sm text-gray-600 dark:text-gray-300">
                                <ArrowLeft className="w-4 h-4" /> Ajustar
                            </button>
                            <div className="flex gap-3">
                                <button onClick={exportarPDF} className="inline-flex items-center gap-2 px-4 py-2.5 bg-gray-800 dark:bg-gray-700 hover:bg-black text-white rounded-xl font-bold text-sm">
                                    <Download className="w-4 h-4" /> PDF p/ contador
                                </button>
                                {!registrada ? (
                                    <button onClick={registrar} disabled={registrando} className="inline-flex items-center gap-2 px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold text-sm disabled:opacity-50">
                                        <Save className="w-4 h-4" /> {registrando ? 'Registrando…' : 'Registrar rescisão'}
                                    </button>
                                ) : (
                                    <button onClick={reiniciar} className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-sm">
                                        Nova rescisão
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
            </>)}
        </div>
    );
}
