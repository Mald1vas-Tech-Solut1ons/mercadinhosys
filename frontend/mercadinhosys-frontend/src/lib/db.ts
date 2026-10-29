import Dexie, { Table } from 'dexie';
import { ProdutoCatalogo } from '../features/pdv/offlineCatalog';
import { FinalizarVendaRequest } from '../features/pdv/pdvService';

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

export class MercadinhoDB extends Dexie {
  produtos!: Table<ProdutoCatalogo, number>;
  vendas!: Table<VendaOffline, string>;
  clientes!: Table<ClienteOffline, number>;

  constructor() {
    super('MercadinhoSysDB');
    this.version(1).stores({
      produtos: 'id, codigo_barras, nome, codigo_interno', // Primary key and indexed props
      vendas: 'id, status, timestamp',
      clientes: 'id, nome, cpf_cnpj'
    });
  }
}

export const db = new MercadinhoDB();
