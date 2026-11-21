# Ruvo: Railway, Cloud Run বা যেকোনো Docker হোস্টে চালানোর জন্য
# একটা সার্ভার: ডেটা /data-তে (স্থায়ী ডিস্ক/Volume লাগবে)।
# অনেক সার্ভার: DATABASE_URL (PostgreSQL) আর STORAGE=s3 দাও, তখন /data লাগে না।
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3200

# ffmpeg: ডকুমেন্টারি স্টুডিওর অডিও/ভিডিও রেসিপি (মাপা, পরিষ্কার, জোড়া, মিক্স, মান যাচাই)
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js ./
COPY lib ./lib
COPY public ./public
COPY prompts ./prompts

# Railway-র Volume root-এর মালিকানায় মাউন্ট হয়, তাই non-root ব্যবহারকারীতে /data-তে লেখা যায় না।
# STORAGE=s3 আর DATABASE_URL দিলে /data লাগে না; তখন চাইলে এখানে `USER node` যোগ করা নিরাপদ।
EXPOSE 3200
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3200)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
