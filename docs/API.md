# Referencia API

Base URL local: `http://localhost:3100`  
Prefijo de rutas de negocio: `/api/convocatorias-drive`

## Autenticación

Todas las rutas bajo `/api/convocatorias-drive` requieren:

```http
Authorization: Bearer <supabase_access_token>
```

Sin token o token inválido → `401` con `{ "data": null, "error": { "code": "UNAUTHORIZED", ... } }`.

---

## `GET /health`

Sin autenticación.

**Respuesta 200**

```json
{ "status": "ok", "service": "licitaciones-api" }
```

---

## `GET /browse`

Lista hijos de una carpeta Drive.

| Query | Requerido | Descripción |
|-------|-----------|-------------|
| `parent_id` | No | ID de carpeta; omitir = raíz (`GOOGLE_DRIVE_ROOT_FOLDER_ID`) |

**Respuesta 200**

```json
{
  "folders": [{ "id": "...", "name": "ACQUA", "type": "folder" }],
  "files": [{ "id": "...", "name": "doc.pdf", "type": "pdf" }]
}
```

**Errores:** `500` `DRIVE_ERROR`

---

## `GET /terminos`

Resuelve el TR en la carpeta central para una carpeta de servicio.

| Query | Requerido |
|-------|-----------|
| `folder_id` | Sí |

**Respuesta 200**

```json
{
  "data": { "id": "fileId", "name": "TR HSG (Aseo) - .docx" },
  "error": null
}
```

**Errores**

| Código HTTP | `error.code` | Cuándo |
|-------------|--------------|--------|
| 400 | `BAD_REQUEST` | Falta `folder_id` |
| 200 | `NO_TERMINOS` | No hay TR coincidente (`data: null`) |
| 500 | `DRIVE_ERROR` | Fallo Drive |

---

## `GET /pdf`

Descarga un PDF para visualización inline.

| Query | Requerido |
|-------|-----------|
| `file_id` | Sí |

**Respuesta 200:** cuerpo `application/pdf` con `Content-Disposition: inline`.

**Errores:** `400` `NOT_PDF`, `500` `DRIVE_ERROR`

---

## `POST /comparar`

Ejecuta el pipeline completo de comparación.

**Body**

```json
{ "folder_id": "1abc..." }
```

**Respuesta 200** (campos principales)

```json
{
  "analisis_id": "uuid",
  "conjunto": "20 DE JULIO",
  "servicio": "ASEO",
  "criterios": [],
  "documentacion": { "requisitos": [], "asignaciones": [], "archivos_por_proveedor": [] },
  "analisis_extendido": { "analisis_criterios": [], "financiero": {} },
  "propuestas": [],
  "top_3": [],
  "todas_las_propuestas": [],
  "reutilizado_ia": {
    "terminos_tr": true,
    "documentacion": false,
    "proveedores": { "ANNA GROUP": true, "OTRO": false }
  }
}
```

**Errores**

| HTTP | `code` | Descripción |
|------|--------|-------------|
| 400 | `NO_TERMINOS` | TR no encontrado |
| 400 | `NO_PROVEEDORES` | Sin subcarpetas |
| 502 | `COMPARAR_ERROR` | Fallo IA, JSON o Drive |
| 500 | `DB_ERROR` | Error al guardar |

> Duración típica: varios minutos. Configurar timeouts de proxy ≥ 600 s.

---

## `GET /analisis-recientes`

Listado para el home (usuario autenticado).

| Query | Default |
|-------|---------|
| `limit` | `30` (máx. 100) |

**Respuesta 200**

```json
{
  "data": [
    {
      "id": "uuid",
      "folder_id": "...",
      "conjunto": "...",
      "servicio": "...",
      "anio": 2026,
      "created_at": "2026-05-15T...",
      "top_3": [{ "proveedor": "...", "puntaje": 92.5 }]
    }
  ],
  "error": null
}
```

---

## `GET /analisis`

Historial de una carpeta de servicio.

| Query | Requerido |
|-------|-----------|
| `folder_id` | Sí |

**Respuesta 200:** array de metadatos (`id`, `conjunto`, `servicio`, `anio`, `created_at`, `created_by`), hasta 50 filas, más recientes primero.

---

## `GET /analisis/:id`

Fila completa de `analisis` (incluye JSONB: `criterios`, `propuestas`, `top_3`, `documentacion`, `analisis_extendido`).

**Errores:** `404` `NOT_FOUND`

---

## Formato de error estándar

```json
{
  "data": null,
  "error": {
    "code": "CODIGO_MAQUINA",
    "message": "Texto legible"
  }
}
```
