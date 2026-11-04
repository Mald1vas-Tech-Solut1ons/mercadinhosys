import React, { useState } from 'react';
import {
    XCircle, CheckCircle2, Clock, ShoppingCart, Package, Sparkles, Users, AlertTriangle, Play, MessageCircle, Calculator, ShieldCheck,
} from 'lucide-react';
import type { NichoVenda } from './site';
import { linkWhatsApp } from './site';
import { entrarNaDemo } from './entrarNaDemo';

/*
 * Seções de venda das páginas públicas. Cada uma ataca um ponto da decisão do
 * lojista: reconhecer a dor (antes x depois), se ver usando (dia na loja e
 * demonstração), sentir o custo de não ter (calculadora) e perder o medo (objeção).
 */

const moeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Dor do lojista ao lado do que muda com o sistema. */
export const AntesDepois: React.FC<{ dores: string[]; depois: string[] }> = ({ dores, depois }) => (
    <div className="space-y-4">
        <div className="hidden md:grid grid-cols-2 gap-4 text-xs font-black uppercase tracking-widest">
            <p className="text-red-400">Hoje, sem sistema</p>
            <p className="text-emerald-400">Com o MercadinhoSys</p>
        </div>
        {dores.map((dor, i) => (
            <div key={dor} className="grid md:grid-cols-2 gap-2 md:gap-4">
                <div className="flex gap-3 p-5 rounded-2xl bg-[#0A1220] border border-red-500/25">
                    <XCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                    <p className="text-[#DCE8F7]">{dor}</p>
                </div>
                <div className="flex gap-3 p-5 rounded-2xl bg-emerald-500/5 border border-emerald-500/30">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                    <p className="text-white font-semibold">{depois[i]}</p>
                </div>
            </div>
        ))}
    </div>
);

/** Linha do tempo de um dia de trabalho com o sistema. */
export const DiaNaLoja: React.FC<{ dia: NichoVenda['diaNaLoja'] }> = ({ dia }) => (
    <ol className="relative grid md:grid-cols-4 gap-4">
        {dia.map(passo => (
            <li key={passo.hora} className="p-6 rounded-2xl bg-[#101C31] border border-[#24344F]">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#2E9BFF]/10 border border-[#2E9BFF]/30 text-[#6FCBFF] text-sm font-black mb-4">
                    <Clock className="w-4 h-4" /> {passo.hora}
                </span>
                <p className="text-lg font-bold text-white mb-2">{passo.titulo}</p>
                <p className="text-[#8FA3C0] text-sm">{passo.texto}</p>
            </li>
        ))}
    </ol>
);

type Aba = 'caixa' | 'estoque' | 'ia' | 'fiado';

/** Demonstração com os produtos do nicho: o lojista toca e vê o sistema reagir. */
export const DemoInterativa: React.FC<{ venda: NichoVenda; origem: string }> = ({ venda, origem }) => {
    const [aba, setAba] = useState<Aba>('caixa');
    const [carrinho, setCarrinho] = useState<number[]>([0, 2]);
    const itens = carrinho.map(i => venda.produtosDemo[i]);
    const total = itens.reduce((s, p) => s + p.preco, 0);
    const alertaFiado = venda.alertas.find(a => /fiado|crediário|limite/i.test(a)) || venda.alertas[venda.alertas.length - 1];

    const abas: { id: Aba; rotulo: string; icone: React.ElementType }[] = [
        { id: 'caixa', rotulo: 'Caixa', icone: ShoppingCart },
        { id: 'estoque', rotulo: 'Estoque', icone: Package },
        { id: 'ia', rotulo: 'IA', icone: Sparkles },
        { id: 'fiado', rotulo: 'Fiado', icone: Users },
    ];

    return (
        <div className="grid lg:grid-cols-5 gap-8 items-start">
            <div className="lg:col-span-3 rounded-[24px] border border-[#24344F] bg-[#0A1220] overflow-hidden shadow-[0_0_60px_rgba(46,155,255,0.12)]">
                <div className="flex border-b border-[#24344F] overflow-x-auto [scrollbar-width:none]">
                    {abas.map(({ id, rotulo, icone: Icone }) => (
                        <button
                            key={id} type="button" onClick={() => setAba(id)}
                            className={`flex-1 min-w-[84px] flex items-center justify-center gap-2 px-3 py-4 text-sm font-bold transition-colors ${aba === id ? 'text-white bg-[#101C31] border-b-2 border-[#2E9BFF]' : 'text-[#8FA3C0] hover:text-white'}`}
                        >
                            <Icone className="w-4 h-4" /> {rotulo}
                        </button>
                    ))}
                </div>

                <div className="p-5 sm:p-6 min-h-[340px]">
                    {aba === 'caixa' && (
                        <div>
                            <p className="text-xs text-[#8FA3C0] mb-3">Toque nos produtos para bipar:</p>
                            <div className="flex flex-wrap gap-2 mb-5">
                                {venda.produtosDemo.map((p, i) => (
                                    <button key={p.nome} type="button" onClick={() => setCarrinho(c => [...c, i])}
                                        className="px-3 py-2 rounded-xl bg-[#101C31] border border-[#24344F] hover:border-[#2E9BFF] text-sm text-white text-left">
                                        {p.nome}
                                    </button>
                                ))}
                            </div>
                            <ul className="divide-y divide-[#24344F] border border-[#24344F] rounded-xl mb-4">
                                {itens.map((p, i) => (
                                    <li key={i} className="flex justify-between gap-3 px-4 py-2.5 text-sm">
                                        <span className="text-[#DCE8F7] min-w-0 truncate">{p.nome}</span>
                                        <span className="text-white font-bold shrink-0">{moeda(p.preco)}</span>
                                    </li>
                                ))}
                                {itens.length === 0 && <li className="px-4 py-3 text-sm text-[#8FA3C0]">Carrinho vazio</li>}
                            </ul>
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <p className="text-xs text-[#8FA3C0]">Total</p>
                                    <p className="text-3xl font-black text-white">{moeda(total)}</p>
                                </div>
                                <div className="flex flex-wrap justify-end gap-2 text-xs font-bold">
                                    {['Dinheiro', 'Pix', 'Cartão', 'Fiado'].map(f => (
                                        <span key={f} className="px-3 py-2 rounded-lg bg-[#2E9BFF]/10 border border-[#2E9BFF]/30 text-[#6FCBFF]">{f}</span>
                                    ))}
                                </div>
                            </div>
                            <button type="button" onClick={() => setCarrinho([])} className="mt-4 text-xs text-[#8FA3C0] hover:text-white">Limpar carrinho</button>
                        </div>
                    )}

                    {aba === 'estoque' && (
                        <div>
                            <ul className="space-y-2 mb-5">
                                {venda.produtosDemo.map(p => {
                                    const baixo = p.estoque <= 3;
                                    return (
                                        <li key={p.nome} className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-[#101C31] border border-[#24344F]">
                                            <span className="text-sm text-[#DCE8F7] min-w-0 truncate">{p.nome}</span>
                                            <span className={`shrink-0 text-xs font-black px-2.5 py-1 rounded-full ${baixo ? 'bg-red-500/15 text-red-300' : 'bg-emerald-500/10 text-emerald-300'}`}>
                                                {p.estoque} {baixo ? '· repor' : 'em estoque'}
                                            </span>
                                        </li>
                                    );
                                })}
                            </ul>
                            <p className="text-xs font-black uppercase tracking-widest text-amber-400 mb-2">Avisos de hoje</p>
                            <ul className="space-y-2">
                                {venda.alertas.map(a => (
                                    <li key={a} className="flex gap-2 text-sm text-[#DCE8F7]"><AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" /> {a}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {aba === 'ia' && (
                        <div className="space-y-3 text-sm">
                            <p className="ml-auto max-w-[85%] bg-[#2E9BFF] text-white rounded-2xl rounded-tr-sm p-3">{venda.perguntaIA}</p>
                            <div className="max-w-[90%] bg-[#101C31] border border-[#24344F] text-[#DCE8F7] rounded-2xl rounded-tl-sm p-3">
                                <p className="flex items-center gap-1.5 text-xs font-bold text-[#FFD43B] mb-1"><Sparkles className="w-3.5 h-3.5" /> Consultor M-IA</p>
                                {venda.respostaIA}
                            </div>
                            <p className="inline-flex items-center gap-2 bg-[#FFD43B] text-[#0A1220] font-bold rounded-xl px-3 py-2"><ShoppingCart className="w-4 h-4" /> Gerar pedido de compra</p>
                            <p className="text-xs text-[#8FA3C0] pt-2">Na sua loja, as respostas vêm dos seus números de verdade.</p>
                        </div>
                    )}

                    {aba === 'fiado' && (
                        <div className="space-y-4">
                            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-sm flex gap-2">
                                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {alertaFiado}
                            </div>
                            <div className="p-4 rounded-xl bg-[#101C31] border border-[#24344F] text-sm space-y-2">
                                <p className="text-[#8FA3C0]">Limite do cliente, histórico de compras e o que está em aberto, tudo na ficha dele.</p>
                                <p className="inline-flex items-center gap-2 bg-emerald-600 text-white font-bold rounded-xl px-3 py-2"><MessageCircle className="w-4 h-4" /> Cobrar pelo WhatsApp</p>
                            </div>
                        </div>
                    )}
                </div>
                <p className="px-5 sm:px-6 pb-4 text-[11px] text-[#4F6A8F]">Demonstração com dados de exemplo.</p>
            </div>

            <div className="lg:col-span-2 space-y-4">
                <p className="text-2xl font-bold text-white">Quer ver com a sua loja?</p>
                <p className="text-[#8FA3C0]">Entre agora na loja de demonstração, com o sistema de verdade, ou peça para o desenvolvedor mostrar funcionando com os seus produtos.</p>
                <button type="button" onClick={entrarNaDemo} className="w-full inline-flex items-center justify-center gap-2 px-6 py-4 rounded-xl bg-[#2E9BFF] text-[#0A1220] font-bold text-lg hover:bg-[#6FCBFF] transition-colors">
                    <Play className="w-5 h-5" /> Entrar na demonstração ao vivo
                </button>
                <a href={linkWhatsApp(`Olá! Quero uma demonstração do MercadinhoSys na minha loja (${origem}).`)} target="_blank" rel="noreferrer"
                    className="w-full inline-flex items-center justify-center gap-2 px-6 py-4 rounded-xl bg-[#101C31] border border-[#24344F] text-white font-bold text-lg hover:bg-[#1A2C4D] transition-colors">
                    <MessageCircle className="w-5 h-5" /> Demonstração na minha loja
                </a>
            </div>
        </div>
    );
};

/** "Quanto você perde por mês?": o custo de NÃO ter controle, ao lado da mensalidade. */
export const CalculadoraPerdas: React.FC = () => {
    const [fiado, setFiado] = useState(300);
    const [vencido, setVencido] = useState(200);
    const [falta, setFalta] = useState(300);
    const perda = fiado + vencido + falta;
    const linhas = [
        { rotulo: 'Fiado que você esquece de cobrar', valor: fiado, set: setFiado, max: 2000 },
        { rotulo: 'Produto que vence ou some do estoque', valor: vencido, set: setVencido, max: 2000 },
        { rotulo: 'Venda perdida porque faltou mercadoria', valor: falta, set: setFalta, max: 3000 },
    ];
    return (
        <div className="grid lg:grid-cols-2 gap-8 items-center rounded-[28px] bg-[#0A1220] border border-[#24344F] p-6 sm:p-10">
            <div className="space-y-6">
                {linhas.map(l => (
                    <label key={l.rotulo} className="block">
                        <span className="flex justify-between gap-3 text-sm text-[#DCE8F7] mb-2">
                            <span>{l.rotulo}</span><strong className="text-white shrink-0">{moeda(l.valor)}/mês</strong>
                        </span>
                        <input type="range" min={0} max={l.max} step={50} value={l.valor} onChange={e => l.set(Number(e.target.value))} className="w-full accent-[#2E9BFF]" />
                    </label>
                ))}
            </div>
            <div className="text-center lg:text-left">
                <Calculator className="w-8 h-8 text-[#FFD43B] mb-3 mx-auto lg:mx-0" />
                <p className="text-[#8FA3C0]">Você pode estar perdendo</p>
                <p className="text-5xl font-black text-red-400 my-2">{moeda(perda)}<span className="text-xl text-[#8FA3C0] font-bold">/mês</span></p>
                <p className="text-[#8FA3C0] mb-4">sem perceber. O MercadinhoSys custa <strong className="text-white">R$ 99,90/mês</strong>, e os 2 primeiros meses são grátis.</p>
                <p className="text-xs text-[#4F6A8F]">Ajuste os valores com a realidade da sua loja. É uma conta sua, não uma promessa nossa.</p>
            </div>
        </div>
    );
};

/** A objeção mais forte daquele lojista, respondida sem rodeio. */
export const QuebraObjecao: React.FC<{ objecao: string; resposta: string }> = ({ objecao, resposta }) => (
    <div className="max-w-3xl mx-auto rounded-[24px] bg-[#101C31] border border-[#24344F] p-6 sm:p-10">
        <p className="text-sm font-black uppercase tracking-widest text-[#8FA3C0] mb-3">"{objecao}"</p>
        <p className="text-xl sm:text-2xl font-bold text-white mb-6">{resposta}</p>
        <div className="flex items-center gap-3 text-emerald-300 font-semibold">
            <ShieldCheck className="w-6 h-6 shrink-0" /> Use 2 meses de graça. Se não fizer sentido, você não paga nada.
        </div>
    </div>
);

/** Barra fixa no celular: o próximo passo sempre a um toque. */
export const BarraFixaCelular: React.FC<{ origem: string; onCadastro: () => void }> = ({ origem, onCadastro }) => (
    <div className="md:hidden fixed bottom-0 inset-x-0 z-50 flex gap-2 p-3 bg-[#0A1220]/95 backdrop-blur border-t border-[#24344F]" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
        <a href={linkWhatsApp(`Olá! Vi o MercadinhoSys (${origem}) e quero os 2 meses grátis.`)} target="_blank" rel="noreferrer"
            className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-500 text-white font-bold">
            <MessageCircle className="w-5 h-5" /> WhatsApp
        </a>
        <button type="button" onClick={onCadastro} className="flex-1 py-3 rounded-xl bg-[#FFD43B] text-[#0A1220] font-black">
            2 meses grátis
        </button>
    </div>
);
