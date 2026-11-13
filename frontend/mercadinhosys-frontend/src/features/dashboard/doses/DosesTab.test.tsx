import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../api/apiClient', () => ({ apiClient: { get: vi.fn() } }));
vi.mock('recharts', () => {
    const Vazio = ({ children }: any) => <div>{children}</div>;
    return { Bar: Vazio, BarChart: Vazio, CartesianGrid: Vazio, ResponsiveContainer: Vazio, Tooltip: Vazio, XAxis: Vazio, YAxis: Vazio };
});
vi.mock('../bi/BiBlocos', () => ({
    Bloco: ({ titulo, children }: any) => <section><h3>{titulo}</h3>{children}</section>,
}));

import { apiClient } from '../../../api/apiClient';
import DosesTab from './DosesTab';
import { horaDePico, rendimentoSaudavel } from './dosesTypes';

const base = {
    periodo: { inicio: '2026-11-01', fim: '2026-11-13', dias: 13 },
    resumo: {
        doses: 10, ml: 500, receita: 180, custo: 60, margem: 120, margem_pct: 66.7, garrafas_equivalentes: 0.5,
        perdas_custo: 60, margem_liquida: 60, garrafas_encerradas: 1, rendimento_pct: 50,
    },
    produtos: [{
        produto_id: 7, produto: 'WHISKY 1L', doses: 10, ml: 500, receita: 180, custo: 60, margem: 120, margem_pct: 66.7,
        garrafas_equivalentes: 0.5, receita_por_garrafa: 360, preco_garrafa: 150, garrafas_fechadas_vendidas: 0,
        rendimento_pct: 50, garrafas_encerradas: 1, desvio_ml: 500, cobertura_dias: 12, cobertura_doses: 180,
    }],
    perdas: { total: 60, por_tipo: [{ tipo: 'desvio', rotulo: 'Diferença ao encerrar a garrafa', ml: 500, custo: 60 }] },
    abertas: { quantidade: 0, saldo_ml: 0, valor_custo: 0, vencidas: 0, itens: [] },
    por_funcionario: [{ funcionario: 'Ana', ml: 500, custo: 60, tipos: { desvio: 500 } }],
    pico_por_hora: [{ hora: 20, doses: 6, receita: 108 }, { hora: 21, doses: 4, receita: 72 }],
    alertas: [{ tipo: 'rendimento_baixo', severidade: 'alta', titulo: 'Rendimento das garrafas em 50%', descricao: 'O mínimo que você definiu é 90%.', acao: 'Ver desvio por garrafa' }],
    config: { margem_alvo_dose_pct: null, perda_esperada_pct: 0, alerta_garrafa_aberta_dias: null, alerta_rendimento_pct: 90 },
};

const periodo = { de: '2026-11-01', ate: '2026-11-13' };
const renderTab = () => render(<MemoryRouter><DosesTab periodo={periodo} /></MemoryRouter>);

describe('DosesTab', () => {
    beforeEach(() => vi.clearAllMocks());

    it('mostra os números da venda por dose, o rendimento e as perdas', async () => {
        (apiClient.get as any).mockResolvedValue({ data: { data: base } });
        renderTab();
        expect(await screen.findByText('Doses vendidas')).toBeInTheDocument();
        expect(screen.getAllByText('WHISKY 1L').length).toBeGreaterThan(0);
        expect(screen.getByText('Rendimento das garrafas em 50%')).toBeInTheDocument();
        expect(screen.getByText('1 garrafa(s) encerrada(s)')).toBeInTheDocument();
        expect(screen.getByText('Diferença ao encerrar a garrafa')).toBeInTheDocument();
        expect(screen.getByText('20h')).toBeInTheDocument();
        expect(apiClient.get).toHaveBeenCalledWith('/dashboard/doses', { params: { de: '2026-11-01', ate: '2026-11-13' } });
    });

    it('sem venda de dose explica como começar em vez de mostrar tela vazia', async () => {
        (apiClient.get as any).mockResolvedValue({ data: { data: { ...base, produtos: [], alertas: [], pico_por_hora: [], por_funcionario: [], perdas: { total: 0, por_tipo: [] } } } });
        renderTab();
        expect(await screen.findByText(/Nenhuma venda por dose neste período/)).toBeInTheDocument();
        expect(screen.queryByText('Doses vendidas')).not.toBeInTheDocument();
    });

    it('plano sem acesso mostra o aviso do plano Pro', async () => {
        (apiClient.get as any).mockRejectedValue({ response: { data: { code: 'PLAN_RESTRICTED' } } });
        renderTab();
        await waitFor(() => expect(screen.getByText(/faz parte do plano Pro/)).toBeInTheDocument());
    });
});

describe('dosesTypes', () => {
    it('rendimento: usa o mínimo da loja, senão 100% menos a perda esperada e uma folga', () => {
        expect(rendimentoSaudavel(null, 0, 90)).toBe('sem_dados');
        expect(rendimentoSaudavel(85, 0, 90)).toBe('baixo');
        expect(rendimentoSaudavel(95, 0, 90)).toBe('ok');
        expect(rendimentoSaudavel(80, 10, null)).toBe('baixo');   // limite = 100 - 10 - 5 = 85
        expect(rendimentoSaudavel(88, 10, null)).toBe('ok');
        expect(rendimentoSaudavel(10, null, null)).toBe('ok');    // sem meta nenhuma, não inventa alerta
    });

    it('horário de pico é a hora com mais doses', () => {
        expect(horaDePico([])).toBeNull();
        expect(horaDePico(base.pico_por_hora)).toBe(20);
    });
});
