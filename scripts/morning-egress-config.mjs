import { resolve4, resolve6 } from 'node:dns/promises';
import { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';
const HOSTS = ['application.futbolbrain.com', 'app.pronosticosmoneytips.com'];
// Generate a reviewable drop-in only; never install it or change a service.
export const morningEgressConfig = async (lookup4 = resolve4, lookup6 = resolve6) => {
    const ips = new Set(['127.0.0.53']);
    for (const host of HOSTS) {
        const answers = await Promise.allSettled([lookup4(host), lookup6(host)]);
        const addresses = answers.filter(x => x.status === 'fulfilled').flatMap(x => x.value);
        if (!addresses.length || addresses.length > 32 || addresses.some(x => !isIP(x))) throw new Error('MORNING_DNS_ALLOWLIST_UNAVAILABLE');
        for (const address of addresses) ips.add(address);
    }
    return ['[Service]', 'IPAddressDeny=any', 'IPAddressAllow=', ...[...ips].sort().map(ip => `IPAddressAllow=${ip}`), ''].join('\n');
};
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(await morningEgressConfig());
