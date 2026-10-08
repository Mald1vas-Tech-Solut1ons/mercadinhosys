import { useState, useEffect } from 'react';
import { Download, Printer, Clock } from 'lucide-react';
import ResponsiveModal from '../../../components/ui/ResponsiveModal';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatCurrency, formatDate } from '../../../utils/formatters';
import { apiClient } from '../../../api/apiClient';
import type { HoleriteBreakdown } from '../folhaService';

/**
 * Demonstrativo de pagamento — exibe o holerite JÁ CALCULADO no backend
 * (proventos/descontos/líquido lendo a ConfiguracaoFolha). Nenhum cálculo
 * de folha acontece aqui: o front apenas apresenta e gera o PDF.
 */

interface HoleriteModalProps {
    isOpen: boolean;
    onClose: () => void;
    holerite: HoleriteBreakdown;
}

interface Estabelecimento {
    razao_social: string; cnpj: string; logradouro: string; numero: string;
    bairro: string; cidade: string; estado: string; complemento?: string; inscricao_estadual?: string;
}

const HoleriteModal = ({ isOpen, onClose, holerite }: HoleriteModalProps) => {
    const [estabelecimento, setEstabelecimento] = useState<Estabelecimento | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        apiClient.get('/configuracao/estabelecimento')
            .then(res => setEstabelecimento(res.data.estabelecimento))
            .catch(() => { });
    }, [isOpen]);

    const periodo = holerite.mes_referencia;
    const t = holerite.totais;

    const handlePrint = () => window.print();

    const handleDownloadPDF = () => {
        const doc = new jsPDF();
        const MARGIN_X = 20;

        doc.setFillColor(31, 41, 55);
        doc.rect(0, 0, 210, 45, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(22); doc.setFont('helvetica', 'bold');
        doc.text('RECIBO DE PAGAMENTO', 105, 25, { align: 'center' });
        doc.setFontSize(11); doc.setFont('helvetica', 'normal');
        doc.text(`DEMONSTRATIVO MENSAL • REFERÊNCIA: ${periodo}`, 105, 35, { align: 'center' });

        let y = 60;
        doc.setTextColor(17, 24, 39); doc.setFontSize(14); doc.setFont('helvetica', 'bold');
        doc.text(estabelecimento?.razao_social || 'MERCADINHOSYS', MARGIN_X, y);
        doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(75, 85, 99);
        doc.text(`CNPJ: ${estabelecimento?.cnpj || '—'}`, MARGIN_X, y + 7);
        y += 20;

        doc.setTextColor(17, 24, 39); doc.setFontSize(10); doc.setFont('helvetica', 'bold');
        doc.text(`COLABORADOR: ${holerite.nome.toUpperCase()}`, MARGIN_X, y);
        doc.setFont('helvetica', 'normal');
        doc.text(`CPF: ${holerite.cpf || '—'}`, MARGIN_X, y + 6);
        doc.text(`CARGO: ${holerite.cargo}`, 110, y);
        doc.text(`ADMISSÃO: ${holerite.data_admissao ? formatDate(holerite.data_admissao) : '—'}`, 110, y + 6);
        y += 16;

        const body = [
            ...holerite.vencimentos.map(v => [v.descricao, v.referencia, formatCurrency(v.valor), '']),
            ...holerite.descontos.map(d => [d.descricao, d.referencia, '', formatCurrency(d.valor)]),
        ];
        autoTable(doc, {
            startY: y,
            head: [['DESCRIÇÃO', 'REF', 'VENCIMENTOS', 'DESCONTOS']],
            body,
            theme: 'grid',
            headStyles: { fillColor: [31, 41, 55], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9 },
            styles: { fontSize: 9, cellPadding: 4 },
            columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' } },
        });
        let fy = (doc as any).lastAutoTable.finalY + 10;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
        doc.text(`TOTAL VENCIMENTOS: ${formatCurrency(t.vencimentos)}`, 196, fy, { align: 'right' });
        doc.setTextColor(220, 38, 38);
        doc.text(`TOTAL DESCONTOS: ${formatCurrency(t.descontos)}`, 196, fy + 6, { align: 'right' });
        doc.setTextColor(17, 24, 39); doc.setFontSize(13);
        doc.text(`LÍQUIDO A RECEBER: ${formatCurrency(t.liquido)}`, 196, fy + 15, { align: 'right' });
        doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(120, 130, 140);
        doc.text(`FGTS do mês (informativo): ${formatCurrency(t.fgts_mes)}`, MARGIN_X, fy + 15);

        doc.save(`Holerite_${holerite.nome.split(' ')[0]}_${periodo}.pdf`);
    };

    return (
        <ResponsiveModal
            isOpen={isOpen}
            onClose={onClose}
            title="Demonstrativo de Pagamento"
            subtitle={`Referência: ${periodo}`}
            headerIcon={<Clock className="w-6 h-6" />}
            headerColor="indigo"
            size="xl"
            footer={
                <div className="flex w-full gap-3 sm:justify-end">
                    <button onClick={handlePrint} className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-3 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-100 border-2 border-gray-200 dark:border-gray-700 rounded-xl font-bold hover:bg-gray-50 dark:hover:bg-gray-700">
                        <Printer className="w-5 h-5" /> Imprimir
                    </button>
                    <button onClick={handleDownloadPDF} className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-3 bg-gray-900 dark:bg-indigo-600 text-white rounded-xl font-bold hover:bg-black dark:hover:bg-indigo-700 shadow-xl">
                        <Download className="w-5 h-5" /> Download PDF
                    </button>
                </div>
            }
        >
            <div className="space-y-6 p-2 max-w-4xl mx-auto dark:text-gray-100">
                {/* Cabeçalho */}
                <div className="flex flex-col sm:flex-row sm:items-end justify-between border-b-2 border-gray-200 dark:border-gray-800 pb-5 gap-4">
                    <div className="flex items-center gap-4">
                        <div className="w-16 h-16 bg-linear-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center font-black text-3xl text-white shadow-lg">MS</div>
                        <div>
                            <h2 className="text-2xl font-black text-gray-900 dark:text-white leading-none">{estabelecimento?.razao_social || 'MercadinhoSys'}</h2>
                            <p className="text-xs text-indigo-600 dark:text-indigo-400 font-bold uppercase tracking-widest mt-1">Contracheque · {periodo}</p>
                        </div>
                    </div>
                    <div className="sm:text-right">
                        <p className="text-xs text-gray-500 dark:text-gray-400 font-bold uppercase">Colaborador</p>
                        <p className="text-lg font-black text-gray-900 dark:text-white">{holerite.nome}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{holerite.cargo}</p>
                    </div>
                </div>

                {/* Tabela de lançamentos */}
                <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700">
                                <th className="px-5 py-3 text-xs font-bold uppercase tracking-widest">Descrição</th>
                                <th className="px-4 py-3 text-xs font-bold uppercase tracking-widest text-center">Ref.</th>
                                <th className="px-5 py-3 text-xs font-bold uppercase tracking-widest text-right">Vencimentos</th>
                                <th className="px-5 py-3 text-xs font-bold uppercase tracking-widest text-right">Descontos</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
                            {holerite.vencimentos.map((v, i) => (
                                <tr key={`v-${i}`} className="text-sm">
                                    <td className="px-5 py-3 font-bold text-gray-900 dark:text-gray-200">{v.descricao}</td>
                                    <td className="px-4 py-3 text-center text-gray-500 dark:text-gray-400">{v.referencia}</td>
                                    <td className="px-5 py-3 text-right font-black text-emerald-600 dark:text-emerald-400">{formatCurrency(v.valor)}</td>
                                    <td className="px-5 py-3 text-right text-gray-300 dark:text-gray-700">—</td>
                                </tr>
                            ))}
                            {holerite.descontos.map((d, i) => (
                                <tr key={`d-${i}`} className="text-sm">
                                    <td className="px-5 py-3 font-bold text-gray-900 dark:text-gray-200">{d.descricao}</td>
                                    <td className="px-4 py-3 text-center text-gray-500 dark:text-gray-400">{d.referencia}</td>
                                    <td className="px-5 py-3 text-right text-gray-300 dark:text-gray-700">—</td>
                                    <td className="px-5 py-3 text-right font-black text-rose-600 dark:text-rose-400">{formatCurrency(d.valor)}</td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot className="bg-gray-50 dark:bg-gray-800 border-t-2 border-gray-200 dark:border-gray-700">
                            <tr className="font-bold text-gray-700 dark:text-gray-300 uppercase text-xs">
                                <td colSpan={2} className="px-5 py-4 text-right">Totalizadores</td>
                                <td className="px-5 py-4 text-right text-emerald-700 dark:text-emerald-400 text-base font-black">{formatCurrency(t.vencimentos)}</td>
                                <td className="px-5 py-4 text-right text-rose-600 dark:text-rose-400 text-base font-black">{formatCurrency(t.descontos)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>

                {/* Líquido + bases */}
                <div className="flex flex-col md:flex-row items-stretch gap-6">
                    <div className="flex-1 bg-white dark:bg-gray-900 p-6 rounded-3xl border border-gray-200 dark:border-gray-800 space-y-3">
                        <p className="text-[10px] text-gray-500 dark:text-gray-400 font-bold uppercase tracking-widest">Bases de cálculo</p>
                        <div className="flex justify-between text-sm border-b border-gray-100 dark:border-gray-800 pb-2">
                            <span className="text-gray-600 dark:text-gray-400">Base INSS</span>
                            <span className="font-bold text-gray-900 dark:text-white">{formatCurrency(t.base_inss)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-600 dark:text-gray-400">FGTS do mês (8%)</span>
                            <span className="font-black text-indigo-600 dark:text-indigo-400">{formatCurrency(t.fgts_mes)}</span>
                        </div>
                    </div>
                    <div className="flex-[1.4] bg-indigo-600 dark:bg-indigo-950 p-6 rounded-3xl text-white flex flex-col justify-center shadow-xl">
                        <p className="text-xs font-bold uppercase tracking-widest text-indigo-100 dark:text-indigo-300 mb-2">Líquido a Receber</p>
                        <div className="flex items-baseline gap-2">
                            <span className="text-2xl font-black text-indigo-200">R$</span>
                            <span className="text-5xl font-black tracking-tight">{formatCurrency(t.liquido).replace('R$', '').trim()}</span>
                        </div>
                    </div>
                </div>

                {holerite.memoria_calculo?.length > 0 && (
                    <details className="bg-gray-50 dark:bg-gray-900/40 rounded-xl p-4">
                        <summary className="cursor-pointer font-bold text-sm text-gray-700 dark:text-gray-200">Memória de cálculo</summary>
                        <ul className="mt-3 space-y-1.5 text-xs text-gray-600 dark:text-gray-400 list-disc pl-5">
                            {holerite.memoria_calculo.map((m, i) => <li key={i}>{m}</li>)}
                        </ul>
                    </details>
                )}
            </div>
        </ResponsiveModal>
    );
};

export default HoleriteModal;
