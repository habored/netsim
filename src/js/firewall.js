import { normalizeIPv4Value, normalizeMask, ipToString } from "./network-utils.js";
import { ICMPMessage, Packet } from "./network-core.js";

export class Firewall {
  constructor() {
    this.accessRules = []; // [{ src_ip, src_mask, dst_ip, dst_mask, protocol, action }]
    this.natRules = [];    // [{ public_ip, public_mask, private_ip, private_mask }]
    this.editable = true; // Can firewall rules be edited in UI?
    this.defaultPolicy = 'deny'; // 'deny' (Default Deny) or 'allow' (Default Allow)
  }

  addAccessRule(src_ip, src_mask, dst_ip, dst_mask, protocol, action) {
    const sMask = typeof src_mask === 'number' ? src_mask : normalizeMask(src_mask);
    const dMask = typeof dst_mask === 'number' ? dst_mask : normalizeMask(dst_mask);
    
    const sIpRaw = (src_ip === null || typeof src_ip === 'number') ? src_ip : normalizeIPv4Value(src_ip);
    const dIpRaw = (dst_ip === null || typeof dst_ip === 'number') ? dst_ip : normalizeIPv4Value(dst_ip);

    this.accessRules.push({
      src_ip: (sIpRaw !== null && sMask !== null) ? (sIpRaw & sMask) >>> 0 : sIpRaw,
      src_mask: sMask,
      dst_ip: (dIpRaw !== null && dMask !== null) ? (dIpRaw & dMask) >>> 0 : dIpRaw,
      dst_mask: dMask,
      protocol: (protocol === 'any' || protocol === '') ? null : protocol,
      action: action
    });
  }
  
  clearAccessRules() {
    this.accessRules = [];
  }

  clearNatRules() {
    this.natRules = [];
  }

  addNatRule(public_ip, public_mask, private_ip, private_mask) {
    this.natRules.push({
      public_ip: (public_ip === null || typeof public_ip === 'number') ? public_ip : normalizeIPv4Value(public_ip),
      public_mask: (public_mask === null || typeof public_mask === 'number') ? public_mask : normalizeMask(public_mask),
      private_ip: (private_ip === null || typeof private_ip === 'number') ? private_ip : normalizeIPv4Value(private_ip),
      private_mask: (private_mask === null || typeof private_mask === 'number') ? private_mask : normalizeMask(private_mask)
    });
  }

  _ipMatch(ip, ruleIp, ruleMask) {
    // 1. Si l'IP de la règle est null ou "any", la correspondance est automatique (joker)
    if (ruleIp === null || ruleIp === undefined) return true;

    // 2. Si aucun masque n'est défini, on compare l'IP exacte (Hôte unique)
    if (ruleMask === null || ruleMask === undefined) return (ip >>> 0) === (ruleIp >>> 0);

    // 3. Logique de filtrage réseau : on applique le masque de la règle à l'IP du paquet.
    // Cela permet à une règle '10.0.0.0/8' d'autoriser '10.10.0.1' car la portion réseau match.
    // C'est ce qui permet d'englober tous les sous-réseaux contenus dans la plage.
    return ((ip & ruleMask) >>> 0) === ((ruleIp & ruleMask) >>> 0);
  }

  // Processes a packet against access rules
  // Returns true if allowed, false if denied
  checkAccess(packet) {
    return this.checkAccessExtended(packet).allowed;
  }

  /**
   * Version étendue de checkAccess retournant un objet de diagnostic.
   * Requis par le SimulationEngine.
   */
  checkAccessExtended(packet) {
    // Sécurité : Le trafic Loopback (127.0.0.0/8) est toujours autorisé pour les processus internes
    if (((packet.srcIP >>> 24) === 127) || ((packet.destIP >>> 24) === 127)) {
      return { allowed: true, reason: "trafic local (loopback)" };
    }

    for (let i = 0; i < this.accessRules.length; i++) {
      const rule = this.accessRules[i];
      const srcMatch = this._ipMatch(packet.srcIP, rule.src_ip, rule.src_mask);
      const dstMatch = this._ipMatch(packet.destIP, rule.dst_ip, rule.dst_mask);
      
      const allowedProtocols = Array.isArray(rule.protocol) 
        ? rule.protocol.map(p => p.toUpperCase()) 
        : (rule.protocol ? [rule.protocol.toUpperCase()] : null);
        
      const protoMatch = (allowedProtocols === null || allowedProtocols.includes("ANY") || allowedProtocols.includes(packet.protocol.toUpperCase()));

      if (srcMatch && dstMatch && protoMatch) {
        return {
          allowed: rule.action === 'allow',
          reason: `ACL Rule #${i + 1} (${rule.action})`
        };
      }
    }
    return {
      allowed: this.defaultPolicy === 'allow',
      reason: `politique par défaut (${this.defaultPolicy})`
    };
  }

  // Applies NAT translation to a packet based on direction ('inbound' or 'outbound')
  // Returns a NEW Packet instance with translated IPs, or the original packet if no NAT applies.
  applyNat(packet, direction) {
    let newSrcIP = packet.srcIP;
    let newDestIP = packet.destIP;
    let natApplied = false;

    for (const rule of this.natRules) {
      if (direction === 'outbound') {
        if (this._ipMatch(packet.srcIP, rule.private_ip, rule.private_mask)) {
          // Si masques présents des deux côtés : translation de réseau (conserve l'hôte)
          // Sauf si le masque public est /32 (Masquerading vers une IP unique)
          if (rule.public_mask !== null && rule.private_mask !== null && (rule.public_mask >>> 0) !== 0xFFFFFFFF) {
            newSrcIP = ((packet.srcIP & ~rule.private_mask) | (rule.public_ip & rule.public_mask)) >>> 0;
          } else {
            newSrcIP = rule.public_ip;
          }
          natApplied = true;
        }
      } else if (direction === 'inbound') {
        if (this._ipMatch(packet.destIP, rule.public_ip, rule.public_mask)) {
          if (rule.private_mask !== null && rule.public_mask !== null && (rule.public_mask >>> 0) !== 0xFFFFFFFF) {
            newDestIP = ((packet.destIP & ~rule.public_mask) | (rule.private_ip & rule.private_mask)) >>> 0;
          } else {
            newDestIP = rule.private_ip;
          }
          natApplied = true;
        }
      }
      if (natApplied) break;
    }

    if (natApplied) {
      const translatedPacket = new Packet(newSrcIP, newDestIP, packet.content, packet.ttl, packet.protocol);
      // Update ICMP originalDestination if it was part of the NAT
      if (translatedPacket.content instanceof ICMPMessage) {
        if (translatedPacket.content.originalDestination === packet.srcIP) {
          translatedPacket.content.originalDestination = newSrcIP;
        } else if (translatedPacket.content.originalDestination === packet.destIP) {
          translatedPacket.content.originalDestination = newDestIP;
        }
      }
      return translatedPacket;
    }

    return packet; // No NAT applied, return original packet
  }
}