import React, { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { CampoSchema } from '../../types/viewSchema';

interface SchemaFieldProps {
    campo: CampoSchema;
    value: any;
    onChange: (valor: any) => void;
    inputClass?: string;
    labelClass?: string;
}

const DEFAULT_INPUT =
    'w-full px-4 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-gray-900 dark:text-white';
const DEFAULT_LABEL = 'block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1';

/**
 * Renderer genérico do Motor de Renderização Contextual: recebe a definição do
 * campo vinda do View Schema (backend) e renderiza o input adequado.
 */
const SchemaField: React.FC<SchemaFieldProps> = ({ campo, value, onChange, inputClass, labelClass }) => {
    const [customValue, setCustomValue] = useState('');
    const ic = inputClass || DEFAULT_INPUT;
    const lc = labelClass || DEFAULT_LABEL;
    const label = campo.obrigatorio ? `${campo.label} *` : campo.label;

    const renderInput = () => {
        switch (campo.tipo) {
            case 'number':
                return (
                    <div className="relative">
                        <input
                            type="number"
                            step="any"
                            value={value ?? ''}
                            required={campo.obrigatorio}
                            onChange={e => onChange(e.target.value === '' ? null : parseFloat(e.target.value))}
                            className={`${ic} ${campo.unidade ? 'pr-14' : ''}`}
                            placeholder={campo.placeholder}
                        />
                        {campo.unidade && (
                            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400 uppercase pointer-events-none">
                                {campo.unidade}
                            </span>
                        )}
                    </div>
                );

            case 'boolean':
                return (
                    <label className="flex items-center gap-3 py-3 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={!!value}
                            onChange={e => onChange(e.target.checked)}
                            className="w-4 h-4 text-blue-600 rounded"
                        />
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{campo.label}</span>
                    </label>
                );

            case 'date':
                return (
                    <input
                        type="date"
                        value={value || ''}
                        required={campo.obrigatorio}
                        onChange={e => onChange(e.target.value || null)}
                        className={ic}
                    />
                );

            case 'select':
                return (
                    <>
                        <input
                            type="text"
                            list={`opts-${campo.chave}`}
                            value={value || ''}
                            required={campo.obrigatorio}
                            onChange={e => onChange(e.target.value)}
                            className={ic}
                            placeholder={campo.placeholder || 'Selecione...'}
                        />
                        <datalist id={`opts-${campo.chave}`}>
                            {(campo.opcoes || []).map(o => <option key={o} value={o} />)}
                        </datalist>
                    </>
                );

            case 'multiselect': {
                const selecionados: string[] = Array.isArray(value) ? value : [];
                const toggle = (opcao: string) => {
                    if (selecionados.includes(opcao)) onChange(selecionados.filter(s => s !== opcao));
                    else onChange([...selecionados, opcao]);
                };
                const addCustom = () => {
                    const v = customValue.trim();
                    if (v && !selecionados.includes(v)) onChange([...selecionados, v]);
                    setCustomValue('');
                };
                const extras = selecionados.filter(s => !(campo.opcoes || []).includes(s));
                return (
                    <div className="space-y-2">
                        <div className="flex flex-wrap gap-2">
                            {(campo.opcoes || []).map(opcao => {
                                const ativo = selecionados.includes(opcao);
                                return (
                                    <button
                                        key={opcao}
                                        type="button"
                                        onClick={() => toggle(opcao)}
                                        className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-all ${ativo
                                            ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                                            : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-blue-400'
                                            }`}
                                    >
                                        {opcao}
                                    </button>
                                );
                            })}
                            {extras.map(extra => (
                                <button
                                    key={extra}
                                    type="button"
                                    onClick={() => toggle(extra)}
                                    className="px-3 py-1.5 rounded-lg text-sm font-semibold border bg-indigo-600 text-white border-indigo-600 flex items-center gap-1"
                                >
                                    {extra} <X className="w-3 h-3" />
                                </button>
                            ))}
                        </div>
                        {campo.permite_custom && (
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={customValue}
                                    onChange={e => setCustomValue(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }}
                                    className={`${ic} py-2! text-sm`}
                                    placeholder="Adicionar outro..."
                                />
                                <button
                                    type="button"
                                    onClick={addCustom}
                                    className="px-3 bg-gray-100 dark:bg-gray-700 rounded-xl text-gray-600 dark:text-gray-300 hover:bg-gray-200"
                                >
                                    <Plus className="w-4 h-4" />
                                </button>
                            </div>
                        )}
                    </div>
                );
            }

            case 'textarea':
                return (
                    <textarea
                        value={value || ''}
                        rows={3}
                        required={campo.obrigatorio}
                        onChange={e => onChange(e.target.value)}
                        className={`${ic} resize-none`}
                        placeholder={campo.placeholder}
                    />
                );

            default: // text
                return (
                    <input
                        type="text"
                        value={value || ''}
                        required={campo.obrigatorio}
                        onChange={e => onChange(e.target.value)}
                        className={ic}
                        placeholder={campo.placeholder}
                    />
                );
        }
    };

    return (
        <div className={campo.tipo === 'multiselect' ? 'sm:col-span-2' : ''}>
            {campo.tipo !== 'boolean' && <label className={lc}>{label}</label>}
            {renderInput()}
            {campo.ajuda && <p className="text-xs text-gray-400 mt-1">{campo.ajuda}</p>}
        </div>
    );
};

export default SchemaField;
