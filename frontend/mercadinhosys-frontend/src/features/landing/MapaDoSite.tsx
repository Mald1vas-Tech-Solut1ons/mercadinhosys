import React from 'react';
import { Link } from 'react-router-dom';
import { NICHOS, REGIOES, rotaNicho, rotaRegiao, linkWhatsApp, WHATSAPP_EXIBICAO, PRAZO_RESPOSTA, EMPRESA } from './site';

/** Mapa do site visível: todos os segmentos e regiões a um clique (e links internos para o Google). */
const MapaDoSite: React.FC = () => (
    <nav aria-label="Mapa do site" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid sm:grid-cols-2 lg:grid-cols-4 gap-8 text-sm">
        <div>
            <p className="font-black text-white uppercase tracking-widest text-xs mb-3">MercadinhoSys</p>
            <ul className="space-y-2 text-[#8FA3C0]">
                <li><Link to="/" className="hover:text-white">Página inicial</Link></li>
                <li><Link to="/#demo" className="hover:text-white">Ver funcionando</Link></li>
                <li><Link to="/#oferta" className="hover:text-white">2 meses grátis</Link></li>
                <li><a href="/ajuda" className="hover:text-white">Ajuda</a></li>
                <li><a href="/login" className="hover:text-white">Acesso do cliente</a></li>
            </ul>
        </div>
        <div className="lg:col-span-2">
            <p className="font-black text-white uppercase tracking-widest text-xs mb-3">Sistema por tipo de comércio</p>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-[#8FA3C0]">
                {NICHOS.map(n => (
                    <li key={n.slug}><Link to={rotaNicho(n.slug)} data-evento="segmento" data-rotulo={n.slug} className="hover:text-white">Sistema para {n.nome.toLowerCase()}</Link></li>
                ))}
            </ul>
        </div>
        <div>
            <p className="font-black text-white uppercase tracking-widest text-xs mb-3">Atendimento presencial</p>
            <ul className="space-y-2 text-[#8FA3C0]">
                {REGIOES.map(r => (
                    <li key={r.slug}><Link to={rotaRegiao(r.slug)} data-evento="regiao" data-rotulo={r.slug} className="hover:text-white">{r.nome}</Link></li>
                ))}
            </ul>
            <p className="mt-4 text-[#8FA3C0]">WhatsApp <a data-evento="whatsapp" data-rotulo="rodape" className="text-white font-bold" href={linkWhatsApp('Olá! Quero conhecer o MercadinhoSys.')} target="_blank" rel="noreferrer">{WHATSAPP_EXIBICAO}</a></p>
            <p className="mt-1 text-xs text-[#8FA3C0]">{PRAZO_RESPOSTA}</p>
            <p className="mt-2 flex gap-4 text-[#8FA3C0]"><a href="/termos" className="hover:text-white">Termos</a><a href="/privacidade" className="hover:text-white">Privacidade</a></p>
        </div>
        <p className="sm:col-span-2 lg:col-span-4 pt-6 border-t border-[#24344F] text-center text-[#8FA3C0]">
            MercadinhoSys é um produto da <a href={EMPRESA.url} target="_blank" rel="noopener" className="text-white font-bold hover:text-[#6FCBFF]">{EMPRESA.nome}</a>: software sob medida, sistemas e IA para empresas.
        </p>
    </nav>
);

export default MapaDoSite;
