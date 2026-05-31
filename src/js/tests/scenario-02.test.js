import { SimulationEngine } from "../simulation-engine.js";
import { Network } from "../network-core.js";
import { Host, Switch } from "../devices.js";
import { ConnectivityError } from "../network-utils.js";

export async function runScenario02Test() {
    console.group("🧪 Validation Scénario 02");
    
    const net = new Network();
    const bob = new Host("Bob", "192.168.1.0", "255.255.255.0"); // Invalide (.0)
    const alice = new Host("Alice", "192.168.1.1", "255.255.255.0");
    const sw = new Switch("SW1", "Switch");
    
    net.addDevice(bob); net.addDevice(alice); net.addDevice(sw);
    net.addLink(bob.getInterface(), sw.interfaces[0]);
    net.addLink(alice.getInterface(), sw.interfaces[1]);

    const engine = new SimulationEngine(net, { pingsToValidate: [] });

    console.log("Test 1: Ping depuis une adresse réseau (.0)");
    const res1 = engine.executeCommand(bob, "ping 192.168.1.1");
    if (res1.events.some(e => e.code === ConnectivityError.NETWORK_ADDRESS_USED)) {
        console.log("✅ Blocage .0 OK");
    } else {
        console.error("❌ Erreur : Le moteur a autorisé un ping depuis .0");
    }

    console.log("Test 2: Correction vers une IP valide (.10)");
    bob.getInterface().setIp("192.168.1.10");
    const res2 = engine.executeCommand(bob, "ping 192.168.1.1");
    if (res2.ok) {
        console.log("✅ Ping valide OK");
    } else {
        console.error("❌ Erreur : Le ping valide a échoué");
    }

    console.groupEnd();
}

if (typeof window !== 'undefined') {
    runScenario02Test();
}
