/**
 * Nesiin v1.1 - Source unique pour les utilitaires et constantes réseau
 */

export const ConnectivityError = {
    OK: "OK",
    INVALID_IP: "INVALID_IP",
    INVALID_MASK: "INVALID_MASK",
    INVALID_GATEWAY: "INVALID_GATEWAY",
    INVALID_IP_NORMALIZATION: "INVALID_IP_NORMALIZATION",
    DIFFERENT_NETWORK: "DIFFERENT_NETWORK",
    SAME_IP_CONFLICT: "SAME_IP_CONFLICT",
    NAT_CONFLICT: "NAT_CONFLICT",
    NETWORK_ADDRESS_USED: "NETWORK_ADDRESS_USED",
    INCOMPATIBLE_SUBNET: "INCOMPATIBLE_SUBNET",
    BROADCAST_ADDRESS_USED: "BROADCAST_ADDRESS_USED",
    LOOPBACK_ADDRESS_USED: "LOOPBACK_ADDRESS_USED",
    LINK_LOCAL_ADDRESS_USED: "LINK_LOCAL_ADDRESS_USED",
    MULTICAST_ADDRESS_USED: "MULTICAST_ADDRESS_USED",
    NO_LINK: "NO_LINK",
    INTERFACE_DOWN: "INTERFACE_DOWN",
    DEVICE_OFFLINE: "DEVICE_OFFLINE",
    SWITCH_PORT_DISCONNECTED: "SWITCH_PORT_DISCONNECTED",
    NO_GATEWAY: "NO_GATEWAY",
    GATEWAY_UNREACHABLE: "GATEWAY_UNREACHABLE",
    ROUTER_INTERFACE_MISSING: "ROUTER_INTERFACE_MISSING",
    ROUTER_INTERFACE_MISCONFIGURED: "ROUTER_INTERFACE_MISCONFIGURED",
    NO_ROUTE_TO_HOST: "NO_ROUTE_TO_HOST",
    NEXT_HOP_UNREACHABLE: "NEXT_HOP_UNREACHABLE",
    ROUTING_LOOP: "ROUTING_LOOP",
    TTL_EXPIRED: "TTL_EXPIRED",
    DESTINATION_UNREACHABLE: "DESTINATION_UNREACHABLE",
    UNKNOWN_HOST: "UNKNOWN_HOST"
};

export const IP_VALIDATION_ERROR_MAP = {
    "INVALID_IP_FORMAT": ConnectivityError.INVALID_IP,
    "INVALID_IP_RANGE": ConnectivityError.INVALID_IP,
    "UNSPECIFIED_ADDRESS": ConnectivityError.NETWORK_ADDRESS_USED,
    "BROADCAST_ADDRESS": ConnectivityError.BROADCAST_ADDRESS_USED,
    "LOOPBACK_ADDRESS": ConnectivityError.LOOPBACK_ADDRESS_USED,
    "LINK_LOCAL_ADDRESS": ConnectivityError.LINK_LOCAL_ADDRESS_USED,
    "MULTICAST_ADDRESS": ConnectivityError.MULTICAST_ADDRESS_USED,
    "INVALID_IP_NORMALIZATION": ConnectivityError.INVALID_IP_NORMALIZATION,
};

export const OSPF_COST_MAP = {
    "Fibre optique": 1,
    "5G": 5,
    "Fast Ethernet": 10,
    "Satellite": 100,
    "Bluetooth": 2000,
    "ADSL": 5000,
    "Ethernet": 10000
};

/**
 * Fonctions de base et validations
 */

export function isIPValid(ip) {
    return /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(ip);
}

/**
 * Conversion IP -> Int avec tolérance (utilisé pour les calculs rapides)
 */
export function ipToInt(ip) {
    if (!ip || !isIPValid(ip)) return null;
    return ip.split(".").reduce((acc, octet) => ((acc << 8) + parseInt(octet, 10)) >>> 0, 0);
}

/**
 * Conversion IP -> Int stricte (vérification des octets)
 */
export function ipToIntStrict(ip) {
    if (!ip || !isIPValid(ip)) return null;
    const parts = ip.split(".").map((part) => parseInt(part, 10));
    return (
        ((parts[0] << 24) >>> 0) +
        ((parts[1] << 16) >>> 0) +
        ((parts[2] << 8) >>> 0) +
        (parts[3] >>> 0)
    ) >>> 0;
}

export function intToIp(value) {
    return [
        (value >>> 24) & 0xFF,
        (value >>> 16) & 0xFF,
        (value >>> 8) & 0xFF,
        value & 0xFF,
    ].join(".");
}

export function isMaskContiguous(maskInt) {
    if (maskInt === 0) return true;
    const inverted = (~maskInt) >>> 0;
    return (inverted & (inverted + 1)) === 0;
}

export function validateIPv4(ip) {
    if (!isIPValid(ip)) return { valid: false, code: "INVALID_IP_FORMAT" };
    const octets = ip.split(".").map(Number);
    if (ip === "0.0.0.0") return { valid: false, code: "UNSPECIFIED_ADDRESS" };
    if (ip === "255.255.255.255") return { valid: false, code: "BROADCAST_ADDRESS" };
    if (octets[0] === 127) return { valid: false, code: "LOOPBACK_ADDRESS" };
    if (octets[0] === 169 && octets[1] === 254) return { valid: false, code: "LINK_LOCAL_ADDRESS" };
    if (octets[0] >= 224 && octets[0] <= 239) return { valid: false, code: "MULTICAST_ADDRESS" };
    return { valid: true, code: "OK" };
}

export function validateMask(mask) {
    const trimmed = String(mask || "").trim();
    if (trimmed === "") return { valid: false, code: ConnectivityError.INVALID_MASK, explanation: "Le masque ne peut pas être vide." };
    
    if (trimmed.startsWith("/")) {
        const bits = parseInt(trimmed.slice(1), 10);
        return (bits >= 0 && bits <= 32) 
            ? { valid: true, code: ConnectivityError.OK }
            : { valid: false, code: ConnectivityError.INVALID_MASK, explanation: "Le préfixe CIDR est invalide (0-32)." };
    }

    const maskInt = ipToIntStrict(trimmed);
    if (maskInt === null) {
        return { valid: false, code: ConnectivityError.INVALID_MASK, explanation: "Format de masque invalide." };
    }

    if (!isMaskContiguous(maskInt)) {
        return { valid: false, code: ConnectivityError.INVALID_MASK, explanation: "Le masque n'est pas contigu." };
    }

    return { valid: true, code: ConnectivityError.OK };
}

export function parseMaskToInt(mask) {
    const m = String(mask || "").trim();
    if (m.startsWith("/")) {
        const bits = parseInt(m.slice(1), 10);
        if (bits === 0) return 0;
        if (bits === 32) return 0xFFFFFFFF;
        return (~0 << (32 - bits)) >>> 0;
    }
    return ipToIntStrict(m);
}

export function normalizeIPv4(ip) {
    if (typeof ip === "number") return ip >>> 0;
    return ipToIntStrict(ip);
}

export function normalizeIPv4Value(ip) {
    if (typeof ip === "number") return ip >>> 0;
    return ipToInt(ip);
}

export function normalizeMask(mask) {
    if (typeof mask === "number") return mask >>> 0;
    return parseMaskToInt(mask);
}

export function maskPrefixLength(maskInt) {
    let prefix = 0;
    let remaining = maskInt >>> 0;
    while ((remaining & 0x80000000) !== 0) {
        prefix += 1;
        remaining = (remaining << 1) >>> 0;
    }
    return prefix;
}

export function ipToString(ip) {
    return (ip === null || ip === undefined) ? "" : (typeof ip === "number" ? intToIp(ip) : ip);
}

export function maskToString(mask) {
    return ipToString(mask);
}

export function parseIpSlash(val) {
    const v = (val || "").trim();
    if (!v || v.toLowerCase() === "any") return { ip: null, mask: null };
    const parts = v.split("/");
    const prefix = parts[1] ? parseInt(parts[1], 10) : null;
    // Sécurité Validation du préfixe
    const finalMask = (prefix !== null && !isNaN(prefix) && prefix >= 0 && prefix <= 32) 
        ? "/" + prefix 
        : (parts[1] ? "INVALID" : "255.255.255.255");

    return {
        ip: parts[0].trim(),
        mask: finalMask
    };
}

/**
 * Calcule l'adresse réseau (format entier)
 */
export function networkAddress(ip, mask) {
    const ipInt = normalizeIPv4(ip);
    const maskInt = normalizeMask(mask);
    if (ipInt === null || maskInt === null) return null;
    return (ipInt & maskInt) >>> 0;
}

/**
 * Calcule le premier hôte valide
 */
export function hostMin(ip, mask) {
    const net = networkAddress(ip, mask);
    return net === null ? null : (net + 1) >>> 0;
}

/**
 * Calcule le dernier hôte valide
 */
export function hostMax(ip, mask) {
    const ipInt = normalizeIPv4(ip);
    const maskInt = normalizeMask(mask);
    if (ipInt === null || maskInt === null) return null;
    const netInt = ipInt & maskInt;
    const broadcastInt = netInt | (~maskInt >>> 0);
    return (broadcastInt - netInt <= 1) ? null : (broadcastInt - 1) >>> 0;
}

/**
 * Vérifie si deux IP appartiennent au même sous-réseau
 */
export function sameSubnet(ip1, mask1, ip2, mask2) {
    const n1 = networkAddress(ip1, mask1);
    const n2 = networkAddress(ip2, mask2);
    return n1 !== null && n1 === n2;
}

/**
 * Vérifie si une IP est une adresse d'hôte valide (ni réseau, ni broadcast).
 * @param {string|number} ip 
 * @param {string|number} mask 
 * @returns {boolean}
 */
export function isValidHostIp(ip, mask) {
    const ipL = normalizeIPv4(ip);
    const maskL = normalizeMask(mask);
    if (ipL === null || maskL === null || !isMaskContiguous(maskL)) return false;
    const netL = (ipL & maskL) >>> 0;
    const broadL = (netL | (~maskL)) >>> 0;
    return ipL !== netL && ipL !== broadL;
}

/**
 * Vérifie la cohérence pédagogique d'une interface par rapport à son voisin
 */
export function validateInterfaceConfiguration(iface, network) {
    if (!iface.ip || !iface.mask) return { valid: true, code: ConnectivityError.OK };

    const connectedLink = iface.link;
    if (connectedLink) {
        const otherSide = connectedLink.otherSide(iface);
        if (otherSide && otherSide.ip && otherSide.mask) {
            if (!sameSubnet(iface.ip, iface.mask, otherSide.ip, otherSide.mask) || iface.mask !== otherSide.mask) {
                return { valid: false, code: ConnectivityError.INCOMPATIBLE_SUBNET, explanation: `Configuration de sous-réseau incompatible avec ${otherSide.parentDevice.name}.` };
            }
        }
    }
    return { valid: true, code: ConnectivityError.OK };
}

/**
 * Namespace NetworkUtils pour compatibilité tests et groupement logique
 */
export const NetworkUtils = {
    ipToLong: ipToIntStrict,
    longToIp: intToIp,
    isValidNetmask: (mask) => validateMask(mask).valid,
    isValidHostIp: isValidHostIp,

    /**
     * Détecte si une IP publique est déjà utilisée dans un mapping NAT.
     * type: 'public' ou 'private' pour vérifier la bijectivité.
     */
    hasNatConflict(mappings, ip, type = 'public') {
        const ipL = (typeof ip === "string") ? ipToIntStrict(ip) : (ip >>> 0);
        if (ipL === null) return false;

        return mappings.some(m => {
            // Supporte snake_case (modèle) et camelCase (UI/Tests)
            const val = type === 'public' 
                ? (m.public_ip ?? m.publicIp) 
                : (m.private_ip ?? m.privateIp);
            
            const mIpL = typeof val === "string" ? ipToIntStrict(val) : val;
            return mIpL === ipL;
        });
    }
};