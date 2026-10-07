import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { showToast } from '../../../utils/toast';
import { pdvService, CaixaPDV } from '../pdvService';
import {
    Lock, Unlock, DollarSign, ArrowDownCircle, ArrowUpCircle, X,
    History, TrendingDown, TrendingUp, AlertTriangle, BarChart3,
    RefreshCw, Wallet
} from 'lucide-react';
import { formatCurrency } from '../../../utils/formatters';
import { useBodyScrollLock } from '../../../hooks/useBodyScrollLock';
import PinDialog from '../../../components/modals/PinDialog';

interface CaixaManagerProps {
    caixaAtual: CaixaPDV | null;
    setCaixaAtual: (caixa: CaixaPDV | null) => void;
    isOpen: boolean;
    onClose: () => void;
}

const FORMA_LABELS: Record<string, { label: string; emoji: string; color: string }> = {
    dinheiro: { label: 'Dinheiro', emoji: '💵', color: 'text-green-600' },
    cartao_debito: { label: 'Débito', emoji: '💳', color: 'text-blue-600' },
    cartao_credito: { label: 'Crédito', emoji: '💳', color: 'text-purple-600' },
    pix: { label: 'PIX', emoji: '📱', color: 'text-teal-600' },
    fiado: { label: 'Fiado', emoji: '🤝', color: 'text-orange-600' },
    outros: { label: 'Outros', emoji: '📦', color: 'text-gray-400 dark:text-slate-500' },
};

const CaixaManager: React.FC<CaixaManagerProps> = ({ caixaAtual, setCaixaAtual, isOpen, onClose }) => {
    const [loading, setLoading] = useState(false);
    const [saldoInicial, setSaldoInicial] = useState('');
    const [valorFechamento, setValorFechamento] = useState('');
    const [valorMovimentacao, setValorMovimentacao] = useState('');
    const [descricaoMovimentacao, setDescricaoMovimentacao] = useState('');
    const [activeTab, setActiveTab] = useState<'movimentacao' | 'fechar' | 'auditoria'>('movimentacao');
    const [tipoMovimentacao, setTipoMovimentacao] = useState<'sangria' | 'suprimento'>('sangria');
    const [movimentacoes, setMovimentacoes] = useState<any[]>([]);
    const [loadingAuditoria, setLoadingAuditoria] = useState(false);
    const [resumoCaixa, setResumoCaixa] = useState<any>(null);
    const [loadingResumo, setLoadingResumo] = useState(false);
    const [pinSangriaOpen, setPinSangriaOpen] = useState(false);

    useEffect(() => {
        if (activeTab === 'auditoria' && caixaAtual) carregarAuditoria();
        if (activeTab === 'fechar' && caixaAtual) carregarResumoCaixa();
    }, [activeTab, caixaAtual]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        if (isOpen || !caixaAtual) window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, caixaAtual, onClose]);

    useBodyScrollLock(isOpen);

    if (!caixaAtual && !isOpen) return null;
    if (!isOpen && caixaAtual) return null;

    const carregarAuditoria = async () => {
        try { setLoadingAuditoria(true); setMovimentacoes(await pdvService.getMovimentacoesCaixa()); }
        catch (e) { console.error(e); } finally { setLoadingAuditoria(false); }
    };

    const carregarResumoCaixa = async () => {
        try { setLoadingResumo(true); setResumoCaixa(await pdvService.getResumoCaixa()); }
        catch (e) { console.error(e); } finally { setLoadingResumo(false); }
    };

    const handleAbertura = async (e: React.FormEvent) => {
        e.preventDefault();
        const val = parseFloat(saldoInicial.replace(',', '.'));
        if (isNaN(val) || val < 0) return showToast.error('Informe um valor de abertura válido.');
        try {
            setLoading(true);
            setCaixaAtual(await pdvService.abrirCaixa(val));
            showToast.success('Caixa aberto com sucesso!');
            onClose();
        } catch (err: any) {
            showToast.error(err.response?.data?.error || 'Erro ao abrir caixa');
        } finally { setLoading(false); }
    };

    const imprimirRelatorioCaixa = (resumo: any, caixa: any, valorContado: number) => {
        const fmt = (v: number) => `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`;
        const agora = new Date().toLocaleString('pt-BR');
        const formas: Record<string, string> = {
            dinheiro: 'Dinheiro', cartao_debito: 'Cartao Debito', cartao_credito: 'Cartao Credito',
            pix: 'PIX', fiado: 'Fiado', outros: 'Outros',
        };
        const linhasForma = Object.entries(resumo?.por_forma_pagamento || {})
            .map(([f, d]: any) => `<tr><td>${formas[f] || f}</td><td>${d.quantidade}</td><td style="text-align:right">${fmt(d.total)}</td></tr>`)
            .join('');

        const diferenca = valorContado - (resumo?.saldo_esperado_gaveta || 0);
        const difCor = diferenca >= 0 ? '#16a34a' : '#dc2626';

        const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Relatorio de Caixa</title>
<style>
  body{font-family:Arial,sans-serif;margin:0;padding:20px;font-size:13px}
  h1{font-size:16px;font-weight:900;margin:0 0 4px}
  h2{font-size:13px;color:#475569;font-weight:600;margin:0 0 16px}
  table{width:100%;border-collapse:collapse;margin-bottom:12px}
  th{background:#1e293b;color:#fff;padding:6px 8px;text-align:left;font-size:11px}
  td{padding:5px 8px;border-bottom:1px solid #e2e8f0}
  .total-row td{font-weight:900;background:#f8fafc;border-top:2px solid #1e293b}
  .box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-bottom:12px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .kv{display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #f1f5f9}
  .kv:last-child{border-bottom:none}
  .label{color:#64748b}
  .value{font-weight:700}
  .dif{color:${difCor};font-size:16px;font-weight:900;text-align:center;padding:8px;background:#f8fafc;border:2px solid ${difCor};border-radius:8px;margin-top:12px}
  @media print{body{padding:0}button{display:none}}
</style></head><body>
<h1>Relatorio de Fechamento de Caixa</h1>
<h2>Emitido em: ${agora}</h2>
<div class="box">
  <div class="kv"><span class="label">Operador</span><span class="value">${caixa?.funcionario_nome || 'N/D'}</span></div>
  <div class="kv"><span class="label">Caixa Nro</span><span class="value">${caixa?.numero_caixa || caixa?.id || 'N/D'}</span></div>
  <div class="kv"><span class="label">Abertura</span><span class="value">${caixa?.data_abertura ? new Date(caixa.data_abertura).toLocaleString('pt-BR') : 'N/D'}</span></div>
  <div class="kv"><span class="label">Fechamento</span><span class="value">${agora}</span></div>
</div>
<table><thead><tr><th>Forma</th><th>Qtd</th><th style="text-align:right">Total</th></tr></thead>
<tbody>${linhasForma}</tbody>
<tfoot><tr class="total-row"><td>TOTAL VENDAS</td><td></td><td style="text-align:right">${fmt(resumo?.total_vendas)}</td></tr></tfoot>
</table>
<div class="box">
  <div class="kv"><span class="label">Troco inicial (abertura)</span><span class="value">${fmt(resumo?.saldo_inicial)}</span></div>
  <div class="kv"><span class="label">Suprimentos</span><span class="value">+ ${fmt(resumo?.total_suprimentos)}</span></div>
  <div class="kv"><span class="label">Sangrias</span><span class="value">- ${fmt(resumo?.total_sangrias)}</span></div>
  <div class="kv"><span class="label">Esperado na gaveta</span><span class="value">${fmt(resumo?.saldo_esperado_gaveta)}</span></div>
  <div class="kv"><span class="label">Contado pelo operador</span><span class="value">${fmt(valorContado)}</span></div>
</div>
<div class="dif">Diferenca: ${diferenca >= 0 ? '+' : ''}${fmt(diferenca)}</div>
<script>window.onload=()=>window.print()</script>
</body></html>`;

        const win = window.open('', '_blank', 'width=700,height=900');
        if (win) { win.document.write(html); win.document.close(); }
    };

    const handleFechamento = async (e: React.FormEvent) => {
        e.preventDefault();
        const val = parseFloat(valorFechamento.replace(',', '.'));
        if (isNaN(val) || valorFechamento.trim() === '') return showToast.error('Informe o valor em dinheiro no caixa.');
        try {
            setLoading(true);
            const resp = await pdvService.fecharCaixa(val);
            // Imprimir relatório com os dados retornados pelo backend
            const resumoFinal = resp?.resumo_fechamento || resumoCaixa;
            imprimirRelatorioCaixa(resumoFinal, caixaAtual, val);
            setCaixaAtual(null);
            showToast.success('Caixa fechado! Relatório enviado para impressão.');
            onClose();
        } catch (err: any) {
            showToast.error(err.response?.data?.error || 'Erro ao fechar caixa');
        } finally { setLoading(false); }
    };

    const handleMovimentacao = async (e: React.FormEvent) => {
        e.preventDefault();
        const val = parseFloat(valorMovimentacao.replace(',', '.'));
        if (isNaN(val) || val <= 0) return showToast.error('Informe um valor válido.');
        if (!descricaoMovimentacao.trim()) return showToast.error('A descrição é obrigatória.');
        // Regra de Acesso: sangria exige PIN de Admin/Gerente (conferência do
        // valor exato junto com o caixa). O submit real acontece em confirmarMovimentacao.
        if (tipoMovimentacao === 'sangria') {
            setPinSangriaOpen(true);
            return;
        }
        await confirmarMovimentacao();
    };

    const confirmarMovimentacao = async (pin?: string) => {
        const val = parseFloat(valorMovimentacao.replace(',', '.'));
        try {
            setLoading(true);
            await pdvService.registrarMovimentacao({ tipo: tipoMovimentacao, valor: val, descricao: descricaoMovimentacao, pin });
            const delta = tipoMovimentacao === 'suprimento' ? val : -val;
            if (caixaAtual) setCaixaAtual({ ...caixaAtual, saldo_atual: parseFloat(caixaAtual.saldo_atual as any) + delta });
            showToast.success(`${tipoMovimentacao === 'sangria' ? 'Sangria' : 'Suprimento'} registrado!`);
            setValorMovimentacao(''); setDescricaoMovimentacao('');
            onClose();
        } catch (err: any) {
            showToast.error(err.response?.data?.error || 'Erro ao registrar movimentação');
        } finally { setLoading(false); }
    };

    // ────────────────────────────────────────────────────────
    // ABERTURA (modal bloqueante)
    // ────────────────────────────────────────────────────────
    if (!caixaAtual) {
        return createPortal(
            <div className="fixed inset-0 z-200 flex items-center justify-center p-3 sm:p-6"
                style={{
                    background: 'linear-gradient(135deg, rgba(15,23,42,0.85) 0%, rgba(30,27,75,0.85) 100%)',
                    backdropFilter: 'blur(16px)',
                    paddingTop: 'calc(0.75rem + env(safe-area-inset-top))',
                    paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))',
                }}>
                <div className="relative w-full max-w-sm rounded-3xl overflow-hidden shadow-2xl"
                    style={{ background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)', border: '1px solid rgba(99,102,241,0.3)' }}>

                    {/* Fundo decorativo */}
                    <div className="absolute inset-0 overflow-hidden pointer-events-none">
                        <div className="absolute -top-20 -left-20 w-64 h-64 rounded-full opacity-10"
                            style={{ background: 'radial-gradient(circle, #6366f1, transparent)' }} />
                        <div className="absolute -bottom-16 -right-16 w-48 h-48 rounded-full opacity-10"
                            style={{ background: 'radial-gradient(circle, #14b8a6, transparent)' }} />
                    </div>

                    {/* Header */}
                    <div className="relative px-8 pt-8 pb-6 text-center">
                        <button onClick={onClose} title="Fechar (ESC)"
                            className="absolute top-4 right-4 p-2 rounded-full text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:text-white hover:bg-white/10 transition-all">
                            <X className="w-5 h-5" />
                        </button>
                        <div className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-4"
                            style={{ background: 'linear-gradient(135deg, #6366f1, #4f46e5)', boxShadow: '0 8px 32px rgba(99,102,241,0.4)' }}>
                            <Unlock className="w-10 h-10 text-gray-900 dark:text-white" />
                        </div>
                        <h2 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">Abertura de Caixa</h2>
                        <p className="text-gray-500 dark:text-slate-400 text-sm mt-1">Informe o troco disponível na gaveta</p>
                    </div>

                    {/* Form */}
                    <form onSubmit={handleAbertura} className="relative px-6 pb-8 space-y-5">
                        <div className="rounded-2xl overflow-hidden"
                            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
                            <div className="flex items-center px-4 py-1 border-b"
                                style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
                                <span className="text-gray-500 dark:text-slate-400 text-xs font-bold uppercase tracking-widest">Saldo Inicial (R$)</span>
                            </div>
                            <div className="relative">
                                <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-indigo-400" />
                                <input
                                    type="number" step="0.01" min="0" required autoFocus
                                    className="w-full pl-12 pr-4 py-5 text-3xl font-black bg-transparent text-gray-900 dark:text-white outline-none tabular-nums"
                                    placeholder="0,00"
                                    value={saldoInicial}
                                    onChange={e => setSaldoInicial(e.target.value)}
                                    disabled={loading}
                                    style={{ caretColor: '#6366f1' }}
                                />
                            </div>
                        </div>

                        <button type="submit" disabled={loading || !saldoInicial}
                            className="w-full py-4 rounded-2xl font-black text-gray-900 dark:text-white tracking-widest uppercase transition-all active:scale-95 disabled:opacity-40"
                            style={{ background: loading || !saldoInicial ? undefined : 'linear-gradient(135deg, #6366f1, #4f46e5)', boxShadow: '0 8px 24px rgba(99,102,241,0.35)' }}>
                            {loading ? (
                                <span className="flex items-center justify-center gap-2">
                                    <RefreshCw className="w-5 h-5 animate-spin" /> Abrindo...
                                </span>
                            ) : '🔓 Confirmar Abertura'}
                        </button>
                    </form>
                </div>
            </div>,
            document.body
        );
    }

    // ────────────────────────────────────────────────────────
    // GERENCIAMENTO (Aberto)
    // ────────────────────────────────────────────────────────
    const tabs = [
        { key: 'movimentacao', label: 'Ações', icon: <DollarSign className="w-4 h-4" />, accent: '#6366f1' },
        { key: 'fechar', label: 'Fechar', icon: <Lock className="w-4 h-4" />, accent: '#ef4444' },
        { key: 'auditoria', label: 'Extrato', icon: <History className="w-4 h-4" />, accent: '#f59e0b' },
    ] as const;

    return createPortal(
        <div className="fixed inset-0 z-200 flex items-end sm:items-center justify-center p-0 sm:p-4"
            style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(12px)' }}
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}>

            <div className="w-full sm:max-w-md flex flex-col rounded-t-3xl sm:rounded-3xl overflow-hidden shadow-2xl"
                style={{
                    maxHeight: 'calc(100dvh - env(safe-area-inset-top) - 8px)',
                    background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
                    border: '1px solid rgba(255,255,255,0.08)'
                }}>

                {/* ── Header fixo ── */}
                <div className="shrink-0 flex items-center justify-between px-5 py-4"
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                            style={{ background: 'linear-gradient(135deg,#6366f1,#4f46e5)' }}>
                            <Wallet className="w-5 h-5 text-gray-900 dark:text-white" />
                        </div>
                        <div>
                            <p className="text-gray-900 dark:text-white font-black text-base leading-none">Gerenciar Caixa</p>
                            <p className="text-gray-500 dark:text-slate-400 text-xs mt-0.5 font-mono">
                                Saldo: <span className="text-green-400 font-bold">{formatCurrency(caixaAtual.saldo_atual)}</span>
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} disabled={loading}
                        className="p-2 rounded-xl text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:text-white hover:bg-white/10 transition-all">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* ── Tabs ── */}
                <div className="shrink-0 flex gap-1 px-3 py-2"
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.2)' }}>
                    {tabs.map(tab => (
                        <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-bold text-xs transition-all"
                            style={activeTab === tab.key ? {
                                background: `${tab.accent}22`,
                                color: tab.accent,
                                border: `1px solid ${tab.accent}44`,
                            } : { color: '#94a3b8', background: 'transparent', border: '1px solid transparent' }}>
                            {tab.icon}
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* ── Conteúdo com scroll (padding extra no rodapé p/ os botões de ação
                       nunca ficarem sob a barra de gestos do sistema no celular) ── */}
                <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-4 space-y-4"
                    style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}>
                    {/* ═══ ABA: AÇÕES (Sangria / Suprimento) ═══ */}
                    {activeTab === 'movimentacao' && (
                        <form onSubmit={handleMovimentacao} className="space-y-4">
                            {/* Tipo */}
                            <div className="grid grid-cols-2 gap-2">
                                <button type="button" onClick={() => setTipoMovimentacao('sangria')}
                                    className="flex flex-col items-center gap-2 py-4 rounded-2xl font-bold text-sm transition-all"
                                    style={tipoMovimentacao === 'sangria' ? {
                                        background: 'rgba(239,68,68,0.15)', color: '#f87171',
                                        border: '1.5px solid rgba(239,68,68,0.4)'
                                    } : { background: 'rgba(255,255,255,0.04)', color: '#64748b', border: '1.5px solid rgba(255,255,255,0.07)' }}>
                                    <TrendingDown className="w-6 h-6" />
                                    Sangria (Saída)
                                </button>
                                <button type="button" onClick={() => setTipoMovimentacao('suprimento')}
                                    className="flex flex-col items-center gap-2 py-4 rounded-2xl font-bold text-sm transition-all"
                                    style={tipoMovimentacao === 'suprimento' ? {
                                        background: 'rgba(34,197,94,0.15)', color: '#4ade80',
                                        border: '1.5px solid rgba(34,197,94,0.4)'
                                    } : { background: 'rgba(255,255,255,0.04)', color: '#64748b', border: '1.5px solid rgba(255,255,255,0.07)' }}>
                                    <TrendingUp className="w-6 h-6" />
                                    Suprimento (Entrada)
                                </button>
                            </div>

                            {/* Valor */}
                            <div className="rounded-2xl overflow-hidden"
                                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                                <p className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest px-4 pt-3">Valor (R$)</p>
                                <div className="relative">
                                    <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 dark:text-slate-500" />
                                    <input type="number" step="0.01" min="0.01" required
                                        className="w-full pl-12 pr-4 py-4 text-2xl font-black bg-transparent text-gray-900 dark:text-white outline-none tabular-nums"
                                        placeholder="0,00"
                                        value={valorMovimentacao}
                                        onChange={e => setValorMovimentacao(e.target.value)}
                                        style={{ caretColor: '#6366f1' }} />
                                </div>
                            </div>

                            {/* Descrição */}
                            <input type="text" required
                                className="w-full px-4 py-3 rounded-2xl text-sm font-medium text-gray-900 dark:text-white outline-none transition-all"
                                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
                                placeholder="Motivo / Descrição (obrigatório)"
                                value={descricaoMovimentacao}
                                onChange={e => setDescricaoMovimentacao(e.target.value)}
                            />

                            <button type="submit" disabled={loading || !valorMovimentacao || !descricaoMovimentacao}
                                className="w-full py-4 rounded-2xl font-black text-gray-900 dark:text-white tracking-wider uppercase transition-all active:scale-95 disabled:opacity-40"
                                style={{
                                    background: loading ? undefined : tipoMovimentacao === 'sangria'
                                        ? 'linear-gradient(135deg,#ef4444,#dc2626)'
                                        : 'linear-gradient(135deg,#22c55e,#16a34a)',
                                    boxShadow: tipoMovimentacao === 'sangria' ? '0 8px 24px rgba(239,68,68,0.3)' : '0 8px 24px rgba(34,197,94,0.3)'
                                }}>
                                {loading ? (
                                    <span className="flex items-center justify-center gap-2">
                                        <RefreshCw className="w-5 h-5 animate-spin" /> Processando...
                                    </span>
                                ) : `✓ Confirmar ${tipoMovimentacao === 'sangria' ? 'Sangria' : 'Suprimento'}`}
                            </button>
                        </form>
                    )}

                    {/* ═══ ABA: FECHAR CAIXA ═══ */}
                    {activeTab === 'fechar' && (
                        <form onSubmit={handleFechamento} className="space-y-4">
                            {/* Resumo por forma de pagamento */}
                            {loadingResumo ? (
                                <div className="flex items-center justify-center gap-2 py-6 text-gray-400 dark:text-slate-500 text-sm">
                                    <RefreshCw className="w-4 h-4 animate-spin" /> Carregando resumo do turno...
                                </div>
                            ) : resumoCaixa && (
                                <div className="rounded-2xl overflow-hidden"
                                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                                    <div className="flex items-center justify-between px-4 py-3"
                                        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                        <div className="flex items-center gap-2">
                                            <BarChart3 className="w-4 h-4 text-indigo-400" />
                                            <span className="text-xs font-black text-gray-500 dark:text-slate-400 uppercase tracking-widest">Resumo do Turno</span>
                                        </div>
                                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-400">ATIVO</span>
                                    </div>

                                    {/* Grid de Totais Rápidos */}
                                    <div className="grid grid-cols-2 gap-px bg-white/5 border-b border-white/5">
                                        <div className="p-3">
                                            <p className="text-[9px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-tighter">Vendas Totais</p>
                                            <p className="text-sm font-black text-gray-900 dark:text-white">{formatCurrency(resumoCaixa.total_vendas)}</p>
                                        </div>
                                        <div className="p-3 border-l border-white/5">
                                            <p className="text-[9px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-tighter">Entradas (Suprim.)</p>
                                            <p className="text-sm font-black text-green-400">+{formatCurrency(resumoCaixa.total_suprimentos)}</p>
                                        </div>
                                        <div className="p-3 border-t border-white/5">
                                            <p className="text-[9px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-tighter">Saídas (Sangrias)</p>
                                            <p className="text-sm font-black text-red-400">-{formatCurrency(resumoCaixa.total_sangrias)}</p>
                                        </div>
                                        <div className="p-3 border-t border-l border-white/5">
                                            <p className="text-[9px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-tighter">Troco Inicial</p>
                                            <p className="text-sm font-black text-gray-600 dark:text-slate-300">{formatCurrency(resumoCaixa.saldo_inicial)}</p>
                                        </div>
                                    </div>

                                    {/* Detalhamento por forma */}
                                    <div className="divide-y divide-white/5">
                                        {Object.entries(resumoCaixa.por_forma_pagamento || {}).map(([forma, dados]: any) => {
                                            if (dados.total === 0 && forma !== 'dinheiro' && forma !== 'fiado') return null;
                                            const info = FORMA_LABELS[forma] || { label: forma, emoji: '📦', color: 'text-gray-500 dark:text-slate-400' };
                                            const isFiado = forma === 'fiado';
                                            return (
                                                <div key={forma}
                                                    className="flex justify-between items-center px-4 py-2.5 transition-colors"
                                                    style={{ background: isFiado && dados.total > 0 ? 'rgba(234,88,12,0.08)' : undefined }}>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-base leading-none">{info.emoji}</span>
                                                        <div>
                                                            <p className="text-[13px] font-bold text-gray-900 dark:text-white leading-tight">{info.label}</p>
                                                            <p className="text-[10px] text-gray-400 dark:text-slate-500">{dados.quantidade} op.</p>
                                                        </div>
                                                    </div>
                                                    <span className={`font-black text-sm tabular-nums ${isFiado ? 'text-orange-400' : 'text-gray-900 dark:text-white'}`}>
                                                        {formatCurrency(dados.total)}
                                                    </span>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* Final Esperado na Gaveta */}
                                    <div className="flex justify-between items-center px-4 py-4"
                                        style={{ background: 'rgba(245,158,11,0.15)', borderTop: '2px dashed rgba(245,158,11,0.3)' }}>
                                        <div className="flex items-center gap-2">
                                            <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center">
                                                <DollarSign className="w-4 h-4 text-amber-500" />
                                            </div>
                                            <div>
                                                <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest leading-none">Esperado em Dinheiro</p>
                                                <p className="text-[9px] text-amber-600/70 font-bold mt-1">(Troco + Dinheiro + Suprim - Sangrias)</p>
                                            </div>
                                        </div>
                                        <span className="text-xl font-black text-amber-400 tabular-nums">
                                            {formatCurrency(resumoCaixa.saldo_esperado_gaveta)}
                                        </span>
                                    </div>
                                </div>
                            )}

                            {/* Aviso */}
                            <div className="flex gap-3 p-4 rounded-2xl"
                                style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
                                <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                                <div className="text-sm text-red-300">
                                    <p className="font-bold mb-0.5">Atenção — operação irreversível</p>
                                    <p className="text-red-400/80">O caixa será encerrado e um relatório gerado. Confirme o dinheiro físico abaixo.</p>
                                </div>
                            </div>

                            {/* Valor da Gaveta */}
                            <div className="rounded-2xl overflow-hidden"
                                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(239,68,68,0.3)' }}>
                                <p className="text-[10px] font-bold text-red-400 uppercase tracking-widest px-4 pt-3">Valor Contado na Gaveta (R$)</p>
                                <div className="relative">
                                    <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-red-400/60" />
                                    <input type="number" step="0.01" min="0" required
                                        className="w-full pl-12 pr-4 py-4 text-2xl font-black bg-transparent text-gray-900 dark:text-white outline-none tabular-nums"
                                        placeholder="0,00"
                                        value={valorFechamento}
                                        onChange={e => setValorFechamento(e.target.value)}
                                        style={{ caretColor: '#ef4444' }} />
                                </div>
                            </div>

                            <button type="submit" disabled={loading || valorFechamento.trim() === ''}
                                className="w-full py-4 rounded-2xl font-black text-gray-900 dark:text-white tracking-wider uppercase transition-all active:scale-95 disabled:opacity-40"
                                style={{ background: 'linear-gradient(135deg,#ef4444,#dc2626)', boxShadow: '0 8px 24px rgba(239,68,68,0.35)' }}>
                                {loading ? (
                                    <span className="flex items-center justify-center gap-2">
                                        <RefreshCw className="w-5 h-5 animate-spin" /> Fechando...
                                    </span>
                                ) : '🔒 Confirmar Fechamento'}
                            </button>
                        </form>
                    )}

                    {/* ═══ ABA: EXTRATO / AUDITORIA ═══ */}
                    {activeTab === 'auditoria' && (
                        <div className="space-y-3">
                            <div className="flex justify-between items-center px-4 py-3 rounded-2xl"
                                style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)' }}>
                                <span className="text-sm font-bold text-amber-400">Saldo Caixa (Dinheiro)</span>
                                <span className="text-xl font-black text-amber-400 tabular-nums">{formatCurrency(caixaAtual.saldo_atual)}</span>
                            </div>

                            <div className="space-y-2">
                                {loadingAuditoria ? (
                                    <div className="flex items-center justify-center gap-2 py-8 text-gray-400 dark:text-slate-500 text-sm">
                                        <RefreshCw className="w-4 h-4 animate-spin" /> Carregando extrato...
                                    </div>
                                ) : movimentacoes.length === 0 ? (
                                    <div className="text-center py-10 text-gray-400 dark:text-slate-600 text-sm">
                                        <History className="w-8 h-8 mx-auto mb-2 opacity-30" />
                                        Nenhuma movimentação neste turno
                                    </div>
                                ) : movimentacoes.map((mov) => {
                                    const isSaida = mov.tipo === 'sangria' || (mov.valor && mov.valor < 0);
                                    return (
                                        <div key={mov.id}
                                            className="flex items-center justify-between px-4 py-3 rounded-2xl transition-all"
                                            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                                            <div className="flex items-center gap-3">
                                                <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                                                    style={{ background: isSaida ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)' }}>
                                                    {isSaida
                                                        ? <ArrowDownCircle className="w-5 h-5 text-red-400" />
                                                        : <ArrowUpCircle className="w-5 h-5 text-green-400" />}
                                                </div>
                                                <div>
                                                    <p className="text-sm font-bold text-gray-900 dark:text-white capitalize">
                                                        {mov.descricao || mov.tipo}
                                                    </p>
                                                    <p className="text-xs text-gray-400 dark:text-slate-500 font-mono">
                                                        {new Date(mov.created_at || mov.data).toLocaleString('pt-BR')}
                                                    </p>
                                                </div>
                                            </div>
                                            <span className={`font-black text-base tabular-nums ${isSaida ? 'text-red-400' : 'text-green-400'}`}>
                                                {isSaida ? '−' : '+'}{formatCurrency(Math.abs(parseFloat(mov.valor || 0)))}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>{/* /scroll area */}
            </div>

            {/* PIN obrigatório para sangria (Regra de Acesso) */}
            <PinDialog
                open={pinSangriaOpen}
                title="Autorizar Sangria"
                description="A sangria exige o PIN de segurança de um Admin ou Gerente. Confira o valor exato junto com o caixa antes de autorizar."
                onSuccess={(pin) => { setPinSangriaOpen(false); confirmarMovimentacao(pin); }}
                onClose={() => setPinSangriaOpen(false)}
            />
        </div>,
        document.body
    );
};

export default CaixaManager;
