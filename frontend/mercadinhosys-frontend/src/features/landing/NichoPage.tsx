import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, ChevronDown, ChevronUp, MessageCircle, Play } from 'lucide-react';
import { NICHOS, VENDAS, rotaNicho, linkWhatsApp, imagemOg, PRAZO_RESPOSTA } from './site';
import Trilha from './Trilha';
import { rastrearEvento } from './telemetria';
import { useSeo } from './useSeo';
import SegmentosGrid, { IconeNicho } from './SegmentosGrid';
import MapaDoSite from './MapaDoSite';
import BannerCookies from './BannerCookies';
import { entrarNaDemo } from './entrarNaDemo';
import { ChatMIA, FaleComDesenvolvedor, ImplantaComVoce, OfertaDoisMeses, PrimeiraCliente } from './BlocosVenda';
import { AntesDepois, BarraFixaCelular, CalculadoraPerdas, DemoInterativa, DiaNaLoja, QuebraObjecao } from './SecoesVenda';

/**
 * Página de vendas de um nicho ("sistema para tabacaria", "sistema para loja de roupas"...).
 * Ordem pensada para a decisão do lojista: reconhecer a dor, ver o sistema na rotina dele,
 * mexer na demonstração, sentir o custo de não ter, confiar (Vera, desenvolvedor) e agir.
 */
const NichoPage: React.FC<{ slug: string }> = ({ slug }) => {
    const navigate = useNavigate();
    const nicho = NICHOS.find(n => n.slug === slug)!;
    const venda = VENDAS[slug];
    const [faqAberta, setFaqAberta] = useState<number | null>(0);
    useSeo(nicho.seoTitle, nicho.seoDescription, rotaNicho(slug), imagemOg(slug));

    const nomeMinusculo = nicho.nome.toLowerCase();
    const whats = linkWhatsApp(`Olá! Tenho ${nomeMinusculo} e quero conhecer o MercadinhoSys com os 2 meses grátis.`);
    const secao = 'max-w-6xl mx-auto px-4 sm:px-6 lg:px-8';
    const titulo = 'text-3xl sm:text-4xl font-bold text-white leading-tight';
    const rotulo = 'text-xs font-black uppercase tracking-[2px] mb-3';

    return (
        <div className="min-h-dvh bg-[#0A1220] font-['Space_Grotesk',sans-serif] text-[#DCE8F7] overflow-x-hidden pb-20 md:pb-0">
            <nav className="sticky top-0 z-50 bg-[#0A1220]/90 backdrop-blur-xl border-b border-[#24344F]">
                <div className={`${secao} flex items-center justify-between h-16`}>
                    <Link to="/" className="flex items-center gap-2 min-w-0">
                        <img src="/assets/logo.png" alt="MercadinhoSys" className="w-9 h-9 rounded-lg" />
                        <span className="text-xl font-bold text-white tracking-tighter truncate">Mercadinho<span className="text-[#FF6A5C]">Sys</span></span>
                    </Link>
                    <div className="flex items-center gap-2">
                        <a href="#demo" className="hidden sm:inline-flex px-4 py-2 rounded-xl text-sm font-bold text-[#DCE8F7] hover:text-white">Ver funcionando</a>
                        <a data-evento="whatsapp" data-rotulo="nicho-menu" href={whats} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 text-white font-bold text-sm">
                            <MessageCircle className="w-4 h-4" /> <span className="hidden sm:inline">Falar no</span> WhatsApp
                        </a>
                    </div>
                </div>
            </nav>

            {/* 1. Topo: promessa do nicho + prova */}
            <header className="relative overflow-hidden">
                <div className="absolute -top-40 -right-40 w-[600px] h-[600px] bg-[#1D4ED8]/20 rounded-full blur-[120px] pointer-events-none" />
                <div className={`${secao} relative pt-8 pb-16 sm:pt-14 sm:pb-24`}>
                    <Trilha itens={[{ nome: 'Início', para: '/' }, { nome: 'Segmentos', para: '/#segmentos' }, { nome: nicho.nome }]} />
                    <div className="grid lg:grid-cols-2 gap-10 items-center">
                        <div>
                            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#2E9BFF]/10 border border-[#2E9BFF]/30 text-[#6FCBFF] text-xs font-bold uppercase tracking-widest mb-5">
                                <IconeNicho icone={nicho.icone} className="w-4 h-4" /> Sistema para {nomeMinusculo}
                            </span>
                            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white leading-[1.08] mb-5">{nicho.h1}</h1>
                            <p className="text-lg sm:text-xl text-[#8FA3C0] mb-7">{nicho.subtitulo}</p>
                            <ul className="grid grid-cols-2 gap-2 mb-8 text-sm text-[#DCE8F7]">
                                {['2 meses grátis', 'Sem cartão para começar', 'Implantação na sua loja', 'Fale com quem fez'].map(s => (
                                    <li key={s} className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400 shrink-0" /> {s}</li>
                                ))}
                            </ul>
                            <div className="flex flex-col sm:flex-row gap-3">
                                <a data-evento="whatsapp" data-rotulo="nicho-topo" href={whats} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 px-7 py-4 rounded-xl bg-[#FFD43B] text-[#0A1220] font-black text-lg hover:brightness-95 transition">
                                    Quero 2 meses grátis
                                </a>
                                <a href="#demo" className="inline-flex items-center justify-center gap-2 px-7 py-4 rounded-xl bg-[#101C31] border border-[#24344F] text-white font-bold text-lg hover:bg-[#1A2C4D] transition-colors">
                                    <Play className="w-5 h-5" /> Ver funcionando
                                </a>
                            </div>
                            <p className="text-sm text-[#8FA3C0] mt-4">Só paga se gostar e se fizer sentido para o seu negócio. {PRAZO_RESPOSTA}</p>
                        </div>
                        <ChatMIA exemplo={nicho.exemploIA} />
                    </div>
                </div>
            </header>

            {/* 2. Antes x depois */}
            <section className="py-16 sm:py-20 bg-[#101C31] border-y border-[#24344F]">
                <div className={secao}>
                    <div className="text-center max-w-3xl mx-auto mb-10">
                        <p className={`${rotulo} text-red-400`}>Isso acontece na sua loja?</p>
                        <h2 className={titulo}>O que muda no dia a dia de quem tem {nomeMinusculo}</h2>
                    </div>
                    <AntesDepois dores={nicho.dores} depois={venda.depois} />
                </div>
            </section>

            {/* 3. Um dia na loja */}
            <section className="py-16 sm:py-20">
                <div className={secao}>
                    <div className="text-center max-w-3xl mx-auto mb-10">
                        <p className={`${rotulo} text-[#6FCBFF]`}>O sistema que trabalha por você</p>
                        <h2 className={titulo}>Um dia na sua loja com o MercadinhoSys</h2>
                    </div>
                    <DiaNaLoja dia={venda.diaNaLoja} />
                </div>
            </section>

            {/* 4. Demonstração interativa */}
            <section id="demo" className="py-16 sm:py-20 bg-[#101C31] border-y border-[#24344F] scroll-mt-20">
                <div className={secao}>
                    <div className="text-center max-w-3xl mx-auto mb-10">
                        <p className={`${rotulo} text-[#FFD43B]`}>Demonstração</p>
                        <h2 className={titulo}>Toque e veja funcionando</h2>
                        <p className="text-[#8FA3C0] mt-3">Caixa, estoque, IA e fiado com produtos de {nomeMinusculo}.</p>
                    </div>
                    <DemoInterativa venda={venda} origem={nicho.nome} segmento={slug} />
                </div>
            </section>

            {/* 5. Recursos do nicho */}
            <section className="py-16 sm:py-20">
                <div className={secao}>
                    <div className="text-center max-w-3xl mx-auto mb-10">
                        <p className={`${rotulo} text-[#6FCBFF]`}>Feito para {nomeMinusculo}</p>
                        <h2 className={titulo}>Tudo o que a sua loja precisa, num lugar só</h2>
                    </div>
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {nicho.recursos.map(r => (
                            <div key={r.titulo} className="p-6 rounded-2xl bg-[#101C31] border border-[#24344F] hover:border-[#2E9BFF]/50 transition-colors">
                                <p className="text-lg font-bold text-white mb-2">{r.titulo}</p>
                                <p className="text-[#8FA3C0]">{r.texto}</p>
                            </div>
                        ))}
                        <button type="button" onClick={() => entrarNaDemo(slug)} className="p-6 rounded-2xl bg-[#2E9BFF]/10 border border-[#2E9BFF]/40 text-left hover:bg-[#2E9BFF]/15 transition-colors">
                            <p className="text-lg font-bold text-white mb-2 flex items-center gap-2"><Play className="w-5 h-5" /> Prefere ver de verdade?</p>
                            <p className="text-[#8FA3C0]">Entre na loja de demonstração e use o sistema completo agora, sem cadastro.</p>
                        </button>
                    </div>
                </div>
            </section>

            {/* 6. Quanto você perde */}
            <section className="py-16 sm:py-20 bg-[#101C31] border-y border-[#24344F]">
                <div className={secao}>
                    <div className="text-center max-w-3xl mx-auto mb-10">
                        <p className={`${rotulo} text-red-400`}>Faça a conta</p>
                        <h2 className={titulo}>Quanto a sua loja perde por mês sem controle?</h2>
                    </div>
                    <CalculadoraPerdas />
                </div>
            </section>

            {/* 7. Prova social */}
            <section className="py-16 sm:py-20">
                <div className={secao}>
                    <p className={`${rotulo} text-emerald-400 text-center`}>Quem já usa</p>
                    <PrimeiraCliente />
                </div>
            </section>

            {/* 8. Implantação e confiança */}
            <section className="py-16 sm:py-20 bg-[#101C31] border-y border-[#24344F]">
                <div className={secao}>
                    <div className="text-center max-w-3xl mx-auto mb-10">
                        <p className={`${rotulo} text-[#6FCBFF]`}>Sem taxa de implantação</p>
                        <h2 className={titulo}>A gente implanta com você</h2>
                    </div>
                    <ImplantaComVoce />
                    <div className="mt-10"><FaleComDesenvolvedor /></div>
                </div>
            </section>

            {/* 9. Objeção */}
            <section className="py-16 sm:py-20">
                <div className={secao}>
                    <p className={`${rotulo} text-[#8FA3C0] text-center`}>"Mas e se..."</p>
                    <QuebraObjecao objecao={venda.objecao} resposta={venda.respostaObjecao} />
                </div>
            </section>

            {/* 10. Oferta */}
            <section id="oferta" className="py-16 sm:py-20 bg-[#101C31] border-y border-[#24344F] scroll-mt-20">
                <div className={secao}>
                    <OfertaDoisMeses origem={nicho.nome} onCadastro={() => navigate('/register')} />
                </div>
            </section>

            {/* 11. Perguntas */}
            <section className="py-16 sm:py-20">
                <div className="max-w-3xl mx-auto px-4 sm:px-6">
                    <h2 className="text-2xl sm:text-3xl font-bold text-white mb-8 text-center">Perguntas de quem tem {nomeMinusculo}</h2>
                    <div className="space-y-3">
                        {nicho.faq.map((f, i) => (
                            <div key={f.q} className="rounded-2xl bg-[#101C31] border border-[#24344F] overflow-hidden">
                                <button type="button" onClick={() => { if (faqAberta !== i) rastrearEvento('faq', f.q); setFaqAberta(faqAberta === i ? null : i); }} aria-expanded={faqAberta === i} className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left">
                                    <span className="font-bold text-white">{f.q}</span>
                                    {faqAberta === i ? <ChevronUp className="w-5 h-5 text-[#2E9BFF] shrink-0" /> : <ChevronDown className="w-5 h-5 text-[#8FA3C0] shrink-0" />}
                                </button>
                                {faqAberta === i && <p className="px-5 pb-5 text-[#8FA3C0]">{f.a}</p>}
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* 12. Outros segmentos */}
            <section className="py-14 bg-[#101C31] border-t border-[#24344F]">
                <div className={secao}>
                    <h2 className="text-xl sm:text-2xl font-bold text-white mb-6 text-center">Também atendemos</h2>
                    <SegmentosGrid excluir={slug} />
                </div>
            </section>

            <footer className="py-12 border-t border-[#24344F]"><MapaDoSite /></footer>
            <BannerCookies />
            <BarraFixaCelular origem={nicho.nome} onCadastro={() => navigate('/register')} />
        </div>
    );
};

export default NichoPage;
