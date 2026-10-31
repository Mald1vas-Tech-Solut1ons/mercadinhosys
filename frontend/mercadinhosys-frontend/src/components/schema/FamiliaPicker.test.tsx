import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import FamiliaPicker from './FamiliaPicker';

const FAMILIAS = [
    { chave: 'alimento', nome: 'Mercearia e Alimentos' },
    { chave: 'bebida', nome: 'Bebidas' },
    { chave: 'vestuario', nome: 'Moda e Vestuário' },
    { chave: 'limpeza', nome: 'Limpeza' },
    { chave: 'calcados', nome: 'Calçados' },
];

describe('FamiliaPicker — busca e ordem alfabética', () => {
    it('mostra as famílias em ordem alfabética (Calçados primeiro, Vestuário na posição do V)', () => {
        render(<FamiliaPicker familias={FAMILIAS} value="" onChange={vi.fn()} />);
        const nomes = screen.getAllByRole('option').map(o => o.textContent?.trim());
        expect(nomes).toEqual(['Bebidas', 'Calçados', 'Limpeza', 'Mercearia e Alimentos', 'Moda e Vestuário']);
    });

    it('a barra de busca existe e acha a família pelo nome ("vest" → Moda e Vestuário)', () => {
        render(<FamiliaPicker familias={FAMILIAS} value="" onChange={vi.fn()} />);
        const busca = screen.getByLabelText('Buscar família do item');
        expect(busca).toBeInTheDocument();

        fireEvent.change(busca, { target: { value: 'vest' } });
        expect(screen.getByRole('option', { name: /Moda e Vestuário/ })).toBeInTheDocument();
        expect(screen.queryByRole('option', { name: /Bebidas/ })).not.toBeInTheDocument();
    });

    it('busca sem acento encontra a família acentuada ("calcados" → Calçados)', () => {
        render(<FamiliaPicker familias={FAMILIAS} value="" onChange={vi.fn()} />);
        fireEvent.change(screen.getByLabelText('Buscar família do item'), { target: { value: 'calcados' } });
        expect(screen.getByRole('option', { name: /Calçados/ })).toBeInTheDocument();
    });

    it('escolher uma família avisa o pai com a chave', () => {
        const onChange = vi.fn();
        render(<FamiliaPicker familias={FAMILIAS} value="" onChange={onChange} />);
        fireEvent.click(screen.getByRole('option', { name: /Moda e Vestuário/ }));
        expect(onChange).toHaveBeenCalledWith('vestuario');
    });

    it('marca a família já escolhida e não cria família nova', () => {
        render(<FamiliaPicker familias={FAMILIAS} value="vestuario" onChange={vi.fn()} />);
        expect(screen.getByRole('option', { name: /Moda e Vestuário/ })).toHaveAttribute('aria-selected', 'true');
        expect(screen.queryByRole('button', { name: /criar/i })).not.toBeInTheDocument();
    });
});
