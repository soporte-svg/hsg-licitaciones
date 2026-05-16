# Licitaciones

Proyecto **independiente**: front (Vite + React), API (Hono en `server/`) y configuración propia. No depende de otros repos ni de otros APIs.

## Arquitectura local

| Componente | Ubicación | Puerto |
|------------|-----------|--------|
| Front | `src/` (Vite) | 5173 |
| API | `server/` | 3100 (`LICITACIONES_API_PORT`) |

El front llama a `/api/...` y Vite reenvía al API de este mismo proyecto (`vite.config.ts`).

## Requisitos

- Node 20+
- Proyecto [Supabase](https://supabase.com) (Auth + Postgres)
- Cuenta de servicio Google Drive (JSON en `secrets/`)
- API key de **Anthropic** o **OpenAI** (según `LLM_PROVIDER`)

## Base de datos

Migraciones en `supabase/migrations/` (`001_analisis.sql`, `002_analisis_documentacion.sql`, `003_analisis_extendido.sql`).

**Opción A — SQL Editor** en el dashboard de Supabase: pega y ejecuta el contenido del archivo.

**Opción B — CLI** (con [Supabase CLI](https://supabase.com/docs/guides/cli) enlazado a tu proyecto):

```bash
cd licitaciones
supabase link --project-ref TU_PROJECT_REF
supabase db push
```

Crea usuarios en Supabase Auth (email/contraseña) para iniciar sesión en el dashboard.

## Variables de entorno

Copia `.env.example` → `.env` (no subir al repo).

| Variable | Uso |
|----------|-----|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Login en el navegador |
| `VITE_API_URL` | Vacío en local (proxy). En prod: URL pública del API |
| `SUPABASE_SERVICE_ROLE_KEY` | Solo servidor (insertar en `analisis`) |
| `LLM_PROVIDER` | `anthropic` (default) u `openai` — qué API usa el comparador |
| `ANTHROPIC_API_KEY` | Si `LLM_PROVIDER=anthropic` |
| `ANTHROPIC_MODEL` | Opcional; default `claude-sonnet-4-6` |
| `OPENAI_API_KEY` | Si `LLM_PROVIDER=openai` |
| `OPENAI_MODEL` | Opcional; default `gpt-4o` (recomendado con PDFs; `gpt-4o-mini` puede no admitir archivos) |
| `OPENAI_BASE_URL` | Opcional; proxy o Azure-compatible |
| `LLM_TIMEOUT_MS` | Timeout de llamadas al modelo (default 300000). Alternativa: `ANTHROPIC_TIMEOUT_MS` |
| `LLM_MAX_TOKENS_ANALISIS_EXTENDIDO` | Tope de salida del análisis extendido (default 16384). Alternativa: `ANTHROPIC_MAX_TOKENS_ANALISIS_EXTENDIDO` |
| `LICITACIONES_API_PORT` | Default `3100` |
| `LICITACIONES_WEB_ORIGIN` | CORS, ej. `http://localhost:5173` |
| `DRIVE_CREDENTIALS_JSON` | Ruta al JSON del service account |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | Carpeta raíz de propuestas |
| `GOOGLE_DRIVE_TERMINOS_FOLDER_ID` | Carpeta central de términos (.docx / .pdf) |

## API

| Método | Ruta |
|--------|------|
| GET | `/health` |
| GET | `/api/convocatorias-drive/browse?parent_id=` |
| GET | `/api/convocatorias-drive/terminos?folder_id=` |
| GET | `/api/convocatorias-drive/pdf?file_id=` |
| POST | `/api/convocatorias-drive/comparar` |
| GET | `/api/convocatorias-drive/analisis-recientes?limit=` |
| GET | `/api/convocatorias-drive/analisis?folder_id=` |
| GET | `/api/convocatorias-drive/analisis/:id` |

Cabecera: `Authorization: Bearer <access_token>` (sesión Supabase).

## Desarrollo

```bash
cd licitaciones
npm install
npm run dev
```

Levanta el API (3100) y luego Vite (5173), cuando `/health` responde.

Scripts: `npm run dev:api`, `npm run dev:web`.
