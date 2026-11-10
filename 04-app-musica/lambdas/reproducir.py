"""musica-reproducir (API de usuarios, GET /reproducir?artista=…&titulo=…).

Busca la canción en el catálogo (GetItem con su clave completa) y devuelve una URL prefirmada para escucharla
durante 15 minutos. El navegador descarga el archivo directo desde S3: la Lambda solo entrega el enlace.
Rol: dynamodb:GetItem en la tabla y s3:GetObject en el bucket (la firma de la URL usa este rol).

Variables de entorno: TABLA (musica-catalogo), BUCKET (musica-canciones-…).
"""
import json
import os

import boto3
from botocore.config import Config

REGION = os.environ.get('AWS_REGION', 'us-east-1')
# Firma v4 y dirección virtual (https://BUCKET.s3.REGION.amazonaws.com/…) en la región del bucket
s3 = boto3.client('s3', region_name=REGION, config=Config(signature_version='s3v4', s3={'addressing_style': 'virtual'}))
tabla = boto3.resource('dynamodb').Table(os.environ['TABLA'])


def respuesta(codigo, cuerpo):
    return {'statusCode': codigo, 'headers': {'Content-Type': 'application/json'},
            'body': json.dumps(cuerpo, ensure_ascii=False)}


def lambda_handler(event, context):
    parametros = event.get('queryStringParameters') or {}
    artista, titulo = parametros.get('artista'), parametros.get('titulo')
    if not artista or not titulo:
        return respuesta(400, {'error': 'Faltan el artista o el título'})

    cancion = tabla.get_item(Key={'artista': artista, 'titulo': titulo}).get('Item')
    if not cancion:
        return respuesta(404, {'error': 'No está en el catálogo'})

    url = s3.generate_presigned_url('get_object', ExpiresIn=900,
                                    Params={'Bucket': os.environ['BUCKET'], 'Key': cancion['clave']})
    return respuesta(200, {'artista': artista, 'titulo': titulo, 'url': url, 'expira_en': 900})
