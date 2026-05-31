/**
 * Bus d'événements centralisé pour découpler la simulation de l'interface.
 */
export class EventBus {
    constructor() {
        this.listeners = new Map();
    }

    /**
     * S'abonne à un type d'événement.
     * @param {string} type 
     * @param {Function} callback 
     */
    subscribe(type, callback) {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, []);
        }
        this.listeners.get(type).push(callback);
        
        // Retourne une fonction pour se désabonner facilement
        return () => {
            const callbacks = this.listeners.get(type);
            this.listeners.set(type, callbacks.filter(cb => cb !== callback));
        };
    }

    /**
     * Publie un événement.
     * @param {string} type 
     * @param {Object} detail 
     */
    publish(type, detail = {}) {
        if (!this.listeners.has(type)) return;
        this.listeners.get(type).forEach(callback => {
            callback(detail);
        });
    }
}