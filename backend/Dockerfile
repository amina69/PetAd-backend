# Use lightweight Node image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files first (better caching)
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy project files
COPY . .

# Expose app port
EXPOSE 3000

# Start in development mode
CMD ["npm", "run", "start:dev"]
