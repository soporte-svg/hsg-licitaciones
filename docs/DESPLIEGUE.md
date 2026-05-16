# Despliegue en producción

## Opción A — Todo en Vercel (recomendado)

Un solo proyecto en [Vercel](https://vercel.com): el front (`dist/`) y el API (`api/index.ts` → Hono serverless) comparten el dominio, por ejemplo [https://hsg-licitaciones.vercel.app](https://hsg-licitaciones.vercel.app).

**No necesitas `VITE_API_URL`**: el navegador llama a `/api/...` en el mismo dominio.

### Variables en Vercel

| Variable | Obligatoria |
|----------|-------------|
| `VITE_SUPABASE_URL` | Sí |
| `VITE_SUPABASE_ANON_KEY` | Sí |
| `SUPABASE_SERVICE_ROLE_KEY` | Sí (serverless) |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Sí — **JSON completo** del service account (una línea). No uses ruta `secrets/` en Vercel |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | Sí |
| `GOOGLE_DRIVE_TERMINOS_FOLDER_ID` | Sí |
| `LLM_PROVIDER`, claves OpenAI/Anthropic | Sí |
| `LICITACIONES_WEB_ORIGIN` | Opcional (`https://hsg-licitaciones.vercel.app`); Vercel también añade `VERCEL_URL` al CORS |
| `VITE_API_URL` | **No** (déjala vacía o no la crees) |

### Comprobar

1. `https://hsg-licitaciones.vercel.app/health` → `{"status":"ok",...}` (si ves HTML 404 de Vercel, redeploy con `vercel.json` → `routes` y `api/index.ts`)
2. `https://hsg-licitaciones.vercel.app/api/health` → mismo JSON
3. Login y carpetas Drive en la app

### Límite de tiempo (importante)

**Comparar** puede tardar **5–15 minutos**. La función en `api/index.ts` pide `maxDuration: 300` (5 min). Eso requiere **plan Vercel Pro**. En Hobby el tope es ~10–60 s y Comparar puede cortarse.

Si Comparar falla por timeout en Vercel, usa la [Opción B](#opción-b--vercel--api-en-renderrailway) (API en Render con proceso largo).

### Redeploy

Tras cambiar variables, haz **Redeploy** en Vercel.

---

## Opción B — Vercel + API en Render/Railway

Front en Vercel y API Node aparte (más tiempo de ejecución para Comparar).

---

## Checklist (solo Opción B)

- [ ] API desplegado y `https://tu-api.../health` devuelve `{"status":"ok",...}`
- [ ] En **Vercel** → `VITE_API_URL=https://tu-api...` (sin `/` final) → **Redeploy**
- [ ] En el **API** → `LICITACIONES_WEB_ORIGIN=https://tu-app.vercel.app`

---

## 1. Desplegar el API en Render (Opción B)

1. Crea un **Web Service** conectado al repo `hsg-licitaciones`.
2. **Root directory:** `licitaciones` (si el repo es el monorepo padre, ajusta la ruta).
3. **Build command:** `npm install`
4. **Start command:** `npm run start:api`
5. **Plan:** el que permita timeouts largos para `POST /comparar`.

### Variables de entorno en Render (API)

Copia desde tu `.env` local, adaptando:

| Variable | Notas |
|----------|--------|
| `PORT` | Lo asigna Render automáticamente |
| `LICITACIONES_WEB_ORIGIN` | `https://tu-proyecto.vercel.app` |
| `SUPABASE_SERVICE_ROLE_KEY` | Igual que local |
| `VITE_SUPABASE_URL` | Opcional; `load-env` la reutiliza si falta `SUPABASE_URL` |
| `LLM_PROVIDER`, claves IA | Igual que local |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | Igual que local |
| `GOOGLE_DRIVE_TERMINOS_FOLDER_ID` | Igual que local |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | **Pega el JSON completo** del service account (una línea). En Render no subas `secrets/` |

Alternativa a JSON inline:

```env
DRIVE_CREDENTIALS_JSON=/etc/secrets/google.json
```

(solo si tu plataforma monta archivos secretos).

6. Anota la URL pública, ej. `https://hsg-licitaciones-api.onrender.com`.

7. Prueba en el navegador: `https://hsg-licitaciones-api.onrender.com/health`

---

## 2. Desplegar el frontend en Vercel

1. Importa el repo en [vercel.com](https://vercel.com).
2. **Framework:** Vite (detectado por `vercel.json`).
3. **Root directory:** `licitaciones` si aplica.

### Variables en Vercel (Environment Variables)

| Variable | Valor |
|----------|--------|
| `VITE_SUPABASE_URL` | URL Supabase |
| `VITE_SUPABASE_ANON_KEY` | Anon key |
| `VITE_API_URL` | URL del API del paso 1, **sin barra final** |

Ejemplo:

```env
VITE_API_URL=https://hsg-licitaciones-api.onrender.com
```

4. **Deploy**. Si cambias `VITE_API_URL`, haz **Redeploy** (no basta guardar la variable).

---

## 3. CORS

El API acepta varios orígenes si los separas por coma:

```env
LICITACIONES_WEB_ORIGIN=https://hsg-licitaciones.vercel.app,https://hsg-licitaciones-git-main.vercel.app
```

Incluye la URL de producción y, si usas previews, el dominio `*.vercel.app` de preview (añade la URL exacta que muestre Vercel en cada deploy de rama).

---

## 4. Errores frecuentes

### «No se pudo conectar con el API»

| Causa | Solución |
|-------|----------|
| Solo desplegaste Vercel | Despliega el API y configura `VITE_API_URL` |
| `VITE_API_URL` vacía en el build | Añádela en Vercel y **redeploy** |
| `VITE_API_URL` apunta a `localhost` | Usa la URL **pública** del API |
| API dormido (free tier Render) | Primera petición tarda ~1 min; espera o usa plan sin sleep |
| CORS | Añade tu dominio Vercel en `LICITACIONES_WEB_ORIGIN` |

### Login OK pero sin carpetas

Supabase funciona; el fallo es solo el API (Drive). Revisa `/health` y variables Google.

### Comparar corta a los 60 s

El proxy/plataforma del API tiene timeout bajo. Sube el límite a **600 s** o más en Render/Railway/nginx.

---

## 5. Supabase

- Auth: en Supabase → Authentication → URL Configuration, añade la URL de Vercel en **Site URL** / redirect URLs si usas magic links (email/password suele bastar con anon key).
- Migraciones: ejecutar `supabase/migrations/*.sql` en el proyecto de producción.

---

## Diagrama

```mermaid
flowchart LR
  User[Usuario]
  Vercel[Vercel - React]
  API[Render/Railway - API]
  SB[(Supabase)]
  Drive[(Google Drive)]

  User --> Vercel
  User --> SB
  Vercel -->|VITE_API_URL + JWT| API
  API --> SB
  API --> Drive
```
