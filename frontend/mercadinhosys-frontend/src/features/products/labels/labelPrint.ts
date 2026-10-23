import JsBarcode from 'jsbarcode';

export type LabelLayoutId =
  | 'termica-40x25'
  | 'termica-50x30'
  | 'termica-60x40'
  | 'a4-pimaco-a4256'
  | 'a4-pimaco-a4351';

export interface LabelLayout {
  id: LabelLayoutId;
  nome: string;
  larguraMm: number;
  alturaMm: number;
  folhaA4: boolean;
  colunas: number;
  linhas: number;
  margemTopoMm: number;
  margemEsquerdaMm: number;
  espacoColunaMm: number;
  espacoLinhaMm: number;
}

const rolo = (id: LabelLayoutId, nome: string, larguraMm: number, alturaMm: number): LabelLayout => ({
  id, nome, larguraMm, alturaMm, folhaA4: false, colunas: 1, linhas: 1,
  margemTopoMm: 0, margemEsquerdaMm: 0, espacoColunaMm: 0, espacoLinhaMm: 0,
});

export const LABEL_LAYOUTS: LabelLayout[] = [
  rolo('termica-40x25', 'Térmica 40 × 25 mm (rolo)', 40, 25),
  rolo('termica-50x30', 'Térmica 50 × 30 mm (rolo)', 50, 30),
  rolo('termica-60x40', 'Térmica 60 × 40 mm (rolo)', 60, 40),
  {
    id: 'a4-pimaco-a4256', nome: 'A4 Pimaco A4256 — 21 por folha (63,5 × 38,1 mm)',
    larguraMm: 63.5, alturaMm: 38.1, folhaA4: true, colunas: 3, linhas: 7,
    margemTopoMm: 15.15, margemEsquerdaMm: 7.2, espacoColunaMm: 2.5, espacoLinhaMm: 0,
  },
  {
    id: 'a4-pimaco-a4351', nome: 'A4 Pimaco A4351 — 65 por folha (38,2 × 21,2 mm)',
    larguraMm: 38.2, alturaMm: 21.2, folhaA4: true, colunas: 5, linhas: 13,
    margemTopoMm: 10.7, margemEsquerdaMm: 4.7, espacoColunaMm: 2.5, espacoLinhaMm: 0,
  },
];

export interface LabelItem {
  nome: string;
  preco: number;
  codigo: string;
}

export interface LabelOptions {
  mostrarLoja: boolean;
  mostrarNome: boolean;
  mostrarPreco: boolean;
  ajusteTopoMm: number;
  ajusteEsquerdaMm: number;
}

// Dígito verificador EAN-13 (pesos 1/3 a partir da esquerda)
function dvEan13(base: string): number {
  let soma = 0;
  for (let i = 0; i < 12; i++) soma += (base.charCodeAt(i) - 48) * (i % 2 === 0 ? 1 : 3);
  return (10 - (soma % 10)) % 10;
}

// Dígito verificador EAN-8 (pesos 3/1 a partir da esquerda)
function dvEan8(base: string): number {
  let soma = 0;
  for (let i = 0; i < 7; i++) soma += (base.charCodeAt(i) - 48) * (i % 2 === 0 ? 3 : 1);
  return (10 - (soma % 10)) % 10;
}

export function formatoDoCodigo(codigo: string): 'EAN13' | 'EAN8' | 'CODE128' | null {
  const c = codigo.trim();
  if (c === '') return null;
  if (/^\d+$/.test(c)) {
    if (c.length === 13 && dvEan13(c) === c.charCodeAt(12) - 48) return 'EAN13';
    if (c.length === 8 && dvEan8(c) === c.charCodeAt(7) - 48) return 'EAN8';
  }
  return 'CODE128';
}

export function barcodeSvg(codigo: string): string {
  const formato = formatoDoCodigo(codigo);
  if (!formato) return '';
  try {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    // Só as barras: os dígitos vão em HTML embaixo, para o SVG poder esticar
    // e ocupar a caixa exata sem distorcer o texto
    JsBarcode(svg, codigo.trim(), { format: formato, width: 2, height: 50, displayValue: false, margin: 0 });
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('style', 'display:block;width:100%;height:100%');
    return svg.outerHTML;
  } catch {
    return '';
  }
}

export function precoBR(v: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const mm = (v: number) => `${Number(v.toFixed(3))}mm`;

const valorBR = (v: number) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

export function buildLabelsHtml(itens: LabelItem[], layout: LabelLayout, opcoes: LabelOptions, nomeLoja = ''): string {
  // Tipografia e blocos proporcionais à altura: o mesmo desenho serve do
  // 38 × 21 da Pimaco ao 60 × 40 do rolo
  const h = layout.alturaMm;
  const lojaPt = Number((h * 0.2).toFixed(1));
  const nomePt = Number((h * 0.27).toFixed(1));
  const precoPt = Math.round(h * 0.5);
  const digitosPt = Number(Math.max(4.5, h * 0.17).toFixed(1));
  const rodapeMm = h * 0.42;
  const pageSize = layout.folhaA4 ? '210mm 297mm' : `${layout.larguraMm}mm ${h}mm`;
  const loja = opcoes.mostrarLoja ? nomeLoja.trim() : '';

  const conteudoEtiqueta = (item: LabelItem): string => {
    const partes: string[] = [];
    if (loja) partes.push(`<div class="loja">${escapeHtml(loja)}</div>`);
    partes.push(`<div class="nome">${opcoes.mostrarNome ? escapeHtml(item.nome) : ''}</div>`);

    const codigo = (item.codigo || '').trim();
    const svg = barcodeSvg(codigo);
    const blocoCodigo = svg
      ? `<div class="codigo"><div class="barras">${svg}</div><div class="digitos">${escapeHtml(codigo)}</div></div>`
      : '<div class="codigo semcod">SEM CÓDIGO</div>';
    const valor = valorBR(item.preco);
    // Preço longo (milhar) encolhe para não invadir o código de barras
    const blocoPreco = opcoes.mostrarPreco
      ? `<div class="preco${valor.length > 6 ? ' longo' : ''}"><span class="rs">R$</span>${valor}</div>`
      : '';
    partes.push(`<div class="rodape${opcoes.mostrarPreco ? '' : ' sem-preco'}">${blocoCodigo}${blocoPreco}</div>`);
    return partes.join('');
  };

  let corpo: string;
  if (!layout.folhaA4) {
    // Rolo térmico: uma etiqueta por página
    corpo = itens
      .map(item => `<div class="etq termica" style="margin-top:${mm(opcoes.ajusteTopoMm)};margin-left:${mm(opcoes.ajusteEsquerdaMm)};">${conteudoEtiqueta(item)}</div>`)
      .join('');
  } else {
    // Folha A4: páginas de colunas × linhas, cada etiqueta na posição exata do papel
    const porFolha = layout.colunas * layout.linhas;
    const paginas: string[] = [];
    for (let i = 0; i < itens.length; i += porFolha) {
      const etiquetas = itens.slice(i, i + porFolha).map((item, idx) => {
        const linha = Math.floor(idx / layout.colunas);
        const coluna = idx % layout.colunas;
        const top = layout.margemTopoMm + opcoes.ajusteTopoMm + linha * (layout.alturaMm + layout.espacoLinhaMm);
        const left = layout.margemEsquerdaMm + opcoes.ajusteEsquerdaMm + coluna * (layout.larguraMm + layout.espacoColunaMm);
        return `<div class="etq" style="position:absolute;top:${mm(top)};left:${mm(left)};">${conteudoEtiqueta(item)}</div>`;
      });
      paginas.push(`<div class="folha">${etiquetas.join('')}</div>`);
    }
    corpo = paginas.join('');
  }

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Etiquetas</title>
<style>
@page { size: ${pageSize}; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; }
.etq { width: ${layout.larguraMm}mm; height: ${h}mm; overflow: hidden; padding: 1.4mm 1.6mm; display: flex; flex-direction: column; }
.loja { flex: none; font-size: ${lojaPt}pt; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; text-align: center; line-height: 1.15; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-bottom: 0.5mm; border-bottom: 0.25mm solid #000; }
.nome { flex: 1; min-height: 0; margin-top: 0.8mm; font-size: ${nomePt}pt; font-weight: 700; line-height: 1.15; text-align: center; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.rodape { flex: none; height: ${mm(rodapeMm)}; display: flex; align-items: flex-end; gap: 1.5mm; }
/* 22mm mínimos: abaixo disso o módulo do EAN fica < 0,23mm e o leitor erra a 203 dpi */
.codigo { width: max(52%, 22mm); flex: none; height: 100%; display: flex; flex-direction: column; }
.sem-preco .codigo { width: 70%; margin: 0 auto; }
.barras { flex: 1; min-height: 0; }
.digitos { flex: none; font-size: ${digitosPt}pt; letter-spacing: 0.08em; text-align: center; line-height: 1.2; }
.semcod { justify-content: center; align-items: center; font-size: ${digitosPt}pt; font-weight: 700; border: 0.25mm dashed #000; }
.preco { flex: 1; text-align: right; font-size: ${precoPt}pt; font-weight: 800; line-height: 0.95; letter-spacing: -0.02em; white-space: nowrap; }
.preco.longo { font-size: ${Math.round(precoPt * 0.78)}pt; }
.rs { font-size: 0.42em; font-weight: 700; vertical-align: 0.95em; margin-right: 0.12em; letter-spacing: 0; }
.termica { page-break-after: always; }
.termica:last-child { page-break-after: auto; }
.folha { width: 210mm; height: 296.5mm; position: relative; overflow: hidden; page-break-after: always; }
.folha:last-child { page-break-after: auto; }
.barra-acao { position: fixed; top: 8px; right: 8px; }
.barra-acao button { font: 700 14px Arial, sans-serif; padding: 10px 18px; background: #4f46e5; color: #fff; border: 0; border-radius: 8px; cursor: pointer; }
@media print { .barra-acao { display: none; } }
</style>
</head>
<body>
<div class="barra-acao"><button type="button" onclick="window.print()">Imprimir</button></div>
${corpo}
<script>
// A própria janela dispara a impressão depois de carregar: chamar print() do
// opener falha em silêncio no Chrome quando o popup ainda não está em foco
window.addEventListener('load', function () { setTimeout(function () { window.focus(); window.print(); }, 300); });
</script>
</body>
</html>`;
}

export function printLabels(itens: LabelItem[], layout: LabelLayout, opcoes: LabelOptions, nomeLoja = ''): boolean {
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) return false; // popup bloqueado
  w.document.open();
  w.document.write(buildLabelsHtml(itens, layout, opcoes, nomeLoja));
  w.document.close();
  w.focus();
  return true;
}
