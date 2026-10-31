import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, screen } from '@testing-library/react';
import EntradaRapidaPallet from './EntradaRapidaPallet';
import { cosmosService } from '../../../services/cosmosService';
import { productsService } from '../productsService';
import { viewSchemaService } from '../../../services/viewSchemaService';

vi.mock('../../../services/cosmosService', () => ({ cosmosService: { lookup: vi.fn() } }));
vi.mock('../productsService', () => ({ productsService: { create: vi.fn(), ajustarEstoque: vi.fn() } }));
vi.mock('../../../services/viewSchemaService', () => ({ viewSchemaService: { getSchemaForContext: vi.fn() } }));
vi.mock('../../../utils/toast', () => ({ showToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn() } }));

const lookup = cosmosService.lookup as unknown as ReturnType<typeof vi.fn>;
const create = productsService.create as unknown as ReturnType<typeof vi.fn>;
const schema = viewSchemaService.getSchemaForContext as unknown as ReturnType<typeof vi.fn>;

const renderModal = () => render(
    <EntradaRapidaPallet show onClose={vi.fn()} onAbrirCompleto={vi.fn()} />,
);

beforeEach(() => {
    vi.clearAllMocks();
    schema.mockResolvedValue({
        familia_produto: { chave: 'alimento' },
        familias_disponiveis: [{ chave: 'alimento' }],
        taxonomia: [
            { chave: 'alimento.outros', nome: 'Outros', subcategorias: [{ chave: 'alimento.outros.outros', nome: 'Outros Alimentos' }] },
        ],
    });
});

describe('EntradaRapidaPallet', () => {
    it('bipa, preenche preço/quantidade e salva com custo estimado no servidor', async () => {
        lookup.mockResolvedValue({
            success: true,
            source: 'catalogo',
            data: {
                ean: '7891000315507',
                nome: 'Arroz Tio João 5kg',
                marca: 'Tio João',
                ncm: '10063021',
                imagem_url: 'https://exemplo/foto.jpg',
                categoria: null,
                preco_referencia: 24.9,
                sugestoes: { familia_produto: 'alimento', subcategoria: 'alimento.mercearia.arroz', atributos: { peso: '5kg' } },
            },
        });
        create.mockResolvedValue({ success: true, message: 'ok', produto: { id: 1 } });

        renderModal();

        const codigo = screen.getByPlaceholderText('Bipe ou digite o código');
        fireEvent.change(codigo, { target: { value: '7891000315507' } });
        fireEvent.keyDown(codigo, { key: 'Enter' });

        await screen.findByText('Arroz Tio João 5kg');

        fireEvent.change(screen.getByLabelText(/Preço de venda/), { target: { value: '29,90' } });
        fireEvent.change(screen.getByLabelText(/Quantidade/), { target: { value: '12' } });
        fireEvent.click(screen.getByText('Salvar e próximo (Enter)'));

        await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
        const payload = create.mock.calls[0][0];
        expect(payload).toMatchObject({
            nome: 'ARROZ TIO JOÃO 5KG',
            codigo_barras: '7891000315507',
            unidade_medida: 'UN',
            controlar_validade: false,
            quantidade: 12,
            preco_venda: 29.9,
            modo_precificacao: 'venda',
            subcategoria: 'alimento.mercearia.arroz',
        });
        expect(payload.preco_custo).toBeUndefined();
        expect(payload.categoria).toBeUndefined();

        expect(await screen.findByText('Itens desta entrada: 1')).toBeInTheDocument();
        expect(screen.getByText('12 un × R$ 29,90')).toBeInTheDocument();
    });

    it('EAN desconhecido: pede o nome, cai em "Outros" e marca sem categoria', async () => {
        lookup.mockResolvedValue({ success: false, code: 'nao_encontrado', message: 'EAN não encontrado.' });
        create.mockResolvedValue({ success: true, message: 'ok', produto: { id: 2 } });

        renderModal();

        const codigo = screen.getByPlaceholderText('Bipe ou digite o código');
        fireEvent.change(codigo, { target: { value: '7899999999999' } });
        fireEvent.keyDown(codigo, { key: 'Enter' });

        const nome = await screen.findByPlaceholderText('Nome do produto');
        fireEvent.change(nome, { target: { value: 'Sabão em pó 500g' } });
        fireEvent.change(screen.getByLabelText(/Preço de venda/), { target: { value: '8.50' } });
        fireEvent.change(screen.getByLabelText(/Quantidade/), { target: { value: '6' } });
        fireEvent.click(screen.getByText('Salvar e próximo (Enter)'));

        await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
        expect(create.mock.calls[0][0]).toMatchObject({
            nome: 'SABÃO EM PÓ 500G',
            preco_venda: 8.5,
            quantidade: 6,
            familia_produto: 'alimento',
            subcategoria: 'alimento.outros.outros',
            modo_precificacao: 'venda',
        });
        expect(await screen.findByText('sem categoria')).toBeInTheDocument();
    });

    it('família com validade obrigatória: pede a data antes de salvar e envia no payload', async () => {
        schema.mockResolvedValue({
            familia_produto: { chave: 'alimento' },
            familias_disponiveis: [{ chave: 'alimento' }],
            flags: { validade_obrigatoria: true, exige_fabricacao: false },
            taxonomia: [{ chave: 'alimento.outros', nome: 'Outros', subcategorias: [{ chave: 'alimento.outros.outros', nome: 'Outros Alimentos' }] }],
        });
        lookup.mockResolvedValue({
            success: true,
            data: { ean: '7891000315507', nome: 'Leite Integral 1L', marca: 'Itambé', ncm: '04012010', imagem_url: null, preco_referencia: 5.49, sugestoes: { familia_produto: 'alimento', subcategoria: 'alimento.mercearia.leite' } },
        });
        create.mockResolvedValue({ success: true, message: 'ok', produto: { id: 3 } });

        renderModal();
        const codigo = screen.getByPlaceholderText('Bipe ou digite o código');
        fireEvent.change(codigo, { target: { value: '7891000315507' } });
        fireEvent.keyDown(codigo, { key: 'Enter' });
        await screen.findByText('Leite Integral 1L');

        fireEvent.change(screen.getByLabelText(/Preço de venda/), { target: { value: '6,99' } });
        fireEvent.change(screen.getByLabelText(/Quantidade/), { target: { value: '24' } });
        fireEvent.click(screen.getByText('Salvar e próximo (Enter)'));

        expect(await screen.findByText(/Informe a validade/)).toBeInTheDocument();
        expect(create).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText(/Validade/), { target: { value: '2026-12-31' } });
        fireEvent.click(screen.getByText('Salvar e próximo (Enter)'));

        await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
        expect(create.mock.calls[0][0]).toMatchObject({
            data_validade: '2026-12-31',
            preco_venda: 6.99,
            quantidade: 24,
            modo_precificacao: 'venda',
        });
    });

    it('não salva sem preço (o fluxo não deixa item entrar com preço zero)', async () => {
        lookup.mockResolvedValue({
            success: true,
            data: { ean: '7891000315507', nome: 'Feijão', marca: null, ncm: null, imagem_url: null, preco_referencia: null, sugestoes: { familia_produto: 'alimento', subcategoria: 'alimento.mercearia.feijao' } },
        });

        renderModal();
        const codigo = screen.getByPlaceholderText('Bipe ou digite o código');
        fireEvent.change(codigo, { target: { value: '7891000315507' } });
        fireEvent.keyDown(codigo, { key: 'Enter' });
        await screen.findByText('Feijão');

        fireEvent.change(screen.getByLabelText(/Quantidade/), { target: { value: '3' } });
        fireEvent.click(screen.getByText('Salvar e próximo (Enter)'));

        expect(await screen.findByText('Informe o preço de venda.')).toBeInTheDocument();
        expect(create).not.toHaveBeenCalled();
    });
});
