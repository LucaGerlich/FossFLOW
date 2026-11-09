#!/bin/sh


# Live data exposes the server/container inventory: fail closed without auth in front.
if [ -n "$BESZEL_URL" ] && { [ -z "$HTTP_AUTH_USER" ] || [ -z "$HTTP_AUTH_PASSWORD" ]; } && [ "$LIVE_ALLOW_UNAUTHENTICATED" != "true" ]; then
    echo "WARNING: BESZEL_URL is set but HTTP Basic Auth is not configured, so live data stays disabled."
    echo "         Set HTTP_AUTH_USER and HTTP_AUTH_PASSWORD, or LIVE_ALLOW_UNAUTHENTICATED=true if another layer protects this deployment."
    unset BESZEL_URL
fi

# Start the platform server. Without DATABASE_URL it exits with a clear
# message and nginx still serves the app, which then runs in local mode.
echo "Starting FossFLOW server..."
cd /app/packages/fossflow-backend
if [ -n "$PUID" ] && [ -n "$PGID" ]; then
    # The server writes its encryption key into the data volume.
    mkdir -p /data && chown -R "$PUID:$PGID" /data
    su-exec "$PUID:$PGID" node dist/main.js &
    echo "Server started as $PUID:$PGID"
else
    node dist/main.js &
    echo "Server started"
fi

# Start nginx

# Configure HTTP Basic Auth
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
echo "Starting nginx..."
nginx -g "daemon off;"