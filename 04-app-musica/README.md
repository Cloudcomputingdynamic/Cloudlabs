# App de música serverless en AWS

Laboratorio del video **"App de música serverless en AWS"** del canal Cloud computing dynamic.

Una app de música con inicio de sesión: el administrador sube canciones y los oyentes las escuchan.

```
Navegador ── HTTPS ──> CloudFront ──> S3 (la página)
    ├── inicio de sesión ──> Cognito ──> token (con el grupo "admin" o sin grupo)
    ├── POST /subir ──> API de administración ──> Lambda subir-cancion ──> permiso firmado
    │        └── la canción va directo a S3 ──(evento)──> Lambda registrar-cancion ──> DynamoDB
    └── GET /listar y /reproducir ──> API de usuarios ──> Lambdas listar-canciones y reproducir ──> DynamoDB + S3
```

## Qué hay aquí

| Carpeta / archivo | Qué es |
|---|---|
| [`pasos.md`](pasos.md) | Los pasos en la consola, en orden, con lo que se anota y cómo borrarlo todo al final |
| `frontend/` | La página (HTML, CSS y JavaScript). Solo cambias `config.js` |
| `lambdas/` | El código de las 4 funciones (Python) |
| `politicas/` | La política de cada Lambda y el CORS del bucket de las canciones |
| `canciones/` | 3 canciones de prueba sintetizadas, libres de derechos |

Empieza por [`pasos.md`](pasos.md).

---

**English:** serverless music app lab (CloudFront + S3 + Cognito + API Gateway + Lambda + DynamoDB). The step-by-step
guide is in Spanish ([`pasos.md`](pasos.md)); the code and policies work as they are. Replace `TU-SUFIJO` (your
bucket suffix), `TU-ID-DE-CUENTA` (your AWS account ID) and the four values in `frontend/config.js`.
