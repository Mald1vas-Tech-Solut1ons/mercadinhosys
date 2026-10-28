import React, { useState, useEffect } from 'react';
import { Cloud, Database, Upload, RefreshCw, HardDrive, Wifi, WifiOff } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { showToast } from '../elements/Toast';

interface SyncStatus {
    local_db: {
        status: string;
        tables?: number;
        table_names?: string[];
        error?: string;
    };
    cloud_db: {
        status: string;
        tables?: number;
        error?: string;
    };
    last_sync?: string;
    available_backups: string[];
}

interface SyncResult {
    success: boolean;
    message: string;
    data?: {
        exported_tables: number;
        imported_tables: number;
        total_rows: number;
        backup?: any;
        timestamp: string;
        estabelecimento_id: number;
    };
}

const SyncManager: React.FC = () => {
    const { user } = useAuth();
    const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
    const [isSyncing, setIsSyncing] = useState(false);
    const [selectedBackup, setSelectedBackup] = useState<string>('google_drive');

    useEffect(() => {
        loadSyncStatus();
        // Auto-refresh a cada 30 segundos
        const interval = setInterval(loadSyncStatus, 30000);
        return () => clearInterval(interval);
    }, []);

    const loadSyncStatus = async () => {
        try {
            const response = await fetch('/api/sync-hybrid/status', {
                headers: {
                    'Authorization': `Bearer ${sessionStorage.getItem('token')}`
                }
            });
            const result = await response.json();
            if (result.success) {
                setSyncStatus(result.data);
            }
        } catch (error) {
            console.error('Erro ao carregar status:', error);
        }
    };

    const handleSyncUpload = async (backupProvider?: string) => {
        setIsSyncing(true);
        try {
            const response = await fetch('/api/sync-hybrid/upload', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${sessionStorage.getItem('token')}`
                },
                body: JSON.stringify({
                    backup_provider: backupProvider
                })
            });

            const result: SyncResult = await response.json();

            if (result.success) {
                showToast.success(`✅ ${result.message}`);
                showToast.info(`📊 ${result.data?.exported_tables} tabelas exportadas, ${result.data?.total_rows} linhas sincronizadas`);

                if (result.data?.backup?.success) {
                    showToast.success(`💾 Backup ${result.data.backup.provider} criado!`);
                }

                await loadSyncStatus();
            } else {
                showToast.error(`❌ Erro na sincronização: ${result.message}`);
            }
        } catch (error) {
            console.error('Erro na sincronização:', error);
            showToast.error('❌ Erro ao sincronizar dados');
        } finally {
            setIsSyncing(false);
        }
    };

    const handleBackup = async () => {
        setIsSyncing(true);
        try {
            const response = await fetch('/api/sync-hybrid/backup', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${sessionStorage.getItem('token')}`
                },
                body: JSON.stringify({
                    provider: selectedBackup
                })
            });

            const result = await response.json();

            if (result.success) {
                showToast.success(`💾 Backup ${result.data.provider} criado com sucesso!`);
                showToast.info(`📁 Arquivo: ${result.data.filename} (${result.data.file_size} bytes)`);
            } else {
                showToast.error(`❌ Erro no backup: ${result.message}`);
            }
        } catch (error) {
            console.error('Erro no backup:', error);
            showToast.error('❌ Erro ao criar backup');
        } finally {
            setIsSyncing(false);
        }
    };

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'online':
                return <Wifi className="w-4 h-4 text-green-500" />;
            case 'error':
                return <WifiOff className="w-4 h-4 text-red-500" />;
            default:
                return <RefreshCw className="w-4 h-4 text-yellow-500" />;
        }
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'online':
                return 'text-green-600 bg-green-50';
            case 'error':
                return 'text-red-600 bg-red-50';
            default:
                return 'text-yellow-600 bg-yellow-50';
        }
    };

    if (!syncStatus) {
        return (
            <div className="flex items-center justify-center p-8">
                <RefreshCw className="w-6 h-6 animate-spin" />
                <span className="ml-2">Carregando status...</span>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                        <Database className="w-5 h-5" />
                        Gerenciamento de Sincronização
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        SQLite local ↔ PostgreSQL nuvem + Backup na nuvem
                    </p>
                </div>
                <button
                    onClick={loadSyncStatus}
                    className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                    title="Atualizar status"
                >
                    <RefreshCw className="w-4 h-4" />
                </button>
            </div>

            {/* Status Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Banco Local */}
                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <HardDrive className="w-5 h-5 text-blue-500" />
                            <h4 className="font-medium text-gray-900 dark:text-white">Banco Local</h4>
                        </div>
                        {getStatusIcon(syncStatus.local_db.status)}
                    </div>

                    <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(syncStatus.local_db.status)}`}>
                        {syncStatus.local_db.status}
                    </div>

                    {syncStatus.local_db.tables && (
                        <div className="mt-3 space-y-1">
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                {syncStatus.local_db.tables} tabelas
                            </p>
                            <div className="flex flex-wrap gap-1">
                                {syncStatus.local_db.table_names?.slice(0, 3).map((table, idx) => (
                                    <span key={idx} className="text-xs bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">
                                        {table}
                                    </span>
                                ))}
                                {syncStatus.local_db.table_names && syncStatus.local_db.table_names.length > 3 && (
                                    <span className="text-xs text-gray-500 dark:text-gray-400">+{syncStatus.local_db.table_names.length - 3}</span>
                                )}
                            </div>
                        </div>
                    )}

                    {syncStatus.local_db.error && (
                        <p className="mt-2 text-xs text-red-600">{syncStatus.local_db.error}</p>
                    )}
                </div>

                {/* Banco Nuvem */}
                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <Cloud className="w-5 h-5 text-purple-500" />
                            <h4 className="font-medium text-gray-900 dark:text-white">Banco Nuvem</h4>
                        </div>
                        {getStatusIcon(syncStatus.cloud_db.status)}
                    </div>

                    <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(syncStatus.cloud_db.status)}`}>
                        {syncStatus.cloud_db.status}
                    </div>

                    {syncStatus.cloud_db.tables && (
                        <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
                            {syncStatus.cloud_db.tables} tabelas sincronizadas
                        </p>
                    )}

                    {syncStatus.cloud_db.error && (
                        <p className="mt-2 text-xs text-red-600">{syncStatus.cloud_db.error}</p>
                    )}
                </div>
            </div>

            {/* Ações */}
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
                <h4 className="font-medium text-gray-900 dark:text-white mb-4">Ações de Sincronização</h4>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Upload para Nuvem */}
                    <div className="space-y-3">
                        <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
                            <Upload className="w-4 h-4" />
                            Enviar para Nuvem
                        </h5>
                        <p className="text-xs text-gray-600 dark:text-gray-400">
                            Sincroniza dados do SQLite local para PostgreSQL na nuvem
                        </p>
                        <div className="flex gap-2">
                            <button
                                onClick={() => handleSyncUpload()}
                                disabled={isSyncing || syncStatus.local_db.status !== 'online' || syncStatus.cloud_db.status !== 'online'}
                                className="flex-1 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm flex items-center justify-center gap-2"
                            >
                                {isSyncing ? (
                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                ) : (
                                    <Cloud className="w-4 h-4" />
                                )}
                                Sincronizar
                            </button>

                            <select
                                value={selectedBackup}
                                onChange={(e) => setSelectedBackup(e.target.value)}
                                className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700"
                                title="Provider de backup adicional"
                            >
                                <option value="">Sem backup</option>
                                <option value="google_drive">Google Drive</option>
                                <option value="onedrive">OneDrive</option>
                            </select>
                        </div>
                    </div>

                    {/* Backup Adicional */}
                    <div className="space-y-3">
                        <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
                            <Database className="w-4 h-4" />
                            Backup Adicional
                        </h5>
                        <p className="text-xs text-gray-600 dark:text-gray-400">
                            Cria backup adicional em serviço de armazenamento na nuvem
                        </p>
                        <button
                            onClick={handleBackup}
                            disabled={isSyncing}
                            className="w-full px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm flex items-center justify-center gap-2"
                        >
                            {isSyncing ? (
                                <RefreshCw className="w-4 h-4 animate-spin" />
                            ) : (
                                <HardDrive className="w-4 h-4" />
                            )}
                            Backup {selectedBackup === 'google_drive' ? 'Drive' : selectedBackup === 'onedrive' ? 'OneDrive' : ''}
                        </button>
                    </div>
                </div>

                {/* Informações */}
                {syncStatus.last_sync && (
                    <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                        <p className="text-xs text-gray-600 dark:text-gray-400">
                            Última sincronização: {new Date(syncStatus.last_sync).toLocaleString('pt-BR')}
                        </p>
                    </div>
                )}
            </div>

            {/* Informações do Usuário */}
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <div className="flex items-start gap-3">
                    <div className="text-blue-600 dark:text-blue-400 mt-0.5">
                        <Cloud className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                        <h5 className="text-sm font-medium text-blue-900 dark:text-blue-100">Modo Híbrido Ativado</h5>
                        <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                            Seu sistema usa SQLite local para máxima velocidade no dia a dia.
                            Use o botão "Sincronizar" para enviar seus dados para a nuvem (PostgreSQL/Aiven)
                            e criar backups seguros no Google Drive ou OneDrive.
                        </p>
                        <p className="text-xs text-blue-700 dark:text-blue-300 mt-2">
                            <strong>Estabelecimento:</strong> {user?.estabelecimento_id} - {user?.nome}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SyncManager;
