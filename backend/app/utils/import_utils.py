import pandas as pd
import io
import re
import zipfile
from werkzeug.datastructures import FileStorage

def normalize_header(header):
    """
    Normaliza o cabeçalho para snake_case e remove acentos/caracteres especiais.
    Ex: "Código de Barras" -> "codigo_de_barras"
    """
    import unicodedata
    
    # Remove acentos
    nfkd_form = unicodedata.normalize('NFKD', header)
    header_ascii = "".join([c for c in nfkd_form if not unicodedata.combining(c)])
    
    # Converte para minúsculas e substitui espaços/hifens por underscore
    header_clean = header_ascii.lower().strip()
    header_clean = re.sub(r'[\s\-]+', '_', header_clean)
    
    # Remove caracteres não alfanuméricos exceto underscore
    header_clean = re.sub(r'[^a-z0-9_]', '', header_clean)
    
    return header_clean

def read_import_file(file: FileStorage):
    """
    Lê um arquivo CSV ou Excel e retorna um DataFrame pandas.
    """
    filename = file.filename.lower()
    
    try:
        if filename.endswith('.csv'):
            # Tenta diferentes encodings
            try:
                df = pd.read_csv(file, encoding='utf-8', nrows=10001)
            except UnicodeDecodeError:
                file.seek(0)
                df = pd.read_csv(file, encoding='latin1', nrows=10001)
                
        elif filename.endswith(('.xls', '.xlsx')):
            if filename.endswith('.xlsx'):
                with zipfile.ZipFile(file) as archive:
                    entries = archive.infolist()
                    if len(entries) > 2000 or sum(entry.file_size for entry in entries) > 50 * 1024 * 1024:
                        raise ValueError('Planilha excede o limite de descompressão de 50MB')
                file.seek(0)
            df = pd.read_excel(file, nrows=10001)
        else:
            raise ValueError("Formato de arquivo não suportado. Use CSV ou Excel (.xlsx).")
            
        # Normaliza cabeçalhos
        if len(df) > 10000:
            raise ValueError('Importação limitada a 10.000 linhas por arquivo')
        df.columns = [normalize_header(col) for col in df.columns]
        
        # Remove linhas vazias
        df.dropna(how='all', inplace=True)
        
        # Converte NaN para None (null no JSON/Python)
        df = df.where(pd.notnull(df), None)
        
        return df.to_dict(orient='records')
        
    except Exception as e:
        raise ValueError(f"Erro ao ler arquivo: {str(e)}")
