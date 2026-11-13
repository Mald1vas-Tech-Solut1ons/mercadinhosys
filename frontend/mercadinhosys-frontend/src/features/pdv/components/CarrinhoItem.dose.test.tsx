import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../../contexts/ConfigContext', () => ({ useConfig: () => ({ config: { mostrar_foto_produto_pdv: false } }) }));
vi.mock('../../../utils/toast', () => ({ showToast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() } }));

import CarrinhoItem from './CarrinhoItem';

const base = {
    produto: { id: 7, nome: 'WHISKY 1L', unidade_medida: 'L', estoque_atual: 2, preco_venda: 150 } as any,
    quantidade: 2, precoUnitario: 18, desconto: 0, total: 36,
    onAtualizarQuantidade: vi.fn(), onRemover: vi.fn(), onAplicarDesconto: vi.fn(),
};

describe('CarrinhoItem — linha de dose', () => {
    it('mostra a dose, o preço por dose e a unidade DOSE; não mostra o estoque em garrafas', () => {
        render(<CarrinhoItem {...base} dose={{ id: 1, nome: 'Dose', volumeMl: 50 }} />);
        expect(screen.getByTestId('linha-dose').textContent).toBe('Dose · 50 ml');
        expect(screen.getByText('DOSE')).toBeInTheDocument();
        expect(screen.getByText(/\/dose/)).toBeInTheDocument();
        expect(screen.queryByText(/Est:/)).not.toBeInTheDocument();
    });

    it('dose de produto vendido em litro não vira granel: quantidade inteira de copos', () => {
        render(<CarrinhoItem {...base} quantidade={3} dose={{ id: 1, nome: 'Dose', volumeMl: 50 }} />);
        expect((screen.getByLabelText('Quantidade') as HTMLInputElement).value).toBe('3');
        expect(screen.getByLabelText('Quantidade')).toHaveAttribute('inputmode', 'numeric');
    });

    it('dose livre mostra o ml digitado', () => {
        render(<CarrinhoItem {...base} dose={{ id: null, nome: 'Dose livre', volumeMl: 45, livre: true }} />);
        expect(screen.getByTestId('linha-dose').textContent).toBe('Dose livre · 45 ml');
    });

    it('linha sem dose continua igual: unidade do produto e estoque', () => {
        render(<CarrinhoItem {...base} quantidade={1} precoUnitario={150} total={150} />);
        expect(screen.queryByTestId('linha-dose')).not.toBeInTheDocument();
        expect(screen.getByText('L')).toBeInTheDocument();
        expect(screen.getByText(/Est:/)).toBeInTheDocument();
        expect(screen.getByLabelText('Quantidade')).toHaveAttribute('inputmode', 'decimal');   // litro segue granel
    });
});
