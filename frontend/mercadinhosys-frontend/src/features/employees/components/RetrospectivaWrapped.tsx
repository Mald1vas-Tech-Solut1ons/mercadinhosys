import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight, Clock, ShoppingCart, Users, Package, Sparkles, TrendingUp, Bike, Route } from 'lucide-react';
import folhaService, { RetrospectivaData } from '../folhaService';
import { showToast } from '../../../components/elements/Toast';

/**
 * "Retrospectiva" premium estilo Spotify Wrapped — full-screen, em slides
 * animados, com contadores que sobem. Todos os números vêm da API real
 * (/rh/retrospectiva): horas de ponto, vendas, clientes, produtos e
 * conferências de mercadoria. Nada é inventado.
 */

interface Props {
    open: boolean;
    onClose: () => void;
    funcionarioId?: number;         // omitido = próprio usuário
    anoMes?: string;                // 'YYYY-MM' (default: mês atual no backend)
    dataInicio?: string;
    dataFim?: string;
}

// Hook de count-up: anima de 0 até `alvo` quando `ativo` fica true.
function useCountUp(alvo: number, ativo: boolean, duracaoMs = 1200) {
    const [valor, setValor] = useState(0);
    const rafRef = useRef<number | null>(null);
    useEffect(() => {
        if (!ativo) { setValor(0); return; }
        const inicio = performance.now();
        const passo = (agora: number) => {
            const t = Math.min(1, (agora - inicio) / duracaoMs);
            const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
            setValor(alvo * eased);
            if (t < 1) rafRef.current = requestAnimationFrame(passo);
            else setValor(alvo);
        };
        rafRef.current = requestAnimationFrame(passo);
        return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    }, [alvo, ativo, duracaoMs]);
    return valor;
}

const fmtInt = (n: number) => Math.round(n).toLocaleString('pt-BR');
const fmtMoeda = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface Slide {
    id: string;
    gradiente: string;
    icone: React.ReactNode;
    render: (v: number) => React.ReactNode;
    valor: number;
    formato: (n: number) => string;
}

export default function RetrospectivaWrapped({ open, onClose, funcionarioId, anoMes, dataInicio, dataFim }: Props) {
    const [dados, setDados] = useState<RetrospectivaData | null>(null);
    const [loading, setLoading] = useState(false);
    const [idx, setIdx] = useState(0);

    useEffect(() => {
        if (!open) return;
        setIdx(0);
        setLoading(true);
        folhaService.getRetrospectiva({
            funcionario_id: funcionarioId, ano_mes: anoMes, data_inicio: dataInicio, data_fim: dataFim,
        })
            .then(setDados)
            .catch((e: any) => { showToast.error(e?.response?.data?.message || 'Erro ao gerar retrospectiva'); onClose(); })
            .finally(() => setLoading(false));
    }, [open, funcionarioId, anoMes, dataInicio, dataFim]);

    const slides = useMemo<Slide[]>(() => {
        if (!dados) return [];
        const s: Slide[] = [];
        s.push({
            id: 'capa', gradiente: 'from-fuchsia-600 via-purple-600 to-indigo-700',
            icone: <Sparkles className="w-10 h-10" />, valor: 0, formato: fmtInt,
            render: () => (
                <div className="text-center">
                    <p className="text-white/80 font-bold uppercase tracking-[0.3em] text-sm mb-3">Sua Retrospectiva</p>
                    <h2 className="text-5xl font-black text-white leading-tight mb-4">{dados.nome.split(' ')[0]},<br />aqui vai o seu resumo ✨</h2>
                    <div className="inline-block mt-2 px-5 py-2 rounded-full bg-white/20 backdrop-blur text-white font-bold text-lg">{dados.persona}</div>
                    <p className="text-white/70 mt-6 text-sm">{dados.cargo} · {new Date(dados.periodo.inicio).toLocaleDateString('pt-BR')} a {new Date(dados.periodo.fim).toLocaleDateString('pt-BR')}</p>
                </div>
            ),
        });
        if (dados.ponto.horas_trabalhadas > 0) s.push({
            id: 'horas', gradiente: 'from-cyan-500 via-blue-600 to-indigo-700',
            icone: <Clock className="w-10 h-10" />, valor: dados.ponto.horas_trabalhadas, formato: (n) => fmtInt(n) + 'h',
            render: (v) => (
                <div className="text-center">
                    <p className="text-white/80 font-bold uppercase tracking-widest text-sm mb-4">Você dedicou</p>
                    <div className="text-7xl font-black text-white tabular-nums">{fmtInt(v)}<span className="text-4xl">h</span></div>
                    <p className="text-white/90 text-xl font-semibold mt-4">em {dados.ponto.dias_trabalhados} dias de trabalho</p>
                    {dados.ponto.horas_extras > 0 && (
                        <p className="text-white/80 mt-2">sendo <b>{dados.ponto.horas_extras.toLocaleString('pt-BR')}h</b> de hora extra 💪</p>
                    )}
                </div>
            ),
        });
        if (dados.vendas.total_vendas > 0) s.push({
            id: 'vendas', gradiente: 'from-emerald-500 via-green-600 to-teal-700',
            icone: <ShoppingCart className="w-10 h-10" />, valor: dados.vendas.total_vendas, formato: fmtInt,
            render: (v) => (
                <div className="text-center">
                    <p className="text-white/80 font-bold uppercase tracking-widest text-sm mb-4">Você realizou</p>
                    <div className="text-7xl font-black text-white tabular-nums">{fmtInt(v)}</div>
                    <p className="text-white/90 text-xl font-semibold mt-4">vendas no caixa 🛒</p>
                    <div className="mt-6 inline-flex items-center gap-2 px-5 py-2 rounded-full bg-white/20 backdrop-blur">
                        <TrendingUp className="w-5 h-5 text-white" />
                        <span className="text-white font-bold">{fmtMoeda(dados.vendas.faturamento)} movimentados</span>
                    </div>
                    <p className="text-white/70 mt-3 text-sm">Ticket médio de {fmtMoeda(dados.vendas.ticket_medio)}</p>
                </div>
            ),
        });
        if (dados.vendas.produtos_passados > 0 || dados.vendas.clientes_atendidos > 0) s.push({
            id: 'clientes', gradiente: 'from-orange-500 via-amber-600 to-rose-600',
            icone: <Users className="w-10 h-10" />, valor: dados.vendas.produtos_passados, formato: fmtInt,
            render: (v) => (
                <div className="text-center">
                    <p className="text-white/80 font-bold uppercase tracking-widest text-sm mb-4">Passaram pelas suas mãos</p>
                    <div className="text-7xl font-black text-white tabular-nums">{fmtInt(v)}</div>
                    <p className="text-white/90 text-xl font-semibold mt-4">produtos registrados 📦</p>
                    {dados.vendas.clientes_atendidos > 0 && (
                        <p className="text-white/80 mt-4">e você atendeu <b>{fmtInt(dados.vendas.clientes_atendidos)}</b> clientes 🤝</p>
                    )}
                </div>
            ),
        });
        if (dados.estoque.mercadorias_conferidas > 0) s.push({
            id: 'estoque', gradiente: 'from-violet-600 via-purple-700 to-fuchsia-700',
            icone: <Package className="w-10 h-10" />, valor: dados.estoque.mercadorias_conferidas, formato: fmtInt,
            render: (v) => (
                <div className="text-center">
                    <p className="text-white/80 font-bold uppercase tracking-widest text-sm mb-4">No estoque, você conferiu</p>
                    <div className="text-7xl font-black text-white tabular-nums">{fmtInt(v)}</div>
                    <p className="text-white/90 text-xl font-semibold mt-4">entradas de mercadoria 📥</p>
                    <p className="text-white/80 mt-2">totalizando <b>{fmtInt(dados.estoque.itens_conferidos)}</b> itens conferidos</p>
                </div>
            ),
        });
        // ---- Slides de ENTREGA (motoboy/entregador) ----
        const ent = dados.entrega;
        if (ent && ent.entregas_realizadas > 0) {
            s.push({
                id: 'entregas', gradiente: 'from-sky-500 via-cyan-600 to-teal-700',
                icone: <Bike className="w-10 h-10" />, valor: ent.entregas_realizadas, formato: fmtInt,
                render: (v) => (
                    <div className="text-center">
                        <p className="text-white/80 font-bold uppercase tracking-widest text-sm mb-4">Você fez</p>
                        <div className="text-7xl font-black text-white tabular-nums">{fmtInt(v)}</div>
                        <p className="text-white/90 text-xl font-semibold mt-4">entregas na rua 🛵</p>
                        <p className="text-white/80 mt-4">atendendo <b>{fmtInt(ent.clientes_atendidos)}</b> clientes em <b>{fmtInt(ent.bairros_visitados)}</b> bairros 🗺️</p>
                    </div>
                ),
            });
            s.push({
                id: 'km', gradiente: 'from-indigo-600 via-blue-700 to-slate-800',
                icone: <Route className="w-10 h-10" />, valor: ent.km_percorridos, formato: (n) => fmtInt(n) + ' km',
                render: (v) => (
                    <div className="text-center">
                        <p className="text-white/80 font-bold uppercase tracking-widest text-sm mb-4">Você percorreu</p>
                        <div className="text-7xl font-black text-white tabular-nums">{fmtInt(v)}<span className="text-3xl"> km</span></div>
                        <p className="text-white/90 text-xl font-semibold mt-4">na estrada 🏍️</p>
                        <p className="text-white/80 mt-4">transportando <b>{fmtInt(ent.produtos_transportados)}</b> produtos 📦</p>
                    </div>
                ),
            });
        }

        // Slide final: resumo consolidado
        const cardsFinal = [
            { l: 'Horas', v: fmtInt(dados.ponto.horas_trabalhadas) + 'h', c: 'text-cyan-300', on: dados.ponto.horas_trabalhadas > 0 },
            { l: 'Vendas', v: fmtInt(dados.vendas.total_vendas), c: 'text-emerald-300', on: dados.vendas.total_vendas > 0 },
            { l: 'Faturamento', v: fmtMoeda(dados.vendas.faturamento), c: 'text-green-300', on: dados.vendas.faturamento > 0 },
            { l: 'Conferências', v: fmtInt(dados.estoque.mercadorias_conferidas), c: 'text-violet-300', on: dados.estoque.mercadorias_conferidas > 0 },
            { l: 'Entregas', v: fmtInt(ent?.entregas_realizadas || 0), c: 'text-sky-300', on: !!ent && ent.entregas_realizadas > 0 },
            { l: 'Km rodados', v: fmtInt(ent?.km_percorridos || 0), c: 'text-blue-300', on: !!ent && ent.km_percorridos > 0 },
            { l: 'Bairros', v: fmtInt(ent?.bairros_visitados || 0), c: 'text-teal-300', on: !!ent && ent.bairros_visitados > 0 },
            { l: 'Clientes', v: fmtInt((dados.vendas.clientes_atendidos || 0) + (ent?.clientes_atendidos || 0)), c: 'text-amber-300', on: (dados.vendas.clientes_atendidos || 0) + (ent?.clientes_atendidos || 0) > 0 },
            { l: 'Produtos', v: fmtInt(dados.vendas.produtos_passados || ent?.produtos_transportados || 0), c: 'text-orange-300', on: (dados.vendas.produtos_passados || ent?.produtos_transportados || 0) > 0 },
        ].filter(m => m.on).slice(0, 6);
        s.push({
            id: 'final', gradiente: 'from-slate-800 via-gray-900 to-black',
            icone: <Sparkles className="w-10 h-10" />, valor: 0, formato: fmtInt,
            render: () => (
                <div className="text-center w-full">
                    <div className="inline-block px-5 py-2 rounded-full bg-white/15 backdrop-blur text-white font-black text-2xl mb-6">{dados.persona}</div>
                    <div className="grid grid-cols-2 gap-3 max-w-sm mx-auto">
                        {cardsFinal.map(m => (
                            <div key={m.l} className="bg-white/10 rounded-2xl p-4 backdrop-blur">
                                <p className={`text-2xl font-black ${m.c} tabular-nums leading-tight`}>{m.v}</p>
                                <p className="text-white/60 text-xs font-bold uppercase tracking-wider mt-1">{m.l}</p>
                            </div>
                        ))}
                    </div>
                    <p className="text-white/70 mt-6 text-sm">Obrigado por fazer a loja girar, {dados.nome.split(' ')[0]}! 🎉</p>
                </div>
            ),
        });
        return s;
    }, [dados]);

    const contador = useCountUp(slides[idx]?.valor || 0, open && !loading && slides.length > 0);

    // Teclado: setas navegam, ESC fecha
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'ArrowRight') setIdx(i => Math.min(i + 1, slides.length - 1));
            else if (e.key === 'ArrowLeft') setIdx(i => Math.max(i - 1, 0));
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, slides.length, onClose]);

    if (!open) return null;

    const slide = slides[idx];
    const avancar = () => setIdx(i => Math.min(i + 1, slides.length - 1));
    const voltar = () => setIdx(i => Math.max(i - 1, 0));

    return createPortal(
        <div className="fixed inset-0 z-300 flex items-center justify-center bg-black">
            {loading || !slide ? (
                <div className="flex flex-col items-center gap-4 text-white">
                    <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin" />
                    <p className="font-bold uppercase tracking-widest text-sm animate-pulse">Montando sua retrospectiva…</p>
                </div>
            ) : (
                <div className={`relative w-full h-full bg-linear-to-br ${slide.gradiente} transition-[background] duration-700 flex flex-col`}>
                    {/* Barras de progresso (stories) */}
                    <div className="flex gap-1.5 p-4 pt-[calc(1rem+env(safe-area-inset-top))]">
                        {slides.map((_, i) => (
                            <div key={i} className="flex-1 h-1 rounded-full bg-white/25 overflow-hidden">
                                <div className={`h-full bg-white transition-all duration-300 ${i < idx ? 'w-full' : i === idx ? 'w-full' : 'w-0'}`} />
                            </div>
                        ))}
                    </div>

                    <button onClick={onClose} aria-label="Fechar"
                        className="absolute top-[calc(1.5rem+env(safe-area-inset-top))] right-4 z-20 p-2 rounded-full bg-black/20 text-white hover:bg-black/40 transition-colors">
                        <X className="w-6 h-6" />
                    </button>

                    {/* Conteúdo do slide */}
                    <div key={slide.id} className="flex-1 flex flex-col items-center justify-center px-8 animate-in fade-in zoom-in-95 duration-500">
                        <div className="mb-8 p-5 rounded-full bg-white/15 backdrop-blur text-white shadow-2xl">{slide.icone}</div>
                        {slide.valor > 0 ? (
                            <div className="w-full">{slide.render(contador)}</div>
                        ) : (
                            <div className="w-full">{slide.render(0)}</div>
                        )}
                    </div>

                    {/* Zonas de toque para navegar (mobile) */}
                    <button aria-label="Anterior" onClick={voltar} className="absolute left-0 top-16 bottom-0 w-1/3" />
                    <button aria-label="Próximo" onClick={avancar} className="absolute right-0 top-16 bottom-0 w-1/3" />

                    {/* Navegação visível (desktop) */}
                    <div className="flex items-center justify-between p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
                        <button onClick={voltar} disabled={idx === 0}
                            className="p-3 rounded-full bg-white/15 text-white disabled:opacity-0 hover:bg-white/25 transition-all">
                            <ChevronLeft className="w-6 h-6" />
                        </button>
                        <span className="text-white/60 text-xs font-bold">{idx + 1} / {slides.length}</span>
                        {idx < slides.length - 1 ? (
                            <button onClick={avancar} className="p-3 rounded-full bg-white/15 text-white hover:bg-white/25 transition-all">
                                <ChevronRight className="w-6 h-6" />
                            </button>
                        ) : (
                            <button onClick={onClose} className="px-5 py-3 rounded-full bg-white text-gray-900 font-black text-sm hover:scale-105 transition-transform">
                                Concluir
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>,
        document.body
    );
}
