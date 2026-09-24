export const BILLING_PROVIDER_METHODS = Object.freeze([
    'createCheckout',
    'createSubscription',
    'cancelAtPeriodEnd',
    'resumeSubscription',
    'updatePaymentMethod',
    'refund',
    'parseWebhook'
]);

export class BillingProviderNotConfiguredError extends Error {
    constructor(provider, method) {
        super(`El proveedor '${provider}' todavía no tiene '${method}' configurado.`);
        this.name = 'BillingProviderNotConfiguredError';
        this.code = 'billing_provider_not_configured';
    }
}

export const createUnconfiguredBillingProvider = (provider = 'unconfigured') => Object.fromEntries([
    ['provider', provider],
    ...BILLING_PROVIDER_METHODS.map((method) => [method, async () => {
        throw new BillingProviderNotConfiguredError(provider, method);
    }])
]);

export const assertBillingProvider = (provider) => {
    if (!provider || typeof provider !== 'object') throw new Error('Adaptador de facturación no válido.');
    for (const method of BILLING_PROVIDER_METHODS) {
        if (typeof provider[method] !== 'function') throw new Error(`Falta ${method} en el adaptador de facturación.`);
    }
    return provider;
};
