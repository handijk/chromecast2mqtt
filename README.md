# chromecast2mqtt

Interface between Google Cast devices (Chromecast, Google Home and Nest speakers, Android TV,
cast-enabled speakers) and MQTT, following the
[mqtt-smarthome](https://github.com/mqtt-smarthome/mqtt-smarthome) convention, built on
[mqtt-interfaces-core](https://github.com/hobbyquaker/mqtt-interfaces-core).

Devices are found with mdns (or pinned by address), every device keeps a Cast v2 connection open,
and its volume, the running app and what plays are retained status topics the moment they change.
Commands set the volume, mute, control playback, play a url and close the running app. Home
Assistant finds every device through MQTT discovery.

## Install

```
npm install -g chromecast2mqtt
chromecast2mqtt -u mqtt://broker                       # mdns finds the devices
chromecast2mqtt -u mqtt://broker --no-discovery -d living_room=192.168.1.20
sudo chromecast2mqtt --install -n chromecast -u mqtt://broker   # systemd service chromecast2mqtt@chromecast
```

## Docker

Multi-arch image (amd64, arm64, armv7). mdns needs the host network:

```
docker run -d --name chromecast2mqtt --restart unless-stopped --network host \
  -e CHROMECAST2MQTT_MQTT_URL=mqtt://broker ghcr.io/handijk/chromecast2mqtt
```

Without the host network pin the devices: `-e CHROMECAST2MQTT_DISCOVERY=false
-e CHROMECAST2MQTT_DEVICES=living_room=192.168.1.20,kitchen=192.168.1.21`.

## Topics

Instance name `chromecast` (`--name`); status payloads are `{"val": ..., "ts": ..., "lc": ...}`
unless `--no-json-payloads`.

| topic                                                                  | retained | value                                                             |
| ---------------------------------------------------------------------- | -------- | ----------------------------------------------------------------- |
| `chromecast/connected`                                                 | yes      | `0` gone, `1` broker only, `2` at least one device connected      |
| `chromecast/status/<device>/online`                                    | yes      | `true` while the connection to the device is up                   |
| `chromecast/status/<device>/name`, `model`, `address`, `id`            | yes      | the device                                                        |
| `chromecast/status/<device>/volume`                                    | yes      | `0`–`1`                                                           |
| `chromecast/status/<device>/muted`                                     | yes      | `true` or `false`                                                 |
| `chromecast/status/<device>/app`                                       | yes      | the running app ("Spotify", "YouTube"), `null` on the idle screen |
| `chromecast/status/<device>/app_id`                                    | yes      | its id, `null` on the idle screen                                 |
| `chromecast/status/<device>/idle`                                      | yes      | `true` when nothing runs (the backdrop)                           |
| `chromecast/status/<device>/status_text`                               | yes      | what the app says it does, or `null`                              |
| `chromecast/status/<device>/player_state`                              | yes      | `IDLE`, `PLAYING`, `PAUSED`, `BUFFERING`                          |
| `chromecast/status/<device>/title`, `artist`, `album`                  | yes      | what plays, or `null`                                             |
| `chromecast/status/<device>/content_type`, `content_id`, `stream_type` | yes      | the media                                                         |
| `chromecast/status/<device>/duration`, `position`                      | yes      | seconds, or `null`                                                |
| `chromecast/status/<device>/image`                                     | yes      | artwork url, or `null`                                            |
| `chromecast/status/<device>/idle_reason`                               | yes      | `FINISHED`, `CANCELLED`, `ERROR`, ... when the player went idle   |

`<device>` is the friendly name as a slug (`Living Room` → `living_room`), or the cast id with
`--device-topics id`. Two devices with the same name get the start of their id appended.

Some apps (YouTube, Netflix, ...) do not let a second sender join their media session: for those
you get the app and the volume, not what plays. The idle screen and apps without media report
`player_state` `IDLE`.

### Commands

| topic                                  | payload                                                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `chromecast/set/<device>/volume`       | `0.35` (or `35`)                                                                                                               |
| `chromecast/set/<device>/muted`        | `true` or `false`                                                                                                              |
| `chromecast/set/<device>/player_state` | `play`, `pause` or `stop` (the current media session)                                                                          |
| `chromecast/set/<device>/seek`         | seconds                                                                                                                        |
| `chromecast/set/<device>/play`         | `"https://host/stream.mp3"` or `{"url": ..., "content_type": "audio/mpeg", "title": ..., "image": ..., "stream_type": "LIVE"}` |
| `chromecast/set/<device>/quit`         | anything: closes the running app                                                                                               |

`play` launches the default media receiver with the url; the content type is guessed from the
url's extension when not given.

## Home Assistant

Discovery is on by default (`--no-ha-discovery` turns it off and clears it). Home Assistant has
no MQTT media player, so every cast device is a device with a volume slider, a mute switch, the
app, player state, title, artist and album as sensors and play, pause and stop buttons. A device
shows unavailable while its connection is down.

## Options

Run `chromecast2mqtt --help` for the full list; every option is also an environment variable
(`CHROMECAST2MQTT_DEVICES`, …), see `--config-schema`.

| option                 | default |                                                                    |
| ---------------------- | ------- | ------------------------------------------------------------------ |
| `--devices`, `-d`      |         | `<name>=<host>[:<port>],...` pinned devices (no mdns needed)       |
| `--discovery`          | on      | find devices with mdns (`--no-discovery` to turn it off)           |
| `--device-topics`      | `name`  | `name` or `id`                                                     |
| `--reconnect-interval` | `10`    | seconds between connection attempts to a device that is gone       |
| `--position-interval`  | `10`    | seconds between position updates while playing (`0` = events only) |

Shared options: `--mqtt-url/-u`, `--mqtt-username`, `--mqtt-password`, `--mqtt-tls-ca`, `--name/-n`,
`--json-payloads`, `--ha-discovery`, `--ha-prefix`, `--maintenance`, `--stats-interval`,
`--verbosity/-v`, `--install`, `--uninstall`, `--config-schema`.

## License

MIT
