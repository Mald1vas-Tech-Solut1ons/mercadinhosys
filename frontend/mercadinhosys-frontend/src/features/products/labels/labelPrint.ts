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

export function barcodeSvg(codigo: string, alturaPx: number): string {
  const formato = formatoDoCodigo(codigo);
  if (!formato) return '';
  try {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    JsBarcode(svg, codigo.trim(), {
      format: formato, width: 1.6, height: alturaPx, displayValue: true,
      fontSize: 12, margin: 0, textMargin: 1,
    });
    // Sem tamanho fixo: o viewBox do JsBarcode deixa o SVG escalar pela etiqueta
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.setAttribute('style', 'width:100%;height:auto;max-height:100%');
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

export function buildLabelsHtml(itens: LabelItem[], layout: LabelLayout, opcoes: LabelOptions): string {
  const nomePt = layout.alturaMm <= 25 ? 7 : 8.5;
  const precoPt = layout.alturaMm <= 25 ? 10 : 13;
  const alturaBarraPx = Math.round(layout.alturaMm * 1.6);
  const pageSize = layout.folhaA4 ? '210mm 297mm' : `${layout.larguraMm}mm ${layout.alturaMm}mm`;

  const conteudoEtiqueta = (item: LabelItem): string => {
    const partes: string[] = [];
    if (opcoes.mostrarNome) partes.push(`<div class="nome">${escapeHtml(item.nome)}</div>`);
    const svg = barcodeSvg(item.codigo || '', alturaBarraPx);
    partes.push(svg ? `<div class="barra">${svg}</div>` : '<div class="barra semcod">SEM CÓDIGO</div>');
    if (opcoes.mostrarPreco) partes.push(`<div class="preco">${precoBR(item.preco)}</div>`);
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
.etq { width: ${layout.larguraMm}mm; height: ${layout.alturaMm}mm; overflow: hidden; padding: 1.2mm; display: flex; flex-direction: column; align-items: center; justify-content: space-between; text-align: center; }
.nome { font-size: ${nomePt}pt; font-weight: 700; line-height: 1.1; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; width: 100%; }
.preco { font-weight: 800; font-size: ${precoPt}pt; }
.barra { flex: 1; width: 100%; min-height: 0; display: flex; align-items: center; justify-content: center; }
.semcod { font-size: 7pt; color: #900; }
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

export function printLabels(itens: LabelItem[], layout: LabelLayout, opcoes: LabelOptions): boolean {
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) return false; // popup bloqueado
  w.document.open();
  w.document.write(buildLabelsHtml(itens, layout, opcoes));
  w.document.close();
  w.focus();
  return true;
}
