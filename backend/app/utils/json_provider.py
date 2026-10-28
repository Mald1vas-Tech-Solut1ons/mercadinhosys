
from flask.json.provider import DefaultJSONProvider
from decimal import Decimal
from datetime import date, datetime

class CustomJSONProvider(DefaultJSONProvider):
    """
    JSON Provider customizado para lidar com tipos do SQLAlchemy/Python
    que não são serializáveis por padrão (Decimal, date, datetime).
    """
    def default(self, obj):
        if isinstance(obj, Decimal):
            return float(obj)
        if isinstance(obj, (datetime, date)):
            from app.utils.timezone import iso_utc
            return iso_utc(obj)  # data com hora sem fuso = UTC; marcada para o navegador converter
        return super().default(obj)
