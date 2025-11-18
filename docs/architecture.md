## Fermax Blue Bridge Architecture

### 1. Problem
- Fermax VEO-XS WiFi DUOX Plus monitor only exposes Fermax Blue / DuoxMe cloud, no open bus/RTSP contact.
- Requirements: HomeKit doorbell alerts with unlock, optional video, software-only control.

### 2. Solution Concept
1. Core Fermax Blue API library (`fermax_blue` package).
2. Home Assistant custom integration (`custom_components/fermax_blue`) that imports the core library.
3. HomeKit Bridge in Home Assistant (existing integration) publishes HA entities to Apple Home.
4. Optional future Homebridge plugin built on same API layer.

### 3. Components
- **FermaxClient**: handles HTTPS auth, token cache, device discovery, door open, history, optional video endpoints.
- **FermaxBlueBridge**: orchestrates polling, event callbacks, and exposes ergonomic methods for HA entities.
- **HA Integration**: config flow → DataUpdateCoordinator → entities (binary_sensor doorbell, lock door, optional camera/button).
- **HomeKit Bridge**: reuses HA entities for Apple Home doorbell notifications & lock control.

### 4. Phase Plan
1. Implement FermaxClient + FermaxBlueBridge skeletons with mocked API layer for now.
2. Build HA integration scaffold (config_flow, coordinator, binary sensor, lock, optional camera/button).
3. Document HomeKit room/entity layout for doorbell notifications.
4. Stretch: outline Homebridge plugin leveraging same API (direct Node or Python microservice).

### 5. Security & Networking
- Store credentials in HA secrets or encrypted config; token cache file is owner-only.
- Keep optional HTTP/MQTT helpers bound to localhost.
- Use exponential backoff, handle API rate limits gracefully.
- Provide clear error logging when Fermax cloud unreachable.

### 6. Testing Approach
- Unit tests: mock HTTP for auth/device/history/door open; validate polling ring detection.
- HA tests: coordinator refresh, entity state flips, lock unlocking path.
- Integration tests on hardware: doorbell press path, unlock from Home, offline failure behavior, burn-in.

