import React, { useMemo } from 'react';
import { Check, Search } from 'lucide-react';
import { chaveCanonica } from './taxonomia';

export interface FamiliaOpcao {
    chave: string;
    nome: string;
}

interface FamiliaPickerProps {
    familias: FamiliaOpcao[];
    value: string;
    onChange: (chave: string) => void;
    disabled?: boolean;
    erro?: string | null;
}

const col = new Intl.Collator('pt-BR', { sensitivity: 'base' });

/**
 * Família do item com busca e ordem alfabética — substitui o <select> nativo, que não tem
 * procura e lista na ordem do arquivo (o lojista não achava "Moda e Vestuário" no meio da lista).
 * Só lista oficial: nenhuma família é criada aqui.
 */
const FamiliaPicker: React.FC<FamiliaPickerProps> = ({ familias, value, onChange, disabled, erro }) => {
    const [busca, setBusca] = React.useState('');

    const ordenadas = useMemo(
        () => (familias || []).slice().sort((a, b) => col.compare(a.nome, b.nome)),
        [familias],
    );

    const visiveis = useMemo(() => {
        const alvo = chaveCanonica(busca);
        if (!alvo) return ordenadas;
        return ordenadas.filter(f => chaveCanonica(f.nome).includes(alvo) || chaveCanonica(f.chave).includes(alvo));
    }, [ordenadas, busca]);

    const pildora = (ativo: boolean) =>
        `inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${ativo
            ? 'border-blue-600 bg-blue-600 text-white'
            : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'}`;

    return (
        <div className="min-w-0 space-y-2">
            <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                    type="search"
                    value={busca}
                    onChange={e => setBusca(e.target.value)}
                    placeholder="Buscar família… (ex.: vestuário, bebida, limpeza)"
                    aria-label="Buscar família do item"
                    disabled={disabled}
                    className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-sm text-gray-900 outline-none transition-all focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:disabled:bg-gray-900"
                />
            </div>

            {visiveis.length === 0 && (
                <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
                    Nenhuma família com esse nome. Veja a lista completa abaixo da busca.
                </p>
            )}

            <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto" role="listbox" aria-label="Família do item">
                {visiveis.map(familia => {
                    const ativo = familia.chave === value;
                    return (
                        <button key={familia.chave} type="button" role="option" aria-selected={ativo}
                            disabled={disabled}
                            onClick={() => onChange(familia.chave)}
                            className={pildora(ativo)}>
                            {familia.nome}
                            {ativo && <Check className="h-3.5 w-3.5" />}
                        </button>
                    );
                })}
            </div>

            {erro && <p className="text-xs font-semibold text-red-600">{erro}</p>}
        </div>
    );
};

export default FamiliaPicker;
