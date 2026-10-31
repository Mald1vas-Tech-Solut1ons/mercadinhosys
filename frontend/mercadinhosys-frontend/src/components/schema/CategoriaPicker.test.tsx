import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CategoriaPicker from './CategoriaPicker';
import { TaxonomiaCategoria } from '../../types/viewSchema';

const TAXONOMIA: TaxonomiaCategoria[] = [
    {
        chave: 'alimento.basico',
        nome: 'Básicos da Despensa',
        subcategorias: [
            { chave: 'alimento.basico.arroz', nome: 'Arroz' },
            { chave: 'alimento.basico.feijao', nome: 'Feijão' },
        ],
    },
    {
        chave: 'alimento.cafe_manha',
        nome: 'Café da Manhã',
        subcategorias: [{ chave: 'alimento.cafe_manha.cafe', nome: 'Café' }],
    },
];

const renderPicker = (onChange = vi.fn(), value = '') =>
    render(<CategoriaPicker taxonomia={TAXONOMIA} value={value} onChange={onChange} />);

describe('CategoriaPicker — Família → Categoria → Subcategoria', () => {
    it('tem os DOIS campos visíveis e rotulados, na ordem Categoria → Subcategoria', () => {
        renderPicker();
        expect(screen.getByText(/^Categoria \*/)).toBeInTheDocument();
        expect(screen.getByText(/^Subcategoria \*/)).toBeInTheDocument();
        expect(screen.getByText(/nível 2/)).toBeInTheDocument();
    });

    it('a subcategoria não pode ser escolhida antes da categoria', () => {
        renderPicker();
        expect(screen.getByLabelText('Buscar subcategoria')).toBeDisabled();
        expect(screen.getByText('Escolha a categoria acima para ver as subcategorias.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Arroz' })).not.toBeInTheDocument();
    });

    it('escolher a categoria devolve a categoria e libera as subcategorias dela', () => {
        const onChange = vi.fn();
        renderPicker(onChange);

        fireEvent.click(screen.getByRole('button', { name: 'Básicos da Despensa' }));

        expect(onChange).toHaveBeenCalledWith({
            categoria: { chave: 'alimento.basico', nome: 'Básicos da Despensa' },
            subcategoria: { chave: '', nome: '' },
        });
        expect(screen.getByRole('button', { name: 'Arroz' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Feijão' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Café' })).not.toBeInTheDocument();
        expect(screen.getByText(/nível 3 — dentro de Básicos da Despensa/)).toBeInTheDocument();
    });

    it('trocar de categoria troca a lista de subcategorias e limpa a escolha', () => {
        const onChange = vi.fn();
        renderPicker(onChange, 'alimento.basico.arroz');

        fireEvent.click(screen.getByRole('button', { name: 'Café da Manhã' }));

        expect(onChange).toHaveBeenLastCalledWith({
            categoria: { chave: 'alimento.cafe_manha', nome: 'Café da Manhã' },
            subcategoria: { chave: '', nome: '' },
        });
        expect(screen.getByRole('button', { name: 'Café' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Arroz' })).not.toBeInTheDocument();
    });

    it('escolher a subcategoria devolve OS DOIS níveis', () => {
        const onChange = vi.fn();
        renderPicker(onChange, 'alimento.basico.arroz');
        fireEvent.click(screen.getByRole('button', { name: 'Feijão' }));

        expect(onChange).toHaveBeenCalledWith({
            categoria: { chave: 'alimento.basico', nome: 'Básicos da Despensa' },
            subcategoria: { chave: 'alimento.basico.feijao', nome: 'Feijão' },
        });
    });

    it('a busca filtra as subcategorias pela chave canônica ("feij" → Feijão)', () => {
        renderPicker(vi.fn(), 'alimento.basico.arroz');
        fireEvent.change(screen.getByLabelText('Buscar subcategoria'), { target: { value: 'feij' } });

        expect(screen.getByRole('button', { name: 'Feijão' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Arroz' })).not.toBeInTheDocument();
    });

    it('busca sem resultado mostra a mensagem da lista oficial', () => {
        renderPicker(vi.fn(), 'alimento.basico.arroz');
        fireEvent.change(screen.getByLabelText('Buscar subcategoria'), { target: { value: 'arroz integral xxx' } });

        expect(screen.getByText('Não está na lista oficial. Use “Outros …” ou peça ao suporte')).toBeInTheDocument();
    });

    it('não existe opção de criar categoria nem subcategoria', () => {
        renderPicker();
        expect(screen.queryByRole('button', { name: /criar/i })).not.toBeInTheDocument();
        expect(screen.queryByText(/adicionar/i)).not.toBeInTheDocument();
    });

    it('mostra a categoria e a subcategoria já gravadas no produto', () => {
        renderPicker(vi.fn(), 'alimento.basico.feijao');
        expect(screen.getByRole('button', { name: 'Básicos da Despensa' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Feijão' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('NÃO oferece a categoria "Outros" (é rede de segurança interna, não escolha do lojista)', () => {
        render(<CategoriaPicker taxonomia={[
            { chave: 'alimento.basico', nome: 'Básicos da Despensa', subcategorias: [{ chave: 'alimento.basico.arroz', nome: 'Arroz' }] },
            { chave: 'alimento.outro', nome: 'Outros', subcategorias: [{ chave: 'alimento.outro.outros_alimentos', nome: 'Outros Alimentos' }] },
        ]} value="" onChange={vi.fn()} />);

        expect(screen.getByRole('button', { name: 'Básicos da Despensa' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Outros' })).not.toBeInTheDocument();
        expect(screen.queryByText(/Outros Alimentos/)).not.toBeInTheDocument();
    });

    it('sem taxonomia avisa em vez de inventar opções', () => {
        render(<CategoriaPicker taxonomia={[]} value="" onChange={vi.fn()} />);
        expect(screen.getByText(/lista oficial desta família não chegou/i)).toBeInTheDocument();
    });
});
