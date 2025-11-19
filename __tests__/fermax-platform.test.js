const FermaxPlatform = require('../src/FermaxPlatform');
const FermaxClient = require('../src/api/FermaxClient');
const FermaxPushClient = require('../src/push/FermaxPushClient');

jest.mock('../src/api/FermaxClient');
jest.mock('../src/push/FermaxPushClient');
jest.mock('../src/FermaxAccessory');

const mockAPI = {
    on: jest.fn(),
    hap: {
        Service: {},
        Characteristic: {},
        uuid: {
            generate: jest.fn().mockReturnValue('uuid-123'),
        },
    },
    user: {
        storagePath: jest.fn().mockReturnValue('/tmp'),
    },
    platformAccessory: jest.fn(),
    registerPlatformAccessories: jest.fn(),
};

const mockLog = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
};

const mockConfig = {
    username: 'user',
    password: 'pass',
    senderId: 'sender',
    deviceId: 'device-123',
};

describe('FermaxPlatform', () => {
    let platform;

    beforeEach(() => {
        jest.clearAllMocks();
        platform = new FermaxPlatform(mockLog, mockConfig, mockAPI);
    });

    test('initializes correctly', async () => {
        FermaxClient.mockImplementation(() => ({
            getPairings: jest.fn().mockResolvedValue([{
                deviceId: 'device-123',
                accessDoorMap: {
                    'door-1': { accessId: { block: 1, subblock: 0, number: 1 } }
                }
            }]),
            registerAppToken: jest.fn().mockResolvedValue(true),
        }));

        FermaxPushClient.mockImplementation(() => ({
            start: jest.fn().mockResolvedValue('token-123'),
        }));

        await platform.initialize();

        expect(FermaxClient).toHaveBeenCalled();
        expect(FermaxPushClient).toHaveBeenCalled();
        expect(mockAPI.registerPlatformAccessories).toHaveBeenCalled();
    });

    test('handles missing config', async () => {
        const p = new FermaxPlatform(mockLog, {}, mockAPI);
        await p.initialize();
        expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('missing username'));
    });
});
