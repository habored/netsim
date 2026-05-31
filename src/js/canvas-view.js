import { ipToString } from "./network-utils.js";

const DEVICE_FILL = {
  pc: "#ad73c8",
  server: "#22c55e",
  switch: "#fbbf24",
  router: "#ef4444",
};

class DeviceView {
  constructor(device, x = 50, y = 50, options = {}) {
    this.model = device;
    this.x = x;
    this.y = y;
    this.width = options.width ?? 170;
    this.labelHeight = options.labelHeight ?? 24;
    this.margin = options.margin ?? 8;
    this.portW = options.portW ?? 34;
    this.portH = options.portH ?? 18;
    this.gap = options.gap ?? 8;
    this.ifaceRects = [];
    this.computeLayout();
  }

  computeLayout() {
    const ifaceCount = this.model.interfaces.length;
    const innerWidth = this.width - (2 * this.margin);
    const portsPerRow = Math.max(1, Math.floor((innerWidth + this.gap) / (this.portW + this.gap)));
    const columns = Math.min(portsPerRow, Math.max(1, ifaceCount));
    const rows = Math.max(1, Math.ceil(ifaceCount / columns));

    this.height = this.labelHeight + 12 + (rows * (this.portH + this.gap)) + this.margin;
    this.ifaceRects = [];

    for (let index = 0; index < ifaceCount; index += 1) {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = this.x + this.margin + (column * (this.portW + this.gap));
      const y = this.y + this.labelHeight + 12 + (row * (this.portH + this.gap));
      this.ifaceRects.push({ x, y, w: this.portW, h: this.portH, index });
    }
  }

  containsPoint(x, y) {
    return x >= this.x && x <= this.x + this.width && y >= this.y && y <= this.y + this.height;
  }

  findIfaceAt(x, y) {
    for (const rect of this.ifaceRects) {
      if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) {
        return rect.index;
      }
    }

    return -1;
  }

  moveTo(nextX, nextY) {
    this.x = nextX;
    this.y = nextY;
    this.model.x = nextX;
    this.model.y = nextY;
    this.computeLayout();
  }
}

class LinkView {
  constructor(link) {
    this.link = link;
  }

  endpoints(deviceViewsMap) {
    const deviceViewA = deviceViewsMap.get(this.link.endpointA.parentDevice.id);
    const deviceViewB = deviceViewsMap.get(this.link.endpointB.parentDevice.id);

    if (!deviceViewA || !deviceViewB) {
      return null;
    }

    const ifaceIndexA = this.link.endpointA.parentDevice.interfaces.indexOf(this.link.endpointA);
    const ifaceIndexB = this.link.endpointB.parentDevice.interfaces.indexOf(this.link.endpointB);
    const rectA = deviceViewA.ifaceRects[ifaceIndexA];
    const rectB = deviceViewB.ifaceRects[ifaceIndexB];

    if (!rectA || !rectB) {
      return null;
    }

    return [
      { x: rectA.x + (rectA.w / 2), y: rectA.y + (rectA.h / 2) },
      { x: rectB.x + (rectB.w / 2), y: rectB.y + (rectB.h / 2) },
    ];
  }
}

export class CanvasNetworkView {
  constructor(canvas, network, callbacks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.network = network;
    this.deviceViews = new Map();
    this.linkViews = [];
    this.selectedNodes = [];
    this.simulationFocus = null;
    this.onSelectionChange = callbacks.onSelectionChange ?? (() => {});
    this.onTopologyChange = callbacks.onTopologyChange ?? (() => {});
    this.dragState = {
      dragging: false,
      deviceId: null,
      offsetX: 0,
      offsetY: 0,
      startX: 0,
      startY: 0,
      moved: false,
    };

    this.setupEvents();
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize() {
    const topology = document.getElementById("topology");
    this.canvas.width = topology.clientWidth;
    this.canvas.height = topology.clientHeight;
    this.draw();
  }

  ensureDeviceView(device) {
    if (!this.deviceViews.has(device.id)) {
      const index = this.deviceViews.size;
      const fallbackX = 40 + ((index % 4) * 220);
      const fallbackY = 40 + (Math.floor(index / 4) * 180);
      const x = device.x ?? fallbackX;
      const y = device.y ?? fallbackY;
      this.deviceViews.set(device.id, new DeviceView(device, x, y));
      return;
    }

    const deviceView = this.deviceViews.get(device.id);
    deviceView.model = device;
    deviceView.computeLayout();
  }

  rebuildViews() {
    for (const device of this.network.devices) {
      this.ensureDeviceView(device);
    }

    this.linkViews = this.network.links.map((link) => new LinkView(link));

    for (const deviceView of this.deviceViews.values()) {
      deviceView.computeLayout();
    }
  }

  draw() {
    this.rebuildViews();
    const ctx = this.ctx;

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawLinks(ctx);
    this.drawDevices(ctx);
  }

  drawLinks(ctx) {
    ctx.lineWidth = 2;

    for (const linkView of this.linkViews) {
      const points = linkView.endpoints(this.deviceViews);
      if (!points) {
        continue;
      }

      const [pointA, pointB] = points;
      const isSelected = this.isLinkSelectedBySelectedNodes(linkView.link);
      const isFocused = this.isFocusedLink(linkView.link);
      ctx.strokeStyle = isFocused
        ? "#f97316"
        : isSelected
          ? "rgba(204, 0, 0, 0.5)"
          : "rgba(37, 99, 235, 0.3)";
      ctx.lineWidth = isFocused ? 4 : 2;
      ctx.beginPath();
      ctx.moveTo(pointA.x, pointA.y);
      ctx.lineTo(pointB.x, pointB.y);
      ctx.stroke();

      if (isFocused) {
        this.drawFocusedLinkLabel(ctx, pointA, pointB);
      }
    }
  }

  drawDevices(ctx) {
    for (const deviceView of this.deviceViews.values()) {
      const isSelectedDevice = this.isDeviceSelected(deviceView.model.id)
        && deviceView.model.id === this.selectedNodes[this.selectedNodes.length - 1]?.deviceId;
      const isFocusedDevice = this.isSimulationFocusedDevice(deviceView.model.id);

      ctx.fillStyle = DEVICE_FILL[deviceView.model.type] ?? "#e5e7eb";
      ctx.strokeStyle = isFocusedDevice ? "#f97316" : (isSelectedDevice && deviceView.model.editable) ? "#01a169" : "rgba(15, 23, 42, 0.2)";
      ctx.lineWidth = isFocusedDevice || isSelectedDevice ? 2 : 1;
      ctx.fillRect(deviceView.x, deviceView.y, deviceView.width, deviceView.height);
      ctx.strokeRect(deviceView.x, deviceView.y, deviceView.width, deviceView.height);

      ctx.fillStyle = "#111827";
      ctx.font = "13px Arial";
      ctx.fillText(this.buildDeviceLabel(deviceView.model), deviceView.x + 8, deviceView.y + 16);
      ctx.font = "13px Arial";

      // Indicateurs de protocoles de routage (Flash)
      if (deviceView.model.type === "router" && deviceView.model.lastRoutingActivity) {
        const now = Date.now();
        const padding = 12;
        if (now - deviceView.model.lastRoutingActivity.rip < 800) {
          ctx.fillStyle = "#22c55e"; // Vert RIP
          ctx.beginPath();
          ctx.arc(deviceView.x + deviceView.width - padding, deviceView.y + deviceView.height - padding, 4, 0, Math.PI * 2);
          ctx.fill();
        }
        if (now - deviceView.model.lastRoutingActivity.ospf < 800) {
          ctx.fillStyle = "#3b82f6"; // Bleu OSPF
          ctx.beginPath();
          ctx.arc(deviceView.x + deviceView.width - padding - 12, deviceView.y + deviceView.height - padding, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      for (const rect of deviceView.ifaceRects) {
        const iface = deviceView.model.interfaces[rect.index];
        const isSelectedIface = this.isInterfaceSelected(deviceView.model.id, rect.index);
        const isFocusedIface = this.isSimulationFocusedInterface(deviceView.model.id, rect.index);

        ctx.fillStyle = isFocusedIface ? "#fdba74" : isSelectedIface ? "#22d3ee" : "#94a3b8";
        ctx.strokeStyle = isFocusedIface ? "#f97316" : (isSelectedIface && deviceView.model.editable) ? "#01a169" : "transparent";
        ctx.lineWidth = 2;
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

        ctx.fillStyle = "#0f172a";
        ctx.font = "10px Arial";
        ctx.fillText(this.buildInterfaceLabel(iface), rect.x + 3, rect.y + rect.h - 4);
      }
    }
  }

  buildDeviceLabel(device) {
    const primaryInterface = device.interfaces[0];
    if (device.interfaces.length === 1 && primaryInterface?.ip) {
      return `${device.name} - ${ipToString(primaryInterface.ip)}`;
    }

    return device.name;
  }

  buildInterfaceLabel(iface) {
    if (iface.ip) {
      const octets = ipToString(iface.ip).split(".");
      return `.${octets[3]}`;
    }

    return iface.name;
  }

  buildFocusLabel() {
    const focus = this.simulationFocus;
    if (!focus) {
      return "";
    }

    if (focus.type === "frame-transmission") {
      return this.buildPayloadLabel(focus.frame?.payload);
    }

    if (focus.type === "packet") {
      return this.buildPayloadLabel(focus.packet);
    }

    if (focus.type === "arp") {
      return this.buildPayloadLabel(focus.arp);
    }

    return "";
  }

  buildPayloadLabel(payload) {
    if (!payload) {
      return "Trame";
    }

    if (payload.kind === "arp") {
      return `ARP ${payload.op}`;
    }

    if (payload.kind === "ipv4") {
      const protocol = payload.content?.kind === "icmp"
        ? `ICMP ${payload.content.type}`
        : payload.protocol ?? "IPv4";
      return `${protocol} ${payload.srcIP} -> ${payload.destIP}`;
    }

    if (payload.kind === "icmp") {
      return `ICMP ${payload.type}`;
    }

    if (payload.kind === "tcp" || payload.kind === "udp") {
      return payload.kind.toUpperCase();
    }

    return "Trame";
  }

  isFocusedLink(link) {
    const focus = this.simulationFocus;
    if (focus?.type !== "frame-transmission" || !focus.from || !focus.to) {
      return false;
    }

    const endpointA = link.endpointA;
    const endpointB = link.endpointB;

    return (
      endpointA.parentDevice.id === focus.from.deviceId
      && endpointA.name === focus.from.name
      && endpointB.parentDevice.id === focus.to.deviceId
      && endpointB.name === focus.to.name
    ) || (
      endpointA.parentDevice.id === focus.to.deviceId
      && endpointA.name === focus.to.name
      && endpointB.parentDevice.id === focus.from.deviceId
      && endpointB.name === focus.from.name
    );
  }

  isSimulationFocusedDevice(deviceId) {
    const ids = new Set();
    const focus = this.simulationFocus;
    if (!focus) {
      return false;
    }

    if (focus.device?.id !== undefined) {
      ids.add(focus.device.id);
    }

    if (focus.from?.deviceId !== undefined) {
      ids.add(focus.from.deviceId);
    }

    if (focus.to?.deviceId !== undefined) {
      ids.add(focus.to.deviceId);
    }

    if (focus.inInterface?.deviceId !== undefined) {
      ids.add(focus.inInterface.deviceId);
    }

    if (focus.outInterface?.deviceId !== undefined) {
      ids.add(focus.outInterface.deviceId);
    }

    return ids.has(deviceId);
  }

  isSimulationFocusedInterface(deviceId, index) {
    const focus = this.simulationFocus;
    if (!focus) {
      return false;
    }

    const refs = [focus.from, focus.to, focus.inInterface, focus.outInterface].filter(Boolean);
    return refs.some((ref) => {
      if (ref.deviceId !== deviceId) {
        return false;
      }

      const device = this.network.findDeviceById(deviceId);
      return device?.interfaces[index]?.name === ref.name;
    });
  }

  drawFocusedLinkLabel(ctx, pointA, pointB) {
    const label = this.buildFocusLabel();
    if (!label) {
      return;
    }

    const midX = (pointA.x + pointB.x) / 2;
    const midY = (pointA.y + pointB.y) / 2;
    const paddingX = 8;
    const paddingY = 4;

    ctx.save();
    ctx.font = "11px Arial";
    const width = ctx.measureText(label).width + (paddingX * 2);
    const height = 20;
    ctx.fillStyle = "rgba(255, 247, 237, 0.95)";
    ctx.strokeStyle = "#f97316";
    ctx.lineWidth = 1;
    ctx.fillRect(midX - (width / 2), midY - height - 8, width, height);
    ctx.strokeRect(midX - (width / 2), midY - height - 8, width, height);
    ctx.fillStyle = "#9a3412";
    ctx.fillText(label, midX - (width / 2) + paddingX, midY - 13);
    ctx.restore();
  }

  pickAt(x, y) {
    const deviceViews = Array.from(this.deviceViews.values()).reverse();

    for (const deviceView of deviceViews) {
      const ifaceIndex = deviceView.findIfaceAt(x, y);
      if (ifaceIndex !== -1) {
        return { type: "iface", device: deviceView.model, index: ifaceIndex };
      }

      if (deviceView.containsPoint(x, y)) {
        return { type: "dev", device: deviceView.model };
      }
    }

    return null;
  }

  isInterfaceSelected(deviceId, index) {
    return this.selectedNodes.some((selection) => (
      selection.type === "iface"
      && selection.deviceId === deviceId
      && selection.index === index
    ));
  }

  isDeviceSelected(deviceId) {
    return this.selectedNodes.some((selection) => (
      selection.type === "dev" && selection.deviceId === deviceId
    ));
  }

  isLinkSelectedBySelectedNodes(link) {
    if (this.selectedNodes.length !== 2) {
      return false;
    }

    const [first, second] = this.selectedNodes;
    if (first.type !== "iface" || second.type !== "iface") {
      return false;
    }

    const interfaceA = link.endpointA;
    const interfaceB = link.endpointB;
    const interfaceAIndex = interfaceA.parentDevice.interfaces.indexOf(interfaceA);
    const interfaceBIndex = interfaceB.parentDevice.interfaces.indexOf(interfaceB);

    return (
      interfaceA.parentDevice.id === first.deviceId
      && interfaceAIndex === first.index
      && interfaceB.parentDevice.id === second.deviceId
      && interfaceBIndex === second.index
    ) || (
      interfaceA.parentDevice.id === second.deviceId
      && interfaceAIndex === second.index
      && interfaceB.parentDevice.id === first.deviceId
      && interfaceBIndex === first.index
    );
  }

  setSelection(selectedNodes) {
    this.selectedNodes = selectedNodes;
    this.onSelectionChange(this.selectedNodes);
    this.draw();
  }

  clearSelection() {
    this.setSelection([]);
  }

  setSimulationFocus(focus) {
    this.simulationFocus = focus;
    this.draw();
  }

  setupEvents() {
    const DRAG_THRESHOLD = 3;

    this.canvas.addEventListener("mousedown", (event) => {
      const position = this.getMousePosition(event);
      this.dragState.dragging = false;
      this.dragState.moved = false;
      this.dragState.startX = position.x;
      this.dragState.startY = position.y;

      const hit = this.pickAt(position.x, position.y);
      if (hit && hit.type === "dev") {
        const deviceView = this.deviceViews.get(hit.device.id);
        this.dragState.dragging = true;
        this.dragState.deviceId = hit.device.id;
        this.dragState.offsetX = position.x - deviceView.x;
        this.dragState.offsetY = position.y - deviceView.y;
      }
    });

    this.canvas.addEventListener("mousemove", (event) => {
      if (!this.dragState.dragging) {
        return;
      }

      const position = this.getMousePosition(event);
      const dx = position.x - this.dragState.startX;
      const dy = position.y - this.dragState.startY;

      if (!this.dragState.moved && Math.sqrt((dx * dx) + (dy * dy)) > DRAG_THRESHOLD) {
        this.dragState.moved = true;
      }

      if (this.dragState.moved) {
        const deviceView = this.deviceViews.get(this.dragState.deviceId);
        if (deviceView) {
          deviceView.moveTo(position.x - this.dragState.offsetX, position.y - this.dragState.offsetY);
          this.draw();
        }
      }
    });

    this.canvas.addEventListener("mouseup", (event) => {
      const position = this.getMousePosition(event);

      if (this.dragState.dragging && this.dragState.moved) {
        this.dragState.dragging = false;
        this.dragState.deviceId = null;
        this.dragState.moved = false;
        return;
      }

      const hit = this.pickAt(position.x, position.y);
      if (!hit) {
        this.clearSelection();
      } else {
        this.setSelection(this.computeNextSelection(hit));
      }

      this.dragState.deviceId = null;
      this.dragState.dragging = false;
      this.dragState.moved = false;
    });

    window.addEventListener("keydown", (event) => {
      if (event.key !== "Delete" && event.key !== "Backspace") {
        return;
      }

      if (this.selectedNodes.length !== 2) {
        return;
      }

      const [first, second] = this.selectedNodes;
      if (first.type !== "iface" || second.type !== "iface") {
        return;
      }

      const deviceA = this.network.findDeviceById(first.deviceId);
      const deviceB = this.network.findDeviceById(second.deviceId);
      const interfaceA = deviceA?.interfaces[first.index];
      const interfaceB = deviceB?.interfaces[second.index];
      const link = this.network.findLinkBetween(interfaceA, interfaceB);

      if (link && interfaceA?.editable && interfaceB?.editable) {
        this.network.removeLink(link);
        this.onTopologyChange({ type: "link-removed" });
        this.clearSelection();
      }
    });
  }

  computeNextSelection(hit) {
    const existingIndex = this.selectedNodes.findIndex((selection) => (
      selection.type === hit.type
      && selection.deviceId === hit.device.id
      && (selection.index ?? -1) === (hit.index ?? -1)
    ));

    if (existingIndex !== -1) {
      const nextSelection = [...this.selectedNodes];
      nextSelection.splice(existingIndex, 1);
      return nextSelection;
    }

    if (this.selectedNodes.length === 0) {
      return [this.buildSelection(hit)];
    }

    if (this.selectedNodes.length === 1) {
      const first = this.selectedNodes[0];
      if (
        first.type === "iface"
        && hit.type === "iface"
        && first.deviceId === hit.device.id
      ) {
        return [this.buildSelection(hit)];
      }

      return [...this.selectedNodes, this.buildSelection(hit)].slice(-2);
    }

    return [this.buildSelection(hit)];
  }

  buildSelection(hit) {
    if (hit.type === "iface") {
      return { type: "iface", deviceId: hit.device.id, index: hit.index };
    }

    return { type: "dev", deviceId: hit.device.id };
  }

  getMousePosition(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }
}
