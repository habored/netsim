import { Network, Scenario } from "./network-core.js";
import { Device, Host, Router, Switch, DataServer } from "./devices.js";

export function createScenarioFromJSON(data) {
  const network = new Network();
  const devicesMap = new Map();

  for (const d of data.devices) {
    let device;

    switch (d.type) {
      case "host":
        device = new Host(d.name, d.ip, d.mask, d.gateway,
          d.editable ?? false,
          d.interfacesLinkables ?? false,
          d.consoleAccessible ?? false, 
        );
        break;

      case "switch":
        device = new Switch(null, d.name, d.ports ?? 4, 
          d.editable ?? false, 
          d.interfacesLinkables ?? false, 
          d.consoleAccessible ?? false);
        break;

      case "router":
        device = new Router(null, d.name, 
          d.interfaces, 
          d.editable ?? false, 
          d.interfacesLinkables ?? false, 
          d.consoleAccessible ?? false);
        if (d.routing || d.firewall) {
          device.applyRoutingConfig(d); // On passe l'objet complet d pour capter routing et firewall
        }
        break;

      case "server":
        device = new DataServer(d.name, d.ip, d.mask, d.gateway, 
          d.editable ?? false, 
          d.interfacesLinkables ?? false, 
          d.consoleAccessible ?? false);
        break;
    }

    device.x = d.x;
    device.y = d.y;

    network.addDevice(device);
    devicesMap.set(d.name, device);
  }

  for (const entry of data.links) {
    const [aName, aPort, bName, bPort] = entry.link;
      network.addLink(
      devicesMap.get(aName).interfaces[aPort], 
      devicesMap.get(bName).interfaces[bPort],
      entry.editable ?? false
    );
  }

  // Calcul du finalFlag par concaténation des flags des pings à valider
  const computedFlag = (data.pingsToValidate || []).map(p => p.flag).join('');

  return new Scenario({
    code: data.code,
    title: data.title,
    objectif: data.objectif,
    network,
    hints: data.hints ?? [],
    pingsToValidate: data.pingsToValidate ?? [],
    finalFlag: data.finalFlag || computedFlag,
  });
}