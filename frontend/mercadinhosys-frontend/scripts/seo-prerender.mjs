/**
 * SEO pós-build (roda depois do `vite build`).
 *
 * O app é uma SPA: sem isto, toda URL entrega o mesmo index.html vazio e o Google
 * e o WhatsApp não sabem do que a página trata. Aqui geramos, a partir dos mesmos
 * JSONs que o React usa (nichos, nichosVenda, regioes):
 *   - dist/index.html com o texto da página inicial já no HTML;
 *   - dist/sistema-para-<nicho>/index.html e dist/sistema-para-comercio-<regiao>/index.html
 *     com título, descrição, canonical, dados estruturados e o texto da página;
 *   - dist/sitemap.xml, dist/robots.txt, dist/llms.txt e dist/llms-full.txt (resumo
 *     e conteúdo completo para buscadores de IA).
 * A Vercel serve o arquivo estático antes do rewrite da SPA; o React assume a
 * página normalmente ao carregar.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(raiz, 'dist');
const SITE = (process.env.VITE_SITE_URL || 'https://mercadinhosys.com.br').replace(/\/$/, '');
const lerJson = (arquivo) => JSON.parse(readFileSync(join(raiz, 'src/features/landing', arquivo), 'utf-8'));
const nichos = lerJson('nichos.json');
const vendas = lerJson('nichosVenda.json');
const regioes = lerJson('regioes.json');
const modelo = readFileSync(join(dist, 'index.html'), 'utf-8');
const hoje = new Date().toISOString().slice(0, 10);
const REGIOES_TEXTO = 'Guarulhos, Zona Norte e Zona Leste de São Paulo';
const VERA = '“Eu nunca tinha usado sistema e aprendi em poucos minutos. Hoje eu vendo, vejo o estoque e fecho o caixa sozinha, sem dor de cabeça. É muito fácil.” Vera Moreti Felipe, Saldão Capraro Outlet, Guarulhos.';
const OFERTA = `2 meses grátis com implantação feita junto com você. Só paga se gostar e se fizer sentido para o seu negócio: depois, R$ 99,90 por mês com preço travado, sem fidelidade e sem taxa de implantação. Emissão de nota fiscal é módulo à parte, com custo à parte. Atendimento presencial em ${REGIOES_TEXTO}. WhatsApp (11) 91988-9233.`;

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const rotaNicho = (slug) => `/sistema-para-${slug}`;
const rotaRegiao = (slug) => `/sistema-para-comercio-${slug}`;

const ORGANIZACAO = {
    '@type': 'Organization',
    '@id': `${SITE}/#organizacao`,
    name: 'MercadinhoSys',
    url: `${SITE}/`,
    logo: `${SITE}/assets/logo.png`,
    contactPoint: { '@type': 'ContactPoint', telephone: '+55-11-91988-9233', contactType: 'sales', availableLanguage: 'Portuguese' },
    parentOrganization: { '@type': 'Organization', name: 'Maldivas Tech', url: 'https://maldivastech.dev' },
};
const AREAS = regioes.map(r => ({ '@type': r.slug === 'guarulhos' ? 'City' : 'AdministrativeArea', name: r.nome }));

function substituirMeta(html, chave, valor) {
    const re = new RegExp(`(<meta (?:name|property)="${chave}" content=")[^"]*(")`);
    if (!re.test(html)) throw new Error(`meta ${chave} não encontrada no index.html`);
    return html.replace(re, `$1${esc(valor)}$2`);
}

function pagina({ caminho, titulo, descricao, corpo = '', jsonLd = null, og = 'inicio' }) {
    let html = modelo.replace(/<title>[^<]*<\/title>/, `<title>${esc(titulo)}</title>`);
    html = substituirMeta(html, 'description', descricao);
    html = substituirMeta(html, 'og:title', titulo);
    html = substituirMeta(html, 'og:description', descricao);
    html = substituirMeta(html, 'og:image', `${SITE}/og/${og}.png`);
    const extra = [
        `<link rel="canonical" href="${SITE}${caminho}" />`,
        `<meta property="og:url" content="${SITE}${caminho}" />`,
        '<meta property="og:image:width" content="1200" />',
        '<meta property="og:image:height" content="630" />',
        `<meta property="og:image:alt" content="${esc(titulo)}" />`,
        jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : '',
    ].join('\n    ');
    html = html.replace('</head>', `    ${extra}\n  </head>`);
    // Texto da página já no HTML (o React substitui ao montar).
    return html.replace('<div id="root"></div>', `<div id="root">${corpo}</div>`);
}

function salvar(caminho, html) {
    const pasta = caminho === '/' ? dist : join(dist, caminho.slice(1));
    mkdirSync(pasta, { recursive: true });
    writeFileSync(join(pasta, 'index.html'), html);
}

const faqLd = (faq) => ({ '@type': 'FAQPage', mainEntity: faq.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) });
const trilha = (nome, caminho) => ({
    '@type': 'BreadcrumbList',
    itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'MercadinhoSys', item: `${SITE}/` },
        { '@type': 'ListItem', position: 2, name: nome, item: `${SITE}${caminho}` },
    ],
});
const listaNichos = (excluir) => nichos.filter(o => o.slug !== excluir)
    .map(o => `<li><a href="${rotaNicho(o.slug)}">Sistema para ${esc(o.nome.toLowerCase())}</a></li>`).join('');
const naRegiao = (r) => `${r.preposicao} ${r.nome}`;
const listaRegioes = () => regioes.map(r => `<li><a href="${rotaRegiao(r.slug)}">Sistema para comércio ${esc(naRegiao(r))}</a></li>`).join('');

// ---------- Página inicial ----------
const FAQ_HOME = [
    { q: 'Como funcionam os 2 meses grátis?', a: 'Você usa o sistema completo por 2 meses, sem cartão e sem pagar nada, com a implantação feita junto com você. Só continua pagando se gostar e se fizer sentido para o seu negócio.' },
    { q: 'E depois dos 2 meses, quanto custa?', a: 'R$ 99,90 por mês no Plano Pro, com preço travado: menos de R$ 3,40 por dia. Sem taxa de implantação, sem fidelidade e sem multa para cancelar.' },
    { q: 'Serve para o meu tipo de comércio?', a: `Sim. O MercadinhoSys atende ${nichos.map(n => n.nome.toLowerCase()).join(', ')}.` },
    { q: 'Meus dados ficam seguros?', a: 'Sim. Os dados de cada loja ficam separados, cada funcionário só vê o que você liberar e tudo o que acontece no sistema fica registrado. E você fala direto com o desenvolvedor.' },
    { q: 'Emite nota fiscal?', a: 'A emissão de nota fiscal é um módulo à parte, com custo à parte.' },
];
salvar('/', pagina({
    caminho: '/',
    titulo: 'MercadinhoSys: sistema de gestão com IA para todo tipo de comércio',
    descricao: 'Sistema com IA para mercadinho, loja de roupas, moto peças, tabacaria e mais. Caixa, estoque, fiado e lucro real. 2 meses grátis com implantação.',
    jsonLd: { '@context': 'https://schema.org', '@graph': [ORGANIZACAO, faqLd(FAQ_HOME)] },
    corpo: `<main>
<h1>O sistema que trabalha por você.</h1>
<p>Não é você que trabalha para o sistema. A IA do MercadinhoSys cadastra produtos, acompanha a loja e diz o que fazer. Caixa, estoque, fiado, financeiro e equipe para todo tipo de comércio. Sistema 100% brasileiro, com o desenvolvedor do seu lado.</p>
<h2>Qual é o seu negócio?</h2><ul>${listaNichos()}</ul>
<h2>Consultor M-IA: você pede, a IA faz</h2><p>Pergunte sobre vendas, estoque, contas ou equipe e receba a resposta com os números da sua loja. Peça para cadastrar um produto, gerar o pedido de compra ou criar um lembrete.</p>
<h2>A gente implanta com você</h2><p>Quem fez o MercadinhoSys vai até a sua loja, importa os produtos, configura o caixa e acompanha os 2 primeiros meses.</p>
<h2>Quem já usa</h2><blockquote>${esc(VERA)}</blockquote>
<h2>Oferta</h2><p>${esc(OFERTA)}</p>
<h2>Atendimento presencial</h2><ul>${listaRegioes()}</ul>
<h2>Perguntas frequentes</h2>${FAQ_HOME.map(f => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join('')}
</main>`,
}));

// ---------- Páginas de nicho ----------
for (const n of nichos) {
    const v = vendas[n.slug];
    const caminho = rotaNicho(n.slug);
    const nome = `Sistema para ${n.nome.toLowerCase()}`;
    const corpo = `<main>
<h1>${esc(n.h1)}</h1>
<p>${esc(n.subtitulo)}</p>
<h2>O que muda no dia a dia de quem tem ${esc(n.nome.toLowerCase())}</h2>
<ul>${n.dores.map((d, i) => `<li>Hoje: ${esc(d)} Com o MercadinhoSys: ${esc(v.depois[i])}</li>`).join('')}</ul>
<h2>Um dia na sua loja com o MercadinhoSys</h2>${v.diaNaLoja.map(p => `<h3>${esc(p.hora)}: ${esc(p.titulo)}</h3><p>${esc(p.texto)}</p>`).join('')}
<h2>Tudo o que a sua loja precisa</h2>${n.recursos.map(r => `<h3>${esc(r.titulo)}</h3><p>${esc(r.texto)}</p>`).join('')}
<h2>Pergunte para a IA</h2><p>“${esc(v.perguntaIA)}” ${esc(v.respostaIA)}</p>
<h2>Quem já usa</h2><blockquote>${esc(VERA)}</blockquote>
<h2>“${esc(v.objecao)}”</h2><p>${esc(v.respostaObjecao)}</p>
<h2>2 meses grátis</h2><p>${esc(OFERTA)}</p>
<h2>Perguntas frequentes</h2>${n.faq.map(f => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join('')}
<h2>Também atendemos</h2><ul>${listaNichos(n.slug)}</ul>
<h2>Atendimento presencial</h2><ul>${listaRegioes()}</ul>
</main>`;
    salvar(caminho, pagina({
        caminho, titulo: n.seoTitle, descricao: n.seoDescription, corpo, og: n.slug,
        jsonLd: {
            '@context': 'https://schema.org',
            '@graph': [
                ORGANIZACAO,
                {
                    '@type': 'Service', name: nome, serviceType: 'Sistema de gestão para comércio', description: n.seoDescription,
                    provider: { '@id': `${SITE}/#organizacao` }, areaServed: AREAS,
                    offers: { '@type': 'Offer', price: '99.90', priceCurrency: 'BRL', description: '2 meses grátis com implantação; depois R$ 99,90/mês, sem fidelidade.' },
                },
                faqLd(n.faq),
                trilha(nome, caminho),
            ],
        },
    }));
}

// ---------- Páginas de região (SEO local) ----------
for (const r of regioes) {
    const caminho = rotaRegiao(r.slug);
    const corpo = `<main>
<h1>${esc(r.h1)}</h1>
<p>${esc(r.subtitulo)}</p>
${r.intro.map(p => `<p>${esc(p)}</p>`).join('')}
<h2>Bairros atendidos ${esc(naRegiao(r))}</h2><ul>${r.bairros.map(b => `<li>${esc(b)}</li>`).join('')}</ul>
<h2>Como funciona a implantação ${esc(naRegiao(r))}</h2>${r.comoFunciona.map(p => `<h3>${esc(p.titulo)}</h3><p>${esc(p.texto)}</p>`).join('')}
<h2>Para todo tipo de comércio</h2><ul>${listaNichos()}</ul>
<h2>Quem já usa</h2><blockquote>${esc(VERA)}</blockquote>
<h2>2 meses grátis</h2><p>${esc(OFERTA)}</p>
<h2>Perguntas frequentes</h2>${r.faq.map(f => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join('')}
</main>`;
    salvar(caminho, pagina({
        caminho, titulo: r.seoTitle, descricao: r.seoDescription, corpo, og: `comercio-${r.slug}`,
        jsonLd: {
            '@context': 'https://schema.org',
            '@graph': [
                ORGANIZACAO,
                {
                    '@type': 'ProfessionalService',
                    name: `MercadinhoSys em ${r.nome}`,
                    description: r.seoDescription,
                    url: `${SITE}${caminho}`,
                    telephone: '+55-11-91988-9233',
                    priceRange: 'R$ 99,90/mês',
                    parentOrganization: { '@id': `${SITE}/#organizacao` },
                    areaServed: [
                        { '@type': r.slug === 'guarulhos' ? 'City' : 'AdministrativeArea', name: r.nome },
                        ...r.bairros.map(b => ({ '@type': 'Place', name: `${b}, ${r.nome}` })),
                    ],
                },
                faqLd(r.faq),
                trilha(`Sistema para comércio ${naRegiao(r)}`, caminho),
            ],
        },
    }));
}

// ---------- Sitemap, robots, llms ----------
const urls = [
    { u: '/', p: '1.0' },
    ...nichos.map(n => ({ u: rotaNicho(n.slug), p: '0.9' })),
    ...regioes.map(r => ({ u: rotaRegiao(r.slug), p: '0.8' })),
];
writeFileSync(join(dist, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(({ u, p }) => `  <url><loc>${SITE}${u}</loc><lastmod>${hoje}</lastmod><changefreq>weekly</changefreq><priority>${p}</priority></url>`).join('\n')}
</urlset>
`);

writeFileSync(join(dist, 'robots.txt'), `User-agent: *
Allow: /
Disallow: /dashboard
Disallow: /pdv
Disallow: /settings

Sitemap: ${SITE}/sitemap.xml
`);

const resumo = `# MercadinhoSys

> Sistema de gestão com inteligência artificial para pequeno comércio brasileiro: frente de caixa, estoque, compras, fiado e crediário, financeiro, equipe e entregas. Sistema 100% brasileiro; o cliente fala direto com o desenvolvedor. Site oficial: ${SITE}

## Oferta
- ${OFERTA}

## O que o sistema faz
- Cadastro pelo código de barras (nome, marca e foto) e cadastro por texto pela IA.
- Consultor M-IA: responde com os números reais da loja, gera pedido de compra, cria lembrete e emite relatório em PDF e planilha.
- Estoque com aviso do que repor, produtos parados, validade e lote.
- Fiado e crediário com limite e cobrança pelo WhatsApp.
- Financeiro: despesas, contas a pagar, boletos e lucro real.
- Equipe: ponto pelo celular com foto, holerite, PIN do dono para cancelamento, permissões por funcionário.
- Funciona no celular, no tablet e no computador.

## Depoimento
- ${VERA}

## Por tipo de comércio
${nichos.map(n => `- [${n.nome}](${SITE}${rotaNicho(n.slug)}): ${n.seoDescription}`).join('\n')}

## Atendimento presencial
${regioes.map(r => `- [${r.nome}](${SITE}${rotaRegiao(r.slug)}): bairros ${r.bairros.join(', ')}.`).join('\n')}
`;
writeFileSync(join(dist, 'llms.txt'), resumo);

writeFileSync(join(dist, 'llms-full.txt'), `${resumo}
${nichos.map(n => {
    const v = vendas[n.slug];
    return `
## ${n.h1}
${n.subtitulo}
${n.dores.map((d, i) => `- Problema: ${d} Solução: ${v.depois[i]}`).join('\n')}
${n.recursos.map(r => `- ${r.titulo}: ${r.texto}`).join('\n')}
${n.faq.map(f => `- P: ${f.q} R: ${f.a}`).join('\n')}`;
}).join('\n')}
${regioes.map(r => `
## ${r.h1}
${r.intro.join('\n')}
${r.faq.map(f => `- P: ${f.q} R: ${f.a}`).join('\n')}`).join('\n')}
`);

console.log(`SEO: home + ${nichos.length} nichos + ${regioes.length} regiões, sitemap (${urls.length} URLs), robots, llms.txt e llms-full.txt para ${SITE}`);
