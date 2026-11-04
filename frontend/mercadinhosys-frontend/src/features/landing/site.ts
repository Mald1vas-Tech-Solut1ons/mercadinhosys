import nichosJson from './nichos.json';
import nichosVendaJson from './nichosVenda.json';
import regioesJson from './regioes.json';

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

/** Conteúdo de venda de cada nicho: antes x depois, dia na loja, demonstração e objeção. */
export interface NichoVenda {
    depois: string[];
    diaNaLoja: { hora: string; titulo: string; texto: string }[];
    produtosDemo: { nome: string; preco: number; estoque: number }[];
    alertas: string[];
    perguntaIA: string;
    respostaIA: string;
    objecao: string;
    respostaObjecao: string;
}

export const VENDAS: Record<string, NichoVenda> = nichosVendaJson;

/** Regiões com atendimento presencial (SEO local: uma página por região). */
export interface Regiao {
    slug: string;
    nome: string;
    seoTitle: string;
    seoDescription: string;
    h1: string;
    subtitulo: string;
    bairros: string[];
    intro: string[];
    comoFunciona: { titulo: string; texto: string }[];
    faq: { q: string; a: string }[];
}

export const REGIOES: Regiao[] = regioesJson;

export const rotaRegiao = (slug: string) => `/sistema-para-comercio-${slug}`;

/** Depoimento autorizado da primeira cliente, na voz dela. */
export const DEPOIMENTO_VERA = {
    texto: 'Eu nunca tinha usado sistema e aprendi em poucos minutos. Hoje eu vendo, vejo o estoque e fecho o caixa sozinha, sem dor de cabeça. É muito fácil.',
    nome: 'Vera Moreti Felipe',
    loja: 'Saldão Capraro Outlet',
    cidade: 'Guarulhos',
};

// Domínio definitivo entra por VITE_SITE_URL quando estiver apontado na Vercel.
export const SITE_URL = ((import.meta.env.VITE_SITE_URL as string | undefined) || 'https://mercadinhosys.com.br').replace(/\/$/, '');

export const WHATSAPP_NUMERO = '5511919889233';
export const WHATSAPP_EXIBICAO = '(11) 91988-9233';
export const REGIOES_ATENDIDAS = ['Guarulhos', 'Zona Norte de São Paulo', 'Zona Leste de São Paulo'];

export const linkWhatsApp = (mensagem: string) =>
    `https://wa.me/${WHATSAPP_NUMERO}?text=${encodeURIComponent(mensagem)}`;
