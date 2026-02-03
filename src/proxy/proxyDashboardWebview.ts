
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ProxyManager, ProxyStatus } from './proxyManager';
import { LocalizationManager } from '../l10n/localizationManager';

export class ProxyDashboardWebview {
    public static readonly viewType = 'antigravity.proxyDashboard';
    private _panel: vscode.WebviewPanel | undefined;
    private _disposables: vscode.Disposable[] = [];
    private _authDirWatcher: vscode.FileSystemWatcher | undefined;
    private _refreshDebounceTimeout: NodeJS.Timeout | undefined;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _proxyManager: ProxyManager
    ) { }

    public show() {
        if (this._panel) {
            this._panel.reveal(vscode.ViewColumn.One);
            return;
        }

        const lm = LocalizationManager.getInstance();
        this._panel = vscode.window.createWebviewPanel(
            ProxyDashboardWebview.viewType,
            lm.t('Antigravity Proxy Dashboard'),
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [this._extensionUri]
            }
        );

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'start':
                        await this._proxyManager.start();
                        break;
                    case 'stop':
                        await this._proxyManager.stop();
                        break;
                    case 'install':
                        const confirmInstall = await vscode.window.showWarningMessage(
                            LocalizationManager.getInstance().t('Are you sure you want to re-install the proxy? This will overwrite the existing binary.'),
                            { modal: true },
                            LocalizationManager.getInstance().t('Re-install')
                        );
                        if (confirmInstall === LocalizationManager.getInstance().t('Re-install')) {
                            await this._proxyManager.install();
                        }
                        break;
                    case 'openConfig':
                        this.openConfigFile();
                        break;
                    case 'openLogs':
                        vscode.commands.executeCommand('antigravity-storage-manager.proxy.showLog');
                        break;
                    case 'openWebUi':
                        if (message.url) {
                            vscode.env.openExternal(vscode.Uri.parse(message.url));
                        }
                        break;
                    case 'openExtensionSettings':
                        vscode.commands.executeCommand('workbench.action.openSettings', 'antigravity-storage-manager.proxy');
                        break;
                    case 'copy':
                        if (message.text) {
                            vscode.env.clipboard.writeText(message.text);
                            vscode.window.showInformationMessage(lm.t('Path copied to clipboard'));
                        }
                        break;
                    case 'copyKey':
                        if (message.text) {
                            vscode.env.clipboard.writeText(message.text);
                            vscode.window.showInformationMessage(lm.t('API Key copied to clipboard'));
                        }
                        break;
                    case 'addProvider':
                        this.handleAddProvider(message.providerId, message.data);
                        break;
                    case 'testProvider':
                        this._proxyManager.testProvider(message.providerId, message.data.model);
                        break;
                    case 'loginAntigravity':
                        this._proxyManager.initiateOAuthFlow('antigravity');
                        break;
                    case 'testApiKey':
                        if (message.key) this._proxyManager.testApiKey(message.key);
                        break;
                    case 'editApiKey':
                        if (message.key) this._proxyManager.editApiKey(message.key);
                        break;
                    case 'removeApiKey':
                        if (message.key) {
                            const confirm = await vscode.window.showWarningMessage(
                                lm.t('Are you sure you want to delete this API key?'),
                                { modal: true },
                                lm.t('Delete')
                            );
                            if (confirm === lm.t('Delete')) {
                                this._proxyManager.removeApiKey(message.key);
                            }
                        }
                        break;
                    case 'revealSecret':
                        this._proxyManager.revealSecretKey();
                        break;
                    case 'testProxyConnection':
                        this._proxyManager.testConnection();
                        break;
                    case 'testProviderModel':
                        if (message.providerId && message.model) {
                            this._proxyManager.testProvider(message.providerId, message.model);
                        }
                        break;
                    case 'getSecretKey':
                        this._proxyManager.getManagementKey().then(async key => {
                            if (key) {
                                this._panel?.webview.postMessage({ command: 'secretKey', key });
                            } else {
                                const action = await vscode.window.showWarningMessage(
                                    LocalizationManager.getInstance().t('Could not retrieve management key. It might be hashed and missing from secure storage.'),
                                    LocalizationManager.getInstance().t('Set New Key')
                                );

                                if (action === LocalizationManager.getInstance().t('Set New Key')) {
                                    this.handleChangeManagementKey();
                                }

                                this._panel?.webview.postMessage({ command: 'secretKey', key: '' });
                            }
                        });
                        break;
                    case 'copySecretKey':
                        this._proxyManager.getManagementKey().then(key => {
                            if (key) {
                                vscode.env.clipboard.writeText(key);
                                vscode.window.showInformationMessage(LocalizationManager.getInstance().t('Management Key copied to clipboard!'));
                            }
                        });
                        break;
                    case 'changeManagementKey':
                        this.handleChangeManagementKey();
                        break;
                    case 'generateApiKey':
                        this._proxyManager.generateApiKey();
                        break;
                    case 'toggleApiKey':
                        this._proxyManager.toggleApiKey(message.key);
                        break;
                    case 'toggleAutoStart':
                        this._proxyManager.setAutoStart(message.enabled);
                        break;
                    case 'openAuthFile':
                        const info = this._proxyManager.getProviderAuthInfo(message.provider);
                        if (info) {
                            vscode.workspace.openTextDocument(info.filePath).then(doc => vscode.window.showTextDocument(doc));
                        }
                        break;
                    case 'deleteAuthFile':
                        const confirm = await vscode.window.showWarningMessage(
                            LocalizationManager.getInstance().t('Are you sure you want to sign out from {0}? This will delete the authentication file.', message.provider),
                            { modal: true },
                            LocalizationManager.getInstance().t('Sign Out')
                        );
                        if (confirm === LocalizationManager.getInstance().t('Sign Out')) {
                            this._proxyManager.deleteProviderAuth(message.provider);
                        }
                        break;
                    case 'deleteZai':
                        const confirmZai = await vscode.window.showWarningMessage(
                            LocalizationManager.getInstance().t('Are you sure you want to remove Z.AI configuration?'),
                            { modal: true },
                            LocalizationManager.getInstance().t('Remove')
                        );
                        if (confirmZai === LocalizationManager.getInstance().t('Remove')) {
                            this._proxyManager.deleteZai();
                        }
                        break;
                    case 'toggleZai':
                        this._proxyManager.toggleZai(message.enabled);
                        break;
                    case 'loginCodex':
                        this._proxyManager.initiateOAuthFlow('codex');
                        break;
                    case 'deleteSpecificAuthFile':
                        if (message.provider && message.fileName) {
                            const confirmSpecific = await vscode.window.showWarningMessage(
                                LocalizationManager.getInstance().t('Are you sure you want to delete this account?'),
                                { modal: true },
                                LocalizationManager.getInstance().t('Delete')
                            );
                            if (confirmSpecific === LocalizationManager.getInstance().t('Delete')) {
                                this._proxyManager.deleteSpecificAuthFile(message.provider, message.fileName);
                            }
                        }
                        break;
                    case 'openSpecificAuthFile':
                        if (message.provider && message.fileName) {
                            const allInfos = this._proxyManager.getAllProviderAuthInfos(message.provider);
                            const fileInfo = allInfos.find(i => i.fileName === message.fileName);
                            if (fileInfo) {
                                vscode.workspace.openTextDocument(fileInfo.filePath).then(doc => vscode.window.showTextDocument(doc));
                            }
                        }
                        break;
                    case 'viewQuota':
                        const config = vscode.workspace.getConfiguration('antigravity-storage-manager');
                        const port = config.get<number>('proxy.port', 8317);
                        // Construct the Management API URL
                        // Assuming the management center has a quota page or we open the main page
                        const quotaUrl = `http://127.0.0.1:${port}/management.html#/quota`;
                        vscode.env.openExternal(vscode.Uri.parse(quotaUrl));
                        break;

                }
            },
            null,
            this._disposables
        );

        // Listen for status changes
        this._proxyManager.onDidChangeStatus(() => {
            this.update();
        }, null, this._disposables);

        // Setup file watcher for auth directory to detect new auth files
        this.setupAuthDirWatcher();

        this.update();

        // Prompt for secret key if empty
        this.promptForSecretKeyIfEmpty();
    }

    private setupAuthDirWatcher() {
        // Dispose existing watcher if any
        if (this._authDirWatcher) {
            this._authDirWatcher.dispose();
            this._authDirWatcher = undefined;
        }

        const authDir = this._proxyManager.getAuthDir();
        if (!authDir) return;

        // Watch for .json files in auth directory
        const pattern = new vscode.RelativePattern(authDir, '*.json');
        this._authDirWatcher = vscode.workspace.createFileSystemWatcher(pattern);

        const debouncedRefresh = () => {
            // Debounce refresh to avoid rapid updates
            if (this._refreshDebounceTimeout) {
                clearTimeout(this._refreshDebounceTimeout);
            }
            this._refreshDebounceTimeout = setTimeout(() => {
                this.update();
            }, 1000); // 1 second debounce
        };

        this._authDirWatcher.onDidCreate(debouncedRefresh, null, this._disposables);
        this._authDirWatcher.onDidChange(debouncedRefresh, null, this._disposables);
        this._authDirWatcher.onDidDelete(debouncedRefresh, null, this._disposables);

        this._disposables.push(this._authDirWatcher);
    }

    private async promptForSecretKeyIfEmpty() {
        if (!this._proxyManager.isSecretKeyEmpty()) {
            return;
        }
        const lm = LocalizationManager.getInstance();
        const password = await vscode.window.showInputBox({
            title: lm.t('Set Management Key'),
            prompt: lm.t('The secret-key is empty. Please enter a password for the proxy management key.'),
            password: true,
            ignoreFocusOut: true,
            validateInput: value => {
                if (!value || value.length < 4) {
                    return lm.t('Password must be at least 4 characters');
                }
                return null;
            }
        });
        if (password) {
            const success = await this._proxyManager.setSecretKey(password);
            if (success) {
                vscode.window.showInformationMessage(lm.t('Management key has been set.'));
                this.update();
            }
        }
    }

    private async handleAddProvider(providerId: string, data: any) {
        await this._proxyManager.addProvider(providerId, data);
    }

    private async openConfigFile() {
        // Open the actual config.yaml near the executable
        const exePath = this._proxyManager.getExecutablePath();
        const dir = path.dirname(exePath);
        const configPath = path.join(dir, 'config.yaml');

        if (fs.existsSync(configPath)) {
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(configPath));
            await vscode.window.showTextDocument(doc);
        } else {
            // Fallback to settings
            vscode.commands.executeCommand('workbench.action.openSettings', 'antigravity-storage-manager.proxy');
        }
    }

    private async handleChangeManagementKey() {
        const lm = LocalizationManager.getInstance();
        const newKey = await vscode.window.showInputBox({
            title: lm.t('Set New Management Key'),
            prompt: lm.t('Enter a new secret key for the proxy management interface.'),
            password: true,
            ignoreFocusOut: true,
            validateInput: value => {
                if (!value || value.length < 4) {
                    return lm.t('Key must be at least 4 characters');
                }
                return null;
            }
        });

        if (newKey) {
            const success = await this._proxyManager.updateManagementKey(newKey);
            if (success) {
                const reload = lm.t('Reload Window');
                const result = await vscode.window.showInformationMessage(
                    lm.t('Management Key updated successfully. Please reload the window to apply changes.'),
                    reload
                );
                if (result === reload) {
                    vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
                this.update();
            }
        }
    }

    private update() {
        if (this._panel) {
            this._panel.title = LocalizationManager.getInstance().t('Antigravity Proxy Dashboard');
            this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);
        }
    }

    public dispose() {
        this._panel?.dispose();
        // Clear debounce timeout
        if (this._refreshDebounceTimeout) {
            clearTimeout(this._refreshDebounceTimeout);
            this._refreshDebounceTimeout = undefined;
        }
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
        this._panel = undefined;
    }

    private _getHtmlForWebview(_webview: vscode.Webview): string {
        const lm = LocalizationManager.getInstance();
        const status = this._proxyManager.status;
        const config = vscode.workspace.getConfiguration('antigravity-storage-manager');
        const port = config.get<number>('proxy.port', 8317);
        const autoConfig = config.get<boolean>('proxy.autoConfig', true);
        const autoStart = config.get<boolean>('proxy.enabled', false);
        const binaryPath = this._proxyManager.getExecutablePath();

        const zaiEnabled = this._proxyManager.isZaiEnabled();
        const binaryPathEscaped = binaryPath.replace(/\\/g, '\\\\');

        const apiKeys = this._proxyManager.getApiKeys();
        const visibleKeys = apiKeys.filter(k => k.visible).length;
        const totalKeys = apiKeys.length;

        const antigravityAccounts = this._proxyManager.getAllProviderAuthInfos('antigravity');
        const githubAccounts = this._proxyManager.getAllProviderAuthInfos('github-copilot');
        const codexAccounts = this._proxyManager.getAllProviderAuthInfos('codex');

        // Colors
        const statusColor = status === ProxyStatus.Running ? '#4caf50' :
            status === ProxyStatus.Error ? '#f44336' :
                status === ProxyStatus.Starting ? '#ff9800' : '#757575';

        const webUiUrl = `http://127.0.0.1:${port}/management.html`;

        // SVGs
        const icons = {
            play: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 3L13 8L4 13V3Z" fill="currentColor"/></svg>',
            stop: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="3" width="10" height="10" fill="currentColor"/></svg>',
            browser: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 2C4.69 2 2 4.69 2 8s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm0 11c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z" fill="currentColor"/><path d="M8 4C5.79 4 4 5.79 4 8s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm0 7c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3z" fill="currentColor"/></svg>',
            edit: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12.85 2.15c.2-.2.51-.2.71 0l.29.29c.2.2.2.51 0 .71L5.5 11.5 3 12.5l1-2.5 8.35-8.35v.5zM4.4 10.6l.7.7-6.2 6.2-.7-.7 6.2-6.2z" fill="currentColor"/></svg>',
            gear: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9.1 4.4L8.6 2H7.4l-.5 2.4-.7.3-2-1.3-.9.8 1.3 2-.2.7-2.4.5v1.2l2.4.5.3.8-1.3 2 .8.8 2-1.3.8.3.4 2.4h1.2l.5-2.4.8-.3 2 1.3.8-.8-1.3-2 .3-.7 2.4-.5V7.4l-2.4-.5-.3-.8 1.3-2-.8-.8-2 1.3-.7-.2zM8 11c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3z" fill="currentColor"/></svg>',
            install: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M14 11v2h-2v2h-1v-2H9v-1h2v-2h1v2h2zM10 6.5v3H9v-3H7L10.5 3 14 6.5h-2zM4 3h7v1H4v8h6v1H4a1 1 0 01-1-1V4a1 1 0 011-1z" fill="currentColor"/></svg>',
            logs: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 2H13C13.55 2 14 2.45 14 3V13C14 13.55 13.55 14 13 14H3C2.45 14 2 13.55 2 13V3C2 2.45 2.45 2 3 2ZM11 5H5V6H11V5ZM11 8H5V9H11V8ZM9 11H5V12H9V11Z" fill="currentColor"/></svg>',
            copy: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 4V3H3v7h1v4h7v-1h3V4h-4zm-6 0h5v5H4V4zm6 9H5v-4h5v4zm3-4H9V5h4v4z" fill="currentColor"/></svg>',
            info: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 2C4.69 2 2 4.69 2 8s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm0 11c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-9h-1v2h1V4zm0 3h-1v5h1V7z" fill="currentColor"/></svg>',
            shield: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 1L1 4v5c0 3.86 2.97 7.4 7 8.44 4.03-1.04 7-4.58 7-8.44V4l-7-3zm5 8c0 2.97-2.16 5.36-5 6.22-2.84-.86-5-3.25-5-6.22V5.19l5-2.14 5 2.14V9z" fill="currentColor"/></svg>',
            plus: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M14 7H9V2H7v5H2v2h5v5h2V9h5V7z" fill="currentColor"/></svg>',
            github: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" fill="currentColor"/></svg>',
            sync: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4.6 3.4L2.8 5.2h-.4l1.8-1.8.7-.7.9-.9 2.2 2.2-.7.7-1.5-1.5V11h-1V3.4h-.2zM11.4 12.6l1.8-1.8h.4l-1.8 1.8-.7.7-.9.9-2.2-2.2.7-.7 1.5 1.5V5h1v7.6h.2z" fill="currentColor"/></svg>',
            trash: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M11 1.5v1h3v1h-1v10.5c0 .55-.45 1-1 1H4c-.55 0-1-.45-1-1V3.5H2v-1h3v-1h6zM4.5 13h7V3.5h-7V13zM6 5h1v6H6V5zm3 0h1v6H9V5z" fill="currentColor"/></svg>',
            file: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13.71 4.29l-3-3L10 1H4L3 2v12l1 1h9l1-1V5l-.29-.71zM13 14H4V2h5v4h4v8zm-3-9V2l3 3h-3z" fill="currentColor"/></svg>',
            eye: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 3C4.5 3 1.5 5.5 1.5 8s3 5 6.5 5 6.5-2.5 6.5-5-3-5-6.5-5zM8 11.5c-1.9 0-3.5-1.6-3.5-3.5S6.1 4.5 8 4.5s3.5 1.6 3.5 3.5-1.6 3.5-3.5 3.5zM8 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" fill="currentColor"/></svg>',
            eyeOff: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 3C4.5 3 1.5 5.5 1.5 8c0 .8.3 1.6.8 2.3L3.8 8.8C3.6 8.5 3.5 8.3 3.5 8c0-2.5 2-4.5 4.5-4.5.3 0 .5.04.8.1l1.5-1.5C9.6 3.1 8.8 3 8 3zM14.5 8c0-2.5-1.3-4.6-3.3-5.5l-1 1c1.4.7 2.3 2.2 2.3 4 0 .3 0 .6-.1.8l2.2 2.2c.6-1 .9-2.1.9-3.3zM8 11.5c-1.2 0-2.2-.6-2.9-1.5L6.3 8.8c.4.7 1.1 1.2 1.7 1.2 1.1 0 2-.9 2-2 0-.6-.2-1.1-.6-1.5l1.2-1.2C11.2 6 11.5 6.7 11.5 8c0 1.9-1.6 3.5-3.5 3.5zM2.4 2.8L13.2 13.6 12.5 14.3 1.7 3.5 2.4 2.8z" fill="currentColor"/></svg>',
            antigravity: "<svg version='1.1' xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 64 59'><path d='M0,0 L8,0 L14,4 L19,14 L27,40 L32,50 L36,54 L35,59 L30,59 L22,52 L11,35 L6,33 L-1,34 L-6,39 L-14,52 L-22,59 L-28,59 L-27,53 L-22,47 L-17,34 L-10,12 L-5,3 Z ' fill='%233789F9' transform='translate(28,0)'/><path d='M0,0 L8,0 L14,4 L19,14 L25,35 L21,34 L16,29 L11,26 L7,20 L7,18 L2,16 L-3,15 L-8,18 L-12,19 L-9,9 L-4,2 Z ' fill='%236D80D8' transform='translate(28,0)'/><path d='M0,0 L8,0 L14,4 L19,14 L20,19 L13,15 L10,12 L3,10 L-1,8 L-7,7 L-4,2 Z ' fill='%23D78240' transform='translate(28,0)'/><path d='M0,0 L5,1 L10,4 L12,9 L1,8 L-5,13 L-10,21 L-13,26 L-16,26 L-9,5 L-4,2 Z M6,7 Z ' fill='%233294CC' transform='translate(25,14)'/><path d='M0,0 L5,2 L10,10 L12,18 L5,14 L1,10 L0,4 L-3,3 L0,2 Z ' fill='%23E45C49' transform='translate(36,1)'/><path d='M0,0 L9,1 L12,3 L12,5 L7,6 L4,8 L-1,11 L-5,12 L-2,2 Z ' fill='%2390AE64' transform='translate(21,7)'/><path d='M0,0 L5,1 L5,4 L-2,7 L-7,11 L-11,10 L-9,5 L-4,2 Z ' fill='%2353A89A' transform='translate(25,14)'/><path d='M0,0 L5,0 L16,9 L17,13 L12,12 L8,9 L8,7 L4,5 L0,2 Z ' fill='%23B5677D' transform='translate(33,11)'/><path d='M0,0 L6,0 L14,6 L19,11 L23,12 L22,15 L15,12 L10,8 L10,6 L4,5 Z ' fill='%23778998' transform='translate(27,12)'/><path d='M0,0 L4,2 L-11,17 L-12,14 L-5,4 Z ' fill='%233390DF' transform='translate(26,21)'/><path d='M0,0 L2,1 L-4,5 L-9,9 L-13,13 L-14,10 L-13,7 L-6,4 L-3,1 Z ' fill='%233FA1B7' transform='translate(27,18)'/><path d='M0,0 L4,0 L9,5 L13,6 L12,9 L5,6 L0,2 Z ' fill='%238277BB' transform='translate(37,18)'/><path d='M0,0 L5,1 L7,6 L-2,5 Z M1,4 Z ' fill='%234989CF' transform='translate(30,17)'/><path d='M0,0 L5,1 L2,3 L-3,6 L-7,7 L-6,3 Z ' fill='%2371B774' transform='translate(23,12)'/><path d='M0,0 L7,1 L9,7 L5,6 L0,1 Z ' fill='%236687E9' transform='translate(44,28)'/><path d='M0,0 L7,0 L5,1 L5,3 L8,4 L4,5 L-2,4 Z ' fill='%23C7AF38' transform='translate(23,3)'/><path d='M0,0 L8,0 L8,3 L4,4 L-4,3 Z ' fill='%23EF842A' transform='translate(28,0)'/><path d='M0,0 L7,4 L7,6 L10,6 L11,10 L4,6 L0,2 Z ' fill='%23CD5D67' transform='translate(37,9)'/><path d='M0,0 L5,2 L9,8 L8,11 L2,3 L0,2 Z ' fill='%23F35241' transform='translate(36,1)'/><path d='M0,0 L8,2 L9,6 L4,5 L0,2 Z ' fill='%23A667A2' transform='translate(41,18)'/><path d='M0,0 L9,1 L8,3 L-2,3 Z ' fill='%23A4B34C' transform='translate(21,7)'/><path d='M0,0 L2,0 L7,5 L8,7 L3,6 L0,2 Z ' fill='%23617FCF' transform='translate(35,18)'/><path d='M0,0 L5,2 L8,7 L4,5 L0,2 Z ' fill='%239D7784' transform='translate(33,11)'/><path d='M0,0 L6,2 L6,4 L0,3 Z ' fill='%23BC7F59' transform='translate(31,7)'/></svg>",
            z_ai: `<svg width="24" height="24" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="15" cy="15" r="14.5" stroke="currentColor" stroke-opacity="0.3"/><path d="M9 11H13.5L9.5 17H14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M18 16.5C18 17.3284 17.3284 18 16.5 18C15.6716 18 15 17.3284 15 16.5C15 15.6716 15.6716 15 16.5 15C17.3284 15 18 15.6716 18 16.5Z" fill="currentColor"/><rect x="20" y="11" width="2" height="7" rx="1" fill="currentColor"/><circle cx="21" cy="19.5" r="1" fill="currentColor"/></svg>`,
            chart: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13.5 14h-11C2.22 14 2 13.78 2 13.5V2.5c0-.28.22-.5.5-.5h11c.28 0 .5.22.5.5v11c0 .28-.22.5-.5.5zM3 3v10h10V3H3zm2 9V8h2v4H5zm3 0V5h2v7H8zm3 0v-3h2v3h-2z" fill="currentColor"/></svg>'
        };

        const configuredProviders = this._proxyManager.getConfiguredProviders();
        const zaiKey = this._proxyManager.getZaiKey() || '';
        const zaiModel = this._proxyManager.getZaiModel();

        const getProviderStatus = (id: string) => {
            const isConfigured = configuredProviders.includes(id);
            return `<div class="provider-status ${isConfigured ? 'connected' : 'not-connected'}">
                <div class="status-dot"></div>
                ${isConfigured ? lm.t('Connected') : lm.t('Not Configured')}
            </div>`;
        };

        const keysHtml = apiKeys.length > 0 ? apiKeys.map(k => {
            const keyStr = k.key;
            const isVisible = k.visible;
            const masked = keyStr.length > 8 ? keyStr.substring(0, 4) + '...' + keyStr.substring(keyStr.length - 4) : '****';
            return `<div class="key-row" style="${!isVisible ? 'opacity:0.5;' : ''}">
                <div class="key-value" style="text-decoration:${!isVisible ? 'line-through' : 'none'}">${masked}</div>
                <div style="display:flex; gap:4px">
                    <button class="secondary icon-only" onclick="vscode.postMessage({command: 'toggleApiKey', key: '${keyStr}'})" title="${isVisible ? lm.t('Disable Key') : lm.t('Enable Key')}">${isVisible ? icons.eye : icons.eyeOff}</button>
                    <button class="secondary icon-only" onclick="vscode.postMessage({command: 'testApiKey', key: '${keyStr}'})" title="${lm.t('Test API Key')}">${icons.sync}</button>
                    <button class="secondary icon-only" onclick="vscode.postMessage({command: 'copyKey', text: '${keyStr}'})" title="${lm.t('Copy API Key')}">${icons.copy}</button>
                    <button class="secondary icon-only" onclick="vscode.postMessage({command: 'editApiKey', key: '${keyStr}'})" title="${lm.t('Edit API Key')}">${icons.edit}</button>
                    <button class="secondary icon-only" onclick="vscode.postMessage({command: 'removeApiKey', key: '${keyStr}'})" title="${lm.t('Delete API Key')}">${icons.trash}</button>
                </div>
            </div>`;
        }).join('') : `<div class="key-value">${lm.t('No API keys found')}</div>`;

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${lm.t('Antigravity Proxy Dashboard')}</title>
    <style>
        :root {
            --input-bg: var(--vscode-input-background);
            --input-fg: var(--vscode-input-foreground);
            --input-border: var(--vscode-input-border);
            --card-bg: var(--vscode-editor-inactiveSelectionBackground);
            --badge-bg: var(--vscode-activityBarBadge-background);
            --badge-fg: var(--vscode-activityBarBadge-foreground);
        }
        body {
            font-family: var(--vscode-font-family);
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            padding: 20px;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
            background: var(--vscode-editor-background); 
            border: 1px solid var(--vscode-widget-border);
            border-radius: 8px;
            padding: 24px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            position: relative;
        }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid var(--vscode-widget-border);
            padding-bottom: 20px;
            margin-bottom: 24px;
        }
        h1 { margin: 0; font-size: 1.8em; display: flex; align-items: center; gap: 12px; font-weight: 600; }
        
        /* Glassy Cards */
        .card {
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid var(--vscode-widget-border);
            border-radius: 8px;
            padding: 16px;
            margin-bottom: 16px;
        }
        
        .status-card {
            background: linear-gradient(145deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.01) 100%);
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        
        .section-title {
            font-size: 0.9em;
            text-transform: uppercase;
            letter-spacing: 1px;
            opacity: 0.7;
            margin-bottom: 12px;
            font-weight: 600;
        }

        .provider-status {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 0.8em;
            font-weight: 600;
        }
        .provider-status.connected { color: #4caf50; }
        .provider-status.connected .status-dot { background-color: #4caf50; box-shadow: 0 0 4px #4caf5080; width: 8px; height: 8px; }
        .provider-status.not-connected { color: var(--vscode-descriptionForeground); opacity: 0.8; }
        .provider-status.not-connected .status-dot { background-color: var(--vscode-descriptionForeground); box-shadow: none; width: 8px; height: 8px; }
        .status-indicator {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .status-text {
            font-size: 1.2em;
            font-weight: 600;
            color: ${statusColor};
        }
        .status-dot {
            width: 14px;
            height: 14px;
            border-radius: 50%;
            background-color: ${statusColor};
            box-shadow: 0 0 8px ${statusColor}80;
        }
        .status-text {
            font-weight: 600;
            font-size: 1.2em;
        }

        .actions {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
        }
        
        button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.95em;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            font-weight: 500;
            transition: opacity 0.2s;
        }
        button:hover { opacity: 0.9; }
        button.secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        button.icon-only { padding: 8px; }
        button svg { fill: currentColor; }
        .icon-stroke svg { fill: none; stroke: currentColor; }

        /* Provider Cards */
        button.btn-generate {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px;
            text-align: left;
            line-height: 1.3;
            font-size: 0.9em;
            height: auto;
            justify-content: flex-start;
            margin-top: 16px;
            width: 100%;
        }
        button.btn-generate svg {
            width: 18px;
            height: 18px;
            flex-shrink: 0;
        }

        .providers-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 16px;
        }
        .provider-card {
            background: var(--input-bg);
            border: 1px solid var(--input-border);
            border-radius: 6px;
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 12px;
            transition: transform 0.2s;
        }
        .provider-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        }
        .provider-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-weight: 600;
        }
        .provider-icon {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 1.1em;
        }
        .input-group {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .input-group label {
            font-size: 0.85em;
            opacity: 0.8;
        }
        input[type="text"], input[type="password"] {
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            padding: 8px;
            border-radius: 4px;
            width: 100%;
            box-sizing: border-box;
            font-family: monospace;
        }
        input:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }
        .input-wrapper {
            display: flex;
            gap: 4px;
            align-items: center;
            width: 100%;
        }
        .input-wrapper input {
            flex-grow: 1;
        }
        select {
            background-color: var(--vscode-dropdown-background);
            color: var(--vscode-dropdown-foreground);
            border: 1px solid var(--vscode-dropdown-border);
            padding: 6px 8px;
            border-radius: 4px;
            width: 100%;
            appearance: none;
            cursor: pointer;
            font-family: inherit;
            font-size: 0.9em;
            height: 32px;
        }
        select:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }
        .select-wrapper {
            position: relative;
            width: 100%;
        }
        .select-wrapper::after {
            content: "▼";
            font-size: 0.7em;
            position: absolute;
            right: 10px;
            top: 50%;
            transform: translateY(-50%);
            pointer-events: none;
            color: var(--vscode-dropdown-foreground);
            opacity: 0.8;
        }

        /* Server Info Grid */
        .info-grid {
            display: grid;
            grid-template-columns: 140px 1fr;
            gap: 12px;
            font-size: 0.95em;
            align-items: start;
        }
        .label { font-weight: 600; opacity: 0.7; }
        .value-row {
            display: flex;
            align-items: center;
            gap: 8px;
            width: 100%;
        }
        .value-row button {
            padding: 3px 8px;
            font-size: 0.85em;
        }
        .value-row button.icon-only {
            padding: 3px;
        }
        .code-block {
            font-family: monospace;
            background: var(--vscode-textCodeBlock-background);
            padding: 4px 8px;
            border-radius: 4px;
            word-break: break-all;
            font-size: 0.9em;
            flex-grow: 1;
        }
        
        .keys-list {
            max-height: 120px;
            overflow-y: auto;
            border: 1px solid var(--vscode-widget-border);
            border-radius: 4px;
            padding: 4px;
            background: var(--vscode-editor-inactiveSelectionBackground);
        }
        .key-row {
            display: flex;
            gap: 8px;
            align-items: center;
            margin-bottom: 4px;
        }
        .key-value {
             font-family: monospace;
             background: var(--vscode-textCodeBlock-background);
             padding: 4px 8px;
             border-radius: 4px;
             font-size: 0.85em;
             flex-grow: 1;
        }

        /* Modal */
        .modal {
            display: none;
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-widget-border);
            border-radius: 8px;
            padding: 24px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.5);
            z-index: 100;
            width: 400px;
        }
        .modal.visible { display: block; }
        .modal-overlay {
            display: none;
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.6);
            z-index: 99;
            backdrop-filter: blur(2px);
        }
        .modal-overlay.visible { display: block; }
        .modal h2 { margin-top: 0; border-bottom: 1px solid var(--vscode-widget-border); padding-bottom: 12px; }
        .modal-close { position: absolute; top: 12px; right: 12px; background: none; border: none; font-size: 1.5em; opacity: 0.7; cursor: pointer; }
        
        .tabs { display: flex; gap: 16px; margin-bottom: 16px; border-bottom: 1px solid var(--vscode-widget-border); padding-bottom: 4px; }
        .tab { 
             cursor: pointer; opacity: 0.6; padding-bottom: 4px; border-bottom: 2px solid transparent; transition: all 0.2s;
        }
        .tab:hover { opacity: 1; }
        .tab.active { opacity: 1; border-bottom-color: var(--vscode-activityBarBadge-background); font-weight: bold; }
        .tab-content { display: none; animation: fadeIn 0.3s ease; }
        .tab-content.active { display: block; }
        
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1><span class="icon-stroke">${icons.shield}</span> ${lm.t('Antigravity Proxy Dashboard')}</h1>
            <button class="secondary icon-only" onclick="toggleInfo()" title="${lm.t('Info')}">${icons.info}</button>
        </div>

        <div id="modalOverlay" class="modal-overlay" onclick="toggleInfo()"></div>
        <div id="infoModal" class="modal">
            <button class="modal-close" onclick="toggleInfo()">&times;</button>
            <h2>${lm.t('About Antigravity Proxy')}</h2>
            <p>${lm.t('High-performance local AI proxy supporting multiple providers.')}</p>
            <ul>
                <li>${lm.t('One API key for all providers')}</li>
                <li>${lm.t('Secure local handling')}</li>
                <li>${lm.t('Unified OpenAI-compatible API')}</li>
                <li><strong>${lm.t('Base URL')}:</strong> <code>http://127.0.0.1:${port}/v1</code></li>
                <li><a href="https://github.com/router-for-me/CLIProxyAPIPlus" style="color:var(--vscode-textLink-foreground);">${lm.t('Documentation')}</a></li>
            </ul>
            <div style="margin-top:16px; padding:12px; background:var(--vscode-textBlockQuote-background); border-radius:6px; font-size:0.9em;">
                <strong>${lm.t('Available Endpoints')}:</strong>
                <ul style="margin:8px 0 0 0; padding-left:20px;">
                    <li><code>/v1/chat/completions</code> — ${lm.t('Chat completions (OpenAI format)')}</li>
                    <li><code>/v1/models</code> — ${lm.t('List available models')}</li>
                    <li><code>/v1/embeddings</code> — ${lm.t('Text embeddings')}</li>
                </ul>
                <div style="margin-top:8px; color:var(--vscode-descriptionForeground);">
                    ${lm.t('Model format')}: <code>provider/model-name</code> (${lm.t('e.g.')} <code>z-ai/glm-4-plus</code>)
                </div>
            </div>
             <div style="margin-top:20px; text-align:right;">
                <button onclick="vscode.postMessage({command: 'testProxyConnection'})" style="font-size:0.9em; padding:6px 12px;">${icons.sync} ${lm.t('Check Connection')}</button>
            </div>
        </div>
        
        <div class="card status-card">
            <div class="status-indicator">
                <div class="status-dot"></div>
                <div class="status-text">${status}</div>
            </div>
            <div class="actions">
                ${status === ProxyStatus.Running
                ? `<button class="secondary" onclick="vscode.postMessage({command: 'openWebUi', url: '${webUiUrl}'})">${icons.browser} ${lm.t('Open Web Manager')}</button>
                   <button onclick="vscode.postMessage({command: 'stop'})">${icons.stop} ${lm.t('Stop')}</button>`
                : `<button onclick="vscode.postMessage({command: 'start'})">${icons.play} ${lm.t('Start')}</button>`
            }
            </div>
        </div>

        <div class="section-title" style="margin-top:24px;">${lm.t('Server Information')}</div>
        <div class="card info-grid">
            <div class="label">${lm.t('Port')}</div>
            <div class="value-row">
                <div class="code-block" style="flex-grow:0; min-width:50px; text-align:center;">${port}</div>
                <div class="actions" style="margin-left:auto; margin-bottom:0; gap:4px">
                    <button class="secondary icon-only" style="font-size:0.8em; padding:2px 8px" onclick="vscode.postMessage({command: 'openExtensionSettings'})" title="${lm.t('Extension Settings')}">${icons.gear}</button>
                    <button class="secondary icon-only" style="font-size:0.8em; padding:2px 8px" onclick="vscode.postMessage({command: 'install'})" title="${lm.t('Re-install Proxy')}">${icons.install}</button>
                    <button class="secondary icon-only" style="font-size:0.8em; padding:2px 8px" onclick="vscode.postMessage({command: 'openConfig'})" title="${lm.t('Edit Config')}">${icons.edit}</button>
                    <button class="secondary icon-only" style="font-size:0.8em; padding:2px 8px" onclick="vscode.postMessage({command: 'openLogs'})" title="${lm.t('View Logs')}">${icons.logs}</button>
                </div>
            </div>
            
            <div class="label">${lm.t('Auto-Config')}</div>
            <div class="value-row">
                <div>${autoConfig ? lm.t('Enabled') : lm.t('Disabled')}</div>
                <div class="actions" style="margin-left:auto; margin-bottom:0; display:flex; align-items:center; gap:8px;">
                    <label for="autoStartCheckbox" style="font-size:0.9em; cursor:pointer;">${lm.t('Auto-Start')}</label>
                    <input type="checkbox" id="autoStartCheckbox" ${autoStart ? 'checked' : ''} onchange="toggleAutoStart(this.checked)">
                </div>
            </div>
            
            <div class="label">${lm.t('Binary Path')}</div>
            <div class="value-row">
                <div class="code-block" title="${binaryPath}">${binaryPath}</div>
                <button class="secondary icon-only" onclick="copyPath()">${icons.copy}</button>
            </div>

            <div class="label">${lm.t('Management Key')}</div>
            <div class="value-row">
                 <div id="mgmt-key-container" class="code-block" style="flex-grow:1; color: var(--vscode-descriptionForeground); font-style: italic;">• • • • • • • • • • • •</div>
                 <div style="display:flex; gap:4px">
                    <button id="toggle-mgmt-btn" class="secondary" onclick="toggleManagementKey()" data-state="hidden">${lm.t('Show')}</button>
                    <button class="secondary icon-only" onclick="changeManagementKey()" title="${lm.t('Change Management Key')}">${icons.edit}</button>
                    <button class="secondary icon-only" onclick="copyManagementKey()" title="${lm.t('Copy Management Key')}">${icons.copy}</button>
                 </div>
            </div>

            <div style="grid-column: 1; display: flex; flex-direction: column; justify-content: space-between; height: 100%;">
                <div class="label" style="display:flex; justify-content:space-between; align-items:center;">
                    ${lm.t('API Keys')}
                    <span style="opacity:0.6; font-weight:normal; font-size:0.9em;">${visibleKeys}/${totalKeys}</span>
                </div>
                <button class="secondary btn-generate" onclick="generateApiKey()" title="${lm.t('Generate a new random API key')}">
                    ${icons.plus}
                    <span>Generate New<br/>Key</span>
                </button>
            </div>
            <div class="keys-list" style="width:100%">${keysHtml}</div>
        </div>

        <div class="section-title">${lm.t('Providers Configuration')}</div>
        <div class="providers-grid">
            <!-- Antigravity Card -->
            <div class="provider-card">
                <div class="provider-header">
                    <div class="provider-icon">
                         <span class="provider-logo" style="display:flex;">${icons.antigravity}</span> Antigravity <span style="opacity:0.6; margin-left:8px; font-weight:normal;">(${antigravityAccounts.length})</span>
                    </div>
                    ${getProviderStatus('antigravity')}
                </div>
                ${(() => {
                const accounts = antigravityAccounts;
                if (accounts.length > 0) {
                    return `
                        <div class="accounts-list" style="max-height:150px; overflow-y:auto; display:flex; flex-direction:column; gap:6px;">
                            ${accounts.map(info => `
                                <div style="background:var(--vscode-textBlockQuote-background); padding:8px; border-radius:4px; font-size:0.85em;">
                                    <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                                        <span style="font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1; max-width:140px;" title="${info.fileName}">${info.fileName}</span>
                                        <div style="display:flex; gap:4px;">
                                            <button class="secondary icon-only" style="padding:2px" onclick="viewQuota('antigravity', '${info.fileName}')" title="${lm.t('View Quotas')}">${icons.chart}</button>
                                            <button class="secondary icon-only" style="padding:2px" onclick="openSpecificAuthFile('antigravity', '${info.fileName}')" title="${lm.t('Open File')}">${icons.file}</button>
                                            <button class="secondary icon-only" style="padding:2px; color:var(--vscode-errorForeground);" onclick="deleteSpecificAuthFile('antigravity', '${info.fileName}')" title="${lm.t('Delete')}">${icons.trash}</button>
                                        </div>
                                    </div>
                                    <div style="font-size:0.75em; opacity:0.7; margin-top:2px;">${info.lastModified.toLocaleString()}</div>
                                </div>
                            `).join('')}
                        </div>
                        <div style="margin-top:auto; display:flex; gap:8px; padding-top:12px;">
                            <button class="secondary" style="flex-grow:1" onclick="loginAntigravity()">${icons.plus} ${lm.t('Add Account')}</button>
                        </div>`;
                }
                return `
                    <p style="font-size:0.85em; opacity:0.8; margin: 0 0 16px 0;">${lm.t('Login with Antigravity OAuth.')}</p>
                    <div style="margin-top:auto; display:flex; gap:8px; padding-top:16px">
                        <button class="secondary" style="flex-grow:1" onclick="loginAntigravity()">${lm.t('Login with OAuth')}</button>
                    </div>`;
            })()}
            </div>


            <!-- GitHub Copilot Card -->
            <div class="provider-card">
                <div class="provider-header">
                    <div class="provider-icon">
                         ${icons.github} GitHub Copilot <span style="opacity:0.6; margin-left:8px; font-weight:normal;">(${githubAccounts.length})</span>
                    </div>
                    ${getProviderStatus('github-copilot')}
                </div>
                 ${(() => {
                const accounts = githubAccounts;
                if (accounts.length > 0) {
                    return `
                        <div class="accounts-list" style="max-height:150px; overflow-y:auto; display:flex; flex-direction:column; gap:6px;">
                            ${accounts.map(info => `
                                <div style="background:var(--vscode-textBlockQuote-background); padding:8px; border-radius:4px; font-size:0.85em;">
                                    <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                                        <span style="font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1; max-width:140px;" title="${info.fileName}">${info.fileName}</span>
                                        <div style="display:flex; gap:4px;">
                                            <button class="secondary icon-only" style="padding:2px" onclick="openSpecificAuthFile('github-copilot', '${info.fileName}')" title="${lm.t('Open File')}">${icons.file}</button>
                                            <button class="secondary icon-only" style="padding:2px; color:var(--vscode-errorForeground);" onclick="deleteSpecificAuthFile('github-copilot', '${info.fileName}')" title="${lm.t('Delete')}">${icons.trash}</button>
                                        </div>
                                    </div>
                                    <div style="font-size:0.75em; opacity:0.7; margin-top:2px;">${info.lastModified.toLocaleString()}</div>
                                </div>
                            `).join('')}
                        </div>
                        <div style="margin-top:auto; display:flex; gap:8px; padding-top:12px;">
                            <button class="secondary" style="flex-grow:1" onclick="addProvider('github-copilot')">${icons.plus} ${lm.t('Add Account')}</button>
                        </div>`;
                }
                return `
                    <p style="font-size:0.85em; opacity:0.8; margin: 0 0 16px 0;">${lm.t('Use your GitHub Copilot subscription via Antigravity Proxy.')}</p>
                    <div style="margin-top:auto; display:flex; gap:8px;">
                        <button class="secondary" style="flex:1" onclick="addProvider('github-copilot')">${lm.t('Login with OAuth')}</button>
                    </div>`;
            })()}
            </div>


            <!-- Z.AI Card -->
            <div class="provider-card">
                <div class="provider-header">
                    <div class="provider-icon">
                         <span class="icon-stroke">${icons.z_ai}</span>
                         ${lm.t('Z.AI')}
                    </div>
                    ${getProviderStatus('z-ai')}
                </div>
                <div class="input-group">
                    <label>${lm.t('API Key')}</label>
                     <div class="input-wrapper">
                        <input type="password" id="zai-key" placeholder="sk-..." value="${zaiKey}">
                         <button class="secondary icon-only" onclick="toggleZaiKeyVisibility()" title="${lm.t('Show/Hide')}">
                            <span id="zai-key-icon">${icons.eye}</span>
                        </button>
                        <button class="secondary icon-only" onclick="copyZaiKey()" title="${lm.t('Copy')}">
                            ${icons.copy}
                        </button>
                    </div>
                </div>
                 <div class="input-group" style="margin-top:12px;">
                    <label>${lm.t('Model')}</label>
                    <div style="display:flex; gap:8px; align-items:center;">
                        <div class="select-wrapper" style="flex-grow:1;">
                            <select id="zai-model">
                                <option value="glm-4-plus" ${zaiModel === 'glm-4-plus' ? 'selected' : ''}>GLM-4-Plus</option>
                                <option value="glm-4.7" ${zaiModel === 'glm-4.7' ? 'selected' : ''}>GLM-4.7</option>
                                <option value="glm-4.6" ${zaiModel === 'glm-4.6' ? 'selected' : ''}>GLM-4.6</option>
                            </select>
                        </div>
                        <button class="secondary icon-only" onclick="testSelectedModel()" title="${lm.t('Run Test')}">${icons.sync}</button>
                    </div>
                </div>
                <div style="margin-top:auto; display:flex; gap:8px; padding-top:16px">
                     <button class="secondary" onclick="openUrl('https://z.ai/manage-apikey/apikey-list')">${lm.t('Get Key')}</button>
                     <button style="flex-grow:1" onclick="addZAI()">${lm.t('Save')}</button>
                        <button class="secondary icon-only" onclick="deleteZai()" title="${lm.t('Remove Configuration')}" style="color:var(--vscode-errorForeground); border-color:var(--vscode-errorForeground)">
                            ${icons.trash}
                        </button>
                </div>
            </div>

            <!-- Codex Card -->
            <div class="provider-card">
                <div class="provider-header">
                    <div class="provider-icon">
                        <span class="icon-stroke"><svg version="1.0" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 256.000000 256.000000" preserveAspectRatio="xMidYMid meet"><g transform="translate(0.000000,256.000000) scale(0.100000,-0.100000)" fill="currentColor" stroke="none"><path d="M1107 2290 c-316 -57 -615 -283 -748 -565 -68 -144 -91 -241 -96 -406 -6 -156 7 -249 49 -374 87 -254 291 -478 542 -596 146 -68 226 -84 426 -84 152 0 186 3 260 23 182 50 327 136 465 277 147 150 245 334 282 529 23 123 14 344 -20 456 -35 116 -69 190 -134 290 -131 200 -340 354 -578 426 -78 23 -111 27 -245 30 -85 1 -177 -1 -203 -6z m362 -216 c91 -21 224 -86 310 -152 133 -101 249 -275 293 -439 16 -60 21 -108 21 -203 0 -152 -21 -240 -88 -368 -130 -253 -350 -407 -634 -443 -393 -50 -777 214 -882 607 -30 110 -30 296 0 408 72 270 282 489 552 576 130 41 287 47 428 14z"/><path d="M849 1637 c-31 -24 -52 -67 -46 -95 3 -15 35 -78 71 -139 36 -61 66 -115 66 -119 0 -5 -30 -58 -66 -119 -36 -60 -68 -123 -70 -140 -7 -42 26 -90 70 -105 31 -10 42 -9 72 7 31 15 51 43 125 173 93 162 101 188 73 243 -50 97 -169 289 -185 297 -25 14 -91 12 -110 -3z"/><path d="M1353 1139 c-42 -12 -73 -53 -73 -96 0 -27 8 -43 35 -70 l34 -34 216 3 217 3 30 34 c26 29 29 40 25 73 -7 49 -29 75 -76 88 -45 12 -364 12 -408 -1z"/></g></svg></span>
                        ${lm.t('Codex')} <span style="opacity:0.6; margin-left:8px; font-weight:normal;">(${codexAccounts.length})</span>
                    </div>
                     ${getProviderStatus('codex')}
                </div>
                 ${(() => {
                const accounts = codexAccounts;
                if (accounts.length > 0) {
                    return `
                        <div class="accounts-list" style="max-height:150px; overflow-y:auto; display:flex; flex-direction:column; gap:6px;">
                            ${accounts.map(info => `
                                <div style="background:var(--vscode-textBlockQuote-background); padding:8px; border-radius:4px; font-size:0.85em;">
                                    <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                                        <span style="font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1; max-width:140px;" title="${info.fileName}">${info.fileName}</span>
                                        <div style="display:flex; gap:4px;">
                                            <button class="secondary icon-only" style="padding:2px" onclick="viewQuota('codex', '${info.fileName}')" title="${lm.t('View Quotas')}">${icons.chart}</button>
                                            <button class="secondary icon-only" style="padding:2px" onclick="openSpecificAuthFile('codex', '${info.fileName}')" title="${lm.t('Open File')}">${icons.file}</button>
                                            <button class="secondary icon-only" style="padding:2px; color:var(--vscode-errorForeground);" onclick="deleteSpecificAuthFile('codex', '${info.fileName}')" title="${lm.t('Delete')}">${icons.trash}</button>
                                        </div>
                                    </div>
                                    <div style="font-size:0.75em; opacity:0.7; margin-top:2px;">${info.lastModified.toLocaleString()}</div>
                                </div>
                            `).join('')}
                        </div>
                        <div style="margin-top:auto; display:flex; gap:8px; padding-top:12px;">
                            <button class="secondary" style="flex-grow:1" onclick="loginCodex()">${icons.plus} ${lm.t('Add Account')}</button>
                        </div>`;
                }
                return `
                     <div style="flex-grow:1; display:flex; flex-direction:column; gap:8px;">
                         <div class="code-block" style="font-size:0.8em; margin-bottom:12px; color:var(--vscode-descriptionForeground);">
                            ${lm.t('Sign in with OpenAI Account.')}
                        </div>
                    <div style="margin-top:auto; display:flex; gap:8px;">
                         <button onclick="loginCodex()" style="flex-grow:1">${lm.t('Login with OAuth')}</button>
                    </div>
                    </div>`;
            })()}
            </div>

        </div>



    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function toggleInfo() {
            document.getElementById('infoModal').classList.toggle('visible');
            document.getElementById('modalOverlay').classList.toggle('visible');
        }

        function copyPath() {
            vscode.postMessage({command: 'copy', text: '${binaryPathEscaped}'});
        }
        
        function copyKey(key) {
            vscode.postMessage({command: 'copy', text: key});
        }

        function openUrl(url) {
            vscode.postMessage({command: 'openWebUi', url: url});
        }

        function switchTab(el, id) {
             const parent = el.parentElement;
             Array.from(parent.children).forEach(c => c.classList.remove('active'));
             el.classList.add('active');
             
             const container = parent.parentElement;
             const contents = container.querySelectorAll('.tab-content');
             contents.forEach(c => c.classList.remove('active'));
             document.getElementById(id).classList.add('active');
        }

        function addProvider(id) {
            vscode.postMessage({ command: 'addProvider', providerId: id, data: {} });
        }

        function addZAI() {
            const key = document.getElementById('zai-key').value;
            const model = document.getElementById('zai-model').value;
            if(!key) return;
            vscode.postMessage({ command: 'addProvider', providerId: 'z-ai', data: { apiKey: key, model: model } });
        }
        
        function deleteZai() {
            vscode.postMessage({ command: 'deleteZai' });
        }

        function testSelectedModel() {
            const model = document.getElementById('zai-model').value;
            vscode.postMessage({ command: 'testProviderModel', providerId: 'z-ai', model: model });
        }

        function toggleZaiConfig() {
             const btn = document.getElementById('zai-toggle-btn');
             if (!btn) return;
             const isEnabled = btn.getAttribute('data-enabled') === 'true';
             vscode.postMessage({ command: 'toggleZai', enabled: !isEnabled });
        }

        function toggleZaiKeyVisibility() {
            const input = document.getElementById('zai-key');
            const icon = document.getElementById('zai-key-icon');
            if (input.type === 'password') {
                input.type = 'text';
                icon.innerHTML = '${icons.eyeOff}';
            } else {
                input.type = 'password';
                icon.innerHTML = '${icons.eye}';
            }
        }

        function copyZaiKey() {
            const key = document.getElementById('zai-key').value;
            vscode.postMessage({ command: 'copy', text: key });
        }

        function openAuthFile(provider) {
            vscode.postMessage({ command: 'openAuthFile', provider: provider });
        }

        function deleteAuthFile(provider) {
            vscode.postMessage({ command: 'deleteAuthFile', provider: provider });
        }

        function deleteSpecificAuthFile(provider, fileName) {
            vscode.postMessage({ command: 'deleteSpecificAuthFile', provider: provider, fileName: fileName });
        }

        function openSpecificAuthFile(provider, fileName) {
            vscode.postMessage({ command: 'openSpecificAuthFile', provider: provider, fileName: fileName });
        }

        function viewQuota(provider, fileName) {
            vscode.postMessage({ command: 'viewQuota', provider: provider, fileName: fileName });
        }

        function loginCodex() {
            vscode.postMessage({ command: 'loginCodex' });
        }



        function loginAntigravity() {
            vscode.postMessage({ command: 'loginAntigravity' });
        }

        function toggleAutoStart(enabled) {
            vscode.postMessage({ command: 'toggleAutoStart', enabled: enabled });
        }

        function generateApiKey() {
            vscode.postMessage({ command: 'generateApiKey' });
        }

        function testProvider(providerId) {
             let model = '';
             if(providerId === 'antigravity') {
                 const el = document.getElementById('antigravity-model');
                 model = el ? el.value : 'gemini-3-pro-high';
             } else if (providerId === 'z-ai') {
                 const el = document.getElementById('zai-model');
                 // Default to glm-4-plus as seen in user config
                 model = el ? el.value : 'glm-4-plus';
             } else if (providerId === 'gemini') {
                 const el = document.getElementById('gemini-model');
                 model = el ? el.value : 'gemini-2.0-flash-exp';
             } else if (providerId === 'github-copilot') {
                 model = 'github-copilot/copilot-chat';
             }
             
             vscode.postMessage({ command: 'testProvider', providerId: providerId, data: { model: model } });
        }

        function testSelectedModel(providerId, selectId) {
            const model = document.getElementById(selectId).value;
            vscode.postMessage({ command: 'testProvider', providerId: providerId, data: { model: model } });
        }

        let managementKey = null;

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'secretKey':
                    managementKey = message.key;
                    updateManagementKeyDisplay(true);
                    break;
            }
        });

        function updateManagementKeyDisplay(show) {
            const container = document.getElementById('mgmt-key-container');
            const btn = document.getElementById('toggle-mgmt-btn');
            if (show && managementKey) {
                container.textContent = managementKey;
                container.style.fontStyle = 'normal';
                btn.textContent = '${lm.t('Hide')}';
                btn.setAttribute('data-state', 'visible');
            } else {
                container.textContent = '• • • • • • • • • • • •';
                container.style.fontStyle = 'italic';
                btn.textContent = '${lm.t('Show')}';
                btn.setAttribute('data-state', 'hidden');
            }
        }

        function toggleManagementKey() {
            const btn = document.getElementById('toggle-mgmt-btn');
            const state = btn.getAttribute('data-state');
            if (state === 'hidden') {
                if (!managementKey) {
                    vscode.postMessage({ command: 'getSecretKey' });
                } else {
                    updateManagementKeyDisplay(true);
                }
            } else {
                updateManagementKeyDisplay(false);
            }
        }

        function copyManagementKey() {
            vscode.postMessage({ command: 'copySecretKey' });
        }

        function changeManagementKey() {
            vscode.postMessage({ command: 'changeManagementKey' });
        }

    </script>
</body>
</html>`;
    }
}
