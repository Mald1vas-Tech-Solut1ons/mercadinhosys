import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TourExecutivo from './TourExecutivo';

// Todos os alvos do tour presentes ao mesmo tempo: o teste valida o conteúdo dos passos,
// não a navegação entre telas.
const ALVOS = [
    'tour-indicadores', 'tour-produtos-upload', 'tour-produtos-etiquetas', 'tour-clientes-upload',
    'tour-pdv-leitor', 'tour-vendas-historico', 'tour-delivery-visao', 'tour-despesas-add',
    'tour-compras-visao', 'tour-relatorios-visao', 'tour-rh-visao', 'tour-ponto-bater',
];

beforeAll(() => { Element.prototype.scrollIntoView = () => {}; });

const montar = () => render(
    <MemoryRouter initialEntries={['/dashboard']}>
        {ALVOS.map(c => <div key={c} className={c}>alvo</div>)}
        <TourExecutivo />
    </MemoryRouter>,
);

const iniciar = () => act(() => { window.dispatchEvent(new CustomEvent('start-tour')); });

const avancarAte = async (titulo: string) => {
    for (let i = 0; i < 15; i++) {
        if (screen.queryByText(titulo)) return;
        fireEvent.click(await screen.findByRole('button', { name: /Próximo|Finalizar/ }));
    }
};

describe('TourExecutivo — etiquetas e código interno', () => {
    it('explica o EAN interno no passo de etiquetas', async () => {
        montar();
        iniciar();
        await avancarAte('Etiquetas e Código de Barras Próprio');

        expect(await screen.findByText('Etiquetas e Código de Barras Próprio')).toBeTruthy();
        expect(screen.getByText('Produto sem código? Resolvido')).toBeTruthy();
        expect(screen.getByText(/Gerar código interno/)).toBeTruthy();
        expect(screen.getByText(/prefixo 20/)).toBeTruthy();
        expect(screen.getByText(/gerente e administrador/)).toBeTruthy();
        expect(screen.getByText(/Passo 3 de 12/)).toBeTruthy();
    });

    it('percorre todos os 12 passos sem travar e finaliza', async () => {
        const { container } = montar();
        iniciar();
        for (let i = 1; i <= 12; i++) {
            expect(await screen.findByText(`Passo ${i} de 12`)).toBeTruthy();
            fireEvent.click(screen.getByRole('button', { name: i === 12 ? 'Finalizar' : 'Próximo' }));
        }
        expect(container.querySelector('.fixed.inset-0')).toBeNull();
    });
});
