FROM node:22-alpine AS builder

WORKDIR /app

# Build arguments
ARG VITE_WEBSOCKET_URL=wss://tiendapago.nomada.dev/ws

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the application with environment variable
RUN VITE_WEBSOCKET_URL=${VITE_WEBSOCKET_URL} npm run build

# Production stage
FROM nginx:alpine

# Copy built assets from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
