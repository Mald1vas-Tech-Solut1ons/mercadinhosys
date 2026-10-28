import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { Navigation, Shield } from 'lucide-react';
import { motion } from 'framer-motion';
import { apiClient } from '../../api/apiClient';

// Fix para os ícones padrão do leaflet não renderizarem no Webpack/Vite
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png',
    iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
});

// Ícone customizado de Moto
const MotoIcon = new L.Icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/198/198337.png', // Placeholder moto icon
    iconSize: [35, 35],
    iconAnchor: [17, 35],
    popupAnchor: [0, -35]
});

interface LiveTrackingProps {
    entrega?: any;
}

const RecenterMap = ({ center }: { center: [number, number] }) => {
    const map = useMap();
    useEffect(() => {
        map.flyTo(center, map.getZoom(), { animate: true, duration: 1.5 });
    }, [center, map]);
    return null;
};

const LiveTracking: React.FC<LiveTrackingProps> = ({ entrega: _entrega }) => {
    const [eventos, setEventos] = useState<any[]>([]);

    useEffect(() => {
        const fetchEventos = async () => {
            try {
                // Utilizando a apiClient para respeitar o ambiente (local/prod)
                const res = await apiClient.get('/logistica/eventos/recentes');
                const data = res.data;
                if (data.success && data.eventos) {
                    setEventos(data.eventos);
                }
            } catch (error) {
                console.error("Erro ao buscar GPS:", error);
            }
        };

        fetchEventos();
        const interval = setInterval(fetchEventos, 5000); // Polling a cada 5 segundos
        return () => clearInterval(interval);
    }, []);

    // Coordenada padrão (Guarulhos, SP - Próximo ao CEP da loja)
    const defaultCenter: [number, number] = [-23.4475, -46.5450];
    // Centralizar no último evento ou no default
    const centerPoint = eventos.length > 0 && eventos[0].latitude && eventos[0].longitude 
        ? [eventos[0].latitude, eventos[0].longitude] 
        : defaultCenter;

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl border border-gray-100 dark:border-gray-700 overflow-hidden flex flex-col h-[500px]"
        >
            <div className="p-6 pb-4 flex items-center justify-between z-10 bg-white dark:bg-gray-800 relative">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg">
                        <Navigation className="w-5 h-5 animate-pulse" />
                    </div>
                    <div>
                        <h4 className="font-bold text-gray-900 dark:text-white">Mapa de Rastreio (Real-Time)</h4>
                        <p className="text-[10px] text-blue-600 font-black uppercase tracking-widest">Sincronizado via GPS</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 px-3 py-1 bg-green-50 dark:bg-green-900/20 rounded-full">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-ping" />
                    <span className="text-[10px] font-bold text-green-600">LIVE</span>
                </div>
            </div>

            <div className="flex-1 w-full relative z-0">
                {/* 
                  Usamos o MapContainer do React-Leaflet
                  Ele não exige API Keys (Totalmente grátis via OpenStreetMap)
                */}
                <MapContainer 
                    center={centerPoint as [number, number]} 
                    zoom={16} 
                    style={{ height: '100%', width: '100%' }}
                    zoomControl={false}
                >
                    <RecenterMap center={centerPoint as [number, number]} />
                    <TileLayer
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        attribution='&copy; OpenStreetMap'
                    />
                    {eventos.map((ev, idx) => {
                        if (!ev.latitude || !ev.longitude) return null;
                        return (
                            <Marker 
                                key={idx} 
                                position={[ev.latitude, ev.longitude]}
                                icon={MotoIcon}
                            >
                                <Popup>
                                    <div className="text-center">
                                        <b className="text-gray-900 dark:text-gray-100">Entregador #{ev.funcionario_id}</b><br/>
                                        <span className="text-blue-600 font-bold uppercase text-[10px]">{ev.status}</span><br/>
                                        <span className="text-xs text-gray-500 dark:text-gray-400">
                                            Atualizado: {new Date(ev.timestamp).toLocaleTimeString()}
                                        </span>
                                    </div>
                                </Popup>
                            </Marker>
                        );
                    })}
                </MapContainer>
            </div>
            
            <div className="px-6 py-4 border-t border-gray-50 dark:border-gray-700 bg-white dark:bg-gray-800 z-10 flex justify-between items-center relative">
                <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-emerald-500" />
                    <span className="text-xs font-bold text-gray-500 uppercase dark:text-gray-400">
                        Motoristas Rastreáveis: {eventos.length}
                    </span>
                </div>
            </div>
        </motion.div>
    );
};

export default LiveTracking;
