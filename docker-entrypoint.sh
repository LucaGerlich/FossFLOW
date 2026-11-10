#!/bin/sh

# Configure HTTP Basic Auth: an optional extra layer in front of the app's own sign-in.
touch /etc/nginx/.htpasswd
if [ -n "$HTTP_AUTH_USER" ] && [ -n "$HTTP_AUTH_PASSWORD" ]; then
    echo "Setup HTTP Basic Auth..."
    # SHA-512 crypt ($6$): OpenSSL has no bcrypt option, and musl's crypt()
    # (used by nginx on Alpine) verifies $6$ hashes.
    if ! HASH=$(printf '%s' "$HTTP_AUTH_PASSWORD" | openssl passwd -6 -stdin) || [ -z "$HASH" ]; then
        echo "ERROR: could not hash HTTP_AUTH_PASSWORD; refusing to start without working auth." >&2
        exit 1
    fi
    echo "$HTTP_AUTH_USER:$HASH" > /etc/nginx/.htpasswd
    sed -i 's/AUTH_BASIC_SETTING/"Restricted"/g' /etc/nginx/http.d/default.conf
else
    echo "No (optional) HTTP Basic Auth configured"
    sed -i 's/AUTH_BASIC_SETTING/off/g' /etc/nginx/http.d/default.conf
fi

# Without a database there is no platform: serve the plain local editor.
if [ -z "$DATABASE_URL" ]; then
    echo "No DATABASE_URL: serving the local editor only (no sign-in, saved in the browser)."
    exec nginx -g "daemon off;"
fi

# The server runs unprivileged and owns /data, where its encryption key lives.
RUN_AS="${PUID:-1000}:${PGID:-1000}"
mkdir -p /data && chown -R "$RUN_AS" /data
echo "Starting FossFLOW server as $RUN_AS..."
cd /app/packages/fossflow-backend
su-exec "$RUN_AS" node dist/main.js &
SERVER_PID=$!
# docker stop: let the server shut down cleanly (this script is PID 1).
trap 'kill -TERM "$SERVER_PID" 2>/dev/null' TERM INT

# Serve nothing until the server answers: during a half-started container the
# app would find no platform and fall back to local mode.
tries=0
until wget -q -O /dev/null "http://127.0.0.1:${BACKEND_PORT}/api/health" 2>/dev/null; do
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
        echo "ERROR: the server stopped during startup; see the messages above." >&2
        exit 1
    fi
    tries=$((tries + 1))
    if [ "$tries" -ge 120 ]; then
        echo "ERROR: the server didn't answer within 60 seconds." >&2
        kill -TERM "$SERVER_PID"
        exit 1
    fi
    sleep 0.5
done

echo "Starting nginx..."
nginx

# The container lives as long as the server; the restart policy brings it back.
wait "$SERVER_PID"
status=$?
# A trapped signal ends the first wait early: wait for the shutdown to finish.
if kill -0 "$SERVER_PID" 2>/dev/null; then
    wait "$SERVER_PID"
    status=$?
fi
echo "Server exited with status $status."
exit "$status"
