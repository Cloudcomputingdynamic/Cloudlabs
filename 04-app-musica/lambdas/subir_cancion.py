"""musica-subir-cancion (API de administración, POST /subir).

No recibe el archivo: la canción pesa más de lo que aceptan API Gateway (10 MB) y Lambda (6 MB). Revisa que quien
llama esté en el grupo "admin" de Cognito y le entrega un permiso de subida firmado (URL prefirmada de tipo POST)
para que el navegador suba la canción directo al bucket. La firma usa el rol de esta Lambda: por eso el rol
necesita s3:PutObject aunque la Lambda nunca toque el archivo.

Variables de entorno: BUCKET (musica-canciones-…).
"""
import json
import os
import re
import unicodedata
from urllib.parse import quote

import boto3
from botocore.config import Config

REGION = os.environ.get('AWS_REGION', 'us-east-1')
# Firma v4 y dirección virtual (https://BUCKET.s3.REGION.amazonaws.com/…) en la región del bucket
s3 = boto3.client('s3', region_name=REGION, config=Config(signature_version='s3v4', s3={'addressing_style': 'virtual'}))
MAXIMO = 20 * 1024 * 1024  # 20 MB por canción


def respuesta(codigo, cuerpo):
    return {'statusCode': codigo, 'headers': {'Content-Type': 'application/json'},
            'body': json.dumps(cuerpo, ensure_ascii=False)}


def es_admin(event):
    """Grupos del token de Cognito. En una HTTP API llegan como texto: "[admin]" o "[admin oyentes]"."""
    claims = event.get('requestContext', {}).get('authorizer', {}).get('jwt', {}).get('claims', {})
    grupos = str(claims.get('cognito:groups', '')).strip('[]').replace(',', ' ').split()
    return 'admin' in grupos


def slug(texto):
    """"Canción de la Región" -> "cancion-de-la-region" (la clave de S3 queda sin tildes ni espacios)."""
    texto = unicodedata.normalize('NFKD', texto).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]+', '-', texto.lower()).strip('-')


def lambda_handler(event, context):
    if not es_admin(event):
        return respuesta(403, {'error': 'Solo los administradores pueden subir canciones'})
    datos = json.loads(event.get('body') or '{}')
    artista, titulo = datos.get('artista', '').strip(), datos.get('titulo', '').strip()
    if not artista or not titulo or not slug(artista) or not slug(titulo):
        return respuesta(400, {'error': 'Faltan el artista o el título'})

    clave = f'canciones/{slug(artista)}/{slug(titulo)}.mp3'
    # Los metadatos de S3 solo aceptan ASCII: el artista y el título viajan codificados ("Canci%C3%B3n")
    campos = {'Content-Type': 'audio/mpeg',
              'x-amz-meta-artista': quote(artista),
              'x-amz-meta-titulo': quote(titulo)}
    condiciones = [{k: v} for k, v in campos.items()] + [['content-length-range', 1, MAXIMO]]
    subida = s3.generate_presigned_post(os.environ['BUCKET'], clave, Fields=campos, Conditions=condiciones,
                                        ExpiresIn=300)
    print(f'Permiso de subida para {clave} ({artista} - {titulo})')
    return respuesta(200, {'clave': clave, 'url': subida['url'], 'campos': subida['fields']})
