FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
# --ignore-scripts: no native add-ons are needed
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY index.js config.js ./
COPY lib/ ./lib/

# config only via environment (CHROMECAST2MQTT_*, see README), e.g.
#   -e CHROMECAST2MQTT_MQTT_URL=mqtt://broker
# mdns needs the host network (--network host); without it pin the devices:
#   -e CHROMECAST2MQTT_DISCOVERY=false -e CHROMECAST2MQTT_DEVICES=living_room=192.168.1.20
ENV NODE_ENV=production \
    CHROMECAST2MQTT_MQTT_URL=mqtt://localhost \
    CHROMECAST2MQTT_NAME=chromecast \
    CHROMECAST2MQTT_VERBOSITY=info

USER node

ENTRYPOINT ["node", "index.js"]
