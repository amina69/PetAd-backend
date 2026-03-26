# # Use lightweight Node image
# FROM node:20-alpine

# # Set working directory
# WORKDIR /app

# # Copy package files first (better caching)
# COPY package*.json ./

# # Install dependencies
# RUN npm install

# # Copy project files
# COPY . .

# # Expose app port
# EXPOSE 3000

# # Start in development mode
# CMD ["npm", "run", "start:dev"]


FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm config set registry https://registry.npmjs.org/ && \
    npm ci --prefer-offline || npm install --fetch-retry-mintimeout 20000 \
    --fetch-retry-maxtimeout 120000 \
    --fetch-retries 5

COPY . .

# Generate Prisma client
RUN npx prisma generate

EXPOSE 3001

# CMD ["sh", "-c", "npx prisma migrate deploy && npm run start:dev"]
CMD ["npm", "run", "start:dev"]
