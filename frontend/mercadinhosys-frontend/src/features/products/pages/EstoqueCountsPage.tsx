import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    AlertTriangle, ArrowLeft, CheckCircle2, ClipboardList, Hash, Loader2,
    Plus, ScanBarcode, Trash2, XCircle,
} from 'lucide-react';
import { apiClient } from '../../../api/apiClient';
import { showToast } from '../../../utils/toast';
import { mensagemErro } from '../../../utils/mensagemErro';
import { formatCurrency } from '../../../utils/formatters';
import { pedirPin } from '../../../components/ui/PedidoPin';
import { confirmar } from '../../../components/ui/Confirmacao';

/**
 * "O que sumiu" — contagem cíclica de estoque (FASE 3.1).
 *
 * Spec: docs/SPEC_O_QUE_SUMIU_CONTAGEM_CICLICA_2026-10-31.md
 *
 * Três telas na mesma página, mobile-first porque o dono está em pé na loja
 * com o celular numa mão e o leitor na outra:
 *   A) seções que ele já contou / abrir contagem nova
 *   B) bipagem (um bip = uma unidade), com esperado x contado ao vivo
 *   C) conferência: só os divergentes, com [Sumiu] [Re-contar] [Está certo assim]
 *
 * PIN só no fim (aplicar), não no começo: a fricção fica no passo irreversível.
 */

interface Secao {
    nome: string;
    total_contagens: number;
    ultima_aplicacao: string | null;
    contagem_aberta_id: number | null;
}

interface ItemContagem {
    produto_id: number;
    nome?: string;
    quantidade_esperada: number;
    quantidade_contada: number;
    fora_da_secao?: boolean;
}

interface Divergente {
    produto_id: number;
    nome: string;
    unidade: string;
    quantidade_esperada: number;
    quantidade_contada: number;
    divergencia: number;
    valor_divergencia: number;
    fora_da_secao: boolean;
}

type Decisao = 'sumiu' | 'recontar' | 'ajustar';

type Etapa = 'secoes' | 'bipagem' | 'conferencia';

const EstoqueCountsPage: React.FC = () => {
    const navigate = useNavigate();

    const [etapa, setEtapa] = useState<Etapa>('secoes');
    const [secoes, setSecoes] = useState<Secao[]>([]);
    const [carregando, setCarregando] = useState(true);
    const [contagem, setContagem] = useState<{ id: number; nome: string } | null>(null);
    const [itens, setItens] = useState<ItemContagem[]>([]);
    const [divergentes, setDivergentes] = useState<Divergente[]>([]);
    const [itensOk, setItensOk] = useState(0);
    const [decisoes, setDecisoes] = useState<Record<number, Decisao>>({});
    const [bipando, setBipando] = useState(false);
    const [codigo, setCodigo] = useState('');
    const [novaSecao, setNovaSecao] = useState('');
    const [abrirNova, setAbrirNova] = useState(false);
    const [aplicando, setAplicando] = useState(false);
    const campoBip = useRef<HTMLInputElement>(null);

    const carregarSecoes = useCallback(async () => {
        setCarregando(true);
        try {
            const { data } = await apiClient.get<{ secoes: Secao[] }>('/contagem/secoes');
            setSecoes(data.secoes || []);
        } catch (erro) {
            showToast.error(mensagemErro(erro, 'Não foi possível carregar as seções'), { duration: 6000 });
        } finally {
            setCarregando(false);
        }
    }, []);

    useEffect(() => { carregarSecoes(); }, [carregarSecoes]);

    // Foco permanente no campo de bip: o dono anda sem olhar a tela.
    useEffect(() => {
        if (etapa === 'bipagem') campoBip.current?.focus();
    }, [etapa]);

    const abrirContagem = async () => {
        const nome = novasecaoSegura(novaSecao);
        if (!nome) {
            showToast.error('Dê um nome à seção (ex.: Gôndola 3 — Higiene)', { duration: 5000 });
            return;
        }
        // A seção abre sem lista: o dono nomeia a gôndola e bipa o que está nela.
        // O primeiro bip define o que é da seção (o backend marca os demais como "de fora").
        try {
            const { data } = await apiClient.post('/contagem/', { nome, itens: [] });
            setContagem({ id: data.contagem.id, nome: data.contagem.nome });
            setItens(data.contagem.itens || []);
            setNovaSecao('');
            setAbrirNova(false);
            setEtapa('bipagem');
            showToast.success('Contagem aberta. Bipar cada unidade que você vê na prateleira.');
        } catch (erro) {
            showToast.error(mensagemErro(erro, 'Não foi possível abrir a contagem'), { duration: 7000 });
        }
    };

    const bipar = async (valor: string) => {
        if (!contagem || !valor.trim()) return;
        setBipando(true);
        try {
            const { data } = await apiClient.post(`/contagem/${contagem.id}/bipar`, { codigo_barras: valor.trim() });
            setItens(prev => {
                const existe = prev.find(i => i.produto_id === data.produto.id);
                if (existe) {
                    return prev.map(i => i.produto_id === data.produto.id
                        ? { ...i, quantidade_contada: data.quantidade_contada }
                        : i);
                }
                return [...prev, {
                    produto_id: data.produto.id,
                    nome: data.produto.nome,
                    quantidade_esperada: data.quantidade_esperada,
                    quantidade_contada: data.quantidade_contada,
                    fora_da_secao: data.fora_da_secao,
                }];
            });
            if (data.fora_da_secao) {
                showToast.warning(`${data.produto.nome} não é desta seção — contei mesmo assim`, { duration: 3000 });
            }
            setCodigo('');
        } catch (erro) {
            showToast.error(mensagemErro(erro, 'Não foi possível contar este código'), { duration: 5000 });
        } finally {
            setBipando(false);
            campoBip.current?.focus();
        }
    };

    const conferir = async () => {
        if (!contagem) return;
        try {
            const { data } = await apiClient.get(`/contagem/${contagem.id}/conferir`);
            setDivergentes(data.divergentes || []);
            setItensOk(data.resumo?.itens_ok ?? 0);
            setDecisoes(Object.fromEntries(
                (data.divergentes || []).map((d: Divergente) => [d.produto_id, d.divergencia < 0 ? 'sumiu' : 'ajustar'])
            ));
            setEtapa('conferencia');
        } catch (erro) {
            showToast.error(mensagemErro(erro, 'Não foi possível conferir a contagem'), { duration: 6000 });
        }
    };

    const valorDivergencia = useMemo(
        () => divergentes.reduce((soma, d) => soma + d.valor_divergencia, 0),
        [divergentes],
    );

    const aplicar = async () => {
        if (!contagem) return;
        const escolhidos = divergentes
            .filter(d => decisoes[d.produto_id] && decisoes[d.produto_id] !== 'recontar')
            .map(d => ({ produto_id: d.produto_id, decisao: decisoes[d.produto_id] }));

        if (!escolhidos.length) {
            showToast.error('Nenhuma decisão tomada — nada a aplicar', { duration: 5000 });
            return;
        }
        const confirmado = await confirmar({
            titulo: 'Aplicar contagem?',
            mensagem: `${escolhidos.length} item(ns) vão gerar movimentação de estoque (${formatCurrency(valorDivergencia)}). Depois disso a contagem é fechada.`,
            acao: 'Aplicar contagem',
            cancelar: 'Voltar',
            perigo: true,
        });
        if (!confirmado) return;

        const pin = await pedirPin({ acao: 'Aplicar contagem cíclica' });
        if (!pin) return;

        setAplicando(true);
        try {
            const { data } = await apiClient.post(`/contagem/${contagem.id}/aplicar`, { pin, itens: escolhidos });
            showToast.success(`${data.resumo.movimentacoes} movimentação(ões) registrada(s) — ${formatCurrency(data.resumo.valor_total)}`, { duration: 8000 });
            setContagem(null);
            setDivergentes([]);
            setItens([]);
            setEtapa('secoes');
            await carregarSecoes();
        } catch (erro) {
            showToast.error(mensagemErro(erro, 'Não foi possível aplicar a contagem'), { duration: 7000 });
        } finally {
            setAplicando(false);
        }
    };

    // ───────────────────────────── Tela A ─────────────────────────────
    if (etapa === 'secoes') {
        return (
            <div className="mx-auto w-full max-w-3xl p-4 md:p-6">
                <button onClick={() => navigate(-1)} className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-gray-500">
                    <ArrowLeft className="h-4 w-4" /> Voltar
                </button>

                <header className="mb-5">
                    <h1 className="flex items-center gap-2 text-2xl font-black text-gray-900 dark:text-white">
                        <ClipboardList className="h-6 w-6 text-blue-600" /> O que sumiu
                    </h1>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        Bipar uma seção da prateleira. O sistema mostra a diferença entre o que deveria ter e o que tem.
                    </p>
                </header>

                <button
                    onClick={() => setAbrirNova(v => !v)}
                    className="mb-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-black uppercase tracking-wide text-white hover:bg-blue-700"
                >
                    <Plus className="h-5 w-5" /> Nova contagem
                </button>

                {abrirNova && (
                    <div className="mb-5 rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950/40">
                        <label htmlFor="nome-secao" className="mb-1 block text-sm font-bold text-gray-700 dark:text-gray-200">
                            Como você chama essa parte da loja?
                        </label>
                        <input
                            id="nome-secao"
                            value={novaSecao}
                            onChange={e => setNovaSecao(e.target.value)}
                            placeholder="Gôndola 3 — Higiene"
                            className="mb-3 min-h-12 w-full rounded-lg border border-gray-300 px-3 text-base dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                        />
                        <button
                            onClick={abrirContagem}
                            className="min-h-12 w-full rounded-lg bg-emerald-600 px-4 py-3 text-sm font-black uppercase text-white hover:bg-emerald-700"
                        >
                            Começar a bipar
                        </button>
                    </div>
                )}

                {carregando ? (
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                        <Loader2 className="h-4 w-4 animate-spin" /> Carregando seções…
                    </div>
                ) : secoes.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700">
                        Nenhuma seção contada ainda. Comece pela que você desconfia que anda sumindo.
                    </div>
                ) : (
                    <ul className="space-y-2">
                        {secoes.map(secao => (
                            <li key={secao.nome}>
                                <button
                                    onClick={() => {
                                        if (secao.contagem_aberta_id) {
                                            setContagem({ id: secao.contagem_aberta_id, nome: secao.nome });
                                            setEtapa('bipagem');
                                            return;
                                        }
                                        setNovaSecao(secao.nome);
                                        setAbrirNova(true);
                                    }}
                                    className="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-left hover:border-blue-400 dark:border-gray-700 dark:bg-gray-800"
                                >
                                    <span className="min-w-0">
                                        <span className="block truncate text-base font-bold text-gray-900 dark:text-white">{secao.nome}</span>
                                        <span className="text-xs text-gray-500">
                                            {secao.ultima_aplicacao
                                                ? `Última contagem em ${new Date(secao.ultima_aplicacao).toLocaleDateString('pt-BR')}`
                                                : 'Nunca contada'}
                                        </span>
                                    </span>
                                    {secao.contagem_aberta_id ? (
                                        <span className="shrink-0 rounded-full bg-amber-100 px-2 py-1 text-xs font-black text-amber-800">em andamento</span>
                                    ) : !secao.ultima_aplicacao ? (
                                        <span className="shrink-0 rounded-full bg-red-100 px-2 py-1 text-xs font-black text-red-700">nunca contada</span>
                                    ) : null}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        );
    }

    // ───────────────────────────── Tela B ─────────────────────────────
    if (etapa === 'bipagem' && contagem) {
        const contados = itens.reduce((s, i) => s + i.quantidade_contada, 0);
        return (
            <div className="mx-auto w-full max-w-3xl p-4 md:p-6">
                <button onClick={() => setEtapa('secoes')} className="mb-3 inline-flex items-center gap-2 text-sm font-bold text-gray-500">
                    <ArrowLeft className="h-4 w-4" /> Seções
                </button>

                <h1 className="text-xl font-black text-gray-900 dark:text-white">{contagem.nome}</h1>
                <p className="mb-4 text-sm text-gray-500">{itens.length} produto(s) nesta seção · {contados} bipado(s)</p>

                <form
                    onSubmit={e => { e.preventDefault(); bipar(codigo); }}
                    className="sticky top-2 z-10 mb-4 rounded-xl border-2 border-blue-500 bg-white p-2 shadow-lg dark:bg-gray-800"
                >
                    <div className="flex items-center gap-2">
                        <ScanBarcode className="ml-2 h-6 w-6 shrink-0 text-blue-600" />
                        <input
                            ref={campoBip}
                            value={codigo}
                            onChange={e => setCodigo(e.target.value)}
                            inputMode="numeric"
                            autoFocus
                            placeholder="Bipe o produto"
                            aria-label="Código de barras do produto"
                            className="min-h-14 w-full border-0 bg-transparent text-2xl font-black tabular-nums text-gray-900 outline-none placeholder:text-gray-300 dark:text-white"
                        />
                        {bipando && <Loader2 className="mr-2 h-5 w-5 animate-spin text-blue-600" />}
                    </div>
                </form>

                <ul className="space-y-1.5">
                    {itens.map(item => (
                        <li key={item.produto_id}
                            className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${item.fora_da_secao ? 'border-dashed border-gray-300 text-gray-500' : 'border-gray-200 dark:border-gray-700'}`}>
                            <span className="min-w-0 truncate font-bold text-gray-800 dark:text-gray-100">
                                {item.fora_da_secao && <Hash className="mr-1 inline h-3.5 w-3.5" />}
                                {item.nome || `Produto ${item.produto_id}`}
                            </span>
                            <span className="shrink-0 tabular-nums text-gray-600 dark:text-gray-300">
                                esperado {item.quantidade_esperada} · <strong className={item.quantidade_contada < item.quantidade_esperada ? 'text-red-600' : 'text-emerald-600'}>{item.quantidade_contada}</strong>
                            </span>
                        </li>
                    ))}
                </ul>

                <button
                    onClick={conferir}
                    className="mt-5 min-h-14 w-full rounded-xl bg-emerald-600 px-4 py-4 text-base font-black uppercase tracking-wide text-white hover:bg-emerald-700"
                >
                    Conferir o que divergiu
                </button>
            </div>
        );
    }

    // ───────────────────────────── Tela C ─────────────────────────────
    const botoesDecisao: { valor: Decisao; rotulo: string; classe: string }[] = [
        { valor: 'sumiu', rotulo: 'Sumiu', classe: 'bg-red-600 hover:bg-red-700 text-white' },
        { valor: 'recontar', rotulo: 'Re-contar', classe: 'bg-gray-200 hover:bg-gray-300 text-gray-800' },
        { valor: 'ajustar', rotulo: 'Está certo assim', classe: 'bg-blue-600 hover:bg-blue-700 text-white' },
    ];

    return (
        <div className="mx-auto w-full max-w-3xl p-4 md:p-6">
            <button onClick={() => setEtapa('bipagem')} className="mb-3 inline-flex items-center gap-2 text-sm font-bold text-gray-500">
                <ArrowLeft className="h-4 w-4" /> Voltar a bipar
            </button>

            <h1 className="text-xl font-black text-gray-900 dark:text-white">
                {divergentes.length === 0 ? 'Tudo certo na seção' : `${divergentes.length} divergência(s)`}
            </h1>
            <p className="mb-4 text-sm text-gray-500">{itensOk} item(ns) batendo · {formatCurrency(valorDivergencia)} de diferença</p>

            {divergentes.length === 0 ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center dark:border-emerald-900 dark:bg-emerald-950/40">
                    <CheckCircle2 className="mx-auto mb-2 h-10 w-10 text-emerald-600" />
                    <p className="font-bold text-emerald-800 dark:text-emerald-200">Prateleira e sistema batem nesta seção.</p>
                </div>
            ) : (
                <ul className="space-y-3">
                    {divergentes.map(d => (
                        <li key={d.produto_id} className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
                            <div className="mb-2 flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <p className="truncate text-base font-bold text-gray-900 dark:text-white">{d.nome}</p>
                                    <p className="text-xs text-gray-500">
                                        deveria {d.quantidade_esperada} · contado {d.quantidade_contada} ·{' '}
                                        <span className={d.divergencia < 0 ? 'font-black text-red-600' : 'font-black text-blue-600'}>
                                            {d.divergencia > 0 ? '+' : ''}{d.divergencia} {d.unidade}
                                        </span>
                                        {d.fora_da_secao ? ' · não é desta seção' : ''}
                                    </p>
                                </div>
                                {d.divergencia < 0 && <AlertTriangle className="h-5 w-5 shrink-0 text-red-500" />}
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                                {botoesDecisao.map(botao => (
                                    <button
                                        key={botao.valor}
                                        onClick={() => setDecisoes(prev => ({ ...prev, [d.produto_id]: botao.valor }))}
                                        className={`min-h-12 rounded-lg px-2 text-xs font-black uppercase tracking-wide ${botao.classe} ${decisoes[d.produto_id] === botao.valor ? 'ring-4 ring-offset-1 ring-blue-300' : ''}`}
                                    >
                                        {botao.rotulo}
                                    </button>
                                ))}
                            </div>
                        </li>
                    ))}
                </ul>
            )}

            {divergentes.length > 0 && (
                <button
                    onClick={aplicar}
                    disabled={aplicando}
                    className="mt-5 flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-4 text-base font-black uppercase tracking-wide text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                    {aplicando ? <Loader2 className="h-5 w-5 animate-spin" /> : <Trash2 className="h-5 w-5" />}
                    Aplicar contagem
                </button>
            )}

            {divergentes.length === 0 && (
                <button
                    onClick={() => { setEtapa('secoes'); setContagem(null); }}
                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gray-100 px-4 py-3 text-sm font-black uppercase text-gray-700"
                >
                    <XCircle className="h-4 w-4" /> Fechar
                </button>
            )}
        </div>
    );
};

/** Nome da seção em branco não pode virar contagem "sem nome". */
function novasecaoSegura(valor: string): string {
    return valor.trim().slice(0, 80);
}

export default EstoqueCountsPage;
