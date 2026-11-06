import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { campoDoErroServidor, irParaCampo } from './irParaCampo';

describe('irParaCampo', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        Element.prototype.scrollIntoView = vi.fn();
        document.body.innerHTML = `
            <form id="f">
                <input data-campo="nome" />
                <div data-campo="subcategoria"><button type="button">Escolher</button></div>
                <div data-campo="atributos.medida_pneu"><label>Medida</label><input id="medida" /></div>
            </form>`;
    });
    afterEach(() => vi.useRealTimers());

    it('rola até o campo, foca e contorna em vermelho até o lojista digitar', () => {
        const raiz = document.getElementById('f');
        expect(irParaCampo(raiz, 'atributos.medida_pneu')).toBe(true);
        const alvo = document.querySelector('[data-campo="atributos.medida_pneu"]') as HTMLElement;
        const input = document.getElementById('medida') as HTMLInputElement;
        expect(alvo.scrollIntoView).toHaveBeenCalled();
        vi.advanceTimersByTime(300);
        expect(document.activeElement).toBe(input);
        expect(input.style.outline).toContain('solid');
        expect(input.getAttribute('aria-invalid')).toBe('true');
        alvo.dispatchEvent(new Event('input', { bubbles: true }));
        expect(input.style.outline).toBe('');
    });

    it('foca o botão quando o campo é um seletor (subcategoria)', () => {
        irParaCampo(document.getElementById('f'), 'subcategoria');
        vi.advanceTimersByTime(300);
        expect(document.activeElement?.textContent).toBe('Escolher');
    });

    it('devolve false quando o campo não está na tela', () => {
        expect(irParaCampo(document.getElementById('f'), 'data_validade')).toBe(false);
    });
});

describe('campoDoErroServidor', () => {
    it.each([
        [{ code: 'categoria_invalida', message: 'Escolha uma subcategoria' }, 'subcategoria'],
        [{ code: 'PRODUTO_DUPLICADO_EAN' }, 'codigo_barras'],
        [{ message: 'Informe a data de validade: este tipo de produto vence' }, 'data_validade'],
        [{ message: 'Informe a data de fabricação: é obrigatória' }, 'data_fabricacao'],
        [{ errors: ['Código de barras inválido (GTIN)'] }, 'codigo_barras'],
        [{ errors: ['Produto físico novo precisa de estoque maior que zero'] }, 'quantidade'],
        // Mensagens reais do servidor (cadastro_guardiao.py e validar_dados_produto)
        [{ errors: ['O nome do produto não pode ser o próprio código de barras.'] }, 'nome'],
        [{ errors: ['O campo nome é obrigatório'] }, 'nome'],
        [{ errors: ['Código de barras com dígito verificador inválido'] }, 'codigo_barras'],
        [{ errors: ['O campo Preco Custo é obrigatório'] }, 'preco_custo'],
        [{ errors: ['O campo Preco Venda é obrigatório'] }, 'preco_venda'],
        [{ message: 'Erro interno' }, null],
    ])('%j -> %s', (resposta, campo) => {
        expect(campoDoErroServidor(resposta as any)).toBe(campo);
    });
});
