#!/usr/bin/env bash
#
# Envoltorio de `supabase db push`.
#
# El CLI no lee SUPABASE_DB_URL del entorno por su cuenta —comprobado con la
# 2.116.0: sin `--db-url` responde "Cannot find project ref"—, asi que hay
# que pasarsela en cada invocacion. Este script lo hace, leyendola de
# .env.local. Ver docs/PASO-A-PASO.md, seccion 3.4.
#
# Cualquier argumento extra se reenvia al CLI:  pnpm db:push --dry-run
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib/entorno.sh"

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  cat >&2 <<FIN
ERROR: .env.local existe, pero SUPABASE_DB_URL esta vacia o no esta.

Anade esta linea (con comillas), sacando la cadena del dashboard en
Connect -> Session pooler, puerto 5432 (NO el de transacciones, que no
sirve para migraciones):

  SUPABASE_DB_URL="postgresql://postgres.<ref>:<password>@<host>:5432/postgres"

Si la contrasena lleva @ # / o :, hay que percent-encodearla dentro de la
URL o la cadena se parte por la mitad.

Detalle completo en docs/PASO-A-PASO.md, seccion 3.4.
FIN
  exit 1
fi

# Solo el host, nunca la cadena entera: lleva la contrasena dentro y esto
# acaba en logs y en capturas de pantalla. Los tres recortes van en este
# orden —esquema, credenciales, ruta— y el del medio corta por el ULTIMO
# arroba a proposito: si la contrasena lleva un @ sin percent-encodear,
# cortar por el primero dejaria media contrasena a la vista.
DB_HOST="$(printf '%s' "$SUPABASE_DB_URL" \
  | sed -E 's#^[a-zA-Z][a-zA-Z0-9+.-]*://##; s#^.*@##; s#[/?].*$##')"

if [[ "$DB_HOST" == localhost:* || "$DB_HOST" == 127.0.0.1:* ]]; then
  echo "   Aviso: apunta a una base local. Si no tienes 'supabase start'" >&2
  echo "   corriendo, esto va a fallar por conexion rechazada." >&2
fi

echo "-> supabase db push contra ${DB_HOST:-(host no reconocido)}" >&2
exec pnpm supabase db push --db-url "$SUPABASE_DB_URL" "$@"
