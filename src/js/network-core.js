import { Device, Host, Router, Switch, DataServer } from "./devices.js";
import { Interface, Link } from "./interfaces.js";
import { normalizeIPv4, normalizeIPv4Value } from "./network-utils.js";

export const BROADCAST_MAC = "FF:FF:FF:FF:FF:FF";

export class Frame {
  constructor(srcMac, destMac, content = null) {
    this.srcMac = srcMac;
    this.destMac = destMac;
    this.content = content;
  }
}

export class Packet {
  constructor(srcIP, destIP, content = null, ttl = 64, protocol = "ICMP") {
    this.srcIP = normalizeIPv4Value(srcIP);
    this.destIP = normalizeIPv4Value(destIP);
    this.content = content;
    this.ttl = ttl;
    this.protocol = protocol;
  }

  // Retourne une nouvelle instance pour garantir l'immutabilité lors de la simulation
  withTTL(newTTL) {
    return new Packet(this.srcIP, this.destIP, this.content, newTTL, this.protocol);
  }

  // Utilisé par le moteur NAT pour la traduction sans modifier l'objet original
  withIPs(src, dest) {
    return new Packet(src, dest, this.content, this.ttl, this.protocol);
  }
}

export class ARPMessage {
  constructor(op, srcIP, srcMAC, targetIP, targetMAC = null) {
    this.op = op;
    this.srcIP = normalizeIPv4Value(srcIP);
    this.srcMAC = srcMAC;
    this.targetIP = normalizeIPv4Value(targetIP);
    this.targetMAC = targetMAC;
  }
}

export class ICMPMessage {
  constructor(type = "echo-request", options = {}) {
    this.type = type;
    this.code = options.code ?? 0;
    this.identifier = options.identifier ?? 1;
    this.sequence = options.sequence ?? 1;
    this.payload = options.payload ?? "";
    this.originalDestination = options.originalDestination ?? null;
  }
}

export class RIPMessage {
  constructor(routes = []) {
    this.kind = "rip";
    this.routes = routes; // Liste de { networkIp, networkMask, cost }
  }
}

export class OSPFMessage {
  constructor(type, data = {}) {
    this.kind = "ospf";
    this.type = type; // "hello" | "lsa"
    this.routerId = data.routerId;
    this.neighbors = data.neighbors || [];
  }
}

export class SegmentTCP {
  constructor(srcPort, destPort, seqNum, ackNum = 0, content = "") {
    this.srcPort = srcPort;
    this.destPort = destPort;
    this.seqNum = seqNum;
    this.ackNum = ackNum;
    this.content = content;
    this.flags = { SYN: false, ACK: false, FIN: false };
  }
}

export class SegmentUDP {
  constructor(srcPort, destPort, content = "") {
    this.srcPort = srcPort;
    this.destPort = destPort;
    this.content = content;
  }
}
export class Network {
  constructor() {
    this.devices = [];
    this.links = [];
    this.nextId = 1;
  }

  addDevice(device) {
    if (device.id == null) {
      device.id = this.nextId;
      this.nextId += 1;
    } else if (typeof device.id === "number") {
      this.nextId = Math.max(this.nextId, device.id + 1);
    }

    this.devices.push(device);
    return device;
  }

  findDeviceById(id) {
    return this.devices.find((device) => device.id === id) ?? null;
  }

  findDeviceByIp(ip) {
    const normalizedIp = normalizeIPv4(ip);
    if (normalizedIp === null) {
      return null;
    }

    return this.devices.find((device) => (
      device.interfaces.some((iface) => iface.ip === normalizedIp)
    )) ?? null;
  }

  findInterfaceByIp(ip) {
    const normalizedIp = normalizeIPv4(ip);
    if (normalizedIp === null) {
      return null;
    }

    for (const device of this.devices) {
      const match = device.interfaces.find((iface) => iface.ip === normalizedIp);
      if (match) {
        return match;
      }
    }

    return null;
  }

  addLink(intA, intB, editable = null) {
    if (!intA || !intB || intA.parentDevice === intB.parentDevice) {
      return null;
    }

    if (intA.link || intB.link) {
      return null;
    }

    const config = (typeof editable === 'object' && editable !== null) ? editable : { editable: editable !== false };
    const linkRequestedEditable = config.editable ?? (intA.linkable && intB.linkable);
    const linkType = config.type || "Ethernet";

    const link = new Link(intA, intB, linkRequestedEditable, linkType);
    this.links.push(link);
    return link;
  }

  removeLink(link) {
    if (!link) {
      return;
    }

    link.endpointA.link = null;
    link.endpointB.link = null;
    this.links = this.links.filter((current) => current !== link);
  }

  findLinkBetween(intA, intB) {
    return this.links.find((link) => (
      (link.endpointA === intA && link.endpointB === intB)
      || (link.endpointA === intB && link.endpointB === intA)
    )) ?? null;
  }
}

export class Scenario {
  constructor({ code = "scenario", title, objectif = "", network, hints = [], pingsToValidate = [], finalFlag = null }) {
    this.code = code;
    this.title = title;
    this.objectif = objectif;
    this.network = network;
    this.hints = hints;
    this.pingsToValidate = pingsToValidate; // New property for pings to validate
    this.finalFlag = finalFlag;
  }
}
