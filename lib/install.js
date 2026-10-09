import {createInstaller} from 'mqtt-interfaces-core';

export const SERVICE = 'chromecast2mqtt';
export const ENV_PREFIX = 'CHROMECAST2MQTT';

const installer = createInstaller({
    service: SERVICE,
    envPrefix: ENV_PREFIX,
    description: `${SERVICE} %i - Google Cast to MQTT bridge`,
    documentation: 'https://github.com/handijk/chromecast2mqtt',
    serviceExtra: [],
});

export const {unitFile, envFile, installService, uninstallService, handle} = installer;
