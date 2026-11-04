import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronUp, MapPin, MessageCircle, Play } from 'lucide-react';
import { REGIOES, VENDAS, rotaRegiao, linkWhatsApp, imagemOg, naRegiao, PRAZO_RESPOSTA } from './site';
import Trilha from './Trilha';
import { useSeo } from './useSeo';
import SegmentosGrid from './SegmentosGrid';
import MapaDoSite from './MapaDoSite';
import BannerCookies from './BannerCookies';
import { FaleComDesenvolvedor, OfertaDoisMeses, PrimeiraCliente, TrabalhosDoSistema } from './BlocosVenda';
import { BarraFixaCelular, DemoInterativa } from './SecoesVenda';

/**
 * Página de região com atendimento presencial ("sistema para comércio em Guarulhos").
 * É o SEO local: bairros citados, implantação na loja e área atendida nos dados estruturados.
 */
const RegiaoPage: React.FC<{ slug: string }> = ({ slug }) => {
    const navigate = useNavigate();
    const regiao = REGIOES.find(r => r.slug === slug)!;
    const [faqAberta, setFaqAberta] = useState<number | null>(0);
    useSeo(regiao.seoTitle, regiao.seoDescription, rotaRegiao(slug), imagemOg(`comercio-${slug}`));

    const whats = linkWhatsApp(`Olá! Tenho um comércio ${naRegiao(regiao)} e quero a implantação do MercadinhoSys com os 2 meses grátis.`);
    const secao = 'max-w-6xl mx-auto px-4 sm:px-6 lg:px-8';
    const titulo = 'text-3xl sm:text-4xl font-bold text-white leading-tight';

    return (
        <div className="min-h-dvh bg-[#0A1220] font-['Space_Grotesk',sans-serif] text-[#DCE8F7] overflow-x-hidden pb-20 md:pb-0">
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

            <header className={`${secao} pt-8 pb-16 sm:pt-14 sm:pb-20`}>
                <Trilha itens={[{ nome: 'Início', para: '/' }, { nome: 'Atendimento presencial' }, { nome: regiao.nome }]} />
                <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-bold uppercase tracking-widest mb-5">
                    <MapPin className="w-4 h-4" /> Atendimento presencial · {regiao.nome}
                </span>
                <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white leading-[1.08] mb-5 max-w-4xl">{regiao.h1}</h1>
                <p className="text-lg sm:text-xl text-[#8FA3C0] mb-8 max-w-3xl">{regiao.subtitulo}</p>
                <div className="flex flex-col sm:flex-row gap-3">
                    <a href={whats} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center px-7 py-4 rounded-xl bg-[#FFD43B] text-[#0A1220] font-black text-lg">Agendar visita na minha loja</a>
                    <a href="#demo" className="inline-flex items-center justify-center gap-2 px-7 py-4 rounded-xl bg-[#101C31] border border-[#24344F] text-white font-bold text-lg"><Play className="w-5 h-5" /> Ver funcionando</a>
                </div>
                <p className="text-sm text-[#8FA3C0] mt-4">{PRAZO_RESPOSTA}</p>
            </header>

            <section className="py-16 bg-[#101C31] border-y border-[#24344F]">
                <div className={`${secao} grid lg:grid-cols-2 gap-10`}>
                    <div className="space-y-5 text-lg text-[#DCE8F7] leading-relaxed">
                        {regiao.intro.map(p => <p key={p.slice(0, 30)}>{p}</p>)}
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-white mb-4">Bairros atendidos {naRegiao(regiao)}</h2>
                        <ul className="flex flex-wrap gap-2">
                            {regiao.bairros.map(b => (
                                <li key={b} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#0A1220] border border-[#24344F] text-sm"><MapPin className="w-3.5 h-3.5 text-emerald-400" /> {b}</li>
                            ))}
                        </ul>
                        <p className="text-sm text-[#8FA3C0] mt-4">Não achou o seu bairro? Chame no WhatsApp: atendemos a região.</p>
                    </div>
                </div>
            </section>

            <section className="py-16">
                <div className={secao}>
                    <h2 className={`${titulo} text-center mb-10`}>Como funciona a implantação {naRegiao(regiao)}</h2>
                    <div className="grid md:grid-cols-3 gap-4 sm:gap-6">
                        {regiao.comoFunciona.map((p, i) => (
                            <div key={p.titulo} className="p-6 sm:p-8 rounded-[20px] bg-[#101C31] border border-[#24344F]">
                                <span className="w-12 h-12 rounded-full bg-[#2E9BFF] text-white font-black text-xl flex items-center justify-center mb-4">{i + 1}</span>
                                <p className="text-lg font-bold text-white mb-2">{p.titulo}</p>
                                <p className="text-[#8FA3C0]">{p.texto}</p>
                            </div>
                        ))}
                    </div>
                    <div className="mt-10"><FaleComDesenvolvedor /></div>
                </div>
            </section>

            <section className="py-16 bg-[#101C31] border-y border-[#24344F]">
                <div className={secao}>
                    <h2 className={`${titulo} text-center mb-3`}>Qual é o seu tipo de comércio?</h2>
                    <p className="text-[#8FA3C0] text-center mb-10">Cada segmento tem uma página com o sistema funcionando para ele.</p>
                    <SegmentosGrid />
                </div>
            </section>

            <section className="py-16">
                <div className={secao}>
                    <h2 className={`${titulo} text-center mb-10`}>O sistema que trabalha por você</h2>
                    <TrabalhosDoSistema />
                </div>
            </section>

            <section id="demo" className="py-16 bg-[#101C31] border-y border-[#24344F] scroll-mt-20">
                <div className={secao}>
                    <h2 className={`${titulo} text-center mb-10`}>Toque e veja funcionando</h2>
                    <DemoInterativa venda={VENDAS.mercadinho} origem={regiao.nome} />
                </div>
            </section>

            <section className="py-16"><div className={secao}><PrimeiraCliente /></div></section>

            <section className="py-16 bg-[#101C31] border-y border-[#24344F]">
                <div className={secao}><OfertaDoisMeses origem={regiao.nome} onCadastro={() => navigate('/register')} /></div>
            </section>

            <section className="py-16">
                <div className="max-w-3xl mx-auto px-4 sm:px-6">
                    <h2 className="text-2xl sm:text-3xl font-bold text-white mb-8 text-center">Perguntas de quem tem comércio {naRegiao(regiao)}</h2>
                    <div className="space-y-3">
                        {regiao.faq.map((f, i) => (
                            <div key={f.q} className="rounded-2xl bg-[#101C31] border border-[#24344F] overflow-hidden">
                                <button type="button" onClick={() => setFaqAberta(faqAberta === i ? null : i)} aria-expanded={faqAberta === i} className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left">
                                    <span className="font-bold text-white">{f.q}</span>
                                    {faqAberta === i ? <ChevronUp className="w-5 h-5 text-[#2E9BFF] shrink-0" /> : <ChevronDown className="w-5 h-5 text-[#8FA3C0] shrink-0" />}
                                </button>
                                {faqAberta === i && <p className="px-5 pb-5 text-[#8FA3C0]">{f.a}</p>}
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            <footer className="py-12 border-t border-[#24344F]"><MapaDoSite /></footer>
            <BannerCookies />
            <BarraFixaCelular origem={regiao.nome} onCadastro={() => navigate('/register')} />
        </div>
    );
};

export default RegiaoPage;
