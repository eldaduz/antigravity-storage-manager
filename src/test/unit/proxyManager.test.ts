import * as assert from 'assert';
import * as cp from 'child_process';
import { EventEmitter } from 'events';

// Mock child_process
jest.mock('child_process');
// Mock fs
const mockExistsSync = jest.fn();
const mockMkdirSync = jest.fn();
jest.mock('fs', () => ({
    ...jest.requireActual('fs'),
    existsSync: (...args: any[]) => mockExistsSync(...args),
    mkdirSync: (...args: any[]) => mockMkdirSync(...args),
}));

// Mock vscode module
const mockGetConfiguration = jest.fn();
const mockShowWarningMessage = jest.fn();
const mockShowErrorMessage = jest.fn();
const mockStatusBarItem = {
    show: jest.fn(),
    hide: jest.fn(),
    dispose: jest.fn(),
    text: '',
    command: '',
    backgroundColor: undefined
};
const mockOutputChannel = {
    append: jest.fn(),
    appendLine: jest.fn(),
    dispose: jest.fn()
};

jest.mock('vscode', () => ({
    l10n: {
        t: (str: string, ...args: any[]) => str.replace(/\{(\d+)\}/g, (_, i) => args[i] ?? '')
    },
    window: {
        showInformationMessage: jest.fn(),
        showErrorMessage: mockShowErrorMessage,
        showWarningMessage: mockShowWarningMessage,
        withProgress: jest.fn((options, task) => {
            return task({ report: jest.fn() }, undefined);
        }),
        createOutputChannel: jest.fn(() => mockOutputChannel),
        createStatusBarItem: jest.fn(() => mockStatusBarItem)
    },
    workspace: {
        getConfiguration: mockGetConfiguration
    },
    StatusBarAlignment: { Right: 1 },
    ThemeColor: jest.fn()
}), { virtual: true });

// Import class under test AFTER mocking vscode
import { ProxyManager, ProxyStatus } from '../../proxy/proxyManager';

describe('ProxyManager Tests', () => {
    let context: any;
    let storageRoot: string;
    let proxyManager: ProxyManager;
    let mockSpawn: jest.Mock;

    beforeEach(() => {
        // Mock ExtensionContext
        context = {
            subscriptions: [],
            secrets: {
                get: jest.fn(),
                store: jest.fn(),
                delete: jest.fn()
            },
            extensionUri: { fsPath: '/mock/path' }
        };

        storageRoot = '/mock/storage';

        // Reset mocks
        mockGetConfiguration.mockReset();
        mockShowWarningMessage.mockReset();
        mockShowErrorMessage.mockReset();
        mockExistsSync.mockReset();
        mockMkdirSync.mockReset();
        (mockStatusBarItem.show as jest.Mock).mockClear();

        // Default configuration mock
        mockGetConfiguration.mockReturnValue({
            get: jest.fn((key: string, defaultValue: any) => {
                if (key === 'proxy.enabled') return false;
                if (key === 'proxy.port') return 8317;
                if (key === 'proxy.binaryPath') return '';
                if (key === 'proxy.autoConfig') return false;
                return defaultValue;
            }),
            update: jest.fn()
        });

        // Mock child_process.spawn
        mockSpawn = cp.spawn as unknown as jest.Mock;
        mockSpawn.mockReset();
        mockSpawn.mockImplementation(() => {
            const process = new EventEmitter();
            (process as any).stdout = new EventEmitter();
            (process as any).stderr = new EventEmitter();
            (process as any).kill = jest.fn();
            (process as any).killed = false;
            return process;
        });

        proxyManager = new ProxyManager(context, storageRoot);
    });

    afterEach(() => {
        if (proxyManager) {
            proxyManager.dispose();
        }
        jest.clearAllMocks();
        jest.useRealTimers();
    });

    test('Should initialize with Stopped status', () => {
        assert.strictEqual(proxyManager.status, ProxyStatus.Stopped);
    });

    test('Should check for binary during start', async () => {
        // Mock fs.existsSync to return false (binary missing)
        mockExistsSync.mockReturnValue(false);
        mockShowWarningMessage.mockResolvedValue('Cancel');

        await proxyManager.start();

        assert.strictEqual(proxyManager.status, ProxyStatus.Stopped);
        expect(mockShowWarningMessage).toHaveBeenCalled();
    });

    test('Should start proxy process if binary exists', async () => {
        // Mock fs.existsSync to return true
        mockExistsSync.mockReturnValue(true);

        await proxyManager.start();

        assert.strictEqual(proxyManager.status, ProxyStatus.Starting);
        expect(mockSpawn).toHaveBeenCalled();
    });

    test('Should update status to Running after timeout/check', async () => {
        jest.useFakeTimers();
        mockExistsSync.mockReturnValue(true);

        const startPromise = proxyManager.start();

        // Fast-forward time to bypass the simulated delay
        jest.advanceTimersByTime(2500);
        await startPromise;

        assert.strictEqual(proxyManager.status, ProxyStatus.Running);
    });

    test('Should stop running process', async () => {
        mockExistsSync.mockReturnValue(true);
        jest.useFakeTimers();

        const startPromise = proxyManager.start();
        jest.advanceTimersByTime(2500);
        await startPromise;

        assert.strictEqual(proxyManager.status, ProxyStatus.Running);

        await proxyManager.stop();
        assert.strictEqual(proxyManager.status, ProxyStatus.Stopped);
    });
});
