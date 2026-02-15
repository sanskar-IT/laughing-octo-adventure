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

# Copy nginx config directly (using Docker service names)
RUN cp /etc/nginx/nginx.conf.template /etc/nginx/nginx.conf

# Start nginx
CMD ["nginx", "-g", "daemon off;"]

# ==========================================
# PRODUCTION STAGE
# ==========================================
FROM base as production

# SSL configuration
COPY ssl/ /etc/nginx/ssl/

# Copy nginx config directly
RUN cp /etc/nginx/nginx.conf.template /etc/nginx/nginx.conf

EXPOSE 80 443

CMD ["nginx", "-g", "daemon off;"]
