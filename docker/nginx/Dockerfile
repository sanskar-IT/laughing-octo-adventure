# AI Companion - Nginx Dockerfile
# Reverse proxy with SSL support

FROM nginx:alpine as base

# Install envsubst for template processing
RUN apk add --no-cache gettext

# Copy configuration
COPY nginx.conf /etc/nginx/nginx.conf.template

# Create required directories
RUN mkdir -p /var/log/nginx /etc/nginx/ssl

# ==========================================
# DEVELOPMENT STAGE
# ==========================================
FROM base as development

# Substitute environment variables and start nginx
CMD ["/bin/sh", "-c", "envsubst '$BACKEND_URL $FRONTEND_URL' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf && nginx -g 'daemon off;'"]

# ==========================================
# PRODUCTION STAGE
# ==========================================
FROM base as production

# SSL configuration
COPY ssl/ /etc/nginx/ssl/

# Modify nginx.conf for SSL (this would be done via template or separate config)
# For now, using the same config but with SSL port exposed

EXPOSE 80 443

CMD ["/bin/sh", "-c", "envsubst '$BACKEND_URL $FRONTEND_URL' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf && nginx -g 'daemon off;'"]
