FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY profiles ./profiles
ENV NODE_ENV=production
# config.json และ secret ส่งเข้ามาตอนรัน (mount / env) ไม่ฝังในอิมเมจ
VOLUME ["/app/data"]
EXPOSE 8787
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.js"]
