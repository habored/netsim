import { SimulationEngine } from "../simulation-engine.js";
import { Network } from "../network-core.js";
import { Host, Router } from "../devices.js";
import { ipToString, ConnectivityError } from "../network-utils.js";

/**
 * Test d'intégration pour le Scénario 04 : Découverte du routeur / Passerelle
 */
export async function runScenario04Test() {
    console.group("🧪 Test Intégration : Scénario 04 (Passerelle)");
    
    const net = new Network();
    
    // 1. Création des hôtes
    const alice = new Host("PC d'Alice", "192.168.1.10", "255.255.255.0");
    // Le serveur a déjà sa passerelle configurée dans le JSON original
    const server = new Host("Serveur", "10.0.0.2", "255.255.255.0", "10.0.0.1");

    // 2. Création du routeur avec ses deux interfaces
    const router = new Router("R1", "Routeur", [
        { name: "eth0", ip: "192.168.1.254", mask: "255.255.255.0" },
        { name: "eth1", ip: "10.0.0.1", mask: "255.255.255.0" }
    ]);

    net.addDevice(alice); net.addDevice(router); net.addDevice(server);

    // 3. Câblage
    net.addLink(alice.getInterface(), router.getInterfaceByName("eth0"));
    net.addLink(server.getInterface(), router.getInterfaceByName("eth1"));

    const engine = new SimulationEngine(net);

    console.log("Étape 1 : Ping d'Alice vers le serveur SANS passerelle...");
    const result1 = engine.executeCommand(alice, "ping 10.0.0.2");
    if (result1.events.some(e => e.code === ConnectivityError.NO_GATEWAY)) {
        console.log("✅ Succès : Le moteur bloque le ping (pas de passerelle).");
    } else {
        console.error("❌ Échec : Le moteur n'a pas détecté l'absence de passerelle.");
    }

    console.log("Étape 2 : Configuration de la passerelle sur le PC d'Alice...");
    alice.setGateway("192.168.1.254");

    console.log("Étape 3 : Ping d'Alice vers le serveur AVEC passerelle...");
    const result2 = engine.executeCommand(alice, "ping 10.0.0.2");
    
    if (result2.ok) {
        console.log("✅ Succès : Le ping traverse le routeur.");
    } else {
        console.error("❌ Échec : Le ping a échoué malgré la passerelle.");
    }

    console.groupEnd();
}

if (typeof window !== 'undefined') {
    runScenario04Test();
}
