import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronDown, ChevronUp, MessageCircle, Play, XCircle } from 'lucide-react';
import { NICHOS, rotaNicho, linkWhatsApp } from './site';
import { useSeo } from './useSeo';
import SegmentosGrid, { IconeNicho } from './SegmentosGrid';
import { entrarNaDemo } from './entrarNaDemo';
import { ChatMIA, FaleComDesenvolvedor, ImplantaComVoce, OfertaDoisMeses, PrimeiraCliente, RodapeRegioes } from './BlocosVenda';

/**
 * Página de um nicho ("sistema para tabacaria", "sistema para loja de roupas"...).
 * Mesmo visual da landing, texto falando a língua daquele lojista.
 */
const NichoPage: React.FC<{ slug: string }> = ({ slug }) => {
    const navigate = useNavigate();
    const nicho = NICHOS.find(n => n.slug === slug)!;
    const [faqAberta, setFaqAberta] = useState<number | null>(0);
    useSeo(nicho.seoTitle, nicho.seoDescription, rotaNicho(slug));

    const whats = linkWhatsApp(`Olá! Tenho ${nicho.nome.toLowerCase()} e quero conhecer o MercadinhoSys com os 2 meses grátis.`);
    const secao = 'max-w-6xl mx-auto px-4 sm:px-6 lg:px-8';

    return (
        <div className="min-h-dvh bg-[#0A1220] font-['Space_Grotesk',sans-serif] text-[#DCE8F7] overflow-x-hidden">
            <nav className="sticky top-0 z-50 bg-[#0A1220]/90 backdrop-blur-xl border-b border-[#24344F]">
                <div className={`${secao} flex items-center justify-between h-16`}>
                    <Link to="/" className="flex items-center gap-2 min-w-0">
                        <img src="/assets/logo.png" alt="MercadinhoSys" className="w-9 h-9 rounded-lg" />
                        <span className="text-xl font-bold text-white tracking-tighter truncate">Mercadinho<span className="text-[#FF6A5C]">Sys</span></span>
                    </Link>
                    <a href={whats} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 text-white font-bold text-sm">
                        <MessageCircle className="w-4 h-4" /> <span className="hidden sm:inline">Falar no</span> WhatsApp
                    </a>
                </div>
            </nav>

            <header className={`${secao} pt-10 pb-14 sm:pt-16 sm:pb-20`}>
                <Link to="/#segmentos" className="inline-flex items-center gap-1 text-sm text-[#8FA3C0] hover:text-white mb-6">
                    <ArrowLeft className="w-4 h-4" /> Outros tipos de comércio
                </Link>
                <div className="grid lg:grid-cols-2 gap-10 items-center">
                    <div>
                        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#2E9BFF]/10 border border-[#2E9BFF]/30 text-[#6FCBFF] text-xs font-bold uppercase tracking-widest mb-5">
                            <IconeNicho icone={nicho.icone} className="w-4 h-4" /> {nicho.nome}
                        </span>
                        <h1 className="text-3xl sm:text-5xl font-bold text-white leading-tight mb-5">{nicho.h1}</h1>
                        <p className="text-lg sm:text-xl text-[#8FA3C0] mb-8">{nicho.subtitulo}</p>
                        <div className="flex flex-col sm:flex-row gap-3">
                            <a href={whats} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 px-6 py-4 rounded-xl bg-[#2E9BFF] text-[#0A1220] font-bold text-lg hover:bg-[#6FCBFF] transition-colors">
                                Quero 2 meses grátis
                            </a>
                            <button type="button" onClick={entrarNaDemo} className="inline-flex items-center justify-center gap-2 px-6 py-4 rounded-xl bg-[#101C31] border border-[#24344F] text-white font-bold text-lg hover:bg-[#1A2C4D] transition-colors">
                                <Play className="w-5 h-5" /> Ver funcionando
                            </button>
                        </div>
                        <p className="text-sm text-[#8FA3C0] mt-4">Só paga se fizer sentido para o seu negócio. Sem fidelidade.</p>
                    </div>
                    <ChatMIA exemplo={nicho.exemploIA} />
                </div>
            </header>

            <section className="py-14 bg-[#101C31] border-y border-[#24344F]">
                <div className={secao}>
                    <h2 className="text-2xl sm:text-3xl font-bold text-white mb-8 text-center">Isso acontece na sua loja?</h2>
                    <div className="grid md:grid-cols-3 gap-4">
                        {nicho.dores.map(d => (
                            <div key={d} className="flex gap-3 p-5 rounded-2xl bg-[#0A1220] border border-red-500/20">
                                <XCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                                <p className="text-[#DCE8F7]">{d}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            <section className="py-16">
                <div className={secao}>
                    <h2 className="text-2xl sm:text-4xl font-bold text-white mb-3 text-center">O sistema que trabalha por você</h2>
                    <p className="text-[#8FA3C0] text-center mb-10 max-w-2xl mx-auto">O que o MercadinhoSys faz no dia a dia de quem tem {nicho.nome.toLowerCase()}.</p>
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {nicho.recursos.map(r => (
                            <div key={r.titulo} className="p-6 rounded-2xl bg-[#101C31] border border-[#24344F]">
                                <p className="text-lg font-bold text-white mb-2">{r.titulo}</p>
                                <p className="text-[#8FA3C0]">{r.texto}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            <section className="py-16 bg-[#101C31] border-y border-[#24344F]">
                <div className={secao}>
                    <h2 className="text-2xl sm:text-4xl font-bold text-white mb-10 text-center">A gente implanta com você</h2>
                    <ImplantaComVoce />
                    <div className="mt-10"><FaleComDesenvolvedor /></div>
                </div>
            </section>

            <section className="py-16"><div className={secao}><PrimeiraCliente /></div></section>

            <section className="py-16 bg-[#101C31] border-y border-[#24344F]">
                <div className={secao}>
                    <OfertaDoisMeses origem={nicho.nome} onCadastro={() => navigate('/register')} />
                </div>
            </section>

            <section className="py-16">
                <div className="max-w-3xl mx-auto px-4 sm:px-6">
                    <h2 className="text-2xl sm:text-3xl font-bold text-white mb-8 text-center">Perguntas de quem tem {nicho.nome.toLowerCase()}</h2>
                    <div className="space-y-3">
                        {nicho.faq.map((f, i) => (
                            <div key={f.q} className="rounded-2xl bg-[#101C31] border border-[#24344F] overflow-hidden">
                                <button type="button" onClick={() => setFaqAberta(faqAberta === i ? null : i)} className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left">
                                    <span className="font-bold text-white">{f.q}</span>
                                    {faqAberta === i ? <ChevronUp className="w-5 h-5 text-[#2E9BFF] shrink-0" /> : <ChevronDown className="w-5 h-5 text-[#8FA3C0] shrink-0" />}
                                </button>
                                {faqAberta === i && <p className="px-5 pb-5 text-[#8FA3C0]">{f.a}</p>}
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            <section className="py-14 bg-[#101C31] border-t border-[#24344F]">
                <div className={secao}>
                    <h2 className="text-xl sm:text-2xl font-bold text-white mb-6 text-center">Também atendemos</h2>
                    <SegmentosGrid excluir={slug} />
                </div>
            </section>

            <footer className="py-10 border-t border-[#24344F]"><div className={secao}><RodapeRegioes /></div></footer>
        </div>
    );
};

export default NichoPage;
