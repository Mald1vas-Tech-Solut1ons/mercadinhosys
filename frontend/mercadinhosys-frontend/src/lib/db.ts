import Dexie, { Table } from 'dexie';
import { ProdutoCatalogo } from '../features/pdv/offlineCatalog';
import type { FinalizarVendaRequest, ComprovanteVendaResponse } from '../features/pdv/pdvService';

export interface VendaOffline {
  id: string; // uuid da venda
  payload: FinalizarVendaRequest;
  timestamp: string;
  status: 'pending' | 'syncing' | 'error';
  error_message?: string;
  rejeitada?: boolean; // o servidor recusou (400/500): reenviar ou descartar na mão
}

export interface ClienteOffline {
    id: number;
    nome: string;
    cpf_cnpj?: string | null;
}

/** Cópia do cupom de cada venda feita neste aparelho: reimpressão sem depender do servidor. */
export interface CupomLocal {
  id: string; // offline_uuid da venda (o mesmo da fila offline)
  venda_id?: number; // preenchido quando a venda existe no servidor
  estabelecimento_id: string; // aparelho pode ser usado por mais de uma loja
  codigo: string;
  criadoEm: string;
  offline: boolean; // ainda não sincronizada
  total: number;
  dados: ComprovanteVendaResponse;
}

export class MercadinhoDB extends Dexie {
  produtos!: Table<ProdutoCatalogo, number>;
  vendas!: Table<VendaOffline, string>;
  clientes!: Table<ClienteOffline, number>;
  cupons!: Table<CupomLocal, string>;

  constructor() {
    super('MercadinhoSysDB');
    this.version(1).stores({
      produtos: 'id, codigo_barras, nome, codigo_interno', // Primary key and indexed props
      vendas: 'id, status, timestamp',
      clientes: 'id, nome, cpf_cnpj'
    });
    this.version(2).stores({
      cupons: 'id, criadoEm, venda_id',
    });
  }
}

export const db = new MercadinhoDB();
