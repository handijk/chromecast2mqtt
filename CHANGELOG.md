# Changelog

## 0.1.0

### Added

- Cast devices found with mdns or pinned with `--devices`, each with a Cast v2 connection that is
  kept open and reconnected.
- Status items per device: `online`, `volume`, `muted`, `app`, `app_id`, `idle`, `player_state`,
  `title`, `artist`, `album`, `content_type`, `content_id`, `duration`, `position`, `image`, and
  the device's `name`, `model`, `address`, `id`.
- Commands: `set/<device>/volume`, `muted`, `player_state` (play, pause, stop), `seek`, `play` (a
  url, or `{url, content_type, title, image, stream_type}`), `quit`.
- Home Assistant discovery: one device per cast device with volume, mute, what plays and the
  transport buttons.
- Docker image (`ghcr.io/handijk/chromecast2mqtt`), systemd installer (`--install`).
