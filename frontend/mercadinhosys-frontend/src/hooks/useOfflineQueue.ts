/**
 * useOfflineQueue — Fila de vendas offline para PDV resiliente
 *
 * Arquitetura:
 * - Armazena vendas em IndexedDB (via Dexie) quando sem internet
 * - Processa automaticamente quando conexão é restaurada
 * - Suporta até 24h de operação offline
 * - IDs temporários com UUID no frontend
 */
import { useState, useEffect, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { apiClient } from '../api/apiClient';
import { db, VendaOffline } from '../lib/db';

// ────────────────────────────────────────────────────────────────────────────
// Hook principal
// ────────────────────────────────────────────────────────────────────────────

export function useOfflineQueue() {
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  // Vendas que o servidor recusou (dado inválido): não somem sozinhas nem ficam invisíveis.
  const [rejeitadas, setRejeitadas] = useState<VendaOffline[]>([]);

  // Atualiza contagem de pendências
  const refreshCount = useCallback(async () => {
    try {
      const count = await db.vendas.count();
      setPendingCount(count);
      setRejeitadas(await db.vendas.filter(v => v.status === 'error' && !!v.rejeitada).toArray());
    } catch {
      // Dexie pode não estar disponível em alguns contextos
    }
  }, []);

  // Enfileira venda offline
  const enqueue = useCallback(async (payload: any): Promise<string> => {
    // Usa o offline_uuid já presente no payload (gerado no pdvService) como chave,
    // garantindo que a venda tenha UM único uuid em toda a cadeia (idempotência).
    const uuid = payload?.offline_uuid || uuidv4();
    const item: VendaOffline = {
      id: uuid,
      payload,
      status: 'pending',
      timestamp: new Date().toISOString(),
    };
    await db.vendas.put(item);
    await refreshCount();
    console.log(`📦 Venda enfileirada offline: ${uuid}`);
    return uuid;
  }, [refreshCount]);

  // Processa fila — tenta enviar cada venda para o backend
  const processQueue = useCallback(async (): Promise<{ synced: number; failed: number; lastError?: string }> => {
    if (isSyncing) return { synced: 0, failed: 0 };
    setIsSyncing(true);

    let synced = 0;
    let failed = 0;
    let lastError: string | undefined;

    try {
      const items = await db.vendas.toArray();
      if (items.length === 0) return { synced: 0, failed: 0 };

      console.log(`🔄 Processando ${items.length} venda(s) offline...`);

      for (const item of items) {
        try {
          // Atualiza status para syncing
          await db.vendas.update(item.id, { status: 'syncing' });

          // Tenta enviar para o backend
          const response = await apiClient.post('/pdv/finalizar', {
            ...item.payload,
            offline_uuid: item.id,     // Rastreabilidade
            offline_criadoEm: item.timestamp,
          });

          if (response.data?.venda || response.data?.success) {
            await db.vendas.delete(item.id);
            synced++;
            console.log(`✅ Venda offline sincronizada: ${item.id}`);
          } else {
            // 2xx sem confirmação: não deixa a venda presa em "syncing"
            lastError = 'Resposta do servidor sem confirmação';
            await db.vendas.update(item.id, { status: 'error', error_message: lastError });
            failed++;
          }
        } catch (err: any) {
          // Erro de rede → deixa na fila para próxima tentativa
          const erroMsg = err?.response?.data?.message || err?.message || 'Erro de rede';
          const isNetworkError = !err?.response;
          lastError = isNetworkError ? 'Sem conexão com o servidor' : erroMsg;

          if (isNetworkError) {
            // Sem internet ainda — atualiza status e sai do loop
            await db.vendas.update(item.id, { status: 'error', error_message: erroMsg });
            failed++;
            break; // Não adianta tentar as próximas se sem rede
          } else {
            // Erro do servidor (400/500) — pode ser dado inválido; marca como falha permanente
            console.error(`❌ Venda offline rejeitada pelo servidor (${item.id}):`, erroMsg);
            await db.vendas.update(item.id, { status: 'error', error_message: erroMsg, rejeitada: true });
            failed++;
          }
        }
      }
    } finally {
      setIsSyncing(false);
      await refreshCount();
    }

    return { synced, failed, lastError };
  }, [isSyncing, refreshCount]);

  // Monitora status de rede
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      // Tenta processar fila automaticamente quando volta a internet
      processQueue().then(({ synced }) => {
        if (synced > 0) {
          console.log(`✅ ${synced} venda(s) offline sincronizada(s) automaticamente`);
        }
      });
    };

    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Carrega contagem inicial
    refreshCount();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [processQueue, refreshCount]);

  // Tira da fila uma venda recusada pelo servidor (depois que o operador conferiu o motivo).
  const descartar = useCallback(async (id: string) => {
    await db.vendas.delete(id);
    await refreshCount();
  }, [refreshCount]);

  return {
    pendingCount,
    rejeitadas,
    descartar,
    isSyncing,
    isOnline,
    enqueue,
    processQueue,
    refreshCount,
  };
}

