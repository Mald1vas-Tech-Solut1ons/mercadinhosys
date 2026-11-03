/**
 * SEO pós-build (roda depois do `vite build`).
 *
 * O app é uma SPA: sem isto, toda URL entrega o mesmo index.html vazio e o Google
 * e o WhatsApp não sabem do que a página trata. Aqui geramos, a partir do mesmo
 * nichos.json que o React usa:
 *   - dist/sistema-para-<nicho>/index.html com título, descrição, canonical,
 *     dados estruturados (FAQ) e o texto da página já no HTML;
 *   - dist/sitemap.xml, dist/robots.txt e dist/llms.txt (resumo para IAs).
 * A Vercel serve o arquivo estático antes do rewrite da SPA; o React assume a
 * página normalmente ao carregar.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(raiz, 'dist');
const SITE = (process.env.VITE_SITE_URL || 'https://mercadinhosys.vercel.app').replace(/\/$/, '');
const nichos = JSON.parse(readFileSync(join(raiz, 'src/features/landing/nichos.json'), 'utf-8'));
const modelo = readFileSync(join(dist, 'index.html'), 'utf-8');
const hoje = new Date().toISOString().slice(0, 10);
const REGIOES = 'Guarulhos, Zona Norte e Zona Leste de São Paulo';

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function substituirMeta(html, chave, valor) {
    const re = new RegExp(`(<meta (?:name|property)="${chave}" content=")[^"]*(")`);
    if (!re.test(html)) throw new Error(`meta ${chave} não encontrada no index.html`);
    return html.replace(re, `$1${esc(valor)}$2`);
}

function pagina({ caminho, titulo, descricao, corpo = '', jsonLd = null }) {
    let html = modelo.replace(/<title>[^<]*<\/title>/, `<title>${esc(titulo)}</title>`);
    html = substituirMeta(html, 'description', descricao);
    html = substituirMeta(html, 'og:title', titulo);
    html = substituirMeta(html, 'og:description', descricao);
    html = substituirMeta(html, 'og:image', `${SITE}/screenshots/dashboard.png`);
    const extra = [
        `<link rel="canonical" href="${SITE}${caminho}" />`,
        `<meta property="og:url" content="${SITE}${caminho}" />`,
        jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : '',
    ].join('\n    ');
    html = html.replace('</head>', `    ${extra}\n  </head>`);
    // Texto da página já no HTML (o React substitui ao montar).
    return html.replace('<div id="root"></div>', `<div id="root">${corpo}</div>`);
}

function corpoNicho(n) {
    const outros = nichos.filter(o => o.slug !== n.slug)
        .map(o => `<li><a href="/sistema-para-${o.slug}">Sistema para ${esc(o.nome.toLowerCase())}</a></li>`).join('');
    return `<main>
<h1>${esc(n.h1)}</h1>
<p>${esc(n.subtitulo)}</p>
<h2>Isso acontece na sua loja?</h2><ul>${n.dores.map(d => `<li>${esc(d)}</li>`).join('')}</ul>
<h2>O sistema que trabalha por você</h2>${n.recursos.map(r => `<h3>${esc(r.titulo)}</h3><p>${esc(r.texto)}</p>`).join('')}
<h2>2 meses grátis</h2><p>Implantação feita junto com você. Só paga se fizer sentido para o seu negócio: depois, R$ 99,90 por mês com preço travado, sem fidelidade e sem taxa de implantação. Atendimento presencial em ${REGIOES}. WhatsApp (11) 91988-9233.</p>
<h2>Perguntas frequentes</h2>${n.faq.map(f => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join('')}
<h2>Também atendemos</h2><ul>${outros}</ul>
<p><a href="/">MercadinhoSys: sistema de gestão com IA para todo tipo de comércio</a></p>
</main>`;
}

// Página inicial: canonical e og:url absolutos.
writeFileSync(join(dist, 'index.html'), pagina({
    caminho: '/',
    titulo: 'MercadinhoSys: sistema de gestão com IA para todo tipo de comércio',
    descricao: 'Sistema com IA para mercadinho, loja de roupas, moto peças, tabacaria e mais. Caixa, estoque, fiado e lucro real. 2 meses grátis com implantação.',
}));

for (const n of nichos) {
    const caminho = `/sistema-para-${n.slug}`;
    const jsonLd = {
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': 'FAQPage',
                mainEntity: n.faq.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
            },
            {
                '@type': 'BreadcrumbList',
                itemListElement: [
                    { '@type': 'ListItem', position: 1, name: 'MercadinhoSys', item: `${SITE}/` },
                    { '@type': 'ListItem', position: 2, name: `Sistema para ${n.nome.toLowerCase()}`, item: `${SITE}${caminho}` },
                ],
            },
        ],
    };
    const pasta = join(dist, caminho.slice(1));
    mkdirSync(pasta, { recursive: true });
    writeFileSync(join(pasta, 'index.html'), pagina({ caminho, titulo: n.seoTitle, descricao: n.seoDescription, corpo: corpoNicho(n), jsonLd }));
}

const urls = ['/', ...nichos.map(n => `/sistema-para-${n.slug}`)];
writeFileSync(join(dist, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${SITE}${u}</loc><lastmod>${hoje}</lastmod><changefreq>weekly</changefreq><priority>${u === '/' ? '1.0' : '0.8'}</priority></url>`).join('\n')}
</urlset>
`);

writeFileSync(join(dist, 'robots.txt'), `User-agent: *
Allow: /
Disallow: /dashboard
Disallow: /pdv
Disallow: /settings

Sitemap: ${SITE}/sitemap.xml
`);

writeFileSync(join(dist, 'llms.txt'), `# MercadinhoSys

> Sistema de gestão com inteligência artificial para pequeno comércio brasileiro: frente de caixa, estoque, compras, fiado e crediário, financeiro, equipe e entregas. Sistema 100% brasileiro; o cliente fala direto com o desenvolvedor.

## Oferta
- 2 meses grátis com implantação feita junto com o lojista (importação dos produtos e configuração da loja).
- Só paga se fizer sentido para o negócio. Depois, R$ 99,90 por mês com preço travado, sem fidelidade e sem taxa de implantação.
- Emissão de nota fiscal é um módulo à parte, com custo à parte.
- Atendimento presencial em ${REGIOES}. WhatsApp (11) 91988-9233.

## O que o sistema faz
- Cadastro pelo código de barras (nome, marca e foto) e cadastro por texto pela IA.
- Consultor M-IA: responde com os números reais da loja, gera pedido de compra, cria lembrete e emite relatório em PDF e planilha.
- Estoque com aviso do que repor, produtos parados, validade e lote.
- Fiado e crediário com limite e cobrança pelo WhatsApp.
- Financeiro: despesas, contas a pagar, boletos e lucro real.
- Equipe: ponto pelo celular com foto, holerite, PIN do dono para cancelamento, permissões por funcionário.
- Funciona no celular, no tablet e no computador.

## Por tipo de comércio
${nichos.map(n => `- [${n.nome}](${SITE}/sistema-para-${n.slug}): ${n.seoDescription}`).join('\n')}
`);

console.log(`SEO: ${nichos.length} páginas de nicho, sitemap, robots e llms.txt gerados para ${SITE}`);
