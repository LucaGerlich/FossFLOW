#!/bin/sh


# Live data exposes the server/container inventory: fail closed without auth in front.
if [ -n "$BESZEL_URL" ] && { [ -z "$HTTP_AUTH_USER" ] || [ -z "$HTTP_AUTH_PASSWORD" ]; } && [ "$LIVE_ALLOW_UNAUTHENTICATED" != "true" ]; then
    echo "WARNING: BESZEL_URL is set but HTTP Basic Auth is not configured, so live data stays disabled."
    echo "         Set HTTP_AUTH_USER and HTTP_AUTH_PASSWORD, or LIVE_ALLOW_UNAUTHENTICATED=true if another layer protects this deployment."
    unset BESZEL_URL
fi

# Start Node.js backend if server storage or a live data source is enabled
if [ "$ENABLE_SERVER_STORAGE" = "true" ] || [ -n "$BESZEL_URL" ]; then
    echo "Starting FossFLOW backend server..."
    cd /app/packages/fossflow-backend
    if [ -n "$PUID" ] && [ -n "$PGID" ]; then
        su-exec $PUID:$PGID node server.js &
        echo "Backend server started as $PUID:$PGID"
    else 
        node server.js &
        echo "Backend server started"
    fi
else
    echo "Server storage and live data disabled, backend not started"
fi

# Start nginx

# Configure HTTP Basic Auth
touch /etc/nginx/.htpasswd
if [ -n "$HTTP_AUTH_USER" ] && [ -n "$HTTP_AUTH_PASSWORD" ]; then
    echo "Setup HTTP Basic Auth..."
    echo "$HTTP_AUTH_USER:$(printf '%s' "$HTTP_AUTH_PASSWORD" | openssl passwd -bcrypt -stdin)" > /etc/nginx/.htpasswd
    sed -i 's/AUTH_BASIC_SETTING/"Restricted"/g' /etc/nginx/http.d/default.conf
else
    echo "No (optional) HTTP Basic Auth configured"
    sed -i 's/AUTH_BASIC_SETTING/off/g' /etc/nginx/http.d/default.conf
fi
echo "Starting nginx..."
nginx -g "daemon off;"