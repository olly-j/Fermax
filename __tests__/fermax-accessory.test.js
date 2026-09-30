const FermaxAccessory = require('../src/FermaxAccessory');

// Mock dependencies
const mockPlatform = {
    api: { hap: require('@homebridge/hap-nodejs') },
    log: {
        info: jest.fn(),
        error: jest.fn(),
    },
    config: {
        unlockResetSeconds: 1,
    },
    Service: {
        AccessoryInformation: 'AccessoryInformation',
        Doorbell: 'Doorbell',
        LockMechanism: 'LockMechanism',
    },
    Characteristic: {
        Manufacturer: 'Manufacturer',
        Model: 'Model',
        SerialNumber: 'SerialNumber',
        Name: 'Name',
        LockCurrentState: {
            SECURED: 1,
            UNSECURED: 0,
        },
        LockTargetState: {
            SECURED: 1,
            UNSECURED: 0,
        },
        ProgrammableSwitchEvent: {
            SINGLE_PRESS: 0,
        },
    },
    client: {
        openDoor: jest.fn(),
    },
};

const mockAccessory = {
    getService: jest.fn(),
    addService: jest.fn(),
    configureController: jest.fn(),
    displayName: 'Test Accessory',
};

const mockService = {
    setCharacteristic: jest.fn().mockReturnThis(),
    getCharacteristic: jest.fn().mockReturnThis(),
    updateCharacteristic: jest.fn(),
    onSet: jest.fn(),
};

describe('FermaxAccessory', () => {
    let accessory;

    beforeEach(() => {
        jest.clearAllMocks();
        mockAccessory.getService.mockReturnValue(mockService);
        mockAccessory.addService.mockReturnValue(mockService);

        accessory = new FermaxAccessory(mockPlatform, mockAccessory, {
            deviceId: 'device-123',
            door: { block: 1, subblock: 0, number: 1 },
            name: 'Test Door',
        });
    });

    test('initializes services correctly', () => {
        expect(mockAccessory.getService).toHaveBeenCalledWith('AccessoryInformation');
        expect(mockAccessory.getService).toHaveBeenCalledWith('Doorbell');
        expect(mockAccessory.getService).toHaveBeenCalledWith('LockMechanism');
    });

    test('handleLockTarget unlocks door and resets', async () => {
        mockPlatform.client.openDoor.mockResolvedValue(true);
        jest.useFakeTimers();

        await accessory.handleLockTarget(mockPlatform.Characteristic.LockTargetState.UNSECURED);

        expect(mockPlatform.client.openDoor).toHaveBeenCalledWith('device-123', { block: 1, subblock: 0, number: 1 });
        expect(mockService.updateCharacteristic).toHaveBeenCalledWith(
            mockPlatform.Characteristic.LockCurrentState,
            mockPlatform.Characteristic.LockCurrentState.UNSECURED
        );

        // Fast-forward time
        jest.runAllTimers();

        expect(mockService.updateCharacteristic).toHaveBeenCalledWith(
            mockPlatform.Characteristic.LockCurrentState,
            mockPlatform.Characteristic.LockCurrentState.SECURED
        );

        jest.useRealTimers();
    });

    test('handleLockTarget handles failure', async () => {
        mockPlatform.client.openDoor.mockResolvedValue(false);

        await expect(
            accessory.handleLockTarget(mockPlatform.Characteristic.LockTargetState.UNSECURED)
        ).rejects.toThrow();
    });

    test('triggerDoorbell updates characteristic', () => {
        accessory.triggerDoorbell({});
        expect(mockService.updateCharacteristic).toHaveBeenCalledWith(
            mockPlatform.Characteristic.ProgrammableSwitchEvent,
            mockPlatform.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS
        );
    });
});

describe('Fermax accessory HomeKit capabilities', () => {
    const hap = require('@homebridge/hap-nodejs');
    const context = { deviceId: 'real-hap-door', name: 'Front Door', door: { block: 1, subblock: 0, number: 1 } };
    const host = (config) => ({
        api: { hap }, Service: hap.Service, Characteristic: hap.Characteristic,
        config, client: { openDoor: jest.fn().mockResolvedValue(true) },
        log: { error: jest.fn(), warn: jest.fn() },
    });
    const device = () => new hap.Accessory('Front Door', hap.uuid.generate('fermax-capability-test'));

    test('door-only mode retains a real doorbell event and lock without camera services', () => {
        const hapAccessory = device();
        const implementation = new FermaxAccessory(host({}), hapAccessory, context);
        expect(hapAccessory.getService(hap.Service.CameraRTPStreamManagement)).toBeUndefined();
        expect(hapAccessory.activeCameraController).toBeUndefined();
        expect(hapAccessory.getService(hap.Service.LockMechanism)).toBeDefined();
        implementation.triggerDoorbell();
        expect(hapAccessory.getService(hap.Service.Doorbell)
            .getCharacteristic(hap.Characteristic.ProgrammableSwitchEvent).value).toBe(0);
        implementation.dispose();
    });

    test('switching a cached video accessory to door-only removes its old camera services', () => {
        const hapAccessory = device();
        const videoAccessory = new FermaxAccessory(host({ cameraStreamUrl: 'rtsp://camera.test/live' }), hapAccessory, context);
        expect(hapAccessory.getService(hap.Service.CameraRTPStreamManagement)).toBeDefined();
        const cachedAccessory = hap.Accessory.deserialize(hap.Accessory.serialize(hapAccessory));
        videoAccessory.dispose();
        const doorAccessory = new FermaxAccessory(host({}), cachedAccessory, context);
        expect(cachedAccessory.getService(hap.Service.CameraRTPStreamManagement)).toBeUndefined();
        expect(cachedAccessory.activeCameraController).toBeUndefined();
        expect(cachedAccessory.getService(hap.Service.Doorbell)).toBeDefined();
        doorAccessory.dispose();
    });

    test.each([
        { cameraSnapshotUrl: 'https://camera.test/snapshot.jpg' },
        { backend: 'homeassistant', homeAssistantCameraEntity: 'camera.front_door' },
        { firebaseProjectId: 'project', firebaseAppId: 'app', firebaseApiKey: 'key' },
    ])('retains explicitly configured media capabilities: %j', (config) => {
        const hapAccessory = device();
        const implementation = new FermaxAccessory(host(config), hapAccessory, context);
        expect(hapAccessory.getService(hap.Service.CameraRTPStreamManagement)).toBeDefined();
        implementation.dispose();
    });

    test('default release display resets after eight seconds', async () => {
        jest.useFakeTimers();
        const hapAccessory = device();
        const implementation = new FermaxAccessory(host({}), hapAccessory, context);
        try {
            await implementation.handleLockTarget(hap.Characteristic.LockTargetState.UNSECURED);
            jest.advanceTimersByTime(7999);
            expect(implementation.lockService.getCharacteristic(hap.Characteristic.LockCurrentState).value).toBe(0);
            jest.advanceTimersByTime(1);
            expect(implementation.lockService.getCharacteristic(hap.Characteristic.LockCurrentState).value).toBe(1);
        } finally { implementation.dispose(); jest.useRealTimers(); }
    });
});
