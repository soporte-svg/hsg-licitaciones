# Guía de Google Drive

Convenciones para que el comparador encuentre archivos y vincule el TR correcto.

## Carpetas requeridas

| Variable `.env` | Rol |
|-----------------|-----|
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | Punto de entrada del explorador (edificios / conjuntos) |
| `GOOGLE_DRIVE_TERMINOS_FOLDER_ID` | Biblioteca única de Términos de Referencia |

Ambas deben estar **compartidas** con el email del service account (`client_email` del JSON), permiso al menos **Lector**.

## Jerarquía recomendada

```
Raíz (ROOT)
├── CONJUNTO_A/
│   ├── Servicio 1/          ← folder_id usado en Comparar
│   │   ├── Proveedor X/
│   │   └── Proveedor Y/
│   └── Servicio 2/
└── CONJUNTO_B/
    └── ...
```

- **Comparar** solo funciona en una carpeta que tenga **al menos una subcarpeta** (proveedores).
- Los PDFs dentro de cada subcarpeta son las propuestas analizadas.

## Nomenclatura de Términos de Referencia

Los TR viven en la carpeta central, no dentro del servicio.

Ejemplos válidos:

- `TR HSG (Aseo) - .docx`
- `TR HSG (Vigilancia Enero).pdf`
- `Terminos Aseo HSG.docx`

El algoritmo (`findTerminosFileForServiceFolder`):

1. Lee el **nombre de la carpeta de servicio** (y ancestros si aplica).
2. Puntúa cada archivo de la carpeta central que parezca TR (docx/pdf).
3. Elige el de mayor puntuación.

**Buenas prácticas**

- Incluir el nombre del servicio en el archivo TR: `TR HSG (NombreServicio)`.
- Prefijo `TR` o la palabra `terminos` en el nombre.
- Evitar nombres genéricos sin relación al servicio.

## PDFs de propuestas

| Regla | Detalle |
|-------|---------|
| Formato | Solo PDF en la extracción automática |
| Límite por proveedor | `COMPARAR_MAX_PDFS_PER_PROVEEDOR` (default 4) |
| Tamaño máximo | `COMPARAR_MAX_PDF_BYTES` (default 4 MB) |

PDFs más grandes o excedentes del límite se omiten (ver log `[comparar]`).

## Permisos y seguridad

- El service account solo necesita **lectura**.
- No subir el JSON de credenciales al repositorio; usar `secrets/` local o variable de entorno en CI.
- Los enlaces a archivos en la UI usan URLs públicas de Drive (`drive.google.com/file/d/...`); el usuario debe tener acceso en su cuenta Google si abre fuera del visor embebido.

## Scripts de apoyo

En `scripts/` (desarrollo):

- `list-terminos-drive.mts` — listar candidatos TR en la carpeta central.
- `test-terminos-match.mts` — probar emparejamiento servicio ↔ TR.

Ejecutar con `npx tsx scripts/....mts` desde la raíz del proyecto (con `.env` cargado).
