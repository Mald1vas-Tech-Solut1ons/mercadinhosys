/**
 * Cupom em PDF (bobina de 80 mm) — o documento que vai pelo WhatsApp.
 * Montado do mesmo ComprovanteVendaResponse do cupom impresso: funciona com a
 * venda do servidor e com a cópia local de venda offline.
 */
import type { ComprovanteVendaResponse } from './pdvService';

const LARGURA_MM = 80;
const MARGEM = 4;
const LINHA = 3.6;

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const nomeArquivoCupom = (dados: ComprovanteVendaResponse) =>
    `cupom-${(dados.venda.codigo || 'venda').replace(/[^\w-]/g, '_')}.pdf`;

export async function gerarCupomPdf(dados: ComprovanteVendaResponse, segundaVia = false): Promise<Blob> {
    const { default: jsPDF } = await import('jspdf');
    const { venda, estabelecimento: est, comprovante: c } = dados;
    const util = LARGURA_MM - MARGEM * 2;

    // 1ª passada (folha longa) mede a altura; 2ª desenha na bobina do tamanho do conteúdo
    const desenhar = (doc: InstanceType<typeof jsPDF>) => {
        let y = MARGEM + 2;
        const texto = (t: string, opts: { negrito?: boolean; tam?: number; centro?: boolean } = {}) => {
            const tam = opts.tam ?? 8;
            doc.setFont('courier', opts.negrito ? 'bold' : 'normal');
            doc.setFontSize(tam);
            const linhas: string[] = doc.splitTextToSize(t, util);
            for (const l of linhas) {
                doc.text(l, opts.centro ? LARGURA_MM / 2 : MARGEM, y, { align: opts.centro ? 'center' : 'left' });
                y += LINHA * (tam / 8);
            }
        };
        const par = (esq: string, dir: string, negrito = false) => {
            doc.setFont('courier', negrito ? 'bold' : 'normal');
            doc.setFontSize(8);
            doc.text(esq, MARGEM, y);
            doc.text(dir, LARGURA_MM - MARGEM, y, { align: 'right' });
            y += LINHA;
        };
        const traco = () => {
            doc.setLineDashPattern([0.8, 0.8], 0);
            doc.line(MARGEM, y - 1.5, LARGURA_MM - MARGEM, y - 1.5);
            y += 1.5;
        };

        if (est?.nome_fantasia) texto(est.nome_fantasia.toUpperCase(), { negrito: true, tam: 10, centro: true });
        if (est?.razao_social) texto(est.razao_social, { centro: true, tam: 7 });
        if (est?.cnpj) texto(`CNPJ: ${est.cnpj}`, { centro: true, tam: 7 });
        if (est?.endereco) texto(est.endereco, { centro: true, tam: 7 });
        if (est?.telefone) texto(`Tel: ${est.telefone}`, { centro: true, tam: 7 });
        traco();
        texto(dados.nfce ? 'CUPOM FISCAL ELETRÔNICO' : 'CUPOM NÃO FISCAL', { negrito: true, centro: true, tam: 9 });
        if (segundaVia) texto('*** 2ª VIA ***', { negrito: true, centro: true });
        texto(`Nº ${venda.codigo}`, { centro: true, tam: 7 });
        texto(venda.data, { centro: true, tam: 7 });
        texto(`Cliente: ${c.cliente || 'Consumidor Final'}`, { tam: 7 });
        texto(`Operador: ${c.funcionario}`, { tam: 7 });
        if (!venda.id) texto('VENDA OFFLINE — AGUARDANDO SINCRONIZAÇÃO', { negrito: true, tam: 7 });
        traco();
        c.itens.forEach((it, i) => {
            texto(`${String(i + 1).padStart(3, '0')} ${it.nome}`, { tam: 7 });
            par(`    ${it.quantidade} x ${brl(it.preco_unitario)}`, brl(it.total));
        });
        traco();
        par('SUBTOTAL', brl(c.subtotal));
        if ((c.desconto ?? 0) > 0) par('DESCONTO', `- ${brl(c.desconto)}`);
        par('TOTAL', brl(c.total), true);
        traco();
        par('FORMA PGT.', (c.forma_pagamento || '—').toUpperCase().replace(/_/g, ' '));
        if ((c.valor_recebido ?? 0) > 0) par('VALOR RECEBIDO', brl(c.valor_recebido));
        if ((c.troco ?? 0) > 0) par('TROCO', brl(c.troco), true);
        if ((c.valor_tributos ?? 0) > 0) {
            traco();
            texto(`Valor aprox. dos tributos: ${brl(c.valor_tributos ?? 0)} (${(c.percentual_tributos ?? 0).toFixed(2)}%) Fonte: IBPT`, { tam: 6, centro: true });
        }
        traco();
        texto(c.rodape || 'Obrigado pela preferência!', { negrito: true, centro: true, tam: 7 });
        if (dados.nfce?.chave_acesso) {
            texto(`NFC-e nº ${dados.nfce.numero ?? ''} série ${dados.nfce.serie ?? ''}`, { centro: true, tam: 6 });
            texto(`Chave: ${dados.nfce.chave_acesso}`, { centro: true, tam: 6 });
            if (dados.nfce.protocolo) texto(`Protocolo: ${dados.nfce.protocolo}`, { centro: true, tam: 6 });
        } else {
            texto('Documento sem valor fiscal', { centro: true, tam: 6 });
        }
        return y + MARGEM;
    };

    const altura = Math.max(80, desenhar(new jsPDF({ unit: 'mm', format: [LARGURA_MM, 2000] })) + 6);
    const doc = new jsPDF({ unit: 'mm', format: [LARGURA_MM, altura] });
    desenhar(doc);
    return doc.output('blob');
}

export type ResultadoEnvio = 'compartilhado' | 'baixado' | 'cancelado';

/** Conversa do cliente no WhatsApp Web, sem texto: o que vai é o PDF anexado. */
export function conversaWhatsApp(telefone?: string | null): string {
    let fone = (telefone || '').replace(/\D/g, '');
    if (fone && !fone.startsWith('55') && fone.length <= 11) fone = `55${fone}`;
    return fone ? `https://web.whatsapp.com/send?phone=${fone}` : 'https://web.whatsapp.com/';
}

/**
 * Manda o PDF do cupom pelo WhatsApp. Com compartilhamento de arquivo (celular),
 * abre a folha de compartilhar com o PDF anexado. Sem ele (computador), baixa o
 * PDF e abre a conversa do cliente no WhatsApp para anexar.
 */
export async function enviarCupomWhatsApp(arquivo: File, telefone: string): Promise<ResultadoEnvio> {
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.share && nav.canShare?.({ files: [arquivo] })) {
        try {
            await nav.share({ files: [arquivo] });
            return 'compartilhado';
        } catch (e) {
            if ((e as DOMException)?.name === 'AbortError') return 'cancelado';
            // falhou o share: cai no download
        }
    }
    const url = URL.createObjectURL(arquivo);
    const a = document.createElement('a');
    a.href = url;
    a.download = arquivo.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    window.open(conversaWhatsApp(telefone), '_blank', 'noopener');
    return 'baixado';
}
