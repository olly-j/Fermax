# Configuration audit

Reviewed 30 September 2026 for `0.2.0-beta.2`. The settings form, terminal wizard and runtime must describe the same capabilities. This beta remains subject to the [hardware acceptance checks](development.md#hardware-acceptance).

## Supported setup journeys

| Journey | Required input | Optional capability |
|---|---|---|
| Home Assistant door release | HA origin, token and exact lock entity | Ring entity adds alerts; camera adds snapshots/video; preview button wakes that camera |
| Direct Fermax door release | Fermax account | Current app OAuth credentials are recommended; exact monitor/door selectors are required for ambiguous accounts |
| Direct alerts | Direct account plus Firebase project ID, app ID and API key | VAPID key if required by that project; cloud registration remains experimental |
| External video | Independently working FFmpeg source URL | Snapshot URL, source input arguments and H.264 transcoding controls |

Current OAuth credentials must be supplied as a pair. The legacy fallback is retained for compatibility, but its validity for current accounts has not been established. Device IDs, door keys and HA entities in examples are placeholders, never guaranteed identifiers for an installation. The wizard creates a configuration file without contacting either service.

## Field behavior and relevance

| Setting group | Runtime consumer | Limit or dependency |
|---|---|---|
| Connection, accessory name | `FermaxPlatform` | One entrance per platform; name applies to both modes |
| HA origin, token and entities | `HomeAssistantClient` | Exact entity types; preview requires a camera; direct credentials are unused in HA mode |
| Fermax account and OAuth pair | `FermaxClient` | Direct mode only; live credentials must be confirmed on the deployment |
| Monitor ID/tag, door key/index | `FermaxPlatform.syncDevices` | Explicit mismatches fail; no accidental selection from an empty numeric form field |
| Firebase project/app/API/VAPID | `FermaxPushClient` | Direct mode only; project/app/API values are needed together |
| External stream and snapshot URLs | `FermaxCamera` | Overrides selected media; external video skips HA preview activation |
| Transcode toggle | `FermaxCamera` | External H.264 only; automatic HA MJPEG always transcodes |
| Maximum bitrate | `FermaxCamera` | Limits transcoded output; stream copy retains source bitrate |
| Extra input arguments, FFmpeg path, diagnostics | `FermaxCamera` | Advanced media controls; secrets are withheld from diagnostics |
| Release display duration | `FermaxAccessory` | Timer only; neither door position nor a physical locking operation |
| Fermax API/OAuth endpoint overrides | `FermaxClient` | Advanced direct-mode compatibility with reviewed current/legacy service hosts |
| Legacy `senderId` | None in the installed push receiver | Retained old JSON has no effect; removed from the setup form and wizard |

Camera services are created only when a supported media source or direct push snapshot route is configured; release-only setups do not expose a nonfunctional camera. Direct Fermax snapshots require a registered push token and an existing photocaller image; door release alone does not establish that capability.

## Verification boundaries

181 automated checks pass across ten suites, covering configuration rules, authentication and cancellation, selected-door safety, ring deduplication, camera negotiation and a real local authenticated MJPEG-to-SRTP stream. They cannot establish whether the legacy OAuth values work today, whether Fermax accepts a Firebase registration, or whether a physical monitor supplies a cold preview before Apple Home times out.

The corrected form was exercised in stock Homebridge UI 5.29.0 with isolated storage and test values. Both modes hide unrelated fields; secrets are masked; optional sections collapse and open by keyboard; missing essentials, malformed lock entities, partial OAuth pairs and partial Firebase settings block Save. Home Assistant configuration was saved and reopened, retaining its selected values. External video hides HA preview, and stream copy hides the ineffective bitrate control. Screenshots were visually inspected at desktop and 390-pixel mobile widths for spacing and single headings. Both modes saved and reopened successfully; saved JSON passed runtime validation without an implicit door index or sender ID. Malformed origins and out-of-range bitrate values were also rejected.

Changing connection removes the previous mode’s fields in the Homebridge renderer; save that change intentionally or close without saving. Door index and endpoint overrides remain available through manual JSON for compatibility, but are omitted from routine setup. No real account connection or door command was made during these form checks.

Physical door release, real incoming calls, phone-notification preservation, Pi CPU load, remote Apple Home operation and a 24-hour burn-in remain deployment acceptance checks. Record observed results before describing the plugin as reliable on a particular entrance.
