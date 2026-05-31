import { SimulationEngine } from "../simulation-engine.js";
import { Router } from "../devices.js";
import { Packet, RIPMessage, OSPFMessage } from "../network-core.js";
import { EventBus } from "../event-bus.js";
import { normalizeIPv4Value, ipToString } from "../network-utils.js";

/**
 * Nesiin v1.1 - SCÉNARIOS D'INTÉGRATION DE BOUT-EN-BOUT
 * Ce fichier teste la coopération entre les différentes couches :
 * Routage + NAT + Firewall.
 */

async function testScenarioPrivateToPublicWithNAT() {
    console.group("🧪 Scénario E2E : Accès LAN vers Internet (NAT + Firewall)");
    
    const bus = new EventBus();
    const engine = new SimulationEngine({ devices: [] }, {}, bus);

    // 1. Setup : PC (LAN) -> Router (GW) -> Internet Server
    const router = new Router(1, "GW-CORE", 2);
    const ethLan = router.interfaces[0];
    const ethWan = router.interfaces[1];
    
    ethLan.setIp("192.168.1.1");
    ethLan.setMask("255.255.255.0");
    ethWan.setIp("203.0.113.1");
    ethWan.setMask("255.255.255.0");

    // Simulation d'une route vers Internet via ethWan
    router.addRoute("0.0.0.0", "0.0.0.0", "203.0.113.254", ethWan, 1, "static");

    // Configuration NAT : Toute la plage 192.168.1.0/24 est masquée derrière 203.0.113.1
    router.natEngine.addRule("203.0.113.1", "192.168.1.0");

    // 2. Création du Paquet sortant (PC -> 8.8.8.8)
    const pcIp = normalizeIPv4Value("192.168.1.10");
    const googleDns = normalizeIPv4Value("8.8.8.8");
    const originalPacket = new Packet(pcIp, googleDns, "PING_DATA", 64, "ICMP");

    console.log("Étape 1 : Le routeur reçoit le paquet du LAN...");
    const pipelineResult = router.executePipeline(originalPacket);

    if (pipelineResult.action === "FORWARD") {
        console.log("✅ Paquet accepté par le routage.");
        const outPacket = pipelineResult.packet;
        
        if (ipToString(outPacket.srcIP) === "203.0.113.1") {
            console.log("✅ NAT Succès : L'IP source a été traduite vers l'IP publique.");
        } else {
            console.error(`❌ NAT Échec : IP source attendue 203.0.113.1, obtenue ${ipToString(outPacket.srcIP)}`);
        }

        if (outPacket.ttl === 63) {
            console.log("✅ TTL Succès : Le TTL a été décrémenté.");
        }
    } else {
        console.error("❌ Le pipeline a rejeté le paquet.");
    }

    // 3. Test du Firewall (Drop vers une IP spécifique)
    console.log("\nÉtape 2 : Test du Firewall (Blacklist 1.1.1.1)...");
    router.applyRoutingConfig({
        firewall: {
            defaultPolicy: "allow",
            accessRules: [
                { src_ip: "any", dst_ip: "1.1.1.1", dst_mask: "255.255.255.255", action: "deny", protocols: "any" }
            ]
        }
    });

    const badPacket = new Packet(pcIp, normalizeIPv4Value("1.1.1.1"), "PING_DATA", 64, "ICMP");
    const blockedResult = router.executePipeline(badPacket);

    if (blockedResult.action === "DROP") {
        console.log("✅ Firewall Succès : Le paquet vers 1.1.1.1 a été bloqué.");
    } else {
        console.error("❌ Firewall Échec : Le paquet vers 1.1.1.1 a été autorisé par erreur.");
    }

    console.groupEnd();
}

testScenarioPrivateToPublicWithNAT();