import { useEffect, useMemo, useState } from 'react';
import { Wallet, TrendingUp, Users, Download, ChevronLeft, ChevronRight, Search, ArrowUpDown } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import folhaService, { ProvisaoItem, ProvisoesResposta } from '../folhaService';
import { showToast } from '../../../components/elements/Toast';

/**
 * Folha & Custo Real — provisões mensais (1/12 avos de férias+1/3, 13º e FGTS)
 * que revelam o custo REAL da equipe além do salário nominal. Exporta a
 * planilha de provisões para o contador.
 */

function mesAtualISO() {
    const h = new Date();
    return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}`;
}
function mesLabel(m: string) {
    const [a, mm] = m.split('-').map(Number);
    return new Date(a, mm - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}
function deslocar(m: string, d: number) {
    const [a, mm] = m.split('-').map(Number);
    const dt = new Date(a, mm - 1 + d, 1);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}
const fmt = (n: number) => (n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function FolhaCustoReal() {
    const [mes, setMes] = useState(mesAtualISO());
    const [dados, setDados] = useState<ProvisaoItem[]>([]);
    const [resumo, setResumo] = useState<ProvisoesResposta['resumo'] | null>(null);
    const [loading, setLoading] = useState(false);
    // Filtros
    const [busca, setBusca] = useState('');
    const [cargoFiltro, setCargoFiltro] = useState('');
    const [ordemDesc, setOrdemDesc] = useState(true);

    useEffect(() => {
        const fetchDados = async () => {
            setLoading(true);
            try {
                const r = await folhaService.listarProvisoes(mes);
                setDados(r.data);
                setResumo(r.resumo);
            } catch (e: any) {
                showToast.error(e?.response?.data?.message || 'Erro ao carregar provisões');
                setDados([]);
                setResumo(null);
            } finally {
                setLoading(false);
            }
        };
        fetchDados();
    }, [mes]);

    const cargos = useMemo(() => Array.from(new Set(dados.map(d => d.cargo).filter(Boolean))) as string[], [dados]);

    const dadosFiltrados = useMemo(() => {
        let out = dados;
        if (busca.trim()) out = out.filter(d => d.funcionario_nome.toLowerCase().includes(busca.trim().toLowerCase()));
        if (cargoFiltro) out = out.filter(d => d.cargo === cargoFiltro);
        return [...out].sort((a, b) => ordemDesc ? b.custo_real - a.custo_real : a.custo_real - b.custo_real);
    }, [dados, busca, cargoFiltro, ordemDesc]);

    const exportarPDF = () => {
        if (!dadosFiltrados.length || !resumo) return;
        const dados = dadosFiltrados;
        const doc = new jsPDF();
        doc.setFillColor(31, 41, 55); doc.rect(0, 0, 210, 32, 'F');
        doc.setTextColor(255, 255, 255); doc.setFontSize(18); doc.setFont('helvetica', 'bold');
        doc.text('FOLHA & CUSTO REAL — PROVISÕES', 105, 14, { align: 'center' });
        doc.setFontSize(10); doc.setFont('helvetica', 'normal');
        doc.text(`Competência: ${mesLabel(mes)}`, 105, 24, { align: 'center' });

        autoTable(doc, {
            startY: 40,
            head: [['Funcionário', 'Salário', 'Benefícios', 'Prov. Férias', 'Prov. 13º', 'Encargos', 'Custo Real']],
            body: dados.map(d => [d.funcionario_nome, fmt(d.salario_base || 0), fmt(d.beneficios || 0), fmt(d.valor_ferias || 0), fmt(d.valor_decimo_terceiro || 0), fmt(d.encargos_provisionados || 0), fmt(d.custo_real || 0)]),
            theme: 'grid',
            headStyles: { fillColor: [31, 41, 55], textColor: [255, 255, 255], fontSize: 8 },
            styles: { fontSize: 8, cellPadding: 2 },
            columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
        });
        let y = (doc as any).lastAutoTable.finalY + 8;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(17, 24, 39);
        doc.text(`Folha nominal: ${fmt(resumo.folha_nominal)}`, 14, y);
        doc.text(`Benefícios ativos: ${fmt((resumo as any).total_beneficios || 0)}`, 14, y + 6);
        doc.text(`Provisionamento: ${fmt(resumo.provisionamento_total)}`, 14, y + 12);
        doc.text(`CUSTO REAL TOTAL: ${fmt(resumo.custo_real_total)}`, 14, y + 18);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(120, 53, 15);
        doc.text('Encargos consideram FGTS (8%). INSS patronal varia conforme o regime tributário da loja.', 14, y + 26, { maxWidth: 182 });
        doc.save(`Folha_Custo_Real_${mes}.pdf`);
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                    <div className="p-3 rounded-2xl bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400"><Wallet className="w-6 h-6" /></div>
                    <div>
                        <h2 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">Folha & Custo Real</h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400">O custo verdadeiro da equipe, com provisões de férias, 13º e encargos</p>
                    </div>
                </div>
                <button onClick={exportarPDF} disabled={!dados.length}
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-gray-800 dark:bg-gray-700 hover:bg-black text-white rounded-xl font-bold text-sm disabled:opacity-50">
                    <Download className="w-4 h-4" /> Exportar p/ contador
                </button>
            </div>

            {/* Seletor de mês */}
            <div className="flex items-center justify-center gap-4 bg-gray-50 dark:bg-gray-900/50 rounded-xl py-2 px-3 border border-gray-100 dark:border-gray-800 w-fit">
                <button onClick={() => setMes(m => deslocar(m, -1))} className="p-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700"><ChevronLeft className="w-4 h-4 text-gray-600 dark:text-gray-300" /></button>
                <span className="text-sm font-bold text-gray-800 dark:text-gray-200 capitalize min-w-[150px] text-center">{mesLabel(mes)}</span>
                <button onClick={() => setMes(m => deslocar(m, 1))} disabled={mes >= mesAtualISO()} className="p-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-30"><ChevronRight className="w-4 h-4 text-gray-600 dark:text-gray-300" /></button>
            </div>

            {/* Filtros */}
            <div className="flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-[200px]">
                    <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por nome…"
                        className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm bg-white dark:bg-gray-900/50 text-gray-900 dark:text-white" />
                </div>
                <select value={cargoFiltro} onChange={e => setCargoFiltro(e.target.value)}
                    className="px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm bg-white dark:bg-gray-900/50 text-gray-900 dark:text-white">
                    <option value="">Todos os cargos</option>
                    {cargos.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <button onClick={() => setOrdemDesc(o => !o)}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-600 dark:text-gray-300">
                    <ArrowUpDown className="w-4 h-4" /> Custo {ordemDesc ? '↓' : '↑'}
                </button>
            </div>

            {/* Cards de resumo */}
            {resumo && (
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                    <div className="p-5 rounded-2xl bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20">
                        <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 mb-1"><Users className="w-4 h-4" /><p className="text-xs font-bold uppercase tracking-wider">Folha Nominal</p></div>
                        <p className="text-2xl font-black text-blue-700 dark:text-blue-300">{fmt(resumo.folha_nominal)}</p>
                        <p className="text-xs text-blue-500/70 mt-1">{resumo.funcionarios} funcionários</p>
                    </div>
                    <div className="p-5 rounded-2xl bg-purple-50 dark:bg-purple-500/10 border border-purple-100 dark:border-purple-500/20">
                        <div className="flex items-center gap-2 text-purple-600 dark:text-purple-400 mb-1"><TrendingUp className="w-4 h-4" /><p className="text-xs font-bold uppercase tracking-wider">Benefícios</p></div>
                        <p className="text-2xl font-black text-purple-700 dark:text-purple-300">{fmt((resumo as any).total_beneficios || 0)}</p>
                        <p className="text-xs text-purple-500/70 mt-1">VT, VR, VA, etc.</p>
                    </div>
                    <div className="p-5 rounded-2xl bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/20">
                        <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 mb-1"><TrendingUp className="w-4 h-4" /><p className="text-xs font-bold uppercase tracking-wider">Provisionamento</p></div>
                        <p className="text-2xl font-black text-amber-700 dark:text-amber-300">{fmt(resumo.provisionamento_total)}</p>
                        <p className="text-xs text-amber-500/70 mt-1">férias + 13º + FGTS</p>
                    </div>
                    <div className="p-5 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20">
                        <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 mb-1"><Wallet className="w-4 h-4" /><p className="text-xs font-bold uppercase tracking-wider">Custo Real Total</p></div>
                        <p className="text-2xl font-black text-emerald-700 dark:text-emerald-300">{fmt(resumo.custo_real_total)}</p>
                        <p className="text-xs text-emerald-500/70 mt-1">custo real da equipe</p>
                    </div>
                </div>
            )}

            {/* Tabela */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700/50 overflow-hidden">
                {loading ? (
                    <div className="py-12 text-center text-gray-500 text-sm dark:text-gray-400">Carregando provisões…</div>
                ) : dadosFiltrados.length === 0 ? (
                    <div className="py-12 text-center text-gray-500 text-sm dark:text-gray-400">Nenhum funcionário encontrado com os filtros atuais</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50/50 dark:bg-gray-900/50 text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                                <tr>
                                    <th className="text-left px-4 py-3 font-bold uppercase text-xs">Funcionário</th>
                                    <th className="text-right px-4 py-3 font-bold uppercase text-xs">Salário</th>
                                    <th className="text-right px-4 py-3 font-bold uppercase text-xs">Benefícios</th>
                                    <th className="text-right px-4 py-3 font-bold uppercase text-xs">Prov. Férias</th>
                                    <th className="text-right px-4 py-3 font-bold uppercase text-xs">Prov. 13º</th>
                                    <th className="text-right px-4 py-3 font-bold uppercase text-xs">Encargos</th>
                                    <th className="text-right px-4 py-3 font-bold uppercase text-xs">Custo Real</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                {dadosFiltrados.map(d => (
                                    <tr key={d.funcionario_id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/60">
                                        <td className="px-4 py-3 font-semibold text-gray-900 dark:text-white">{d.funcionario_nome}{d.cargo ? <span className="block text-xs font-normal text-gray-400">{d.cargo}</span> : null}</td>
                                        <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-300">{fmt(d.salario_base)}</td>
                                        <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-300">{fmt((d as any).beneficios)}</td>
                                        <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-300">{fmt(d.valor_ferias)}</td>
                                        <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-300">{fmt(d.valor_decimo_terceiro)}</td>
                                        <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-300">{fmt(d.encargos_provisionados)}</td>
                                        <td className="px-4 py-3 text-right font-black text-emerald-600 dark:text-emerald-400">{fmt(d.custo_real)}</td>
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
