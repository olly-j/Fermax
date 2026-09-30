const FermaxCamera = require('./FermaxCamera');
const { hasCameraCapability, DEFAULT_UNLOCK_RESET_SECONDS } = require('./configuration');

class FermaxAccessory {
  constructor(platform, accessory, context) {
    this.platform = platform;
    this.accessory = accessory;
    this.context = context;
    this.deviceId = context.deviceId;
    this.door = context.door;

    this._initAccessory();
  }

  _initAccessory() {
    const { Service, Characteristic } = this.platform;

    this.accessory
      .getService(Service.AccessoryInformation)
      ?.setCharacteristic(Characteristic.Manufacturer, 'Fermax')
      .setCharacteristic(Characteristic.Model, 'DUOX')
      .setCharacteristic(Characteristic.SerialNumber, this.deviceId);

    this.doorbellService =
      this.accessory.getService(Service.Doorbell) ||
      this.accessory.addService(Service.Doorbell);
    this.doorbellService.setCharacteristic(Characteristic.Name, this.context.name);

    this.lockService =
      this.accessory.getService(Service.LockMechanism) ||
      this.accessory.addService(Service.LockMechanism);
    this.lockService
      .setCharacteristic(Characteristic.Name, `${this.context.name} Door`)
      .setCharacteristic(Characteristic.LockCurrentState, Characteristic.LockCurrentState.SECURED)
      .setCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.SECURED)
      .getCharacteristic(Characteristic.LockTargetState)
      .onSet(async (value) => this.handleLockTarget(value));

    this.doorbellService.setPrimaryService?.();
    if (!this.camera && hasCameraCapability(this.platform.config)) {
      this.camera = new FermaxCamera(this.platform, this.deviceId, this.accessory);
    } else if (!this.camera) {
      // Old cached accessories may still contain the previously unconditional
      // camera services. Configure then remove the controller to retire its
      // persisted services through HAP's own migration mechanism.
      const previousCamera = new FermaxCamera(this.platform, this.deviceId, this.accessory);
      this.accessory.removeController?.(previousCamera.controller);
      previousCamera.dispose();
    }
  }

  async handleLockTarget(value) {
    const { Characteristic } = this.platform;
    const { HapStatusError, HAPStatus } = this.platform.api.hap;
    if (value === Characteristic.LockTargetState.UNSECURED) {
      try {
        const ok = await this.platform.client.openDoor(this.deviceId, this.door);
        if (!ok) {
          throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
        }
        this.lockService.updateCharacteristic(
          Characteristic.LockCurrentState,
          Characteristic.LockCurrentState.UNSECURED,
        );
        clearTimeout(this.resetTimer);
        this.resetTimer = setTimeout(() => {
          this.lockService.updateCharacteristic(
            Characteristic.LockCurrentState,
            Characteristic.LockCurrentState.SECURED,
          );
          this.lockService.updateCharacteristic(
            Characteristic.LockTargetState,
            Characteristic.LockTargetState.SECURED,
          );
        }, (this.platform.config.unlockResetSeconds ?? DEFAULT_UNLOCK_RESET_SECONDS) * 1000);
      } catch {
        this.platform.log.error('Failed to open Fermax door');
        throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      }
    } else {
      this.lockService.updateCharacteristic(
        Characteristic.LockCurrentState,
        Characteristic.LockCurrentState.SECURED,
      );
    }
  }

  dispose() {
    clearTimeout(this.resetTimer);
    this.camera?.dispose?.();
  }

  triggerDoorbell(_payload) {
    const { Characteristic } = this.platform;
    this.doorbellService.updateCharacteristic(
      Characteristic.ProgrammableSwitchEvent,
      Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
    );
  }
}

module.exports = FermaxAccessory;
