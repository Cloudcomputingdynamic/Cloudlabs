"""musica-listar-canciones (API de usuarios, GET /canciones).

Devuelve el catálogo completo. Es un Scan: lee toda la tabla. Con un catálogo pequeño está bien; con millones de
canciones se diseñaría una consulta por clave (Query).
Rol: dynamodb:Scan en la tabla.

Variables de entorno: TABLA (musica-catalogo).
"""
import json
import os

import boto3

tabla = boto3.resource('dynamodb').Table(os.environ['TABLA'])


def lambda_handler(event, context):
    canciones, inicio = [], {}
    while True:
        pagina = tabla.scan(ProjectionExpression='artista, titulo', **inicio)
        canciones += pagina['Items']
        if 'LastEvaluatedKey' not in pagina:
            break
        inicio = {'ExclusiveStartKey': pagina['LastEvaluatedKey']}
    canciones.sort(key=lambda c: (c['artista'].lower(), c['titulo'].lower()))
    return {'statusCode': 200, 'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({'canciones': canciones}, ensure_ascii=False)}
