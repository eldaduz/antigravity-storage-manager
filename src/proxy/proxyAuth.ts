import * as vscode from 'vscode';
import { LocalizationManager } from '../l10n/localizationManager';

// Supported providers from CLIProxyAPIPlus
export enum AIProvider {
    Antigravity = 'antigravity',
    GitHubCopilot = 'github-copilot',
    Gemini = 'gemini',
    Claude = 'claude',
    Kiro = 'kiro', // AWS CodeWhisperer/Kiro
    Qwen = 'qwen'
}

export class ProxyAuthProvider {
    private _secretStorage: vscode.SecretStorage;

    constructor(private context: vscode.ExtensionContext) {
        this._secretStorage = context.secrets;
    }

    /**
     * Initiates the login flow for a specific provider
     */
    public async login(provider: AIProvider) {
        const lm = LocalizationManager.getInstance();

        // Construct standard OAuth URL used by VibeProxy/CLIProxy
        // Usually: http://localhost:8317/v0/oauth/{provider}
        // Assuming proxy is running on configured port

        const config = vscode.workspace.getConfiguration('antigravity-storage-manager');
        const port = config.get<number>('proxy.port', 8317);
        const baseUrl = `http://127.0.0.1:${port}`;

        let loginUrl = '';

        switch (provider) {
            case AIProvider.Antigravity:
                // "Antigravity" in this context often maps to a specific endpoint or provider like 'claude' or 'google' inside the proxy logic
                // Based on VibeProxy, 'Antigravity' uses a specific OAuth flow.
                // Let's assume the endpoint is /v0/oauth/antigravity (or mapped to a real provider)
                loginUrl = `${baseUrl}/v0/oauth/antigravity`;
                break;
            case AIProvider.GitHubCopilot:
                loginUrl = `${baseUrl}/v0/oauth/github`;
                break;
            case AIProvider.Kiro:
                loginUrl = `${baseUrl}/v0/oauth/kiro`;
                break;
            default:
                loginUrl = `${baseUrl}/v0/oauth/${provider}`;
                break;
        }

        // Check if proxy is seemingly up (simple fetch or just try open)
        // We just open the browser. The proxy must be running.

        try {
            const success = await vscode.env.openExternal(vscode.Uri.parse(loginUrl));
            if (success) {
                vscode.window.showInformationMessage(lm.t('Browser opened for authentication. Please complete the login there.'));
                // The proxy itself handles the callback and storing the token in its own internal DB/Files usually.
                // VibeProxy/CLIProxy store tokens in ~/.cli-proxy-api/
                // So "login" here is just triggering the flow. The ProxyManager manages the server that *keeps* the tokens.

                // However, if we want to read the status, we might need to query the proxy API.
            } else {
                vscode.window.showErrorMessage(lm.t('Failed to open browser.'));
            }
        } catch (e: any) {
            vscode.window.showErrorMessage(lm.t('Error opening auth URL: {0}. Ensure Proxy is running.', e.message));
        }
    }

    /**
     * Checks if a provider has a valid token (by querying the proxy status API)
     */
    public async checkAuthStatus(_provider: AIProvider): Promise<boolean> {
        // We need to fetch from the proxy API
        // /v0/status or similar
        return false; // Placeholder
    }
}
