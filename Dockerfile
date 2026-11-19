FROM node:22-alpine
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/src ./src
COPY web /app/web
ENV PORT=4000 DATA_DIR=/data
VOLUME /data
EXPOSE 4000
CMD ["npm", "start"]
