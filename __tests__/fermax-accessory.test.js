const FermaxAccessory = require('../src/FermaxAccessory');
const { HAPStatus } = require('hap-nodejs');

// Mock dependencies
const mockPlatform = {
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

        // Mock FermaxCamera to avoid instantiation issues
        jest.mock('../src/FermaxCamera', () => {
            return jest.fn().mockImplementation(() => ({}));
        });

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
