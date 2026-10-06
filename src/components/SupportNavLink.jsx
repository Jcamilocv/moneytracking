import React from 'react';
import { MessageCircle } from 'lucide-react';
import { MONEY_TIPS_SUPPORT_TELEGRAM_URL } from '../config/support.js';

export function SupportNavLink({ onClick }) {
    return (
        <a
            href={MONEY_TIPS_SUPPORT_TELEGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onClick}
            title="Soporte"
            aria-label="Soporte (abre Telegram en una nueva pestaña)"
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all text-[var(--text-muted)] hover:bg-[var(--bg-overlay-hover)] hover:text-[var(--text-main)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
            <MessageCircle size={18} className="shrink-0" />
            <span>Soporte</span>
        </a>
    );
}
