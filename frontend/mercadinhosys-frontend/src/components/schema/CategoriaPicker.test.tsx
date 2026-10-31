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
        chave: 'bazar.outro',
        nome: 'Outros',
        subcategorias: [{ chave: 'bazar.outro.outro_bazar', nome: 'Outros Bazar' }],
    },
];

const renderPicker = (onChange = vi.fn()) =>
    render(<CategoriaPicker taxonomia={TAXONOMIA} value="" onChange={onChange} />);

describe('CategoriaPicker', () => {
    it('digitar "pan" mostra Panelas com a categoria ao lado', () => {
        renderPicker();
        fireEvent.change(screen.getByLabelText('Buscar subcategoria'), { target: { value: 'pan' } });

        expect(screen.getByText(/Panelas/)).toBeInTheDocument();
        expect(screen.getByText(/— Cozinha/)).toBeInTheDocument();
        // Frigideiras não casa com "pan".
        expect(screen.queryByText(/Frigideiras/)).not.toBeInTheDocument();
    });

    it('a busca ignora acento, maiúscula e plural (mesma chave canônica do backend)', () => {
        renderPicker();
        const busca = screen.getByLabelText('Buscar subcategoria');

        fireEvent.change(busca, { target: { value: 'PANELA' } });
        expect(screen.getByText(/Panelas/)).toBeInTheDocument();

        fireEvent.change(busca, { target: { value: 'frigideira' } });
        expect(screen.getByText(/Frigideiras/)).toBeInTheDocument();
    });

    it('texto inexistente mostra a mensagem da lista oficial', () => {
        renderPicker();
        fireEvent.change(screen.getByLabelText('Buscar subcategoria'), { target: { value: 'panela voadora' } });

        expect(screen.getByText(/Não está na lista oficial/)).toBeInTheDocument();
        expect(screen.queryByText(/^Panelas/)).not.toBeInTheDocument();
    });

    it('não existe botão de criar categoria', () => {
        renderPicker();
        expect(screen.queryByRole('button', { name: /criar/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /nova categoria/i })).not.toBeInTheDocument();
        expect(screen.queryByText(/adicionar categoria/i)).not.toBeInTheDocument();
    });

    it('escolher a subcategoria devolve OS DOIS níveis (categoria + subcategoria)', () => {
        const onChange = vi.fn();
        renderPicker(onChange);
        fireEvent.click(screen.getByRole('button', { name: 'Panelas' }));

        expect(onChange).toHaveBeenCalledWith({
            categoria: { chave: 'bazar.cozinha', nome: 'Cozinha' },
            subcategoria: { chave: 'bazar.cozinha.panela', nome: 'Panelas' },
        });
    });

    it('mostra o degrau da categoria e o da subcategoria (não é só subcategoria)', () => {
        renderPicker();
        expect(screen.getByText('1. Categoria')).toBeInTheDocument();
        expect(screen.getByText(/2\. Subcategoria de/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Cozinha' })).toBeInTheDocument();
    });

    it('mostra a escolha atual com a categoria e a subcategoria', () => {
        render(<CategoriaPicker taxonomia={TAXONOMIA} value="bazar.cozinha.frigideira" onChange={vi.fn()} />);
        // A subcategoria aparece marcada na árvore e o cabeçalho mostra o par
        // "Cozinha (categoria) + Frigideiras (subcategoria)".
        expect(screen.getAllByText('Frigideiras').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Cozinha').length).toBeGreaterThan(0);
    });

    it('sem taxonomia avisa em vez de inventar opções', () => {
        render(<CategoriaPicker taxonomia={[]} value="" onChange={vi.fn()} />);
        expect(screen.getByText(/lista oficial desta família não chegou/i)).toBeInTheDocument();
    });

    it('a árvore mostra as subcategorias da categoria escolhida', () => {
        renderPicker();
        fireEvent.click(screen.getByRole('button', { name: 'Outros' }));
        expect(screen.getByRole('button', { name: 'Outros Bazar' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Panelas' })).not.toBeInTheDocument();
    });
});
