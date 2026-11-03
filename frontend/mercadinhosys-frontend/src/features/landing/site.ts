import nichosJson from './nichos.json';

/**
 * Dados públicos do site (landing e páginas de nicho).
 *
 * As páginas de nicho existem para o Google: cada uma responde uma busca
 * ("sistema para tabacaria", "sistema para loja de roupas"...). O mesmo JSON
 * alimenta o React e o script de build que gera o HTML estático, o sitemap e
 * o llms.txt (scripts/seo-prerender.mjs), então texto e SEO nunca divergem.
 */
export interface Nicho {
    slug: string;
    nome: string;
    icone: string;
    seoTitle: string;
    seoDescription: string;
    h1: string;
    subtitulo: string;
    dores: string[];
    recursos: { titulo: string; texto: string }[];
    exemploIA: string;
    buscas: string[];
    faq: { q: string; a: string }[];
}

export const NICHOS: Nicho[] = nichosJson;

export const rotaNicho = (slug: string) => `/sistema-para-${slug}`;

// Domínio definitivo entra por VITE_SITE_URL quando estiver apontado na Vercel.
export const SITE_URL = ((import.meta.env.VITE_SITE_URL as string | undefined) || 'https://mercadinhosys.vercel.app').replace(/\/$/, '');

export const WHATSAPP_NUMERO = '5511919889233';
export const WHATSAPP_EXIBICAO = '(11) 91988-9233';
export const REGIOES_ATENDIDAS = ['Guarulhos', 'Zona Norte de São Paulo', 'Zona Leste de São Paulo'];

export const linkWhatsApp = (mensagem: string) =>
    `https://wa.me/${WHATSAPP_NUMERO}?text=${encodeURIComponent(mensagem)}`;
