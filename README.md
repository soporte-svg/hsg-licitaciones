# HSG · Cuadro comparativo de licitaciones

Dashboard web para **comparar propuestas de proveedores** a partir de carpetas en Google Drive. Extrae criterios y documentación de los Términos de Referencia (TR), analiza PDFs con IA, genera ranking, análisis por criterio y cuadro de documentación — y guarda cada ejecución en Supabase para consultarla después.

<p align="center">
  <strong>React · Hono · Supabase · Google Drive · Claude / OpenAI</strong>
</p>

---

## Tabla de contenidos

- [Características](#características)
- [Arquitectura](#arquitectura)
- [Estructura en Google Drive](#estructura-en-google-drive)
- [Flujo de uso](#flujo-de-uso)
- [Requisitos](#requisitos)
- [Instalación](#instalación)
- [Variables de entorno](#variables-de-entorno)
- [Base de datos](#base-de-datos)
- [Proveedor de IA](#proveedor-de-ia)
- [Caché de IA](#caché-de-ia)
- [API REST](#api-rest)
- [Estructura del repositorio](#estructura-del-repositorio)
- [Scripts](#scripts)
- [Despliegue](#despliegue)
- [Documentación adicional](#documentación-adicional)

---

## Características

| Área | Descripción |
|------|-------------|
| **Navegación Drive** | Explorador de carpetas y PDFs desde la raíz de convocatorias. |
| **Comparar** | Pipeline IA: TR → criterios + docs exigidos → extracción por proveedor → documentación → ranking → análisis extendido. |
| **Vistas del cuadro** | Resumen, análisis general por criterio, criterios y ofertas, financiero, documentación estándar. |
| **Historial** | Cada comparación persiste en `analisis`; historial por carpeta de servicio. |
| **Acceso rápido** | En el home, tarjetas **Ya analizadas** con salto directo al análisis y a la carpeta. |
| **Caché IA** | Reutiliza extracciones cuando TR, PDFs y archivos no cambian (menos tokens y tiempo). |
| **Auth** | Supabase Auth (email/contraseña); API protegida con JWT. |

---

## Arquitectura

```mermaid
flowchart TB
  subgraph browser [Navegador]
    UI[React + Vite :5173]
  end

  subgraph api [API Node]
    Hono[Hono :3100]
    IA[convocatorias-drive-ia]
    Drive[Google Drive API]
    Cache[analisis-ia-cache]
  end

  subgraph cloud [Servicios]
    SB[(Supabase Auth + Postgres)]
    Claude[Anthropic / OpenAI]
    GDrive[(Google Drive)]
  end

  UI -->|/api proxy| Hono
  UI -->|login| SB
  Hono --> Drive
  Hono --> IA
  Hono --> Cache
  Hono --> SB
  IA --> Claude
  Drive --> GDrive
```

| Capa | Tecnología | Puerto (local) |
|------|------------|----------------|
| Frontend | React 19, Vite 8, Tailwind CSS 4 | `5173` |
| Backend | Hono, Node 20+, TypeScript | `3100` |
| Datos | Supabase (Postgres + RLS) | — |
| Archivos | Google Drive (service account, solo lectura) | — |
| IA | Anthropic Claude u OpenAI (`LLM_PROVIDER`) | — |

En desarrollo, Vite hace **proxy** de `/api` al API (`vite.config.ts`, timeout 10 min para `comparar`).

---

## Estructura en Google Drive

Convención esperada por la aplicación:

```
GOOGLE_DRIVE_ROOT_FOLDER_ID/          ← Raíz (conjuntos / edificios)
└── [Conjunto]/
    └── [Servicio]/                   ← Carpeta donde se pulsa «Comparar»
        ├── Proveedor A/              ← Subcarpetas = oferentes
        │   └── *.pdf
        ├── Proveedor B/
        └── ...

GOOGLE_DRIVE_TERMINOS_FOLDER_ID/      ← Carpeta central de TR (compartida)
├── TR HSG (Aseo).docx
├── TR HSG (Vigilancia).pdf
└── ...
```

- El **TR** no va dentro de la carpeta del servicio: se resuelve en la carpeta central por **nombre del servicio** (p. ej. carpeta `ACQUA` → `TR HSG (ACQUA).docx`).
- Cada subcarpeta directa bajo la carpeta de servicio se trata como **un proveedor**.
- Formatos de TR: `.docx`, `.pdf` o Google Docs (exportados a DOCX).

---

## Flujo de uso

1. Iniciar sesión (usuario creado en Supabase Auth).
2. Navegar en el panel izquierdo hasta la **carpeta de servicio** (con subcarpetas de proveedores).
3. Verificar que aparece **TR vinculado** (API encuentra el documento en la carpeta central).
4. Pulsar **Comparar** (puede tardar varios minutos; ver logs `[api]` en terminal).
5. Revisar pestañas del cuadro comparativo en el panel principal.
6. Volver a **Drive** en migas de pan para abrir otra convocatoria desde **Ya analizadas**.

```mermaid
sequenceDiagram
  participant U as Usuario
  participant API as API
  participant D as Drive
  participant IA as Modelo IA
  participant DB as Supabase

  U->>API: POST /comparar { folder_id }
  API->>D: TR + PDFs proveedores
  API->>IA: Criterios, propuestas, docs, ranking, extendido
  API->>DB: INSERT analisis + UPDATE analisis_ia_cache
  API-->>U: Cuadro JSON + analisis_id
```

---

## Requisitos

- **Node.js** 20 o superior  
- Proyecto **Supabase** (Auth + Postgres)  
- **Service account** de Google Cloud con acceso de lectura a las carpetas de Drive  
- API key de **Anthropic** y/o **OpenAI** según `LLM_PROVIDER`  

---

## Instalación

```bash
git clone https://github.com/soporte-svg/hsg-licitaciones.git
cd hsg-licitaciones
npm install
cp .env.example .env
# Editar .env con tus credenciales
```

### 1. Credenciales Google

1. Crear service account en Google Cloud Console.  
2. Activar **Google Drive API**.  
3. Descargar JSON y guardarlo en `secrets/` (no se versiona).  
4. Compartir carpetas raíz y de términos con el `client_email` del JSON (lector).  

### 2. Supabase

1. Crear proyecto en [supabase.com](https://supabase.com).  
2. Ejecutar migraciones (ver [Base de datos](#base-de-datos)).  
3. En **Authentication → Users**, crear usuarios con email/contraseña.  
4. Copiar URL, `anon` key y `service_role` key al `.env`.  

### 3. Arranque en local

```bash
npm run dev
```

- API: http://localhost:3100/health  
- App: http://localhost:5173  

---

## Variables de entorno

Copia `.env.example` → `.env`. **No subas `.env` ni `secrets/` al repositorio.**

### Frontend (prefijo `VITE_`)

| Variable | Descripción |
|----------|-------------|
| `VITE_SUPABASE_URL` | URL del proyecto Supabase |
| `VITE_SUPABASE_ANON_KEY` | Clave anónima (login en el navegador) |
| `VITE_API_URL` | Vacío en local (usa proxy). En producción: URL pública del API |

### API y Supabase

| Variable | Descripción |
|----------|-------------|
| `SUPABASE_SERVICE_ROLE_KEY` | Solo servidor; escritura en `analisis` y caché |
| `LICITACIONES_API_PORT` | Puerto del API (default `3100`) |
| `LICITACIONES_WEB_ORIGIN` | Origen CORS del front (ej. `http://localhost:5173`) |

### Inteligencia artificial

| Variable | Descripción |
|----------|-------------|
| `LLM_PROVIDER` | `anthropic` (default) u `openai` |
| `ANTHROPIC_API_KEY` | Requerida si `LLM_PROVIDER=anthropic` |
| `ANTHROPIC_MODEL` | Default `claude-sonnet-4-6` |
| `OPENAI_API_KEY` | Requerida si `LLM_PROVIDER=openai` |
| `OPENAI_MODEL` | Default `gpt-4o` (recomendado con PDFs) |
| `OPENAI_BASE_URL` | Opcional (proxy / compatible OpenAI) |
| `LLM_TIMEOUT_MS` | Timeout en ms (default `300000`) |
| `LLM_MAX_TOKENS_ANALISIS_EXTENDIDO` | Salida máx. análisis extendido (default `16384`) |

### Google Drive

| Variable | Descripción |
|----------|-------------|
| `DRIVE_CREDENTIALS_JSON` | Ruta al JSON del service account |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | ID carpeta raíz de propuestas |
| `GOOGLE_DRIVE_TERMINOS_FOLDER_ID` | ID carpeta central de TR |

### Límites del comparador (opcional)

| Variable | Default | Descripción |
|----------|---------|-------------|
| `COMPARAR_MAX_PDFS_PER_PROVEEDOR` | `4` | PDFs enviados a IA por proveedor |
| `COMPARAR_MAX_PDF_BYTES` | `4194304` | Tamaño máximo por PDF (4 MB) |

---

## Base de datos

Migraciones en `supabase/migrations/` (ejecutar **en orden**):

| Archivo | Contenido |
|---------|-----------|
| `001_analisis.sql` | Tabla `analisis`, RLS por email |
| `002_analisis_documentacion.sql` | Columna `documentacion` (JSONB) |
| `003_analisis_extendido.sql` | Columna `analisis_extendido` (JSONB) |
| `004_analisis_ia_cache.sql` | Tabla `analisis_ia_cache` por `folder_id` |

**Opción A — SQL Editor** (Supabase Dashboard): pegar y ejecutar cada archivo.

**Opción B — CLI:**

```bash
cd licitaciones
supabase link --project-ref TU_PROJECT_REF
supabase db push
```

La tabla `analisis_ia_cache` solo la escribe el API con **service role** (no hay políticas RLS para clientes).

---

## Proveedor de IA

Una sola variable elige el backend:

```env
LLM_PROVIDER=anthropic   # o openai
```

Implementación en `server/lib/llm-provider.ts`. Los logs del API muestran `[ia/claude]` o `[ia/openai]`.

- **Anthropic**: PDFs como bloques `document` nativos.  
- **OpenAI**: PDFs como `file` en Chat Completions (`data:application/pdf;base64,...`).  

Mismo flujo de prompts en `server/lib/convocatorias-drive-ia.ts` para ambos proveedores.

---

## Caché de IA

Tabla `analisis_ia_cache` (clave: `folder_id` de la carpeta de **servicio**):

- Evita repetir extracción de TR, PDFs por proveedor y clasificación documental si no cambian archivos/huellas.  
- Cada **Comparar** sigue creando una fila nueva en `analisis` (historial completo).  
- La respuesta incluye `reutilizado_ia` (`terminos_tr`, `documentacion`, `proveedores`) para depuración.

---

## API REST

Base: `/api/convocatorias-drive`  
Autenticación: `Authorization: Bearer <access_token>` (sesión Supabase).

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/health` | Estado del API |
| `GET` | `/browse?parent_id=` | Carpetas y PDFs hijos |
| `GET` | `/terminos?folder_id=` | TR vinculado al servicio |
| `GET` | `/pdf?file_id=` | Stream PDF inline |
| `POST` | `/comparar` | Body: `{ "folder_id": "..." }` — pipeline completo |
| `GET` | `/analisis-recientes?limit=30` | Últimos análisis del usuario (home) |
| `GET` | `/analisis?folder_id=` | Historial por carpeta |
| `GET` | `/analisis/:id` | Detalle de un análisis |

Respuestas habituales: `{ "data": ..., "error": null }` o `{ "data": null, "error": { "code", "message" } }`.

Detalle de códigos de error y payloads: [docs/API.md](./docs/API.md).

---

## Estructura del repositorio

```
licitaciones/
├── public/                 # Assets estáticos (logo, favicon)
├── src/                      # Frontend React
│   ├── App.tsx               # UI principal (Drive + cuadro)
│   ├── api.ts                # Cliente HTTP
│   └── lib/supabase.ts       # Cliente Auth
├── server/
│   ├── index.ts              # Entrada Hono + CORS
│   ├── routes/
│   │   └── convocatorias-drive.ts
│   └── lib/
│       ├── drive.ts          # Google Drive
│       ├── convocatorias-drive-ia.ts
│       ├── llm-provider.ts   # Anthropic / OpenAI
│       ├── analisis-ia-cache.ts
│       └── json.ts           # Parseo JSON del modelo
├── supabase/migrations/      # Esquema Postgres
├── scripts/                  # Utilidades Drive (desarrollo)
├── docs/                     # Documentación extendida
├── .env.example
└── package.json
```

---

## Scripts

| Comando | Descripción |
|---------|-------------|
| `npm run dev` | API + Vite (espera `/health`) |
| `npm run dev:api` | Solo API con recarga |
| `npm run dev:web` | Solo Vite |
| `npm run build` | `tsc` + build de producción |
| `npm run preview` | Vista previa del build |
| `npm run lint` | ESLint |

---

## Despliegue

**Vercel solo sirve el frontend.** El API Node debe ir en Railway, Render u otro host. Si ves *«No se pudo conectar con el API»* tras el login, falta desplegar el API o configurar `VITE_API_URL`.

Guía paso a paso: **[docs/DESPLIEGUE.md](./docs/DESPLIEGUE.md)**

Resumen:

1. **API:** `npm run start:api` (lee `PORT` o `LICITACIONES_API_PORT`).  
2. **Vercel:** variables `VITE_SUPABASE_*` y **`VITE_API_URL=https://tu-api-publica`** → redeploy.  
3. **API:** `LICITACIONES_WEB_ORIGIN=https://tu-app.vercel.app` (varios orígenes separados por coma).  
4. **Timeout** del comparador: ≥ 600 s en el host del API.

---

## Documentación adicional

| Documento | Contenido |
|-----------|-----------|
| [docs/ARQUITECTURA.md](./docs/ARQUITECTURA.md) | Pipeline de comparación, módulos y decisiones técnicas |
| [docs/API.md](./docs/API.md) | Referencia de endpoints y errores |
| [docs/GUIA_DRIVE.md](./docs/GUIA_DRIVE.md) | Convenciones de carpetas y nombres de TR |
| [docs/DESPLIEGUE.md](./docs/DESPLIEGUE.md) | Vercel + API (Render/Railway), CORS y variables |

---

## Licencia y soporte

Proyecto privado **HSG**. Para incidencias o mejoras, usar el repositorio interno o contactar al equipo de desarrollo.
