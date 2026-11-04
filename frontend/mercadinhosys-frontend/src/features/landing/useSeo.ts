import { useEffect } from 'react';
import { SITE_URL } from './site';
import { rastrearPagina } from './telemetria';

function definirMeta(atributo: 'name' | 'property', chave: string, valor: string) {
    let tag = document.head.querySelector<HTMLMetaElement>(`meta[${atributo}="${chave}"]`);
    if (!tag) {
        tag = document.createElement('meta');
        tag.setAttribute(atributo, chave);
        document.head.appendChild(tag);
    }
    tag.setAttribute('content', valor);
}

/**
 * Título, descrição e canonical da página pública atual. O HTML estático gerado
 * no build já vem com esses valores (é o que o Google e o WhatsApp leem); aqui
 * só mantemos a aba certa quando o visitante navega entre páginas sem recarregar.
 */
export function useSeo(titulo: string, descricao: string, caminho: string, imagem?: string) {
    useEffect(() => {
        rastrearPagina(caminho);
        document.title = titulo;
        definirMeta('name', 'description', descricao);
        definirMeta('property', 'og:title', titulo);
        definirMeta('property', 'og:description', descricao);
        definirMeta('property', 'og:url', `${SITE_URL}${caminho}`);
        if (imagem) definirMeta('property', 'og:image', imagem);
        let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
        if (!canonical) {
            canonical = document.createElement('link');
            canonical.rel = 'canonical';
            document.head.appendChild(canonical);
        }
        canonical.href = `${SITE_URL}${caminho}`;
    }, [titulo, descricao, caminho, imagem]);
}
