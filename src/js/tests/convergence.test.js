import { expect, test, describe, beforeEach } from 'vitest';
import { Network } from '../network-core.js';
import { Router } from '../devices.js';
import { SimulationEngine } from '../simulation-engine.js';
import { ipToIntStrict } from '../network-utils.js';

describe('Scénario 12 : Convergence Mixte OSPF/RIP sur Routeur Frontière', () => {
    let network, engine, r1, r2, r3;

    beforeEach(() => {
        network = new Network();
        
        // Setup conforme au JSON Scenario 12 :
        // R1 (RIP) <--- 10.0.0.0/24 ---> R2 (Frontière) <--- 10.0.1.0/24 ---> R3 (OSPF)
        r1 = network.addDevice(new Router(1, "R1_RIP", 2));
        r2 = network.addDevice(new Router(2, "R2_Frontiere", 2));
        r3 = network.addDevice(new Router(3, "R3_OSPF", 2));

        // R1-R2 (RIP)
        r1.interfaces[0].setIp("10.0.0.1"); r1.interfaces[0].setMask("255.255.255.0");
        r2.interfaces[0].setIp("10.0.0.2"); r2.interfaces[0].setMask("255.255.255.0");
        
        // R2-R3 (OSPF)
        r2.interfaces[1].setIp("10.0.1.1"); r2.interfaces[1].setMask("255.255.255.0");
        r3.interfaces[0].setIp("10.0.1.2"); r3.interfaces[0].setMask("255.255.255.0");

        // Réseau cible derrière R3 (OSPF)
        r3.addRoute("10.60.2.0", "255.255.255.0", null, r3.interfaces[1], 1, "connected");

        network.addLink(r1.interfaces[0], r2.interfaces[0]);
        network.addLink(r2.interfaces[1], r3.interfaces[0]);

        r1.setProtocols(["RIP"]);
        r2.setProtocols(["OSPF", "RIP"]);
        r3.setProtocols(["OSPF"]);

        engine = new SimulationEngine(network);
    });

    test('Sénario 12 : Séquence de convergence réaliste (Purge OSPF -> Poison RIP)', () => {
        // 1. Convergence initiale
        r2.syncRoutingDaemons();
        r1.syncRoutingDaemons(); // R1 envoie son update à R2
        engine.runQueue();

        // Vérifier que R2 connaît le réseau de R3 via OSPF
        expect(r2.routingTable.some(r => r.networkIp === ipToIntStrict("10.60.2.0") && r.kind === "ospf")).toBe(true);

        // 2. COUPURE DU LIEN R2-R3 (Côté OSPF)
        const link = network.findLinkBetween(r2.interfaces[1], r3.interfaces[0]);
        network.removeLink(link);

        // Déclenchement de la panne
        r2.handleInterfaceDown(r2.interfaces[1]);

        // 3. VERIFICATION SUR R2 : La route OSPF doit avoir disparu
        const r2OspfRoute = r2.routingTable.find(r => r.networkIp === ipToIntStrict("10.60.2.0") && r.kind === "ospf");
        expect(r2OspfRoute).toBeUndefined(); 

        // 4. VERIFICATION DU POISON : R2 doit avoir mis à 16 la route RIP redistribuée
        // On vérifie les paquets sortants de R2 vers R1
        const ripPackets = engine.queue.filter(t => t.frame.content.protocol === "UDP" && t.frame.content.content.kind === "rip");
        expect(ripPackets.length).toBeGreaterThan(0);
        
        const poisonedRoute = ripPackets[0].frame.content.content.routes.find(r => r.networkIp === ipToIntStrict("10.60.2.0"));
        expect(poisonedRoute.cost).toBe(16); // Le poison (16) est bien envoyé à R1

        // 5. PROPAGATION FINALE : R1 doit invalider sa table
        engine.runQueue();
        const r1Route = r1.routingTable.find(r => r.networkIp === ipToIntStrict("10.60.2.0"));
        expect(r1Route === undefined || r1Route.cost === 16).toBe(true);

        // 6. VERIFICATION OSPF SUR R3 (Après timeout)
        // On avance le temps de 45s pour déclencher le Dead Timer
        engine.currentTime += 45000;
        r3.update(engine.currentTime);
        
        const r3OspfRoute = r3.routingTable.find(r => r.kind === "ospf");
        expect(r3OspfRoute).toBeUndefined(); // R3 doit avoir purgé car R2 ne répond plus
    });
});