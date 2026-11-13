import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import DosesEditor from './DosesEditor';
import { ConfigDosesLoja, DosesEstado, estadoVazio } from '../utils/doses';

const LOJA: ConfigDosesLoja = {
    doses_padrao: [{ nome: 'Dose', volume_ml: 50 }, { nome: 'Dose dupla', volume_ml: 100 }],
    doses_padrao_definidas: true, margem_alvo_dose_pct: 60, margem_alvo_definida: true,
    perda_esperada_pct: 0, alerta_garrafa_aberta_dias: null, alerta_rendimento_pct: null,
};

function Pagina({ inicial = estadoVazio(), nome = 'WHISKY RED 1L', loja = LOJA as ConfigDosesLoja | null, custo = 120, preco = 150,
    onEstado }: { inicial?: DosesEstado; nome?: string; loja?: ConfigDosesLoja | null; custo?: number; preco?: number;
    onEstado?: (e: DosesEstado) => void }) {
    const [valor, setValor] = useState(inicial);
    return (
        <DosesEditor valor={valor} loja={loja} custoGarrafa={custo} precoGarrafa={preco} nomeProduto={nome}
            onChange={novo => { setValor(novo); onEstado?.(novo); }} />
    );
}

const ligar = () => fireEvent.click(screen.getByRole('checkbox', { name: 'Vender também por dose' }));
const linhas = () => screen.queryAllByTestId('dose-linha');
const campo = (linha: HTMLElement, nome: string) => within(linha).getByLabelText(nome) as HTMLInputElement;

describe('DosesEditor — doses com ml livre', () => {
    it('desligado mostra só a opção; ligar detecta o volume pelo nome do produto', () => {
        render(<Pagina />);
        expect(screen.queryByLabelText(/Quanto tem a garrafa/)).not.toBeInTheDocument();
        ligar();
        expect((screen.getByLabelText(/Quanto tem a garrafa/) as HTMLInputElement).value).toBe('1000');
    });

    it('produto sem volume no nome deixa o campo vazio para o lojista informar', () => {
        render(<Pagina nome="CACHAÇA ARTESANAL" />);
        ligar();
        expect((screen.getByLabelText(/Quanto tem a garrafa/) as HTMLInputElement).value).toBe('');
        fireEvent.click(screen.getByRole('button', { name: '750 ml' }));
        expect((screen.getByLabelText(/Quanto tem a garrafa/) as HTMLInputElement).value).toBe('750');
    });

    it('atalho da loja cria a dose com o preço pela margem alvo (custo R$ 6 → R$ 15 a 60%)', () => {
        render(<Pagina />);
        ligar();
        fireEvent.click(screen.getByRole('button', { name: /\+ Dose · 50 ml/ }));
        const [linha] = linhas();
        expect(campo(linha, 'ml da dose').value).toBe('50');
        expect(campo(linha, 'Preço da dose').value).toBe('15');
        expect(campo(linha, 'Margem da dose').value).toBe('60');
        expect(within(linha).getByText(/Custo R\$\s*6,00 por dose/)).toBeInTheDocument();
        expect(within(linha).getByText(/20 doses por garrafa/)).toBeInTheDocument();
        // a primeira dose vira a padrão e o atalho dela some da lista
        expect(within(linha).getByRole('button', { name: 'Tornar padrão' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.queryByRole('button', { name: /\+ Dose · 50 ml/ })).not.toBeInTheDocument();
    });

    it('ml é livre: 51,5 ml recalcula o custo da dose', () => {
        render(<Pagina />);
        ligar();
        fireEvent.click(screen.getByRole('button', { name: /Outra dose/ }));
        const [linha] = linhas();
        fireEvent.change(campo(linha, 'ml da dose'), { target: { value: '51,5' } });
        fireEvent.change(campo(linha, 'Preço da dose'), { target: { value: '19,90' } });
        expect(within(linhas()[0]).getByText(/Custo R\$\s*6,18 por dose/)).toBeInTheDocument();
    });

    it('digitar a margem recalcula o preço (6 de custo a 70% → R$ 20)', () => {
        render(<Pagina />);
        ligar();
        fireEvent.click(screen.getByRole('button', { name: /\+ Dose · 50 ml/ }));
        const margem = campo(linhas()[0], 'Margem da dose');
        fireEvent.focus(margem);
        fireEvent.change(margem, { target: { value: '70' } });
        expect(campo(linhas()[0], 'Preço da dose').value).toBe('20');
        expect(campo(linhas()[0], 'Margem da dose').value).toBe('70');    // o texto digitado não é reescrito
    });

    it('mudar o preço mostra a margem que ele dá', () => {
        render(<Pagina />);
        ligar();
        fireEvent.click(screen.getByRole('button', { name: /\+ Dose · 50 ml/ }));
        fireEvent.change(campo(linhas()[0], 'Preço da dose'), { target: { value: '18' } });
        expect(campo(linhas()[0], 'Margem da dose').value).toBe('66,7');
    });

    it('resumo da garrafa e avisos de margem e de dose mais barata que a garrafa', () => {
        render(<Pagina />);
        ligar();
        fireEvent.click(screen.getByRole('button', { name: /\+ Dose · 50 ml/ }));
        fireEvent.change(campo(linhas()[0], 'Preço da dose'), { target: { value: '18' } });
        expect(screen.getByTestId('doses-resumo').textContent).toMatch(/Uma garrafa de 1 L rende 20 doses de 50 ml/);
        expect(screen.getByTestId('doses-resumo').textContent).toMatch(/2,4×/);
        fireEvent.click(screen.getByRole('button', { name: /Outra dose/ }));
        fireEvent.change(campo(linhas()[1], 'Nome da dose'), { target: { value: 'Promo' } });
        fireEvent.change(campo(linhas()[1], 'ml da dose'), { target: { value: '50' } });
        fireEvent.change(campo(linhas()[1], 'Preço da dose'), { target: { value: '5' } });
        const avisos = screen.getByTestId('doses-avisos').textContent || '';
        expect(avisos).toMatch(/Promo: o preço não cobre o custo/);
        expect(avisos).toMatch(/Promo: cada ml sai mais barato que na garrafa fechada/);
    });

    it('remover a dose padrão passa o posto para a próxima', () => {
        let ultimo: DosesEstado | null = null;
        render(<Pagina onEstado={e => { ultimo = e; }} />);
        ligar();
        fireEvent.click(screen.getByRole('button', { name: /\+ Dose · 50 ml/ }));
        fireEvent.click(screen.getByRole('button', { name: /\+ Dose dupla · 100 ml/ }));
        expect(ultimo!.doses.map(d => d.padrao)).toEqual([true, false]);
        fireEvent.click(within(linhas()[0]).getByRole('button', { name: 'Remover dose' }));
        expect(ultimo!.doses).toHaveLength(1);
        expect(ultimo!.doses[0]).toMatchObject({ nome: 'Dose dupla', padrao: true });
    });

    it('escolher outra dose como padrão desmarca a anterior', () => {
        let ultimo: DosesEstado | null = null;
        render(<Pagina onEstado={e => { ultimo = e; }} />);
        ligar();
        fireEvent.click(screen.getByRole('button', { name: /\+ Dose · 50 ml/ }));
        fireEvent.click(screen.getByRole('button', { name: /\+ Dose dupla · 100 ml/ }));
        fireEvent.click(within(linhas()[1]).getByRole('button', { name: 'Tornar padrão' }));
        expect(ultimo!.doses.map(d => d.padrao)).toEqual([false, true]);
    });

    it('sem custo informado não inventa preço nem margem', () => {
        render(<Pagina custo={0} />);
        ligar();
        fireEvent.click(screen.getByRole('button', { name: /\+ Dose · 50 ml/ }));
        expect(campo(linhas()[0], 'Preço da dose').value).toBe('');
        expect(campo(linhas()[0], 'Margem da dose')).toBeDisabled();
        expect(screen.queryByRole('button', { name: 'Sugerir preço' })).not.toBeInTheDocument();
    });

    it('sem padrões definidos pela loja ainda oferece as sugestões iniciais e o botão de dose livre', () => {
        render(<Pagina loja={{ ...LOJA, doses_padrao_definidas: false }} />);
        ligar();
        expect(screen.getByRole('button', { name: /\+ Dose dupla · 100 ml/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Outra dose/ })).toBeInTheDocument();
    });

    it('a perda esperada encarece a dose na hora', () => {
        render(<Pagina />);
        ligar();
        fireEvent.click(screen.getByRole('button', { name: /\+ Dose · 50 ml/ }));
        fireEvent.click(screen.getByText(/Avançado/));
        fireEvent.change(screen.getByLabelText(/Perda esperada/), { target: { value: '10' } });
        expect(within(linhas()[0]).getByText(/Custo R\$\s*6,67 por dose/)).toBeInTheDocument();
    });

    it('limita a 12 doses', () => {
        render(<Pagina />);
        ligar();
        for (let i = 0; i < 12; i++) fireEvent.click(screen.getByRole('button', { name: /Outra dose/ }));
        expect(linhas()).toHaveLength(12);
        expect(screen.getByRole('button', { name: /Outra dose/ })).toBeDisabled();
    });
});
