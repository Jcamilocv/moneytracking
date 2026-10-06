import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { MONEY_TIPS_SUPPORT_TELEGRAM_URL } from '../src/config/support.js';

test('la URL oficial de soporte de Money Tips está configurada autoritativamente', () => {
    assert.equal(MONEY_TIPS_SUPPORT_TELEGRAM_URL, 'https://t.me/Money_Tips_Asistencia');
    assert.match(MONEY_TIPS_SUPPORT_TELEGRAM_URL, /^https:\/\/t\.me\/[A-Za-z0-9_]+$/);
});

test('SupportNavLink incluye protecciones de seguridad y accesibilidad', () => {
    const componentSource = fs.readFileSync(new URL('../src/components/SupportNavLink.jsx', import.meta.url), 'utf8');

    // Nueva pestaña y protecciones noopener noreferrer
    assert.ok(componentSource.includes('target="_blank"'), 'Debe incluir target="_blank"');
    assert.ok(componentSource.includes('rel="noopener noreferrer"'), 'Debe incluir rel="noopener noreferrer"');

    // Accesibilidad y tooltip
    assert.ok(componentSource.includes('title="Soporte"'), 'Debe incluir title="Soporte" para tooltip');
    assert.ok(componentSource.includes('aria-label='), 'Debe incluir aria-label accesible');

    // Iconografía y estilo
    assert.ok(componentSource.includes('MessageCircle'), 'Debe usar el icono MessageCircle');
    assert.ok(componentSource.includes('Soporte'), 'Debe mostrar la etiqueta Soporte');
});

test('src/App.jsx integra SupportNavLink en sidebar de escritorio y menú móvil bajo Configuración', () => {
    const appSource = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

    // Importación del componente
    assert.ok(appSource.includes("import { SupportNavLink } from './components/SupportNavLink.jsx'"), 'Debe importar SupportNavLink');

    // Integración en menú móvil
    const mobileSection = appSource.split('{isMobileMenuOpen &&')[1]?.split('</nav>')[0] || '';
    assert.ok(mobileSection.includes('<SupportNavLink onClick={() => setIsMobileMenuOpen(false)} />'), 'Debe renderizar SupportNavLink en el menú móvil');

    // Integración en sidebar principal de escritorio
    const asideSections = appSource.split('<aside');
    const mainDesktopAside = asideSections[asideSections.length - 1]?.split('</aside>')[0] || '';
    assert.ok(mainDesktopAside.includes('<SupportNavLink />'), 'Debe renderizar SupportNavLink en la barra lateral de escritorio');

    // Confirmación de orden: después de Personalización
    const mobilePersonalizacionIndex = mobileSection.indexOf('Personalización');
    const mobileSupportIndex = mobileSection.indexOf('<SupportNavLink');
    assert.ok(mobilePersonalizacionIndex !== -1 && mobileSupportIndex > mobilePersonalizacionIndex, 'Soporte debe estar después de Personalización en móvil');

    const desktopPersonalizacionIndex = mainDesktopAside.indexOf('Personalización');
    const desktopSupportIndex = mainDesktopAside.indexOf('<SupportNavLink');
    assert.ok(desktopPersonalizacionIndex !== -1 && desktopSupportIndex > desktopPersonalizacionIndex, 'Soporte debe estar después de Personalización en escritorio');
});
