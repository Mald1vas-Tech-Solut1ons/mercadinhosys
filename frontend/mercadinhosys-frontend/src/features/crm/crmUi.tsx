import React, { useEffect, useState } from 'react';
import { crmApi } from './crmApi';
import { campo } from './crmFormat';

export const Rotulo: React.FC<{ texto: string; children: React.ReactNode; dica?: string }> = ({ texto, children, dica }) => (
    <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">{texto}</span>
        {children}
        {dica && <span className="block text-[11px] text-muted-foreground">{dica}</span>}
    </label>
);

export const Kpi: React.FC<{ titulo: string; valor: React.ReactNode; detalhe?: React.ReactNode; alerta?: boolean }> =
    ({ titulo, valor, detalhe, alerta }) => (
        <div className={`rounded-lg border bg-card p-4 ${alerta ? 'border-red-400 dark:border-red-500/60' : ''}`}>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{titulo}</p>
            <p className={`mt-1 text-2xl font-semibold tabular-nums ${alerta ? 'text-red-600 dark:text-red-400' : 'text-foreground'}`}>
                {valor}
            </p>
            {detalhe && <p className="mt-1 text-xs text-muted-foreground">{detalhe}</p>}
        </div>
    );

const TONS: Record<string, string> = {
    cinza: 'bg-muted text-muted-foreground',
    azul: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300',
    verde: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300',
    amarelo: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
    vermelho: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300',
};

export const Selo: React.FC<{ tom?: keyof typeof TONS; children: React.ReactNode }> = ({ tom = 'cinza', children }) => (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONS[tom]}`}>{children}</span>
);

export const Vazio: React.FC<{ texto: string }> = ({ texto }) => (
    <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{texto}</p>
);

export const ClienteBusca: React.FC<{ valor: { id: number; nome: string } | null;
                                      onChange: (c: { id: number; nome: string } | null) => void }> = ({ valor, onChange }) => {
    const [termo, setTermo] = useState('');
    const [opcoes, setOpcoes] = useState<{ id: number; nome: string; documento?: string }[]>([]);
    const ativo = termo.trim().length >= 2;
    useEffect(() => {
        if (!ativo) return;
        const t = setTimeout(() => { crmApi.buscarClientes(termo.trim()).then(setOpcoes).catch(() => setOpcoes([])); }, 300);
        return () => clearTimeout(t);
    }, [termo, ativo]);
    if (valor) {
        return (
            <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-sm">
                <span className="truncate">{valor.nome}</span>
                <button type="button" className="text-xs text-primary hover:underline" onClick={() => onChange(null)}>trocar</button>
            </div>
        );
    }
    return (
        <div className="relative">
            <input className={campo} placeholder="Buscar cliente por nome ou documento" value={termo}
                   onChange={e => setTermo(e.target.value)} />
            {ativo && opcoes.length > 0 && (
                <ul className="absolute z-[220] mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover shadow-lg">
                    {opcoes.map(o => (
                        <li key={o.id}>
                            <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                                    onClick={() => { onChange({ id: o.id, nome: o.nome }); setTermo(''); setOpcoes([]); }}>
                                {o.nome} {o.documento && <span className="text-xs text-muted-foreground">· {o.documento}</span>}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};
