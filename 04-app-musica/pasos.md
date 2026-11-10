# Pasos: app de música serverless en AWS

Vas a construir una app de música con inicio de sesión: un **administrador** sube canciones y los **oyentes** las
escuchan. Todo es serverless: no hay servidores que administrar.

**Antes de empezar**

- Trabaja todo en la región **us-east-1 (N. Virginia)**: elígela arriba a la derecha en la consola.
- Todos los nombres empiezan con `musica-`.
- Los nombres de los buckets son únicos en todo AWS, así que agrégales un sufijo tuyo (por ejemplo tus iniciales y un
  número: `musica-web-ab123`). En estos pasos aparece como **`TU-SUFIJO`**. Usa el mismo en los dos buckets.
- Ten a mano un bloc de notas: vas a anotar 6 datos (la "libreta").
- Costo: queda dentro de la capa gratuita o cuesta centavos, y nada cobra por hora. Igual, al terminar bórralo todo
  (al final están los pasos).

**Tu libreta** (completa a medida que avanzas)

| Dato | Dónde lo copias | Se usa en |
|---|---|---|
| Dirección de CloudFront (`https://dxxxx.cloudfront.net`) | Paso 3 | Pasos 4, 5, 9 y 10 |
| ID de tu cuenta (12 números) | Arriba a la derecha, en tu nombre | Paso 7 |
| User pool ID (`us-east-1_xxxxxxx`) | Paso 6 | Pasos 9 y 10 |
| Client ID | Paso 6 | Pasos 9, 10 y 11 |
| Domain de Cognito | Paso 6 | Paso 11 |
| Invoke URL de las dos API | Pasos 9 y 10 | Paso 11 |

---

## 1. La tabla (DynamoDB)

1. **DynamoDB** → Tables → **Create table**.
2. Table name: `musica-catalogo`. Partition key: `artista` (String). Sort key: `titulo` (String).
3. Deja **Default settings** y presiona **Create table**.

## 2. El bucket de la página (S3)

1. **S3** → **Create bucket** → nombre `musica-web-TU-SUFIJO`.
2. Deja todo como viene (el acceso público queda **bloqueado**: solo CloudFront podrá leerlo). **Create bucket**.

## 3. La dirección HTTPS de la página (CloudFront)

1. **CloudFront** → **Create distribution**. Si pide elegir un plan, elige el gratuito o "Pay as you go".
2. Origin: **Amazon S3** → elige `musica-web-TU-SUFIJO`.
3. Acceso al origen: **Allow private S3 bucket access to CloudFront** (la consola configura el permiso del bucket sola).
4. Viewer protocol policy: **Redirect HTTP to HTTPS**. No actives el WAF (tiene costo).
5. Crea la distribución. Tarda unos 5 minutos en desplegarse.
6. Entra a la distribución → **General → Settings → Edit** → Default root object: `index.html` → Save.
7. 📝 Anota el **Distribution domain name** con `https://` adelante: `https://dxxxx.cloudfront.net`.

## 4. El bucket de las canciones (S3)

1. **S3** → **Create bucket** → `musica-canciones-TU-SUFIJO`, todo por defecto. **Create bucket**.
2. Entra al bucket → **Permissions** → **Cross-origin resource sharing (CORS)** → Edit.
3. Pega `politicas/cors_bucket_canciones.json` cambiando `https://TU-DISTRIBUCION.cloudfront.net` por tu dirección
   de CloudFront (sin barra al final). Save.

## 5. El inicio de sesión (Cognito)

1. **Cognito** → **Create user pool** (o "Get started").
2. Application type: **Single-page application (SPA)**. Nombre: `musica-web`.
3. Sign-in identifiers: **Email**. Self-registration: **desactivado**.
4. Return URL: tu dirección de CloudFront **con la barra final**: `https://dxxxx.cloudfront.net/`. Create.

## 6. Los datos de Cognito

En tu user pool, copia con el **botón de copiar** (el ID distingue mayúsculas):

1. 📝 **User pool ID** (en la página principal del user pool).
2. 📝 **Client ID**: App clients → `musica-web`.
3. 📝 **Domain**: Branding → Domain.
4. App clients → `musica-web` → **Login pages** → Edit:
   - Allowed sign-out URLs: `https://dxxxx.cloudfront.net/` (con la barra final).
   - OpenID Connect scopes: deja solo **openid** y **email**. Save.
5. **Groups** → Create group → nombre `admin`.
6. **Users** → Create user, dos veces. Marca **Don't send an invitation** y **Mark email address as verified**, y
   ponle una contraseña:
   - `admin@ejemplo.com` → después, dentro del usuario, **Add user to group** → `admin`.
   - `oyente@ejemplo.com` → sin grupo.

Así quedan dos tipos de usuario: el administrador, que puede subir canciones, y los oyentes, que solo las escuchan.

## 7. Las cuatro Lambdas

Repite esto para cada fila de la tabla:

1. **Lambda** → **Create function** → Author from scratch → nombre de la tabla → Runtime **Python** (el más nuevo de
   la lista) → **Create function**.
2. Borra el código de ejemplo de `lambda_function.py`, pega el del archivo y presiona **Deploy**.
3. **Configuration → Environment variables** → Edit → agrega las variables de la tabla.
4. **Configuration → Permissions** → clic en el nombre del rol → **Add permissions → Create inline policy** → JSON →
   pega la política. **Cambia `TU-SUFIJO` y `TU-ID-DE-CUENTA` en todas las líneas** → ponle un nombre → Create.

| Nombre de la función | Código | Variables de entorno | Política |
|---|---|---|---|
| `musica-subir-cancion` | `lambdas/subir_cancion.py` | `BUCKET` = `musica-canciones-TU-SUFIJO` | `politicas/subir_cancion.json` |
| `musica-registrar-cancion` | `lambdas/registrar_cancion.py` | `TABLA` = `musica-catalogo` | `politicas/registrar_cancion.json` |
| `musica-listar-canciones` | `lambdas/listar_canciones.py` | `TABLA` = `musica-catalogo` | `politicas/listar_canciones.json` |
| `musica-reproducir` | `lambdas/reproducir.py` | `TABLA` = `musica-catalogo` y `BUCKET` = `musica-canciones-TU-SUFIJO` | `politicas/reproducir.json` |

Cada Lambda tiene su propio rol con solo lo que necesita.

## 8. El evento: S3 avisa cuando llega una canción

1. **S3** → `musica-canciones-TU-SUFIJO` → **Properties** → **Event notifications** → **Create event notification**.
2. Nombre `nueva-cancion` · Prefix `canciones/` · Suffix `.mp3`.
3. Event types: **All object create events**.
4. Destination: Lambda function → `musica-registrar-cancion`. Save.

## 9. La API de administración (API Gateway)

1. **API Gateway** → Create API → **HTTP API** → Build.
2. Integration: Lambda → `musica-subir-cancion`. API name: `musica-api-admin` → Next.
3. Route: método **POST**, ruta **`/subir`** → Next → Next → **Create**.
4. **Authorization** → elige `POST /subir` → Create and attach an authorizer → **JWT**:
   - Nombre `cognito-admin`.
   - Issuer URL: `https://cognito-idp.us-east-1.amazonaws.com/` + tu **User pool ID**.
   - Audience: tu **Client ID**. Create and attach.
5. **CORS** → Configure:
   - Access-Control-Allow-Origin: tu dirección de CloudFront (sin barra al final) → **Add**.
   - Access-Control-Allow-Headers: `authorization` y `content-type` (cada uno con **Add**).
   - Access-Control-Allow-Methods: `POST`. **Save**.
6. 📝 **Stages** → copia la **Invoke URL**.

## 10. La API de usuarios (API Gateway)

1. Create API → **HTTP API** → Build. Dos integraciones: `musica-listar-canciones` y `musica-reproducir`.
   API name: `musica-api-usuarios` → Next.
2. Routes: **GET `/listar`** → musica-listar-canciones y **GET `/reproducir`** → musica-reproducir → Next → Next →
   **Create**.
3. **Authorization**: crea un autorizador JWT `cognito-usuarios` (mismo Issuer URL y Audience que en el paso 9) en
   `/listar`, y en `/reproducir` adjunta ese mismo autorizador.
4. **CORS**: origin = tu dirección de CloudFront · headers `authorization` · methods `GET`. Save.
5. 📝 **Stages** → copia la **Invoke URL**.

## 11. Subir la página

1. Abre `frontend/config.js` y reemplaza los 4 valores con los de tu libreta (sin barra al final).
2. **S3** → `musica-web-TU-SUFIJO` → **Upload** → **Add files** (no "Add folder") → los 6 archivos de `frontend/`:
   `index.html`, `app.js`, `estilos.css`, `config.js`, `dj.png` y `dj_icono.png` → Upload.

## 12. ¡A probar!

1. Abre tu dirección de CloudFront en el navegador.
2. Inicia sesión como `admin@ejemplo.com` (te pide una contraseña nueva). Verás la insignia **admin** y el panel
   **Subir una canción**.
3. Sube las canciones de la carpeta `canciones/` con su artista y título (por ejemplo "Los Nimbos" · "Cielo
   despejado"). Aparecen en el catálogo y puedes escucharlas.
4. Cierra sesión y entra como `oyente@ejemplo.com`: puede escuchar, pero si intenta subir una canción la API
   responde **403: solo los administradores pueden subir canciones**.

---

## Si algo no funciona

| Lo que ves | Qué revisar |
|---|---|
| AccessDenied al abrir la página | Paso 3.6: Default root object = `index.html`. |
| "Invalid request" al cerrar sesión | Paso 6.4: la sign-out URL, con la barra final. |
| El navegador bloquea las llamadas (CORS) | Pasos 9.5 y 10.4: el origin exacto, terminado en `.net`, sin barra ni punto final. |
| No se puede subir la canción | Paso 4: el CORS del bucket de las canciones. |
| 401 en las llamadas a la API | Issuer URL y Client ID (copiados con el botón, respetando mayúsculas). |
| La canción se sube pero no aparece en el catálogo | Paso 8 (el evento) y, en el paso 7, `TU-SUFIJO` en la política de `musica-registrar-cancion`. Después súbela de nuevo. |
| La Lambda responde "Hello from Lambda!" | Te faltó **Deploy** en el paso 7.2. |
| Cambiaste un archivo de la página y no se ve el cambio | CloudFront → Invalidations → Create → `/*`. |

## Borrar todo (en este orden)

1. **CloudFront**: Disable la distribución → espera a que termine → Delete.
2. **S3**: Empty y después Delete en los dos buckets.
3. **API Gateway**: borra `musica-api-admin` y `musica-api-usuarios`.
4. **Lambda**: borra las 4 funciones. En **CloudWatch → Log groups**, borra los `/aws/lambda/musica-…`.
5. **IAM → Roles**: borra los 4 roles `musica-…`.
6. **DynamoDB**: borra `musica-catalogo`.
7. **Cognito**: borra el user pool (si la consola lo pide, primero quita el dominio y desactiva la protección contra
   borrado).
8. Al día siguiente, revisa **Billing** para confirmar que no queda nada cobrando.
