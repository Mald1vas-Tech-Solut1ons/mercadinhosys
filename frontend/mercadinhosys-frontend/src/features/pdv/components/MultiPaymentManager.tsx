import React, { useState } from 'react';
import { CreditCard, DollarSign, Smartphone, Trash2, Plus, Tag } from 'lucide-react';
import { formatCurrency } from '../../../utils/formatters';
import { showToast } from '../../../utils/toast';
import { confirmar } from '../../../components/ui/Confirmacao';

/** "1.234,56" / "1234,56" / "1234.56" / "50" → número (NaN se inválido). */
const parseValorBR = (texto: string): number => {
    const t = texto.replace(/[R$\s]/g, '');
    if (!t) return NaN;
    const normalizado = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
    return parseFloat(normalizado);
};

const arred = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

export interface PagamentoItem {
    id: string;
    forma: string;
    valor: number;
    bandeira?: string;
}

/** Conferência feita no overlay de PIX/maquininha, mostrada no resumo do pagamento. */
interface ConferenciaRecebimento {
    forma: string;
    valor: number;
    comprovante?: string;
    conferido: boolean;
}

interface MultiPaymentManagerProps {
    totalVenda: number;
    formasDisponiveis: any[];
    pagamentosatuais: PagamentoItem[];
    onAdicionar: (forma: string, valor: number, bandeira?: string) => void;
    onRemover: (id: string) => void;
    onFinalizar?: () => void;
}

const MultiPaymentManager: React.FC<MultiPaymentManagerProps> = ({
    totalVenda,
    formasDisponiveis,
    pagamentosatuais,
    onAdicionar,
    onRemover
}) => {
    const [valorInput, setValorInput] = useState<string>('');
    const [formaSelecionada, setFormaSelecionada] = useState<string>('dinheiro');

    const totalPago = pagamentosatuais.reduce((sum, p) => sum + p.valor, 0);
    const faltante = Math.max(0, totalVenda - totalPago);

    const [pixData, setPixData] = useState<{qr_code: string, txid: string, valor: number} | null>(null);
    const [tefData, setTefData] = useState<{status: string, mensagem: string, valor: number, tipo: string} | null>(null);

    // Conferência do recebimento (PIX/maquininha). O operador digita o comprovante
    // quando o cliente mostra e marca que viu o dinheiro cair. Sem a marcação a
    // venda NÃO é bloqueada: pedimos confirmação explícita e registramos a falta
    // de conferência — parar o balcão é pior do que registrar com aviso.
    const [comprovante, setComprovante] = useState<string>('');
    const [conferido, setConferido] = useState<boolean>(true);
    const [conferencias, setConferencias] = useState<ConferenciaRecebimento[]>([]);

    /** Reinicia os campos de conferência a cada novo overlay de PIX/maquininha. */
    const abrirConferencia = () => {
        setComprovante('');
        setConferido(true);
    };

    /**
     * Fecha a confirmação de um PIX/cartão. Devolve false se o operador desistiu.
     * Sem "Conferi o recebimento" exige um segundo aceite explícito.
     */
    const confirmarRecebimento = async (forma: string, valor: number): Promise<boolean> => {
        if (!conferido) {
            const ok = await confirmar({
                titulo: 'Recebimento não conferido',
                mensagem: `Você não marcou "Conferi o recebimento" de ${formatCurrency(valor)}.\n\nSe confirmar agora, a venda é registrada mesmo que o dinheiro não tenha entrado na conta.`,
                acao: 'Registrar sem conferir',
                cancelar: 'Voltar e conferir',
                perigo: true,
            });
            if (!ok) return false;
        }
        const numero = comprovante.trim();
        // Guarda a conferência localmente para mostrar no resumo (o payload do
        // pagamento ainda não tem campo próprio para comprovante/NSU).
        setConferencias((anteriores) => [
            ...anteriores,
            { forma, valor, comprovante: numero || undefined, conferido },
        ]);
        setComprovante('');
        setConferido(true);
        return true;
    };

    // Liga cada pagamento já lançado à conferência feita no overlay (forma + valor).
    // Dois PIX de mesmo valor são casados em ordem, um para cada confirmação.
    const conferenciasPorPagamento = (() => {
        const usados = new Set<number>();
        const mapa = new Map<string, ConferenciaRecebimento>();
        pagamentosatuais.forEach((p) => {
            const i = conferencias.findIndex((c, idx) =>
                !usados.has(idx) && c.forma === p.forma && Math.abs(c.valor - p.valor) < 0.005);
            if (i >= 0) {
                usados.add(i);
                mapa.set(p.id, conferencias[i]);
            }
        });
        return mapa;
    })();

    /** Remove o pagamento levando junto a conferência (senão um novo PIX do mesmo valor herda o comprovante antigo). */
    const removerPagamento = (p: PagamentoItem) => {
        const alvo = conferenciasPorPagamento.get(p.id);
        if (alvo) setConferencias((anteriores) => anteriores.filter((c) => c !== alvo));
        onRemover(p.id);
    };

    // Só forma com permite_troco (dinheiro) aceita valor acima do faltante;
    // PIX/cartão/vale/fiado são limitados ao que falta — não geram troco.
    const permiteTroco = (tipo: string) => {
        const forma = formasDisponiveis.find(f => f.tipo === tipo);
        return forma ? Boolean(forma.permite_troco) : tipo === 'dinheiro';
    };

    const handleAdicionar = async () => {
        const digitado = parseValorBR(valorInput);
        if (valorInput.trim() && (!Number.isFinite(digitado) || digitado <= 0)) {
            showToast.error('Valor inválido. Use, por exemplo, 50 ou 50,00.');
            return;
        }
        let valor = arred(Number.isFinite(digitado) && digitado > 0 ? digitado : faltante);
        if (valor <= 0) return;
        if (!permiteTroco(formaSelecionada) && valor > faltante + 0.001) {
            if (faltante <= 0) {
                showToast.warning('A venda já está paga. Remova um pagamento para trocar a forma.');
                return;
            }
            valor = arred(faltante);
            showToast.info(`Esta forma não dá troco: valor ajustado para ${formatCurrency(valor)}.`);
        }

        if (formaSelecionada === 'pix') {
             // Fluxo manual para PIX
             abrirConferencia();
             setPixData({ qr_code: '', txid: '', valor });
        } else if (formaSelecionada === 'cartao_credito' || formaSelecionada === 'cartao_debito') {
             // Fluxo manual para maquininha avulsa (POS Standalone)
             abrirConferencia();
             setTefData({ status: 'aguardando', mensagem: 'Maquininha Avulsa', valor, tipo: formaSelecionada });
        } else {
            onAdicionar(formaSelecionada, valor);
        }
        
        setValorInput('');
    };

    const renderIcon = (tipo: string) => {
        switch (tipo) {
            case 'dinheiro': return <DollarSign className="w-5 h-5" />;
            case 'cartao_credito':
            case 'cartao_debito': return <CreditCard className="w-5 h-5" />;
            case 'pix': return <Smartphone className="w-5 h-5" />;
            default: return <Tag className="w-5 h-5" />;
        }
    };

    return (
        <div className="flex flex-col gap-4 relative">
            {/* OVERLAYS DE PAGAMENTO DINÂMICO */}
            {pixData && (
                <div className="absolute inset-0 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm z-10 flex flex-col items-center justify-center rounded-2xl border border-slate-200 p-4 text-center overflow-y-auto dark:border-gray-700">
                    <h3 className="text-lg font-black text-slate-800 dark:text-slate-100 mb-2">Pagamento via PIX</h3>
                    <Smartphone className="w-12 h-12 text-blue-500 mb-3" />
                    <p className="text-sm font-bold text-slate-600 dark:text-slate-300 mb-4">
                        Verifique o recebimento de <strong className="text-blue-600 text-lg">{formatCurrency(pixData.valor)}</strong> na sua conta.
                    </p>

                    {/* Conferência do recebimento: comprovante é opcional, o aceite é obrigatório */}
                    <div className="w-full mb-3">
                        <label htmlFor="pix-comprovante" className="block text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                            Nº do comprovante (opcional)
                        </label>
                        <input
                            id="pix-comprovante"
                            type="text"
                            inputMode="text"
                            maxLength={40}
                            autoComplete="off"
                            value={comprovante}
                            onChange={(e) => setComprovante(e.target.value)}
                            placeholder="Ex.: E123456789"
                            className="w-full px-3 py-2 bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-xl text-sm font-bold text-slate-700 dark:text-slate-100 focus:border-blue-600 outline-none"
                        />
                        <label className="flex items-center justify-center gap-2 mt-3 text-xs font-bold text-slate-600 dark:text-slate-300 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={conferido}
                                onChange={(e) => setConferido(e.target.checked)}
                                className="w-4 h-4 accent-green-600"
                            />
                            Conferi o recebimento
                        </label>
                    </div>

                    <p className="text-[11px] font-bold text-amber-700 dark:text-amber-400 mb-3 leading-snug">
                        Confirme só depois de ver o dinheiro na conta. Pagamento confirmado sem conferir não aparece no caixa.
                    </p>

                    <div className="flex gap-3">
                        <button 
                            onClick={async () => {
                                if (!(await confirmarRecebimento('pix', pixData.valor))) return;
                                onAdicionar('pix', pixData.valor);
                                setPixData(null);
                            }} 
                            className="px-4 py-3 bg-green-500 hover:bg-green-600 text-white rounded-xl text-sm font-bold uppercase transition-all shadow-lg shadow-green-500/30">
                            Confirmar Pagamento
                        </button>
                        <button 
                            onClick={() => { setPixData(null); abrirConferencia(); }} 
                            className="px-4 py-3 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl text-sm font-bold uppercase hover:bg-slate-300 dark:hover:bg-slate-600 transition-all">
                            Cancelar
                        </button>
                    </div>
                </div>
            )}

            
            {tefData && (
                <div className="absolute inset-0 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm z-10 flex flex-col items-center justify-center rounded-2xl border border-slate-200 p-4 text-center overflow-y-auto dark:border-gray-700">
                    <h3 className="text-lg font-black text-slate-800 dark:text-slate-100 mb-2">Maquininha de Cartão</h3>
                    <CreditCard className="w-12 h-12 text-slate-500 mb-3 dark:text-gray-400" />
                    <p className="text-sm font-bold text-slate-600 dark:text-slate-300 mb-4">
                        Passe o valor de <strong className="text-blue-600 text-lg">{formatCurrency(tefData.valor)}</strong> na sua maquininha.
                    </p>

                    {/* Conferência da aprovação: NSU é opcional, o aceite é obrigatório */}
                    <div className="w-full mb-3">
                        <label htmlFor="cartao-autorizacao" className="block text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                            Nº da autorização / NSU (opcional)
                        </label>
                        <input
                            id="cartao-autorizacao"
                            type="text"
                            inputMode="numeric"
                            maxLength={20}
                            autoComplete="off"
                            value={comprovante}
                            onChange={(e) => setComprovante(e.target.value)}
                            placeholder="Ex.: 001234"
                            className="w-full px-3 py-2 bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-xl text-sm font-bold text-slate-700 dark:text-slate-100 focus:border-blue-600 outline-none"
                        />
                        <label className="flex items-center justify-center gap-2 mt-3 text-xs font-bold text-slate-600 dark:text-slate-300 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={conferido}
                                onChange={(e) => setConferido(e.target.checked)}
                                className="w-4 h-4 accent-green-600"
                            />
                            Conferi o recebimento
                        </label>
                    </div>

                    <p className="text-[11px] font-bold text-amber-700 dark:text-amber-400 mb-3 leading-snug">
                        Confirme só depois de ver a aprovação na maquininha. Pagamento confirmado sem conferir não aparece no caixa.
                    </p>

                    <div className="flex gap-3">
                        <button 
                            onClick={async () => {
                                if (!(await confirmarRecebimento(tefData.tipo, tefData.valor))) return;
                                onAdicionar(tefData.tipo, tefData.valor);
                                setTefData(null);
                            }} 
                            className="px-4 py-3 bg-green-500 hover:bg-green-600 text-white rounded-xl text-sm font-bold uppercase transition-all shadow-lg shadow-green-500/30">
                            Confirmar Pagamento
                        </button>
                        <button 
                            onClick={() => { setTefData(null); abrirConferencia(); }} 
                            className="px-4 py-3 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl text-sm font-bold uppercase hover:bg-slate-300 dark:hover:bg-slate-600 transition-all">
                            Cancelar
                        </button>
                    </div>
                </div>
            )}


            {/* 📊 RESUMO DE PAGAMENTO */}
            <div className="grid grid-cols-2 gap-3 mb-2">
                <div className="bg-slate-100 dark:bg-slate-800 p-3 rounded-2xl border border-slate-200 dark:border-slate-700">
                    <span className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Total Pago</span>
                    <span className="text-xl font-black text-blue-600 dark:text-blue-400 tabular-nums">
                        {formatCurrency(totalPago)}
                    </span>
                </div>
                <div className="bg-slate-100 dark:bg-slate-800 p-3 rounded-2xl border border-slate-200 dark:border-slate-700">
                    <span className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Faltante</span>
                    <span className={`text-xl font-black tabular-nums ${faltante > 0 ? 'text-red-500' : 'text-green-500'}`}>
                        {formatCurrency(faltante)}
                    </span>
                </div>
            </div>

            {/* 💸 SELEÇÃO DE FORMA */}
            <div className="grid grid-cols-4 gap-2">
                {formasDisponiveis.map((forma) => (
                    <button
                        key={forma.tipo}
                        onClick={() => setFormaSelecionada(forma.tipo)}
                        className={`p-3 rounded-xl border-2 flex flex-col items-center gap-1 transition-all ${formaSelecionada === forma.tipo
                            ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/20 text-blue-600'
                            : 'border-transparent bg-slate-100 dark:bg-slate-800 text-slate-500'
                            }`}
                    >
                        {renderIcon(forma.tipo)}
                        <span className="text-[11px] font-black uppercase tracking-tight leading-tight text-center">{forma.label}</span>
                    </button>
                ))}
            </div>

            {/* ⌨️ INPUT DE VALOR */}
            <div className="flex gap-2">
                <div className="flex-1 relative">
                    <input
                        type="text"
                        inputMode="decimal"
                        enterKeyHint="done"
                        aria-label="Valor recebido"
                        value={valorInput}
                        onChange={(e) => setValorInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); handleAdicionar(); }
                        }}
                        placeholder={`Restante: ${faltante.toFixed(2).replace('.', ',')}`}
                        className="w-full p-4 bg-white dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-800 rounded-2xl text-lg font-bold focus:border-blue-600 outline-none transition-all"
                    />
                    <button
                        onClick={() => setValorInput(faltante.toFixed(2).replace('.', ','))}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-[10px] font-black uppercase text-blue-600 hover:bg-blue-50 rounded-lg"
                    >
                        Total
                    </button>
                </div>
                <button
                    onClick={handleAdicionar}
                    aria-label="Adicionar pagamento"
                    disabled={faltante <= 0 && valorInput === ''}
                    className="px-6 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-black uppercase text-xs tracking-widest transition-all disabled:opacity-50 disabled:bg-slate-400 shadow-lg shadow-blue-500/20"
                >
                    <Plus className="w-5 h-5 mx-auto" />
                </button>
            </div>

            {/* 📜 LISTA DE PAGAMENTOS ADICIOANDOS */}
            <div className="mt-2 space-y-2 max-h-[150px] overflow-y-auto custom-scrollbar">
                {pagamentosatuais.length === 0 ? (
                    <div className="py-8 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-3xl opacity-40">
                        <p className="text-xs font-bold uppercase tracking-widest">Nenhum pagamento adicionado</p>
                    </div>
                ) : (
                    pagamentosatuais.map((p) => (
                        <div key={p.id} className="flex items-center justify-between p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm">
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="p-2 bg-slate-100 dark:bg-slate-800 rounded-lg text-slate-600 dark:text-slate-300">
                                    {renderIcon(p.forma)}
                                </div>
                                <div className="min-w-0">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                        {formasDisponiveis.find(f => f.tipo === p.forma)?.label || p.forma}
                                    </p>
                                    <p className="text-sm font-black text-slate-700 dark:text-slate-200">
                                        {formatCurrency(p.valor)}
                                    </p>
                                    {conferenciasPorPagamento.get(p.id)?.comprovante && (
                                        <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 break-all">
                                            Comprovante: {conferenciasPorPagamento.get(p.id)?.comprovante}
                                        </p>
                                    )}
                                    {/* Lembrete discreto: o valor só é receita quando aparece no extrato */}
                                    {p.forma === 'pix' && (
                                        <p className="text-[10px] text-blue-600 dark:text-blue-400">
                                            PIX confirmado — confira no extrato do dia
                                        </p>
                                    )}
                                    {conferenciasPorPagamento.get(p.id)?.conferido === false && (
                                        <p className="text-[10px] font-bold text-amber-600 dark:text-amber-400">
                                            Registrado sem conferência
                                        </p>
                                    )}
                                </div>
                            </div>
                            <button
                                onClick={() => removerPagamento(p)}
                                className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-all"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};

export default MultiPaymentManager;
