import React from 'react';
import { Link } from 'react-router-dom';
import {
    Store, ShoppingCart, ShoppingBasket, Shirt, Footprints, Wrench, Flame, Pill, Hammer, Wine, Truck, ArrowRight,
    Smartphone, Flower2, ShoppingBag,
} from 'lucide-react';
import { NICHOS, rotaNicho } from './site';

const ICONES: Record<string, React.ElementType> = {
    store: Store, 'shopping-cart': ShoppingCart, 'shopping-basket': ShoppingBasket, shirt: Shirt,
    footprints: Footprints, wrench: Wrench, flame: Flame, pill: Pill, hammer: Hammer, wine: Wine, truck: Truck,
    smartphone: Smartphone, flower: Flower2, 'shopping-bag': ShoppingBag,
};

export const IconeNicho: React.FC<{ icone: string; className?: string }> = ({ icone, className }) => {
    const Icone = ICONES[icone] || Store;
    return <Icone className={className} />;
};

/** Cartões "escolha o seu tipo de comércio": cada um leva à página daquele nicho. */
const SegmentosGrid: React.FC<{ excluir?: string }> = ({ excluir }) => (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
        {NICHOS.filter(n => n.slug !== excluir).map(n => (
            <Link
                key={n.slug}
                to={rotaNicho(n.slug)}
                data-evento="segmento"
                data-rotulo={n.slug}
                className="group flex items-center gap-3 p-4 rounded-2xl bg-[#0A1220] border border-[#24344F] hover:border-[#2E9BFF] hover:bg-[#2E9BFF]/5 transition-all"
            >
                <span className="w-10 h-10 shrink-0 rounded-xl bg-[#101C31] border border-[#24344F] flex items-center justify-center group-hover:border-[#2E9BFF]/40">
                    <IconeNicho icone={n.icone} className="w-5 h-5 text-[#6FCBFF]" />
                </span>
                <span className="min-w-0 flex-1 font-bold text-white text-sm sm:text-base leading-tight">{n.nome}</span>
                <ArrowRight className="w-4 h-4 text-[#4F6A8F] group-hover:text-[#2E9BFF] shrink-0 hidden sm:block" />
            </Link>
        ))}
    </div>
);

export default SegmentosGrid;
