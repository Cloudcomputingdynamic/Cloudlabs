"""musica-registrar-cancion (la invoca S3 cuando se crea un objeto en canciones/*.mp3).

Lee los metadatos de la canción (artista y título) y escribe un elemento en la tabla del catálogo.
Rol: s3:GetObject en el bucket (head_object lo necesita) y dynamodb:PutItem en la tabla.

Variables de entorno: TABLA (musica-catalogo).
"""
import os
from datetime import datetime, timezone
from urllib.parse import unquote, unquote_plus

import boto3

s3 = boto3.client('s3')
tabla = boto3.resource('dynamodb').Table(os.environ['TABLA'])


def lambda_handler(event, context):
    for registro in event['Records']:
        bucket = registro['s3']['bucket']['name']
        clave = unquote_plus(registro['s3']['object']['key'])  # en el evento la clave viene codificada
        cabecera = s3.head_object(Bucket=bucket, Key=clave)
        meta = cabecera['Metadata']
        elemento = {
            'artista': unquote(meta['artista']),
            'titulo': unquote(meta['titulo']),
            'clave': clave,
            'bytes': cabecera['ContentLength'],
            'subida': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        }
        tabla.put_item(Item=elemento)
        print(f'Registrada: {elemento["artista"]} - {elemento["titulo"]} ({clave})')
    return {'registradas': len(event['Records'])}
