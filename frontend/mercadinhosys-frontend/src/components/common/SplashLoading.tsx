import React from 'react';

export const SplashLoading: React.FC = () => {
    return (
        <div className="fixed inset-0 z-9999 flex flex-col items-center justify-center overflow-hidden font-sans"
             style={{ background: 'radial-gradient(120% 140% at 50% 0%, #1D4ED8 0%, #0F2E5C 55%, #0A1220 100%)' }}>
            
            <div className="relative w-full max-w-[640px] h-[360px] flex flex-col items-center justify-center gap-5">
                {/* Sparkles */}
                <div className="absolute top-[84px] left-[218px] w-[10px] h-[10px] bg-white rounded-sm animate-msys-twinkle" style={{ animationDelay: '0.5s' }} />
                <div className="absolute top-[130px] left-[190px] w-[7px] h-[7px] bg-white rounded-sm animate-msys-twinkle" style={{ animationDelay: '0.9s' }} />
                <div className="absolute top-[96px] right-[210px] w-[8px] h-[8px] bg-white rounded-sm animate-msys-twinkle" style={{ animationDelay: '1.2s' }} />

                <img 
                    src="/assets/logo.png" 
                    alt="MercadinhoSyS" 
                    className="w-[110px] h-[110px] rounded-3xl shadow-[0_16px_40px_rgba(0,0,0,0.4)] animate-msys-pop" 
                    onError={(e) => {
                        (e.target as HTMLImageElement).parentElement!.innerHTML = '<div class="w-[110px] h-[110px] rounded-3xl shadow-[0_16px_40px_rgba(0,0,0,0.4)] animate-msys-pop bg-[#0F2E5C] flex items-center justify-center text-white font-bold text-4xl">M</div>';
                    }}
                />

                <div className="font-['Archivo',sans-serif] font-extrabold text-3xl text-white tracking-[0.5px] animate-msys-rise" style={{ animationDelay: '0.45s' }}>
                    Mercadinho<span className="text-[#FF6A5C]">SyS</span>
                </div>

                <div className="text-sm text-white/75 animate-msys-rise" style={{ animationDelay: '0.8s' }}>
                    Sua loja inteira, num app só.
                </div>

                <div className="w-[180px] h-1 rounded-full bg-white/20 overflow-hidden mt-1 animate-msys-rise" style={{ animationDelay: '1.0s' }}>
                    <div className="h-full rounded-full bg-linear-to-r from-[#2E9BFF] to-[#6FCBFF] animate-msys-fill" style={{ animationDelay: '1.15s' }} />
                </div>
            </div>
        </div>
    );
};
