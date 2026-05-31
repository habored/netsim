import { normalizeIPv4Value, NetworkUtils } from "./network-utils.js";

/**
 * Moteur NAT Statique - Simule un comportement de routeur avec translation d'adresse bijective.
 */
export class StaticNATEngine {
    constructor() {
        // Utilisation de deux Maps pour garantir une complexité O(1) en recherche
        this.privateToPublic = new Map(); // Key: Private IP, Value: Public IP
        this.publicToPrivate = new Map(); // Key: Public IP, Value: Private IP
        this.logs = [];
    }

    /**
     * Ajoute une règle NAT statique (bijective).
     * @param {number|string} publicIp 
     * @param {number|string} privateIp 
     * @throws Error en cas de conflit (IP déjà utilisée)
     */
    addRule(publicIp, privateIp) {
        const pub = normalizeIPv4Value(publicIp);
        const priv = normalizeIPv4Value(privateIp);

        const currentMappings = Array.from(this.publicToPrivate.entries()).map(([pu, pr]) => ({ public_ip: pu, private_ip: pr }));

        if (NetworkUtils.hasNatConflict(currentMappings, pub, 'public')) {
            if (this.publicToPrivate.get(pub) !== priv) {
                throw new Error(`IP publique ${publicIp} déjà utilisée.`);
            }
            return; 
        }

        if (NetworkUtils.hasNatConflict(currentMappings, priv, 'private')) {
            throw new Error(`IP privée ${privateIp} déjà mappée.`);
        }

        // Ajout dans les deux tables avec valeurs normalisées
        this.publicToPrivate.set(pub, priv);
        this.privateToPublic.set(priv, pub);
        
        this._log('RULE_ADDED', `Association créée : ${privateIp} <-> ${publicIp}`);
    }

    /**
     * Traduction sortante (Outbound) : IP Privée -> IP Publique (Source NAT)
     * Complexité : O(1)
     * @param {Packet} packet 
     * @returns {Packet} Le paquet traduit (nouvelle instance) ou le paquet original
     */
    translateOutbound(packet) {
        const translatedSrc = this.privateToPublic.get(packet.srcIP);
        
        if (translatedSrc !== undefined) {
            const originalSrc = packet.srcIP;
            // Respect de l'immutabilité : on crée un nouveau paquet
            const translatedPacket = packet.withIPs(translatedSrc, packet.destIP);
            this._log('NAT_OUT', `Translation : ${originalSrc} -> ${translatedSrc} (Dest: ${packet.destIP})`);
            return translatedPacket;
        }
        
        return packet;
    }

    /**
     * Traduction entrante (Inbound) : IP Publique -> IP Privée (Destination NAT)
     * Complexité : O(1)
     * @param {Packet} packet 
     * @returns {Packet} Le paquet traduit (nouvelle instance) ou le paquet original
     */
    translateInbound(packet) {
        const translatedDest = this.publicToPrivate.get(packet.destIP);

        if (translatedDest === undefined) {
            return packet; // Pas de translation nécessaire (ex: trafic vers le routeur lui-même ou routage standard)
        }

        const originalDest = packet.destIP;
        // Respect de l'immutabilité : on crée un nouveau paquet
        const translatedPacket = packet.withIPs(packet.srcIP, translatedDest);
        this._log('NAT_IN', `Translation : ${originalDest} -> ${translatedDest} (Src: ${packet.srcIP})`);
        
        return translatedPacket;
    }

    getPrivateIP(publicIP) {
        return this.publicToPrivate.get(normalizeIPv4Value(publicIP)) ?? null;
    }

    getPublicIP(privateIP) {
        return this.privateToPublic.get(normalizeIPv4Value(privateIP)) ?? null;
    }

    _log(type, message) {
        this.logs.push({
            timestamp: new Date().toISOString(),
            type: type,
            message: message
        });
    }

    getLogs() {
        return this.logs;
    }

    clearRules() {
        this.privateToPublic.clear();
        this.publicToPrivate.clear();
        this.logs = [];
    }
}
