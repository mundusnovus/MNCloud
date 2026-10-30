# Christian Cloud: one small Node service. Accounts come from Social, files go to the storage bucket,
# and the list of files, shares and versions is a SQLite database on the /data volume.
FROM node:24-slim
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
WORKDIR /app
COPY src/ src/
COPY public/ public/
COPY templates/ templates/
COPY LICENSE ./
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080
CMD ["node", "src/server.mjs"]
