import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CategoriaPicker from './CategoriaPicker';
import { TaxonomiaCategoria } from '../../types/viewSchema';

const TAXONOMIA: TaxonomiaCategoria[] = [
    {
        chave: 'bazar.cozinha',
        nome: 'Cozinha',
        subcategorias: [
            { chave: 'bazar.cozinha.panela', nome: 'Panelas' },
            { chave: 'bazar.cozinha.frigideira', nome: 'Frigideiras' },
        ],
    },
    {
        chave: 'cama_mesa_banho.mesa_cozinha',
        nome: 'Mesa e Cozinha',
        subcategorias: [{ chave: 'cama_mesa_banho.mesa_cozinha.pano_prato', nome: 'Panos de Prato' }],
    },
    {
        chave: 'bazar.outro',
        nome: 'Outros',
        subcategorias: [{ chave: 'bazar.outro.outro_bazar', nome: 'Outros Bazar' }],
    },
];

const renderPicker = (onChange = vi.fn(), value = '') =>
    render(<CategoriaPicker taxonomia={TAXONOMIA} value={value} onChange={onChange} />);

describe('CategoriaPicker (PLANO §4 item 1)', () => {
    it('digitar "pan" lista "Panelas — Cozinha" (a categoria-mãe ao lado)', () => {
        renderPicker();
        fireEvent.change(screen.getByLabelText('Buscar subcategoria'), { target: { value: 'pan' } });

        expect(screen.getByText(/Panelas/)).toBeInTheDocument();
        expect(screen.getByText(/— Cozinha/)).toBeInTheDocument();
        expect(screen.getByText(/Panos de Prato/)).toBeInTheDocument();
        expect(screen.queryByText(/Frigideiras/)).not.toBeInTheDocument();
    });

    it('a busca é pela chave canônica: sem acento, sem maiúscula, plural = singular', () => {
        renderPicker();
        const busca = screen.getByLabelText('Buscar subcategoria');

        fireEvent.change(busca, { target: { value: 'PANELA' } });
        expect(screen.getByText(/Panelas/)).toBeInTheDocument();

        fireEvent.change(busca, { target: { value: 'pano de prato' } });
        expect(screen.getByText(/Panos de Prato/)).toBeInTheDocument();
    });

    it('sem resultado mostra a mensagem da lista oficial', () => {
        renderPicker();
        fireEvent.change(screen.getByLabelText('Buscar subcategoria'), { target: { value: 'panela voadora' } });

        expect(screen.getByText('Não está na lista oficial. Use “Outros …” ou peça ao suporte')).toBeInTheDocument();
    });

    it('mostra a árvore: categorias em pílulas e as subcategorias da categoria escolhida', () => {
        renderPicker();

        expect(screen.getByRole('button', { name: 'Cozinha' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Mesa e Cozinha' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Panelas' })).toBeInTheDocument();
        // "Panos de Prato" é de outra categoria: não aparece antes de trocar a pílula.
        expect(screen.queryByRole('button', { name: 'Panos de Prato' })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Mesa e Cozinha' }));
        expect(screen.getByRole('button', { name: 'Panos de Prato' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Panelas' })).not.toBeInTheDocument();
    });

    it('escolher a subcategoria devolve OS DOIS níveis', () => {
        const onChange = vi.fn();
        renderPicker(onChange);
        fireEvent.click(screen.getByRole('button', { name: 'Panelas' }));

        expect(onChange).toHaveBeenCalledWith({
            categoria: { chave: 'bazar.cozinha', nome: 'Cozinha' },
            subcategoria: { chave: 'bazar.cozinha.panela', nome: 'Panelas' },
        });
    });

    it('escolher pelo resultado da busca também devolve o par', () => {
        const onChange = vi.fn();
        renderPicker(onChange);
        fireEvent.change(screen.getByLabelText('Buscar subcategoria'), { target: { value: 'pano' } });
        fireEvent.click(screen.getByText(/Panos de Prato/));

        expect(onChange).toHaveBeenCalledWith({
            categoria: { chave: 'cama_mesa_banho.mesa_cozinha', nome: 'Mesa e Cozinha' },
            subcategoria: { chave: 'cama_mesa_banho.mesa_cozinha.pano_prato', nome: 'Panos de Prato' },
        });
    });

    it('não existe opção de criar categoria', () => {
        renderPicker();
        expect(screen.queryByRole('button', { name: /criar/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /nova categoria/i })).not.toBeInTheDocument();
        expect(screen.queryByText(/adicionar categoria/i)).not.toBeInTheDocument();
    });

    it('mostra a categoria e a subcategoria já gravadas', () => {
        renderPicker(vi.fn(), 'bazar.cozinha.frigideira');
        // Badge da categoria + pílula da subcategoria marcada (ambas visíveis no campo).
        expect(screen.getAllByText('Cozinha').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Frigideiras').length).toBeGreaterThan(0);
    });

    it('sem taxonomia avisa em vez de inventar opções', () => {
        render(<CategoriaPicker taxonomia={[]} value="" onChange={vi.fn()} />);
        expect(screen.getByText(/lista oficial desta família não chegou/i)).toBeInTheDocument();
    });
});
