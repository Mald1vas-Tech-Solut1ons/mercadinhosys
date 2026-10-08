import React, { useState, useRef } from 'react';
import { Upload, X, CheckCircle, AlertCircle, FileSpreadsheet, Loader } from 'lucide-react';
import { apiClient } from '../../api/apiClient';

interface ImportDataModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    title: string;
    endpoint: string;
    templateUrl?: string; // URL para baixar modelo (futuro)
}

export default function ImportDataModal({ isOpen, onClose, onSuccess, title, endpoint }: ImportDataModalProps) {
    const [file, setFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<any | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    if (!isOpen) return null;

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
            setError(null);
            setResult(null);
        }
    };

    const handleUpload = async () => {
        if (!file) return;

        setUploading(true);
        setError(null);

        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await apiClient.post(endpoint, formData, {
                headers: {
                    'Content-Type': 'multipart/form-data',
                },
            });

            setResult(response.data);
            if (response.data.success) {
                setFile(null);
                setTimeout(() => {
                    onSuccess();
                }, 3000);
            }
        } catch (err: any) {
            console.error('Erro no upload:', err);
            setError(err.response?.data?.message || 'Erro ao importar dados. Verifique o arquivo e tente novamente.');
        } finally {
            setUploading(false);
        }
    };

    const handleClose = () => {
        setFile(null);
        setError(null);
        setResult(null);
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-100 p-4 overflow-y-auto" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))', paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}>
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden my-auto">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b">
                    <h3 className="text-lg font-bold text-gray-900">{title}</h3>
                    <button onClick={handleClose} className="text-gray-500 hover:text-gray-700">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6">
                    {!result ? (
                        <div className="space-y-4">
                            <div
                                className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${file ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
                                    }`}
                                onClick={() => fileInputRef.current?.click()}
                            >
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    onChange={handleFileChange}
                                    className="hidden"
                                    accept=".csv,.xlsx,.xls"
                                />

                                {file ? (
                                    <div className="flex flex-col items-center">
                                        <FileSpreadsheet className="w-12 h-12 text-blue-500 mb-2" />
                                        <p className="font-medium text-gray-900">{file.name}</p>
                                        <p className="text-sm text-gray-500">{(file.size / 1024).toFixed(1)} KB</p>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center">
                                        <Upload className="w-12 h-12 text-gray-400 mb-2" />
                                        <p className="font-medium text-gray-700">Clique para selecionar</p>
                                        <p className="text-sm text-gray-500">Suporta CSV e Excel (.xlsx)</p>
                                    </div>
                                )}
                            </div>

                            {error && (
                                <div className="flex items-start gap-2 bg-red-50 text-red-700 p-3 rounded-lg text-sm">
                                    <AlertCircle className="w-5 h-5 shrink-0" />
                                    <p>{error}</p>
                                </div>
                            )}

                            <button
                                onClick={handleUpload}
                                disabled={!file || uploading}
                                className="w-full py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                {uploading ? (
                                    <>
                                        <Loader className="w-4 h-4 animate-spin" />
                                        Importando...
                                    </>
                                ) : (
                                    'Importar Dados'
                                )}
                            </button>
                        </div>
                    ) : (
                        <div className="text-center space-y-4">
                            {result.success ? (
                                <>
                                    <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                                        <CheckCircle className="w-8 h-8 text-green-600" />
                                    </div>
                                    <h4 className="text-xl font-bold text-gray-900">Importação Concluída!</h4>
                                    <div className="bg-gray-50 rounded-lg p-4 text-left text-sm space-y-2">
                                        <div className="flex justify-between">
                                            <span className="text-gray-600">Criados:</span>
                                            <span className="font-bold text-green-600">{result.detalhes?.criados || 0}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-600">Atualizados:</span>
                                            <span className="font-bold text-blue-600">{result.detalhes?.atualizados || 0}</span>
                                        </div>
                                        {result.detalhes?.erros && result.detalhes.erros.length > 0 && (
                                            <div className="mt-4 border-t pt-2">
                                                <span className="font-bold text-red-600 block mb-1">Erros ({result.detalhes.erros.length}):</span>
                                                <ul className="list-disc pl-4 space-y-1 text-red-500 max-h-32 overflow-y-auto">
                                                    {result.detalhes.erros.map((e: string, i: number) => (
                                                        <li key={i}>{e}</li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}
                                    </div>
                                    <button
                                        onClick={onSuccess}
                                        className="w-full py-2 px-4 bg-gray-900 text-white rounded-lg hover:bg-gray-800"
                                    >
                                        Fechar
                                    </button>
                                </>
                            ) : (
                                // Fallback para erro retornado com success: false mas sem throw
                                <div className="space-y-4">
                                    <div className="flex items-center gap-2 text-red-600 justify-center">
                                        <AlertCircle className="w-8 h-8" />
                                        <span className="font-bold">Falha na importação</span>
                                    </div>
                                    <p className="text-gray-600">{result.message}</p>
                                    <button
                                        onClick={() => setResult(null)}
                                        className="text-blue-600 hover:underline"
                                    >
                                        Tentar novamente
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
