const { HapStatusError, HAPStatus } = require('hap-nodejs');
const FermaxCamera = require('./FermaxCamera');

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
      .setCharacteristic(Characteristic.Model, 'Blue VEO-XS')
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
      .onSet(async (value) => this.handleLockTarget(value));

    if (!this.camera) {
      this.camera = new FermaxCamera(this.platform, this.deviceId, this.accessory);
    }
  }

  async handleLockTarget(value) {
    const { Characteristic } = this.platform;
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
        setTimeout(() => {
          this.lockService.updateCharacteristic(
            Characteristic.LockCurrentState,
            Characteristic.LockCurrentState.SECURED,
          );
          this.lockService.updateCharacteristic(
            Characteristic.LockTargetState,
            Characteristic.LockTargetState.SECURED,
          );
        }, (this.platform.config.unlockResetSeconds ?? 10) * 1000);
      } catch (error) {
        this.platform.log.error('Failed to open Fermax door', error);
        throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      }
    } else {
      this.lockService.updateCharacteristic(
        Characteristic.LockCurrentState,
        Characteristic.LockCurrentState.SECURED,
      );
    }
  }

  triggerDoorbell(payload) {
    const { Characteristic } = this.platform;
    this.doorbellService.updateCharacteristic(
      Characteristic.ProgrammableSwitchEvent,
      Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
    );
  }
}

module.exports = FermaxAccessory;

