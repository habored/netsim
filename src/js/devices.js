import { sameSubnet, normalizeMask, networkAddress, maskPrefixLength, normalizeIPv4Value, normalizeIPv4, ConnectivityError } from "./network-utils.js";
import { Interface } from "./interfaces.js";
import { Firewall } from "./firewall.js"; // Import the new Firewall class
import { StaticNATEngine } from "./nat-engine.js";
import { RouteRedistributor } from "./RouteRedistributor.js";
import { RIPManager } from "./RIPManager.js";

export class Device {
  constructor(id, type, name, editable = false, consoleAccessible = false, interfacesLinkables = false) {
    this.id = id;
    this.type = type;
    this.interfaces = [];
    this.name = name;
    this.editable = Boolean(editable);
    this.consoleAccessible = Boolean(consoleAccessible);
    this.interfacesLinkables = Boolean(interfacesLinkables);
  }

  addInterface(name, ip = null, mask = null, speed = 1, editable = true, linkable = true) {
    const ifaceName = name ?? `eth${this.interfaces.length}`;
    const isLinkable = linkable; 
    const nic = new Interface(
      this,
      ip,
      mask,
      ifaceName,
      speed,
      Boolean(editable),
      Boolean(isLinkable)
    );

    this.interfaces.push(nic);
    return nic;
  }

  getPrimaryInterface() {
    return this.interfaces[0] ?? null;
  }

  getInterfaceByName(name) {
    return this.interfaces.find((iface) => iface.name === name) ?? null;
  }

  getInterfaceByIp(ip) {
    const normalizedIp = typeof ip === 'number' ? ip : normalizeIPv4Value(ip);
    if (normalizedIp === null) {
      return null;
    }

    return this.interfaces.find((iface) => iface.ip === normalizedIp) ?? null;
  }

  ownsIp(ip) {
    return this.getInterfaceByIp(ip) !== null;
  }

  getConfiguredInterfaces() {
    return this.interfaces.filter((iface) => iface.isConfigured() && iface.link !== null);
  }
}

export class Host extends Device {
  constructor(
    name,
    ip = null,
    mask = null,
    gateway = null,
    editable = false,
    interfaceLinkable = false,
    consoleAccessible = false,
    id = null,
    type = "pc"
  ) {
    super(id, type, name, editable, consoleAccessible, interfaceLinkable);

    const nic = this.addInterface("eth0", ip, mask, 1, editable, interfaceLinkable);

    this.id = this.id ?? nic.mac;
    this.gateway = normalizeIPv4Value(gateway);
    this.arpTable = new Map();
    this.pending = new Map();
  }

  getInterface() {
    return this.getPrimaryInterface();
  }

  getMac() {
    return this.getInterface()?.mac ?? null;
  }

  setGateway(gateway) {
    this.gateway = normalizeIPv4Value(gateway);
    return this.gateway;
  }

  isLocal(destIP) {
    const nic = this.getInterface();
    if (!nic?.ip || !nic.mask) {
      return false;
    }

    return sameSubnet(nic.ip, nic.mask, destIP, nic.mask);
  }

  learnArp(ip, mac, outInterface = null) {
    const normalizedIp = normalizeIPv4Value(ip);
    if (normalizedIp === null) {
      return null;
    }

    const entry = {
      ip: normalizedIp,
      mac,
      interfaceName: outInterface?.name ?? this.getInterface()?.name ?? null,
    };

    this.arpTable.set(normalizedIp, entry);
    return entry;
  }

  lookupArp(ip) {
    const normalizedIp = normalizeIPv4Value(ip);
    if (normalizedIp === null) {
      return null;
    }

    return this.arpTable.get(normalizedIp) ?? null;
  }

  queuePending(key, item) {
    const bucket = this.pending.get(key) ?? [];
    bucket.push(item);
    this.pending.set(key, bucket);
  }

  drainPending(key) {
    const bucket = this.pending.get(key) ?? [];
    this.pending.delete(key);
    return bucket;
  }

  getArpEntries() {
    return Array.from(this.arpTable.values());
  }

  resetRuntimeState() {
    this.arpTable.clear();
    this.pending.clear();
  }
}

// DataServer is now just a Host with type "server"
export class DataServer extends Host {
  constructor(
    name,
    ip = null,
    mask = null,
    gateway = null,
    editable = false,
    interfaceLinkable = false,
    consoleAccessible = false,
    id = null
  ) {
    super(name, ip, mask, gateway, editable, interfaceLinkable, consoleAccessible, id, "server"); // Pass "server" as type
  }
}

export class Switch extends Device {
  constructor(
    id,
    name,
    nbPorts = 4,
    editable = false,
    interfaceLinkable = false,
    consoleAccessible = false
  ) {
    super(id, "switch", name, editable, consoleAccessible, interfaceLinkable);

    for (let index = 0; index < nbPorts; index += 1) {
      this.addInterface(`p${index}`, null, null, 1, editable, interfaceLinkable);
    }

    this.macTable = new Map();
  }

  learnMac(mac, nic) {
    const entry = {
      mac,
      interface: nic,
      interfaceName: nic.name,
    };

    this.macTable.set(mac, entry);
    return entry;
  }

  getPortForMac(mac) {
    return this.macTable.get(mac)?.interface ?? null;
  }

  getMacEntries() {
    return Array.from(this.macTable.values());
  }

  resetRuntimeState() {
    this.macTable.clear();
  }
}

export class Router extends Device {
  constructor(
    id,
    name,
    portSpec = 2,
    editable = false,
    interfaceLinkable = false, 
    consoleAccessible = false
  ) {
    super(id, "router", name, editable, consoleAccessible, interfaceLinkable);

    const interfaceConfigs = Array.isArray(portSpec)
      ? portSpec
      : Array.from({ length: portSpec }, () => ({}));

    interfaceConfigs.forEach((config, index) => {
      this.addInterface(
        config.name ?? `eth${index}`,
        config.ip ?? null,
        config.mask ?? null,
        config.speed ?? 1,
        config.editable ?? editable, // Paramètres IP (editable)
        config.linkable ?? interfaceLinkable ?? true 
      );
    });

    this.routingTable = [];
    this.arpTable = new Map();
    this.pending = new Map();

    // Configuration des protocoles
    this.enabledProtocols = ["RIP"]; // RIP par défaut
    this.routingProtocolEditable = false; // Verrouillé par défaut pour sécurité pédagogique
    this.routingTableEditable = false;
    
    // État temporel déterministe
    this.lastTicks = { rip: 0, ripAging: 0, ospfHello: 0, ospfDead: 0 };
    this.currentSimTime = 0; 

    this.firewall = null; // Pas de firewall par défaut
    this.natEngine = new StaticNATEngine();
    this.lastRoutingActivity = { rip: 0, ospf: 0 }; // Timestamps pour les LEDs du canvas
    this.redistributor = new RouteRedistributor();
    this.ripManager = new RIPManager(this);
    this.ospfNeighbors = new Map(); // id -> timestamp du dernier Hello
    this.eventBus = null; // Injecté via SimulationEngine ou Main
  }

  // Méthode pour charger la configuration initiale du JSON
  applyRoutingConfig(config, eventBus = null) {
    if (!config) return;
    if (eventBus) this.eventBus = eventBus;
    
    const hasRouting = !!config.routing;
    const routing = config.routing || {};
    const firewallCfg = config.firewall;

    if (hasRouting) {
      // Si le bloc "routing" est présent, on restaure l'état éditable par défaut (Sandbox / Compatibilité)
      this.routingProtocolEditable = true;
      this.routingTableEditable = true;
      this.enabledProtocols = ["static"];

      if (routing.protocoles) {
        this.enabledProtocols = routing.protocoles.list || ["static"];
        this.routingProtocolEditable = routing.protocoles.editable !== false;
      }
      
      if (routing.table) {
        this.routingTableEditable = routing.table.editable !== false;
        if (routing.table.rows) {
          this.routingTable = []; // Nettoyage avant import
          routing.table.rows.forEach(row => {
            const rawCost = row.cost || row.metric;
            const parsedCost = (rawCost === "" || rawCost === undefined) ? null : parseInt(rawCost, 10);
            this.addRoute(
              row.destinationNetworkIp || row.destination,
              row.networkMask || row.mask,
              row.gateway || row.nextHop || null,
              row.interface || row.outInterface || null,
            (parsedCost === null || isNaN(parsedCost)) ? 1 : parsedCost
            );
          });
        }
      }
    } else {
      // Absence de bloc routing = Verrouillage strict + RIP
      this.routingProtocolEditable = false;
      this.routingTableEditable = false;
      this.enabledProtocols = ["RIP"];
    }

    if (firewallCfg) {
      this.firewall = new Firewall();
      this.firewall.defaultPolicy = firewallCfg.defaultPolicy || 'deny';

      // Import des règles ACL
      if (firewallCfg.accessRules) {
        firewallCfg.accessRules.forEach(rule => {
          this.firewall.addAccessRule(
            rule.src_ip, rule.src_mask, 
            rule.dst_ip, rule.dst_mask, 
            rule.protocols || rule.protocol, 
            rule.action
          );
        });
      }

      // Synchronisation avec le StaticNATEngine O(1)
      if (firewallCfg.natRules) {
        this.natEngine.clearRules();
        firewallCfg.natRules.forEach(rule => {
          try {
            this.natEngine.addRule(rule.public_ip, rule.private_ip);
          } catch (err) {
            if (this.eventBus) {
              this.eventBus.publish('simulation:error', { 
                code: ConnectivityError.NAT_CONFLICT, 
                message: err.message, 
                device: this.name,
                layer: 3
              });
            }
            console.warn(`[NAT Config] Conflit sur ${this.name}: ${err.message}`);
          }
        });
      }
    }

    // Support de la configuration de redistribution
    if (routing.redistribution) {
        Object.entries(routing.redistribution).forEach(([target, sources]) => {
            sources.forEach(src => this.redistributor.enable(src, target));
        });
    }

    this.syncRoutingDaemons();
  }

  /**
   * Pipeline de traitement L3 complet (Netfilter-like).
   * Chaque étape de transformation (NAT, TTL) utilise l'immutabilité du paquet.
   * @param {Packet} packet Paquet entrant (L3)
   * @returns {Object} Résultat de la simulation { action, packet, route, reason, icmpType }
   */
  executePipeline(packet) {
    // 1. Ingress (L2) : Déjà décapsulé par le moteur de simulation avant l'appel.

    // 2. Pre-Routing (DNAT) : IP Publique -> IP Privée
    let currentPacket = this.natEngine.translateInbound(packet);

    // 3. Ingress ACL : Filtrage sur la destination réelle (après DNAT)
    if (this.firewall && this.firewall.check && this.firewall.check(currentPacket) === "deny") {
        return { action: "DROP", reason: "FIREWALL_INGRESS" };
    }

    // 4. Routing Decision : Longest Prefix Match
    const route = this.resolveRoute(currentPacket.destIP);
    if (!route) {
        return { action: "DROP", reason: "NO_ROUTE", icmpType: "destination-unreachable" };
    }

    // 5. TTL Check
    if (currentPacket.ttl <= 1) {
        return { action: "DROP", reason: "TTL_EXPIRED", icmpType: "time-exceeded" };
    }
    // Immutabilité : création d'une copie avec TTL décrémenté
    currentPacket = currentPacket.withTTL(currentPacket.ttl - 1);

    // 6. Egress ACL : Filtrage final avant la sortie
    // (On pourrait ici passer l'interface de sortie au firewall si besoin)
    if (this.firewall && this.firewall.check && this.firewall.check(currentPacket) === "deny") {
        return { action: "DROP", reason: "FIREWALL_EGRESS" };
    }

    // 7. Post-Routing (SNAT) : IP Privée -> IP Publique
    currentPacket = this.natEngine.translateOutbound(currentPacket);

    // 8. Forwarding (L2) : Retourne le paquet final et la route pour encapsulation
    return { action: "FORWARD", packet: currentPacket, route: route };
  }

  /**
   * Vérifie si le routeur doit répondre à une requête ARP.
   * Gère les IP propres aux interfaces et le Proxy ARP pour les IP NATées.
   */
  shouldRespondToArp(targetIP) {
    const ip = typeof targetIP === 'number' ? targetIP : normalizeIPv4Value(targetIP);
    if (this.ownsIp(ip)) return true;
    
    // Proxy ARP : Si on a une règle NAT pour cette IP publique, on répond
    if (this.natEngine && this.natEngine.getPrivateIP(ip) !== null) return true;
    
    return false;
  }

  setProtocols(protocols) {
    this.enabledProtocols = protocols;
    
    // Nettoyage immédiat des routes dont le protocole vient d'être désactivé
    this.routingTable = this.routingTable.filter(r => {
      if (r.kind === "rip" && !this.enabledProtocols.includes("RIP")) return false;
      if (r.kind === "ospf" && !this.enabledProtocols.includes("OSPF")) return false;
      return true;
    });

    this.syncRoutingDaemons();
  }

  syncRoutingDaemons() {
    // Force une annonce immédiate pour accélérer la convergence au démarrage (ignore les timers)
    if (this.enabledProtocols.includes("RIP")) {
      this.broadcastRipUpdate();
    }
    if (this.enabledProtocols.includes("OSPF") && this.eventBus) {
      this.lastRoutingActivity.ospf = Date.now();
      // On déclenche directement l'événement Hello sans passer par runOSPFLogic (verrouillé par le timer à T=0)
      this.eventBus.publish('routingUpdate', { source: this, protocol: 'OSPF_HELLO' });
    }
    this.notifyStateChange();
  }

  /**
   * Réagit immédiatement à la perte physique d'un lien.
   * Priorité : OSPF (Calcul local) -> RIP (Annonce distante)
   */
  handleInterfaceDown(iface) {
    // 1. RIP : On empoisonne les routes AVANT de les supprimer de la table
    // Cela permet au RIPManager de voir quelles routes étaient sur cette interface
    if (this.enabledProtocols.includes("RIP") && this.ripManager) {
      this.ripManager.handleInterfaceDown(iface);
    }

    // 2. OSPF : On supprime les voisins et on nettoie la table
    for (let [routerId, neighbor] of this.ospfNeighbors) {
      if (neighbor.interface === iface) {
        this.ospfNeighbors.delete(routerId);
      }
    }
    this.routingTable = this.routingTable.filter(r => r.outInterface !== iface || r.kind !== "ospf");

    this.notifyStateChange();
  }

  /**
   * Notifie l'UI d'un changement d'état via l'EventBus.
   */
  notifyStateChange() {
    if (this.eventBus) {
      this.eventBus.publish('device:state_changed', { 
        deviceId: this.id, 
        name: this.name,
        routingTable: this.getRoutes() 
      });
    }
  }

  runRIPLogic(now) {
    // Envoi des updates toutes les 30s
    if (now - (this.lastTicks.rip || 0) >= 30000) {
      this.broadcastRipUpdate();
      this.lastTicks.rip = now;
    }

    // Vieillissement des routes toutes les 5s
    if (now - (this.lastTicks.ripAging || 0) >= 5000) {
      if (this.ripManager) this.ripManager.updateAging(now);
      this.lastTicks.ripAging = now;
    }
  }

  broadcastRipUpdate() {
    this.lastRoutingActivity.rip = Date.now();
    if (this.eventBus) {
      this.eventBus.publish('routingUpdate', { source: this, protocol: 'RIP' });
    }
  }

  runOSPFLogic(now) {
    // OSPF Hello toutes les 10s
    if (now - this.lastTicks.ospfHello >= 10000) {
      this.lastRoutingActivity.ospf = Date.now();
      if (this.eventBus) {
        this.eventBus.publish('routingUpdate', { source: this, protocol: 'OSPF_HELLO' });
      }
      this.lastTicks.ospfHello = now;
    }
    
    // Vérification des voisins morts toutes les 5s
    if (now - (this.lastTicks.ospfDead || 0) >= 5000) {
      const DEAD_INTERVAL = 40000; // 40s sans Hello = Voisin mort
      let changed = false;

      for (const [routerId, neighbor] of this.ospfNeighbors) {
        const age = now - (neighbor.lastSeen || 0);
        if (age > DEAD_INTERVAL) {
          const neighborIp = neighbor.ip;
          this.ospfNeighbors.delete(routerId);
          // Purge immédiate des routes OSPF passant par ce voisin
          this.routingTable = this.routingTable.filter(r => 
            r.kind !== "ospf" || r.nextHop !== neighborIp
          );
          changed = true;
        }
      }

      if (changed) this.notifyStateChange();
      this.lastTicks.ospfDead = now;
    }
  }

  update(now) {
    this.currentSimTime = now;
    if (this.enabledProtocols.includes("RIP")) {
      this.runRIPLogic(now);
    }
    if (this.enabledProtocols.includes("OSPF")) {
      this.runOSPFLogic(now);
    }
  }

  resetRuntimeState() {
    super.resetRuntimeState();
    this.ospfNeighbors.clear();
    // Purge des routes dynamiques lors d'un reset de simulation
    this.routingTable = this.routingTable.filter(r => r.kind === "static" || r.kind === "connected");
  }

  //////
  
  addRoute(networkIp, networkMask, nextHop, outInterface, cost = 1, kind = "static", tag = null) {
    const maskInt = typeof networkMask === 'number' ? networkMask : normalizeMask(networkMask);
    const rawNetworkInt = typeof networkIp === 'number' ? networkIp : normalizeIPv4Value(networkIp);
    const nextHopInt = (nextHop === null || typeof nextHop === 'number') ? nextHop : normalizeIPv4Value(nextHop);

    if (maskInt === null || rawNetworkInt === null || (nextHop !== null && nextHopInt === null)) {
      return null;
    }

    const networkInt = (rawNetworkInt & maskInt) >>> 0; // Garantit qu'on stocke l'adresse réseau exacte

    // RÈGLE : Si c'est un réseau directement connecté, on n'ajoute pas de route (le coût 0 est imbattable)
    if (this.getConnectedRoutes().some(r => r.networkIp === networkInt && r.networkMask === maskInt)) {
      return null;
    }

    // TODO 1 : On ne garde QUE la route la moins chère pour une même destination ET le même kind
    const existingIdx = this.routingTable.findIndex(r => 
      r.networkIp === networkInt && 
      r.networkMask === maskInt && 
      r.kind === kind
    );

    if (existingIdx !== -1) {
      const existing = this.routingTable[existingIdx];
      
      // Si la nouvelle route est moins chère (ou rafraîchissement du même voisin), on remplace
      if (cost < existing.cost || (nextHopInt === existing.nextHop && nextHopInt !== null)) {
        existing.cost = cost;
        existing.nextHop = nextHopInt;
        existing.outInterface = outInterface;
        existing.tag = tag;
        existing.lastUpdated = this.currentSimTime;
        return existing;
      } else {
        return this.routingTable[existingIdx]; // On ignore la nouvelle car elle est plus chère ou égale
      }
    }

    const route = {
      networkIp: networkInt,
      networkMask: maskInt,
      nextHop: nextHopInt,
      outInterface,
      cost: kind === "connected" ? 0 : cost,
      kind: kind,
      tag: tag
    };

    this.routingTable.push(route);
    return route;
  }

  getConnectedRoutes() {
    return this.getConfiguredInterfaces().map((iface) => ({
      networkIp: networkAddress(iface.ip, iface.mask),
      networkMask: iface.mask,
      nextHop: null,
      outInterface: iface,
      cost: 0,
      kind: "connected",
    }));
  }

  getRoutes() {
    return [...this.getConnectedRoutes(), ...this.routingTable].sort((a, b) => {
      return maskPrefixLength(b.networkMask) - maskPrefixLength(a.networkMask);
    });
  }

  lookup(destIP) {
    const destInt = typeof destIP === 'number' ? destIP : normalizeIPv4Value(destIP);
    if (destInt === null) {
      return null;
    }

    let bestRoute = null;

    // Distance Administrative (AD) : priorité des protocoles pour le forwarding
    const AD_MAP = {
      connected: 0,
      static: 1,
      ospf: 110,
      rip: 120
    };

    for (const route of this.getRoutes()) {
      if (((destInt & route.networkMask) >>> 0) !== route.networkIp) {
        continue;
      }

      if (!bestRoute) {
        bestRoute = route;
        continue;
      }

      const bestPrefix = maskPrefixLength(bestRoute.networkMask);
      const currentPrefix = maskPrefixLength(route.networkMask);

      if (currentPrefix > bestPrefix) {
        bestRoute = route;
        continue;
      }

      if (currentPrefix === bestPrefix) {
        const currentAD = AD_MAP[route.kind] ?? 255;
        const bestAD = AD_MAP[bestRoute.kind] ?? 255;

        if (currentAD < bestAD) {
          bestRoute = route;
        } else if (currentAD === bestAD) {
          // Même protocole : on compare le coût (métrique)
          const currentCost = route.cost ?? 1;
          const bestCost = bestRoute.cost ?? 1;
          if (currentCost < bestCost) bestRoute = route;
        }
      }
    }

    return bestRoute;
  }

  resolveRoute(destIP) {
    const staticRoute = this.lookup(destIP);

    if (staticRoute) {
      return {
        ...staticRoute,
        outInterface: typeof staticRoute.outInterface === "string"
          ? this.getInterfaceByName(staticRoute.outInterface)
          : staticRoute.outInterface,
      };
    }

    return null;
  }

  learnArp(ip, mac, outInterface = null) {
    const normalizedIp = normalizeIPv4Value(ip);
    if (normalizedIp === null) {
      return null;
    }

    const entry = {
      ip: normalizedIp,
      mac,
      interfaceName: outInterface?.name ?? null,
    };

    this.arpTable.set(normalizedIp, entry);
    return entry;
  }

  lookupArp(ip) {
    const normalizedIp = normalizeIPv4Value(ip);
    if (normalizedIp === null) {
      return null;
    }

    return this.arpTable.get(normalizedIp) ?? null;
  }

  queuePending(key, item) {
    const bucket = this.pending.get(key) ?? [];
    bucket.push(item);
    this.pending.set(key, bucket);
  }

  drainPending(key) {
    const bucket = this.pending.get(key) ?? [];
    this.pending.delete(key);
    return bucket;
  }

  getArpEntries() {
    return Array.from(this.arpTable.values());
  }

  resetRuntimeState() {
    this.arpTable.clear();
    this.pending.clear();
  }
}
