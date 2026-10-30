# Christian Cloud: one small Node service. Accounts come from Social, files go to the storage bucket,
# and the list of files, shares and versions is a SQLite database on the /data volume.
FROM node:24-slim
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
WORKDIR /app
COPY src/ src/
COPY public/ public/
COPY templates/ templates/
COPY LICENSE ./
RUN mkdir -p /data
EXPOSE 8080
# Railway mounts the volume as root: hand it to the node user, then run as that user.
CMD ["sh", "-c", "chown -R node:node \"$DATA_DIR\" && exec setpriv --reuid=node --regid=node --init-groups node src/server.mjs"]
