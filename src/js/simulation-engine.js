import { ARPMessage, BROADCAST_MAC, Frame, ICMPMessage, Packet, SegmentTCP, SegmentUDP, Scenario, RIPMessage, OSPFMessage } from "./network-core.js";
import { Host, Router, Switch} from "./devices.js"
import { ipToString, maskToString, normalizeIPv4, normalizeIPv4Value, ConnectivityError, maskPrefixLength, OSPF_COST_MAP, isValidHostIp, normalizeMask } from "./network-utils.js" // Ajout de ConnectivityError
import { Firewall } from "./firewall.js"; // Import Firewall for type checking if needed, but it's on Router

function clonePayload(payload) {
  if (payload instanceof ARPMessage) {
    return new ARPMessage(payload.op, payload.srcIP, payload.srcMAC, payload.targetIP, payload.targetMAC);
  }

  if (payload instanceof RIPMessage) {
    return new RIPMessage(payload.routes.map(r => ({ ...r })));
  }

  if (payload instanceof OSPFMessage) {
    return new OSPFMessage(payload.type, { routerId: payload.routerId, neighbors: [...payload.neighbors] });
  }

  if (payload instanceof ICMPMessage) {
    return new ICMPMessage(payload.type, {
      code: payload.code,
      identifier: payload.identifier,
      sequence: payload.sequence,
      payload: payload.payload,
      originalDestination: payload.originalDestination,
    });
  }

  if (payload instanceof Packet) {
    return new Packet(payload.srcIP, payload.destIP, clonePayload(payload.content), payload.ttl, payload.protocol);
  }

  if (payload instanceof SegmentTCP) {
    return new SegmentTCP(payload.srcPort, payload.destPort, payload.seqNum, payload.ackNum, payload.content);
  }

  if (payload instanceof SegmentUDP) {
    return new SegmentUDP(payload.srcPort, payload.destPort, payload.content);
  }

  return payload;
}

function cloneFrame(frame) {
  return new Frame(frame.srcMac, frame.destMac, clonePayload(frame.content));
}

export class SimulationEngine {
  constructor(network, scenario = null, eventBus = null) {
    this.network = network;
    this.scenario = scenario; 
    this.eventBus = eventBus;
    
    // Gestion du temps logique (Ticks)
    this.isRunning = false;
    this.simTime = 0;
    this.tickRate = 100; // ms

    this.events = [];
    this.timeline = [];
    this.queue = [];
    this.operationCount = 0;
    this.maxOperations = 2048;
    this.icmpIdentifier = 0;
    this.session = null;
    this.currentFocus = null;
    this.validatedPings = new Set(); // État persistant entre les commandes
  }

  /**
   * Démarre la pulsation du temps réseau (convergence RIP/OSPF)
   */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.scheduleTick();
  }

  stop() {
    this.isRunning = false;
  }

  scheduleTick() {
    if (!this.isRunning) return;
    setTimeout(() => {
      this.simTime += this.tickRate;
      this.tick();
      this.scheduleTick();
    }, this.tickRate);
  }

  tick() {
    // Fait avancer chaque équipement de manière déterministe
    this.network.devices.forEach(device => {
      if (device.update) device.update(this.simTime);
    });
  }

  resetState() {
    this.events = [];
    this.timeline = [];
    this.queue = [];
    this.operationCount = 0;
    this.session = null;
    this.currentFocus = null;
    this.clearPendingBuffers();
  }

  resetLearningState() {
    this.resetState();
    this.validatedPings.clear(); // On vide les succès uniquement au reset/changement de défi
    
    for (const device of this.network.devices) {
      if (typeof device.resetRuntimeState === "function") {
        device.resetRuntimeState();
      }
    }
  }

  clearPendingBuffers() {
    for (const device of this.network.devices) {
      if (device instanceof Host || device instanceof Router) {
        device.pending.clear();
      }
    }
  }

  startSession(command, initiator, targetIP = null) {
    this.session = {
      command,
      initiatorId: initiator.id,
      initiatorName: initiator.name, // Pas de changement ici
      targetIP,
      visited: [],
      visitedSet: new Set(),
      replyReceived: false,
      terminalError: null, // Stores the first error encountered
      targetDevice: targetIP === null ? null : this.network.findDeviceByIp(targetIP),
      identifier: ++this.icmpIdentifier,
    };
  }

  markVisited(device) {
    if (!this.session || this.session.visitedSet.has(device.id)) {
      return;
    }

    this.session.visitedSet.add(device.id);
    this.session.visited.push(device.name);
  }

  getNetworkSnapshot() {
    return this.buildSnapshot();
  }

  setFocus(focus) {
    this.currentFocus = focus;
  }

  clearFocus() {
    this.currentFocus = null;
  }

  captureInitialState(command, device) {
    this.timeline.push({
      index: 0,
      event: {
        type: "initial-state",
        actor: device.name,
        command,
        message: `Etat initial avant ${command}.`,
      },
      snapshot: this.buildSnapshot(),
    });
  }

  appendEvent(event) {
    this.events.push(event);
    this.timeline.push({
      index: this.timeline.length,
      event,
      snapshot: this.buildSnapshot(),
    });
    return event;
  }

  recordTrace(layer, actor, message, details = {}) {
    return this.appendEvent({ type: "trace", layer, actor, message, ...details });
  }

  recordInfo(message, details = {}) {
    return this.appendEvent({ type: "info", message, ...details });
  }

  recordError(code, message, payload = {}) {
    const event = { type: "error", code, message, ...payload };
    this.appendEvent(event);

    if (this.session && !this.session.terminalError) {
      this.session.terminalError = event;
    }

    return event;
  }

  recordFlagFound(flag) {
    return this.appendEvent({ type: "flag-found", flag });
  }

  recordPingValidated(flag) {
    if (flag) this.validatedPings.add(flag);
  }

  buildSnapshot() {
    return {
      focus: this.describeFocus(),
      devices: this.network.devices.map((device) => this.describeDeviceState(device)),
      visited: this.session ? [...this.session.visited] : [],
      queueLength: this.queue.length,
      replyReceived: this.session?.replyReceived ?? false,
    };
  }

  describeFocus() {
    if (!this.currentFocus) {
      return null;
    }

    if (this.currentFocus.type === "frame-transmission") {
      return {
        type: "frame-transmission",
        from: this.describeInterfaceRef(this.currentFocus.fromInterface),
        to: this.describeInterfaceRef(this.currentFocus.toInterface),
        frame: this.serializeFrame(this.currentFocus.frame),
      };
    }

    if (this.currentFocus.type === "packet") {
      return {
        type: "packet",
        device: this.describeDeviceRef(this.currentFocus.device),
        inInterface: this.describeInterfaceRef(this.currentFocus.inInterface),
        outInterface: this.describeInterfaceRef(this.currentFocus.outInterface),
        packet: this.serializePayload(this.currentFocus.packet),
      };
    }

    if (this.currentFocus.type === "arp") {
      return {
        type: "arp",
        device: this.describeDeviceRef(this.currentFocus.device),
        inInterface: this.describeInterfaceRef(this.currentFocus.inInterface),
        outInterface: this.describeInterfaceRef(this.currentFocus.outInterface),
        arp: this.serializePayload(this.currentFocus.arp),
      };
    }

    return this.currentFocus;
  }

  describeDeviceRef(device) {
    if (!device) {
      return null;
    }

    return {
      id: device.id,
      name: device.name,
      type: device.type,
    };
  }

  describeInterfaceRef(iface) {
    if (!iface) {
      return null;
    }

    return {
      deviceId: iface.parentDevice.id,
      deviceName: iface.parentDevice.name,
      deviceType: iface.parentDevice.type,
      name: iface.name,
      mac: iface.mac,
      ip: ipToString(iface.ip) || null,
      mask: maskToString(iface.mask) || null,
    };
  }

  describeDeviceState(device) {
    const state = {
      id: device.id,
      name: device.name,
      type: device.type,
      interfaces: device.interfaces.map((iface) => ({
        name: iface.name,
        ip: ipToString(iface.ip) || null,
        mask: maskToString(iface.mask) || null,
        mac: iface.mac,
        peer: iface.link ? this.describeInterfaceRef(iface.link.otherSide(iface)) : null,
      })),
      arpTable: [],
      macTable: [],
      routingTable: [],
    };

    if (device instanceof Host || device instanceof Router) {
      state.arpTable = device.getArpEntries().map((entry) => ({
        ip: ipToString(entry.ip),
        mac: entry.mac,
        interfaceName: entry.interfaceName ?? "?",
      }));
    }

    if (device instanceof Switch) {
      state.macTable = device.getMacEntries().map((entry) => ({
        mac: entry.mac,
        interfaceName: entry.interfaceName,
      }));
    }

    if (device instanceof Router) {
      state.routingTable = device.getRoutes()
        .map((route) => ({
          kind: route.kind,
          networkIp: ipToString(route.networkIp),
          prefix: maskPrefixLength(route.networkMask),
          nextHop: route.nextHop === null ? "direct" : ipToString(route.nextHop),
          outInterface: typeof route.outInterface === "string"
            ? route.outInterface
            : route.outInterface?.name ?? "?",
          cost: route.cost,
        }));
    }

    return state;
  }

  serializeFrame(frame) {
    if (!frame) {
      return null;
    }

    return {
      srcMac: frame.srcMac,
      destMac: frame.destMac,
      payload: this.serializePayload(frame.content),
    };
  }

  serializePayload(payload) {
    if (!payload) {
      return null;
    }

    if (payload instanceof ARPMessage) {
      return {
        kind: "arp",
        op: payload.op,
        srcIP: ipToString(payload.srcIP),
        srcMAC: payload.srcMAC,
        targetIP: ipToString(payload.targetIP),
        targetMAC: payload.targetMAC,
      };
    }

    if (payload instanceof Packet) {
      return {
        kind: "ipv4",
        srcIP: ipToString(payload.srcIP),
        destIP: ipToString(payload.destIP),
        ttl: payload.ttl,
        protocol: payload.protocol,
        content: this.serializePayload(payload.content),
      };
    }

    if (payload instanceof ICMPMessage) {
      return {
        kind: "icmp",
        type: payload.type,
        code: payload.code,
        identifier: payload.identifier,
        sequence: payload.sequence,
        payload: payload.payload,
        originalDestination: payload.originalDestination ? ipToString(payload.originalDestination) : null,
      };
    }

    if (payload instanceof RIPMessage) {
      return {
        kind: "rip",
        routes: payload.routes.map(r => ({
          networkIp: ipToString(r.networkIp),
          networkMask: ipToString(r.networkMask),
          cost: r.cost
        }))
      };
    }

    if (payload instanceof OSPFMessage) {
      return {
        kind: "ospf",
        type: payload.type,
        routerId: payload.routerId,
        neighbors: payload.neighbors
      };
    }

    if (payload instanceof SegmentTCP) {
      return {
        kind: "tcp",
        srcPort: payload.srcPort,
        destPort: payload.destPort,
        seqNum: payload.seqNum,
        ackNum: payload.ackNum,
        flags: { ...payload.flags },
        content: payload.content,
      };
    }

    if (payload instanceof SegmentUDP) {
      return {
        kind: "udp",
        srcPort: payload.srcPort,
        destPort: payload.destPort,
        content: payload.content,
      };
    }

    return {
      kind: "raw",
      value: String(payload),
    };
  }

  executeCommand(device, rawCommand) {
    this.resetState();

    const input = rawCommand.trim();
    if (!input) {
      return this.finishResult(false, null);
    }

    const parts = input.split(/\s+/);
    const command = parts[0].toLowerCase();
    this.captureInitialState(input, device);

    if (command === "help" || command === "?") {
      return this.runHelp(device);
    }

    if (command === "ping") {
      const parsedPing = this.parsePingArguments(parts);
      if (!parsedPing.ok) {
        this.recordError(parsedPing.code, parsedPing.message, parsedPing.payload);
        return this.finishResult(false, null);
      }

      if (!parsedPing.target) {
        this.recordError("usage-ping", "Usage: ping <adresse-ip>");
        return this.finishResult(false, null);
      }

      return this.runPing(device, parsedPing.target, parsedPing.ttl);
    }

    if (command === "arp" && parts[1] === "-a") {
      return this.runShowArp(device);
    }

    if (command === "show") {
      if (parts[1] === "arp") {
        return this.runShowArp(device);
      }

      if (parts[1] === "mac") {
        return this.runShowMac(device);
      }

      if (parts[1] === "route") {
        return this.runShowRoute(device);
      }

      if (parts[1] === "interfaces") {
        return this.runShowInterfaces(device);
      }
    }

    this.recordError("unknown-command", `Commande inconnue: ${parts[0]}`, { command: parts[0] });
    return this.finishResult(false, null);
  }

  runHelp(device) {
    this.clearFocus();
    this.recordInfo(`Commandes disponibles sur ${device.name}:`);
    this.recordInfo("  help : Affiche les commandes disponibles");
    this.recordInfo("  show interfaces : Affiche les informations sur les interfaces (ip, masque, mac, liaison)");

    if (device instanceof Host || device instanceof Router) {
      this.recordInfo("  ping <adresse-ip>");
      this.recordInfo("  ping -i <ttl> <adresse-ip>");
      this.recordInfo("  show arp : Affiche la ");
      this.recordInfo("  arp -a : Affiche la table ARP des associations IP -> MAC");
    }

    if (device instanceof Switch) {
      this.recordInfo("  show mac");
    }

    if (device instanceof Router) {
      this.recordInfo("  show route");
    }

    return this.finishResult(true, null);
  }

  runShowInterfaces(device) {
    this.clearFocus();
    this.recordInfo(`Interfaces de ${device.name}:`);

    for (const iface of device.interfaces) {
      const peer = iface.link?.otherSide(iface);
      const peerLabel = peer ? `${peer.parentDevice.name}.${peer.name}` : "aucun lien";
      this.recordInfo(
        `  ${iface.name}: ip=${ipToString(iface.ip) || "-"} mask=${maskToString(iface.mask) || "-"} mac=${iface.mac} link=${peerLabel}`,
      );
    }

    return this.finishResult(true, null);
  }

  runShowArp(device) {
    this.clearFocus();
    if (!(device instanceof Host || device instanceof Router)) {
      this.recordError("no-arp-table", `${device.name} ne maintient pas de table ARP consultable.`);
      return this.finishResult(false, null);
    }

    const entries = device.getArpEntries();
    this.recordInfo(`Table ARP de ${device.name}:`);

    if (entries.length === 0) {
      this.recordInfo("  aucune entree");
      return this.finishResult(true, null);
    }

    for (const entry of entries) {
      this.recordInfo(`  ${ipToString(entry.ip)} -> ${entry.mac} via ${entry.interfaceName ?? "?"}`);
    }

    return this.finishResult(true, null);
  }

  runShowMac(device) {
    this.clearFocus();
    if (!(device instanceof Switch)) {
      this.recordError("no-mac-table", `${device.name} ne maintient pas de table MAC consultable.`);
      return this.finishResult(false, null);
    }

    const entries = device.getMacEntries();
    this.recordInfo(`Table MAC de ${device.name}:`);

    if (entries.length === 0) {
      this.recordInfo("  aucune entree");
      return this.finishResult(true, null);
    }

    for (const entry of entries) {
      this.recordInfo(`  ${entry.mac} -> ${entry.interfaceName}`);
    }

    return this.finishResult(true, null);
  }

  runShowRoute(device) {
    this.clearFocus();
    if (!(device instanceof Router)) {
      this.recordError("no-routing-table", `${device.name} ne maintient pas de table de routage consultable.`);
      return this.finishResult(false, null);
    }

    const routes = device.getRoutes(); // Déjà trié par Longest Prefix Match dans le modèle

    this.recordInfo(`Table de routage de ${device.name}:`);

    if (routes.length === 0) {
      this.recordInfo("  aucune route");
      return this.finishResult(true, null);
    }

    for (const route of routes) {
      const prefix = maskPrefixLength(route.networkMask);
      const type = { connected: "C", static: "S", rip: "R", ospf: "O" }[route.kind?.toLowerCase()] || { connected: "C", static: "S", rip: "R", ospf: "O" }[route.kind] || "?";
      const nextHop = route.nextHop === null ? "direct" : ipToString(route.nextHop);
      const outInterface = typeof route.outInterface === "string" ? route.outInterface : route.outInterface?.name ?? "?";
      this.recordInfo(
        `  ${type} ${ipToString(route.networkIp)}/${prefix} via ${nextHop} dev ${outInterface} ${route.cost !== null ? 'cost ' + route.cost : ''}`,
      );
    }

    return this.finishResult(true, null);
  }

  parsePingArguments(parts) {
    if (parts.length < 2) {
      return {
        ok: false,
        code: "usage-ping",
        message: "Usage: ping <adresse-ip> ou ping -i <ttl> <adresse-ip>",
      };
    }

    let ttl = 64;
    let target = null;

    for (let index = 1; index < parts.length; index += 1) {
      const token = parts[index].toLowerCase();
      if (token === "-i") {
        const ttlToken = parts[index + 1];
        const parsedTtl = parseInt(ttlToken, 10);
        if (!ttlToken || Number.isNaN(parsedTtl) || parsedTtl < 1 || parsedTtl > 255) {
          return {
            ok: false,
            code: "invalid-ttl",
            message: "TTL invalide. Utilisez une valeur comprise entre 1 et 255.",
          };
        }

        ttl = parsedTtl;
        index += 1;
        continue;
      }

      target = parts[index];
    }

    return { ok: true, ttl, target };
  }

  runPing(device, targetIpText, ttl = 64) {
    const targetIP = normalizeIPv4Value(targetIpText); // Utilise normalizeIPv4Value pour la cible du ping
    if (targetIP === null) {
      this.recordError(ConnectivityError.INVALID_IP, `Adresse cible invalide : '${targetIpText}'`, { input: targetIpText });
      return this.finishResult(false, null);
    }

    if (!(device instanceof Host || device instanceof Router)) {
      this.recordError("host-only", `La commande ping n'est pas supportée par ${device.name}.`);
      return this.finishResult(false, null);
    }

    this.startSession("ping", device, targetIP);
    this.session.requestedTtl = ttl;
    this.markVisited(device);
    this.setFocus({
      type: "packet",
      device,
      outInterface: device.getPrimaryInterface?.() ?? null,
      packet: new Packet(
        device.getPrimaryInterface?.()?.ip ?? null,
        targetIP,
        new ICMPMessage("echo-request", {
          identifier: this.session.identifier,
          sequence: 1,
          payload: "ping",
        }),
        ttl,
        "ICMP",
      ),
    });
    this.recordTrace("CLI", device.name, `Demande ping vers ${ipToString(targetIP)} avec TTL=${ttl}.`);

    if (device.ownsIp(targetIP)) {
      this.recordTrace("L4", device.name, `Ping local sur ${ipToString(targetIP)}.`);
      this.session.replyReceived = true;
      this.session.targetDevice = device; // S'assure que le targetDevice est bien l'hôte lui-même
      this.clearFocus();
      
      const flag = this.checkAndReturnFlag(device.name, device.name); // Vérifie le flag sur soi-même
      if (flag) {
        this.recordPingValidated(flag);
        if (this.eventBus) {
          this.eventBus.publish('pingFlagFound', { 
            flag: flag, 
            allPingsValidated: this.checkAllScenarioPingsValidated() 
          });
        }
      }

      this.recordInfo(`Ping réussi vers ${ipToString(targetIP)}.`);
      this.recordInfo(`Dispositifs visités : ${this.session.visited.join(" -> ")}`);
      return this.finishResult(true, device, flag);
    }

    if (device instanceof Host) {
      const iface = device.getInterface();
      if (!iface?.ip || !iface.mask) {
        this.recordError("source-config-incomplète", `Le PC ${device.name} n'a pas d'adresse IP configurée.`);
        return this.finishResult(false, null);
      }

      // Validation pédagogique de l'IP source (Scénario 02)
      if (!isValidHostIp(iface.ip, iface.mask)) {
        const netL = (iface.ip & iface.mask) >>> 0;
        const isNet = (iface.ip === netL);
        const code = isNet ? ConnectivityError.NETWORK_ADDRESS_USED : ConnectivityError.BROADCAST_ADDRESS_USED;
        const label = isNet ? "du réseau" : "de broadcast";
        
        this.recordError(code, `L'IP ${ipToString(iface.ip)} est l'adresse ${label}.`, { input: ipToString(iface.ip) });
        return this.finishResult(false, null);
      }

      const packet = new Packet(
        iface.ip,
        targetIP,
        new ICMPMessage("echo-request", {
          identifier: this.session.identifier,
          sequence: 1,
          payload: "ping",
        }),
        ttl,
        "ICMP",
      );

      this.sendPacketFromHost(device, packet);
    } else {
      this.sendGeneratedPacketFromRouter(device, targetIP, "echo-request", { ttl });
    }

    this.runQueue();

    if (this.session.replyReceived) {
      this.clearFocus();
      
      // Récupère le nom de la cible depuis la session (établie au début ou à la réception du reply)
      const targetName = this.session.targetDevice ? this.session.targetDevice.name : "";
      const foundFlag = this.checkAndReturnFlag(device.name, targetName);

      this.recordInfo(`Ping réussi vers ${ipToString(targetIP)}.`);
      this.recordInfo(`Dispositifs visités : ${this.session.visited.join(" -> ")}`);
      
      if (foundFlag) {
        this.recordPingValidated(foundFlag);
        this.recordFlagFound(foundFlag);
        if (this.eventBus) {
          this.eventBus.publish('pingFlagFound', { 
            flag: foundFlag, 
            allPingsValidated: this.checkAllScenarioPingsValidated() 
          });
        }
      }
      return this.finishResult(true, this.session.targetDevice, foundFlag);
    }

    if (!this.session.terminalError) {
      this.clearFocus();
      this.recordError("ping-timeout", `Aucune réponse de ${ipToString(targetIP)}.`);
    }

    return this.finishResult(false, this.session.targetDevice, null);
  }

  // New method to check if a successful ping matches a scenario validation
  checkAndReturnFlag(sourceDeviceName, targetDeviceName) {
    // On supprime la vérification de terminalError. Si le ping a abouti, le flag est dû.
    if (!this.scenario || !this.scenario.pingsToValidate) {
      return null;
    }
    const matchedPing = this.scenario.pingsToValidate.find(p =>
      p.sourceDevice === sourceDeviceName && p.targetDevice === targetDeviceName
    );
    return matchedPing ? matchedPing.flag : null;
  }

  // Checks if all pings required for the current scenario have been successfully validated
  checkAllScenarioPingsValidated() {
    if (!this.scenario || !this.scenario.pingsToValidate) {
      return false;
    }
    return this.scenario.pingsToValidate.every(p => this.validatedPings.has(p.flag));
  }

  finishResult(ok, targetDevice, flag = null) {
    return {
      ok,
      received: ok,
      visited: this.session?.visited ?? [],
      events: [...this.events],
      timeline: [...this.timeline],
      snapshot: this.buildSnapshot(),
      targetDevice: targetDevice ?? this.session?.targetDevice ?? null,
      allPingsValidated: this.checkAllScenarioPingsValidated(), // Indicate if all required pings are done
      flag: flag, // Include the found flag in the result
    };
  }

  buildPendingKey(outInterface, nextHopIP) {
    return `${outInterface.name}:${nextHopIP}`;
  }

  enqueueFrame(fromInterface, frame) {
    this.queue.push({ fromInterface, frame });
  }

  runQueue() {
    while (this.queue.length > 0) {
      this.operationCount += 1;
      if (this.operationCount > this.maxOperations) {
        this.recordError("simulation-limit", "Limite de simulation atteinte. Vérifiez la presence d'une boucle de niveau 2.");
        return;
      }

      const transmission = this.queue.shift();
      this.processTransmission(transmission);
    }
  }

  processTransmission({ fromInterface, frame }) {
    if (!fromInterface.link) {
      this.setFocus({
        type: "frame-transmission",
        fromInterface,
        toInterface: null,
        frame,
      });
      this.recordTrace("L1", fromInterface.parentDevice.name, `Aucun lien sur ${fromInterface.name}, trame abandonnee.`, {
        frame: this.serializeFrame(frame),
        from: this.describeInterfaceRef(fromInterface),
        to: null,
      });
      return;
    }

    const toInterface = fromInterface.link.otherSide(fromInterface);
    if (!toInterface) {
      this.setFocus({
        type: "frame-transmission",
        fromInterface,
        toInterface: null,
        frame,
      });
      this.recordTrace("L1", fromInterface.parentDevice.name, `Liaison incomplète sur ${fromInterface.name}.`, {
        frame: this.serializeFrame(frame),
        from: this.describeInterfaceRef(fromInterface),
        to: null,
      });
      return;
    }

    this.setFocus({
      type: "frame-transmission",
      fromInterface,
      toInterface,
      frame,
    });
    this.recordTrace(
      "L1",
      fromInterface.parentDevice.name,
      `Transmission ${fromInterface.name} -> ${toInterface.parentDevice.name}.${toInterface.name}.`,
      {
        frame: this.serializeFrame(frame),
        from: this.describeInterfaceRef(fromInterface),
        to: this.describeInterfaceRef(toInterface),
      },
    );

    this.receiveFrame(toInterface.parentDevice, toInterface, frame);
  }

  receiveFrame(device, inInterface, frame) {
    if (device instanceof Switch) {
      this.markVisited(device);
      this.receiveOnSwitch(device, inInterface, frame);
      return;
    }

    if (device instanceof Router) {
      this.receiveOnRouter(device, inInterface, frame);
      return;
    }

    if (device instanceof Host) {
      this.receiveOnHost(device, inInterface, frame);
    }
  }

  receiveOnSwitch(device, inInterface, frame) {
    const learned = device.learnMac(frame.srcMac, inInterface);
    this.recordTrace("L2", device.name, `Apprentissage MAC ${learned.mac} sur ${learned.interfaceName}.`, {
      frame: this.serializeFrame(frame),
      inInterface: this.describeInterfaceRef(inInterface),
    });

    if (frame.destMac === BROADCAST_MAC) {
      const targets = device.interfaces.filter((iface) => iface !== inInterface && iface.link);
      this.recordTrace(
        "L2",
        device.name,
        `Flood broadcast depuis ${inInterface.name} vers ${targets.map((iface) => iface.name).join(", ") || "aucun port"}.`,
        {
          frame: this.serializeFrame(frame),
          inInterface: this.describeInterfaceRef(inInterface),
          outInterfaces: targets.map((iface) => this.describeInterfaceRef(iface)),
        },
      );

      for (const target of targets) {
        this.enqueueFrame(target, cloneFrame(frame));
      }

      return;
    }

    const outPort = device.getPortForMac(frame.destMac);
    if (!outPort) {
      const targets = device.interfaces.filter((iface) => iface !== inInterface && iface.link);
      this.recordTrace(
        "L2",
        device.name,
        `Destination MAC inconnue ${frame.destMac}, flood vers ${targets.map((iface) => iface.name).join(", ") || "aucun port"}.`,
        {
          frame: this.serializeFrame(frame),
          inInterface: this.describeInterfaceRef(inInterface),
          outInterfaces: targets.map((iface) => this.describeInterfaceRef(iface)),
        },
      );

      for (const target of targets) {
        this.enqueueFrame(target, cloneFrame(frame));
      }

      return;
    }

    if (outPort === inInterface) {
      this.recordTrace("L2", device.name, `Trame filtrée : destination ${frame.destMac} déja sur ${inInterface.name}.`, {
        frame: this.serializeFrame(frame),
        inInterface: this.describeInterfaceRef(inInterface),
      });
      return;
    }

    this.recordTrace("L2", device.name, `Commutation unicast vers ${outPort.name} pour ${frame.destMac}.`, {
      frame: this.serializeFrame(frame),
      inInterface: this.describeInterfaceRef(inInterface),
      outInterface: this.describeInterfaceRef(outPort),
    });
    this.enqueueFrame(outPort, cloneFrame(frame));
  }

  receiveOnHost(device, inInterface, frame) {
    if (frame.destMac !== BROADCAST_MAC && frame.destMac !== inInterface.mac) {
      return;
    }

    if (frame.content instanceof ARPMessage) {
      this.handleArpOnNode(device, inInterface, frame.content);
      return;
    }

    if (frame.content instanceof Packet) {
      this.handleIpOnHost(device, inInterface, frame.content);
    }
  }

  receiveOnRouter(device, inInterface, frame) {
    if (frame.destMac !== BROADCAST_MAC && frame.destMac !== inInterface.mac) {
      return;
    }

    if (frame.content instanceof ARPMessage) {
      this.handleArpOnNode(device, inInterface, frame.content);
      return;
    }

    if (frame.content instanceof Packet) {
      this.handleIpOnRouter(device, inInterface, frame.content);
    }
  }

  handleArpOnNode(device, inInterface, arp) {
    this.setFocus({
      type: "arp",
      device,
      inInterface,
      arp,
    });
    device.learnArp(arp.srcIP, arp.srcMAC, inInterface);
    this.recordTrace("L2", device.name, `ARP appris : ${ipToString(arp.srcIP)} est ${arp.srcMAC} via ${inInterface.name}.`, {
      arp: this.serializePayload(arp),
      inInterface: this.describeInterfaceRef(inInterface),
    });

    if (arp.op === "request") {
      let shouldReply = (inInterface.ip === arp.targetIP);

      // Proxy ARP pour le NAT : le routeur répond si l'IP cible est couverte par une règle NAT
      if (!shouldReply && device instanceof Router && device.firewall) {
        for (const rule of device.firewall.natRules) {
          if (device.firewall._ipMatch(arp.targetIP, rule.public_ip, rule.public_mask)) {
            shouldReply = true;
            break;
          }
        }
      }

      if (shouldReply) {
        this.markVisited(device);
      } else {
        return;
      }

      this.setFocus({
        type: "arp",
        device,
        outInterface: inInterface,
        arp,
      });
      this.recordTrace("L2", device.name, `Réponse ARP : ${ipToString(arp.targetIP)} est ${inInterface.mac}.`, {
        arp: this.serializePayload(arp),
        outInterface: this.describeInterfaceRef(inInterface),
      });
      const reply = new ARPMessage("reply", arp.targetIP, inInterface.mac, arp.srcIP, arp.srcMAC);
      const frame = new Frame(inInterface.mac, arp.srcMAC, reply);
      this.enqueueFrame(inInterface, frame);
      return;
    }

    if (arp.op === "reply") {
      const pendingKey = this.buildPendingKey(inInterface, arp.srcIP);
      const pendingPackets = device.drainPending(pendingKey);

      for (const pending of pendingPackets) {
        this.setFocus({
          type: "arp",
          device,
          outInterface: pending.outInterface,
          arp,
        });
        this.recordTrace("L2", device.name, `ARP résolu pour ${ipToString(arp.srcIP)}, reprise des paquets en attente.`, {
          arp: this.serializePayload(arp),
          outInterface: this.describeInterfaceRef(pending.outInterface),
          packet: this.serializePayload(pending.packet),
        });
        this.encapsulateAndSend(pending.outInterface, arp.srcMAC, pending.packet);
      }
    }
  }

  handleIpOnHost(device, inInterface, packet) {
    this.setFocus({
      type: "packet",
      device,
      inInterface,
      packet,
    });
    const isLimitedBroadcast = packet.destIP === 0xFFFFFFFF;
    const isDirectedBroadcast = inInterface.mask && (packet.destIP === (inInterface.ip | (~inInterface.mask >>> 0)) >>> 0);

    if (packet.destIP !== inInterface.ip && !isLimitedBroadcast && !isDirectedBroadcast) {
      this.recordTrace("L3", device.name, `Paquet IPv4 ignoré, destination ${ipToString(packet.destIP)} non locale.`, {
        packet: this.serializePayload(packet),
        inInterface: this.describeInterfaceRef(inInterface),
      });
      return;
    }

    this.recordTrace(
      "L3",
      device.name,
      `Reception IPv4 ${packet.protocol} ${ipToString(packet.srcIP)} -> ${ipToString(packet.destIP)} TTL=${packet.ttl}.`,
      {
        packet: this.serializePayload(packet),
        inInterface: this.describeInterfaceRef(inInterface),
      },
    );

    if (packet.protocol !== "ICMP" || !(packet.content instanceof ICMPMessage)) {
      return;
    }

    this.handleIcmpForLocalNode(device, inInterface, packet, packet.content);
  }

  handleIpOnRouter(device, inInterface, packet) {
    this.setFocus({
      type: "packet",
      device,
      inInterface,
      packet,
    });

    this.markVisited(device);

    // --- NAT: Inbound (Pre-routing) ---
    let processedPacket = packet;
    const natResultIn = device.natEngine.translateInbound(processedPacket); 
    if (natResultIn !== processedPacket) {
      processedPacket = natResultIn;
      this.recordTrace("L3", device.name, `NAT Inbound : IP destination traduite en ${ipToString(processedPacket.destIP)} (Mapping statique O(1))`, { packet: this.serializePayload(processedPacket) });
    } else if (device.firewall) {
      const originalDest = processedPacket.destIP;
      processedPacket = device.firewall.applyNat(processedPacket, 'inbound');
      if (processedPacket.destIP !== originalDest) {
        this.recordTrace("L3", device.name, `Firewall : NAT Inbound appliqué ${ipToString(originalDest)}->${ipToString(processedPacket.destIP)} sur ${inInterface.name}.`, { packet: this.serializePayload(processedPacket) });
      }
    }

    // --- Firewall: Ingress Access Control ---
    const accessResult = device.firewall ? device.firewall.checkAccessExtended(processedPacket) : { allowed: true };
    if (!accessResult.allowed) {
      this.recordTrace("L3", device.name, `Packet dropped by ${accessResult.reason} on ${inInterface.name}.`, {
        packet: this.serializePayload(processedPacket),
        inInterface: this.describeInterfaceRef(inInterface),
      });
      
      this.recordError("firewall-block", `Packet dropped by ${device.name} (${accessResult.reason})`);

      this.sendGeneratedPacketFromRouter(device, processedPacket.srcIP, "destination-unreachable", { code: 1, originalDestination: processedPacket.destIP }, inInterface);
      return;
    }

    const isLimitedBroadcast = processedPacket.destIP === 0xFFFFFFFF;
    const isDirectedBroadcast = inInterface.mask && (processedPacket.destIP === (inInterface.ip | (~inInterface.mask >>> 0)) >>> 0);

    if (device.ownsIp(processedPacket.destIP) || isLimitedBroadcast || isDirectedBroadcast) {
      this.markVisited(device);
      this.recordTrace(
        "L3",
        device.name,
        `Paquet IPv4 ${(isLimitedBroadcast || isDirectedBroadcast) ? 'Broadcast ' : ''}destiné au routeur sur ${inInterface.name}.`,
        {
          packet: this.serializePayload(processedPacket),
          inInterface: this.describeInterfaceRef(inInterface),
        },
      );

      const payload = processedPacket.content;
      if (processedPacket.protocol === "ICMP" && payload instanceof ICMPMessage) {
        this.handleIcmpForLocalNode(device, inInterface, processedPacket, payload);
      }

      if (payload instanceof RIPMessage && device.enabledProtocols.includes("RIP")) {
        this.handleRipOnRouter(device, inInterface, processedPacket, payload);
      } else if (payload instanceof RIPMessage) {
        this.recordTrace("L4", device.name, "Message RIP ignoré : protocole non activé.");
        }

      if (payload instanceof OSPFMessage && device.enabledProtocols.includes("OSPF")) {
        this.handleOspfOnRouter(device, inInterface, processedPacket, payload);
      } else if (payload instanceof OSPFMessage) {
        this.recordTrace("L4", device.name, "Message OSPF ignoré : protocole non activé.");
      }

      return;
    }

    this.recordTrace(
      "L3",
      device.name,
      `Routage IPv4 ${ipToString(processedPacket.srcIP)} -> ${ipToString(processedPacket.destIP)} TTL=${processedPacket.ttl}.`,
      {
        packet: this.serializePayload(processedPacket),
        inInterface: this.describeInterfaceRef(inInterface),
      },
    );

    if (processedPacket.ttl <= 1) {
      this.recordTrace("L3", device.name, `TTL expiré : le paquet vers ${ipToString(processedPacket.destIP)} est abandonné.`, {
        packet: this.serializePayload(processedPacket),
        inInterface: this.describeInterfaceRef(inInterface),
      });
      this.sendGeneratedPacketFromRouter(device, processedPacket.srcIP, "time-exceeded", {
        code: 0,
        originalDestination: processedPacket.destIP,
      }, inInterface);
      return;
    }

    const forwardedPacket = clonePayload(processedPacket); // Clone the (potentially NAT'd) packet
    forwardedPacket.ttl -= 1;
    this.recordTrace("L3", device.name, `TTL décrementé à ${forwardedPacket.ttl}.`, {
      packet: this.serializePayload(forwardedPacket),
      inInterface: this.describeInterfaceRef(inInterface),
    });

    const route = device.resolveRoute(forwardedPacket.destIP);
    if (!route?.outInterface) {
      this.recordTrace("L3", device.name, `Échec du routage : aucune route vers ${ipToString(forwardedPacket.destIP)}. Paquet abandonné.`, {
        packet: this.serializePayload(forwardedPacket),
        inInterface: this.describeInterfaceRef(inInterface),
      });
      this.sendGeneratedPacketFromRouter(device, packet.srcIP, "destination-unreachable", {
        code: 1, // Administratively prohibited
        originalDestination: processedPacket.destIP, // Use the original destination for the error
      }, inInterface);
      return;
    }

    // --- Firewall: Outbound NAT (Post-routing) ---
    let natPacket = forwardedPacket;
    
    // 1. Essai avec le moteur NAT O(1) unifié
    const natResultOut = device.natEngine.translateOutbound(forwardedPacket);
    if (natResultOut !== forwardedPacket) {
      natPacket = natResultOut;
      this.recordTrace("L3", device.name, `NAT Outbound : IP source traduite en ${ipToString(natPacket.srcIP)} (Mapping statique O(1))`, { packet: this.serializePayload(natPacket) });
    } 
    // 2. Fallback sur le firewall pour le NAT réseau (si implémenté)
    else if (device.firewall) {
      const originalSrc = natPacket.srcIP;
      const originalDest = natPacket.destIP;
      natPacket = device.firewall.applyNat(forwardedPacket, 'outbound');
      if (natPacket.srcIP !== originalSrc || natPacket.destIP !== originalDest) {
        this.recordTrace("L3", device.name, `Firewall : NAT Outbound appliqué ${ipToString(originalSrc)}->${ipToString(natPacket.srcIP)}, ${ipToString(originalDest)}->${ipToString(natPacket.destIP)} sur ${route.outInterface.name}.`, { packet: this.serializePayload(natPacket) });
      }
    }

    const prefix = maskPrefixLength(route.networkMask);
    const nextHop = route.nextHop ?? natPacket.destIP; // Next hop for ARP should be based on the final destination IP
    this.recordTrace(
      "L3",
      device.name,
      `Longest prefix match: ${ipToString(route.networkIp)}/${prefix} via ${route.outInterface.name} next-hop ${ipToString(nextHop)}.`,
      {
        packet: this.serializePayload(natPacket),
        inInterface: this.describeInterfaceRef(inInterface),
        outInterface: this.describeInterfaceRef(route.outInterface),
      },
    );

    this.sendPacketThroughArp(device, route.outInterface, natPacket, nextHop);
  }

  handleIcmpForLocalNode(device, inInterface, packet, icmp) {
    if (icmp.type === "echo-request") {
      this.setFocus({
        type: "packet",
        device,
        inInterface,
      });
      this.recordTrace("L4", device.name, `ICMP echo-request reçu depuis ${ipToString(packet.srcIP)}.`, {
        packet: this.serializePayload(packet),
        inInterface: this.describeInterfaceRef(inInterface),
      });

      if (device instanceof Host) {
        const reply = new Packet(
          inInterface.ip,
          packet.srcIP,
          new ICMPMessage("echo-reply", {
            identifier: icmp.identifier,
            sequence: icmp.sequence,
            payload: icmp.payload,
          }),
          64,
          "ICMP",
        );

        this.sendPacketFromHost(device, reply);
        return;
      }

      if (device instanceof Router) {
        this.sendGeneratedPacketFromRouter(device, packet.srcIP, "echo-reply", {
          identifier: icmp.identifier,
          sequence: icmp.sequence,
          payload: icmp.payload,
        }, inInterface);
      }

      return;
    }

    if (icmp.type === "echo-reply") {
      this.setFocus({
        type: "packet",
        device,
        inInterface,
        packet,
      });
      this.recordTrace("L4", device.name, `ICMP echo-reply reçu depuis ${ipToString(packet.srcIP)}.`, {
        packet: this.serializePayload(packet),
        inInterface: this.describeInterfaceRef(inInterface),
      });

      if (this.session && this.session.initiatorId === device.id && icmp.identifier === this.session.identifier) {
        this.session.replyReceived = true;
        this.session.targetDevice = this.network.findDeviceByIp(packet.srcIP);
      }

      return;
    }

    if (icmp.type === "time-exceeded") {
      this.setFocus({
        type: "packet",
        device,
        inInterface,
        packet,
      });
      this.recordTrace("L4", device.name, `ICMP time-exceeded reçu depuis ${ipToString(packet.srcIP)}.`, {
        packet: this.serializePayload(packet),
        inInterface: this.describeInterfaceRef(inInterface),
      });

      if (this.session && this.session.initiatorId === device.id) {
        this.recordError(
          ConnectivityError.TTL_EXPIRED,
          `TTL expiré avant d'atteindre ${ipToString(icmp.originalDestination ?? this.session.targetIP)}.`,
          { targetIP: icmp.originalDestination ?? this.session.targetIP },
        );
      }

      return;
    }

    if (icmp.type === "destination-unreachable") {
      this.setFocus({
        type: "packet",
        device,
        inInterface,
        packet,
      });
      this.recordTrace("L4", device.name, `ICMP destination-unreachable reçu depuis ${ipToString(packet.srcIP)}.`, {
        packet: this.serializePayload(packet),
        inInterface: this.describeInterfaceRef(inInterface),
      });

      if (this.session && this.session.initiatorId === device.id) {
        this.recordError(
          ConnectivityError.DESTINATION_UNREACHABLE,
          `Destination ${ipToString(icmp.originalDestination ?? this.session.targetIP)} injoignable.`,
          { targetIP: icmp.originalDestination ?? this.session.targetIP },
        );
      }
    }
  }

  sendPacketFromHost(device, packet) {
    const outInterface = device.getInterface();
    if (!outInterface?.ip) {
      this.recordError("source-config-incomplète", `L'interface de ${device.name} n'est pas configurée.`);
      return;
    }

    const isLocal = device.isLocal(packet.destIP);
    const nextHopIP = isLocal ? packet.destIP : device.gateway;

    if (nextHopIP === null) {
      this.recordError(ConnectivityError.NO_GATEWAY, `Destination distante et aucune passerelle configurée sur ${device.name}.`);
      return;
    }

    this.setFocus({
      type: "packet",
      device,
      outInterface,
      packet,
    });

    const locationDesc = isLocal ? "réseau local" : `passerelle ${ipToString(nextHopIP)}`;
    this.recordTrace("L3", device.name, 
      `Envoi IPv4 vers ${ipToString(packet.destIP)} via ${locationDesc}.`,
      {
        packet: this.serializePayload(packet),
        outInterface: this.describeInterfaceRef(outInterface),
        nextHopIP: ipToString(nextHopIP),
      },
    );

    this.sendPacketThroughArp(device, outInterface, packet, nextHopIP);
  }

  sendGeneratedPacketFromRouter(router, destIP, icmpType, options = {}, preferredInterface = null) {
    if (router.ownsIp(destIP) && icmpType === "echo-request") {
      this.markVisited(router);
      this.recordTrace("L4", router.name, `Ping local sur ${ipToString(destIP)}.`);
      this.session.replyReceived = true;
      this.session.targetDevice = router;
      return; // Local ping on router, handled by runPing's local check
    }

    const route = router.resolveRoute(destIP);
    if (!route?.outInterface) {
      this.recordError(ConnectivityError.NO_ROUTE_TO_HOST, `Le routeur ${router.name} n'a pas de route vers ${ipToString(destIP)}.`, {
        routerName: router.name,
        targetIP: destIP,
      });
      return;
    }

    const outInterface = route.outInterface;
    const srcInterface = preferredInterface?.ip ? preferredInterface : outInterface;
    if (!srcInterface?.ip) {
      return;
    }

    this.recordTrace("L4", router.name, `Génération d'un message ICMP ${icmpType} vers ${ipToString(destIP)}.`, {
      icmpType,
      destIP: ipToString(destIP)
    });

    const packet = new Packet(
      srcInterface.ip,
      destIP,
      new ICMPMessage(icmpType, {
        identifier: options.identifier ?? this.session?.identifier ?? 0,
        sequence: options.sequence ?? 1,
        payload: options.payload ?? "ping",
        code: options.code ?? 0,
        originalDestination: options.originalDestination ?? null,
      }),
      options.ttl ?? 64,
      "ICMP",
    );

    const nextHopForArp = route.nextHop ?? destIP; // C'est l'IP pour laquelle nous devons faire de l'ARP
    const nextHopDescription = this._getDescriptiveNextHop(route); // C'est pour le message de trace
    this.setFocus({
      type: "packet",
      device: router,
      outInterface,
      packet,
    });
    const prefix = maskPrefixLength(route.networkMask);

    this.recordTrace("L3", router.name, 
      `Routage du message ICMP : via ${ipToString(route.networkIp)}/${prefix} sur ${outInterface.name} (next-hop: ${nextHopDescription}).`,
      {
        packet: this.serializePayload(packet),
        outInterface: this.describeInterfaceRef(outInterface),
        nextHopIP: ipToString(nextHopForArp), // Garder l'IP réelle pour l'ARP dans les détails
      },
    );

    this.sendPacketThroughArp(router, outInterface, packet, nextHopForArp);
  }

  sendPacketThroughArp(device, outInterface, packet, nextHopIP) {
    if (!outInterface.link) {
      this.recordTrace("L1", device.name, `Paquet abandonné : aucun câble branché sur ${outInterface.name}.`);
      return;
    }

    // Gestion des diffusions (Broadcast) : Pas d'ARP, encapsulation directe
    const isLimitedBroadcast = (nextHopIP >>> 0) === 0xFFFFFFFF;
    const isDirectedBroadcast = outInterface.mask && (nextHopIP === (outInterface.ip | (~outInterface.mask >>> 0)) >>> 0);

    if (isLimitedBroadcast || isDirectedBroadcast) {
      this.encapsulateAndSend(outInterface, BROADCAST_MAC, packet);
      return;
    }

    const arpEntry = device.lookupArp(nextHopIP);
    if (arpEntry) {
      this.setFocus({
        type: "packet",
        device,
        outInterface,
        packet,
      });
      this.recordTrace("L2", device.name, `ARP cache hit pour ${ipToString(nextHopIP)} -> ${arpEntry.mac}.`, {
        packet: this.serializePayload(packet),
        outInterface: this.describeInterfaceRef(outInterface),
        nextHopIP: ipToString(nextHopIP),
      });
      this.encapsulateAndSend(outInterface, arpEntry.mac, packet);
      return;
    }

    const pendingKey = this.buildPendingKey(outInterface, nextHopIP);
    const shouldSendArp = !device.pending.has(pendingKey);
    device.queuePending(pendingKey, { outInterface, packet: clonePayload(packet) });
    this.setFocus({
      type: "packet",
      device,
      outInterface,
      packet,
    });
    this.recordTrace("L2", device.name, `ARP cache miss pour ${ipToString(nextHopIP)} sur ${outInterface.name}.`, {
      packet: this.serializePayload(packet),
      outInterface: this.describeInterfaceRef(outInterface),
      nextHopIP: ipToString(nextHopIP),
    });

    if (shouldSendArp) {
      this.sendArpRequest(device, outInterface, nextHopIP);
    }
  }

  sendArpRequest(device, outInterface, targetIP) {
    const arp = new ARPMessage("request", outInterface.ip, outInterface.mac, targetIP);
    this.setFocus({
      type: "arp",
      device,
      outInterface,
      arp,
    });
    this.recordTrace("L2", device.name, `Emission ARP request who-has ${ipToString(targetIP)} sur ${outInterface.name}.`, {
      arp: this.serializePayload(arp),
      outInterface: this.describeInterfaceRef(outInterface),
    });
    const frame = new Frame(outInterface.mac, BROADCAST_MAC, arp);
    this.enqueueFrame(outInterface, frame);
  }

  encapsulateAndSend(outInterface, destMac, packet) {
    this.setFocus({
      type: "packet",
      device: outInterface.parentDevice,
      outInterface,
      packet,
    });
    this.recordTrace(
      "L2",
      outInterface.parentDevice.name,
      `Encapsulation Ethernet ${outInterface.mac} -> ${destMac} pour IPv4 ${ipToString(packet.srcIP)} -> ${ipToString(packet.destIP)}.`,
      {
        packet: this.serializePayload(packet),
        outInterface: this.describeInterfaceRef(outInterface),
        destMac,
      },
    );

    const frame = new Frame(outInterface.mac, destMac, clonePayload(packet));
    this.enqueueFrame(outInterface, frame);
  }

  // Helper pour obtenir une chaîne descriptive pour le next-hop dans les traces
  _getDescriptiveNextHop(route) {
    if (route.nextHop === null) {
      return "direct (C)"; // Pour les routes directement connectées
    }
    return ipToString(route.nextHop); // Pour les routes via un routeur next-hop
  }

  processProtocolActivity(device, protocol) {
    // On utilise un collecteur d'événements temporaire pour ne pas polluer
    // la chronologie principale de la simulation utilisateur (le ping).
    const mainEvents = this.events;
    const mainTimeline = this.timeline;
    const mainSession = this.session; // v1.1 : Sauvegarde de la session utilisateur
    this.events = [];
    this.timeline = [];
    
    this.operationCount = 0;
    this.currentFocus = null;

    if (protocol === "RIP") {
      this.sendRipUpdate(device);
    } else if (protocol === "OSPF_HELLO") {
      this.sendOspfHello(device);
    }

    const result = this.finishResult(true, device);
    // On restaure les événements originaux après le traitement du protocole
    this.events = mainEvents;
    this.timeline = mainTimeline;
    this.session = mainSession; // v1.1 : Restauration de la session utilisateur
    return result;
  }

  handleRipOnRouter(device, inInterface, packet, rip) {
    if (!device.enabledProtocols.includes("RIP")) {
      this.recordTrace("L4", device.name, "Paquet RIP ignoré : le protocole RIP n'est pas activé sur ce routeur.");
      return; // Double sécurité
    }

    this.recordTrace("L4", device.name, `RIP update reçu de ${ipToString(packet.srcIP)} sur ${inInterface.name}.`, {
      rip: this.serializePayload(rip)
    });

    device.lastRoutingActivity.rip = Date.now();

    let tableChanged = false;
    rip.routes.forEach(advRoute => {
      const network = advRoute.networkIp;
      const mask = normalizeMask(advRoute.networkMask);
      let newCost = Math.min(advRoute.cost + 1, 16);

       // REGLE : RIP ne cherche/modifie que ses propres routes (Indépendance)
      const existing = device.routingTable.find(r => 
        r.networkIp === network && r.networkMask === mask && r.kind === "rip"
      );

      const now = Date.now();

      if (!existing) {
        if (newCost >= 16) return; // N'apprend pas une route déjà morte
        const route = device.addRoute(network, mask, packet.srcIP, inInterface, newCost, "rip"); // Mark as RIP route
        if (route) {
          route.lastUpdated = now;
          this.recordInfo(`RIP : Nouvelle route vers ${ipToString(network)}/${maskPrefixLength(mask)} apprise via ${ipToString(packet.srcIP)} (métrique: ${newCost}).`);
          tableChanged = true;
        }
      } else {
        // Gestion du Hold-down : Si la route est empoisonnée (16), on ignore les pubs pendant 30s
        // sauf si l'info vient du même voisin (pour confirmer la mort ou ressusciter la route)
        const inHoldDown = existing.cost === 16 && (now - (existing.poisonedAt || 0)) < 30000;
        if (inHoldDown && existing.nextHop !== packet.srcIP) {
          return;
        }

        // Mise à jour de l'expiration si l'info vient du même voisin
        if (existing.nextHop === packet.srcIP) {
          existing.lastUpdated = now;
        }

        // Cas 1 : Route apprise comme morte (Poison Reverse)
        if (newCost >= 16 && existing.cost < 16 && existing.nextHop === packet.srcIP) {
          existing.cost = 16;
          existing.poisonedAt = now;
          tableChanged = true;
          this.recordInfo(`RIP : Route vers ${ipToString(network)} empoisonnée (métrique 16) par ${ipToString(packet.srcIP)}.`);
        } 
        // Mise à jour si c'est le même prochain saut ou si le coût est meilleur
        else if (newCost < existing.cost || (existing.nextHop === packet.srcIP && newCost !== existing.cost)) {
          if (existing.cost !== newCost || existing.nextHop !== packet.srcIP) {
            const wasPoisoned = existing.cost === 16;
            existing.cost = newCost;
            existing.nextHop = packet.srcIP;
            existing.outInterface = inInterface;
            existing.lastUpdated = now;
            if (wasPoisoned) delete existing.poisonedAt;
            
            this.recordInfo(`RIP : Route vers ${ipToString(network)} mise à jour (métrique: ${newCost}, via: ${ipToString(packet.srcIP)}).`);
            tableChanged = true;
          }
        }
      }
    });

    if (tableChanged) {
      // Flash Update : On propage immédiatement le changement (et les poisons)
      if (device.enabledProtocols.includes("RIP")) {
        this.sendRipUpdate(device);
      }
      // 2. Redistribution immédiate vers OSPF si actif
      if (device.enabledProtocols.includes("OSPF")) {
        this.recordInfo(`Redistribution RIP -> OSPF activée sur ${device.name}`);
        // Trigger this router to generate and flood its OWN LSA, which now includes the new RIP route
        this.sendOspfLsa(device);
        /*
        device.interfaces.forEach(iface => { // Old flooding logic, replaced by sendOspfLsa(device)
          if (iface.link) {
            for (let [id, neighbor] of device.ospfNeighbors) {
              if (neighbor.interface === iface) {
                this.sendOspfLsa(device, iface, neighbor.ip); // This was sending THIS router's LSA to a specific neighbor
              }
            }
          }
        });*/
      }
    }
  }

  sendRipUpdate(router) {
    const isNewSession = !this.session;
    if (isNewSession) this.startSession("RIP Broadcast", router, 0xFFFFFFFF);
    
    this.recordTrace("L4", router.name, isNewSession ? "Envoi des mises à jour RIP sur toutes les interfaces." : "Déclenchement d'une mise à jour RIP (Triggered Update).");

    router.interfaces.forEach(iface => {
      if (!iface.ip || !iface.link) return;

      // Génération de la table RIP spécifique à cette interface (Split-Horizon)
      const routesForInterface = router.getRoutes()
        .filter(r => {
          // Règle 1 : Ne pas renvoyer une route RIP sur l'interface où on l'a apprise
          if (r.kind === "rip" && r.outInterface === iface) return false;
          // Règle 2 : Ne pas renvoyer le réseau de l'interface elle-même
          if (r.kind === "connected" && r.outInterface === iface) return false;
          return true;
        })
        .map(r => ({
          networkIp: r.networkIp,
          networkMask: r.networkMask,
          cost: r.kind === "ospf" ? 2 : (r.cost ?? 1) // Redistribution OSPF -> RIP (Metric 2)
        }));

      const ripMsg = new RIPMessage(routesForInterface);
      const packet = new Packet(iface.ip, 0xFFFFFFFF, ripMsg, 1, "UDP");
      this.encapsulateAndSend(iface, BROADCAST_MAC, packet);
    });

    this.runQueue();
  }

  handleOspfOnRouter(device, inInterface, packet, ospf) {
    if (!device.enabledProtocols.includes("OSPF")) {
      this.recordTrace("L4", device.name, "Paquet OSPF ignoré : le protocole OSPF n'est pas activé sur ce routeur.");
      return; // Double sécurité
    }

    this.recordTrace("L4", device.name, `OSPF ${ospf.type} reçu de ${ospf.routerId} sur ${inInterface.name}.`);
    
    if (ospf.type === "hello") {
      device.lastRoutingActivity.ospf = Date.now();
      const isNewNeighbor = !device.ospfNeighbors.has(ospf.routerId);
      device.ospfNeighbors.set(ospf.routerId, { 
        lastSeen: Date.now(), 
        ip: packet.srcIP,
        interface: inInterface,
        routerId: ospf.routerId // Store routerId for easier lookup
      });
      
      this.recordInfo(`OSPF Hello reçu de ${ospf.routerId}.`);

      // Si c'est un nouveau voisin, on déclenche un échange d'états de liens (LSA)
      if (isNewNeighbor) {
        this.recordInfo(`OSPF : Nouvelle adjacence avec ${ospf.routerId}. Déclenchement LSA.`);
        this.sendOspfLsa(device); // This router generates and floods its OWN LSA
      }
    } else if (ospf.type === "lsa") {
      this.handleOspfLsa(device, inInterface, packet, ospf);
    }
  }

  handleOspfLsa(device, inInterface, packet, ospf) {
    this.recordTrace("L4", device.name, `OSPF LSA reçu de ${ospf.routerId}.`);
    
    device.lastRoutingActivity.ospf = Date.now();
    
    const routes = ospf.neighbors; // Dans notre version simplifiée, data.neighbors contient les routes
    let tableChanged = false;

    routes.forEach(advRoute => {
      const network = advRoute.networkIp;
      const mask = advRoute.networkMask;
      
      const linkCost = inInterface.link ? (OSPF_COST_MAP[inInterface.link.type] || 10) : 1;
      const cost = (advRoute.cost || 0) + linkCost;

      // Indépendance : OSPF ne cherche pas à modifier une route RIP
      const existing = device.routingTable.find(r => 
        r.networkIp === network && r.networkMask === mask && r.kind === "ospf"
      );

      if (!existing || (existing.kind === "ospf" && cost < existing.cost)) {
        if (existing) {
          existing.cost = cost;
          existing.nextHop = packet.srcIP;
          existing.outInterface = inInterface;
          tableChanged = true;
        } else {
          const route = device.addRoute(network, mask, packet.srcIP, inInterface, cost, "ospf");
          if (route) {
            tableChanged = true;
          }
        }
      }
    });

    if (tableChanged) {
      this.recordInfo(`OSPF: Table de routage mise à jour via LSA de ${ospf.routerId}.`);
      
      // Propagation (Flooding) : On renvoie le LSA reçu à tous les AUTRES voisins
      device.interfaces.forEach(iface => {
        if (iface !== inInterface && iface.link) {
          for (let [id, neighbor] of device.ospfNeighbors) {
            if (neighbor.interface === iface && neighbor.routerId !== ospf.routerId) {
              const floodPacket = new Packet(iface.ip, neighbor.ip, clonePayload(ospf), 1, "OSPF");
              this.recordTrace("L4", device.name, `OSPF : Propagation LSA de ${ospf.routerId} vers ${neighbor.routerId} via ${iface.name}.`);
              const destMac = device.lookupArp(neighbor.ip)?.mac || BROADCAST_MAC;
              this.encapsulateAndSend(iface, destMac, floodPacket);
            }
          }
        }
      });

      // Redistribution immédiate vers RIP si actif
      if (device.enabledProtocols.includes("RIP")) {
        this.recordInfo(`Redistribution OSPF -> RIP activée sur ${device.name}`);
        this.sendRipUpdate(device);
      }
    }
  }

  sendOspfLsa(router) {
    // Filter to only advertise own links and redistributed routes (not routes learned via OSPF itself)
    // C'est ici que réside la source de vérité pour l'annonce OSPF du routeur.
    // On autorise désormais la propagation des routes OSPF apprises (Multi-hop)
    const finalRoutesToAdv = router.getRoutes()
      .filter(r => r.kind === "connected" || r.kind === "static" || r.kind === "rip" || r.kind === "ospf")
      .map(r => ({
        networkIp: r.networkIp,
        networkMask: r.networkMask,
        cost: r.kind === "rip" ? 20 : (r.cost ?? 1) // Redistribution RIP -> OSPF (Metric 20)
      }));

    const ospfMsg = new OSPFMessage("lsa", { 
      routerId: router.name,
      neighbors: finalRoutesToAdv 
    });

    // Envoi de NOTRE LSA à tous les voisins adjacents
    router.interfaces.forEach(iface => {
      if (!iface.ip || !iface.link || !router.enabledProtocols.includes("OSPF")) return;

      for (let [id, neighbor] of router.ospfNeighbors) {
        if (neighbor.interface === iface) {
          const packet = new Packet(iface.ip, neighbor.ip, clonePayload(ospfMsg), 1, "OSPF");
          this.recordTrace("L4", router.name, `OSPF : Envoi de mon état de lien vers ${neighbor.routerId} (${iface.name}).`);
          const destMac = router.lookupArp(neighbor.ip)?.mac || BROADCAST_MAC;
          this.encapsulateAndSend(iface, destMac, packet);
        }
      }
    });
    this.runQueue();
  }

  sendOspfHello(router) {
    const isNewSession = !this.session;
    if (isNewSession) this.startSession("OSPF Hello", router, 0xFFFFFFFF);

    this.recordTrace("L4", router.name, isNewSession ? "Diffusion OSPF Hello sur toutes les interfaces." : "Envoi d'un message OSPF Hello.");

    router.interfaces.forEach(iface => {
      if (!iface.ip || !iface.link) return;

      const ospfMsg = new OSPFMessage("hello", { routerId: router.name });
      const packet = new Packet(iface.ip, 0xFFFFFFFF, ospfMsg, 1, "OSPF");
      this.encapsulateAndSend(iface, BROADCAST_MAC, packet);
    });

    this.runQueue();
  }
}
