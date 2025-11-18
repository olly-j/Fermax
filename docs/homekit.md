## HomeKit / Homebridge Notes

### Home Assistant path
1. Install the `fermax_blue` custom integration.
2. Expose these entities through HA HomeKit Bridge:
   - `binary_sensor.fermax_doorbell`
   - `lock.fermax_door`
   - `camera.fermax_door` (optional)
3. In Apple Home, keep the camera + lock in the same room to have HomeKit treat it as a doorbell.

### Optional Homebridge plugin
- Plugin name: `homebridge-fermax-blue`.
- Responsibilities: authenticate to Fermax Blue (direct Node port or Python microservice), emit HomeKit VideoDoorbell service, add lock mechanism service.
- Config shape:
  ```json
  {
    "platform": "FermaxBlue",
    "username": "user@example.com",
    "password": "secret",
    "pollInterval": 10,
    "deviceId": "optional",
    "accessId": {
      "subblock": 0,
      "block": 0,
      "number": 0
    }
  }
  ```

