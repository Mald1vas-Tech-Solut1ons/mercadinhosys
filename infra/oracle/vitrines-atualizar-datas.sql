-- Traz as lojas-vitrine da demonstração (landing "Ver funcionando") para o presente.
--
-- As vitrines têm meses de vendas, estoque, caixa e ponto, mas os dados param no dia
-- em que a seed rodou. Com o tempo o painel ("últimos 30 dias") fica vazio e a demo
-- parece quebrada. Aqui todas as datas de cada vitrine andam o MESMO número de dias,
-- para a última venda cair ontem: a história continua coerente entre si.
--
-- Uso (na VM):
--   sudo docker exec -i oracle-postgres-1 psql -U mercadinho_user -d mercadinhosys \
--        -v ON_ERROR_STOP=1 < vitrines-atualizar-datas.sql
-- Desfazer: o NOTICE informa os dias de cada loja; rode de novo trocando o sinal.
-- Só toca as lojas listadas em `vitrines` (CNPJ). Data de nascimento não muda.
--
-- Cada tabela é atualizada com TODAS as suas datas no mesmo UPDATE (regras como
-- início <= fim continuam valendo linha a linha) e em dois passos, longe e de volta,
-- para unicidade por data (ex.: um registro de ponto por dia) nunca colidir no meio.

BEGIN;

DO $$
DECLARE
    vitrines text[] := ARRAY['11222333000144', '66777888000199', '77888999000111', '88999000000122'];
    loja record;
    tabela record;
    dias int;
BEGIN
    FOR loja IN SELECT id, nome_fantasia FROM estabelecimentos WHERE cnpj = ANY (vitrines) LOOP
        SELECT (current_date - 1) - max(data_venda)::date INTO dias FROM vendas WHERE estabelecimento_id = loja.id;
        IF dias IS NULL OR dias <= 0 THEN
            RAISE NOTICE 'loja % (%): já está em dia, nada a fazer', loja.id, loja.nome_fantasia;
            CONTINUE;
        END IF;

        FOR tabela IN
            SELECT c.table_name,
                   string_agg(format('%1$I = %1$I + make_interval(days => 100000)', c.column_name), ', ') AS longe,
                   string_agg(format('%1$I = %1$I - make_interval(days => 100000 - %2$s)', c.column_name, dias), ', ') AS volta
            FROM information_schema.columns c
            WHERE c.table_schema = 'public'
              AND c.data_type IN ('date', 'timestamp without time zone', 'timestamp with time zone')
              AND c.column_name <> 'data_nascimento'
              AND c.table_name NOT LIKE 'bkp\_%'
              AND c.table_name NOT IN ('estabelecimentos', 'sync_queue')
              AND EXISTS (
                  SELECT 1 FROM information_schema.columns e
                  WHERE e.table_schema = 'public' AND e.table_name = c.table_name AND e.column_name = 'estabelecimento_id'
              )
            GROUP BY c.table_name
        LOOP
            EXECUTE format('UPDATE %I SET %s WHERE estabelecimento_id = $1', tabela.table_name, tabela.longe) USING loja.id;
            EXECUTE format('UPDATE %I SET %s WHERE estabelecimento_id = $1', tabela.table_name, tabela.volta) USING loja.id;
        END LOOP;

        RAISE NOTICE 'loja % (%): datas avançadas % dias', loja.id, loja.nome_fantasia, dias;
    END LOOP;
END $$;

COMMIT;
