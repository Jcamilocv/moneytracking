import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

export class WorkerAlreadyRunningError extends Error {
    constructor(pid, lockPath) {
        super(`Worker already running with PID ${pid} (lockfile: ${lockPath})`);
        this.name = 'WorkerAlreadyRunningError';
        this.pid = pid;
        this.lockPath = lockPath;
    }
}

/**
 * Gestor de bloqueo de instancia única mediante PID lockfile.
 * 
 * Evita la ejecución concurrente accidental de múltiples workers locales
 * que compartan la misma sesión MTProto o compitan por los mismos mensajes.
 */
export class SingleInstanceLock {
    constructor({
        lockPath = resolve(process.cwd(), '.futbolbrain-worker.lock')
    } = {}) {
        this.lockPath = lockPath;
        this.acquired = false;
    }

    /**
     * Intenta adquirir el lockfile.
     * Si ya existe un lockfile, comprueba si el proceso referenciado sigue vivo:
     * - Si está vivo: lanza WorkerAlreadyRunningError.
     * - Si no está vivo (stale lock): lo elimina y adquiere el lock para el PID actual.
     */
    acquire() {
        if (this.acquired) return true;

        if (existsSync(this.lockPath)) {
            let existingPid = null;
            try {
                const content = readFileSync(this.lockPath, 'utf8').trim();
                const parsed = JSON.parse(content);
                existingPid = parsed.pid;
            } catch {
                // Si el fichero está corrupto o es texto plano
                try {
                    existingPid = parseInt(readFileSync(this.lockPath, 'utf8').trim(), 10);
                } catch {
                    existingPid = null;
                }
            }

            if (existingPid && this._isProcessRunning(existingPid)) {
                throw new WorkerAlreadyRunningError(existingPid, this.lockPath);
            }

            // El proceso previo ya no existe (stale lock). Limpiar.
            try {
                unlinkSync(this.lockPath);
            } catch {
                // Ignorar si fue borrado concurrentemente
            }
        }

        const lockData = JSON.stringify({
            pid: process.pid,
            acquiredAt: new Date().toISOString(),
            cwd: process.cwd()
        }, null, 2);

        writeFileSync(this.lockPath, lockData, { flag: 'wx' });
        this.acquired = true;
        return true;
    }

    /**
     * Libera el lockfile si pertenece al proceso actual.
     */
    release() {
        if (!this.acquired && !existsSync(this.lockPath)) return;

        try {
            if (existsSync(this.lockPath)) {
                let existingPid = null;
                try {
                    const parsed = JSON.parse(readFileSync(this.lockPath, 'utf8'));
                    existingPid = parsed.pid;
                } catch {
                    existingPid = null;
                }

                if (existingPid === process.pid || !existingPid) {
                    unlinkSync(this.lockPath);
                }
            }
        } catch {
            // Ignorar errores en limpieza final
        } finally {
            this.acquired = false;
        }
    }

    /**
     * Comprueba de forma segura si un proceso está vivo sin enviar señales letales.
     */
    _isProcessRunning(pid) {
        if (!pid || typeof pid !== 'number' || pid <= 0) return false;
        try {
            // signal 0 comprueba la existencia del proceso
            process.kill(pid, 0);
            return true;
        } catch (err) {
            // ESRCH significa que el proceso no existe
            return err.code === 'EPERM'; // EPERM significa que existe pero no tenemos permisos
        }
    }

    isAcquired() {
        return this.acquired;
    }
}
