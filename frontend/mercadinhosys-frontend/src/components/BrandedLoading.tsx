import React from 'react';
import { motion } from 'framer-motion';

interface BrandedLoadingProps {
    message?: string;
    fullScreen?: boolean;
}

const BrandedLoading: React.FC<BrandedLoadingProps> = ({ message = 'Carregando inteligência...', fullScreen = false }) => {
    const containerClasses = fullScreen 
        ? "fixed inset-0 z-9999 bg-slate-950 flex flex-col items-center justify-center"
        : "w-full h-full min-h-[400px] flex flex-col items-center justify-center bg-slate-950 rounded-2xl";

    return (
        <div className={containerClasses}>
            <motion.div
                initial={{ opacity: 0.5, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{
                    duration: 1.5,
                    repeat: Infinity,
                    repeatType: "reverse",
                    ease: "easeInOut"
                }}
                className="w-48 h-auto mb-8 drop-shadow-[0_0_20px_rgba(37,99,235,0.4)]"
            >
                {/* Logo da pasta public */}
                <img src="/logo_alternativa.png" alt="MercadinhoSys Logo" className="w-full object-contain" />
            </motion.div>

            <div className="flex flex-col items-center gap-4">
                {/* Barra de progresso animada */}
                <div className="w-64 h-1.5 bg-white dark:bg-slate-800 rounded-full overflow-hidden relative">
                    <motion.div 
                        className="absolute top-0 left-0 h-full bg-blue-500 rounded-full"
                        initial={{ width: "0%", left: "0%" }}
                        animate={{ 
                            width: ["0%", "40%", "100%", "100%"],
                            left: ["0%", "0%", "60%", "100%"]
                        }}
                        transition={{
                            duration: 2,
                            repeat: Infinity,
                            ease: "easeInOut"
                        }}
                    />
                </div>
                
                <motion.p 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-gray-500 dark:text-slate-400 font-medium tracking-widest uppercase text-xs"
                >
                    {message}
                </motion.p>
            </div>
        </div>
    );
};

export default BrandedLoading;
