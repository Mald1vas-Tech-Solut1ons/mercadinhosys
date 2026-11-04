import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, SearchX } from 'lucide-react';
import SegmentosGrid from './SegmentosGrid';
import MapaDoSite from './MapaDoSite';
import { linkWhatsApp, PRAZO_RESPOSTA } from './site';
import { rastrearPagina } from './telemetria';

/**
 * 404 das páginas públicas. A Vercel entrega o index.html (status 200) para qualquer
 * caminho; o `noindex` impede o Google de indexar o endereço errado como página real.
 */
const NaoEncontradaPage: React.FC = () => {
    useEffect(() => {
        rastrearPagina(window.location.pathname);
        document.title = 'Página não encontrada | MercadinhoSys';
        const robots = document.createElement('meta');
        robots.name = 'robots';
        robots.content = 'noindex';
        document.head.appendChild(robots);
        return () => robots.remove();
    }, []);

    return (
        <div className="min-h-dvh bg-[#0A1220] font-['Space_Grotesk',sans-serif] text-[#DCE8F7] overflow-x-hidden">
            <nav className="border-b border-[#24344F]">
                <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center h-16">
                    <Link to="/" className="flex items-center gap-2">
                        <img src="/assets/logo.png" alt="MercadinhoSys" className="w-9 h-9 rounded-lg" />
                        <span className="text-xl font-bold text-white tracking-tighter">Mercadinho<span className="text-[#FF6A5C]">Sys</span></span>
                    </Link>
                </div>
            </nav>
            <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
                <div className="text-center max-w-2xl mx-auto mb-14">
                    <SearchX className="w-14 h-14 text-[#2E9BFF] mx-auto mb-6" />
                    <p className="text-sm font-black uppercase tracking-[2px] text-[#8FA3C0] mb-3">Erro 404</p>
                    <h1 className="text-4xl sm:text-5xl font-bold text-white leading-tight mb-4">Essa página não existe, mas a sua loja organizada pode existir.</h1>
                    <p className="text-lg text-[#8FA3C0] mb-8">O endereço pode ter mudado ou foi digitado errado. Escolha o seu tipo de comércio abaixo ou fale com a gente.</p>
                    <div className="flex flex-col sm:flex-row gap-3 justify-center">
                        <Link to="/" className="px-7 py-4 rounded-xl bg-[#2E9BFF] text-[#0A1220] font-bold text-lg">Ir para a página inicial</Link>
                        <a data-evento="whatsapp" data-rotulo="404" href={linkWhatsApp('Olá! Cheguei por um link que não abriu e quero conhecer o MercadinhoSys.')} target="_blank" rel="noreferrer"
                            className="inline-flex items-center justify-center gap-2 px-7 py-4 rounded-xl bg-emerald-500 text-white font-bold text-lg">
                            <MessageCircle className="w-5 h-5" /> Falar no WhatsApp
                        </a>
                    </div>
                    <p className="text-sm text-[#8FA3C0] mt-4">{PRAZO_RESPOSTA}</p>
                </div>
                <SegmentosGrid />
            </main>
            <footer className="py-12 border-t border-[#24344F]"><MapaDoSite /></footer>
        </div>
    );
};

export default NaoEncontradaPage;
