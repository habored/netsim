import { normalizeIPv4, normalizeMask } from "./network-utils.js";

export class Interface {
  constructor(parentDevice, ip = null, mask = null, name = null, speed = 1, editable = true, linkable = false) {
    this.parentDevice = parentDevice;
    this.mac = Interface.genMac();
    this.ip = normalizeIPv4(ip);
    this.mask = normalizeMask(mask);
    this.name = name;
    this.link = null;
    this.speed = speed;
    this.editable = Boolean(editable);
    this.linkable = Boolean(linkable);
  }

  static genMac() {
    return "XX:XX:XX:XX:XX:XX".replace(/X/g, () => "0123456789ABCDEF".charAt(Math.floor(Math.random() * 16)));
  }

  setIp(ip) {
    this.ip = normalizeIPv4(ip);
    return this.ip;
  }

  setMask(mask) {
    this.mask = normalizeMask(mask);
    return this.mask;
  }

  isConfigured() {
    return this.ip !== null && this.mask !== null;
  }
}

export class Link {
  constructor(endpointA, endpointB, editable = true, type = "Ethernet") {
    this.endpointA = endpointA;
    this.endpointB = endpointB;
    this.editable = Boolean(editable);
    this.type = type;

    endpointA.link = this;
    endpointB.link = this;
  }

  otherSide(nic) {
    if (nic === this.endpointA) {
      return this.endpointB;
    }

    if (nic === this.endpointB) {
      return this.endpointA;
    }

    return null;
  }
}
