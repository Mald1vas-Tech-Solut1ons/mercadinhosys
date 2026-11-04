import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

/** Trilha de navegação visível (a mesma hierarquia vai nos dados estruturados BreadcrumbList). */
const Trilha: React.FC<{ itens: { nome: string; para?: string }[] }> = ({ itens }) => (
    <nav aria-label="Você está em" className="mb-6">
        <ol className="flex flex-wrap items-center gap-1 text-sm text-[#8FA3C0]">
            {itens.map((item, i) => (
                <li key={item.nome} className="flex items-center gap-1">
                    {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-[#4F6A8F]" />}
                    {item.para
                        ? <Link to={item.para} className="hover:text-white">{item.nome}</Link>
                        : <span aria-current="page" className="text-[#DCE8F7] font-semibold">{item.nome}</span>}
                </li>
            ))}
        </ol>
    </nav>
);

export default Trilha;
