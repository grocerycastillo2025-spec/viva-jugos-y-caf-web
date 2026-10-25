#!/usr/bin/env bash
#
# Regenera packages/shared-types/src/database.ts desde el esquema del proyecto.
#
# POR QUE `--project-id` Y NO `--db-url`
# `--linked` no vale desde el Codespace: necesita la conexion directa, que es
# solo IPv6. Pero `--db-url` tampoco resuelve el problema, aunque lo parezca:
# con una url arbitraria el CLI se conecta a la base y despues levanta un
# contenedor para leer el esquema, asi que exige Docker —comprobado con la
# 2.116.0: "failed to connect to the docker API"—, y el devcontainer de este
# repo no lo trae.
#
# `--project-id` va por la API de gestion, sobre HTTPS: ni base de datos, ni
# IPv6, ni Docker. Solo hace falta haber hecho `pnpm supabase login`, que
# tambien es HTTPS. Ver docs/PASO-A-PASO.md, seccion 3.4.
#
# Cualquier argumento extra se reenvia al CLI:  pnpm db:types --schema public
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib/entorno.sh"

# El ref se puede fijar a mano, pero por defecto sale de la url del proyecto,
# que ya es obligatoria para la app: https://<ref>.supabase.co
REF="${SUPABASE_PROJECT_ID:-}"
if [[ -z "$REF" ]]; then
  for url in "${NEXT_PUBLIC_SUPABASE_URL:-}" "${EXPO_PUBLIC_SUPABASE_URL:-}"; do
    [[ -z "$url" ]] && continue
    REF="$(printf '%s' "$url" | sed -nE 's#^https://([a-z0-9]+)\.supabase\.(co|in)/?$#\1#p')"
    [[ -n "$REF" ]] && break
  done
fi

# El valor de ejemplo de .env.example deriva a "xxxx", que llegaria a la API
# y volveria como un error de permisos: mejor decir lo que pasa de verdad.
if [[ "$REF" == "xxxx" ]]; then
  echo "ERROR: la url del proyecto en .env.local sigue siendo la de la" >&2
  echo "       plantilla (https://xxxx.supabase.co). Ponla de verdad:" >&2
  echo "       Dashboard -> Project Settings -> Data API -> Project URL." >&2
  exit 1
fi

if [[ -z "$REF" ]]; then
  cat >&2 <<FIN
ERROR: no se pudo averiguar el ref del proyecto.

Sale de NEXT_PUBLIC_SUPABASE_URL o EXPO_PUBLIC_SUPABASE_URL en .env.local,
que tienen la forma https://<ref>.supabase.co — comprueba que una de las dos
esta rellena y sin barra ni ruta al final.

Tambien se puede fijar a mano:

  SUPABASE_PROJECT_ID=trqfelkgovygcbqtofrs
FIN
  exit 1
fi

DESTINO="$RAIZ/packages/shared-types/src/database.ts"

# A un temporal y solo despues se mueve. Un `> destino` directo truncaria el
# archivo ANTES de ejecutar el comando, asi que una generacion fallida dejaria
# database.ts en cero bytes y el typecheck se caeria por un motivo que no
# tiene nada que ver con la causa real.
TEMPORAL="$(mktemp)"
trap 'rm -f "$TEMPORAL"' EXIT

echo "-> supabase gen types del proyecto $REF" >&2
if ! pnpm supabase gen types typescript --project-id "$REF" "$@" > "$TEMPORAL"; then
  cat >&2 <<FIN

Si el error habla de privilegios o de la cuenta, casi siempre es que falta
autenticarse (el token es de la sesion, no del repo):

  pnpm supabase login

No se ha tocado $DESTINO.
FIN
  exit 1
fi

# Una generacion correcta trae siempre el tipo raiz. Si no esta, algo salio
# mal aunque el CLI devolviera 0, y es mejor no pisar lo que ya funcionaba.
if ! grep -q "export type Database" "$TEMPORAL"; then
  echo "ERROR: la salida no parece tipos de Supabase; no se toca $DESTINO." >&2
  echo "       Primeras lineas de lo que llego:" >&2
  head -5 "$TEMPORAL" >&2
  exit 1
fi

mkdir -p "$(dirname "$DESTINO")"
mv "$TEMPORAL" "$DESTINO"
trap - EXIT
echo "-> escrito $DESTINO ($(wc -l < "$DESTINO") lineas)" >&2
