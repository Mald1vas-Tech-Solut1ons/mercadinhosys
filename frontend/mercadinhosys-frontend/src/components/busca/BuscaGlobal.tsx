import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Package, User, Truck, Receipt, LayoutGrid, Loader2, CornerDownLeft } from 'lucide-react';
import { apiClient } from '../../api/apiClient';
import { formatCurrency } from '../../utils/formatters';

/** Evento para abrir a busca a partir de qualquer botão (cabeçalho, menu). */
export const ABRIR_BUSCA_GLOBAL = 'abrir-busca-global';
export const abrirBuscaGlobal = () => window.dispatchEvent(new Event(ABRIR_BUSCA_GLOBAL));

interface Item {
    chave: string;
    grupo: string;
    titulo: string;
    detalhe?: string;
    icone: React.ElementType;
    ir: string;
}

const TELAS: { titulo: string; termos: string; ir: string }[] = [
    { titulo: 'Nova venda (PDV)', termos: 'pdv caixa vender nova venda', ir: '/pdv' },
    { titulo: 'Resumo da loja (Dashboard)', termos: 'dashboard painel resumo inicio', ir: '/dashboard' },
    { titulo: 'Produtos e estoque', termos: 'produtos estoque cadastro', ir: '/products' },
    { titulo: 'Clientes', termos: 'clientes fiado crm', ir: '/customers' },
    { titulo: 'Vendas', termos: 'vendas historico cupom', ir: '/sales' },
    { titulo: 'Fornecedores', termos: 'fornecedores distribuidor', ir: '/suppliers' },
    { titulo: 'Compras e nota de entrada', termos: 'compras nota entrada xml pedido', ir: '/compras' },
    { titulo: 'Despesas e contas a pagar', termos: 'despesas contas boleto financeiro', ir: '/expenses' },
    { titulo: 'Relatórios', termos: 'relatorios abc rfm exportar', ir: '/reports' },
    { titulo: 'Funcionários e RH', termos: 'funcionarios rh folha ponto', ir: '/employees' },
    { titulo: 'Fiscal (NFC-e)', termos: 'fiscal nfce nota', ir: '/fiscal' },
    { titulo: 'Configurações', termos: 'configuracoes ajustes alerta estoque', ir: '/settings' },
];

const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Busca global (Ctrl+K): produto, cliente, fornecedor, venda e telas num só campo.
 * Montada uma vez no MainLayout. Aceita erro de digitação, código de barras e
 * palavras de estado ("vencendo", "sem estoque").
 */
const BuscaGlobal: React.FC = () => {
    const navigate = useNavigate();
    const [aberta, setAberta] = useState(false);
    const [q, setQ] = useState('');
    const [carregando, setCarregando] = useState(false);
    const [dados, setDados] = useState<any>(null);
    const [ativo, setAtivo] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const pedidoRef = useRef(0);

    const fechar = useCallback(() => { setAberta(false); setQ(''); setDados(null); setAtivo(0); }, []);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                setAberta((v) => !v);
            }
        };
        const onAbrir = () => setAberta(true);
        window.addEventListener('keydown', onKey);
        window.addEventListener(ABRIR_BUSCA_GLOBAL, onAbrir);
        return () => { window.removeEventListener('keydown', onKey); window.removeEventListener(ABRIR_BUSCA_GLOBAL, onAbrir); };
    }, []);

    useEffect(() => { if (aberta) setTimeout(() => inputRef.current?.focus(), 0); }, [aberta]);

    useEffect(() => {
        const termo = q.trim();
        if (!aberta || termo.length < 2) { setDados(null); return; }
        const id = ++pedidoRef.current;
        setCarregando(true);
        const t = setTimeout(async () => {
            try {
                const { data } = await apiClient.get('/busca', { params: { q: termo, limite: 6 } });
                if (id === pedidoRef.current) setDados(data);
            } catch {
                if (id === pedidoRef.current) setDados(null);
            } finally {
                if (id === pedidoRef.current) setCarregando(false);
            }
        }, 200);
        return () => clearTimeout(t);
    }, [q, aberta]);

    const itens: Item[] = useMemo(() => {
        const termo = normalizar(q);
        const lista: Item[] = [];
        if (termo) {
            TELAS.filter((t) => normalizar(`${t.titulo} ${t.termos}`).includes(termo)).slice(0, 4)
                .forEach((t) => lista.push({ chave: `t-${t.ir}`, grupo: 'Telas', titulo: t.titulo, icone: LayoutGrid, ir: t.ir }));
        }
        (dados?.produtos || []).forEach((p: any) => lista.push({
            chave: `p-${p.id}`, grupo: 'Produtos', titulo: p.nome, icone: Package, ir: `/products/${p.id}`,
            detalhe: `${formatCurrency(p.preco_venda)} · estoque ${p.quantidade}${p.codigo_barras ? ` · ${p.codigo_barras}` : ''}`,
        }));
        (dados?.clientes || []).forEach((c: any) => lista.push({
            chave: `c-${c.id}`, grupo: 'Clientes', titulo: c.nome, icone: User,
            ir: `/customers?busca=${encodeURIComponent(c.nome)}`, detalhe: [c.documento, c.celular].filter(Boolean).join(' · '),
        }));
        (dados?.fornecedores || []).forEach((f: any) => lista.push({
            chave: `f-${f.id}`, grupo: 'Fornecedores', titulo: f.nome, icone: Truck, ir: `/suppliers/${f.id}`, detalhe: f.cnpj,
        }));
        (dados?.vendas || []).forEach((v: any) => lista.push({
            chave: `v-${v.id}`, grupo: 'Vendas', titulo: v.codigo, icone: Receipt,
            ir: `/sales?busca=${encodeURIComponent(v.codigo)}`,
            detalhe: `${formatCurrency(v.total)} · ${v.data_venda ? new Date(v.data_venda).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}${v.status === 'cancelada' ? ' · cancelada' : ''}`,
        }));
        return lista;
    }, [q, dados]);

    useEffect(() => { setAtivo(0); }, [itens.length]);

    const ir = (item?: Item) => {
        if (!item) return;
        navigate(item.ir);
        fechar();
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') { e.preventDefault(); fechar(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); setAtivo((a) => Math.min(a + 1, itens.length - 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setAtivo((a) => Math.max(a - 1, 0)); }
        else if (e.key === 'Enter') { e.preventDefault(); ir(itens[ativo]); }
    };

    if (!aberta) return null;

    const filtros: string[] = dados?.filtros || [];
    const NOME_FILTRO: Record<string, string> = {
        sem_estoque: 'sem estoque', estoque_baixo: 'estoque baixo', vencendo: 'vencendo em 30 dias', vencido: 'vencido',
    };
    let grupoAnterior = '';

    return (
        <div className="fixed inset-0 z-[200] flex items-start justify-center bg-black/40 px-4 pt-[12vh]" onMouseDown={fechar}>
            <div className="w-full max-w-xl rounded-2xl bg-white dark:bg-gray-900 shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden"
                onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Busca global">
                <div className="flex items-center gap-3 px-4 border-b border-gray-100 dark:border-gray-800">
                    <Search className="w-5 h-5 text-gray-400 shrink-0" />
                    <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown}
                        placeholder="Buscar produto, cliente, venda, fornecedor ou tela…"
                        className="flex-1 h-14 bg-transparent outline-none text-base text-gray-900 dark:text-white placeholder:text-gray-400" />
                    {carregando && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
                    <kbd className="hidden sm:block text-[10px] font-bold text-gray-400 border border-gray-200 dark:border-gray-700 rounded px-1.5 py-0.5">Esc</kbd>
                </div>

                {filtros.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 px-4 pt-3">
                        {filtros.map((f) => (
                            <span key={f} className="px-2 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                                filtro: {NOME_FILTRO[f] || f}
                            </span>
                        ))}
                    </div>
                )}

                <div className="max-h-[60vh] overflow-y-auto py-2">
                    {q.trim().length < 2 && (
                        <p className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400">
                            Digite o nome, bipe o código de barras ou use palavras como <b>vencendo</b> e <b>sem estoque</b>.
                        </p>
                    )}
                    {q.trim().length >= 2 && !carregando && itens.length === 0 && (
                        <p className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400">Nada encontrado para “{q}”.</p>
                    )}
                    {itens.map((item, i) => {
                        const cabecalho = item.grupo !== grupoAnterior;
                        grupoAnterior = item.grupo;
                        const Icone = item.icone;
                        return (
                            <React.Fragment key={item.chave}>
                                {cabecalho && <p className="px-4 pt-3 pb-1 text-[10px] font-black uppercase tracking-widest text-gray-400">{item.grupo}</p>}
                                <button type="button" onMouseEnter={() => setAtivo(i)} onClick={() => ir(item)}
                                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left ${i === ativo ? 'bg-blue-50 dark:bg-blue-900/30' : ''}`}>
                                    <Icone className="w-4 h-4 text-gray-400 shrink-0" />
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-sm font-semibold text-gray-900 dark:text-white truncate">{item.titulo}</span>
                                        {item.detalhe && <span className="block text-xs text-gray-500 dark:text-gray-400 truncate">{item.detalhe}</span>}
                                    </span>
                                    {i === ativo && <CornerDownLeft className="w-4 h-4 text-gray-400 shrink-0" />}
                                </button>
                            </React.Fragment>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default BuscaGlobal;
